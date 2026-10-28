import { expect, test } from './fixtures.ts';

test('the library lists the examples and the kernel verifies', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Models', exact: true })).toBeVisible();
  await expect(page.locator('[data-example]')).toHaveCount(8);
  await expect(page.locator('app-nav .kstate')).toHaveText(/verified/);
});

test('a deep link loads the app shell', async ({ page }) => {
  await page.goto('kernel');
  await expect(page.getByRole('heading', { name: 'Kernel', exact: true })).toBeVisible();
  await expect(page.locator('.k-status')).toHaveText(/Verified/);
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
  await expect(page.locator('table.result tbody tr')).toHaveCount(8);
});
