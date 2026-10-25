/** Small DOM helpers shared by components. Data goes in with textContent, never as HTML. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string>> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue;
    if (k === 'text') e.textContent = v;
    else if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) if (c) e.append(c);
  return e;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | undefined> = {}
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) e.setAttribute(k, String(v));
  return e;
}

/** Feather-style line icons, static markup. */
const ICONS: Record<string, string> = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="M11 8v6M8 11h6M20 20l-4-4"/>',
  zoomOut: '<circle cx="11" cy="11" r="7"/><path d="M8 11h6M20 20l-4-4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
  moon: '<path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  flow: '<path d="M4 6h16" style="stroke-width:1"/><path d="M4 12h16" style="stroke-width:2.4"/><path d="M4 18h16" style="stroke-width:4"/>',
  sensor: '<path d="M2 12h6M16 12h6"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  pin: '<path d="M9 4h6l-1 6 4 3v1H6v-1l4-3z"/><path d="M12 14v6"/>',
  frame: '<rect x="3" y="5" width="18" height="14" rx="1" stroke-dasharray="3 2"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 10h18M3 15h18M9 4v16"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="1"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
};

export function icon(name: keyof typeof ICONS | string): SVGSVGElement {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'icon-svg');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name] ?? '';
  return s;
}

export function iconButton(name: string, label: string, cls = 'ghost icon'): HTMLButtonElement {
  const b = el('button', { type: 'button', class: cls, 'aria-label': label, title: label });
  b.append(icon(name));
  return b;
}

let toastTimer = 0;
export function toast(message: string): void {
  document.querySelector('.toast')?.remove();
  const t = el('div', { class: 'toast', role: 'status', text: message });
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.remove(), 3500);
}

/** Save text as a file through the browser's download, nothing over the network. */
export function downloadText(name: string, text: string, type = 'application/json'): void {
  downloadBlob(name, new Blob([text], { type }));
}

export function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a < 0.001 || a >= 1e7)) return v.toExponential(2);
  return v.toLocaleString('en', { maximumFractionDigits: a < 1 ? 4 : a < 100 ? 2 : 1 });
}
