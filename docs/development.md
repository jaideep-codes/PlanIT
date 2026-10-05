# Development

## Prerequisites

- Node.js **24 LTS** (`.nvmrc`); `engine-strict` rejects older versions.
- pnpm **9.15** (`npm i -g pnpm@9` if `corepack enable` is not permitted on your machine).
- Docker with Compose v2+ (PostgreSQL 17, Redis 7.4, and Mailpit for local development).

## First-time setup

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm services:up            # Postgres (planit + planit_test), Redis, and Mailpit
pnpm db:migrate:deploy      # apply migrations to the dev database
pnpm dev                    # web http://localhost:3000, API http://127.0.0.1:4000, and the worker
```

Mailpit accepts SMTP on `127.0.0.1:1025` and shows messages at <http://127.0.0.1:8025>. Signup,
resend, and password reset enqueue a sealed email job; the worker started by `pnpm dev` sends it.
In production the worker is a separate process: `node dist/worker.js`.

Prepare the e2e database once (and after adding migrations):

```bash
DATABASE_URL=postgresql://planit:planit_dev_password@127.0.0.1:5432/planit_test pnpm db:migrate:deploy
```

## Commands

| Command                                                 | What it does                                                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                              | build shared packages, generate Prisma client, run web, API, and the email worker in watch mode         |
| `pnpm build`                                            | production builds of all packages and apps                                                              |
| `pnpm lint`                                             | ESLint (type-aware) everywhere                                                                          |
| `pnpm typecheck`                                        | `tsc --noEmit` everywhere (web runs `next typegen` first)                                               |
| `pnpm run test`                                         | unit tests (Vitest). Use `pnpm run test`, because `pnpm test` is a pnpm builtin that bypasses arguments |
| `pnpm run test:e2e`                                     | API e2e tests against real Postgres (`planit_test`) and Redis (DB 1)                                    |
| `pnpm run test:browser`                                 | Playwright browser tests at http://localhost:3000 (Postgres, Redis DB 2, Mailpit)                       |
| `pnpm run scan:secrets`                                 | fail if known secret patterns are in tracked files; `-- --require-bundle` also scans the web build      |
| `pnpm check`                                            | lint + typecheck + unit tests                                                                           |
| `pnpm format` / `format:check`                          | Prettier (with Tailwind class sorting)                                                                  |
| `pnpm services:up` / `services:down` / `services:reset` | start / stop / stop and delete volumes                                                                  |
| `pnpm db:migrate`                                       | create and apply a migration in development (`prisma migrate dev`)                                      |
| `pnpm db:migrate:deploy`                                | apply pending migrations (CI, production, test DB)                                                      |
| `pnpm db:status`                                        | show migration status                                                                                   |
| `pnpm db:generate`                                      | regenerate the Prisma client                                                                            |
| `pnpm db:studio`                                        | Prisma Studio                                                                                           |

## Environment strategy

| File                    | Purpose                                                 | Committed |
| ----------------------- | ------------------------------------------------------- | --------- |
| `.env.example`          | optional docker-compose overrides                       | yes       |
| `apps/api/.env.example` | API variables with local-development values             | yes       |
| `apps/api/.env`         | your local API configuration                            | no        |
| `apps/web/.env.example` | `API_INTERNAL_URL` (server-only) for the `/api` rewrite | yes       |
| `apps/web/.env.local`   | your local web configuration                            | no        |

- The API validates all variables at boot (`apps/api/src/config/env.ts`) and refuses to start
  on invalid configuration. Add new variables to the schema **and** to `.env.example`.
- Only `NEXT_PUBLIC_*` variables reach the browser. Never put secrets there.
- Production secrets come from the deployment platform's secret manager.
- Windows: the repository enforces LF line endings (`.gitattributes`). Shell scripts mounted
  into containers fail with CRLF endings.

## Database workflow

1. Edit or add a domain file in `apps/api/prisma/schema/`.
2. `pnpm db:migrate --name <change>` creates the migration and regenerates the client.
3. Add CHECK constraints and partial indexes by hand to the generated `migration.sql` **before**
   it is applied anywhere shared. Never edit a migration that has been applied outside your
   machine.
4. Apply to the test database (see above), then run `pnpm run test:e2e`.

Prefer additive, backwards-compatible migrations (add nullable column → backfill → enforce),
so a deploy never requires downtime.

## Conventions

- **Imports in the API** use `.js` extensions (NodeNext ESM).
- **Ownership:** services take `authenticatedUserId` first; repositories always filter by it.
- **Validation:** Zod schemas in `@planit/shared`, using `z.strictObject` for request bodies.
- **Errors:** throw `AppException(code, message, status)` for expected failures. Anything else
  becomes a generic 500.
- **Logging:** inject `PinoLogger` and call `setContext`. Never log request bodies, secrets or
  user content. Extend the redaction list for any new credential-bearing field.
- **UI:** use semantic tokens (`bg-card`, `text-muted-foreground`), never raw colours. Components
  must be keyboard-accessible and labelled.
- **No placeholders:** unbuilt features show an honest "not available yet" state. No mock APIs,
  no fake data.

## Testing strategy

| Layer               | Tooling                                     | Scope                                                         |
| ------------------- | ------------------------------------------- | ------------------------------------------------------------- |
| Unit                | Vitest (+ SWC for Nest), jsdom for UI       | pure logic, services with fakes, components, schemas          |
| API integration/e2e | Vitest + supertest, real Postgres and Redis | HTTP stack, guards, ownership/IDOR, constraints, transactions |
| Browser E2E         | Playwright (`pnpm run test:browser`)        | auth flows, critical journeys; BYOK network hook for later    |
| Static              | ESLint (boundaries), typecheck, audit       | architecture rules, type safety, dependency vulnerabilities   |

Every user-owned resource gets an integration test proving another user cannot read, update or
delete it. AI phases must cover all 28 scenarios in `docs/ai-security.md`.

## Browser tests

`pnpm run test:browser` runs Playwright against the web origin (`http://localhost:3000`). The
browser does not call the API origin. `/api/*` is the app's rewrite, so session cookies stay
first-party.

Start Compose first (`pnpm services:up`: Postgres, Redis, and Mailpit). The harness applies
migrations to `planit_test`, then starts the API, the email worker, and Next. The API and worker
use Redis database 2 so they do not share rate-limit counters or the email queue with API e2e
(database 1). Google sign-in is left unconfigured. One-time codes are read from Mailpit
(<http://127.0.0.1:8025>) and are not printed.

Install Chromium once:

```bash
pnpm --filter @planit/web exec playwright install chromium
```

Stop `pnpm dev` if port 3000 or 4000 is already taken. `PLAYWRIGHT_REUSE_SERVER=1` reuses those
ports only when the processes already running are this test stack.

`apps/web/e2e/support/network-guards.ts` records same-origin requests so later phases can assert
that task, focus, and BYOK traffic does not carry secrets (`docs/ai-security.md`, layer E). Those
product tests are not part of Phase 2. Failure traces and the HTML report are gitignored. CI
uploads them when the browser step fails.

## Continuous integration

`.github/workflows/ci.yml` uses `contents: read` and `pnpm install --frozen-lockfile`. It starts
Compose, applies migrations to `planit` and `planit_test`, then runs format, lint, typecheck, the
tracked-file secret scan (the script plus gitleaks), unit tests, API e2e, the Playwright browser
install, `pnpm run test:browser`, `pnpm build`, and a scan of `apps/web/.next/static`.
`pnpm audit --prod` stays non-blocking until high and critical findings block a release. The
workflow does not print secret values.

## Definition of Done (per feature)

1. Backend implemented, with ownership rules enforced in services and repositories.
2. Frontend connected to the real API. No mock data.
3. Loading, empty and error states handled.
4. Validation on both sides using the shared schemas.
5. Unit and integration tests, including authorization tests.
6. `pnpm lint`, `pnpm typecheck`, `pnpm run test`, `pnpm run test:e2e`, and `pnpm run test:browser` pass.
7. Migrations apply cleanly to a fresh database.
8. Documentation updated (`docs/`), including a decision entry for non-obvious choices.
9. Security and performance reviewed (queries indexed, no N+1, no secrets logged).

## Per-phase workflow

1. Explain scope. 2. List files. 3. Explain database changes. 4. Implement. 5. Typecheck.
2. Lint. 7. Test. 8. Run migrations safely. 9. Review security. 10. Review performance.
3. Summarize changes. 12. State known limitations. Then stop for review.
