/** Identifiers for nodes and edges: kernel-safe, readable, unique. */

/** The kernel caps ids at 63 bytes (C limit); composite member ids truncate past 29. */
export const MAX_ID = 29;

/** A slug from a label: lower-case words joined by `_`, safe for the kernel. */
export function slugify(label: string): string {
  const s = label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_ID)
    .replace(/_+$/, '');
  return s || 'n';
}

/** `base`, or `base_2`, `base_3` … — the first one not in `taken`. */
export function uniqueId(base: string, taken: ReadonlySet<string>): string {
  const b = slugify(base);
  if (!taken.has(b)) return b;
  for (let i = 2; ; i++) {
    const suffix = `_${i}`;
    const id = `${b.slice(0, MAX_ID - suffix.length)}${suffix}`;
    if (!taken.has(id)) return id;
  }
}
