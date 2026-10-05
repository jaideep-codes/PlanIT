import { ACCESS_COOKIE_NAME } from '@planit/shared';
import { expect, test } from '@playwright/test';

import { createVerifiedAccount, logIn, uniqueEmail, uniquePassword } from './support/account';
import { readInboxCode } from './support/mailpit';

test('redirects an anonymous visit to the app shell to login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();

  await page.goto('/settings');
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings$/);
});

test('signs up, verifies email from the inbox, and can sign out', async ({ page }) => {
  const email = uniqueEmail();
  const password = uniquePassword();
  await createVerifiedAccount(page, email, password);
  await logIn(page, email, password);

  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
  await expect(page.getByText('This device')).toBeVisible();
  await expect(page.getByText('This is your only active session.')).toBeVisible();

  await page.getByRole('link', { name: 'Log out' }).click();
  await expect(page.getByRole('heading', { name: 'Log out' })).toBeVisible();
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name === ACCESS_COOKIE_NAME)).toBeUndefined();

  await page.goto('/settings');
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings$/);
});

test('resets a password with the inbox code and rejects the old password', async ({ page }) => {
  const email = uniqueEmail();
  const password = uniquePassword();
  const replacement = uniquePassword();
  await createVerifiedAccount(page, email, password);

  await page.goto('/forgot-password');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send reset code' }).click();
  await expect(page).toHaveURL(/\/reset-password/);
  const code = await readInboxCode(email, 'password reset code');
  await page.getByLabel('Reset code').fill(code);
  await page.getByLabel('New password').fill(replacement);
  const resetResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/auth/password/reset') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Update password' }).click();
  const reset = await resetResponse;
  expect(await reset.text()).not.toContain('passwordHash');
  await expect(page).toHaveURL(/\/login\?reset=1/);
  await expect(page.getByRole('status')).toContainText('Password updated');

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByText('Invalid email or password.', { exact: true })).toBeVisible();

  await logIn(page, email, replacement);
});
