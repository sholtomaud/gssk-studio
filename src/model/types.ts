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
  visual: NodeVisual;
}

export interface EdgeVisual {
  /** First Bézier control point, as an offset from the origin anchor. */
  ctrl1?: Point;
  /** Second Bézier control point, as an offset from the target anchor. */
  ctrl2?: Point;
  /** Odum's sensor: a small box on the flow that reads its rate J (FR-EDIT-010). */
  sensor?: boolean;
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
  /** Editor-only: diagram regions. The kernel ignores `_`-prefixed keys. */
  _diagram: { boundaries: Boundary[] };
  /** Editor-only: observed data to fit runs against (M3). */
  _observations?: ObservationSeries[];
  /** Editor-only: the last Energese script applied, as provenance (ADR 0009). */
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
