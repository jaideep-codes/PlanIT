import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { CacheService } from './cache.service.js';
import type { RedisService } from './redis.service.js';

const summarySchema = z.object({ focusSeconds: z.number() });

function createCache(client: Partial<Record<'get' | 'set' | 'del', ReturnType<typeof vi.fn>>>) {
  const redis = { client } as unknown as RedisService;
  const warn = vi.fn();
  const logger = { warn, setContext: vi.fn() } as unknown as PinoLogger;
  return { cache: new CacheService(redis, logger), warn };
}

describe('CacheService', () => {
  it('returns validated cached values with the key namespaced', async () => {
    const get = vi.fn().mockResolvedValue(JSON.stringify({ focusSeconds: 120 }));
    const { cache } = createCache({ get });

    await expect(cache.get('dashboard:user:u1:today', summarySchema)).resolves.toEqual({
      focusSeconds: 120,
    });
    expect(get).toHaveBeenCalledWith('planit:dashboard:user:u1:today');
  });

  it('treats a Redis failure as a miss and logs without throwing', async () => {
    const { cache, warn } = createCache({ get: vi.fn().mockRejectedValue(new Error('down')) });

    await expect(cache.get('k', summarySchema)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('treats malformed or out-of-shape entries as misses', async () => {
    const malformed = createCache({ get: vi.fn().mockResolvedValue('{not json') });
    await expect(malformed.cache.get('k', summarySchema)).resolves.toBeUndefined();

    const stale = createCache({ get: vi.fn().mockResolvedValue('{"focusMinutes":2}') });
    await expect(stale.cache.get('k', summarySchema)).resolves.toBeUndefined();
  });

  it('always writes entries with an expiry', async () => {
    const set = vi.fn().mockResolvedValue('OK');
    const { cache } = createCache({ set });

    await cache.set('k', { focusSeconds: 1 }, 60);
    expect(set).toHaveBeenCalledWith('planit:k', '{"focusSeconds":1}', 'EX', 60);
  });

  it('rejects entries without a positive TTL', async () => {
    const { cache } = createCache({ set: vi.fn() });
    await expect(cache.set('k', 1, 0)).rejects.toThrow(RangeError);
  });

  it('loads from the source of truth on a miss and still returns when caching fails', async () => {
    const { cache } = createCache({
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockRejectedValue(new Error('down')),
    });
    const load = vi.fn().mockResolvedValue({ focusSeconds: 42 });

    await expect(cache.getOrLoad('k', 30, summarySchema, load)).resolves.toEqual({
      focusSeconds: 42,
    });
    expect(load).toHaveBeenCalledOnce();
  });

  it('does not call the loader on a hit', async () => {
    const { cache } = createCache({
      get: vi.fn().mockResolvedValue('{"focusSeconds":7}'),
    });
    const load = vi.fn();

    await expect(cache.getOrLoad('k', 30, summarySchema, load)).resolves.toEqual({
      focusSeconds: 7,
    });
    expect(load).not.toHaveBeenCalled();
  });
});
