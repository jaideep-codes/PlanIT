import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { createMutationGuard } from './mutation-guard.js';

function run(method: string, headers: Record<string, string | undefined>) {
  const guard = createMutationGuard(['http://localhost:3000']);
  const req = { method, headers, id: 'req-12345678' } as Request & { id: string };
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const res = { status, json } as unknown as Response;
  const next = vi.fn() as NextFunction;
  guard(req, res, next);
  return { next, status, json };
}

describe('mutation guard', () => {
  it('ignores safe methods', () => {
    const { next } = run('GET', {});
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects a mutating request without JSON or a matching origin', () => {
    const { next, status, json } = run('POST', {
      'content-type': 'application/x-www-form-urlencoded',
    });
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      error: { code: 'FORBIDDEN', message: 'The request was rejected.', requestId: 'req-12345678' },
    });
  });

  it('allows JSON from a configured origin', () => {
    const { next } = run('POST', {
      'content-type': 'application/json; charset=utf-8',
      origin: 'http://localhost:3000',
    });
    expect(next).toHaveBeenCalledOnce();
  });

  it('allows a same-origin fetch that omits Origin', () => {
    const { next } = run('POST', {
      'content-type': 'application/json',
      'sec-fetch-site': 'same-origin',
    });
    expect(next).toHaveBeenCalledOnce();
  });
});
