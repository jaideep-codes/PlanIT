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
- **Consequences:** no secret ever appears in URLs, browser history, referrers or logs.
