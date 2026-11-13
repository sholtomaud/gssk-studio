/**
 * A storage's fill colour: what its level is drawn in (FR-RES-003). Each
 * symbol that holds something can have its own, so water, grass and gold
 * read apart at a glance; unset, it is the theme's light gray. Editor-only:
 * it lives in `visual`, which the kernel never sees.
 */
import { cloneModel, type StudioModel } from './types.ts';

/** Only `#rrggbb`: the colour input's own form, and nothing CSS could read as more. */
export function isFillColour(s: unknown): s is string {
  return typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s);
}

/** Colours to start from, offered beside the colour picker. */
export const FILL_SWATCHES: readonly { label: string; colour: string }[] = [
  { label: 'Water', colour: '#86b6ef' },
  { label: 'Plants', colour: '#8fca7a' },
  { label: 'Gold', colour: '#e3c35a' },
  { label: 'Soil', colour: '#b58a63' },
  { label: 'Fuel', colour: '#6f6f78' },
  { label: 'Heat', colour: '#ef8a6b' },
];

/** Set a symbol's fill colour, or clear it back to the default with undefined. */
export function setNodeFill(m: StudioModel, nodeId: string, fill: string | undefined): StudioModel {
  if (fill !== undefined && !isFillColour(fill)) return m;
  const at = m.nodes.findIndex((x) => x.id === nodeId);
  if (at < 0 || m.nodes[at]!.visual.fill === fill) return m;
  const next = cloneModel(m);
  const n = next.nodes[at]!;
  if (fill) n.visual.fill = fill.toLowerCase();
  else delete n.visual.fill;
  return next;
}
