import { randomBytes } from 'node:crypto';

import { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from '@planit/shared';
import { expect, type Page } from '@playwright/test';

import { readInboxCode } from './mailpit';
import { watchPlanitTraffic } from './network-guards';

export function uniqueEmail(): string {
  return `e2e-${randomBytes(8).toString('hex')}@example.com`;
}

/** Meets the signup composition rule and is unique so it is not a known breached password. */
export function uniquePassword(): string {
  return `E2e-${randomBytes(8).toString('hex')}-Aa1!`;
}

async function clickPost(page: Page, urlPart: string, click: () => Promise<void>): Promise<void> {
  const pending = page.waitForResponse(
    (response) => response.url().includes(urlPart) && response.request().method() === 'POST',
  );
  await click();
  const response = await pending;
  const body = await response.text();
  if (body.includes('passwordHash')) {
    throw new Error('An API response included passwordHash');
  }
  if (!response.ok()) {
    throw new Error(`${urlPart} failed with status ${String(response.status())}`);
  }
}

export async function createVerifiedAccount(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await clickPost(page, '/api/v1/auth/signup', () =>
    page.getByRole('button', { name: 'Create account' }).click(),
  );
  await expect(page).toHaveURL(/\/verify-email/);
  const code = await readInboxCode(email, 'verification code');
  await page.getByLabel('Verification code').fill(code);
  await clickPost(page, '/api/v1/auth/otp/verify', () =>
    page.getByRole('button', { name: 'Verify email' }).click(),
  );
  await expect(page).toHaveURL(/\/login\?verified=1/);
  await expect(page.getByRole('status')).toContainText('Email verified');
}

/** Signs in through the web origin and checks the session cookies and the owner projection. */
export async function logIn(page: Page, email: string, password: string): Promise<void> {
  const traffic = watchPlanitTraffic(page);
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  const loginResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/auth/login') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  const login = await loginResponse;
  const body = await login.text();
  if (body.includes('passwordHash')) {
    throw new Error('Login response included passwordHash');
  }
  await expect(page).toHaveURL('http://localhost:3000/');
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  traffic.assertAbsent('passwordHash');

  const html = await page.content();
  expect(html).not.toContain('passwordHash');
  expect(html).not.toContain(password);

  const me = await page.request.get('/api/v1/users/me');
  expect(me.ok()).toBe(true);
  expect(await me.text()).not.toContain('passwordHash');

  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name === ACCESS_COOKIE_NAME)).toMatchObject({
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
  });
  expect(cookies.find((cookie) => cookie.name === REFRESH_COOKIE_NAME)).toMatchObject({
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: REFRESH_COOKIE_PATH,
  });
}
