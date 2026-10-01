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

## 2. Authentication (⏳ Phase 2: design)

- **Passwords:** Argon2id (`argon2` package; OWASP baseline m=19 MiB, t=2, p=1, tuned on target
  hardware). Minimum 10 characters, checked against a breached-password list where feasible.
  Timing-equalised responses for unknown emails.
- **Mandatory email verification:** 6-digit OTP, 10-minute expiry, single use, at most 5 attempts
  per code, 60-second resend cooldown, at most 5 codes per email per hour. Stored as
  HMAC-SHA256(server pepper, code) and compared in constant time. Never logged. Unverified
  accounts can only reach the verification endpoints.
- **Password reset:** the same OTP mechanism (`PASSWORD_RESET` purpose), not URL tokens, so no
  secret ever appears in a URL. A successful reset revokes all sessions.
- **Sessions:** short-lived access token (JWT, 15 minutes, signed with a server-side key and
  containing only `sub`, `sid` and `exp`) plus an opaque 256-bit refresh token stored hashed in
  `AuthSession`. Refresh **rotates** the token; reuse of a rotated token revokes the entire
  family. Logout revokes the session. Users can list and revoke their sessions.
- **Cookies:** `HttpOnly; Secure; SameSite=Lax`. Access cookie `__Host-` prefixed with `Path=/`;
  refresh cookie scoped to `/api/v1/auth`. Tokens are never readable by JavaScript and never
  placed in URLs or localStorage.
- **Google OAuth:** authorization code flow with PKCE, `state` and `nonce`, handled by the API.
  The ID token is verified against Google's keys, and `email_verified` must be true. A Google
  identity links to an existing account only when that account's email is already verified, so
  an attacker cannot pre-register a victim's email.
- **Route protection:** `proxy.ts` redirects unauthenticated page loads to sign-in as a UX
  measure only. Every API route is guarded by the session guard; "public" routes are opt-in via
  an explicit decorator.

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
- ⏳ State-changing requests additionally require: `Content-Type: application/json` (rejects
  HTML form posts) and an `Origin` (or `Sec-Fetch-Site: same-origin`) that matches `WEB_ORIGINS`.
  Requests failing the check get 403.
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
  `X-Frame-Options: DENY`, `Referrer-Policy`, COOP `same-origin`, a restrictive
  `Permissions-Policy`, HSTS in production.
- ⏳ **Trusted Types** (`require-trusted-types-for 'script'`): introduced report-only before
  BYOK ships (Phase 11), then enforced once the framework and dependencies are verified
  compatible.
- React escapes output by default. `dangerouslySetInnerHTML` is allowed only for the
  constant theme bootstrap script. User content is never rendered as HTML; Markdown (AI
  responses) is rendered through a sanitizing renderer with raw HTML disabled.

## 6. Client IP and rate limiting

- ✅ Baseline global throttler guard (per IP, `RATE_LIMIT_MAX_REQUESTS` per
  `RATE_LIMIT_WINDOW_SECONDS`). Liveness is exempt.
- ⏳ Named stricter limits (Phase 2 onward), keyed by IP **and** by account or email where
  relevant: login, signup, OTP send/verify, password reset, Google callback, friend requests,
  user search, public profile reads, AI chat, proposal creation and proposal execution. Storage
  moves to Redis so limits hold across instances; if Redis is down, sensitive routes **fail
  closed** (reject) while ordinary routes fail open.
- ⚠️ **`TRUST_PROXY` defaults to `false`.** Next.js external rewrites do not appear to append
  `X-Forwarded-For` (checked in `next/dist/server/lib/router-utils/proxy-request.js`; not yet
  confirmed by an end-to-end test). With `trust proxy` enabled, a client-supplied header could
  pass through unmodified and let clients choose their own IP for rate limiting. Until Phase 2
  establishes a verified client-IP chain (for example the edge load balancer sets the header and
  the Next.js hop is accounted for, or the web tier sets a header the API trusts only from its
  own network), the API sees the proxy's IP. That makes per-IP limits coarse, but they cannot be
  spoofed. Account-keyed limits on auth routes do not depend on IP.
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
- Planned: a CI check that fails the build if a known secret pattern appears in client bundles
  or committed files (for example gitleaks).

## 8. Logging and error handling

- ✅ pino JSON logs. Request/response serializers log only `id`, `method`, path **without the
  query string**, and status, never headers or bodies.
- ✅ Redaction list (`apps/api/src/common/logging/pino-options.ts`) scrubs authorization,
  cookies, set-cookie, passwords, OTPs, tokens, API keys and secrets from any logged object.
  New credential-bearing field names must be added there.
- ✅ Redis and health-check failures log the error **message**, never the client or error
  object (which can contain connection URLs with credentials).
- ✅ Production error responses never include stack traces, SQL, provider errors or secrets.
- Never log: passwords, OTPs, BYOK keys, PlanIT-managed keys, refresh/access tokens, OAuth
  secrets or codes, AI prompts/responses (except in explicit, user-visible chat history).

## 9. Audit logging (⏳ Phase 2+)

Append-only `AuditLog` rows for: sign-up, login (success/failure), logout, session revocation,
refresh-token reuse detection, password and email changes, Google link/unlink, privacy and
visibility changes, bulk task mutations, AI proposal approval/execution/failure, BYOK mode
on/off (mode only, never the key), data export, and account deletion. Metadata is an allowlisted
structure, never raw request bodies, and never secrets.

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
