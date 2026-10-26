import { expect, test, type Page } from './fixtures.ts';
import { openExample } from './helpers.ts';

/** tsrs.wasm is ~10 MB; its first check takes a few seconds. */
const CHECKED = { timeout: 30_000 };

async function openCode(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(page.locator('code-view .monaco-editor')).toBeVisible();
  await expect(page.locator('code-view .check')).toHaveText(/problem/, CHECKED);
}

/** Replace the editor's text, as a paste does. */
async function setScript(page: Page, text: string): Promise<void> {
  const editor = page.locator('code-view .monaco-editor');
  // Focus Monaco's input itself: a click on .view-lines aims at the middle of
  // the whole document, which can fall outside the visible editor.
  await editor.locator('.native-edit-context, textarea.inputarea').first().focus();
  await expect(editor).toHaveClass(/\bfocused\b/);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(text);
  await expect(editor.locator('.view-lines')).toContainText(text.split('\n')[1]!);
}

const nodes = (page: Page) => page.locator('diagram-canvas [data-node]');

test('the code view shows the model as checked Energese code, offline (FR-SDK-006)', async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const foreign: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (!['data:', 'blob:'].includes(url.protocol) && url.origin !== origin)
      foreign.push(req.url());
  });
  await openExample(page, 'grassland');
  await openCode(page);
  await expect(page.locator('code-view .state')).toHaveText('Generated from the model');
  await expect(page.locator('code-view .check')).toHaveText('No problems');
  await expect(page.locator('code-view .view-lines')).toContainText(
    "new ener.Model('Grassland food chain'"
  );
  await expect(page.locator('studio-page .palette')).toBeHidden();
  await page.getByRole('button', { name: 'Diagram', exact: true }).click();
  await expect(nodes(page)).toHaveCount(4);
  expect(foreign).toEqual([]);
});

test('a script with a type error is listed and not applied; fixed, it applies and undoes', async ({
  page,
}) => {
  await openExample(page, 'grassland');
  await openCode(page);
  const broken = [
    "import * as ener from 'energese';",
    "const m = new ener.Model('Two tanks', { tEnd: 10 });",
    "const a = new ener.Source(m, 'Tap', { value: 'lots' });",
    "const b = new ener.Storage(m, 'Tank');",
    'new ener.Flow(m, a, b, ener.linear(0.5));',
    'export default m;',
  ].join('\n');
  await setScript(page, broken);
  await expect(page.locator('code-view .state')).toHaveText('Edited, not applied');
  await expect(page.locator('code-view .problems')).toContainText('not assignable', CHECKED);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('Fix the problem');

  await setScript(page, broken.replace("'lots'", '10'));
  await expect(page.locator('code-view .check')).toHaveText('No problems', CHECKED);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('code-view .output')).toContainText('Applied: 2 symbols, 1 flows');
  await expect(page.locator('studio-page .toolbar .name')).toHaveText('Two tanks');
  // It places nothing, so it is not the model's generated form: it is kept as its script.
  await expect(page.locator('code-view .state')).toHaveText('The script that built this model');

  await page.getByRole('button', { name: 'Diagram', exact: true }).click();
  await expect(nodes(page)).toHaveCount(2);
  await page.getByRole('button', { name: /^Undo/ }).click();
  await expect(nodes(page)).toHaveCount(4);
});

test('a hand-written script builds the model and travels with it (FR-SDK-007)', async ({
  page,
}) => {
  await openExample(page, 'grassland');
  await openCode(page);
  const script = [
    "import * as ener from 'energese';",
    "const m = new ener.Model('Chain of five', { tEnd: 50, method: 'rk4' });",
    "let up: ener.NodeRef = new ener.Source(m, 'Sun', { value: 100 });",
    'for (let i = 1; i <= 5; i++) {',
    '  const here = new ener.Storage(m, `Tank ${i}`);',
    '  new ener.Flow(m, up, here, ener.linear(0.1));',
    '  up = here;',
    '}',
    "console.log('built', m.name);",
    'export default m;',
  ].join('\n');
  await setScript(page, script);
  await expect(page.locator('code-view .check')).toHaveText('No problems', CHECKED);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('code-view .output')).toContainText('built Chain of five');
  await expect(page.locator('code-view .state')).toHaveText('The script that built this model');

  await page.getByRole('button', { name: 'Diagram', exact: true }).click();
  await expect(nodes(page)).toHaveCount(6);
  // Saved with the model, the script is what the code view shows after a reload.
  await expect(page.locator('studio-page .saved')).toHaveText('Saved');
  await page.reload();
  await openCode(page);
  await expect(page.locator('code-view .state')).toHaveText('The script that built this model');
  await expect(page.locator('code-view .view-lines')).toContainText('for (let i = 1');

  // Edit the diagram: the script no longer describes the model, so the view says so.
  await page.getByRole('button', { name: 'Diagram', exact: true }).click();
  await page.getByRole('button', { name: 'Storage: Tank 5' }).click();
  await page.keyboard.press('Delete');
  await expect(nodes(page)).toHaveCount(5);
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(page.locator('code-view .state')).toHaveText('Generated from the model');
  await expect(page.locator('code-view .note')).toContainText('edited after its script last ran');
  await page.getByRole('button', { name: 'Last script', exact: true }).click();
  await expect(page.locator('code-view .state')).toHaveText(
    'The last script; the model has changed since it ran'
  );
});

test.describe('the sandbox', () => {
  test.use({ allowErrors: [/Content Security Policy|Refused to|dynamically imported module/] });

  test('a script cannot reach the network, even by a computed import (ADR 0013)', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    // Anything that gets past the page's CSP reaches this route and is recorded.
    const served: string[] = [];
    await page.route(
      (url) => url.origin !== origin,
      (route) => {
        served.push(route.request().url());
        return route.abort();
      }
    );
    const blocked: string[] = [];
    page.on('requestfailed', (req) => {
      if (req.failure()?.errorText === 'csp') blocked.push(req.url());
    });
    await openExample(page, 'grassland');
    await openCode(page);
    await setScript(
      page,
      [
        "import * as ener from 'energese';",
        "const url = ['https:', '', 'example.com', 'leak.js'].join('/');",
        'await import(url);',
        "export default new ener.Model('Never');",
      ].join('\n')
    );
    await expect(page.locator('code-view .check')).toHaveText('No problems', CHECKED);
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.locator('code-view .output .error')).toBeVisible();
    await expect(page.locator('studio-page .toolbar .name')).not.toHaveText('Never');
    expect(blocked).toEqual(['https://example.com/leak.js']);
    expect(served).toEqual([]);
  });
});
