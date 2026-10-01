import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ApiError, apiGet } from './api-client';

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
