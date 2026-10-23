/** A standalone SVG of one Odum symbol, for the palette and the inspector. */
import { symbolFor } from '../model/catalogue.ts';
import type { NodeType } from '../model/types.ts';
import { SYMBOL_DEFS } from '../diagram/symbols.ts';
import { svg } from './ui.ts';

let defs: Element | null = null;

export function symbolIcon(type: NodeType): SVGSVGElement {
  const s = svg('svg', { class: 'sym', viewBox: '0 0 100 100', 'aria-hidden': 'true' });
  if (!defs) {
    defs = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    // Static markup from symbols.ts, never data.
    defs.innerHTML = SYMBOL_DEFS;
  }
  const sym = defs.querySelector(`#${symbolFor(type).symbol}`);
  if (sym) for (const c of sym.children) s.append(c.cloneNode(true));
  return s;
}
