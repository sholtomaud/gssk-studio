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

async function openAssistant(page: Page): Promise<void> {
  await page.goto('./');
  await page.getByRole('button', { name: 'New model' }).click();
  await page.getByRole('button', { name: /Assistant/ }).click();
  await page.locator('assistant-panel button[name="assistant-toggle"]').click();
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
  const consent = page.locator('assistant-panel dialog.consent');
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
    .locator('assistant-panel dialog.consent')
    .getByRole('button', { name: 'Don’t send' })
    .click();
  await expect(page.locator('assistant-panel .note')).toHaveText('Not sent.');
  expect(seen).toEqual([]);
});
