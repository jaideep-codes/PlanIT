# PlanIT

PlanIT turns goals into scheduled work and measures whether you actually followed through.

```
GOAL → PLAN → SCHEDULE → EXECUTE → FOCUS → MEASURE → IMPROVE → RE-PLAN
```

**Status:** Phase 0 (architecture) and Phase 1 (foundation) are complete. Product features
begin with Phase 2 (authentication). See [`docs/roadmap.md`](docs/roadmap.md).

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · Tailwind CSS 4 · TanStack Query · NestJS 12
(Express 5, ESM) · PostgreSQL 17 · Prisma 7 · Redis 7.4 · Zod 4 · pino · Vitest · pnpm
workspaces + Turborepo · TypeScript 6.

## Quick start

Requires Node.js 24, pnpm 9.15 and Docker.

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm services:up
pnpm db:migrate:deploy
pnpm dev
```

Open http://localhost:3000. The API runs at http://127.0.0.1:4000 and is reached by the browser
through the web origin (`/api/*`), for example http://localhost:3000/api/health/ready.

## Common commands

```bash
pnpm lint            # ESLint
pnpm typecheck       # TypeScript
pnpm run test        # unit tests
pnpm run test:e2e    # API e2e tests (needs services + migrated planit_test DB)
pnpm build           # production build
pnpm db:migrate      # create/apply a migration (development)
```

Full details: [`docs/development.md`](docs/development.md).

## Repository layout

```
apps/web          Next.js web app (PWA-ready shell, theme system, CSP)
apps/api          NestJS modular monolith (Prisma, Redis, health, errors, logging)
packages/types    compile-time API contracts
packages/shared   shared runtime code (error codes, Zod schemas)
packages/ui       design tokens and base components
packages/config   shared TypeScript and ESLint configuration
docs/             architecture, security, AI, data, privacy, roadmap, decisions
```

## Documentation

| Topic           | Document                                             |
| --------------- | ---------------------------------------------------- |
| Architecture    | [`docs/architecture.md`](docs/architecture.md)       |
| Database schema | [`docs/database-schema.md`](docs/database-schema.md) |
| API conventions | [`docs/api.md`](docs/api.md)                         |
| Security        | [`docs/security.md`](docs/security.md)               |
| AI architecture | [`docs/ai-architecture.md`](docs/ai-architecture.md) |
| AI security     | [`docs/ai-security.md`](docs/ai-security.md)         |
| Caching         | [`docs/caching.md`](docs/caching.md)                 |
| Background jobs | [`docs/background-jobs.md`](docs/background-jobs.md) |
| Privacy         | [`docs/privacy.md`](docs/privacy.md)                 |
| Roadmap         | [`docs/roadmap.md`](docs/roadmap.md)                 |
| Decisions       | [`docs/decisions.md`](docs/decisions.md)             |
| Development     | [`docs/development.md`](docs/development.md)         |
