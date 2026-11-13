import { expect, test } from './fixtures.ts';

test('the library lists the examples and the kernel verifies', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Models', exact: true })).toBeVisible();
  await expect(page.locator('[data-example]')).toHaveCount(9);
  await expect(page.locator('app-nav .kstate')).toHaveText(/verified/);
});

test('a deep link loads the app shell', async ({ page }) => {
  await page.goto('kernel');
  await expect(page.getByRole('heading', { name: 'Kernel', exact: true })).toBeVisible();
  await expect(page.locator('.k-status')).toHaveText(/Verified/);
});

test('once the service worker is installed, a deep link is not a 404 (NFR-STO-005)', async ({
  page,
}) => {
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  // GitHub Pages answers this path with 404.html and status 404; the worker
  // answers it with the precached shell instead, so no 404 reaches the console.
  const res = await page.goto('kernel');
  expect(res?.status()).toBe(200);
  expect(res?.fromServiceWorker()).toBe(true);
  await expect(page.getByRole('heading', { name: 'Kernel', exact: true })).toBeVisible();
});

test('an unknown model says so and links back', async ({ page }) => {
  await page.goto('model/does-not-exist');
  await expect(page.getByRole('heading', { name: 'Model not found' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to models' }).click();
  await expect(page.getByRole('heading', { name: 'Models', exact: true })).toBeVisible();
});

test('the kernel self-test runs every example', async ({ page }) => {
  await page.goto('kernel');
  await page.getByRole('button', { name: 'Run self-test' }).click();
  await expect(page.locator('table.result')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('table.result')).toHaveAttribute('data-passed', 'true');
  await expect(page.locator('table.result tbody tr')).toHaveCount(9);
});

test('the Reference page shows the entries the assistant reads, and its contents link to them', async ({
  page,
}) => {
  await page.goto('./');
  await page.getByRole('link', { name: 'Reference' }).click();
  await expect(page.locator('reference-page h1')).toHaveText('Reference');
  await expect(page.locator('reference-page article.entry#heat-sink')).toContainText('earth');
  await expect(page.locator('reference-page article.entry#money')).toContainText(
    'never flows to a heat sink'
  );
  await page.locator('reference-page nav.contents').getByRole('link', { name: 'Money' }).click();
  await expect(page.locator('reference-page article.entry#money')).toBeInViewport();
  await expect(page).toHaveURL(/\/reference$/);
});
