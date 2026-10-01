import { describe, expect, it } from 'vitest';

import { apiErrorBodySchema } from './api.js';
import { readinessResponseSchema } from './health.js';

describe('readinessResponseSchema', () => {
  it('accepts a well-formed readiness payload', () => {
    const result = readinessResponseSchema.safeParse({
      status: 'degraded',
      checks: {
        database: { status: 'up', latencyMs: 3 },
        redis: { status: 'down', latencyMs: 250 },
      },
      timestamp: new Date().toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown statuses', () => {
    const result = readinessResponseSchema.safeParse({
      status: 'maybe',
      checks: {
        database: { status: 'up', latencyMs: 1 },
        redis: { status: 'up', latencyMs: 1 },
      },
      timestamp: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });
});

describe('apiErrorBodySchema', () => {
  it('parses the standard error envelope', () => {
    const result = apiErrorBodySchema.safeParse({
      error: { code: 'NOT_FOUND', message: 'Resource not found', requestId: 'abc12345' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects bodies that are not error envelopes', () => {
    expect(apiErrorBodySchema.safeParse({ message: 'nope' }).success).toBe(false);
  });
});
