# PlanIT architecture

> Status: Phase 0/1 foundation implemented. Sections marked **(planned)** describe designs that
> later phases implement; they are binding unless changed through `docs/decisions.md`.

PlanIT turns goals into scheduled work and measures whether you actually followed through:

```
GOAL → PLAN → SCHEDULE → EXECUTE → FOCUS → MEASURE → IMPROVE → RE-PLAN
```

## 1. Principles that shape the architecture

| Principle                                              | Architectural consequence                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Tasks are planned work; focus sessions are actual work | Separate `Task` and `FocusSession` models; statistics derive only from focus sessions.            |
| Raw events are the source of truth                     | Aggregate tables are rebuildable caches; Redis is never authoritative.                            |
| The authenticated backend is the authority             | Every read/write is owner-scoped in a service using the server-side session's user ID.            |
| The user is the authority over changes to their data   | AI produces proposals; only an explicit, exact approval executes them.                            |
| AI is an assistant, not an authority                   | The AI layer has no database access; it calls an allowlisted tool layer over domain services.     |
| BYOK never weakens security                            | BYOK swaps only the inference provider. Authorization, validation and confirmation are unchanged. |

## 2. System context

```
                       Browser (Next.js web app / PWA)
                          │ same-origin HTTPS only
                          ▼
                 Next.js server  ── /api/* rewrite ──►  PlanIT API (NestJS)
                 (SSR, CSP nonce,                         │
                  route guard)              ┌─────────────┼───────────────┐
                                            ▼             ▼               ▼
                                       PostgreSQL       Redis        LLM providers
                                    (source of truth) (cache, rate   (PlanIT-managed,
                                                       limits, queues) server-side key)
                                                          │
                                                   BullMQ workers (email, maintenance)

   BYOK mode (Phase 11): Browser ──► AI provider directly with the user's in-memory key.
   The key never reaches the Next.js server or the API.
```

### Why the browser only talks to the web origin

The web app rewrites `/api/*` to the API (`apps/web/next.config.ts`). Consequences:

- Auth cookies are first-party to the web origin, so `proxy.ts` can see them for route
  protection and no cross-site cookie configuration is needed.
- CORS on the API is a defence-in-depth allowlist, not the primary boundary.
- `connect-src 'self'` in the CSP covers all PlanIT traffic. BYOK provider origins are the only
  planned additions.
- Trade-off: one extra hop, and client IP propagation needs explicit design (see
  `docs/security.md`, "Client IP and rate limiting").

## 3. Repository layout

```
apps/
  api/                 NestJS 12 modular monolith (ESM)
    prisma/            multi-file schema (prisma/schema/*.prisma) + migrations
    src/
      bootstrap/       HTTP stack configuration shared by main.ts and e2e tests
      common/          cross-cutting: errors, logging, validation
      config/          environment schema and ConfigModule
      infrastructure/  database (Prisma), redis (connection + cache)
      modules/         domain modules (health today; auth, tasks, … per phase)
      generated/       Prisma client (generated, git-ignored)
    test/              e2e tests against real Postgres/Redis
  web/                 Next.js 16 App Router (Turbopack), Tailwind CSS 4
    e2e/               Playwright browser tests against the web origin
    src/
      app/             routes; (app)/ group holds the authenticated shell
      components/      feature and shell components
      lib/             api client, query client, theme, security (CSP)
      proxy.ts         per-request CSP nonce; UX redirect to login when the access cookie is absent
packages/
  types/               compile-time API contracts (no runtime code)
  shared/              runtime code shared by web and API: error codes, Zod schemas
  ui/                  design tokens + accessible base components (consumed as source)
  config/              shared tsconfig bases and ESLint flat configs
docs/                  this documentation
docker/                local service bootstrap (Postgres init scripts)
```

Dependency direction: `apps/*` → `packages/{ui,shared}` → `packages/types`; everything may use
`packages/config` at build/lint time. Packages never import from apps.

## 4. Backend: modular monolith

One deployable API process plus a worker process from the same codebase (`apps/api/src/worker.ts`).
No microservices.

### Layering inside a domain module

```
modules/<domain>/
  <domain>.module.ts        Nest wiring; exports only the service
  <domain>.controller.ts    transport: routing, auth guard, Zod validation pipe, status codes
  <domain>.service.ts       business rules, ownership checks, transactions
  <domain>.repository.ts    persistence via PrismaService; every query takes ownerId
  *.spec.ts                 unit tests next to the code
```

Rules (enforced by review; the first two also by ESLint in `apps/api/eslint.config.js`):

1. Controllers never import the database layer.
2. `modules/ai/**` never imports the database layer or the Prisma client.
3. Modules call other modules only through their exported **service**, never their repository.
4. Services receive `authenticatedUserId` as an explicit first parameter
   (`tasks.update(userId, taskId, changes)`); repositories filter by it in the `WHERE` clause.
5. Request/response schemas are Zod schemas in `@planit/shared` so web and API share them.

`RecurringTasksModule` imports `TasksModule`. `TasksModule` does not import
`RecurringTasksModule`. The maintenance worker dispatches by job name (`delete-expired-otps` and
`recurrence-materialize`).

### Module map

| Module                      | Phase | Responsibility                                                                                                                               |
| --------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Health                      | 1 ✅  | liveness/readiness                                                                                                                           |
| Auth                        | 2 ✅  | Signup, OTP, login, logout, password reset, rotating sessions, session revoke, Google sign-in                                                |
| Users / Profile / Privacy   | 2, 8  | current user (display name, timezone, theme). Public profiles remain                                                                         |
| Audit                       | 2 🟡  | append-only log; signup, login, logout, refresh reuse, password reset, session revoke, Google                                                |
| Entitlements                | 2 🟡  | reads `UserPlan`; `can(userId, 'pro')` is false on FREE. No Pro features                                                                     |
| Tasks                       | 3 🟡  | one-off tasks: owner-scoped CRUD, completion, filters, sort, and manual order. Complete, reopen, and delete keep a linked occurrence in step |
| Recurring tasks             | 3 🟡  | recurrence engine: series CRUD, materialization, skip, detach, and stop. The Home series UI has not started                                  |
| Focus                       | 4     | server-authoritative focus sessions                                                                                                          |
| Calendar                    | 5     | read model over scheduled tasks, occurrences and focus history                                                                               |
| Statistics                  | 6     | aggregates, records, streaks, heatmap                                                                                                        |
| Goals / Skills              | 7     | goals, milestones, task links, skills, skill time                                                                                            |
| Friends / Leaderboards      | 8     | friend graph, blocking, privacy-aware rankings                                                                                               |
| Notifications               | 5+    | in-app notifications and preferences                                                                                                         |
| AI / AIUsage / Entitlements | 9–12  | assistant, proposals, usage limits, plan entitlements                                                                                        |

### HTTP stack (implemented)

`apps/api/src/bootstrap/configure-app.ts`, in order: pino logger with request IDs → `trust proxy`
→ helmet (API CSP `default-src 'none'`) → `Cache-Control: no-store` → CORS allowlist → mutation
guard (state-changing requests need `Content-Type: application/json` and an allowed `Origin`) →
JSON body parser (256 KB limit) → global prefix `/api` + URI versioning (`/api/v1/...`; health is
version neutral). Global guards: Redis throttler (fails open) and session guard (public routes
opt out). The exception filter writes the uniform error envelope.

## 5. Frontend

- **Rendering:** App Router. All pages render dynamically because the root layout reads the
  per-request CSP nonce. This is a deliberate trade-off: strict CSP matters more than static
  optimisation for an authenticated app (see decision D-012).
- **Server state:** TanStack Query; the API remains the source of truth. Zustand will be adopted
  only for real client-only state (for example the focus timer display and the BYOK credential
  holder UI state), never as a mirror of server data.
- **Forms:** React Hook Form + Zod schemas from `@planit/shared`. Auth forms cover sign up,
  verify, log in, log out, forgot password, and reset password. Settings edits the profile.
- **UI system:** `@planit/ui` provides semantic design tokens (light/dark) and shadcn-style
  components built on Radix primitives. Components reference semantic tokens only.
- **Theme:** light, dark, system. An inline nonce-bearing script applies the theme before first
  paint from `localStorage`. Signup stores `UserPreference.theme` as `SYSTEM`. The theme control
  saves that row, and the signed-in shell copies it back into `localStorage` for the next first
  paint.
- **Navigation:** Home, Statistics, Calendar, Leaderboard, Profile, Settings, plus the
  "Ask PlanIT" entry point. Desktop: sidebar. Mobile: bottom tab bar plus header.
- **PWA:** web manifest now; service worker and offline strategy are planned (Phase 5) and must
  never cache API responses containing private data.

## 6. Data and consistency

- PostgreSQL is the source of truth. All timestamps are `timestamptz` in UTC; user-local
  concepts (day boundaries, recurrence, focus windows) are computed using the user's IANA
  timezone. See `docs/database-schema.md`.
- Invariants are enforced in the database where practical (unique keys, CHECK constraints,
  partial unique indexes such as "one open focus session per user"), not only in code.
- Multi-row changes run in a transaction. AI proposal execution is atomic and idempotent
  (`docs/ai-architecture.md` §6).
- Redis holds caches, rate-limit counters and job queues only. Losing Redis loses no data
  (`docs/caching.md`).

## 7. Cross-cutting concerns

| Concern        | Where                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------- |
| Configuration  | `apps/api/src/config/env.ts` (Zod-validated at boot; values never echoed)                    |
| Logging        | `apps/api/src/common/logging` (pino JSON; redaction; request ID propagation)                 |
| Errors         | `apps/api/src/common/errors` (single envelope; only `AppException` messages reach users)     |
| Validation     | `apps/api/src/common/validation/zod-validation.pipe.ts` (strict objects reject unknown keys) |
| Security       | `docs/security.md`                                                                           |
| AI             | `docs/ai-architecture.md`, `docs/ai-security.md`                                             |
| Caching / jobs | `docs/caching.md`, `docs/background-jobs.md`                                                 |
| Privacy        | `docs/privacy.md`                                                                            |

## 8. Observability

Implemented: structured JSON logs (pretty in development), `x-request-id` accepted (validated)
or generated and echoed on every response and in error bodies, log level by status class,
liveness `GET /api/health`, readiness `GET /api/health/ready` (database required, Redis optional
→ `degraded`).

Planned: Prometheus-style metrics (request latency/error rate, job failures, AI failures and
latency, cache errors, auth failures) and error tracking with a scrubbing `beforeSend` hook. Error
tracking must never receive request bodies, cookies, authorization headers or BYOK material.

## 9. Operations: backup and disaster recovery (planned before production)

Production PostgreSQL must run on a managed service, or on equivalent infrastructure, that
provides:

- automated daily snapshots plus continuous WAL archiving for point-in-time recovery (PITR);
- backups stored in a separate failure domain (different region or account) and encrypted at
  rest and in transit;
- retention of at least 14 days of PITR and 35 days of daily snapshots at launch (revisit with
  legal/privacy requirements and the account-deletion policy in `docs/privacy.md`).

**Recovery objectives at launch:** RPO ≤ 5 minutes (PITR), RTO ≤ 4 hours. These are tightened as
the product matures.

**Restore drills:** a full restore into an isolated environment at least quarterly and after
any major schema migration. The drill passes only if the API boots against the restored database,
`prisma migrate status` is clean, and a scripted smoke test passes (row counts for core tables,
a sample user's tasks and focus sessions readable). A backup that has not been restored is not
considered valid.

**Contents:** backups contain only database data. Raw BYOK keys never enter the database and
therefore never enter backups. PlanIT-managed credentials live in the platform secret manager,
not in the database.

**Redis** is not backed up for recovery purposes. Caches rebuild, and queued jobs must be
idempotent and re-derivable from database state (`docs/background-jobs.md`).

## 10. Future clients and integrations

The API is API-first and client-agnostic. Future mobile apps, an MCP server (Phase 14) and
messaging integrations (Phase 15+) must call the same application services through the same
authentication, authorization, proposal/confirmation, rate-limit and audit layers. None of them
may access PostgreSQL directly. External integrations are explicitly out of scope until
instructed (`docs/roadmap.md`).
