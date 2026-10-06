# Database schema

> Implemented today: `User`, `UserPreference` (`20261001194243_init_identity`), the credential
> tables in `20261001222857_auth_credentials`, and one-off `Task` (`20261005145330_tasks`).
> Everything else below is the **planned** schema. Field lists are the contract; exact column types
> are finalised in each phase's migration.

## Conventions

| Topic        | Rule                                                                                                                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema files | One file per domain in `apps/api/prisma/schema/*.prisma`; `schema.prisma` holds generator/datasource.                                                                                                 |
| Naming       | Prisma models/fields are PascalCase/camelCase; tables/columns are snake_case via `@@map`/`@map`.                                                                                                      |
| Primary keys | UUIDv7 (`@default(uuid(7)) @db.Uuid`): time-ordered for index locality, non-enumerable.                                                                                                               |
| Timestamps   | `timestamptz(3)`, always UTC. `createdAt`/`updatedAt` on every mutable table.                                                                                                                         |
| Local times  | Wall-clock times (focus windows, availability) are **minutes after local midnight** (`0–1439`) plus the user's IANA timezone. Local calendar days are `date` columns computed in the user's timezone. |
| Ownership    | Every user-owned row has a non-null owner FK (`user_id`) with `ON DELETE CASCADE`.                                                                                                                    |
| Enums        | Postgres enums via Prisma `enum`.                                                                                                                                                                     |
| JSON         | Only for versioned, Zod-validated documents (for example preference blobs, proposal payloads). Never as a substitute for relational data.                                                             |
| Invariants   | Enforced in the database where practical: unique keys, CHECK constraints (hand-written in migrations), partial unique indexes.                                                                        |
| Indexes      | Added for real query patterns only; each index cites its query in a migration comment.                                                                                                                |
| Migrations   | `prisma migrate dev --create-only` → review/extend the SQL → apply. Never edit an applied migration.                                                                                                  |
| Deletes      | Hard delete for user-initiated deletion (privacy); `status` handles suspension/pending deletion.                                                                                                      |

## Implemented (Phase 1)

### `users`

| Column            | Type         | Notes                                                                      |
| ----------------- | ------------ | -------------------------------------------------------------------------- |
| id                | uuid PK      | UUIDv7                                                                     |
| email             | varchar(320) | unique; CHECK `email = lower(btrim(email))`                                |
| password_hash     | text null    | Argon2id; null for Google-only accounts; **never serialised**              |
| email_verified_at | timestamptz  | null until OTP verification; unverified accounts cannot use the product    |
| username          | varchar(30)  | unique, nullable until onboarding; CHECK `^[a-z0-9_]{3,30}$`               |
| display_name      | varchar(50)  |                                                                            |
| avatar_id         | varchar(64)  | predefined avatar identifier; no uploads                                   |
| bio               | varchar(280) | untrusted user content (AI prompt-injection surface)                       |
| birthday          | date         | sensitive; private by default                                              |
| country           | char(2)      | ISO 3166-1 alpha-2; CHECK `^[A-Z]{2}$`                                     |
| timezone          | varchar(64)  | IANA name, default `UTC`; validated with `Intl.DateTimeFormat` (see D-033) |
| status            | UserStatus   | `ACTIVE`, `SUSPENDED`, `PENDING_DELETION`                                  |

### `user_preferences` (1:1 with users, PK = user_id)

`theme` (`LIGHT`/`DARK`/`SYSTEM`), `week_starts_on` (0–6, CHECK), `default_task_sort`
(`MANUAL`, `PRIORITY`, `DUE_DATE`, `SCHEDULED_START`, `CREATED_AT`), `preferred_focus_start` /
`preferred_focus_end` (minutes 0–1439, CHECK), `daily_focus_goal_minutes` (1–1440, CHECK),
`notification_preferences` / `planning_preferences` (JSONB objects, CHECK `jsonb_typeof = 'object'`,
schema-versioned and validated by Zod in `@planit/shared`).

## Implemented (Phase 2 Part 1)

Migration `20261001222857_auth_credentials`. Password reset uses the `PASSWORD_RESET` OTP purpose
and session revoke reason from that migration. Google sign-in uses the `oauth_accounts` table
from that migration, so Part 3 did not add another migration (decision D-030, D-034).

- **`auth_sessions`**: `id, user_id, family_id, refresh_token_hash` (unique SHA-256 hex),
  `expires_at, revoked_at?, revoked_reason? (LOGOUT | ROTATED | REUSE | PASSWORD_RESET),
replaced_by_id?, user_agent, created_at, last_used_at`. One row per refresh-token generation.
  CHECKs: hash is 64 hex characters; `revoked_at` and `revoked_reason` are both null or both set.
  Indexes: `(user_id, created_at)`, `(family_id)`.
- **`email_otps`**: `id, user_id?, email, purpose (EMAIL_VERIFICATION | PASSWORD_RESET),
code_hash` (HMAC-SHA256 hex), `expires_at, attempts, consumed_at?, created_at`. CHECKs: email
  is normalised, hash is 64 hex characters, attempts are 0–5. Index `(email, purpose, created_at)`.
  A maintenance job deletes a row only after `expires_at` plus 24 hours.
- **`oauth_accounts`**: `id, user_id, provider (GOOGLE), provider_account_id, created_at`; unique
  `(provider, provider_account_id)`. One Google subject links to one PlanIT user.
- **`audit_logs`** (append-only via a trigger that rejects `UPDATE` and `DELETE`): `id, user_id?
(ON DELETE SET NULL), actor_type (USER | SYSTEM | AI_PROPOSAL), action, target_type?, target_id?,
metadata` (JSONB object), `request_id?, ip_hash?, created_at`. CHECKs: action matches
  `^[a-z0-9_.]+$`, metadata is an object, `ip_hash` is hex or null. Index `(user_id, created_at)`.
- **`user_plans`**: `user_id` PK, `plan (FREE | PRO)`, `valid_until?`. Signup inserts `FREE`.

## Implemented (Phase 3 Part 1)

Migration `20261005145330_tasks`. One-off tasks. There are no timer or focus columns.
`IN_PROGRESS` is a status the owner sets; it is not timer state. `recurring_task_id` was added
in migration `20261005163009_recurring_tasks` (Part 3).

### `tasks`

| Column            | Type           | Notes                                                                         |
| ----------------- | -------------- | ----------------------------------------------------------------------------- |
| id                | uuid PK        | UUIDv7                                                                        |
| user_id           | uuid           | non-null FK to `users`, `ON DELETE CASCADE`                                   |
| title             | varchar(200)   | trimmed by the application; CHECK length 1–200                                |
| notes             | varchar(10000) | null, or CHECK length 1–10000                                                 |
| priority          | TaskPriority   | `LOW`, `MEDIUM`, `HIGH`; default `MEDIUM`                                     |
| status            | TaskStatus     | `TODO`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`; default `TODO`               |
| due_date          | date           | nullable calendar date, not an instant                                        |
| scheduled_start   | timestamptz(3) | nullable; both schedule columns are null, or the end is strictly later        |
| scheduled_end     | timestamptz(3) | nullable                                                                      |
| estimated_minutes | integer        | null, or 1–10080                                                              |
| completed_at      | timestamptz(3) | set if and only if `status = COMPLETED`                                       |
| sort_order        | varchar(64)    | fractional index, length 1–64. The client never sends it                      |
| recurring_task_id | uuid           | nullable FK to `recurring_tasks`, `ON DELETE SET NULL`. Null on one-off tasks |
| created_at        | timestamptz(3) |                                                                               |
| updated_at        | timestamptz(3) |                                                                               |

Indexes, each commented in the migration with the query it serves: `(user_id, status)`,
`(user_id, due_date)`, `(user_id, scheduled_start)`, `(user_id, priority)`, `(user_id, sort_order)`,
and, from the Part 3 migration, `(user_id, recurring_task_id)`.

## Implemented (Phase 3 Part 3)

Migration `20261005163009_recurring_tasks`. The series UI is not part of this migration.

### `recurring_tasks`

| Column               | Type           | Notes                                                                  |
| -------------------- | -------------- | ---------------------------------------------------------------------- |
| id                   | uuid PK        | UUIDv7                                                                 |
| user_id              | uuid           | non-null FK to `users`, `ON DELETE CASCADE`                            |
| title                | varchar(200)   | CHECK length 1–200                                                     |
| notes                | varchar(10000) | null, or CHECK length 1–10000                                          |
| priority             | TaskPriority   | `LOW`, `MEDIUM`, `HIGH`; default `MEDIUM`                              |
| recurrence_rule      | text           | canonical RRULE the server wrote. CHECK length 1–500                   |
| start_date           | date           | inclusive first date, in the series timezone                           |
| end_date             | date           | null, or CHECK `end_date >= start_date`. Inclusive last date           |
| timezone             | varchar(64)    | IANA name, validated with `Intl.DateTimeFormat`                        |
| enabled              | boolean        | default true. False means the generator creates nothing more           |
| estimated_minutes    | integer        | null, or CHECK 1–10080                                                 |
| default_start_minute | smallint       | null, or CHECK 0–1439. CHECK: set only when `estimated_minutes` is set |
| created_at           | timestamptz(3) |                                                                        |
| updated_at           | timestamptz(3) |                                                                        |

Indexes: `(user_id, enabled)`, `(user_id, start_date)`.

### `task_occurrences`

| Column            | Type             | Notes                                                 |
| ----------------- | ---------------- | ----------------------------------------------------- |
| id                | uuid PK          | UUIDv7                                                |
| recurring_task_id | uuid             | non-null FK to `recurring_tasks`, `ON DELETE CASCADE` |
| user_id           | uuid             | non-null FK to `users`, `ON DELETE CASCADE`           |
| task_id           | uuid             | nullable unique FK to `tasks`, `ON DELETE SET NULL`   |
| occurrence_date   | date             | calendar date in the series timezone                  |
| status            | OccurrenceStatus | `PENDING`, `MATERIALIZED`, `SKIPPED`, `COMPLETED`     |
| created_at        | timestamptz(3)   |                                                       |

Unique `(recurring_task_id, occurrence_date)`. `PENDING` is in the enum and is not inserted for a
future horizon. A row is written only when a date is materialized, skipped, or detached. An
existing row, of any status, means the generator does not create that date again (decision D-041).

## Planned

### Phase 4: focus

- **FocusSession**: `id, userId, taskId?, status (ACTIVE | PAUSED | COMPLETED | CANCELLED),
startedAt, endedAt?, pausedAt?, accumulatedPauseSeconds, durationSeconds?, createdAt, updatedAt`.
  **Partial unique index** `ON focus_sessions(user_id) WHERE status IN ('ACTIVE','PAUSED')`
  guarantees at most one open session per user, even under concurrent starts.
  Indexes: `(userId, startedAt)`, `(userId, endedAt)`, `(taskId, startedAt)`, `(userId, status)`.
  Elapsed is always computed server-side:
  `elapsed = (endedAt ?? (pausedAt ?? now())) − startedAt − accumulatedPauseSeconds`.
- **FocusSessionEvent**: `id, sessionId, type (START | PAUSE | RESUME | STOP | CANCEL),
occurredAt (server time), metadata JSONB`. Audit trail for each transition.

### Phase 6: statistics (derived and rebuildable)

- **DailyProductivityAggregate**: unique `(userId, localDate)`; `focusSeconds, sessionCount,
longestSessionSeconds, tasksCompleted, tasksCompletedByPriority JSONB, focusByHour int[24],
computedAt`.
- **WeeklyProductivityAggregate** (`weekStart` per the user's `weekStartsOn`) and
  **MonthlyProductivityAggregate** (`month` as the first local date): same measures, rolled up.
- **SkillTimeAggregate**: unique `(userId, skillId, localDate)`; `focusSeconds`.
- Streaks and personal records are computed from daily aggregates. A day is **active** when the
  user's completed focus time that local day is at least `ACTIVE_DAY_MIN_FOCUS_SECONDS`
  (default 600 seconds, configurable). This definition is the single source for streaks, active
  days and records, and the UI explains it wherever streaks are shown.

All aggregates can be rebuilt per user and date range from `focus_sessions` and `tasks` by the
`analytics.rebuild` job.

### Phase 7: goals and skills

- **Goal**: `id, userId, title, description?, targetDate?, targetMinutes?, progressMetric
(TASKS_COMPLETED | FOCUS_MINUTES | MILESTONES), status (ACTIVE | COMPLETED | ARCHIVED),
createdAt, updatedAt`.
- **GoalMilestone**: `id, goalId, userId, title, dueDate?, completedAt?, sortOrder`.
- **GoalTask**: PK `(goalId, taskId)`; both must belong to the same user (checked in service and
  by a composite FK on `(id, user_id)` pairs).
- **Skill**: `id, userId, name, category?`; unique `(userId, lower(name))`.
- **TaskSkill**: PK `(taskId, skillId)`, same-owner rule as GoalTask.

### Phase 8: social and privacy

- **ProfileVisibility**: `userId PK, profileVisibility (PRIVATE | FRIENDS | PUBLIC),
discoverable boolean, showProfileViewers boolean`.
- **ProfileFieldVisibility**: unique `(userId, field)`; `visibility (PRIVATE | FRIENDS | PUBLIC)`.
  Defaults are listed in `docs/privacy.md`.
- **FriendRequest**: `id, senderId, receiverId, status (PENDING | ACCEPTED | DECLINED |
CANCELLED), createdAt, respondedAt?`. Partial unique `(LEAST, GREATEST) WHERE status = 'PENDING'`
  prevents duplicate/crossed requests. Indexes `(receiverId, status)`, `(senderId, status)`.
- **Friendship**: symmetric rows `(userId, friendUserId)`, unique, inserted in pairs in one
  transaction.
- **Block**: unique `(blockerId, blockedId)`; blocking removes friendship and pending requests.
- **ProfileView**: `id, profileOwnerId, viewerId?, viewedAt`; index `(profileOwnerId, viewedAt)`.
- **Notification**: `id, userId, type, payload JSONB, readAt?, createdAt`; indexes
  `(userId, readAt)`, `(userId, createdAt)`.
- **UserAvailability**: `id, userId, dayOfWeek (0–6), startMinute, endMinute, type
(AVAILABLE | UNAVAILABLE), createdAt, updatedAt`; CHECK `endMinute > startMinute`.
  (Introduced earlier, in Phase 10, if AI scheduling lands first.)

### Phases 9–12: AI

- **AIConversation** / **AIMessage**: user-owned chat history (`userId` on both), deletable, with
  a retention policy. Never contains credentials.
- **AIProposal**: `id, userId, conversationId?, kind, payload JSONB (normalized), payloadHash
(SHA-256 of canonical JSON), assumptions JSONB (entity IDs → expected updatedAt), status
(PENDING | EXECUTING | EXECUTED | REJECTED | EXPIRED | FAILED), expiresAt, createdAt,
executedAt?, executionResult JSONB?, calendarDecision (UNDECIDED | ADD_TO_CALENDAR |
TASKS_ONLY)`. Index `(userId, status, expiresAt)`.
- **AIMemory**: `id, userId, category, content, source (USER | AI_CONFIRMED), createdAt,
updatedAt`. Owner-only, exportable and deletable.
- **AIUsageRecord**: `id, userId, mode (PLANIT_MANAGED | BYOK), provider, model, requestId,
inputTokens?, outputTokens?, totalTokens?, estimatedCost?, createdAt`. Never prompt text, raw
  responses, keys or headers. Index `(userId, mode, createdAt)`.
