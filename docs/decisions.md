# Decision log

Architecture decision records, newest last. A decision changes only through a new entry that
supersedes it. Format: context → decision → consequences.

---

### D-001 Modular monolith

- **Context:** a small team building many interdependent domains (tasks, focus, statistics,
  social, AI) that share transactions and ownership rules.
- **Decision:** one NestJS API deployable plus one worker process from the same codebase. Domain
  modules communicate through exported services only.
- **Consequences:** simple transactions and deployments. Module boundaries are enforced by
  convention, review and ESLint rules (D-021), and can be split out later if needed.

### D-002 pnpm workspaces + Turborepo

- **Decision:** pnpm 9.15 workspaces (exact pins, `engine-strict`) and Turborepo 2 for task
  orchestration and caching. Root scripts delegate to Turbo.
- **Consequences:** pnpm 9 is not the newest major. It was chosen for stability with the current
  toolchain. Upgrading is a separate, isolated change.

### D-003 ESM everywhere

- **Decision:** every package is `"type": "module"`. The API uses `NodeNext` resolution with
  explicit `.js` import extensions. NestJS 12 is ESM-only, so this aligns with the framework.
- **Consequences:** decorator metadata in tests requires SWC (D-013).

### D-004 Node.js 24 LTS

- **Decision:** `engines.node >= 24.11.0`, `.nvmrc` 24. Upgraded from 22.14 because Prisma 7 and
  the Nest CLI require newer Node 22 minors, and 24 is the active LTS.

### D-005 TypeScript 6, strict

- **Decision:** shared bases in `@planit/config` with `strict`, `noUncheckedIndexedAccess`,
  `noImplicitOverride`, `noImplicitReturns` and `isolatedModules`. TypeScript 6 defaults
  `types` to `[]`, so packages opt into `node` types explicitly.

### D-006 ESLint 9 flat config with type-aware rules

- **Decision:** ESLint 9.39 (not 10) with typescript-eslint `recommendedTypeChecked` and
  `projectService`, plus Prettier. Next.js 16 uses the ESLint CLI with `eslint-config-next`.
- **Consequences:** ESLint 9 is the previous major. Several plugins in use did not yet declare
  ESLint 10 support when the project was set up. Upgrade when the plugin ecosystem allows.

### D-007 Prisma 7 with the `pg` driver adapter and a multi-file schema

- **Decision:** the `prisma-client` generator (ESM, output to `src/generated/prisma`,
  git-ignored), `@prisma/adapter-pg`, `prisma.config.ts` as the single source of the datasource
  URL, and schema files per domain in `prisma/schema/`. Constraints Prisma cannot express (CHECK,
  partial unique indexes) are hand-written in migration SQL.
- **Consequences:** never edit an applied migration. Constraints added by hand must be covered by
  tests in the phase that relies on them.

### D-008 UUIDv7 primary keys

- **Decision:** `@default(uuid(7))` on all primary keys.
- **Consequences:** IDs are unguessable enough to avoid enumeration (authorization still never
  relies on it) and time-ordered, so B-tree inserts stay efficient and cursors are stable.

### D-009 Database naming and time representation

- **Decision:** snake_case tables and columns via `@@map`/`@map`; `timestamptz(3)` for instants
  in UTC; user-local wall-clock times as minutes after midnight (`0..1439`) plus the user's IANA
  timezone; local dates as `date`.
- **Consequences:** daylight saving time and travel are handled by computing local boundaries
  from the timezone at read or aggregation time.

### D-010 Same-origin API through a Next.js rewrite

- **Decision:** browsers call `/api/*` on the web origin. Next.js rewrites to `API_INTERNAL_URL`.
- **Consequences:** first-party cookies, simple CSRF posture and `connect-src 'self'`. Costs an
  extra hop and requires explicit client-IP handling (D-016).

### D-011 Zod for runtime contracts

- **Decision:** request/response schemas live in `@planit/shared` and are used by both the API
  (`ZodValidationPipe`, strict objects) and the web app (response parsing in `apiGet`).
  Compile-time-only types live in `@planit/types`.

### D-012 Nonce-based CSP, accepting dynamic rendering

- **Context:** a strict CSP (`script-src 'nonce-…' 'strict-dynamic'`) is the strongest XSS
  mitigation for an app that will hold BYOK keys in browser memory. Nonces must be unique per
  response, so pages cannot be statically prerendered.
- **Decision:** `proxy.ts` generates a nonce for every document request. The root layout reads it,
  so all pages render dynamically.
- **Consequences:** no static optimisation or ISR for app pages, which is acceptable for an
  authenticated, personalised app. Marketing pages, if added, could live under a separate
  layout with a hash-based CSP. `style-src-attr 'unsafe-inline'` is allowed for style
  attributes. Trusted Types are planned before BYOK.

### D-013 Vitest everywhere, SWC for Nest

- **Decision:** Vitest for all unit tests (jsdom for UI), with `unplugin-swc` in the API to emit
  decorator metadata. API e2e tests use a separate Vitest config against real Postgres
  (`planit_test`) and Redis (DB 1), run serially.

### D-014 Custom theme store instead of `next-themes`

- **Decision:** a small external store (`apps/web/src/lib/theme`, `useSyncExternalStore`) plus a
  constant inline script carrying the CSP nonce, run before first paint.
- **Consequences:** full control over nonce handling and server-preference sync in Phase 2, one
  fewer dependency, and no flash of incorrect theme. The preference is stored in `localStorage`
  only as a UI cache, never as data.

### D-015 Redis fails open

- **Decision:** `enableOfflineQueue: false` and `maxRetriesPerRequest: 1`. Cache operations
  degrade to misses and no-ops. Readiness reports `degraded`, not failure, when only Redis is
  down.
- **Consequences:** an outage costs latency, not availability. Security-sensitive rate limits
  are the exception and fail closed (docs/security.md §6).

### D-016 `TRUST_PROXY` defaults to false

- **Context:** Next.js external rewrites do not appear to append `X-Forwarded-For`, so trusting
  the header would let clients pick the IP the API sees.
- **Decision:** `trust proxy` is off by default. Per-IP limits currently key on the proxy hop.
- **Consequences:** coarse but unspoofable IP limits. Phase 2 must design and test a verified
  client-IP chain before IP-keyed auth limits are relied on, and account-keyed limits cover auth.

### D-017 `@planit/ui` consumed as source; local Geist fonts

- **Decision:** the UI package ships TypeScript source, transpiled by Next.js
  (`transpilePackages`). Tailwind scans it via `@source`. Fonts come from the `geist` package
  and are self-hosted, with no runtime requests to font CDNs (simpler CSP, no third-party
  requests).

### D-018 In-memory throttler until Phase 2

- **Decision:** the global `@nestjs/throttler` guard uses its default in-memory storage in
  Phase 1. Phase 2 moves storage to Redis and adds named limits.
- **Consequences:** limits are per-instance until then. This is acceptable because nothing
  sensitive is exposed in Phase 1.

### D-019 Global leaderboard participation is opt-in

- **Decision:** `GLOBAL_LEADERBOARD` and `RANK` visibility default to PRIVATE. Users appear on
  global rankings only after opting in. Friends leaderboards default to FRIENDS.
- **Consequences:** privacy by default. Global boards may be sparse at launch.

### D-020 Inject `PinoLogger` and set the context explicitly

- **Context:** `@InjectPinoLogger()` providers depend on decorator evaluation order relative to
  `LoggerModule.forRootAsync`, which caused DI failures in e2e tests.
- **Decision:** classes inject `PinoLogger` and call `logger.setContext(ClassName.name)` in the
  constructor.

### D-021 Architecture boundaries in ESLint

- **Decision:** `no-restricted-imports` in `apps/api/eslint.config.js` forbids controllers and
  everything under `modules/ai/**` from importing the database layer, the generated Prisma
  client or `@prisma/*`.

### D-022 BullMQ is introduced with its first real job

- **Decision:** no queue infrastructure in Phase 1. BullMQ arrives in Phase 2 with email
  delivery and OTP cleanup, following `docs/background-jobs.md`.

### D-023 Email OTP for password reset (no URL tokens)

- **Decision:** password reset uses the same hashed, attempt-limited OTP mechanism as
  verification.
- **Consequences:** no secret ever appears in URLs, browser history, referrers or logs. The
  `PASSWORD_RESET` purpose exists in the schema; the reset flow is Phase 2 Part 2.

### D-024 Refresh tokens last 30 days

- **Context:** the access token lifetime is specified (15 minutes). The refresh lifetime was not.
- **Decision:** a refresh token expires 30 days after it is issued. Rotation starts a new 30-day
  window. Logout and reuse revocation end it sooner.
- **Consequences:** a browser that stays closed for a month must sign in again. Session list and
  revoke (Part 2) can shorten that further.

### D-025 Breached-password checks use HIBP k-anonymity and fail open

- **Decision:** `PasswordService` sends the first five characters of the SHA-1 of the password to
  `https://api.pwnedpasswords.com/range/{prefix}` with `Add-Padding: true`, and compares the
  suffix locally. The request times out after 1.5 seconds. If the service is unreachable, signup
  continues and the failure is logged without the password.
- **Consequences:** a real breach list is used when it is reachable. An outage does not take
  signup down, and no password or full hash leaves the API. There is no stand-in breach API.

### D-026 Queued email bodies are sealed with AES-256-GCM

- **Context:** the raw OTP must not sit in Redis or Postgres, but the worker has to send it.
- **Decision:** the API encrypts the email payload with `OTP_JOB_ENCRYPTION_KEY` before enqueue.
  The worker decrypts it in memory, sends it, and removes the job. Failed jobs age out after
  seven days and stay ciphertext. Completed jobs are removed immediately.
- **Consequences:** Redis never holds a plaintext code. Losing the job key makes queued mail
  unreadable, which is the intended failure.

### D-027 Auth limits fail closed; the global throttler fails open on Redis

- **Decision:** the global `@nestjs/throttler` guard stores counters in Redis and treats a Redis
  error as "allow". Signup, login, OTP verify, OTP resend, refresh, and logout use a separate
  limiter that returns 503 when Redis cannot answer. Keys are hashes of the email, account, or
  IP, not the raw value.
- **Consequences:** a Redis outage keeps ordinary traffic moving and stops credential endpoints.
  This replaces the in-memory storage in D-018.

### D-028 The refresh cookie is not `__Host-` prefixed

- **Context:** `__Host-` requires `Path=/` and no `Domain`. The refresh token must be sent only to
  `/api/v1/auth`.
- **Decision:** the access cookie is `__Host-planit_access` with `Path=/`. The refresh cookie is
  `planit_refresh` with `Path=/api/v1/auth`. Both are `HttpOnly`, `Secure`, and `SameSite=Lax`,
  including on `http://localhost`.
- **Consequences:** the refresh token is still unreadable to JavaScript and is not attached to
  ordinary API calls. Browsers accept `Secure` and `__Host-` on `http://localhost`.

### D-029 Client addresses are hashed with the OTP pepper

- **Context:** audit rows need a stable client identifier and must not store the raw IP. Adding
  another secret was unnecessary.
- **Decision:** `ipHash` is HMAC-SHA256(OTP pepper, `ip:` + address). The `ip:` prefix keeps it
  distinct from an OTP code hashed with the same pepper.
- **Consequences:** rotating the OTP pepper also changes future IP hashes. Old rows are not
  rewritten.

### D-030 The credential migration includes unused auth columns

- **Decision:** `20261001222857_auth_credentials` creates `oauth_accounts`, the
  `PASSWORD_RESET` OTP purpose, the `PASSWORD_RESET` session revoke reason, and the
  `USER | SYSTEM | AI_PROPOSAL` audit actor types. Google login, password reset, and the session
  list were not implemented in Part 1. Password reset and the session list are Part 2 and did not
  need a new migration.
- **Consequences:** Parts 2 and 3 can use these columns without editing an applied migration.
  Empty OAuth rows are not a feature.

### D-031 Signup passwords require four character classes

- **Context:** Part 1 required a 10-character minimum and a breach check. Composition rules were
  added afterward.
- **Decision:** a new password must include a lowercase letter, an uppercase letter, a number,
  and a symbol (a character that is neither a letter nor a number). Login accepts any password
  up to 200 characters and answers a mismatch with "Invalid email or password." It does not
  tell the person which signup rule failed.
- **Consequences:** the shared signup schema enforces the rule in the browser and the API. The
  breach check is unchanged. Password reset uses the same rule (decision D-032).

### D-032 Password reset does not reveal accounts, and a reset revokes every session

- **Context:** the `PASSWORD_RESET` OTP purpose and revoke reason already exist (D-023, D-030).
  A cooldown error that only happens for a real inbox would tell an attacker the email is
  registered.
- **Decision:** `POST /auth/password/forgot` returns `{ "status": "reset_requested" }` for every
  syntactically valid email when Redis allows the call. The 60-second and hourly limits are Redis
  counters keyed by the submitted email and are checked before the account lookup. The database
  OTP cooldown still applies, in silent mode, so a second code is not sent. The reset code is
  typed into the app and is never placed in a URL. The new password uses the signup composition
  rule and the breach check. Success sets `emailVerifiedAt` when it was null, because the code
  proved control of the inbox, then revokes every unrevoked session with reason `PASSWORD_RESET`.
  One `auth.password_reset` audit row records how many sessions were revoked. It does not store
  the email, the code, or the password. User-initiated session revoke keeps the existing `LOGOUT`
  reason, so Part 2 does not need a migration. Revoking every session except the current one is
  `POST /auth/sessions/revoke-others`, which cannot be confused with deleting the caller's own
  session.
- **Consequences:** an unknown address and a known address produce the same HTTP response. A
  Redis outage fails these routes closed. After a reset, every browser must sign in again.

### D-033 Theme is saved apart from the profile patch

- **Context:** `PATCH /users/me` had to stay limited to display name and timezone. The theme
  control already writes `localStorage` so the first paint is correct.
- **Decision:** `PATCH /users/me/theme` is the only writer of `UserPreference.theme`. The
  signed-in shell copies that value into `localStorage` unless the person has already changed the
  theme during the current page view. `localStorage` remains a cache, not the source of truth.
  Timezone values are checked with `Intl.DateTimeFormat`, not `Intl.supportedValuesOf('timeZone')`,
  because the Windows ICU list omits `UTC` and some canonical names such as `Asia/Kolkata`.

### D-034 Google sign-in is an authorization-code flow on the API

- **Context:** Google login must keep the client secret on the API, accept an identity only when
  Google says the email is verified, and must not attach Google to a PlanIT account that has not
  verified its own email (that row may have been created by someone else). `oauth_accounts`
  already exists (decision D-030).
- **Decision:** `GET /auth/google/start` and `GET /auth/google/callback` run on the API. Start
  stores a random `state`, PKCE verifier, and `nonce` in Redis for 10 minutes. The Redis key is a
  hash of the state. The browser also gets an `HttpOnly; Secure; SameSite=Lax` cookie,
  `planit_oauth_state`, holding that hash and scoped to `/api/v1/auth`, so a callback URL copied
  to another browser does not complete. The callback consumes the state once, exchanges the code
  with the verifier and client secret, and verifies the ID token against Google's JWKS (RS256,
  issuer, audience, nonce). Login continues only when `email_verified` is boolean true. An
  existing user is linked only when `emailVerifiedAt` is set. A new user is created with a null
  password hash and `emailVerifiedAt` set, because Google verified the address. The redirect URI
  is the web origin's `/api/v1/auth/google/callback`, so the session cookies stay first-party.
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` are all set or all empty.
  When they are empty, the button says Google sign-in is not configured and a navigation to start
  returns 503. There is no simulated Google login. Start and the callback are rate-limited per IP
  and fail closed if Redis is down. Audit rows record `auth.google_link_succeeded` or
  `auth.google_link_failed`. The metadata allowlist is decision D-035.
- **Consequences:** Part 3 does not add a migration. A Google-only account cannot use password
  login or password reset until a password exists (reset already refuses a null hash). An
  unverified password signup blocks Google for that email until the OTP is confirmed. An
  already-linked Google subject signs in as that user even when the email claim matches a
  different account. No OAuth token or authorization code is stored.

### D-035 Google audit metadata is a fixed allowlist

- **Context:** D-034 said Google audit rows record an outcome or reason only. The code also stores
  `provider: "google"` and, when Google sends `error`, a `providerError`.
- **Decision:** that metadata stays, and it is only these fields. Success rows are `provider` plus
  `outcome` (`created`, `linked`, or `signed_in`). Failure rows are `provider` plus `reason`
  (`invalid_state`, `denied`, `rejected`, `unverified_email`, `unverified_account`, or `inactive`).
  A denial may add `providerError` from `access_denied`, `invalid_request`, `unauthorized_client`,
  `server_error`, `temporarily_unavailable`, or `unknown`. Any other provider text, including
  `error_description`, is not stored. The authorization code, tokens, verifier, nonce, and client
  secret are not stored. This supersedes the "outcome or reason only" wording in D-034.
- **Consequences:** operators can tell a user denial from an invalid state without a secret landing
  in the audit log. Adding a field requires a new decision.

### D-036 Browser E2E runs through the web origin

- **Context:** auth cookies are first-party on the web origin because `/api/*` is rewritten. A
  browser test that called the API origin directly would not exercise that path.
- **Decision:** Playwright lives in `apps/web`. `pnpm run test:e2e` remains the API Vitest suite.
  `pnpm run test:browser` is the browser suite. Tests use `http://localhost:3000`, apply migrations
  to `planit_test`, and start the API, the email worker, and Next. The API and worker use Redis
  database 2 so they do not share auth rate limits or the email queue with API e2e (database 1).
  One-time codes are read from Mailpit and are not printed. Google environment variables are
  forced empty, so the suite covers the unconfigured button and the `google` query allowlist, not
  a simulated Google login. `PLAYWRIGHT_REUSE_SERVER=1` reuses ports 3000 and 4000 only when that
  stack is already running. `e2e/support/network-guards.ts` is where later phases attach task,
  focus, and BYOK request assertions (`docs/ai-security.md` layer E).
- **Consequences:** Phase 2 does not add those product tests. CI installs Chromium and uploads
  traces when the browser step fails. A failure trace can show a code that was typed into the
  form; the test runner does not print it.

### D-037 Rewritten API responses keep the API Referrer-Policy

- **Context:** the Google callback URL can contain the authorization code. The next request must
  not send that URL as Referer. `next.config.ts` sets `Referrer-Policy: strict-origin-when-cross-origin`
  on `/:path*`, which would keep the full URL on a same-origin follow-up.
- **Decision:** `/api/*` is an external rewrite. Next.js 16 returns that route before applying
  `headers()`, then copies the upstream response, so the API's `Referrer-Policy` is what the
  browser receives. Google start and callback set `no-referrer` on every response from those
  routes, including the unconfigured 503. Pages keep `strict-origin-when-cross-origin`. A browser
  test requests the callback through the web origin and asserts `no-referrer`. `TRUST_PROXY` stays
  `false`.
- **Consequences:** a later Next.js that starts applying config headers onto proxied responses
  would fail that test and must not replace `no-referrer` on `/api/*`.

### D-038 CI secret scan allowlist is only obvious fakes

- **Context:** Phase 2 was going to fail the build when a known secret pattern appears in
  committed files or the production web client bundle.
- **Decision:** `pnpm run scan:secrets` scans git-tracked files. CI also runs gitleaks 8.30.1 with
  `--redact`. After `pnpm build`, `pnpm run scan:secrets -- --require-bundle` scans
  `apps/web/.next/static` for `passwordHash`, pepper and signing-key names, `GOOGLE_CLIENT_SECRET`,
  `NEXT_PUBLIC_` secret names, JWT-like values, and the local database passwords. Tracked-file
  allowlist: the three `local-dev-*` keys in `apps/api/.env.example`, localhost Postgres and Redis
  URLs that use `planit_dev_password` or `planit_dev_redis`, and spec fixtures whose secret text
  is exactly `secret`, `secret-password`, `secret-redis`, or `google-secret`. `pnpm audit --prod`
  stays non-blocking. The workflow permission stays `contents: read`.
- **Consequences:** a real credential in a spec file is still a failure unless it is one of those
  exact fakes. Widening the allowlist needs a new decision.
