# API

> Implemented: health checks, Phase 2 Part 1 auth, Part 2 account routes, and Google sign-in.
> Remaining route groups are listed as **planned**.

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

`GET /api/v1/users/me` returns `id`, `email`, `displayName`, `timezone`, `emailVerifiedAt`,
`theme`, and `createdAt`. It never returns `passwordHash`. Session items are `id`, `createdAt`,
`lastUsedAt`, `expiresAt`, `userAgent`, and `current`. They never include a token or token hash.

Forgot-password limits: one request per email per 60 seconds, and five per email per hour, plus
coarser per-IP limits. Both are Redis counters checked before the account lookup (decision D-032).
The reset route uses the same OTP expiry, five-attempt lock, and hourly cap as verification.
Redis failures on these routes are `503`.

Schemas: `passwordForgotRequestSchema`, `passwordResetRequestSchema`, `sessionIdSchema`,
`authSessionListSchema`, `sessionRevocationSchema`, `updateCurrentUserRequestSchema`,
`updateThemeRequestSchema`, `currentUserSchema`, `googleCallbackQuerySchema`,
`googleSignInAvailabilitySchema` in `@planit/shared`.

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

## Planned route groups

All are under `/api/v1`, authenticated unless noted, and owner-scoped.

| Group               | Phase | Highlights                                                                                                                                      |
| ------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `/auth`             | 2     | Implemented, including the Phase 2 security pass. Further providers, unlink, and email change are out of scope.                                 |
| `/users/me`         | 2     | Implemented above. Further profile fields (username, bio, privacy) are Phase 8.                                                                 |
| `/settings`         | 2+    | `weekStartsOn` and notification preferences. Theme is `PATCH /users/me/theme`.                                                                  |
| `/tasks`            | 3     | CRUD, `POST :id/complete`, `POST :id/reopen`, `PATCH :id/position` (fractional index), filters: `status`, `priority`, `due`, `scheduledFrom/To` |
| `/recurring-tasks`  | 3     | CRUD series, `POST :id/occurrences/:date/skip`, `PATCH …/occurrences/:date`, `POST :id/stop`                                                    |
| `/focus`            | 4     | `POST start`, `POST :id/pause`, `POST :id/resume`, `POST :id/stop`, `POST :id/cancel`, `GET active`, `GET sessions` (cursor)                    |
| `/calendar`         | 5     | `GET ?from=&to=&view=day                                                                                                                        | week                         | month`: scheduled tasks, occurrences, focus history |
| `/statistics`       | 6     | `GET daily                                                                                                                                      | weekly                       | monthly                                             | summary              | heatmap | records                      | streak` |
| `/goals`, `/skills` | 7     | CRUD, milestones, task links, skill assignment, skill time                                                                                      |
| `/profiles`         | 8     | `GET :username` (assembled per viewer: anonymous, user, friend, owner, blocked), `GET me/preview?as=public                                      | friend`, visibility settings |
| `/friends`          | 8     | search (privacy- and block-aware), requests, accept/decline, remove, block/unblock                                                              |
| `/leaderboards`     | 8     | `GET ?scope=friends                                                                                                                             | global&period=daily          | weekly                                              | monthly&metric=focus | streak  | tasks`→`{ top, me, nearby }` |
| `/notifications`    | 5+    | list (cursor), mark read                                                                                                                        |
| `/ai`               | 9     | `POST chat` (streamed), `GET context/preview?scope=` (exactly what would be shared)                                                             |
| `/ai/proposals`     | 9     | `POST` (validate+persist a proposal), `GET :id`, `POST :id/approve` (with `payloadHash` + `Idempotency-Key`), `POST :id/reject`                 |
| `/ai/usage`         | 12    | managed-AI usage and remaining allowance; BYOK records are informational                                                                        |
| `/me/export`        | 13    | context export (Markdown, JSON, plain text), with no credentials                                                                                |
