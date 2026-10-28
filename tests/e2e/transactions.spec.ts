import { expect, test } from './fixtures.ts';
import { clickEdge, edgeMidpoint, openExample, run } from './helpers.ts';

test('drag a transaction onto a flow; it is invalid until its money counter-flow (FR-TRX-001)', async ({
  page,
}) => {
  await openExample(page, 'purchases');
  await clickEdge(page, 'stream');
  await page.getByRole('button', { name: 'Remove transaction' }).click();
  await expect(page.locator('[data-edge="stream"] .transaction')).toHaveCount(0);
  await expect(page.locator('studio-page .badge').filter({ hasText: 'Checks pass' })).toBeVisible();

  // Drop the palette's Transaction on the flow, as with the sensor.
  const p = await edgeMidpoint(page, 'stream', 0.3);
  const canvas = await page.locator('diagram-canvas svg.canvas').boundingBox();
  await page
    .getByRole('button', { name: 'Add transaction' })
    .dragTo(page.locator('diagram-canvas svg.canvas'), {
      targetPosition: { x: p.x - canvas!.x, y: p.y - canvas!.y },
    });
  await expect(page.locator('[data-edge="stream"] .transaction')).toHaveCount(1);
  await expect(page.locator('g.edge[data-edge="stream"]')).toHaveClass(/invalid/);
  await expect(page.locator('inspector-panel .warn-text')).toContainText('money counter-flow');

  await page.locator('inspector-panel select[name="payer"]').selectOption('bank');
  await page.locator('inspector-panel select[name="payee"]').selectOption('streamer');
  await page.locator('inspector-panel input[name="counter-k"]').fill('22');
  await page.getByRole('button', { name: 'Add counter-flow' }).click();
  await expect(page.locator('g.edge[data-edge="stream"]')).not.toHaveClass(/invalid/);
  await expect(page.locator('studio-page .badge').filter({ hasText: 'Checks pass' })).toBeVisible();
  await expect(page.locator('g.edge[data-edge="stream_payment"]')).toHaveClass(/kind-monetary/);
  await expect(page.locator('diagram-canvas .pair-link')).toHaveCount(2);

  await run(page);
  await expect(page.locator('[data-edge="stream"] .price-reading')).toHaveText('0.44 AUD/GBy');
});

test('money draws dashed and information dotted; carriers are edited on the model (FR-TYP-001)', async ({
  page,
}) => {
  await openExample(page, 'purchases');
  await expect(page.locator('g.edge[data-edge="power_bill"]')).toHaveClass(/kind-monetary/);
  await expect(page.locator('g.edge[data-edge="stream"]')).toHaveClass(/kind-information/);
  await expect(page.locator('g.edge[data-edge="power"]')).toHaveClass(/kind-energy/);
  await expect(page.locator('inspector-panel .carrier')).toHaveCount(3);
  await page.locator('inspector-panel select[name="add-carrier"]').selectOption('water');
  await expect(page.locator('inspector-panel .carrier[data-carrier="water"]')).toContainText(
    'material'
  );
  // A currency that is not ISO 4217 is an error the checks name.
  await page.locator('inspector-panel input[name="carrier-currency-aud"]').fill('ZZZ');
  await expect(page.locator('inspector-panel .issues li.error')).toContainText('ISO 4217');
});

test('the Transaction tool explains itself when no flow is selected', async ({ page }) => {
  await openExample(page, 'purchases');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await expect(page.locator('.toast')).toContainText('Select a flow first');
});
