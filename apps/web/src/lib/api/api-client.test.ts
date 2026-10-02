import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from './api-client';

const schema = z.object({ status: z.string() });

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiGet', () => {
  it('calls the same-origin /api path and returns validated data', async () => {
    const fetchMock = mockFetch(200, { status: 'ok' });

    await expect(apiGet('/health', schema)).resolves.toEqual({ status: 'ok' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
  });

  it('raises ApiError with the envelope code and request ID', async () => {
    mockFetch(404, { error: { code: 'NOT_FOUND', message: 'Not found', requestId: 'req-1' } });

    const error = await apiGet('/missing', schema).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: 'NOT_FOUND', requestId: 'req-1' });
  });

  it('rejects successful responses that do not match the schema', async () => {
    mockFetch(200, { unexpected: true });
    await expect(apiGet('/health', schema)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('parses accepted non-2xx statuses with the schema', async () => {
    mockFetch(503, { status: 'not_ready' });
    await expect(apiGet('/health/ready', schema, { acceptStatuses: [503] })).resolves.toEqual({
      status: 'not_ready',
    });
  });

  it('reports network failures without leaking internals', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(apiGet('/health', schema)).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
    });
  });
});

describe('apiPost', () => {
  it('sends JSON to the same origin and does not put the body in the URL', async () => {
    const fetchMock = mockFetch(200, { status: 'verification_required' });
    await expect(
      apiPost('/v1/auth/signup', { email: 'ada@example.com', password: 'correct-horse' }, schema),
    ).resolves.toEqual({ status: 'verification_required' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/signup',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'ada@example.com', password: 'correct-horse' }),
      }),
    );
  });
});

describe('apiPatch and apiDelete', () => {
  it('sends JSON so state-changing requests pass the mutation guard', async () => {
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Response(JSON.stringify({ status: 'revoked' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await apiPatch('/v1/users/me/theme', { theme: 'dark' }, schema);
    await apiDelete('/v1/auth/sessions/01999999-9999-7999-8999-999999999999', schema);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/users/me/theme',
      expect.objectContaining({
        method: 'PATCH',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: 'dark' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/auth/sessions/01999999-9999-7999-8999-999999999999',
      expect.objectContaining({
        method: 'DELETE',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
  });
});
