/**
 * Odum Energy Systems Language symbols as SVG <symbol>s, after gssk-dia's
 * translation of tikz-odum.sty (Odum 1983). Every symbol has a 100 × 100
 * viewBox centred on (50, 50) and draws in `currentColor`, so themes recolour
 * them. Static markup, never built from data.
 *
 * Paint is set with presentation attributes on each shape, not with page CSS:
 * the copy a <use> renders is a shadow tree that stylesheet selectors do not
 * reliably reach, and unstyled SVG fills black (FR-EDIT-009).
 */
const LINE = 'fill="none" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"';
const SOLID = 'fill="currentColor" stroke="none"';

export const SYMBOL_DEFS = `
<symbol id="odum-source" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="32" ${LINE} />
</symbol>
<symbol id="odum-storage" viewBox="0 0 100 100">
  <path d="M15,50 L15,44.75 L50,22 L85,44.75 L85,50 A35,35 0 0 1 15,50 Z" ${LINE} />
</symbol>
<symbol id="odum-sink" viewBox="0 0 100 100">
  <line x1="50" y1="20" x2="50" y2="58" ${LINE} />
  <line x1="26" y1="58" x2="74" y2="58" ${LINE} />
  <line x1="34" y1="68" x2="66" y2="68" ${LINE} />
  <line x1="42" y1="78" x2="58" y2="78" ${LINE} />
</symbol>
<symbol id="odum-constant" viewBox="0 0 100 100">
  <rect x="22" y="22" width="56" height="56" rx="6" ${LINE} />
  <text x="50" y="60" text-anchor="middle" font-size="26" font-style="italic" font-weight="600" ${SOLID}>k</text>
</symbol>
<symbol id="odum-producer" viewBox="0 0 100 100">
  <path d="M5,25 L70,25 A25,25 0 0 1 70,75 L5,75 Z" ${LINE} />
</symbol>
<symbol id="odum-consumer" viewBox="0 0 100 100">
  <polygon points="50,16 79.4,33 79.4,67 50,84 20.6,67 20.6,33" ${LINE} />
</symbol>
<symbol id="odum-interaction" viewBox="0 0 100 100">
  <path d="M12,25 L67,25 L88,50 L67,75 L12,75 L30,50 Z" ${LINE} />
</symbol>
<symbol id="odum-transaction" viewBox="0 0 100 100">
  <polygon points="50,18 82,50 50,82 18,50" ${LINE} />
  <line x1="18" y1="50" x2="82" y2="50" ${LINE} />
</symbol>
<symbol id="odum-switch" viewBox="0 0 100 100">
  <path d="M15,15 C27.25,27.25 72.75,27.25 85,15 C72.75,27.25 72.75,72.75 85,85 C72.75,72.75 27.25,72.75 15,85 C27.25,72.75 27.25,27.25 15,15 Z" ${LINE} />
</symbol>
<symbol id="odum-amplifier" viewBox="0 0 100 100">
  <polygon points="30,26 30,74 72,50" ${LINE} />
</symbol>
<symbol id="odum-receiver" viewBox="0 0 100 100">
  <path d="M41,15 L50,15 A35,35 0 0 1 50,85 L41,85 Z" ${LINE} />
</symbol>
<symbol id="odum-box" viewBox="0 0 100 100">
  <rect x="15" y="28" width="70" height="44" rx="2" ${LINE} />
</symbol>
<symbol id="odum-gate" viewBox="0 0 40 40">
  <path d="M5,10 L27,10 L35,20 L27,30 L5,30 L12,20 Z" fill="inherit" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
</symbol>
<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
  <path d="M0,0 L10,5 L0,10 Z" ${SOLID} />
</marker>
`;
