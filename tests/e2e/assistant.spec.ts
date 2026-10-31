import { expect, test, type Page } from './fixtures.ts';

const LOCAL = 'http://127.0.0.1:8080/v1/chat/completions';

const calls = (...c: [string, unknown][]) => ({
  model: 'local',
  choices: [
    {
      message: {
        content: null,
        tool_calls: c.map(([name, args], i) => ({
          id: `c${i}`,
          type: 'function',
          function: { name, arguments: JSON.stringify(args) },
        })),
      },
      finish_reason: 'tool_calls',
    },
  ],
});
const words = (text: string) => ({
  model: 'local',
  choices: [{ message: { content: text }, finish_reason: 'stop' }],
});

/** A scripted local model: answers each request with the next reply, and records the requests. */
async function scriptedModel(
  page: Page,
  replies: unknown[]
): Promise<{ body: Record<string, unknown> }[]> {
  const seen: { body: Record<string, unknown> }[] = [];
  await page.route(LOCAL, async (route) => {
    seen.push({ body: route.request().postDataJSON() as Record<string, unknown> });
    await route.fulfill({ json: replies.shift() ?? words('…') });
  });
  return seen;
}

/** Choose the local model on Settings, then open a new model's assistant. */
async function openAssistant(page: Page): Promise<void> {
  await page.goto('settings');
  await page.locator('settings-page select[name="active"]').selectOption('local');
  await page.goto('./');
  await page.getByRole('button', { name: 'New model' }).click();
  await page.getByRole('button', { name: /Assistant/ }).click();
  await expect(page.locator('assistant-panel .using')).toContainText('Using Local model');
}

test('the assistant builds through cards you apply, marks its numbers, and strikes figures it made up (ADR 0016)', async ({
  page,
}) => {
  const seen = await scriptedModel(page, [
    calls(
      ['add_carrier', { id: 'water', label: 'Water', unit: 'kL', currency: null }],
      [
        'add_symbol',
        {
          type: 'source',
          label: 'Rain',
          x: 120,
          y: 200,
          value: 50,
          capacity: null,
          carrier: 'water',
          why: 'a wet month, in kL',
        },
      ],
      [
        'add_symbol',
        {
          type: 'storage',
          label: 'Water tank',
          x: 400,
          y: 200,
          value: null,
          capacity: null,
          carrier: 'water',
          why: null,
        },
      ],
      [
        'connect',
        {
          from: 'rain',
          to: 'water_tank',
          logic: null,
          k: 0.2,
          carrier: 'water',
          why: 'a fifth of the rain reaches the tank',
        },
      ]
    ),
    words('Rain of 50 kL now feeds a water tank. After a year it holds 731 kL.'),
  ]);
  await openAssistant(page);
  await page.locator('assistant-panel textarea').fill('Build a water tank fed by rain');
  await page.locator('assistant-panel textarea').press('Enter');

  // Nothing leaves without consent, and the person sees exactly what is sent.
  const consent = page.locator('consent-dialog dialog.consent');
  await expect(consent).toBeVisible();
  await expect(consent.locator('pre.payload')).toContainText('Build a water tank fed by rain');
  await consent.getByRole('button', { name: 'Send without asking until I reload' }).click();

  const card = page.locator('assistant-panel .card');
  await expect(card.locator('li')).toHaveCount(4);
  await expect(card).toContainText('Add storage “Water tank”');
  // The model on the canvas is unchanged until the card is applied.
  await expect(page.locator('diagram-canvas [data-node]')).toHaveCount(0);
  // 50 is the assistant's own input; 731 is in no tool result, so it is struck out.
  await expect(page.locator('assistant-panel s.unsupported')).toHaveText(['731']);

  await card.getByRole('button', { name: 'Apply' }).click();
  await expect(page.locator('diagram-canvas [data-node]')).toHaveCount(2);
  await expect(page.locator('[data-node="rain"] .assumed')).toHaveCount(1);
  await expect(page.locator('inspector-panel .issues li.info')).toContainText(
    '2 values were set by the assistant'
  );
  // The tool results went back to the model in the second request.
  expect(seen).toHaveLength(2);
  expect(JSON.stringify(seen[1]!.body.messages)).toContain('water_tank');

  // One undo step takes the whole card back.
  await page.locator('diagram-canvas svg.canvas').focus();
  await page.keyboard.press('Control+z');
  await expect(page.locator('diagram-canvas [data-node]')).toHaveCount(0);
});

test('the assistant sends nothing when you say no', async ({ page }) => {
  const seen = await scriptedModel(page, [words('Hello')]);
  await openAssistant(page);
  await page.locator('assistant-panel textarea').fill('Hello');
  await page.locator('assistant-panel textarea').press('Enter');
  await page
    .locator('consent-dialog dialog.consent')
    .getByRole('button', { name: 'Don’t send' })
    .click();
  await expect(page.locator('assistant-panel .note')).toHaveText('Not sent.');
  expect(seen).toEqual([]);
});

test('the assistant is off until chosen on Settings, and says how to start', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'New model' }).click();
  await page.getByRole('button', { name: /Assistant/ }).click();
  await expect(page.locator('assistant-panel .using')).toContainText('The assistant is off');
  await page.locator('assistant-panel .using a').click();
  await expect(page.locator('settings-page select[name="active"]')).toHaveValue('');
  // A hosted provider needs a key, held for this session only.
  await page.locator('settings-page select[name="active"]').selectOption('anthropic');
  await expect(page.locator('settings-page input[name="model"]')).toHaveValue('claude-opus-5-5');
  await page.locator('settings-page input[name="key"]').fill('sk-test');
  await page.locator('settings-page input[name="key"]').press('Tab');
  await expect(page.locator('settings-page .msg')).toHaveText('Key held for this session.');
  await page.getByRole('button', { name: 'Forget key' }).click();
  await expect(page.locator('settings-page input[name="key"]')).toHaveValue('');
  // The choice is remembered; a key never is.
  await page.reload();
  await expect(page.locator('settings-page select[name="active"]')).toHaveValue('anthropic');
  await expect(page.locator('settings-page input[name="key"]')).toHaveValue('');
});

test('sign in with OpenRouter: a key for the session, nothing to copy (ADR 0016)', async ({
  page,
}) => {
  // OpenRouter's sign-in page, mocked: it sends the person straight back with a code.
  await page.route('https://openrouter.ai/auth?**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<script>
        const q = new URLSearchParams(location.search);
        location.replace(q.get('callback_url') + '?code=one-time-code');
      </script>`,
    })
  );
  const exchange: Record<string, unknown>[] = [];
  await page.route('https://openrouter.ai/api/v1/auth/keys', async (route) => {
    exchange.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ json: { key: 'sk-or-test' } });
  });
  const chats: Record<string, string>[] = [];
  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    chats.push(route.request().headers());
    await route.fulfill({ json: words('Hello from OpenRouter.') });
  });

  await page.goto('settings');
  await page.locator('settings-page select[name="active"]').selectOption('openrouter');
  await page.getByRole('button', { name: 'Sign in with OpenRouter' }).click();

  // Back at Settings, the exchange asks first, like every call.
  const consent = page.locator('consent-dialog dialog.consent');
  await expect(consent).toContainText('Sign in: the one-time code');
  await consent.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('settings-page .msg')).toContainText('Signed in with OpenRouter');
  expect(exchange).toHaveLength(1);
  expect(exchange[0]).toMatchObject({ code: 'one-time-code', code_challenge_method: 'S256' });
  expect(String(exchange[0]!.code_verifier)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  // The code leaves the address bar; the key stays in memory only.
  expect(page.url()).not.toContain('code=');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('sk-or-test');
  await expect(page.locator('settings-page table.calls tbody tr')).toHaveCount(1);

  // The chat uses it, with the key going only to OpenRouter.
  await page.getByRole('link', { name: 'Models' }).click();
  await page.getByRole('button', { name: 'New model' }).click();
  await page.getByRole('button', { name: /Assistant/ }).click();
  await expect(page.locator('assistant-panel .using')).toContainText('Using OpenRouter');
  await page.locator('assistant-panel textarea').fill('Hi');
  await page.locator('assistant-panel textarea').press('Enter');
  await consent.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.locator('assistant-panel .msg.assistant')).toHaveText('Hello from OpenRouter.');
  expect(chats[0]?.authorization).toBe('Bearer sk-or-test');
});
