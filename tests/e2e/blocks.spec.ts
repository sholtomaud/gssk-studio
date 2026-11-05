import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures.ts';
import { openExample, run } from './helpers.ts';

test('save a packed group as a building block, place it back, and run it on its own (ADR 0017)', async ({
  page,
}) => {
  await openExample(page, 'budget');
  await page.locator('diagram-canvas .node.group[data-group="expenses"]').click();
  const section = page.locator('inspector-panel section.block');
  await expect(section.locator('.trust')).toHaveText('Structural: its checks pass');
  await expect(section).toContainText('Ports: Rent (in)');

  await section.locator('summary', { hasText: 'Save as a building block' }).click();
  await section.locator('input[name="id"]').fill('test.expenses');
  const download = page.waitForEvent('download');
  await section.getByRole('button', { name: 'Save as a building block' }).click();
  const d = await download;
  expect(d.suggestedFilename()).toBe('test.expenses-1.0.0.gssk-block.json');
  const text = readFileSync(await d.path(), 'utf8');
  const block = JSON.parse(text) as {
    format: string;
    ports: unknown[];
    model: { nodes: unknown[] };
  };
  expect(block.format).toBe('gssk-block');
  expect(block.model.nodes).toHaveLength(11);

  await page.locator('diagram-canvas svg.canvas').click({ position: { x: 20, y: 20 } });
  await page.locator('inspector-panel input[name="block-file"]').setInputFiles({
    name: d.suggestedFilename(),
    mimeType: 'application/json',
    buffer: Buffer.from(text),
  });
  await expect(page.locator('diagram-canvas .node.group')).toHaveCount(2);
  await expect(section).toContainText('Placed from test.expenses 1.0.0');
  await section.getByRole('button', { name: 'Run it on its own' }).click();
  await expect(section.locator('.trust')).toHaveText('Runs: it runs cleanly on its own');
});

test('cite the dataset a value comes from, and see it counted in the run (ADR 0017)', async ({
  page,
}) => {
  await openExample(page, 'budget');
  await page.getByRole('button', { name: 'Source: Salary' }).click();
  const sources = page.locator('inspector-panel details.sources').first();
  await sources.locator('summary').click();
  await sources.locator('input[name="dataset"]').fill('ABS 6302.0 Average Weekly Earnings');
  await sources.locator('input[name="url"]').fill('https://www.abs.gov.au/');
  await sources.getByRole('button', { name: 'Cite' }).click();
  await expect(sources.locator('summary')).toHaveText('Sources (1)');
  await expect(sources.locator('ul.cited')).toContainText('ABS 6302.0 Average Weekly Earnings');
  await run(page);
  await expect(page.locator('results-panel .status')).toContainText('1 cited');
});
