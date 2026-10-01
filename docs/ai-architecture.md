# AI architecture

> Status: **planned** (Phases 9–12). Phase 1 already enforces one boundary in code: ESLint
> forbids `apps/api/src/modules/ai/**` from importing the database layer or Prisma.

## 1. Core flow

```
USER REQUEST → AI UNDERSTANDS → AI PROPOSES → PLANIT VALIDATES & NORMALIZES → USER REVIEWS EXACT
CHANGES → USER CONFIRMS → BACKEND RE-VALIDATES OWNERSHIP & FRESHNESS → EXECUTES EXACTLY THAT →
ONLY THAT USER'S DATA CHANGES
```

The model never mutates data. It can read permitted data through read-only tools and produce
**proposals**. Execution is a separate, user-initiated API call that the model cannot make.

## 2. Components (`apps/api/src/modules/ai`)

| Service                                 | Responsibility                                                                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `AIService`                             | Orchestrates a turn: context → provider → tool loop → proposal extraction → response stream.                                                    |
| `LLMProvider` (interface)               | `generate({ system, messages, tools, responseSchema, signal }) → { output, toolCalls, usage }`. The single place provider SDKs are called.      |
| `PlanItManagedProvider`                 | Server-side implementation using the PlanIT key from the secret manager.                                                                        |
| `AIContextService`                      | Builds the minimal relevant context for a request (§4), always for `authenticatedUserId`.                                                       |
| `AIToolService`                         | Registry of allowlisted tools (§5). Validates tool arguments with Zod and calls owner-scoped domain **services**.                               |
| `AIPlanService`                         | Goal → plan → tasks → schedule logic; deterministic scheduling helpers (availability fitting) that the model's suggestions are checked against. |
| `AIProposalService`                     | Validate, normalize, hash, persist, expire, approve and execute proposals (§6).                                                                 |
| `AIUsageService` + `EntitlementService` | Quotas for PlanIT-managed AI (§8).                                                                                                              |

BYOK adapters (OpenAI, Gemini, Anthropic) implement the same `LLMProvider` interface but live in
the **web app** (`apps/web/src/lib/ai/byok/`), because BYOK calls go from the browser directly to
the provider (§7).

## 3. Structured outputs

All model outputs that can lead to actions are JSON validated with Zod schemas from
`@planit/shared` (`aiPlanSchema`, `aiProposalSchema`, …):

```json
{
  "goal": { "title": "SDE Interview Preparation", "targetDate": "2026-11-27" },
  "milestones": [{ "title": "Arrays & Hashing", "dueDate": "2026-10-10" }],
  "tasks": [
    { "ref": "t1", "title": "Two Sum + variants", "estimatedMinutes": 60, "priority": "HIGH" }
  ],
  "schedule": [{ "taskRef": "t1", "start": "2026-10-05T13:30:00Z", "end": "2026-10-05T14:30:00Z" }],
  "changes": [],
  "requiresCalendarConfirmation": true
}
```

Invalid output is never executed; the service may ask the model to repair it once, then fails
with a user-visible error. Limits are enforced by schema (for example at most 200 tasks per
proposal, title lengths, durations, and dates inside the goal window).

## 4. Context assembly

Context is assembled per request, never as a full-history dump. Priority order, each with a
token budget:

1. the current request;
2. relevant preferences and planning preferences;
3. availability (`UserAvailability`);
4. active goals;
5. relevant tasks (open, due soon, linked to the goal in question);
6. internal calendar window (scheduled items in the planning horizon);
7. recent focus statistics (aggregates, not raw sessions);
8. relevant skills;
9. relevant memories (`AIMemory`).

Structured data stays structured (JSON blocks), not prose. Each block is labelled as
**untrusted user data** (`docs/ai-security.md` §2). Context never contains credentials, tokens,
other users' data or internal IDs beyond what tools need.

## 5. Tools

Read-only (return owner-scoped, minimal projections):
`get_my_tasks`, `get_my_open_tasks`, `get_my_goals`, `get_my_availability`,
`get_my_focus_statistics`, `get_my_skills`, `get_my_calendar`, `get_my_preferences`,
`get_my_profile_settings`.

Proposal tools (produce draft operations only):
`propose_create_task`, `propose_update_task`, `propose_delete_task`, `propose_complete_task`,
`propose_create_goal`, `propose_create_recurring_task`, `propose_schedule_tasks`,
`propose_reschedule_tasks`.

Execution: `execute_approved_proposal` is **not** a model tool. It is an API endpoint that only
the user's explicit approval action calls.

Tool rules:

- No tool accepts a `userId`; the user is bound from the server-side session.
- Tool arguments are Zod-validated; unknown tools or arguments are rejected and logged.
- No tool can run SQL, shell commands, filesystem or environment access, or arbitrary HTTP.
- Tool outputs are projections built for the model, never raw database rows; they never include
  secrets or other users' data.
- Per-turn limits: maximum tool calls and maximum returned items.

## 6. Proposals

Lifecycle: `PENDING → EXECUTING → EXECUTED`, or `PENDING → REJECTED | EXPIRED`, or
`EXECUTING → FAILED`.

1. **Validate** the proposal schema and business rules (owner-scoped references exist; times fit
   availability where required; within limits).
2. **Normalize** (sorted keys, canonical dates, resolved references) and compute
   `payloadHash = SHA-256(canonical JSON)`.
3. **Persist** with `expiresAt` (default 30 minutes, configurable per kind) and
   **assumptions**: for every existing entity it touches, the expected `updatedAt`.
4. **Display** exactly the normalized operations, plus counts and total estimated time. Bulk,
   destructive, recurring-series, large-schedule and privacy changes get an extra explicit
   confirmation step.
5. **Approve** with `POST /ai/proposals/:id/approve { payloadHash, calendarDecision }` and an
   `Idempotency-Key`.
6. **Execute** in one database transaction:
   - `UPDATE ai_proposals SET status = 'EXECUTING' WHERE id = $id AND user_id = $user AND status =
'PENDING' AND expires_at > now() AND payload_hash = $hash` (compare-and-set). Zero rows means
     the proposal is expired, mismatched, already executing or already executed. Concurrent
     double-approvals therefore cannot both proceed.
   - Re-check every assumption and the ownership of every referenced entity. Any mismatch aborts
     the whole transaction (no partial execution) and marks the proposal stale.
   - Apply operations through domain services within the same transaction.
   - Store `executionResult` and set `EXECUTED`; audit-log the execution.
7. **Replays** (retries, double-clicks, timeouts) for an executed proposal return the stored
   `executionResult` without mutating anything.

If the model revises a plan, it produces a new proposal with a new ID and hash, and needs a new
approval.

### Calendar confirmation

Applying tasks and writing the schedule are separate decisions.
`calendarDecision = TASKS_ONLY` creates tasks without `scheduledStart`/`scheduledEnd`.
`ADD_TO_CALENDAR` also applies exactly the approved schedule. The UI asks: "Would you like PlanIT
to add the proposed schedule to your PlanIT calendar?" Re-plans follow the same rule.

## 7. BYOK (Phase 11)

```
Browser ──(1) GET /api/v1/ai/context?scope=tasks,goals,availability ──► API (owner-scoped,
                                                                         scope-filtered bundle)
Browser ──(2) prompt + selected context ──► provider (user's key in memory)
Browser ◄─(3) structured proposal ─────────
Browser ──(4) POST /api/v1/ai/proposals ──► API validates/normalizes exactly like managed mode
User approves ──(5) POST /api/v1/ai/proposals/:id/approve ──► API executes
```

- The key lives only in a narrowly scoped in-memory module (`ByokCredentialHolder`: a closure
  with `set`, `use(fn)` and `clear`, no getter that returns the raw string to React state). It is
  never written to any storage, never in React state or errors, and never sent to PlanIT.
  Refresh, tab close and "Remove key" erase it. There is no "remember my key".
- Context scope: the user selects categories (current tasks, goals, availability, recent stats,
  long-term stats, profile, skills). The API endpoint returns only the selected categories, and
  the UI shows exactly what will be sent before every first send and whenever the scope widens.
- BYOK changes only the inference provider and its billing. Tools, ownership, privacy,
  validation and confirmation are identical. A BYOK-produced proposal is just untrusted input to
  the same proposal pipeline.
- Usage panel: provider, model, requests this session, input/output/total tokens **only** when
  the provider response includes them; otherwise "Usage information unavailable for this
  provider/model." Labelled "Usage tracked by PlanIT", not billing. Optional informational
  `AIUsageRecord` rows (mode `BYOK`) contain counts only.
- The UI must show: "PlanIT does not store this key. It is kept only in your current browser
  session. However, secrets used directly in a browser can still be exposed if the
  browser/device is compromised. Use provider-side key restrictions and spending controls where
  available."

## 8. Usage and entitlements (Phase 12)

- Limits are configuration (per plan, per period), read by `EntitlementService` and enforced by
  `AIUsageService` before calling the managed provider. Example defaults: FREE 10 requests/day
  and 100/month.
- The browser receives only plan, model name, used and remaining allowance (requests/tokens) and
  the reset time. It never receives the key.
- Warnings at 80%, 90% and 100%. At the limit: "PlanIT AI limit reached." No silent fallback to
  another provider.
- BYOK usage never counts against or unlocks PlanIT entitlements.

## 9. Future AI trust levels (do not implement now)

The proposal pipeline has a single policy hook (`ProposalPolicy.requiresConfirmation(proposal,
user)`) that today always returns true. Future modes (Always ask, Ask for bulk/important, Read-only)
would be implemented there and can never bypass authorization, ownership, privacy, validation,
audit logging or rate limits.
