/**
 * The icon view (FR-EDIT-014): pictures a symbol can be drawn as instead of
 * its Energese symbol, as Odum and Odum set EXTEND's icons beside the energy
 * diagram of a pond. A built-in set of line icons, one the default for each
 * symbol type, and more to pick per symbol; a model may add its own
 * (`_diagram.icons`, src/model/icons.ts).
 *
 * 24 × 24 viewBox, drawn in `currentColor`, every shape with its own paint
 * (FR-EDIT-009). Static markup, never built from data.
 */
import type { NodeType } from '../model/types.ts';

const LINE =
  'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
const DOT = 'fill="currentColor" stroke="none"';

export interface BuiltinIcon {
  /** Referred to from a node as `builtin:<name>`. */
  name: string;
  label: string;
  markup: string;
}

export const BUILTIN_ICONS: readonly BuiltinIcon[] = [
  {
    name: 'sun',
    label: 'Sun',
    markup: `<circle cx="12" cy="12" r="4" ${LINE} /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" ${LINE} />`,
  },
  {
    name: 'tank',
    label: 'Tank',
    markup: `<ellipse cx="12" cy="6" rx="7" ry="2.5" ${LINE} /><path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" ${LINE} />`,
  },
  {
    name: 'heat',
    label: 'Heat',
    markup: `<path d="M8 19c-1.5-2 1.5-3.5 0-5.5S9.5 10 8 8M12 19c-1.5-2 1.5-3.5 0-5.5S13.5 10 12 8M16 19c-1.5-2 1.5-3.5 0-5.5S17.5 10 16 8M4 21h16" ${LINE} />`,
  },
  {
    name: 'constant',
    label: 'Constant',
    markup: `<rect x="4" y="4" width="16" height="16" rx="2" ${LINE} /><path d="M8 10h8M8 14h8" ${LINE} />`,
  },
  {
    name: 'leaf',
    label: 'Plant',
    markup: `<path d="M5 19C5 11 10 5 19 5c0 9-6 14-14 14zM5 19l8-8" ${LINE} />`,
  },
  {
    name: 'person',
    label: 'Person',
    markup: `<circle cx="12" cy="7" r="3.5" ${LINE} /><path d="M5 21c0-4 3.1-7 7-7s7 3 7 7" ${LINE} />`,
  },
  {
    name: 'interaction',
    label: 'Multiply',
    markup: `<circle cx="12" cy="12" r="8" ${LINE} /><path d="M9 9l6 6M15 9l-6 6" ${LINE} />`,
  },
  {
    name: 'swap',
    label: 'Exchange',
    markup: `<path d="M4 8h14l-3-3M20 16H6l3 3" ${LINE} />`,
  },
  {
    name: 'switch',
    label: 'Switch',
    markup: `<rect x="3" y="8" width="18" height="8" rx="4" ${LINE} /><circle cx="16" cy="12" r="2.2" ${LINE} />`,
  },
  {
    name: 'amplifier',
    label: 'Amplifier',
    markup: `<path d="M6 5l13 7-13 7zM9 10v4M7 12h4" ${LINE} />`,
  },
  {
    name: 'dish',
    label: 'Receiver',
    markup: `<path d="M4 13a8 8 0 0 0 9-9zM8.5 8.5L15 4M8 15l-2 6h8l-2-4" ${LINE} />`,
  },
  {
    name: 'box',
    label: 'Box',
    markup: `<path d="M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10" ${LINE} />`,
  },
  {
    name: 'bank',
    label: 'Bank',
    markup: `<path d="M3 9l9-6 9 6zM5.5 9v9M10 9v9M14 9v9M18.5 9v9M4 18h16M3 21h18" ${LINE} />`,
  },
  {
    name: 'money',
    label: 'Money',
    markup: `<circle cx="12" cy="12" r="9" ${LINE} /><path d="M15 9c-.5-1.2-1.7-2-3-2-1.7 0-3 1-3 2.5s1.3 2.1 3 2.5 3 1 3 2.5-1.3 2.5-3 2.5c-1.3 0-2.5-.8-3-2M12 5.5v13" ${LINE} />`,
  },
  {
    name: 'house',
    label: 'House',
    markup: `<path d="M3 11l9-8 9 8M5 9.5V21h14V9.5M10 21v-6h4v6" ${LINE} />`,
  },
  {
    name: 'people',
    label: 'People',
    markup: `<circle cx="9" cy="8" r="3" ${LINE} /><circle cx="17" cy="9" r="2.5" ${LINE} /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 14c3 0 5 2.2 5 5" ${LINE} />`,
  },
  {
    name: 'water',
    label: 'Water',
    markup: `<path d="M12 3c4 5 6 8.5 6 11a6 6 0 0 1-12 0c0-2.5 2-6 6-11z" ${LINE} />`,
  },
  {
    name: 'rain',
    label: 'Rain',
    markup: `<path d="M7 15a4 4 0 0 1 0-8 5 5 0 0 1 9.5-1A3.5 3.5 0 0 1 17 15zM8 18l-1 2M12 18l-1 2M16 18l-1 2" ${LINE} />`,
  },
  {
    name: 'electricity',
    label: 'Electricity',
    markup: `<path d="M13 2L4 14h7l-1 8 9-12h-7z" ${LINE} />`,
  },
  {
    name: 'battery',
    label: 'Battery',
    markup: `<rect x="3" y="7" width="16" height="10" rx="2" ${LINE} /><path d="M21 10v4M7 10v4M11 10v4" ${LINE} />`,
  },
  {
    name: 'factory',
    label: 'Factory',
    markup: `<path d="M3 21V10l5 3v-3l5 3v-3l5 3V4h3v17zM3 21h18" ${LINE} />`,
  },
  {
    name: 'tree',
    label: 'Tree',
    markup: `<path d="M12 3l6 8h-3l4 6H5l4-6H6zM12 17v4" ${LINE} />`,
  },
  {
    name: 'fish',
    label: 'Fish',
    markup: `<path d="M3 12c3-5 10-6 15 0-5 6-12 5-15 0zM18 12l3-3v6z" ${LINE} /><circle cx="8" cy="11" r="0.9" ${DOT} />`,
  },
  {
    name: 'car',
    label: 'Vehicle',
    markup: `<path d="M3 16v-4l2-5h14l2 5v4zM5 12h14" ${LINE} /><circle cx="7" cy="17" r="2" ${LINE} /><circle cx="17" cy="17" r="2" ${LINE} />`,
  },
];

/** The icon each symbol type is drawn as in the icon view, unless the symbol picks another. */
export const DEFAULT_ICON: Readonly<Record<NodeType, string>> = {
  source: 'sun',
  storage: 'tank',
  sink: 'heat',
  constant: 'constant',
  producer: 'leaf',
  consumer: 'person',
  interaction: 'interaction',
  exchange: 'swap',
  switch: 'switch',
  gain: 'amplifier',
  loop_limited: 'dish',
  misc_box: 'box',
};

export const ICON_DEFS = BUILTIN_ICONS.map(
  (i) => `<symbol id="icon-${i.name}" viewBox="0 0 24 24">${i.markup}</symbol>`
).join('\n');

export function builtinIcon(name: string): BuiltinIcon | undefined {
  return BUILTIN_ICONS.find((i) => i.name === name);
}
