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

test('a packed group shows which symbol inside each flow reaches, and what the kernel runs (FR-GRP-001)', async ({
  page,
}) => {
  await openExample(page, 'water');
  const home = group(page, 'home');
  // Odum's inset: the water tank and the bank account, drawn small inside Home.
  await expect(home.locator('.inner-port')).toHaveCount(2);
  await expect(home.locator('.inner-port[data-inner="tank"]')).toHaveCount(1);
  await expect(page.locator('g.edge.bundle[data-bundle="node:dam>group:home@tank"]')).toHaveCount(
    1
  );
  // One transaction flow to a port keeps its diamond and its money dash.
  await expect(
    page.locator('g.edge.bundle[data-bundle="node:dam>group:home@tank"] .transaction')
  ).toHaveCount(1);
  await expect(
    page.locator('g.edge.bundle[data-bundle="group:home@bank>node:revenue"]')
  ).toHaveClass(/kind-monetary/);

  // The inspector lists every flow across the edge and the symbol inside it reaches.
  await home.locator('.group-body').click();
  const rows = page.locator('inspector-panel .crossing tr[data-flow]');
  await expect(rows).toHaveCount(3);
  await expect(page.locator('inspector-panel .crossing tr[data-flow="supply"]')).toContainText(
    'Water tank'
  );

  // And shows the kernel's own JSON for it: no group in it, the real ends.
  await page.getByRole('button', { name: 'See this group in the kernel model' }).click();
  const json = page.locator('inspector-panel dialog.kernel-json pre.json');
  await expect(json).toContainText('"origin": "dam"');
  await expect(json).toContainText('"target": "tank"');
  await expect(json).not.toContainText('home');
  await page.keyboard.press('Escape');
  await expect(page.locator('inspector-panel dialog.kernel-json')).toHaveCount(0);

  // Wire straight onto a symbol inside, without unpacking.
  await page.locator('[data-node="wages"]').hover();
  const a = await page.locator('[data-port="wages"]').boundingBox();
  const b = await home.locator('.inner-port[data-inner="tank"]').boundingBox();
  await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2);
  await page.mouse.down();
  await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('inspector-panel')).toContainText('wages_to_tank');
});
