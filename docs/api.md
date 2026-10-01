# API

> Implemented: `GET /api/health`, `GET /api/health/ready`, the global conventions below.
> Route groups for later phases are listed as **planned**.

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

## Planned route groups

All are under `/api/v1`, authenticated unless noted, and owner-scoped.

| Group               | Phase | Highlights                                                                                                                                                                                                                                                                      |
| ------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/auth`             | 2     | `POST signup`, `POST otp/verify`, `POST otp/resend`, `POST login`, `POST refresh`, `POST logout`, `GET google/start`, `GET google/callback`, `POST password/forgot`, `POST password/reset`, `GET sessions`, `DELETE sessions/:id`. Public routes have strict named rate limits. |
| `/users/me`         | 2     | current user (safe projection, never `passwordHash`), update profile basics, timezone                                                                                                                                                                                           |
| `/settings`         | 2+    | preferences (`theme`, `weekStartsOn`, …), notification preferences                                                                                                                                                                                                              |
| `/tasks`            | 3     | CRUD, `POST :id/complete`, `POST :id/reopen`, `PATCH :id/position` (fractional index), filters: `status`, `priority`, `due`, `scheduledFrom/To`                                                                                                                                 |
| `/recurring-tasks`  | 3     | CRUD series, `POST :id/occurrences/:date/skip`, `PATCH …/occurrences/:date`, `POST :id/stop`                                                                                                                                                                                    |
| `/focus`            | 4     | `POST start`, `POST :id/pause`, `POST :id/resume`, `POST :id/stop`, `POST :id/cancel`, `GET active`, `GET sessions` (cursor)                                                                                                                                                    |
| `/calendar`         | 5     | `GET ?from=&to=&view=day                                                                                                                                                                                                                                                        | week                         | month`: scheduled tasks, occurrences, focus history |
| `/statistics`       | 6     | `GET daily                                                                                                                                                                                                                                                                      | weekly                       | monthly                                             | summary              | heatmap | records                      | streak` |
| `/goals`, `/skills` | 7     | CRUD, milestones, task links, skill assignment, skill time                                                                                                                                                                                                                      |
| `/profiles`         | 8     | `GET :username` (assembled per viewer: anonymous, user, friend, owner, blocked), `GET me/preview?as=public                                                                                                                                                                      | friend`, visibility settings |
| `/friends`          | 8     | search (privacy- and block-aware), requests, accept/decline, remove, block/unblock                                                                                                                                                                                              |
| `/leaderboards`     | 8     | `GET ?scope=friends                                                                                                                                                                                                                                                             | global&period=daily          | weekly                                              | monthly&metric=focus | streak  | tasks`→`{ top, me, nearby }` |
| `/notifications`    | 5+    | list (cursor), mark read                                                                                                                                                                                                                                                        |
| `/ai`               | 9     | `POST chat` (streamed), `GET context/preview?scope=` (exactly what would be shared)                                                                                                                                                                                             |
| `/ai/proposals`     | 9     | `POST` (validate+persist a proposal), `GET :id`, `POST :id/approve` (with `payloadHash` + `Idempotency-Key`), `POST :id/reject`                                                                                                                                                 |
| `/ai/usage`         | 12    | managed-AI usage and remaining allowance; BYOK records are informational                                                                                                                                                                                                        |
| `/me/export`        | 13    | context export (Markdown, JSON, plain text), with no credentials                                                                                                                                                                                                                |
