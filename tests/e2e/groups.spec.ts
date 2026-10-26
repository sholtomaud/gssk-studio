import { expect, test } from './fixtures.ts';
import { clickEdge, openExample, run } from './helpers.ts';

const group = (page: import('@playwright/test').Page, id: string) =>
  page.locator(`diagram-canvas .node.group[data-group="${id}"]`);

test('a packed group is one symbol with one combined flow; unpack and pack it (FR-GRP-001)', async ({
  page,
}) => {
  await openExample(page, 'budget');
  await expect(group(page, 'expenses')).toHaveCount(1);
  await expect(page.locator('[data-node="rent"]')).toHaveCount(0);
  const bundle = page.locator('g.edge.bundle[data-bundle="node:bank>group:expenses"]');
  await expect(bundle.locator('.bundle-count')).toHaveText('11 flows');

  await run(page);
  await expect(bundle.locator('.bundle-reading')).toHaveText(/^ΣJ [\d,.]+$/);
  // Packing is a view: it does not make the run stale.
  await group(page, 'expenses').dblclick();
  await expect(page.locator('[data-node="rent"]')).toHaveCount(1);
  await expect(page.locator('.group-frame[data-group="housing"]')).toHaveCount(1);
  await expect(group(page, 'renewals')).toHaveCount(1);
  await expect(page.locator('results-panel .status')).not.toContainText('Model changed');

  await page.locator('.group-frame[data-group="expenses"] .group-toggle').click();
  await expect(group(page, 'expenses')).toHaveCount(1);
  await expect(page.locator('[data-node="rent"]')).toHaveCount(0);
});

test('a combined flow lists its flows, and a link unpacks to one (FR-GRP-001)', async ({
  page,
}) => {
  await openExample(page, 'budget');
  await clickEdge(page, 'node:bank>group:expenses');
  await expect(page.locator('inspector-panel .bundle-flows tbody tr')).toHaveCount(11);
  await page
    .locator('inspector-panel .bundle-flows')
    .getByRole('button', { name: 'computer_bill' })
    .click();
  await expect(page.locator('[data-edge="computer_bill"]')).toHaveCount(1);
  await expect(page.locator('inspector-panel .kind .s')).toHaveText('computer_bill');
});

test('group selected symbols with Ctrl+G, then ungroup them (FR-GRP-001)', async ({ page }) => {
  await openExample(page, 'household');
  await page.getByRole('button', { name: 'Storage: Bank account' }).click();
  await page.getByRole('button', { name: 'Storage: Investments' }).click({ modifiers: ['Shift'] });
  await page.locator('diagram-canvas svg.canvas').focus();
  await page.keyboard.press('Control+g');
  await expect(page.locator('diagram-canvas .node.group')).toHaveCount(1);
  await expect(page.locator('[data-node="bank"]')).toHaveCount(0);
  await page.locator('inspector-panel input[name="label"]').fill('Money');
  await expect(page.locator('diagram-canvas .node.group .label')).toHaveText('Money');
  await run(page);
  await expect(page.locator('diagram-canvas .node.group .reading')).toHaveText(/^Σ [\d,.]+$/);
  await page.getByRole('button', { name: 'Ungroup' }).click();
  await expect(page.locator('diagram-canvas .node.group')).toHaveCount(0);
  await expect(page.locator('[data-node="bank"]')).toHaveCount(1);
  await page.locator('diagram-canvas svg.canvas').focus();
  await page.keyboard.press('Control+z');
  await expect(page.locator('diagram-canvas .node.group')).toHaveCount(1);
});

test('a packed group shows the worst problem inside it (FR-VAL-002)', async ({ page }) => {
  await openExample(page, 'budget');
  await expect(group(page, 'expenses')).not.toHaveClass(/invalid/);
  await group(page, 'expenses').dblclick();
  await page.getByRole('button', { name: 'Heat sink: Rent' }).click();
  const id = page.locator('inspector-panel input[name="id"]');
  await id.fill('my rent');
  await id.press('Enter');
  await page.locator('.group-frame[data-group="expenses"] .group-toggle').click();
  await expect(group(page, 'expenses')).toHaveClass(/invalid/);
  await expect(group(page, 'expenses').locator('.badge.error title')).toContainText(
    'not a usable id'
  );
});
