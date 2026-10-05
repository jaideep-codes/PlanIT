# Security architecture

> The backend is the security boundary. The authenticated user is the ownership boundary. AI,
> BYOK, MCP and future integrations never weaken either.

Status legend: ✅ implemented · 🟡 partially implemented · ⏳ planned (phase).

## 1. Trust boundaries

| Boundary                 | Trusted side                       | Untrusted input                                                                                   |
| ------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| Browser → web origin     | Next.js server                     | everything from the browser, including cookies' presence (authorization is API-side)              |
| Next.js server → API     | API                                | all forwarded requests; the API re-authenticates every call                                       |
| API → PostgreSQL / Redis | API (credentials server-side only) | Redis contents are treated as possibly stale (schema-validated on read)                           |
| API → LLM provider       | API                                | model output is untrusted until Zod-validated and user-approved                                   |
| Browser → BYOK provider  | n/a (user's own account)           | model output is untrusted; proposals still go through API validation                              |
| Stored user content      | none                               | task titles, notes, bios, goal text and skill names are untrusted data (XSS and prompt injection) |

## 2. Authentication (✅ Phase 2)

- ✅ **Passwords:** Argon2id (`argon2` package; memory 19 MiB, time 2, parallelism 1). Minimum 10
  characters. Signup also requires a lowercase letter, an uppercase letter, a number, and a
  symbol (decision D-031). Login does not describe those rules. A wrong password, including one
  that would fail signup, returns the same invalid-credentials message.
  Have I Been Pwned k-anonymity rejects breached passwords and fails open when the service is
  unreachable (decision D-025). Login and signup for an unknown email are timing-equalised and
  do not reveal whether the account exists.
- ✅ **Mandatory email verification:** 6-digit OTP, 10-minute expiry, single use, at most 5
  attempts per code, 60-second resend cooldown, at most 5 codes per email per hour. Stored as
  HMAC-SHA256(server pepper, code) and compared in constant time. Never logged. An unverified
  account can reach only the verification and resend endpoints.
- ✅ **Password reset:** the same OTP mechanism (`PASSWORD_RESET`), not URL tokens. Unknown
  emails get the same acknowledgement as known emails. A successful reset revokes every session.
- ✅ **Sessions:** access token is a 15-minute JWT containing only `sub`, `sid` and `exp`. The
  refresh token is an opaque 256-bit value stored as a SHA-256 hash, with a 30-day lifetime
  (decision D-024). Login opens a new family and leaves other sessions alone. Refresh rotates
  inside a transaction; reuse of a rotated token revokes the family. Logout revokes that session.
- ✅ **Session list and revoke:** the owner can list live sessions, revoke one, or revoke every
  session except the current one. A session id belonging to someone else is 404.
- ✅ **Cookies:** `HttpOnly; Secure; SameSite=Lax`, including on `http://localhost`. Access cookie
  `__Host-planit_access` with `Path=/`. Refresh cookie `planit_refresh` with `Path=/api/v1/auth`
  (decision D-028). Tokens are never readable by JavaScript and never placed in URLs or
  localStorage.
- ✅ **Google OAuth:** authorization code flow with PKCE, `state`, and `nonce`, handled by the API
  (`GET /auth/google/start`, `GET /auth/google/callback`). The ID token is verified against
  Google's keys. Login is accepted only when `email_verified` is boolean true. An existing
  PlanIT user is linked only when that user's email is already verified. A Google-only account
  has a null `passwordHash`. The client secret stays in the API environment. When those
  variables are empty, the button says Google sign-in is not configured and start returns 503.
  The callback is rate-limited. Success and failure are audited with the allowlist in decision
  D-035 (provider, outcome or reason, and on denial an optional provider error). The code, tokens,
  verifier, nonce, and client secret are not stored (decision D-034). The `oauth_accounts` table
  comes from the credential migration (D-030). There is no Google unlink.
- ✅ **Route protection:** `proxy.ts` sends unauthenticated app-shell visits to the login page as
  a UX measure only. Every API route is guarded by the session guard; public routes opt out with
  `@Public()`. Health stays public.

## 3. Authorization and data isolation

- Every service method on user-owned data takes `authenticatedUserId` as its first argument,
  supplied by the session guard and never by the request body, path or an AI model.
- Repositories always include `userId` in the `WHERE` clause (`findFirst({ where: { id,
userId } })`). A resource ID alone never grants access. Cross-user access returns 404.
- Relations across owners are impossible by construction: link tables (goal↔task,
  task↔skill) check that both sides share the same owner.
- Mass assignment: request schemas are strict and do not include ownership or server-managed
  fields (`userId`, `status` transitions, `completedAt`, timestamps).
- Entitlements are checked through `EntitlementService.can(user, capability)`, never with ad-hoc
  plan comparisons.
- Privacy filtering of profiles happens server-side: responses are built from an allowlist of
  permitted fields (`docs/privacy.md`).

## 4. CSRF, CORS and origin policy

- Browsers reach the API through the web origin (same-origin), with `SameSite=Lax` cookies.
- ✅ State-changing requests require `Content-Type: application/json` (a charset parameter is
  allowed) and an `Origin` in `WEB_ORIGINS`. When `Origin` is absent, `Sec-Fetch-Site: same-origin`
  is accepted. Failure is 403. The check runs before the body parser.
- ✅ CORS: explicit origin allowlist with credentials. No wildcard. Allowed headers are limited.

## 5. HTTP hardening

- ✅ **API:** helmet with `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`,
  `X-Content-Type-Options`, `Referrer-Policy`, HSTS (helmet default), CORP `same-site`; no
  `X-Powered-By`; `Cache-Control: no-store` on every response; 256 KB JSON body limit.
- ✅ **Web:** per-request nonce CSP from `proxy.ts` (`apps/web/src/lib/security/csp.ts`):
  `script-src 'self' 'nonce-…' 'strict-dynamic'` (plus `'unsafe-eval'` in development only),
  nonce-based `style-src` in production, `style-src-attr 'unsafe-inline'` (server-rendered style
  attributes; they cannot load resources), `connect-src 'self'`, `object-src 'none'`,
  `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`,
  `upgrade-insecure-requests` in production. Static headers in `next.config.ts`: `nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, COOP `same-origin`,
  a restrictive `Permissions-Policy`, HSTS in production. `/api/*` is an external rewrite, so
  those page headers are not attached to proxied responses. The browser receives the API's
  headers. Google start and callback set `Referrer-Policy: no-referrer`, including when Google is
  not configured, so an authorization code in the callback URL is not sent as Referer (decision
  D-037).
- ⏳ **Trusted Types** (`require-trusted-types-for 'script'`): introduced report-only before
  BYOK ships (Phase 11), then enforced once the framework and dependencies are verified
  compatible.
- React escapes output by default. `dangerouslySetInnerHTML` is allowed only for the
  constant theme bootstrap script. User content is never rendered as HTML; Markdown (AI
  responses) is rendered through a sanitizing renderer with raw HTML disabled.

## 6. Client IP and rate limiting

- ✅ Baseline global throttler guard (per IP, `RATE_LIMIT_MAX_REQUESTS` per
  `RATE_LIMIT_WINDOW_SECONDS`), stored in Redis and failing open if Redis is down (decision D-027).
  Liveness is exempt.
- ✅ Named limits on signup, login, OTP verify, OTP resend, refresh, logout, password forgot,
  and password reset, keyed by email or account as well as IP. Redis keys are hashes, so the
  address or token is not stored raw. If Redis is down, these routes fail closed (503). The
  forgot-password cooldown is one of those Redis limits and is applied before the account
  lookup, so a 429 does not reveal whether the email exists. Google start and the Google
  callback have per-IP limits and fail closed the same way. Friend requests, search, profiles,
  and AI routes get their limits when those features are built.
- ⚠️ **`TRUST_PROXY` stays `false`.** Next.js external rewrites do not appear to append
  `X-Forwarded-For`. With `trust proxy` enabled, a client-supplied header could pass through
  unmodified and let clients choose their own IP. The API therefore sees the connecting hop,
  which on the local rewrite is the web server. Per-IP limits are coarse and cannot be spoofed.
  Email- and account-keyed auth limits do not depend on that IP. A verified client-IP chain is
  still future work.
- AI usage limits (product quotas) are separate from security rate limits (`docs/ai-architecture.md`).

## 7. Secrets management

- Secrets come from environment variables injected by the deployment platform's secret
  manager. `.env` files are for local development only and are git-ignored; only `*.example`
  files are committed, with development placeholders.
- ✅ The API validates its environment at boot; error messages name variables and rules but
  never echo values.
- Only `NEXT_PUBLIC_*` variables reach the browser bundle. No secret may use that prefix. The
  PlanIT-managed AI key, OAuth client secret, JWT signing keys, OTP pepper and database
  credentials exist only in the API's environment.
- ✅ CI fails the build when a known secret pattern appears in tracked files (gitleaks and
  `pnpm run scan:secrets`) or in the production web client bundle after `pnpm build`
  (`--require-bundle`). The allowlist is the local-dev placeholders and a short list of obvious
  spec fixtures (decision D-038).

## 8. Logging and error handling

- ✅ pino JSON logs. Request/response serializers log only `id`, `method`, path **without the
  query string**, and status, never headers or bodies.
- ✅ Redaction list (`apps/api/src/common/logging/pino-options.ts`) scrubs authorization,
  cookies, set-cookie, passwords, OTPs, tokens, API keys and secrets from any logged object.
  OAuth values are included under `codeVerifier`, `code_verifier`, `verifier` (the Redis field),
  `state`, and `error_description`. New credential-bearing field names must be added there.
- ✅ Redis and health-check failures log the error **message**, never the client or error
  object (which can contain connection URLs with credentials).
- ✅ Production error responses never include stack traces, SQL, provider errors or secrets.
- Never log: passwords, OTPs, BYOK keys, PlanIT-managed keys, refresh/access tokens, OAuth
  secrets or codes, AI prompts/responses (except in explicit, user-visible chat history).

## 9. Audit logging (🟡 Phase 2+)

Append-only `AuditLog` rows. A database trigger rejects `UPDATE` and `DELETE`. Recorded actions
are `auth.signup`, `auth.login_succeeded`, `auth.login_failed`, `auth.logout`,
`auth.refresh_reuse`, `auth.password_reset_requested`, `auth.password_reset`,
`auth.session_revoked`, `auth.sessions_revoked`, `auth.google_link_succeeded`,
`auth.google_link_failed`, `task.completed`, `task.reopened`, and `task.deleted`.
`task.completed` is written only when the status changes, with metadata `{ previousStatus }`.
The reopen and delete rows use metadata `{}`. Task creates and field edits are not audited, and
task metadata never includes the title, notes, or request body (decision D-039). The client address is stored as `ipHash`
(HMAC-SHA256 of the OTP pepper and an `ip:` prefix, decision D-029), never the raw IP, and never
a secret. Password-reset and Google rows do not store the email, the code, tokens, the
authorization code, the verifier, or the client secret. Google metadata is the allowlist in
decision D-035. Still to record when their features ship: email changes, Google unlink,
privacy and visibility changes, bulk task mutations, AI proposal approval/execution/failure,
BYOK mode on/off (mode only, never the key), data export, and account deletion. Metadata is an
allowlisted structure, never raw request bodies.

## 10. Dependency and supply-chain hygiene

- Exact version pins (`save-exact`), a committed lockfile, `pnpm install --frozen-lockfile` in CI.
- `pnpm audit --prod` in CI (initially non-blocking; blocking for high/critical before launch).
- Minimal third-party browser scripts: none today. Any addition requires a security review and a
  CSP change in `csp.ts`.

## 11. Threat checklist

| Threat                           | Primary controls                                                                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IDOR / ownership bypass          | owner-scoped repositories, 404 on cross-user access, integration tests for every resource                                                                               |
| Mass assignment                  | strict Zod request schemas; server-managed fields never accepted                                                                                                        |
| Privilege escalation             | entitlement service; no role/plan fields writable by users                                                                                                              |
| SQL injection                    | Prisma parameterised queries; `$queryRaw` only with tagged templates; `$queryRawUnsafe` forbidden                                                                       |
| XSS                              | React escaping, nonce CSP + `strict-dynamic`, no HTML rendering of user content, sanitized Markdown                                                                     |
| CSRF                             | same-origin architecture, SameSite=Lax, JSON-only, Origin verification                                                                                                  |
| SSRF                             | the API makes outbound calls only to fixed, configured hosts (LLM provider, Google, email provider); no user-supplied URLs are fetched; AI tools have no network access |
| Auth bypass                      | global session guard (opt-out, not opt-in), verified-email requirement, token rotation and reuse detection                                                              |
| Brute force                      | Argon2id, OTP attempt limits, per-account and per-IP limits, uniform error messages                                                                                     |
| Prompt injection / AI tool abuse | `docs/ai-security.md`                                                                                                                                                   |
| Secret leakage                   | server-only secrets, log redaction, generic errors, no secrets in AI context or tool output                                                                             |
