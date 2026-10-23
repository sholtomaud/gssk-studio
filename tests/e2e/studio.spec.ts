import { expect, test } from './fixtures.ts';
import { openExample, run, wire } from './helpers.ts';

test('an example opens, runs on the kernel and plays back onto the diagram', async ({ page }) => {
  await openExample(page, 'predator-prey');
  await run(page);
  await expect(page.locator('results-panel .status')).toContainText('Solver OK');
  await expect(page.locator('results-panel .series-line')).toHaveCount(2);
  // Playback writes each node's level under its label.
  await expect(page.locator('[data-node="prey"] .reading')).not.toBeEmpty();
  await page.locator('results-panel input[type="range"]').fill('0');
  await expect(page.locator('[data-node="prey"] .reading')).toHaveText('40');
});

test('build a model from the palette, wire it, run it, undo it', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'New model' }).click();
  await page.getByRole('button', { name: 'Add Source' }).click();
  await page.getByRole('button', { name: 'Add Storage' }).click();
  await page.getByRole('button', { name: 'Add Heat sink' }).click();
  await expect(page.locator('diagram-canvas [data-node]')).toHaveCount(3);

  await wire(page, 'source', 'node:storage');
  await wire(page, 'storage', 'node:heat_sink');
  await expect(page.locator('diagram-canvas [data-edge]')).toHaveCount(2);
  await expect(page.locator('studio-page .badge').filter({ hasText: 'Checks pass' })).toBeVisible();

  // Wiring a node onto a flow makes it that flow's control: an interaction with a gate.
  await page.getByRole('button', { name: 'Add Constant' }).click();
  await wire(page, 'constant', 'edge:storage_to_heat_sink');
  await expect(page.locator('[data-edge="storage_to_heat_sink"] .gate')).toHaveCount(1);
  await expect(page.locator('inspector-panel select[name="logic"]')).toHaveValue('interaction');

  await run(page);
  await expect(page.locator('results-panel .series button')).toHaveCount(4);

  await page.keyboard.press('Escape');
  await page.locator('diagram-canvas svg.canvas').focus();
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-edge="storage_to_heat_sink"] .gate')).toHaveCount(0);
  await expect(page.locator('results-panel .status')).toContainText('Model changed since this run');
});

test('the inspector edits a node, and edits survive a reload', async ({ page }) => {
  await openExample(page, 'household');
  await page.getByRole('button', { name: 'Storage: Bank account' }).click();
  const label = page.locator('inspector-panel input[name="label"]');
  await label.fill('Everyday account');
  await page.locator('inspector-panel input[name="value"]').fill('2500');
  await expect(page.locator('[data-node="bank"] .label')).toHaveText('Everyday account');
  await expect(page.locator('studio-page .saved')).toHaveText('Saved');
  await page.reload();
  await expect(page.locator('[data-node="bank"] .label')).toHaveText('Everyday account');
  await page.getByRole('button', { name: 'Storage: Everyday account' }).click();
  await expect(page.locator('inspector-panel input[name="value"]')).toHaveValue('2500');
});

test('a model with a problem lists it and will not run', async ({ page }) => {
  await openExample(page, 'predator-prey');
  await page.locator('[data-edge="predation"] .line').click({ force: true });
  await page.locator('inspector-panel select[name="control_node"]').selectOption('');
  await expect(page.locator('inspector-panel .issues li.error')).toContainText(
    'needs a control node'
  );
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('Fix the problems');
  await expect(page.locator('results-panel .series-line')).toHaveCount(0);
});
