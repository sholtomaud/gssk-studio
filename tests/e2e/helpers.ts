import { expect, type Page } from './fixtures.ts';

/** Open a copy of a built-in example in the studio. */
export async function openExample(page: Page, id: string): Promise<void> {
  await page.goto('./');
  await page.locator(`[data-example="${id}"]`).getByRole('button', { name: 'Open a copy' }).click();
  await expect(page.locator('studio-page .toolbar .name')).not.toBeEmpty();
  await expect(page.locator('diagram-canvas [data-node]').first()).toBeVisible();
}

/** Screen point halfway along a flow's curve (its bounding-box centre is off the curve). */
async function edgeMidpoint(
  page: Page,
  edgeId: string,
  at = 0.5
): Promise<{ x: number; y: number }> {
  return page
    .locator(`[data-edge="${edgeId}"] .line, [data-bundle="${edgeId}"] .line`)
    .evaluate((el, at) => {
      const path = el as SVGPathElement;
      const p = path.getPointAtLength(path.getTotalLength() * at);
      const m = path.getScreenCTM();
      if (!m) throw new Error('edge not rendered');
      return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
    }, at);
}

/** Click a flow (or a combined flow, by its bundle id) on its curve, selecting it. */
export async function clickEdge(page: Page, edgeId: string): Promise<void> {
  // A quarter of the way along: clear of the count and reading at the midpoint.
  const p = await edgeMidpoint(page, edgeId, 0.25);
  await page.mouse.click(p.x, p.y);
}

/**
 * Drag from a node's port onto another node (`node:<id>`) or flow (`edge:<id>`),
 * dropping a quarter of the way along a flow, clear of the symbols at its ends.
 */
export async function wire(page: Page, from: string, onto: string): Promise<void> {
  await page.locator(`[data-node="${from}"]`).hover();
  const a = await page.locator(`[data-port="${from}"]`).boundingBox();
  if (!a) throw new Error('wire: port not visible');
  const [kind, id = ''] = onto.split(':');
  let to: { x: number; y: number };
  if (kind === 'edge') to = await edgeMidpoint(page, id, 0.25);
  else {
    const b = await page.locator(`[data-node="${id}"]`).boundingBox();
    if (!b) throw new Error('wire: target not visible');
    to = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

export async function run(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('results-panel .status')).toContainText('steps');
}
