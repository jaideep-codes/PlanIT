import { expect, test } from '@playwright/test';

test('keeps the API Referrer-Policy on rewritten responses', async ({ request }) => {
  const callback = await request.get('/api/v1/auth/google/callback', { maxRedirects: 0 });
  expect(callback.status()).toBe(503);
  expect(callback.headers()['referrer-policy']).toBe('no-referrer');

  const health = await request.get('/api/health');
  expect(health.ok()).toBe(true);
  expect(health.headers()['referrer-policy']).toBe('no-referrer');

  const login = await request.get('/login');
  expect(login.ok()).toBe(true);
  expect(login.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
});
