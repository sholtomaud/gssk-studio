import { expect, test } from './fixtures.ts';
import { clickEdge, openExample, run } from './helpers.ts';

test('force a source with a waveform, preview it and run it (FR-FRC-001)', async ({ page }) => {
  await openExample(page, 'household');
  await page.getByRole('button', { name: 'Source: Income' }).click();
  const waveform = page.locator('inspector-panel select[name="waveform"]');
  await expect(waveform).toHaveValue('');
  await waveform.selectOption('sine');
  await expect(page.locator('inspector-panel .forcing-preview svg.wave path.line')).toHaveCount(1);
  await expect(page.locator('[data-node="income"] .forced')).toHaveCount(1);
  // A sine needs a period: clearing it is an error the canvas marks.
  await page.locator('inspector-panel input[name="forcing_period"]').fill('');
  await expect(page.locator('inspector-panel .issues li.error')).toContainText('positive period');
  await expect(page.locator('[data-node="income"]')).toHaveClass(/invalid/);
  await page.locator('inspector-panel input[name="forcing_period"]').fill('24');
  // The household runs on auto, whose solver check fails on forced models (K-7).
  await expect(page.locator('inspector-panel .issues li.warning')).toContainText('choose rk4');
  await page.locator('diagram-canvas svg.canvas').focus();
  await page.keyboard.press('Escape');
  await page.locator('inspector-panel select[name="method"]').selectOption('rk4');
  await expect(page.locator('studio-page .badge').filter({ hasText: 'Checks pass' })).toBeVisible();
  await run(page);
  await expect(page.locator('results-panel .status')).toContainText('Solver OK');
  await page.locator('results-panel .series button', { hasText: 'Income' }).click();
  await expect(page.locator('results-panel .series-line')).toHaveCount(3);
});

test('force a flow from a table of points (FR-FRC-001)', async ({ page }) => {
  await openExample(page, 'household');
  await clickEdge(page, 'spend');
  await page.locator('inspector-panel select[name="waveform"]').selectOption('table');
  const table = page.locator('inspector-panel textarea[name="forcing_table"]');
  await table.fill('0, 0.05\n60 0.2\nnot a row');
  await expect(table).toHaveAttribute('aria-invalid', 'true');
  await table.fill('0, 0.05\n60, 0.2');
  await expect(table).not.toHaveAttribute('aria-invalid');
  await expect(page.locator('[data-edge="spend"] .forced')).toHaveCount(1);
  await expect(page.locator('[data-edge="spend"] title')).toContainText('table of 2 points');
  await page.locator('inspector-panel select[name="waveform"]').selectOption('');
  await expect(page.locator('[data-edge="spend"] .forced')).toHaveCount(0);
});

test('an ensemble draws a band around the run, with its seed (FR-ENS-001)', async ({ page }) => {
  await openExample(page, 'reservoir');
  await run(page);
  await page.getByRole('button', { name: /Ensemble/ }).click();
  await page.locator('results-panel input[name="ens_runs"]').fill('20');
  await page.locator('results-panel input[name="ens_seed"]').fill('7');
  await page.getByRole('button', { name: 'Run ensemble' }).click();
  await expect(page.locator('results-panel .badge.ens')).toHaveText(
    'Band: 20 runs, k ± 10 %, seed 7'
  );
  await expect(page.locator('results-panel path.band')).toHaveCount(2);
  await expect(page.locator('results-panel .series-line.mean')).toHaveCount(2);
  await page.getByRole('button', { name: 'Clear band' }).click();
  await expect(page.locator('results-panel path.band')).toHaveCount(0);

  await page.locator('results-panel input[name="ens_seed"]').fill('-3');
  await page.getByRole('button', { name: 'Run ensemble' }).click();
  await expect(page.locator('results-panel .ens-note')).toContainText('The seed must be');
});
