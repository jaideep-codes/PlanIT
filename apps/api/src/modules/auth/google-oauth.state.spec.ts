import { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';

import type { RedisService } from '../../infrastructure/redis/redis.service.js';
import { GOOGLE_STATE_TTL_SECONDS } from './auth.constants.js';
import { sha256Hex } from './crypto.js';
import { RedisGoogleOAuthStateStore } from './google-oauth.state.js';

function store(available = true) {
  const rows = new Map<string, string>();
  const warn = vi.fn();
  const client = {
    set: vi.fn(
      (
        key: string,
        value: string,
        expiryMode: string,
        ttl: number,
        mode: string,
      ): Promise<'OK' | null> => {
        expect(expiryMode).toBe('EX');
        expect(mode).toBe('NX');
        expect(ttl).toBe(GOOGLE_STATE_TTL_SECONDS);
        if (rows.has(key)) return Promise.resolve(null);
        rows.set(key, value);
        return Promise.resolve('OK');
      },
    ),
    getdel: vi.fn((key: string): Promise<string | null> => {
      const value = rows.get(key) ?? null;
      rows.delete(key);
      return Promise.resolve(value);
    }),
  };
  const redis = { isAvailable: available, client } as unknown as RedisService;
  const logger = { setContext: vi.fn(), warn } as unknown as PinoLogger;
  return { rows, client, warn, store: new RedisGoogleOAuthStateStore(redis, logger) };
}

describe('Redis Google state', () => {
  it('stores the verifier under a hash of the state and consumes it once', async () => {
    const { client, store: states } = store();
    const state = 'state-value-not-the-key';
    const value = { verifier: 'a'.repeat(43), nonce: 'b'.repeat(43) };

    await states.save(state, value);
    const key = client.set.mock.calls[0]?.[0];
    expect(key).toBe(`oauth:google:${sha256Hex(state)}`);
    expect(key).not.toContain(state);

    await expect(states.consume(state)).resolves.toEqual(value);
    await expect(states.consume(state)).resolves.toBeNull();
    expect(client.getdel).toHaveBeenCalledTimes(2);
  });

  it('fails closed when Redis is down', async () => {
    const { store: states } = store(false);
    await expect(
      states.save('state', { verifier: 'a'.repeat(43), nonce: 'b'.repeat(43) }),
    ).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
  });

  it('treats a corrupt payload as a miss', async () => {
    const { client, store: states } = store();
    client.getdel.mockResolvedValueOnce('not-json');
    await expect(states.consume('state')).resolves.toBeNull();
  });
});
