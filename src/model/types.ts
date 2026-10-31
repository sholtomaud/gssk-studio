/**
 * The model document (SPEC §5). A studio model IS a GSSK model (ADR 0003):
 * `nodes`, `edges`, `config` and `metadata` are what the kernel reads, node
 * `type` is the kernel's own type, and everything only the editor needs lives
 * where the kernel ignores it — `visual` on nodes and edges, and the
 * underscore-prefixed `_diagram` block at the root.
 */

/** Kernel node types the palette offers, one per Odum symbol (SPEC §5.2). */
export const NODE_TYPES = [
  'source',
  'storage',
  'sink',
  'constant',
  'producer',
  'consumer',
  'interaction',
  'exchange',
  'switch',
  'gain',
  'loop_limited',
  'misc_box',
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const EDGE_LOGICS = [
  'linear',
  'constant',
  'interaction',
  'limit',
  'threshold',
  'ratio',
  'reversible',
  'subtract',
] as const;
export type EdgeLogic = (typeof EDGE_LOGICS)[number];

export const METHODS = ['auto', 'euler', 'rk4', 'expm'] as const;
export type Method = (typeof METHODS)[number];

/** Forcing waveforms the kernel evaluates (FR-FRC-001); one vocabulary for nodes and edges. */
export const WAVEFORMS = [
  'step',
  'impulse',
  'ramp',
  'exponential',
  'sine',
  'square',
  'sawtooth',
  'jitter',
  'table',
] as const;
export type Waveform = (typeof WAVEFORMS)[number];

/**
 * A forcing function, in the kernel's own schema (`$defs/Forcing`). On a
 * source or constant it drives the held value; on an edge it drives the rate k.
 */
export interface Forcing {
  waveform: Waveform;
  t_on?: number;
  v0?: number;
  v1?: number;
  area?: number;
  slope?: number;
  rate?: number;
  period?: number;
  phase?: number;
  duty?: number;
  mean?: number;
  amplitude?: number;
  min?: number;
  max?: number;
  times?: number[];
  values?: number[];
  interpolation?: 'linear' | 'step';
  extrapolation?: 'hold' | 'cycle';
}

export interface Point {
  x: number;
  y: number;
}

export interface NodeVisual {
  x: number;
  y: number;
  label?: string;
  /** Reference level for the storage fill gauge (0–100 %). */
  capacity?: number;
  /** Drawn size, 1 as drawn by default (FR-EDIT-013). */
  scale?: number;
  /** Turned clockwise, in degrees (FR-EDIT-013). */
  rotation?: number;
  /**
   * What it is drawn as in the icon view (FR-EDIT-014): `builtin:<name>`, or
   * the id of one of the model's own icons. Unset: its symbol type's default.
   */
  icon?: string;
}

/** A picture of the model's own for the icon view (FR-EDIT-014): an image as a data URL. */
export interface Icon {
  id: string;
  label: string;
  /** `data:image/svg+xml;base64,…` or a PNG, JPEG, WebP or GIF; drawn as an image, never as markup. */
  href: string;
}

export interface ModelNode {
  id: string;
  type: NodeType;
  value: number;
  carrier?: string;
  params?: {
    k?: number;
    C?: number;
    threshold?: number;
    price?: number;
    price_node?: string;
    k_production?: number;
    k_respiration?: number;
    k_metabolism?: number;
  };
  /** Drives the held value over time (sources and constants only, FR-FRC-001). */
  forcing?: Forcing;
  visual: NodeVisual;
}

export interface EdgeVisual {
  /** First Bézier control point, as an offset from the origin anchor. */
  ctrl1?: Point;
  /** Second Bézier control point, as an offset from the target anchor. */
  ctrl2?: Point;
  /** Odum's sensor: a small box on the flow that reads its rate J (FR-EDIT-010). */
  sensor?: boolean;
  /**
   * A transaction on this flow (FR-TRX-001): what it buys or sells is paid
   * for by the money flow named in `coupled_edge`.
   */
  transaction?: Transaction;
}

/** Odum's transaction: a marking on a flow, paid for by a counter-flow of money. */
export interface Transaction {
  /** COICOP 2018 code: the household budget account (ADR 0015). */
  purpose?: string;
  /** Free labels for filtering. */
  tags?: string[];
}

/** What a carrier measures (ADR 0015): SEEA's physical and monetary split, physical by SI dimension. */
export const CARRIER_KINDS = ['energy', 'material', 'information', 'monetary'] as const;
export type CarrierKind = (typeof CARRIER_KINDS)[number];

/**
 * A carrier: Odum's Code, the kernel's `carriers` entry (FR-TYP-001). The
 * kernel reads `id`, `unit` and `conserved`; the `_` fields are the studio's
 * until the kernel adopts them (K-9 KX-1, KX-2).
 */
export interface Carrier {
  id: string;
  /** UCUM code for a physical carrier (`kW.h`, `kL`, `kg`, `By`). */
  unit?: string;
  conserved?: boolean;
  _label?: string;
  /** Only when the unit cannot tell (a count such as `{subscription}`). */
  _kind?: CarrierKind;
  /** ISO 4217 alphabetic code, for fiat money. */
  _currency?: string;
  /** ISO 24165 Digital Token Identifier, for a crypto-asset. */
  _dti?: string;
}

export interface ModelEdge {
  id: string;
  origin: string;
  target: string;
  logic: EdgeLogic;
  carrier?: string;
  params: {
    k: number;
    control_node?: string;
    threshold?: number;
    numerator_node?: string;
  };
  /** Drives the rate k over time, overriding params.k (FR-FRC-001). */
  forcing?: Forcing;
  /** The paired counter-flow (kernel field): money one way, what it pays for the other. */
  coupled_edge?: string;
  visual?: EdgeVisual;
}

export interface Boundary {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

/**
 * A zoom group (FR-GRP-001): symbols packed into one. Editor-only: the kernel
 * always runs every symbol inside, so packing never changes a result.
 */
export interface Group {
  id: string;
  label: string;
  /** Node ids directly in this group (not in a group inside it). */
  nodes: string[];
  /** The group this one is nested in. */
  parent?: string;
  /** Packed: drawn as one symbol, its flows across the edge combined. */
  collapsed: boolean;
}

export interface ModelConfig {
  t_start: number;
  t_end: number;
  dt: number;
  method: Method;
}

export interface ModelMetadata {
  schema_version: 4;
  name: string;
  description?: string;
}

/**
 * An observed series (FR-OBS-001): measurements to compare a run against,
 * kept with the model, never sent to the kernel.
 */
export interface ObservationSeries {
  id: string;
  /** The column heading it came from. */
  name: string;
  /** What it measures: a node id, `flow:<edge id>` for a sensed flow, or null if unmapped. */
  target: string | null;
  times: number[];
  values: number[];
  /** The file it was imported from. */
  source?: string;
}

export interface StudioModel {
  metadata: ModelMetadata;
  config: ModelConfig;
  nodes: ModelNode[];
  edges: ModelEdge[];
  /** What flows (Odum's Code), with units and currencies (FR-TYP-001). */
  carriers?: Carrier[];
  /** Editor-only: diagram regions. The kernel ignores `_`-prefixed keys. */
  _diagram: { boundaries: Boundary[]; groups?: Group[]; icons?: Icon[] };
  /** Editor-only: observed data to fit runs against (M3). */
  _observations?: ObservationSeries[];
  /** Editor-only: the last Energese script applied, as provenance (ADR 0011). */
  _energese?: ScriptProvenance;
}

/**
 * A hand-written script that built the model (FR-SDK-007). It travels with the
 * model, never instead of it: `modelHash` is the run manifest's model hash of
 * what the script produced, so the studio can tell when the model has since
 * been edited and the script no longer describes it.
 */
export interface ScriptProvenance {
  source: string;
  modelHash: string;
}

export const DEFAULT_CONFIG: ModelConfig = { t_start: 0, t_end: 100, dt: 0.1, method: 'auto' };

export function emptyModel(name = 'Untitled model'): StudioModel {
  return {
    metadata: { schema_version: 4, name },
    config: { ...DEFAULT_CONFIG },
    nodes: [],
    edges: [],
    _diagram: { boundaries: [] },
  };
}

/** A deep copy; models are plain JSON. */
export function cloneModel(m: StudioModel): StudioModel {
  return structuredClone(m);
}
