# AI security

> AI is never the security boundary. The backend is. Status: **planned** (Phases 9–12), except
> for the ESLint boundary on `modules/ai/**` (implemented).

## 1. Threat model

| Asset                       | Threats                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------- |
| Other users' data           | cross-user reads through tools, injected instructions, guessed IDs                  |
| The user's own data         | unconfirmed mutation, bulk destruction, stale or replayed proposals                 |
| PlanIT-managed provider key | exfiltration through prompts, tool output, logs, errors, browser bundle             |
| User's BYOK key             | persistence, transmission to PlanIT, leakage to logs, error trackers or React state |
| PlanIT infrastructure       | SQL/shell/filesystem/network abuse through tool calls (SSRF)                        |
| Privacy settings            | AI-driven visibility changes without consent                                        |

## 2. Prompt-injection defences

All user-generated content (task titles and notes, goal descriptions, skill names, bios, memories,
future imported data) is **data, never instructions**.

1. **Channel separation.** The prompt has distinct segments: system instructions →
   application policy → the user's current request → retrieved data → tool outputs. Retrieved
   data and tool outputs are wrapped in clearly delimited, labelled JSON blocks
   (`<untrusted_user_data>`), with the instruction that their contents are never commands.
2. **Least capability.** Even a fully hijacked model can only call allowlisted, owner-scoped,
   read-only tools or produce proposals. It cannot execute anything.
3. **Output validation.** Every action-bearing output is schema-validated and business-rule
   validated server-side, then shown to the user as exact operations.
4. **Human confirmation.** Nothing is applied without the user approving the exact
   normalized proposal (hash-bound).
5. **No secrets in reach.** No credential, token or key is ever placed in context or returned by
   a tool, so there is nothing to extract.
6. **Limits.** Caps on tool calls per turn, items per tool result, proposal size and output
   tokens.

## 3. Credential separation

| Credential         | Lives in                                     | Never in                                                                                                                                                          |
| ------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PlanIT-managed key | API process environment (secret manager)     | browser, API responses, logs, prompts, context, tool outputs, analytics, DB                                                                                       |
| BYOK key           | browser memory only (`ByokCredentialHolder`) | PostgreSQL, Redis, cookies, local/session storage, IndexedDB, server sessions, logs, analytics, error tracking, URLs, PlanIT network requests, React state/errors |

Provider responses that echo request headers or keys are discarded rather than stored. Provider
SDK errors are mapped to generic messages before logging.

## 4. Non-negotiable security tests

Each scenario must fail safely. The "Layer" column is where the automated test lives:
U = unit, I = API integration (real DB), E = browser E2E (Playwright), S = static/CI check.

The browser hook for rows marked E is `apps/web/e2e/support/network-guards.ts`. Phase 2 records
same-origin traffic and asserts `passwordHash` is absent. The BYOK and provider-payload scenarios
are still Phases 9–12. The bundle half of scenario 17 is the CI scan in decision D-038.

| #   | Scenario                                             | Expected safe behaviour / control                                                                         | Layer |
| --- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----- |
| 1   | AI requests another user's task                      | tools take no user ID; repository filters by session user → not found                                     | I     |
| 2   | AI requests another user's private profile           | no such tool; profile tool returns only the caller's settings                                             | I     |
| 3   | AI requests another user's API key                   | no keys stored or reachable; tool registry has no credential tool                                         | I     |
| 4   | AI requests PlanIT's provider key                    | key never in context/tool output; output scanner refuses responses containing key patterns                | U, I  |
| 5   | AI requests the user's BYOK key                      | key never in context; holder exposes no getter to app code                                                | U, E  |
| 6   | Prompt injection overrides system instructions       | channel separation + capability limits; injected text cannot trigger execution                            | I     |
| 7   | AI attempts SQL execution                            | no SQL tool; unknown tool calls rejected; `$queryRawUnsafe` banned                                        | U, S  |
| 8   | AI attempts shell execution                          | no such tool; unknown tool rejected                                                                       | U     |
| 9   | AI attempts arbitrary HTTP request                   | no network tool; API only calls configured hosts                                                          | U     |
| 10  | AI creates a task without confirmation               | proposal tools only draft; DB unchanged until approval                                                    | I     |
| 11  | AI deletes a task without confirmation               | same as 10                                                                                                | I     |
| 12  | AI creates 100 tasks without confirmation            | same as 10, plus bulk-confirmation requirement                                                            | I     |
| 13  | AI changes calendar without confirmation             | schedule applied only with `calendarDecision = ADD_TO_CALENDAR`                                           | I     |
| 14  | AI modifies another user's data                      | execution re-checks ownership of every entity; mismatch aborts transaction                                | I     |
| 15  | AI changes profile privacy without confirmation      | privacy is not a proposal kind; changes only via settings endpoints                                       | I     |
| 16  | BYOK mode bypasses authorization                     | BYOK proposals go through the same endpoints, guards and validation                                       | I, E  |
| 17  | Managed key visible to browser                       | bundle scan for key patterns; no `NEXT_PUBLIC_` secrets; usage API returns no key fields                  | S, E  |
| 18  | BYOK key appears in PlanIT server requests           | E2E intercepts all requests to the PlanIT origin and asserts the key string never appears                 | E     |
| 19  | BYOK key appears in logs                             | the key never reaches the server; client logger and redaction tests                                       | U, E  |
| 20  | BYOK key appears in error tracking                   | error tracker `beforeSend` scrubs; holder errors never include the key                                    | U     |
| 21  | AI receives credentials through tool output          | tool output schemas exclude credential fields; snapshot tests                                             | U     |
| 22  | Retrieved task text injects instructions             | seeded malicious task notes; assert no unapproved proposal executes and no extra tools run                | I     |
| 23  | Expired proposal approved                            | CAS `expires_at > now()` fails → 409/410, no mutation                                                     | I     |
| 24  | Modified/stale proposal hash accepted                | hash mismatch or assumption mismatch → rejected, no mutation                                              | I     |
| 25  | Same proposal executed twice → duplicates            | second call returns stored result; row counts unchanged                                                   | I     |
| 26  | Two concurrent approvals both mutate                 | parallel requests: exactly one CAS succeeds                                                               | I     |
| 27  | BYOK sends context outside selected scope            | context endpoint filters by scope; E2E asserts the provider payload contains only the selected categories | I, E  |
| 28  | BYOK context includes another user's data or secrets | context endpoint is owner-scoped and has a secret-free projection                                         | I     |

These tests are part of the Definition of Done for Phases 9–12. No AI feature ships with any of
them missing or failing.

## 5. Operational controls

- Rate limits on chat, proposal creation and proposal execution (security), separate from
  usage quotas (product).
- Audit log entries for proposal creation (kind and counts only), approval, execution, failure
  and rejection.
- AI telemetry is limited to metadata: request count, provider, model, latency, token counts
  and outcome. No prompts or outputs go to analytics.
- Provider-side spend limits and alerts are configured for the managed key, which is rotated
  on a schedule and immediately on suspicion of exposure.
