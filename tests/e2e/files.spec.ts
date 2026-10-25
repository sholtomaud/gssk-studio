import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures.ts';
import { openExample } from './helpers.ts';

test('export a model, then import it back unchanged', async ({ page }) => {
  await openExample(page, 'reservoir');
  const download = page.waitForEvent('download');
  await page.getByText('Export', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Model (.gssk.json)' }).click();
  const file = await (await download).path();
  const text = readFileSync(file, 'utf8');
  expect(JSON.parse(text).metadata.name).toBe('Reservoir');

  await page.goto('./');
  await page.locator('library-page input[type="file"]').setInputFiles({
    name: 'Reservoir.gssk.json',
    mimeType: 'application/json',
    buffer: Buffer.from(text),
  });
  await expect(page.locator('studio-page .toolbar .name')).toHaveText('Reservoir');
  await expect(page.locator('diagram-canvas [data-node]')).toHaveCount(4);
});

test('import a gssk-dia model and list what changed', async ({ page }) => {
  await page.goto('./');
  await page
    .locator('library-page input[type="file"]')
    .setInputFiles('tests/fixtures/gssk-dia-personal-finance.json');
  await expect(page.locator('diagram-canvas [data-node]')).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Transaction: Market' })).toBeVisible();
  await expect(page.locator('inspector-panel .issues')).toContainText('Import:');
});

test('export the diagram as SVG and PNG (FR-IO-004)', async ({ page }) => {
  await openExample(page, 'grassland');
  await page.getByText('Export', { exact: true }).click();
  let download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Diagram (SVG)' }).click();
  const svg = readFileSync(await (await download).path(), 'utf8');
  expect(svg).toMatch(/^<\?xml/);
  expect(svg).toContain('id="odum-producer"');
  expect(svg).toContain('Grass');
  // Standalone: no theme variables, no editing chrome.
  expect(svg).not.toContain('var(--');
  expect(svg).not.toContain('data-port');

  await page.getByText('Export', { exact: true }).click();
  download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Diagram (PNG)' }).click();
  const png = readFileSync(await (await download).path());
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect(png.length).toBeGreaterThan(5000);
});
