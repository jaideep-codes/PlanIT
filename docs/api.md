# API

> Implemented: health checks, Phase 2 auth (including Google sign-in), Phase 3 Part 1 one-off
> tasks, the saved task sort on the current user, and Phase 3 Part 3 recurrence. The series UI
> has not started. Remaining route groups are listed as **planned**.

## Conventions

| Topic          | Rule                                                                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base path      | `/api`. Resource routes are URI-versioned: `/api/v1/...`. Health is version-neutral.                                                                                                      |
| Access path    | Browsers call the **web origin** (`/api/*` is rewritten to the API). Direct cross-origin calls are restricted by a CORS allowlist (`WEB_ORIGINS`).                                        |
| Format         | JSON only, UTF-8. Request bodies up to 256 KB.                                                                                                                                            |
| Success bodies | A single resource is returned as the object itself. Collections return `{ "items": [...], "nextCursor": string \| null }`.                                                                |
| Errors         | Always the envelope below, with the correct HTTP status.                                                                                                                                  |
| Validation     | Zod schemas from `@planit/shared`, applied by `ZodValidationPipe`. Request bodies use `z.strictObject`, so unknown keys (for example `userId`) are rejected (mass-assignment protection). |
| Identity       | Never taken from the request body, query or path. Always the server-side session's user.                                                                                                  |
| Pagination     | Cursor-based: `?limit=` (default 20, max 100) and `?cursor=` (opaque base64url of the sort key + id). Offset pagination is not offered for large collections.                             |
| Sorting        | `?sort=field` / `?sort=-field` from a per-endpoint allowlist.                                                                                                                             |
| Filtering      | Explicit, documented query params per endpoint (no generic filter language).                                                                                                              |
| Caching        | Every API response has `Cache-Control: no-store`.                                                                                                                                         |
| Correlation    | `X-Request-Id` accepted if it matches `^[A-Za-z0-9._-]{8,128}$`, otherwise generated; echoed on every response and in error bodies.                                                       |
| Rate limits    | Baseline per-IP limit on every route (`RATE_LIMIT_*`), plus stricter named limits per sensitive route (see `docs/security.md`). `429` includes `Retry-After`.                             |
| Time           | Timestamps are ISO 8601 UTC strings. Local dates are `YYYY-MM-DD`, interpreted in the user's timezone.                                                                                    |
| Idempotency    | Mutations that clients may retry (proposal execution, focus start/stop) accept an `Idempotency-Key` header.                                                                               |

### Error envelope

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request failed validation.",
    "requestId": "0192f1c4-…",
    "details": [{ "path": "title", "message": "Too small: expected string to have >=1 characters" }]
  }
}
```

- `code` is stable and machine-readable. Cross-cutting codes live in `@planit/shared`
  (`ERROR_CODES`); domain codes (for example `TASK_NOT_FOUND`) are added there by their phase.
- Only `AppException` messages are passed to clients. All other errors (framework, library,
  database, provider) get a generic message for their status, so stack traces, SQL and secrets
  never leave the server. 5xx errors are logged with full diagnostics, tagged with the request ID.
- `details` appears only for validation failures.
- Resources owned by another user return **404 `NOT_FOUND`**, not 403, so existence is not
  revealed (IDOR hardening).

| Status | Code                  | When                                                                                       |
| ------ | --------------------- | ------------------------------------------------------------------------------------------ |
| 400    | `VALIDATION_ERROR`    | schema validation failed                                                                   |
| 400    | `BAD_REQUEST`         | malformed request (for example invalid JSON)                                               |
| 401    | `UNAUTHENTICATED`     | missing/expired session                                                                    |
| 403    | `FORBIDDEN`           | authenticated but not allowed (for example email not verified, entitlement missing)        |
| 404    | `NOT_FOUND`           | unknown route or resource not visible to caller                                            |
| 409    | `CONFLICT`            | state conflict (for example a focus session is already active, proposal already executing) |
| 413    | `PAYLOAD_TOO_LARGE`   | body over the limit                                                                        |
| 429    | `RATE_LIMITED`        | rate limit exceeded                                                                        |
| 500    | `INTERNAL_ERROR`      | unexpected failure                                                                         |
| 503    | `SERVICE_UNAVAILABLE` | dependency outage                                                                          |

## Implemented endpoints

### `GET /api/health` (liveness)

Never touches dependencies. Not rate-limited. Not request-logged.

```json
{ "status": "ok", "uptimeSeconds": 42, "timestamp": "2026-10-01T19:47:17.541Z" }
```

### `GET /api/health/ready` (readiness)

`200` with `ready` or `degraded` (Redis down; the API keeps serving), and `503` with
`not_ready` (database unreachable). Failure reasons are logged server-side, never returned.

```json
{
  "status": "ready",
  "checks": {
    "database": { "status": "up", "latencyMs": 3 },
    "redis": { "status": "up", "latencyMs": 1 }
  },
  "timestamp": "2026-10-01T19:47:17.541Z"
}
```

Contracts: `@planit/types` (`LivenessResponse`, `ReadinessResponse`); runtime schemas:
`@planit/shared` (`livenessResponseSchema`, `readinessResponseSchema`).

### Auth (Phase 2 Part 1)

All six routes are public (`@Public()`), require `Content-Type: application/json` and an allowed
`Origin`, and have named Redis rate limits that fail closed. Bodies are strict objects. Responses
are `AuthAcknowledgement` (`@planit/types`); tokens are cookies, never JSON. `passwordHash` is
never returned.

| Method | Path                      | Success                                             |
| ------ | ------------------------- | --------------------------------------------------- |
| POST   | `/api/v1/auth/signup`     | `201 { "status": "verification_required" }`         |
| POST   | `/api/v1/auth/otp/verify` | `200 { "status": "verified" }`                      |
| POST   | `/api/v1/auth/otp/resend` | `200 { "status": "verification_required" }`         |
| POST   | `/api/v1/auth/login`      | `200 { "status": "authenticated" }` + cookies       |
| POST   | `/api/v1/auth/refresh`    | `200 { "status": "authenticated" }` + cookies       |
| POST   | `/api/v1/auth/logout`     | `200 { "status": "logged_out" }` and clears cookies |

Signup and login use the same message for an unknown email (`401` "Invalid email or password."
on login; signup always returns the verification acknowledgement). A correct password on an
unverified account is `403` "Verify your email before signing in." Refresh and logout send `{}`.
The access cookie is `__Host-planit_access` (`Path=/`); the refresh cookie is `planit_refresh`
(`Path=/api/v1/auth`).

Schemas: `signupRequestSchema`, `loginRequestSchema`, `otpVerifyRequestSchema`,
`otpResendRequestSchema`, `emptyRequestSchema`, `authAcknowledgementSchema` in `@planit/shared`.

### Password reset, sessions, and the current user (Phase 2 Part 2)

Password reset is public. Session and profile routes require a session cookie. Bodies are strict
objects. A reset code is entered by the person; it is never put in a URL.

| Method | Path                                  | Success                                                                                  |
| ------ | ------------------------------------- | ---------------------------------------------------------------------------------------- |
| POST   | `/api/v1/auth/password/forgot`        | `200 { "status": "reset_requested" }` for every email when the Redis limits allow it     |
| POST   | `/api/v1/auth/password/reset`         | `200 { "status": "password_reset" }`, revokes every session, and clears cookies          |
| GET    | `/api/v1/auth/sessions`               | `{ "items": [...], "nextCursor": null }` of the caller's live sessions                   |
| DELETE | `/api/v1/auth/sessions/:id`           | `{ "status": "revoked", "currentSessionRevoked": boolean }`. Another user's id is `404`. |
| POST   | `/api/v1/auth/sessions/revoke-others` | `{ "status": "revoked", "currentSessionRevoked": false }`                                |
| GET    | `/api/v1/users/me`                    | the owner projection below                                                               |
| PATCH  | `/api/v1/users/me`                    | the same projection. Accepts only `displayName` and `timezone`.                          |
| PATCH  | `/api/v1/users/me/theme`              | the same projection. Accepts only `theme` (`light`, `dark`, or `system`).                |
| PATCH  | `/api/v1/users/me/task-sort`          | the same projection. Accepts only `defaultTaskSort` (see below).                         |

`GET /api/v1/users/me` returns `id`, `email`, `displayName`, `timezone`, `emailVerifiedAt`,
`theme`, `defaultTaskSort`, and `createdAt`. It never returns `passwordHash`. `defaultTaskSort`
is `manual`, `priority`, `dueDate`, `scheduledStart`, or `createdAt`. A missing preference row
is `manual`. `PATCH /api/v1/users/me/task-sort` is the only writer. The body is
`{ "defaultTaskSort": "<one of those five>" }`. A leading `-` is rejected. `PATCH /users/me` and
`PATCH /users/me/theme` reject the field. Session items are `id`, `createdAt`,
`lastUsedAt`, `expiresAt`, `userAgent`, and `current`. They never include a token or token hash.

Forgot-password limits: one request per email per 60 seconds, and five per email per hour, plus
coarser per-IP limits. Both are Redis counters checked before the account lookup (decision D-032).
The reset route uses the same OTP expiry, five-attempt lock, and hourly cap as verification.
Redis failures on these routes are `503`.

Schemas: `passwordForgotRequestSchema`, `passwordResetRequestSchema`, `sessionIdSchema`,
`authSessionListSchema`, `sessionRevocationSchema`, `updateCurrentUserRequestSchema`,
`updateThemeRequestSchema`, `updateTaskSortRequestSchema`, `currentUserSchema`,
`googleCallbackQuerySchema`, `googleSignInAvailabilitySchema` in `@planit/shared`.

### Google sign-in (Phase 2 Part 3)

Both routes are public (`@Public()`). They are browser navigations, not JSON mutations, so they
do not send a JSON body. The client secret never leaves the API.

| Method | Path                           | Success                                                                                         |
| ------ | ------------------------------ | ----------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/auth/google/start`    | `302` to Google's authorization endpoint, with PKCE, `state`, and `nonce`                       |
| GET    | `/api/v1/auth/google/callback` | `303` to `/` and sets the session cookies. Failures `303` to `/login?google=` with an allowlist |

`GET /api/v1/auth/google/start` with `Accept: application/json` (and no `text/html`) does not start
a login. It returns `{ "available": true }` or `{ "available": false }`. A browser navigation when
Google is not configured is `503` "Google sign-in is not configured." The callback is the same
`503` in that case, and it does not set session cookies. The callback is rate-limited per IP and
fails closed when Redis is down.

The callback accepts `code`, `state`, and `error`. It ignores other query keys. A missing or
reused `state`, a state cookie that does not match, or an ID token Google will not verify becomes
`/login?google=failed`. `email_verified` other than boolean true becomes
`/login?google=unverified_email`. An existing PlanIT user whose email is not verified becomes
`/login?google=verify_email`, and no `oauth_accounts` row is written. A verified user is linked.
A new user is created with `passwordHash` null and `emailVerifiedAt` set.

Audit actions are `auth.google_link_succeeded` (`provider` `google` and `outcome` `created`,
`linked`, or `signed_in`) and `auth.google_link_failed` (`provider` `google`, `reason`, and when
Google returned `error` an allowlisted `providerError`). Any other provider error is stored as
`unknown`. Rows do not store the authorization code, tokens, verifier, nonce, client secret, or
`error_description` (decision D-035).

### One-off tasks (Phase 3 Part 1)

Every route requires a session cookie. The user id comes from that session. A missing or expired
session is `401`. Another user's task id is `404` `NOT_FOUND`. Mutations need
`Content-Type: application/json` and an allowed `Origin`. Bodies are strict objects, so `userId`
and any other unknown key are `400`. A single task is the object itself. Timestamps are ISO 8601
UTC. `dueDate` is `YYYY-MM-DD` or null. `userId` is not returned.

| Method | Path                         | Success                                                                                       |
| ------ | ---------------------------- | --------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/tasks`              | `201` and the created task. New tasks are inserted at the front of the caller's manual order. |
| GET    | `/api/v1/tasks`              | `{ "items": [...], "nextCursor": string \| null }`                                            |
| GET    | `/api/v1/tasks/:id`          | the task                                                                                      |
| PATCH  | `/api/v1/tasks/:id`          | the updated task                                                                              |
| DELETE | `/api/v1/tasks/:id`          | `200` and the deleted task. The row is hard-deleted.                                          |
| POST   | `/api/v1/tasks/:id/complete` | `200` and the task. Sets `COMPLETED` and `completedAt` to the server clock.                   |
| POST   | `/api/v1/tasks/:id/reopen`   | `200` and the task. Valid only from `COMPLETED`. Sets `TODO` and clears `completedAt`.        |
| PATCH  | `/api/v1/tasks/:id/position` | `200` and the task. The server chooses the new fractional `sortOrder`.                        |

`POST` complete and reopen send `{}`. Completing a task that is already `COMPLETED` returns `200`
with the same task and does not write another audit row. Completing a `CANCELLED` task is allowed.
Reopening any other status is `409` `CONFLICT`. `PATCH` may set `status` to `TODO`, `IN_PROGRESS`,
or `CANCELLED`. `status: COMPLETED`, `completedAt`, `sortOrder`, `id`, and `userId` are rejected.
Moving a `CANCELLED` task back to `TODO` or `IN_PROGRESS` is a `PATCH`.

Create defaults are `priority` `MEDIUM`, `status` `TODO`, and null notes, due date, schedule, and
estimate. `scheduledStart` and `scheduledEnd` are both omitted or null, or both instants with the
end after the start. Sending only one is `400`. `estimatedMinutes` is an integer from 1 to 10080,
or null. `title` is trimmed to 1–200 characters. `notes` is trimmed; a blank value becomes null;
the maximum is 10000 characters.

List query keys are `limit` (default 20, maximum 100), `cursor`, `status`, `priority`, `due`,
`scheduledFrom`, `scheduledTo`, and `sort`. Unknown keys are rejected. `status` and `priority`
accept one value or a repeated key; values within a field are OR, and different fields are AND.
`due` matches `dueDate` exactly. `scheduledFrom` and `scheduledTo` are inclusive instants compared
with `scheduledStart`. `sort` is `manual`, `priority`, `dueDate`, `scheduledStart`, or `createdAt`.
A leading `-` reverses it. Forward `priority` is HIGH, then MEDIUM, then LOW. Forward dates are
earliest first, with nulls last. Forward `manual` and `createdAt` are ascending. Every order breaks
ties by `id`. When `sort` is omitted, the list uses `user_preferences.default_task_sort`.
`GET /users/me` returns that value as `defaultTaskSort`, and `PATCH /users/me/task-sort` saves it.
Direction is not stored (decision D-040).

`cursor` is an opaque base64url value for one sort and filter combination. A cursor that cannot be
read, or that was issued for a different sort or filter, is `400`. `PATCH` position sends optional
`beforeId` and `afterId`; at least one is required. Both, when present, must already be adjacent in
this user's manual order with `before` sorting before `after`, or the response is `400`. An id that
is missing or owned by someone else is `404`. The client never sends a raw `sortOrder`. When the
gap between two neighbors cannot be named in 64 characters, the response is `409` `CONFLICT`.

Audit rows are written for `task.completed` (only when the status changed; metadata
`{ "previousStatus": "<status>" }`), `task.reopened` (metadata `{}`), and `task.deleted`
(metadata `{}`). Creates and field edits are not audited. Metadata does not include the title,
notes, or the request body.

Schemas: `createTaskRequestSchema`, `updateTaskRequestSchema`, `repositionTaskRequestSchema`,
`listTasksQuerySchema`, `taskIdSchema`, `taskSchema`, `taskListSchema` in `@planit/shared`.
Response types: `Task` and `TaskList` in `@planit/types`.

Every task response includes `recurringTaskId: string | null`. A one-off task returns null.
`GET /tasks` does not materialize series. Completing a task whose `recurringTaskId` is set marks
that occurrence `COMPLETED` in the same transaction. An idempotent complete does not write a
second audit row. Reopening that task sets the occurrence back to `MATERIALIZED`. Deleting a
linked task that is still attached marks the occurrence `SKIPPED`, sets `taskId` null, and
deletes the task. Deleting a detached task leaves the occurrence row.

### Recurrence (Phase 3 Part 3)

The same session, ownership, and strict-body rules as one-off tasks. Another user's series id is
`404`. `userId` in a body is `400`. Responses do not include `userId`. Clients send a structured
rule, never a raw RRULE. The server stores one canonical RRULE and returns both the structured
fields and `recurrenceRule`. `timezone` is optional on create; when it is omitted the series uses
`users.timezone`. It is validated with `Intl.DateTimeFormat` (decision D-033). `WKST` is copied
from the owner's `weekStartsOn` at create time. A later change to that preference does not
rewrite existing rules. Editing the series refreshes `WKST` (decision D-041).

| Method | Path                                                 | Success                                                                    |
| ------ | ---------------------------------------------------- | -------------------------------------------------------------------------- |
| POST   | `/api/v1/recurring-tasks`                            | `201` and the series. Also materializes today through today plus 13 days.  |
| GET    | `/api/v1/recurring-tasks`                            | `{ "items", "nextCursor" }`. `createdAt` descending, then `id` descending. |
| GET    | `/api/v1/recurring-tasks/:id`                        | the series                                                                 |
| PATCH  | `/api/v1/recurring-tasks/:id`                        | the updated series. Does not rewrite tasks that already exist.             |
| DELETE | `/api/v1/recurring-tasks/:id`                        | `200` and the deleted series.                                              |
| POST   | `/api/v1/recurring-tasks/:id/stop`                   | `200` and the series. Body is `{}`.                                        |
| GET    | `/api/v1/recurring-tasks/:id/occurrences?from=&to=`  | `{ "items", "nextCursor": null }`. Materializes that inclusive range.      |
| POST   | `/api/v1/recurring-tasks/:id/occurrences/:date/skip` | `200` and the occurrence. Body is `{}`.                                    |
| PATCH  | `/api/v1/recurring-tasks/:id/occurrences/:date`      | `200` and the detached task.                                               |

`frequency` is `DAILY`, `WEEKDAYS`, `WEEKLY`, `MONTHLY`, or `CUSTOM`. `DAILY` and `WEEKDAYS` use
interval 1. `WEEKDAYS` is Monday–Friday; any days the client sends are ignored. `WEEKLY` uses
interval 1 and at least one `byDay` (`MO` `TU` `WE` `TH` `FR` `SA` `SU`). `MONTHLY` uses interval
1 and one `byMonthDay`, or omits it to use the day of `startDate`. A month that does not contain
that day is skipped. `CUSTOM` is daily with interval 2–99, weekly with interval 2–52 and at least
one `byDay`, or monthly with interval 2–12 and one `byMonthDay`. `endDate` is null or a date on
or after `startDate`, and it is inclusive in the series timezone. `defaultStartMinute` (0–1439)
may be set only when `estimatedMinutes` is set.

`from` after `to`, or an inclusive range longer than 62 days, is `400`. A disabled series returns
existing occurrence rows and creates nothing. A date the current rule does not produce is `400`
on skip and on edit-one. Skip of a date that is already `SKIPPED` returns that same row. Skip of
a completed or already detached occurrence is `409` and changes nothing. Edit-one materializes
the date when no row exists, applies the same field rules as `updateTaskRequestSchema`, then sets
that task's `recurringTaskId` to null and leaves the occurrence row.

Stop sets `enabled` false and `endDate` to the day before today in the series timezone. If that
day is before `startDate`, `endDate` stays `startDate`. Tasks already created are kept. Delete
removes linked tasks that are not `COMPLETED`, sets `recurringTaskId` null on linked `COMPLETED`
tasks, then deletes the series. Occurrence rows cascade.

Audit actions, with `targetType` `recurring_task` and metadata of ids and statuses only, are
`recurring_task.stopped`, `recurring_task.deleted`, `recurring_task.occurrence_skipped`, and
`recurring_task.occurrence_detached`. Materialization and ordinary series field edits are not
audited. Titles, notes, and the rule text are not logged.

Schemas: `createRecurringTaskRequestSchema`, `updateRecurringTaskRequestSchema`,
`listRecurringTasksQuerySchema`, `occurrenceRangeQuerySchema`, `recurringTaskSchema`,
`recurringTaskListSchema`, `taskOccurrenceSchema`, `taskOccurrenceListSchema` in `@planit/shared`.
Response types: `RecurringTask`, `RecurringTaskList`, `TaskOccurrence`, and `TaskOccurrenceList`
in `@planit/types`.

## Planned route groups

All are under `/api/v1`, authenticated unless noted, and owner-scoped.

| Group               | Phase | Highlights                                                                                                                      |
| ------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------- |
| `/auth`             | 2     | Implemented, including the Phase 2 security pass. Further providers, unlink, and email change are out of scope.                 |
| `/users/me`         | 2     | Implemented above. Further profile fields (username, bio, privacy) are Phase 8.                                                 |
| `/settings`         | 2+    | `weekStartsOn` and notification preferences. Theme is `PATCH /users/me/theme`.                                                  |
| `/focus`            | 4     | `POST start`, `POST :id/pause`, `POST :id/resume`, `POST :id/stop`, `POST :id/cancel`, `GET active`, `GET sessions` (cursor)    |
| `/calendar`         | 5     | `GET ?from=&to=&view=day                                                                                                        | week                         | month`: scheduled tasks, occurrences, focus history |
| `/statistics`       | 6     | `GET daily                                                                                                                      | weekly                       | monthly                                             | summary              | heatmap | records                      | streak` |
| `/goals`, `/skills` | 7     | CRUD, milestones, task links, skill assignment, skill time                                                                      |
| `/profiles`         | 8     | `GET :username` (assembled per viewer: anonymous, user, friend, owner, blocked), `GET me/preview?as=public                      | friend`, visibility settings |
| `/friends`          | 8     | search (privacy- and block-aware), requests, accept/decline, remove, block/unblock                                              |
| `/leaderboards`     | 8     | `GET ?scope=friends                                                                                                             | global&period=daily          | weekly                                              | monthly&metric=focus | streak  | tasks`→`{ top, me, nearby }` |
| `/notifications`    | 5+    | list (cursor), mark read                                                                                                        |
| `/ai`               | 9     | `POST chat` (streamed), `GET context/preview?scope=` (exactly what would be shared)                                             |
| `/ai/proposals`     | 9     | `POST` (validate+persist a proposal), `GET :id`, `POST :id/approve` (with `payloadHash` + `Idempotency-Key`), `POST :id/reject` |
| `/ai/usage`         | 12    | managed-AI usage and remaining allowance; BYOK records are informational                                                        |
| `/me/export`        | 13    | context export (Markdown, JSON, plain text), with no credentials                                                                |
