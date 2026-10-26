import { expect, test } from './fixtures.ts';
import { openExample, run } from './helpers.ts';

const nse = async (page: import('./fixtures.ts').Page) =>
  Number(
    await page.locator('results-panel table.fit tr[data-obs="gauge"] td').nth(6).textContent()
  );

test('calibrate rates to the observations, then apply (FR-CAL-001)', async ({ page }) => {
  await openExample(page, 'reservoir');
  // Knock the inflow rate off so there is something to calibrate.
  await page.locator('[data-edge="runoff"] .hit').dispatchEvent('pointerdown', { button: 0 });
  await page.locator('inspector-panel input[name="k"]').fill('1.6');
  await run(page);
  await page.getByRole('button', { name: 'Fit to observations' }).click();
  const before = await nse(page);

  await page.getByRole('button', { name: 'Calibrate rates…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Calibrate rates' });
  await expect(dialog.locator('input[value="runoff"]')).toBeChecked();
  await dialog.getByRole('button', { name: 'Calibrate', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Calibration result' })).toBeVisible({
    timeout: 30_000,
  });
  const after = Number(await dialog.locator('tr[data-rate="runoff"] td').nth(2).textContent());
  expect(after).toBeGreaterThan(0.6);
  expect(after).toBeLessThan(1);
  await dialog.getByRole('button', { name: 'Apply rates' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.toast')).toContainText('Calibrated rates applied');

  await run(page);
  expect(await nse(page)).toBeGreaterThan(before);
  // One undo puts the old rates back.
  await page.locator('diagram-canvas svg.canvas').focus();
  await page.keyboard.press('Control+z');
  await page.locator('[data-edge="runoff"] .hit').dispatchEvent('pointerdown', { button: 0 });
  await expect(page.locator('inspector-panel input[name="k"]')).toHaveValue('1.6');
});

test('sensitivity of charted series to each rate (FR-SEN-001)', async ({ page }) => {
  await openExample(page, 'household');
  await run(page);
  await page.getByRole('button', { name: 'Sensitivity to rates' }).click();
  const row = page.locator('results-panel table.sens tr[data-rate="pay"]');
  await expect(row).toBeVisible({ timeout: 20_000 });
  // More pay raises the bank balance: a positive elasticity.
  await expect(row.locator('td').nth(1)).toHaveText(/^\+/);
});
