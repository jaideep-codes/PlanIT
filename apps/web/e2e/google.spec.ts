import { expect, test } from '@playwright/test';

test('says Google sign-in is not configured and does not start a login', async ({ page }) => {
  for (const path of ['/login', '/signup']) {
    await page.goto(path);
    await expect(
      page.getByRole('button', { name: 'Google sign-in is not configured' }),
    ).toBeDisabled();
    await expect(page.getByRole('link', { name: 'Continue with Google' })).toHaveCount(0);
  }
});

test('shows allowlisted Google errors and ignores every other query value', async ({ page }) => {
  await page.goto('/login?google=failed');
  await expect(page.getByRole('alert')).toHaveText('Google sign-in could not be completed.');

  await page.goto('/login?google=unverified_email');
  await expect(page.getByRole('alert')).toHaveText('Google has not verified this email.');

  await page.goto('/login?google=verify_email');
  await expect(page.getByRole('alert')).toHaveText('Verify your email before linking Google.');

  await page.goto('/login?google=not-a-reason');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();

  await page.goto('/login?google=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E');
  await expect(page.getByText('Google sign-in could not be completed.')).toHaveCount(0);
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
});
