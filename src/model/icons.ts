/**
 * The model's own icons (FR-EDIT-014): pictures a symbol can be drawn as in
 * the icon view, kept in the model file (`_diagram.icons`) so they travel
 * with it. Each is an image as a base64 data URL. An image cannot run script
 * or load anything, so a picture from anywhere is safe to draw; its size is
 * capped so a model file stays small.
 */
import { uniqueId } from './ids.ts';
import { cloneModel, type Icon, type StudioModel } from './types.ts';

/** The largest picture a model keeps, as a data URL. */
export const MAX_ICON_CHARS = 200_000;

const HREF = /^data:image\/(?:svg\+xml|png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

/** A data URL the icon view will draw: an image type it knows, base64, not too large. */
export function isIconHref(href: string): boolean {
  return href.length <= MAX_ICON_CHARS && HREF.test(href);
}

export function iconsOf(m: StudioModel): Icon[] {
  return m._diagram.icons ?? [];
}

/** Add a picture to the model, optionally drawing a symbol as it. Refuses an unusable data URL. */
export function addIcon(
  m: StudioModel,
  label: string,
  href: string,
  forNode?: string
): { model: StudioModel; id: string | null } {
  if (!isIconHref(href)) return { model: m, id: null };
  const next = cloneModel(m);
  const taken = new Set([
    ...next.nodes.map((n) => n.id),
    ...next.edges.map((e) => e.id),
    ...iconsOf(next).map((i) => i.id),
  ]);
  const base =
    label
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/, '')
      .replace(/\W+/g, '_') || 'icon';
  const id = uniqueId(`icon_${base}`, taken);
  next._diagram.icons = [...iconsOf(next), { id, label: label.replace(/\.[a-z0-9]+$/i, ''), href }];
  const n = forNode ? next.nodes.find((x) => x.id === forNode) : undefined;
  if (n) n.visual.icon = id;
  return { model: next, id };
}

/** Remove one of the model's icons; symbols drawn as it go back to their default. */
export function removeIcon(m: StudioModel, id: string): StudioModel {
  const next = cloneModel(m);
  const icons = iconsOf(next).filter((i) => i.id !== id);
  if (icons.length) next._diagram.icons = icons;
  else delete next._diagram.icons;
  for (const n of next.nodes) if (n.visual.icon === id) delete n.visual.icon;
  return next;
}

/** Draw a symbol as an icon (`builtin:<name>` or a model icon id), or as its default (undefined). */
export function setNodeIcon(m: StudioModel, nodeId: string, icon: string | undefined): StudioModel {
  const next = cloneModel(m);
  const n = next.nodes.find((x) => x.id === nodeId);
  if (!n) return m;
  if (icon) n.visual.icon = icon;
  else delete n.visual.icon;
  return next;
}
