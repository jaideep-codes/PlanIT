# Background jobs

> Status: **email delivery and OTP cleanup are running**. Other queues below stay planned until
> their phase. The worker entry point is `apps/api/src/worker.ts`. `pnpm dev` starts it beside
> the API; production runs `node dist/worker.js` (`pnpm --filter @planit/api start:worker`).

## Runtime model

- Same codebase as the API, separate entry point: `apps/api/src/worker.ts` builds a Nest
  application context with only the job modules and processors (no HTTP server). Production runs
  API and worker as separate processes so heavy jobs never affect request latency. In local
  development the worker can run alongside the API via `pnpm dev`.
- BullMQ on Redis, using dedicated connections (`maxRetriesPerRequest: null`).
- Workers call the same domain services as the API. They are subject to the same ownership
  rules: every job payload carries the `userId` it operates on, and services scope by it.
- Job payloads contain IDs and parameters only, never secrets, tokens or prompt text. The email
  queue is the exception that must carry a verification code: the API seals that payload with
  AES-256-GCM (`OTP_JOB_ENCRYPTION_KEY`) before enqueue, and the worker deletes the job when it
  finishes (decision D-026). Postgres stores only the HMAC of the code.

## Queues

| Queue           | Examples                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------- |
| `email`         | send verification OTP, password reset OTP, (later) weekly summary email                   |
| `analytics`     | recompute daily aggregate for (user, date); roll up weekly/monthly; rebuild user range    |
| `leaderboards`  | rebuild global and friends leaderboards per metric/period                                 |
| `notifications` | task reminders, missed planned task, streak and milestone notifications                   |
| `ai`            | weekly insights generation (managed AI, entitlement-checked)                              |
| `maintenance`   | delete expired OTPs, expire stale AI proposals, prune old sessions, retention enforcement |
| `integrations`  | future only                                                                               |

## Reliability rules

- **Idempotent by construction.** Deterministic `jobId`s deduplicate enqueues (for example
  `analytics:daily:{userId}:{localDate}`), and processors are upserts or recomputations from
  source data, never increments. Running a job twice gives the same result.
- **Retries** with exponential backoff (default 5 attempts, 1 s base). Non-retryable errors
  (validation, not found) fail immediately.
- **Failed-job retention** (default 7 days) for inspection. Completed jobs are removed quickly to
  bound Redis memory.
- **Recoverable from the database.** Losing Redis loses only pending jobs. A `maintenance`
  reconciliation job re-derives work from database state (for example dirty-aggregate markers
  and unsent emails).
- **Schedules** use BullMQ job schedulers (cron, UTC). The OTP cleanup scheduler runs at minute
  15 of every hour (`15 * * * *`) and once at worker startup. It deletes `email_otps` rows whose
  `expires_at` is at least 24 hours in the past. Per-user local-time work (for example "after the
  user's day ends") is computed from the user's timezone when enqueued.
- **Observability:** per-queue counters for completed, failed and retried jobs, and processing
  latency; structured logs with `jobId`, queue and attempt; alerts on failure-rate spikes and
  queue backlog.

## Aggregation flow (Phase 6)

```
focus session stop / edit  ──► enqueue analytics:daily:{user}:{localDate}
                                   │  recompute that day from focus_sessions + tasks (upsert)
                                   ▼
                          enqueue weekly/monthly roll-ups for the affected periods
                                   ▼
                          invalidate stats/dashboard cache keys
```

`analytics.rebuild(userId, from, to)` recomputes every aggregate in a range. It is used for
repairs, backfills and after changes to aggregation logic.
