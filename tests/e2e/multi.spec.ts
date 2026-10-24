import { expect, test } from './fixtures.ts';
import { openExample } from './helpers.ts';

test('shift-click selects several symbols; align and duplicate them (FR-EDIT-011/012)', async ({
  page,
}) => {
  await openExample(page, 'grassland');
  await page.getByRole('button', { name: 'Source: Sunlight' }).click();
  await page.getByRole('button', { name: 'Heat sink: Heat' }).click({ modifiers: ['Shift'] });
  await expect(page.locator('inspector-panel')).toContainText('2 symbols selected');
  await page.getByRole('button', { name: 'Top', exact: true }).click();
  const y = (id: string) =>
    page.locator(`[data-node="${id}"]`).evaluate((el) => el.getAttribute('transform'));
  expect(await y('heat')).toMatch(/ 260\)$/);

  await page.locator('diagram-canvas svg.canvas').focus();
  await page.keyboard.press('Control+d');
  await expect(page.locator('diagram-canvas [data-node]')).toHaveCount(6);
  await expect(page.locator('[data-node="sun_2"]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Delete');
  await expect(page.locator('diagram-canvas [data-node]')).toHaveCount(4);
});

test('shift-drag on empty canvas selects by marquee', async ({ page }) => {
  await openExample(page, 'predator-prey');
  const box = await page.locator('diagram-canvas svg.canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  await page.keyboard.down('Shift');
  await page.mouse.move(box.x + 4, box.y + 4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(page.locator('inspector-panel')).toContainText('4 symbols selected');
});
