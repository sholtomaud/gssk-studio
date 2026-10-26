/**
 * The domain-neutral GSSK model builder (ADR 0012): kernel node types and
 * flow logics, nothing Odum-specific. Domain libraries — Energese, and any
 * other — are constructs over this API: they take a `GsskModel` and add nodes
 * and flows through `addNode` and `addEdge`.
 *
 * `synth()` returns the model document (ADR 0011). The JSON is canonical;
 * the builder only produces it, field for field in the order `normaliseModel`
 * writes, so a synthesized model serialises exactly as a loaded one does.
 */
import { uniqueId } from '../../model/ids.ts';
import {
  DEFAULT_CONFIG,
  type Boundary,
  type EdgeLogic,
  type Method,
  type ModelEdge,
  type ModelNode,
  type NodeType,
  type ObservationSeries,
  type Point,
  type StudioModel,
} from '../../model/types.ts';
import { layoutUnplaced } from './layout.ts';

/** A node added to a model; constructs that wrap a node expose this shape. */
export interface NodeRef {
  readonly id: string;
  readonly model: GsskModel;
}

export interface EdgeRef {
  readonly id: string;
  readonly model: GsskModel;
}

/** A node named by handle, or by id (for a node declared later). */
export type NodeLike = NodeRef | string;

/** Kernel node parameters, by their kernel names; `price_node` takes a node. */
export interface NodeParamsInput {
  k?: number;
  C?: number;
  threshold?: number;
  price?: number;
  k_production?: number;
  k_respiration?: number;
  k_metabolism?: number;
  price_node?: NodeLike;
}

export interface NodeInput {
  id?: string;
  /** Initial quantity, supply or level, by type (SPEC §5.2). Default 0. */
  value?: number;
  carrier?: string;
  params?: NodeParamsInput;
  /** Diagram position. Omitted: kept from the previous model, else laid out. */
  at?: readonly [number, number];
  /** Reference level for the storage gauge. */
  capacity?: number;
}

export interface EdgeInput {
  id?: string;
  k: number;
  control?: NodeLike;
  threshold?: number;
  numerator?: NodeLike;
  carrier?: string;
  /** Odum's sensor on the flow (FR-EDIT-010). */
  sensor?: boolean;
  /** Bézier control offsets from the origin and target anchors. */
  ctrl1?: readonly [number, number];
  ctrl2?: readonly [number, number];
}

export interface ModelInput {
  description?: string;
  tStart?: number;
  tEnd?: number;
  dt?: number;
  method?: Method;
}

export interface SynthOptions {
  /**
   * The model this one replaces (FR-SDK-004): nodes and flows the script
   * leaves unplaced keep their position and curve by id, and observations
   * are kept.
   */
  previous?: StudioModel;
}

const NODE_PARAM_ORDER = [
  'k',
  'C',
  'threshold',
  'price',
  'k_production',
  'k_respiration',
  'k_metabolism',
] as const;

const pt = (p: readonly [number, number] | undefined): Point | undefined =>
  p ? { x: p[0], y: p[1] } : undefined;

export class GsskModel {
  readonly name: string;
  private readonly input: ModelInput;
  private readonly nodes: { node: ModelNode; placed: boolean }[] = [];
  private readonly edges: ModelEdge[] = [];
  private readonly boundaries: Boundary[] = [];
  private readonly taken = new Set<string>();

  constructor(name: string, input: ModelInput = {}) {
    this.name = name;
    this.input = input;
  }

  private claim(id: string | undefined, fallback: string, what: string): string {
    if (id === undefined) {
      const fresh = uniqueId(fallback, this.taken);
      this.taken.add(fresh);
      return fresh;
    }
    if (this.taken.has(id)) throw new Error(`${what} id “${id}” is already used in this model.`);
    this.taken.add(id);
    return id;
  }

  private ref(n: NodeLike): string {
    if (typeof n === 'string') return n;
    if (n.model !== this) throw new Error(`Node “${n.id}” belongs to another model.`);
    return n.id;
  }

  addNode(type: NodeType, label: string, input: NodeInput = {}): NodeRef {
    const id = this.claim(input.id, label, 'Node');
    const at = pt(input.at);
    const node: ModelNode = {
      id,
      type,
      value: input.value ?? 0,
      visual: {
        x: at?.x ?? 0,
        y: at?.y ?? 0,
        label,
        ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
      },
    };
    if (input.carrier) node.carrier = input.carrier;
    const p = input.params;
    if (p) {
      const params: NonNullable<ModelNode['params']> = {};
      for (const k of NODE_PARAM_ORDER) if (p[k] !== undefined) params[k] = p[k];
      if (p.price_node !== undefined) params.price_node = this.ref(p.price_node);
      if (Object.keys(params).length) node.params = params;
    }
    this.nodes.push({ node, placed: at !== undefined });
    return { id, model: this };
  }

  addEdge(origin: NodeLike, target: NodeLike, logic: EdgeLogic, input: EdgeInput): EdgeRef {
    const o = this.ref(origin);
    const t = this.ref(target);
    const id = this.claim(input.id, `${o}_to_${t}`, 'Flow');
    const edge: ModelEdge = { id, origin: o, target: t, logic, params: { k: input.k } };
    if (input.control !== undefined) edge.params.control_node = this.ref(input.control);
    if (input.threshold !== undefined) edge.params.threshold = input.threshold;
    if (input.numerator !== undefined) edge.params.numerator_node = this.ref(input.numerator);
    if (input.carrier) edge.carrier = input.carrier;
    const c1 = pt(input.ctrl1);
    const c2 = pt(input.ctrl2);
    if (c1 || c2 || input.sensor) {
      edge.visual = {
        ...(c1 ? { ctrl1: c1 } : {}),
        ...(c2 ? { ctrl2: c2 } : {}),
        ...(input.sensor ? { sensor: true } : {}),
      };
    }
    this.edges.push(edge);
    return { id, model: this };
  }

  addBoundary(
    label: string,
    rect: { x: number; y: number; w: number; h: number },
    input: { id?: string } = {}
  ): { readonly id: string } {
    const id = this.claim(input.id, 'boundary', 'Boundary');
    this.boundaries.push({ id, x: rect.x, y: rect.y, w: rect.w, h: rect.h, label });
    return { id };
  }

  /** The model document (ADR 0011). Each call returns a fresh copy. */
  synth(options: SynthOptions = {}): StudioModel {
    const prev = options.previous;
    const prevNodes = new Map(prev?.nodes.map((n) => [n.id, n]));
    const prevEdges = new Map(prev?.edges.map((e) => [e.id, e]));

    const nodes = this.nodes.map(({ node }) => structuredClone(node));
    const unplaced = new Set<string>();
    this.nodes.forEach(({ placed }, i) => {
      if (placed) return;
      const n = nodes[i]!;
      const old = prevNodes.get(n.id);
      if (old) {
        n.visual.x = old.visual.x;
        n.visual.y = old.visual.y;
        if (n.visual.capacity === undefined && old.visual.capacity !== undefined) {
          n.visual.capacity = old.visual.capacity;
        }
      } else unplaced.add(n.id);
    });

    const edges = this.edges.map((e) => {
      const edge = structuredClone(e);
      const old = prevEdges.get(e.id);
      if (old?.visual && old.origin === e.origin && old.target === e.target) {
        const ctrl1 = edge.visual?.ctrl1 ?? old.visual.ctrl1;
        const ctrl2 = edge.visual?.ctrl2 ?? old.visual.ctrl2;
        const sensor = edge.visual?.sensor;
        if (ctrl1 || ctrl2 || sensor) {
          edge.visual = {
            ...(ctrl1 ? { ctrl1: { ...ctrl1 } } : {}),
            ...(ctrl2 ? { ctrl2: { ...ctrl2 } } : {}),
            ...(sensor ? { sensor: true } : {}),
          };
        }
      }
      return edge;
    });

    layoutUnplaced(nodes, edges, unplaced);

    const observations: ObservationSeries[] = [];
    if (prev?._observations) {
      const known = new Set([...nodes.map((n) => n.id), ...edges.map((e) => `flow:${e.id}`)]);
      for (const o of prev._observations) {
        const copy = structuredClone(o);
        if (copy.target !== null && !known.has(copy.target)) copy.target = null;
        observations.push(copy);
      }
    }

    const c = this.input;
    return {
      metadata: {
        schema_version: 4,
        name: this.name,
        ...(c.description ? { description: c.description } : {}),
      },
      config: {
        t_start: c.tStart ?? DEFAULT_CONFIG.t_start,
        t_end: c.tEnd ?? DEFAULT_CONFIG.t_end,
        dt: c.dt ?? DEFAULT_CONFIG.dt,
        method: c.method ?? DEFAULT_CONFIG.method,
      },
      nodes,
      edges,
      _diagram: { boundaries: structuredClone(this.boundaries) },
      ...(observations.length ? { _observations: observations } : {}),
    };
  }
}
