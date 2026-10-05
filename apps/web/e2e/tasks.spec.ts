import { randomBytes } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { createVerifiedAccount, logIn, uniqueEmail, uniquePassword } from './support/account';

function watchResponses(page: Page): Promise<void>[] {
  const checks: Promise<void>[] = [];
  page.on('response', (response) => {
    if (!response.url().includes('/api/v1/')) return;
    checks.push(
      response.text().then(
        (body) => {
          if (body.includes('passwordHash')) {
            throw new Error('An API response included passwordHash');
          }
        },
        () => {
          // A document navigation can drop a response body before it is read.
        },
      ),
    );
  });
  return checks;
}

function taskItems(page: Page) {
  return page.getByRole('list', { name: 'Tasks' }).getByRole('listitem');
}

test('creates, completes, reopens, sorts, and reorders tasks from Home', async ({ page }) => {
  const checks = watchResponses(page);
  const email = uniqueEmail();
  const password = uniquePassword();
  await createVerifiedAccount(page, email, password);
  await logIn(page, email, password);

  await page.getByLabel('Title').fill('Ship the list');
  await page.getByRole('button', { name: 'Add task' }).click();
  const ship = taskItems(page).filter({ hasText: 'Ship the list' });
  await expect(ship).toBeVisible();

  await ship.getByRole('button', { name: 'Complete', exact: true }).click();
  await expect(taskItems(page)).toHaveCount(0);

  await page.getByRole('checkbox', { name: 'Completed' }).check();
  await expect(taskItems(page).filter({ hasText: 'Ship the list' })).toBeVisible();
  await page.getByRole('button', { name: 'Reopen', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Completed' }).uncheck();
  await expect(taskItems(page).filter({ hasText: 'Ship the list' })).toBeVisible();

  await page.getByLabel('Title').fill('Beta task');
  await page.getByRole('button', { name: 'Add task' }).click();
  const items = taskItems(page);
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Beta task');
  await expect(items.nth(1)).toContainText('Ship the list');
  await items.nth(1).getByRole('button', { name: 'Move up', exact: true }).click();
  await expect(items.nth(0)).toContainText('Ship the list');
  await expect(items.nth(1)).toContainText('Beta task');

  const savedSort = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/users/me/task-sort') &&
      response.request().method() === 'PATCH',
  );
  await page.getByLabel('Sort').selectOption('priority');
  expect((await savedSort).ok()).toBe(true);
  await expect(page.getByLabel('Sort')).toHaveValue('priority');
  await page.reload();
  await expect(page.getByLabel('Sort')).toHaveValue('priority');
  await Promise.all(checks);
});

test('hides a task from a second signed-in user', async ({ page, browser }) => {
  const checks = watchResponses(page);
  const title = `Only owner ${randomBytes(4).toString('hex')}`;
  const email = uniqueEmail();
  const password = uniquePassword();
  await createVerifiedAccount(page, email, password);
  await logIn(page, email, password);
  await page.getByLabel('Title').fill(title);
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(taskItems(page).filter({ hasText: title })).toBeVisible();

  const other = await browser.newContext();
  const otherPage = await other.newPage();
  const otherChecks = watchResponses(otherPage);
  try {
    const otherEmail = uniqueEmail();
    const otherPassword = uniquePassword();
    await createVerifiedAccount(otherPage, otherEmail, otherPassword);
    await logIn(otherPage, otherEmail, otherPassword);
    await expect(otherPage.getByRole('heading', { name: 'Today' })).toBeVisible();
    await expect(otherPage.getByText(title)).toHaveCount(0);
    await expect(taskItems(page).filter({ hasText: title })).toBeVisible();
    await Promise.all(otherChecks);
  } finally {
    await other.close();
  }
  await Promise.all(checks);
});

test('adds a task on a phone-width viewport above the tab bar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const checks = watchResponses(page);
  const email = uniqueEmail();
  const password = uniquePassword();
  await createVerifiedAccount(page, email, password);
  await logIn(page, email, password);

  const title = page.getByLabel('Title');
  const add = page.getByRole('button', { name: 'Add task' });
  const tabBar = page.getByRole('navigation', { name: 'Primary' });
  await expect(title).toBeVisible();
  await expect(add).toBeVisible();
  await expect(tabBar).toBeVisible();

  const addBox = await add.boundingBox();
  const tabBox = await tabBar.boundingBox();
  expect(addBox).not.toBeNull();
  expect(tabBox).not.toBeNull();
  if (addBox && tabBox) {
    expect(addBox.y).toBeGreaterThanOrEqual(0);
    expect(addBox.y + addBox.height).toBeLessThanOrEqual(844);
    expect(addBox.y + addBox.height).toBeLessThan(tabBox.y);
  }

  await title.fill('Narrow task');
  await add.click();
  await expect(taskItems(page).filter({ hasText: 'Narrow task' })).toBeVisible();
  await Promise.all(checks);
});
