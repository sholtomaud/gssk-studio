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

/** The page may reach only its own origin and the assistant's providers (ADR 0016). */
test('the CSP lists only its own origin and the assistant’s providers', async ({ page }) => {
  await page.goto('./');
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  const connect = csp?.split(';').find((d) => d.trim().startsWith('connect-src'));
  expect(connect?.trim().split(/\s+/).slice(1)).toEqual([
    "'self'",
    'http://localhost:*',
    'http://127.0.0.1:*',
    'https://api.anthropic.com',
    'https://api.openai.com',
    'https://generativelanguage.googleapis.com',
    'https://openrouter.ai',
  ]);
});
