import { expect, test } from './fixtures.ts';
import { openExample, run } from './helpers.ts';

/** NFR-PRIV-003: nothing leaves the app origin while a model is built and run. */
test('no request goes outside the app origin', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const foreign: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return;
    if (url.origin !== origin) foreign.push(req.url());
  });
  await openExample(page, 'economy');
  await run(page);
  await page.goto('kernel');
  await expect(page.locator('.k-status')).toHaveText(/Verified/);
  expect(foreign).toEqual([]);
});
