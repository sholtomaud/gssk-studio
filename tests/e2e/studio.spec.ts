import { expect, test } from './fixtures.ts';
import { clickEdge, openExample, run, wire } from './helpers.ts';

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

test('flow widths are off by default and toggle on', async ({ page }) => {
  await openExample(page, 'household');
  await run(page);
  const width = () =>
    page.locator('[data-edge="pay"] .line').evaluate((el) => (el as SVGElement).style.strokeWidth);
  expect(await width()).toBe('');
  const toggle = page.getByRole('button', { name: /Flow widths/ });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(width).toMatch(/^[\d.]+px$/);
});

test('a storage shows its level as a gauge, a fill of its symbol, or both (FR-RES-003)', async ({
  page,
}) => {
  await openExample(page, 'purchases');
  const bank = page.locator('[data-node="bank"]');
  const gauges = page.getByRole('button', { name: /Level gauges/ });
  const fill = page.getByRole('button', { name: /Level fill/ });
  await expect(gauges).toHaveAttribute('aria-pressed', 'true');
  await expect(fill).toHaveAttribute('aria-pressed', 'false');
  await expect(bank.locator('.gauge')).toHaveCount(1);
  await expect(bank.locator('.level-fill')).toHaveCount(0);

  await fill.click();
  await gauges.click();
  await expect(bank.locator('.gauge')).toHaveCount(0);
  await expect(bank.locator('.level-fill')).toHaveCount(1);
  // 1,000 of a 30,000 reference level, filled from the bottom up.
  await expect(bank.locator('.level-on')).toHaveAttribute('offset', /^0\.033/);
  await run(page);
  await page.locator('results-panel input[type="range"]').fill('0');
  await expect(bank.locator('.level-on')).toHaveAttribute('offset', /^0\.033/);

  // Remembered across a reload.
  await page.reload();
  await expect(page.getByRole('button', { name: /Level fill/ })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});

test('build a model from the palette, wire it, run it, undo it', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'New model' }).click();
  await page.getByRole('button', { name: 'Add Source' }).click();
  await page.getByRole('button', { name: 'Add Storage' }).click();
  await page.getByRole('button', { name: 'Add Heat sink' }).click();
  await expect(page.locator('diagram-canvas [data-node]')).toHaveCount(3);
  // Unconnected symbols are warnings: orange, with a "!" badge (FR-VAL-002).
  await expect(page.locator('diagram-canvas .node.warned')).toHaveCount(3);
  await expect(page.locator('diagram-canvas .node .badge.warning')).toHaveCount(3);

  await wire(page, 'source', 'node:storage');
  await wire(page, 'storage', 'node:heat_sink');
  await expect(page.locator('diagram-canvas [data-edge]')).toHaveCount(2);
  await expect(page.locator('studio-page .badge').filter({ hasText: 'Checks pass' })).toBeVisible();

  // Wiring a node onto a flow makes it that flow's control: an interaction with a gate.
  await page.getByRole('button', { name: 'Add Source' }).click();
  await wire(page, 'source_2', 'edge:storage_to_heat_sink');
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

test('two flows between the same symbols are parallel pathways (FR-EDIT-003)', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'New model' }).click();
  await page.getByRole('button', { name: 'Add Source' }).click();
  await page.getByRole('button', { name: 'Add Storage' }).click();
  await wire(page, 'source', 'node:storage');
  await page.keyboard.press('Escape');
  await wire(page, 'source', 'node:storage');
  await expect(page.locator('diagram-canvas g.edge[data-edge]')).toHaveCount(2);
  const mid = (id: string) =>
    page
      .locator(`[data-edge="${id}"] .line`)
      .evaluate(
        (el) =>
          (el as SVGPathElement).getPointAtLength((el as SVGPathElement).getTotalLength() / 2).y
      );
  // The second bows further out, so both can be seen and picked.
  expect(
    Math.abs((await mid('source_to_storage_2')) - (await mid('source_to_storage')))
  ).toBeGreaterThan(18);
});

test('turn and size a symbol by its handles or the inspector (FR-EDIT-013)', async ({ page }) => {
  await openExample(page, 'grassland');
  const grass = page.locator('[data-node="grass"]');
  await grass.locator('.shape').click();
  await expect(page.locator('diagram-canvas .rotate-handle')).toHaveCount(1);

  // Swing the knob a quarter turn clockwise about the symbol's centre.
  const c = await grass.locator('.shape').boundingBox();
  const k = await page.locator('diagram-canvas .rotate-handle').boundingBox();
  const cx = c!.x + c!.width / 2;
  const cy = c!.y + c!.height / 2;
  await page.mouse.move(k!.x + k!.width / 2, k!.y + k!.height / 2);
  await page.mouse.down();
  await page.mouse.move(cx + 50, cy - 50, { steps: 4 });
  await page.mouse.move(cx + 70, cy, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('inspector-panel input[name="rotation"]')).toHaveValue('90');
  await expect(grass.locator('.shape')).toHaveAttribute('transform', /rotate\(90\)/);

  // Drag the corner outwards to grow it, in 5 % steps.
  const s = await page.locator('diagram-canvas .size-handle').boundingBox();
  await page.mouse.move(s!.x + s!.width / 2, s!.y + s!.height / 2);
  await page.mouse.down();
  await page.mouse.move(s!.x + 40, s!.y + 40, { steps: 5 });
  await page.mouse.up();
  const size = Number(await page.locator('inspector-panel input[name="scale"]').inputValue());
  expect(size).toBeGreaterThan(100);
  expect(size % 5).toBe(0);

  // The inspector sets them too; 0° and 100 % store nothing.
  await page.locator('inspector-panel input[name="rotation"]').fill('0');
  await page.locator('inspector-panel input[name="scale"]').fill('100');
  await expect(grass.locator('.shape')).toHaveAttribute('transform', 'rotate(0) scale(1)');
});

test('a sensor on a flow shows its rate and charts it (FR-EDIT-010)', async ({ page }) => {
  await openExample(page, 'household');
  await clickEdge(page, 'spend');
  await page.getByRole('button', { name: 'Add sensor' }).click();
  await expect(page.locator('[data-edge="spend"] .sensor')).toHaveCount(1);
  await expect(page.locator('inspector-panel input[name="sensor"]')).toBeChecked();
  await run(page);
  await expect(page.locator('[data-edge="spend"] .sensor-reading')).toHaveText(/^J \d/);
  const series = page.locator('results-panel .series button', { hasText: 'spend (J)' });
  await expect(series).toHaveAttribute('aria-pressed', 'false');
  await series.click();
  await expect(series).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('results-panel .series-line')).toHaveCount(3);
});

test('a long run shows progress and can be cancelled (FR-SIM-005)', async ({ page }) => {
  await openExample(page, 'reservoir');
  await page.locator('inspector-panel input[name="dt"]').fill('0.0002');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('results-panel progress')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.toast')).toHaveText('Run cancelled.');
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeVisible();
  await expect(page.locator('results-panel .series-line')).toHaveCount(0);
});

test('keep a run as a baseline and compare the next run against it (FR-RES-006)', async ({
  page,
}) => {
  await openExample(page, 'household');
  await run(page);
  await page.getByRole('button', { name: /Keep this run as a baseline/ }).click();
  await page.getByRole('button', { name: 'Storage: Bank account' }).click();
  await page.locator('inspector-panel input[name="value"]').fill('3000');
  await run(page);
  await expect(page.locator('results-panel .status')).toContainText('Dashed: baseline');
  await expect(page.locator('results-panel .series-line.base')).toHaveCount(2);
  await page.getByRole('button', { name: /Stop comparing/ }).click();
  await expect(page.locator('results-panel .series-line.base')).toHaveCount(0);
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
  await clickEdge(page, 'predation');
  await page.locator('inspector-panel select[name="control_node"]').selectOption('');
  await expect(page.locator('inspector-panel .issues li.error')).toContainText(
    'needs a control node'
  );
  const flow = page.locator('g.edge[data-edge="predation"]');
  await expect(flow).toHaveClass(/invalid/);
  await expect(page.locator('.badge.error[data-edge="predation"] title')).toContainText(
    'needs a control node'
  );
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('Fix the problems');
  await expect(page.locator('results-panel .series-line')).toHaveCount(0);
});

test('the icon view draws symbols as pictures: built-in, picked, or your own (FR-EDIT-014)', async ({
  page,
}) => {
  await openExample(page, 'grassland');
  const toggle = page.getByRole('button', { name: /^Icons/ });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-node="sun"] .picture')).toHaveCount(0);
  await toggle.click();
  // Each symbol type has a default picture.
  await expect(page.locator('[data-node="sun"] use.picture')).toHaveAttribute('href', '#icon-sun');
  await expect(page.locator('[data-node="grass"] use.picture')).toHaveAttribute(
    'href',
    '#icon-leaf'
  );

  // Pick another built-in for one symbol.
  await page.locator('[data-node="grazers"] .shape').click();
  await page.locator('inspector-panel select[name="icon"]').selectOption('builtin:people');
  await expect(page.locator('[data-node="grazers"] use.picture')).toHaveAttribute(
    'href',
    '#icon-people'
  );

  // Or add your own picture, which the model keeps.
  await page.locator('inspector-panel input[name="icon-file"]').setInputFiles({
    name: 'cow.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>'
    ),
  });
  await expect(page.locator('[data-node="grazers"] image.picture')).toHaveAttribute(
    'href',
    /^data:image\/svg\+xml;base64,/
  );
  await expect(page.locator('inspector-panel select[name="icon"]')).toHaveValue('icon_cow');
  await page.keyboard.press('Escape');
  await page.locator('diagram-canvas svg.canvas').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('inspector-panel .own-icon[data-icon="icon_cow"]')).toContainText(
    '1 symbol'
  );
});
