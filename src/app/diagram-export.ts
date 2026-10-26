/**
 * The diagram as a standalone picture (FR-IO-004): an SVG file, or a PNG
 * rendered from it. Colours, strokes and fonts come from the app's theme
 * through CSS variables, which a file opened elsewhere does not have, so the
 * computed paint of every element is written onto it.
 */
import { bounds, SIZE } from '../diagram/geometry.ts';
import type { StudioModel } from '../model/types.ts';

const PAINT = [
  'color',
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-linejoin',
  'stroke-linecap',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'text-transform',
  'text-anchor',
] as const;

/** Editing chrome that has no place in a picture of the model. */
const CHROME =
  '.port, .halo, .handle, .handle-line, .wire, .marquee, .hit, .grab, .resize, .badge, title';

export function diagramSvg(canvas: SVGSVGElement, model: StudioModel, background: string): string {
  const copy = canvas.cloneNode(true) as SVGSVGElement;
  // Inline computed paint, walking the original and the copy in step.
  const from = [canvas, ...canvas.querySelectorAll('*')];
  const to = [copy, ...copy.querySelectorAll('*')];
  from.forEach((src, i) => {
    const dst = to[i];
    if (!(dst instanceof SVGElement) || src.closest('symbol')) return;
    const cs = getComputedStyle(src);
    const style = PAINT.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';');
    dst.setAttribute('style', style);
  });
  for (const el of copy.querySelectorAll(CHROME)) el.remove();
  for (const el of copy.querySelectorAll('[class]')) el.removeAttribute('class');
  for (const el of copy.querySelectorAll('*')) {
    for (const a of [...el.attributes])
      if (a.name.startsWith('data-') || a.name.startsWith('aria-')) el.removeAttribute(a.name);
    el.removeAttribute('tabindex');
  }
  copy.querySelector('.bg')?.remove();
  for (const el of copy.querySelectorAll('rect')) {
    if (el.getAttribute('fill') === 'url(#grid)') el.remove();
  }
  const world = copy.querySelector('g');
  world?.removeAttribute('transform');

  const pts = [
    ...model.nodes.map((n) => ({ x: n.visual.x, y: n.visual.y })),
    ...model._diagram.boundaries.flatMap((b) => [
      { x: b.x, y: b.y },
      { x: b.x + b.w, y: b.y + b.h },
    ]),
  ];
  const box = bounds(pts, SIZE);
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('viewBox', `${box.x} ${box.y} ${box.w} ${box.h}`);
  copy.setAttribute('width', String(Math.round(box.w)));
  copy.setAttribute('height', String(Math.round(box.h)));
  copy.removeAttribute('tabindex');
  copy.removeAttribute('role');
  copy.setAttribute('role', 'img');
  copy.setAttribute('aria-label', model.metadata.name);
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('x', String(box.x));
  bg.setAttribute('y', String(box.y));
  bg.setAttribute('width', String(box.w));
  bg.setAttribute('height', String(box.h));
  bg.setAttribute('fill', background);
  copy.querySelector('defs')?.after(bg);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(copy)}\n`;
}

/** The SVG drawn at `scale` × its size, as a PNG blob. */
export async function svgToPng(svgText: string, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = Math.ceil(img.naturalWidth * scale);
    c.height = Math.ceil(img.naturalHeight * scale);
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas');
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise<Blob>((resolve, reject) =>
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png')
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
