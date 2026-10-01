# Caching

> Implemented: Redis connection (`RedisService`) and `CacheService`. No product data is cached
> yet; domain caches arrive with their features.

## Rules

1. **Redis is never the source of truth.** Every cached value can be recomputed from PostgreSQL.
2. **Fail open.** If Redis is down or slow, reads become misses and writes become no-ops. The
   API reports `degraded` readiness and keeps serving. Security-sensitive rate limits are the one
   exception: they fail closed (`docs/security.md` §6).
3. **Every entry has a TTL.** `CacheService.set` rejects a missing or non-positive TTL.
4. **Validate on read.** Cached JSON is parsed with a Zod schema; a shape mismatch (for example
   after a deploy) is a miss, never served.
5. **Never cache:** secrets, credentials, raw BYOK keys, OTPs, tokens, authorization decisions
   (beyond the lifetime of one request), or source-of-truth records whose staleness could cause
   incorrect writes.
6. **Cache-aside.** Callers use `getOrLoad(key, ttl, schema, loader)`. Writes to source data
   invalidate the affected keys after the transaction commits.

## Implementation

- `apps/api/src/infrastructure/redis/redis.service.ts`: one general-purpose connection with
  `enableOfflineQueue: false` and `maxRetriesPerRequest: 1`, so commands fail fast during an
  outage instead of piling up. Reconnects with capped backoff. Waits up to 2 seconds for the
  initial connection at boot, then continues. Logs only on availability transitions. BullMQ uses
  separate connections (`maxRetriesPerRequest: null`, as BullMQ requires).
- `apps/api/src/infrastructure/redis/cache.service.ts`: namespaced keys (`planit:` prefix),
  `get`, `set`, `delete`, `getOrLoad`.
- Development uses Redis DB `0`; e2e tests use DB `1`.

## Planned keys

| Key                                                       | Content                                             | TTL    | Invalidated by                                  |
| --------------------------------------------------------- | --------------------------------------------------- | ------ | ----------------------------------------------- |
| `dashboard:user:{userId}:{localDate}:v1`                  | today's dashboard summary                           | 60 s   | task change, focus stop, timezone change        |
| `stats:user:{userId}:{period}:{key}:v1`                   | aggregate-backed statistics                         | 10 min | aggregation job completion for that user/period |
| `leaderboard:global:{metric}:{period}:{key}:v1`           | ranked user IDs + scores (sorted set)               | 5 min  | leaderboard rebuild job                         |
| `leaderboard:friends:{userId}:{metric}:{period}:{key}:v1` | friend ranking                                      | 5 min  | friendship/block changes, rebuild job           |
| `profile:public:{username}:{viewerClass}:v1`              | assembled public profile (PUBLIC viewer class only) | 5 min  | profile or visibility change, block changes     |

Notes:

- Versions (`:v1`) are bumped when a payload shape changes.
- Profile caching is only for the **anonymous/public** viewer class. Friend and owner views are
  always assembled per request, because they depend on the relationship.
- Leaderboard caches store only users who are eligible under their privacy settings at build
  time. Blocks are applied per viewer at read time.
