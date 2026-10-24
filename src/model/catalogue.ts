/**
 * The Odum symbol catalogue (SPEC §5.2): one entry per kernel node type, with
 * the symbol it is drawn with and what it means. The palette, the inspector
 * and the validator read this table; nothing else hard-codes node semantics.
 */
import type { EdgeLogic, NodeType } from './types.ts';

export interface SymbolSpec {
  type: NodeType;
  /** Odum's name for the symbol (Odum 1983), shown in the palette. */
  label: string;
  /** SVG <symbol> id in src/diagram/symbols.ts. */
  symbol: string;
  /** Half-extent of the drawn shape, for edge anchoring. */
  half: { w: number; h: number };
  /** The node integrates its flows (it has a level worth charting). */
  holdsState: boolean;
  /** A composite the kernel expands into several state columns at init. */
  composite: boolean;
  /**
   * Offered in the palette. Constant is not: it holds a value exactly as a
   * source does, so the palette's Source covers it; models that use it still
   * draw and run.
   */
  palette: boolean;
  /** What `value` means for this type, for the inspector. */
  valueLabel: string;
  summary: string;
}

export const CATALOGUE: readonly SymbolSpec[] = [
  {
    type: 'source',
    label: 'Source',
    symbol: 'odum-source',
    half: { w: 32, h: 32 },
    holdsState: false,
    composite: false,
    palette: true,
    valueLabel: 'Supply',
    summary: 'An outside energy or material input, held at a fixed level.',
  },
  {
    type: 'storage',
    label: 'Storage',
    symbol: 'odum-storage',
    half: { w: 35, h: 32 },
    holdsState: true,
    composite: false,
    palette: true,
    valueLabel: 'Initial quantity',
    summary: 'A tank: its quantity rises with inflows and falls with outflows.',
  },
  {
    type: 'sink',
    label: 'Heat sink',
    symbol: 'odum-sink',
    half: { w: 20, h: 30 },
    holdsState: true,
    composite: false,
    palette: true,
    valueLabel: 'Initial quantity',
    summary: 'Degraded energy leaving the system; accumulates what it receives.',
  },
  {
    type: 'constant',
    label: 'Constant',
    symbol: 'odum-constant',
    half: { w: 32, h: 32 },
    holdsState: false,
    composite: false,
    palette: false,
    valueLabel: 'Value',
    summary: 'A fixed force or level that flows can read.',
  },
  {
    type: 'producer',
    label: 'Producer',
    symbol: 'odum-producer',
    half: { w: 45, h: 25 },
    holdsState: true,
    composite: true,
    palette: true,
    valueLabel: 'Initial biomass',
    summary: 'Captures energy through a work gate into its body, losing heat to respiration.',
  },
  {
    type: 'consumer',
    label: 'Consumer',
    symbol: 'odum-consumer',
    half: { w: 30, h: 34 },
    holdsState: true,
    composite: true,
    palette: true,
    valueLabel: 'Initial biomass',
    summary: 'A self-maintaining storage that metabolises what it takes in.',
  },
  {
    type: 'interaction',
    label: 'Interaction',
    symbol: 'odum-interaction',
    half: { w: 30, h: 20 },
    holdsState: false,
    composite: false,
    palette: true,
    valueLabel: 'Level',
    summary: 'A work gate: its output is the product of its inputs.',
  },
  {
    type: 'exchange',
    label: 'Transaction',
    symbol: 'odum-transaction',
    half: { w: 32, h: 32 },
    holdsState: false,
    composite: false,
    palette: true,
    valueLabel: 'Level',
    summary: 'Goods one way, money the other, at a price.',
  },
  {
    type: 'switch',
    label: 'Switch',
    symbol: 'odum-switch',
    half: { w: 35, h: 35 },
    holdsState: false,
    composite: false,
    palette: true,
    valueLabel: 'Level',
    summary: 'Passes flow on or off around a threshold.',
  },
  {
    type: 'gain',
    label: 'Amplifier',
    symbol: 'odum-amplifier',
    half: { w: 21, h: 24 },
    holdsState: false,
    composite: false,
    palette: true,
    valueLabel: 'Level',
    summary: 'A constant-gain amplifier: output proportional to the control.',
  },
  {
    type: 'loop_limited',
    label: 'Receiver',
    symbol: 'odum-receiver',
    half: { w: 26, h: 35 },
    holdsState: false,
    composite: false,
    palette: true,
    valueLabel: 'Level',
    summary: 'A self-limiting receptor: output saturates as input grows (k·Q/(1+Q/C)).',
  },
  {
    type: 'misc_box',
    label: 'Box',
    symbol: 'odum-box',
    half: { w: 35, h: 22 },
    holdsState: true,
    composite: true,
    palette: true,
    valueLabel: 'Initial quantity',
    summary: 'A general-purpose unit for a subsystem not drawn in detail.',
  },
];

/** The symbols the palette offers, in catalogue order. */
export const PALETTE: readonly SymbolSpec[] = CATALOGUE.filter((s) => s.palette);

const BY_TYPE = new Map(CATALOGUE.map((s) => [s.type, s]));

export function symbolFor(type: NodeType): SymbolSpec {
  const s = BY_TYPE.get(type);
  if (!s) throw new Error(`No symbol for node type "${type}"`);
  return s;
}

export function isNodeType(t: unknown): t is NodeType {
  return typeof t === 'string' && BY_TYPE.has(t as NodeType);
}

export interface LogicSpec {
  logic: EdgeLogic;
  label: string;
  formula: string;
  /** Which parameters the logic needs beyond k. */
  needs: readonly ('control_node' | 'threshold' | 'control_or_threshold')[];
}

/** Flow logics and their formulas, after the kernel schema's EdgeLogic. */
export const LOGICS: readonly LogicSpec[] = [
  { logic: 'linear', label: 'Linear', formula: 'J = k·Q₀', needs: [] },
  { logic: 'constant', label: 'Constant', formula: 'J = k', needs: [] },
  {
    logic: 'interaction',
    label: 'Interaction',
    formula: 'J = k·Q₀·Qc',
    needs: ['control_node'],
  },
  {
    logic: 'limit',
    label: 'Limit (Michaelis–Menten)',
    formula: 'J = k·Q₀ / (1 + Q₀/C)',
    needs: ['control_or_threshold'],
  },
  {
    logic: 'threshold',
    label: 'Threshold',
    formula: 'J = k if Q₀ > θ else 0',
    needs: ['threshold'],
  },
  { logic: 'ratio', label: 'Ratio', formula: 'J = k·Q₀ / Qc', needs: ['control_node'] },
  {
    logic: 'reversible',
    label: 'Reversible (barbless)',
    formula: 'J = k·(Q₀ − Q₁)',
    needs: [],
  },
  { logic: 'subtract', label: 'Subtract', formula: 'J = k·(Q₀ − Qc)', needs: ['control_node'] },
];

export function logicFor(logic: EdgeLogic): LogicSpec {
  const s = LOGICS.find((l) => l.logic === logic);
  if (!s) throw new Error(`Unknown logic "${logic}"`);
  return s;
}
