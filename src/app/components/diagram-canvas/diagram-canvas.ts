/**
 * <diagram-canvas>: the Odum diagram editor (SPEC §6). It draws a model and
 * turns pointer and keyboard input into model operations from
 * src/model/ops.ts. It never owns the model: every edit is dispatched as a
 * `diagram-edit` event and comes back through the `model` property, so the
 * studio screen keeps history and saving in one place.
 */
import { BaseComponent, define } from '../../core/base-component.ts';
import { isNodeType, symbolFor } from '../../../model/catalogue.ts';
import { describeForcing } from '../../../model/forcing.ts';
import { kindOfCarrierId } from '../../../model/carriers.ts';
import {
  impliedPrice,
  partnerOf,
  priceUnit,
  toggleTransaction,
  transactionOf,
} from '../../../model/transactions.ts';
import {
  childGroups,
  diagramView,
  findGroup,
  groupCentre,
  groupNodes,
  groupTotal,
  nodesIn,
  ownerOf,
  setCollapsed,
  type Bundle,
  type DiagramView,
  type End,
} from '../../../model/groups.ts';
import {
  addNode,
  connect,
  findNode,
  removeSelection,
  setControl,
  snap,
  updateBoundary,
  updateEdge,
  moveNodes,
  selectedNodeIds,
  selectNodes,
  selectionKey,
  toggleSensor,
  type Selection,
} from '../../../model/ops.ts';
import type { Group, ModelEdge, ModelNode, Point, StudioModel } from '../../../model/types.ts';
import {
  bounds,
  edgeCurve,
  GROUP_HALF,
  halfExtent,
  pathData,
  pointAt,
  SIZE,
  type Shape,
} from '../../../diagram/geometry.ts';
import { SYMBOL_DEFS } from '../../../diagram/symbols.ts';
import { el, formatNumber, iconButton, svg } from '../../ui.ts';
import style from './diagram-canvas.css?raw';

export const NODE_DRAG_TYPE = 'application/x-gssk-node-type';
/** Dragged from the palette's Sensor tool; dropped on a flow (FR-EDIT-010). */
export const SENSOR_DRAG_TYPE = 'application/x-gssk-sensor';
/** Dragged from the palette's Transaction tool; dropped on a flow (FR-TRX-001). */
export const TRANSACTION_DRAG_TYPE = 'application/x-gssk-transaction';
const GRID = 10;
function rectOf(a: Point, b: Point): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

const FLOW_WIDTHS_KEY = 'gssk-studio-flow-widths';

function storedFlowWidths(): boolean {
  try {
    return localStorage.getItem(FLOW_WIDTHS_KEY) === '1';
  } catch {
    return false;
  }
}
const MIN_SCALE = 0.2;
const MAX_SCALE = 4;

/** What the validator found on one node or flow (FR-VAL-002). */
export interface Marked {
  severity: 'error' | 'warning';
  messages: string[];
}

export interface EditDetail {
  model: StudioModel;
  /** What the edit was, for the undo tooltip. */
  label: string;
  /** Consecutive edits with the same key make one undo step (a drag, a nudge). */
  coalesce?: string;
  select?: Selection;
}

/** Values to draw during playback: levels per node id, flow rates per edge id. */
export interface Playback {
  values: ReadonlyMap<string, number>;
  flows: ReadonlyMap<string, number>;
  maxFlow: number;
}

type Drag =
  /** Moving one node or several; `applied` is the snapped offset already emitted. */
  | { kind: 'node'; ids: string[]; start: Point; applied: Point; key: string }
  | { kind: 'marquee'; start: Point; to: Point; add: boolean }
  | { kind: 'pan'; start: Point; view: { x: number; y: number }; moved: boolean }
  | { kind: 'wire'; from: string; to: Point }
  | { kind: 'ctrl'; edgeId: string; which: 1 | 2; key: string }
  | { kind: 'boundary'; id: string; offset: Point; key: string; moved: boolean }
  | { kind: 'resize'; id: string; key: string };

export class DiagramCanvas extends BaseComponent {
  private _model: StudioModel | null = null;
  private _selection: Selection = null;
  private _playback: Playback | null = null;
  private _issues = new Map<string, Marked>();
  private view = { x: 0, y: 0, s: 1 };
  /** Draw flows as wide as their rate during playback (FR-RES-003); off by default. */
  private flowWidths = storedFlowWidths();
  private drag: Drag | null = null;
  private fitted = false;
  private gestureSeq = 0;
  private readonly nodeEls = new Map<string, SVGGElement>();
  private readonly edgeEls = new Map<string, SVGGElement>();
  private readonly groupEls = new Map<string, SVGGElement>();
  private readonly bundleEls = new Map<string, SVGGElement>();
  /** What is drawn at the current packing (FR-GRP-001). */
  private view_: DiagramView | null = null;
  private lastGroupClick: { id: string; at: number } | null = null;
  /** Where each flow's transaction diamond is drawn, to link the pair. */
  private readonly trxPoints = new Map<string, Point>();
  /** Flow badges, appended to the overlay once every flow is drawn. */
  private edgeBadges: SVGGElement[] = [];

  private root!: SVGSVGElement;
  private world!: SVGGElement;
  private layers!: {
    boundaries: SVGGElement;
    edges: SVGGElement;
    nodes: SVGGElement;
    overlay: SVGGElement;
  };
  private hint!: HTMLElement;
  private pct!: HTMLElement;

  constructor() {
    super('', style);
  }

  override init(): void {
    if (this.root) return;
    this.root = svg('svg', {
      class: 'canvas',
      tabindex: 0,
      role: 'application',
      'aria-label': 'Diagram canvas',
    });
    const defs = svg('defs');
    defs.innerHTML = `${SYMBOL_DEFS}
      <filter id="fuzz" filterUnits="userSpaceOnUse" x="-20000" y="-20000" width="40000" height="40000">
        <feGaussianBlur stdDeviation="7" />
      </filter>
      <pattern id="grid" width="${GRID * 4}" height="${GRID * 4}" patternUnits="userSpaceOnUse">
        <path class="grid-line" d="M ${GRID * 4} 0 L 0 0 0 ${GRID * 4}" fill="none" />
      </pattern>`;
    this.world = svg('g', { class: 'world' });
    const bg = svg('rect', {
      x: -20000,
      y: -20000,
      width: 40000,
      height: 40000,
      fill: 'url(#grid)',
      class: 'bg',
    });
    this.layers = {
      boundaries: svg('g', { class: 'boundaries' }),
      edges: svg('g', { class: 'edges' }),
      nodes: svg('g', { class: 'nodes' }),
      overlay: svg('g', { class: 'overlay' }),
    };
    this.world.append(
      bg,
      this.layers.boundaries,
      this.layers.edges,
      this.layers.nodes,
      this.layers.overlay
    );
    this.root.append(defs, this.world);

    this.hint = el(
      'div',
      { class: 'empty-hint', hidden: '' },
      el('p', {
        text: 'Drag a symbol from the palette onto the canvas, or click one to place it here. Drag from a symbol’s blue port to draw a flow.',
      })
    );
    const zoomIn = iconButton('zoomIn', 'Zoom in');
    const zoomOut = iconButton('zoomOut', 'Zoom out');
    const fit = iconButton('fit', 'Zoom to fit');
    zoomIn.onclick = () => this.zoomBy(1.25);
    zoomOut.onclick = () => this.zoomBy(0.8);
    fit.onclick = () => this.fit();
    this.pct = el('span', { class: 'pct', text: '100%' });
    const widths = iconButton('flow', 'Flow widths: draw each flow as wide as its rate');
    widths.setAttribute('aria-pressed', String(this.flowWidths));
    widths.onclick = () => {
      this.flowWidths = !this.flowWidths;
      widths.setAttribute('aria-pressed', String(this.flowWidths));
      try {
        localStorage.setItem(FLOW_WIDTHS_KEY, this.flowWidths ? '1' : '0');
      } catch {
        // Not remembered.
      }
      this.applyPlayback();
    };
    this.append(
      this.root,
      this.hint,
      el(
        'div',
        { class: 'zoom' },
        widths,
        el('span', { class: 'sep' }),
        zoomOut,
        this.pct,
        zoomIn,
        fit
      )
    );

    this.root.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.root.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.root.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.root.addEventListener('pointercancel', () => this.endDrag());
    this.root.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.root.addEventListener('keydown', (e) => this.onKeyDown(e));
    this.root.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    this.root.addEventListener('dragover', (e) => {
      const types = e.dataTransfer?.types ?? [];
      if (
        e.dataTransfer &&
        (types.includes(NODE_DRAG_TYPE) ||
          types.includes(SENSOR_DRAG_TYPE) ||
          types.includes(TRANSACTION_DRAG_TYPE))
      ) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    this.root.addEventListener('drop', (e) => this.onDrop(e));
    new ResizeObserver(() => {
      if (!this.fitted && this._model && this.root.clientWidth > 0) this.fit();
    }).observe(this);
    this.render();
  }

  // ---- properties ---------------------------------------------------------

  set model(m: StudioModel) {
    const first = this._model === null;
    this._model = m;
    if (this.root) {
      this.render();
      if (first) this.fit();
    }
  }
  get model(): StudioModel | null {
    return this._model;
  }

  set selection(s: Selection) {
    this._selection = s;
    if (this.root) this.render();
  }

  set playback(p: Playback | null) {
    this._playback = p;
    if (this.root) this.applyPlayback();
  }

  /**
   * Problems per node or flow id (FR-VAL-002): an error draws it red, a
   * warning orange, and either gets a "!" badge carrying the messages, so the
   * colour is never the only signal.
   */
  set issues(issues: ReadonlyMap<string, Marked>) {
    this._issues = new Map(issues);
    if (this.root) this.render();
  }

  private mark(id: string): string {
    const m = this._issues.get(id);
    return m ? (m.severity === 'error' ? ' invalid' : ' warned') : '';
  }

  /** A "!" badge at (x, y) whose tooltip lists the problems. */
  /**
   * A soft blurred light behind a symbol with a problem (FR-VAL-002): red and
   * slowly pulsing for an error, steady amber for a warning. It sits behind
   * the symbol, so the symbol's own outline colour stays free to mean
   * something else.
   */
  private glow(mark: Marked | undefined, w: number, h: number): SVGRectElement | null {
    if (!mark) return null;
    return svg('rect', {
      class: 'glow',
      // Wider than the symbol's opaque body, so the light shows around it.
      x: -w - 18,
      y: -h - 18,
      width: 2 * w + 36,
      height: 2 * h + 36,
      rx: Math.min(w, h) + 18,
    });
  }

  /** The forcing mark (FR-FRC-001): a small wave beside a forced symbol or on a forced flow. */
  private forcedMark(x: number, y: number): SVGTextElement {
    const t = svg('text', { class: 'forced', x, y });
    t.textContent = '∿';
    return t;
  }

  private badge(id: string, x: number, y: number): SVGGElement | null {
    return this.badgeFor(this._issues.get(id), x, y);
  }

  private badgeFor(m: Marked | undefined, x: number, y: number): SVGGElement | null {
    if (!m) return null;
    const g = svg('g', { class: `badge ${m.severity}`, transform: `translate(${x} ${y})` });
    const t = svg('text', { y: 4 });
    t.textContent = '!';
    const title = svg('title');
    title.textContent = `${m.severity === 'error' ? 'Error' : 'Warning'}: ${m.messages.join(' · ')}`;
    g.append(svg('circle', { r: 8 }), t, title);
    return g;
  }

  // ---- view ---------------------------------------------------------------

  private applyView(): void {
    this.world.setAttribute(
      'transform',
      `translate(${this.view.x} ${this.view.y}) scale(${this.view.s})`
    );
    this.pct.textContent = `${Math.round(this.view.s * 100)}%`;
  }

  /** Viewport centre in model coordinates: where a clicked palette symbol lands. */
  centre(): Point {
    const w = this.root?.clientWidth || 800;
    const h = this.root?.clientHeight || 600;
    return {
      x: snap((w / 2 - this.view.x) / this.view.s, GRID),
      y: snap((h / 2 - this.view.y) / this.view.s, GRID),
    };
  }

  zoomBy(f: number, about?: Point): void {
    const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.view.s * f));
    const p = about ?? { x: this.root.clientWidth / 2, y: this.root.clientHeight / 2 };
    this.view.x = p.x - ((p.x - this.view.x) * s) / this.view.s;
    this.view.y = p.y - ((p.y - this.view.y) * s) / this.view.s;
    this.view.s = s;
    this.applyView();
  }

  fit(): void {
    const m = this._model;
    const w = this.root?.clientWidth ?? 0;
    const h = this.root?.clientHeight ?? 0;
    if (!m || w === 0 || h === 0) return;
    this.fitted = true;
    const pts = [
      ...m.nodes.map((n) => ({ x: n.visual.x, y: n.visual.y })),
      ...m._diagram.boundaries.flatMap((b) => [
        { x: b.x, y: b.y },
        { x: b.x + b.w, y: b.y + b.h },
      ]),
    ];
    if (pts.length === 0) {
      this.view = { x: 0, y: 0, s: 1 };
    } else {
      // Room for group frames, which reach past the symbols they hold.
      const b = bounds(pts, m._diagram.groups?.length ? SIZE * 2 : SIZE);
      const s = Math.min(1.5, Math.max(MIN_SCALE, Math.min(w / b.w, h / b.h)));
      this.view = { s, x: (w - b.w * s) / 2 - b.x * s, y: (h - b.h * s) / 2 - b.y * s };
    }
    this.applyView();
  }

  /** Client coordinates → model coordinates. */
  private toModel(e: { clientX: number; clientY: number }): Point {
    const r = this.root.getBoundingClientRect();
    return {
      x: (e.clientX - r.left - this.view.x) / this.view.s,
      y: (e.clientY - r.top - this.view.y) / this.view.s,
    };
  }

  // ---- rendering ----------------------------------------------------------

  private render(): void {
    const m = this._model;
    this.nodeEls.clear();
    this.edgeEls.clear();
    this.groupEls.clear();
    this.bundleEls.clear();
    for (const layer of Object.values(this.layers)) layer.replaceChildren();
    this.hint.hidden = !m || m.nodes.length > 0;
    if (!m) return;
    const sel = this._selection;
    for (const b of m._diagram.boundaries) {
      const g = svg('g', {
        class: `boundary${sel?.kind === 'boundary' && sel.id === b.id ? ' selected' : ''}`,
        'data-boundary': b.id,
      });
      g.append(
        svg('rect', { class: 'grab', x: b.x, y: b.y, width: b.w, height: b.h, rx: 10 }),
        svg('rect', { class: 'frame', x: b.x, y: b.y, width: b.w, height: b.h, rx: 10 }),
        Object.assign(svg('text', { x: b.x + 12, y: b.y + 20 }), { textContent: b.label }),
        svg('rect', {
          class: 'resize',
          'data-resize': b.id,
          x: b.x + b.w - 6,
          y: b.y + b.h - 6,
          width: 12,
          height: 12,
          rx: 2,
        })
      );
      this.layers.boundaries.append(g);
    }
    const view = diagramView(m);
    this.view_ = view;
    for (const g of view.frames) this.renderFrame(m, g);
    this.edgeBadges = [];
    this.trxPoints.clear();
    for (const e of view.edges) this.renderEdge(m, e);
    // A transaction's two diamonds are one exchange: a faint line joins them.
    for (const e of view.edges) {
      if (!e.visual?.transaction) continue;
      const p = partnerOf(m, e);
      const a = this.trxPoints.get(e.id);
      const b = p ? this.trxPoints.get(p.id) : undefined;
      if (a && b)
        this.layers.edges.prepend(
          svg('line', { class: 'pair-link', x1: a.x, y1: a.y, x2: b.x, y2: b.y })
        );
    }
    for (const b of view.bundles) this.renderBundle(m, b);
    this.layers.overlay.append(...this.edgeBadges);
    for (const n of m.nodes) if (view.nodes.has(n.id)) this.renderNode(n);
    for (const g of view.packed) this.renderGroup(m, g);
    this.applyPlayback();
    this.applyView();
  }

  private renderNode(n: ModelNode): void {
    const spec = symbolFor(n.type);
    const { w, h } = halfExtent(n.type);
    const selected = selectedNodeIds(this._selection).includes(n.id);
    const label = n.visual.label ?? n.id;
    const g = svg('g', {
      class: `node${selected ? ' selected' : ''}${this.mark(n.id)}`,
      'data-node': n.id,
      transform: `translate(${n.visual.x} ${n.visual.y})`,
      tabindex: 0,
      role: 'button',
      'aria-label': `${spec.label}: ${label}`,
      'aria-pressed': selected ? 'true' : 'false',
    });
    const glow = this.glow(this._issues.get(n.id), w, h);
    if (glow) g.append(glow);
    g.append(
      svg('rect', {
        class: 'halo',
        x: -w - 8,
        y: -h - 8,
        width: 2 * w + 16,
        height: 2 * h + 16,
        rx: 6,
      }),
      svg('rect', { class: 'body', x: -w, y: -h, width: 2 * w, height: 2 * h, rx: 4 }),
      svg('use', { href: `#${spec.symbol}`, x: -SIZE / 2, y: -SIZE / 2, width: SIZE, height: SIZE })
    );
    if (spec.holdsState && n.visual.capacity) {
      g.append(
        svg('rect', { class: 'gauge-bg', x: w + 6, y: -h, width: 6, height: 2 * h, rx: 2 }),
        svg('rect', { class: 'gauge', x: w + 6, y: h, width: 6, height: 0, rx: 2 })
      );
    }
    const text = svg('text', { class: 'label', y: h + 18 });
    text.textContent = label;
    const reading = svg('text', { class: 'reading', y: h + 32 });
    g.append(
      text,
      reading,
      svg('circle', {
        class: 'port',
        'data-port': n.id,
        cx: w + (spec.holdsState && n.visual.capacity ? 20 : 8),
        cy: 0,
        r: 6,
      })
    );
    if (n.forcing) g.append(this.forcedMark(w + 2, -h + 4));
    const title = svg('title');
    title.textContent = `${spec.label} “${label}” (${n.id})${n.forcing ? `, forced: ${describeForcing(n.forcing)}` : ''}`;
    g.append(title);
    const nb = this.badge(n.id, -w - 2, -h - 2);
    if (nb) g.append(nb);
    this.nodeEls.set(n.id, g);
    this.layers.nodes.append(g);
  }

  private renderEdge(m: StudioModel, e: ModelEdge): void {
    const o = findNode(m, e.origin);
    const t = findNode(m, e.target);
    if (!o || !t) return;
    const curve = edgeCurve(e, o, t);
    const selected = this._selection?.kind === 'edge' && this._selection.id === e.id;
    const kind = kindOfCarrierId(m, e.carrier);
    const g = svg('g', {
      // Odum's line styles by what flows (ADR 0015): money dashed, information dotted.
      class: `edge ${e.logic}${kind ? ` kind-${kind}` : ''}${selected ? ' selected' : ''}${this.mark(e.id)}`,
      'data-edge': e.id,
    });
    const d = pathData(curve);
    if (this._issues.has(e.id)) g.append(svg('path', { class: 'glow', d }));
    g.append(
      svg('path', { class: 'hit', d }),
      svg('path', {
        class: 'line',
        d,
        'marker-end': e.logic === 'reversible' ? undefined : 'url(#arrow)',
      })
    );
    const control = e.params.control_node ? findNode(m, e.params.control_node) : undefined;
    if (control) {
      const mid = pointAt(curve, 0.5);
      // A control packed in a group is drawn from the group's symbol.
      const from = this.shapeOf(m, ownerOf(m, control.id)).visual;
      g.append(
        svg('line', {
          class: 'control',
          x1: from.x,
          y1: from.y,
          x2: mid.x,
          y2: mid.y,
        }),
        svg('use', {
          class: 'gate',
          href: '#odum-gate',
          x: mid.x - 15,
          y: mid.y - 15,
          width: 30,
          height: 30,
        })
      );
    }
    if (e.visual?.sensor) {
      // Beside the work gate when there is one, else at the midpoint.
      const at = pointAt(curve, control ? 0.3 : 0.5);
      const reading = svg('text', { class: 'sensor-reading', x: at.x, y: at.y - 12 });
      g.append(
        svg('rect', { class: 'sensor', x: at.x - 7, y: at.y - 7, width: 14, height: 14, rx: 1.5 }),
        reading
      );
    }
    const trx = transactionOf(m, e);
    if (trx) {
      // Odum's transaction diamond, clear of a gate or sensor at the middle.
      const at = pointAt(curve, control || e.visual?.sensor ? 0.64 : 0.5);
      const marked = trx.marked === e;
      const size = marked ? 40 : 28;
      this.trxPoints.set(e.id, at);
      const use = svg('use', {
        class: `transaction${marked ? '' : ' counter'}`,
        href: '#odum-transaction',
        x: at.x - size / 2,
        y: at.y - size / 2,
        width: size,
        height: size,
      });
      g.append(use);
      if (marked) g.append(svg('text', { class: 'price-reading', x: at.x, y: at.y + 30 }));
    }
    if (e.forcing) {
      // Clear of the labels at the origin end, the gate or sensor mid-flow and the badge at 0.78.
      const at = pointAt(curve, 0.38);
      g.append(this.forcedMark(at.x + 10, at.y - 6));
    }
    const title = svg('title');
    const pair = trx ? (trx.marked === e ? partnerOf(m, e) : trx.marked) : undefined;
    title.textContent = `${e.id}: ${e.logic}, k = ${e.forcing ? describeForcing(e.forcing) : e.params.k}${e.carrier ? `, carries ${e.carrier}` : ''}${control ? `, controlled by ${control.id}` : ''}${e.visual?.sensor ? ', sensed' : ''}${trx ? (pair ? `, transaction with ${pair.id}` : ', transaction without its counter-flow') : ''}`;
    g.append(title);
    // On the curve, clear of a gate or sensor at the middle; in the overlay so it
    // draws above the selection handles, and still selects the flow when clicked.
    const at = pointAt(curve, control || e.visual?.sensor || trx ? 0.78 : 0.5);
    const eb = this.badge(e.id, at.x, at.y);
    if (eb) {
      eb.setAttribute('data-edge', e.id);
      this.edgeBadges.push(eb);
    }
    this.edgeEls.set(e.id, g);
    this.layers.edges.append(g);
    if (selected) {
      this.layers.overlay.append(
        svg('line', {
          class: 'handle-line',
          x1: curve.p0.x,
          y1: curve.p0.y,
          x2: curve.c1.x,
          y2: curve.c1.y,
        }),
        svg('line', {
          class: 'handle-line',
          x1: curve.p1.x,
          y1: curve.p1.y,
          x2: curve.c2.x,
          y2: curve.c2.y,
        }),
        svg('circle', {
          class: 'handle',
          'data-ctrl': '1',
          'data-edge-handle': e.id,
          cx: curve.c1.x,
          cy: curve.c1.y,
          r: 5,
        }),
        svg('circle', {
          class: 'handle',
          'data-ctrl': '2',
          'data-edge-handle': e.id,
          cx: curve.c2.x,
          cy: curve.c2.y,
          r: 5,
        })
      );
    }
  }

  /** Where a flow end is drawn, and its outline: a symbol, or a packed group's box. */
  private shapeOf(m: StudioModel, end: End): Shape {
    if (end.kind === 'group') return { type: 'group', visual: groupCentre(m, end.id) };
    const n = findNode(m, end.id);
    return n ? { type: n.type, visual: n.visual } : { type: 'group', visual: { x: 0, y: 0 } };
  }

  /** The worst problem among a group's contents and the flows touching them. */
  private groupMark(m: StudioModel, id: string): Marked | undefined {
    const inside = new Set(nodesIn(m, id));
    const marks = [
      ...[...inside].map((n) => this._issues.get(n)),
      ...m.edges
        .filter((e) => inside.has(e.origin) || inside.has(e.target))
        .map((e) => this._issues.get(e.id)),
    ].filter((x): x is Marked => x !== undefined);
    if (marks.length === 0) return undefined;
    return {
      severity: marks.some((x) => x.severity === 'error') ? 'error' : 'warning',
      messages: marks.flatMap((x) => x.messages),
    };
  }

  private markFor(mark: Marked | undefined): string {
    return mark ? (mark.severity === 'error' ? ' invalid' : ' warned') : '';
  }

  /** An unpacked group: a frame around what it holds, with its name and a pack button. */
  private renderFrame(m: StudioModel, grp: Group): void {
    const depth = (id: string): number =>
      Math.max(0, ...childGroups(m, id).map((c) => (c.collapsed ? 0 : 1 + depth(c.id))));
    const ids = new Set(nodesIn(m, grp.id));
    const pts = m.nodes.filter((n) => ids.has(n.id)).map((n) => n.visual);
    if (pts.length === 0) return;
    const pad = SIZE * 0.75 + 30 * depth(grp.id);
    const b = bounds(pts, pad);
    const top = b.y - 14;
    const selected = this._selection?.kind === 'group' && this._selection.id === grp.id;
    const g = svg('g', {
      class: `group-frame${selected ? ' selected' : ''}`,
      'data-group': grp.id,
    });
    const tab = svg('text', { class: 'group-label', x: b.x + 30, y: top + 20 });
    tab.textContent = grp.label;
    const pack = svg('g', {
      class: 'group-toggle',
      'data-group-toggle': grp.id,
      transform: `translate(${b.x + 14} ${top + 15})`,
      role: 'button',
      'aria-label': `Pack ${grp.label}`,
    });
    const pt = svg('title');
    pt.textContent = `Pack “${grp.label}” into one symbol`;
    pack.append(
      svg('rect', { x: -8, y: -8, width: 16, height: 16, rx: 3 }),
      svg('path', { d: 'M-4 0H4' }),
      pt
    );
    g.append(
      svg('rect', { class: 'grab', x: b.x, y: top, width: b.w, height: b.h + 14, rx: 12 }),
      svg('rect', { class: 'frame', x: b.x, y: top, width: b.w, height: b.h + 14, rx: 12 }),
      tab,
      pack
    );
    this.groupEls.set(grp.id, g);
    this.layers.boundaries.append(g);
  }

  /** A packed group: one symbol at the centre of what it holds. */
  private renderGroup(m: StudioModel, grp: Group): void {
    const c = groupCentre(m, grp.id);
    const { w, h } = GROUP_HALF;
    const count = nodesIn(m, grp.id).length;
    const ids = new Set(nodesIn(m, grp.id));
    const sel = this._selection;
    const selected =
      (sel?.kind === 'group' && sel.id === grp.id) ||
      (count > 0 && [...ids].every((id) => selectedNodeIds(sel).includes(id)));
    const mark = this.groupMark(m, grp.id);
    const g = svg('g', {
      class: `node group${selected ? ' selected' : ''}${this.markFor(mark)}`,
      'data-group': grp.id,
      transform: `translate(${c.x} ${c.y})`,
      tabindex: 0,
      role: 'button',
      'aria-label': `Group: ${grp.label}`,
      'aria-pressed': selected ? 'true' : 'false',
    });
    const label = svg('text', { class: 'label', y: h + 18 });
    label.textContent = grp.label;
    const n = svg('text', { class: 'group-count', y: 4 });
    n.textContent = `${count} symbol${count === 1 ? '' : 's'}`;
    const unpack = svg('g', {
      class: 'group-toggle',
      'data-group-toggle': grp.id,
      transform: `translate(${w - 10} ${-h + 10})`,
      role: 'button',
      'aria-label': `Unpack ${grp.label}`,
    });
    const ut = svg('title');
    ut.textContent = `Unpack “${grp.label}” to see what it holds (or double-click)`;
    unpack.append(
      svg('rect', { x: -7, y: -7, width: 14, height: 14, rx: 3 }),
      svg('path', { d: 'M-3.5 0H3.5M0 -3.5V3.5' }),
      ut
    );
    const title = svg('title');
    title.textContent = `Group “${grp.label}”: ${count} symbols packed. Double-click to unpack.`;
    const glow = this.glow(mark, w, h);
    if (glow) g.append(glow);
    g.append(
      svg('rect', {
        class: 'halo',
        x: -w - 8,
        y: -h - 8,
        width: 2 * w + 16,
        height: 2 * h + 16,
        rx: 8,
      }),
      // Two offset boxes read as a stack: more than one symbol in here.
      svg('rect', { class: 'stack', x: -w + 5, y: -h - 5, width: 2 * w, height: 2 * h, rx: 6 }),
      svg('rect', { class: 'group-body', x: -w, y: -h, width: 2 * w, height: 2 * h, rx: 6 }),
      n,
      label,
      svg('text', { class: 'reading', y: h + 32 }),
      unpack,
      title
    );
    const badge = this.badgeFor(mark, -w - 2, -h - 2);
    if (badge) g.append(badge);
    this.groupEls.set(grp.id, g);
    this.layers.nodes.append(g);
  }

  /** Flows across a packed group's edge between the same two ends, drawn as one. */
  private renderBundle(m: StudioModel, b: Bundle): void {
    const o = this.shapeOf(m, b.origin);
    const t = this.shapeOf(m, b.target);
    const curve = edgeCurve({ origin: b.id, target: `${b.id}~` }, o, t);
    const d = pathData(curve);
    const selected = this._selection?.kind === 'bundle' && this._selection.id === b.id;
    const marks = b.edges.map((id) => this._issues.get(id)).filter((x) => x !== undefined);
    const mark: Marked | undefined = marks.length
      ? {
          severity: marks.some((x) => x.severity === 'error') ? 'error' : 'warning',
          messages: marks.flatMap((x) => x.messages),
        }
      : undefined;
    const g = svg('g', {
      class: `edge bundle${selected ? ' selected' : ''}${this.markFor(mark)}`,
      'data-bundle': b.id,
    });
    const mid = pointAt(curve, 0.5);
    const count = svg('text', { class: 'bundle-count', x: mid.x, y: mid.y - 10 });
    count.textContent = b.edges.length > 1 ? `${b.edges.length} flows` : '';
    const title = svg('title');
    title.textContent = `${b.edges.length} flow${b.edges.length === 1 ? '' : 's'} combined: ${b.edges.join(', ')}`;
    if (mark) g.append(svg('path', { class: 'glow', d }));
    g.append(
      svg('path', { class: 'hit', d }),
      svg('path', { class: 'line', d, 'marker-end': 'url(#arrow)' }),
      count,
      svg('text', { class: 'sensor-reading bundle-reading', x: mid.x, y: mid.y + 18 }),
      title
    );
    const badge = this.badgeFor(mark, mid.x + 18, mid.y);
    if (badge) {
      badge.setAttribute('data-bundle', b.id);
      this.edgeBadges.push(badge);
    }
    this.bundleEls.set(b.id, g);
    this.layers.edges.append(g);
  }

  /**
   * Update levels and, when Flow widths is on, flow widths in place (a
   * Sankey-style reading of the run, FR-RES-003); no re-render.
   */
  private applyPlayback(): void {
    const p = this._playback;
    const m = this._model;
    if (!m) return;
    for (const n of m.nodes) {
      const g = this.nodeEls.get(n.id);
      if (!g) continue;
      const reading = g.querySelector('.reading');
      const v = p?.values.get(n.id);
      if (reading) reading.textContent = v === undefined ? '' : formatNumber(v);
      const gauge = g.querySelector<SVGRectElement>('.gauge');
      if (gauge && n.visual.capacity) {
        const { h } = halfExtent(n.type);
        const frac =
          v === undefined
            ? Math.max(0, Math.min(1, n.value / n.visual.capacity))
            : Math.max(0, Math.min(1, v / n.visual.capacity));
        gauge.setAttribute('y', String(h - 2 * h * frac));
        gauge.setAttribute('height', String(2 * h * frac));
      }
    }
    for (const e of m.edges) {
      const line = this.edgeEls.get(e.id)?.querySelector<SVGPathElement>('.line');
      if (!line) continue;
      const f = p?.flows.get(e.id);
      const reading = this.edgeEls.get(e.id)?.querySelector('.sensor-reading');
      if (reading) reading.textContent = f === undefined ? '' : `J ${formatNumber(f)}`;
      line.style.strokeWidth =
        !this.flowWidths || f === undefined || !(p && p.maxFlow > 0)
          ? ''
          : `${1.2 + 4.8 * Math.min(1, Math.abs(f) / p.maxFlow)}px`;
    }
    for (const e of m.edges) {
      const reading = this.edgeEls.get(e.id)?.querySelector('.price-reading');
      if (!reading) continue;
      const trx = transactionOf(m, e);
      const price =
        trx?.money && trx.goods
          ? impliedPrice(p?.flows.get(trx.money.id), p?.flows.get(trx.goods.id))
          : undefined;
      reading.textContent =
        price === undefined || !trx?.money || !trx.goods
          ? ''
          : `${formatNumber(price)} ${priceUnit(m, trx.money, trx.goods)}`;
    }
    for (const b of this.view_?.bundles ?? []) {
      const g = this.bundleEls.get(b.id);
      if (!g) continue;
      let sum: number | undefined = p ? 0 : undefined;
      for (const id of b.edges) {
        const f = p?.flows.get(id);
        sum = sum === undefined || f === undefined ? undefined : sum + f;
      }
      const reading = g.querySelector('.bundle-reading');
      if (reading) reading.textContent = sum === undefined ? '' : `ΣJ ${formatNumber(sum)}`;
      const line = g.querySelector<SVGPathElement>('.line');
      // The combined flow is never thinner than a single one.
      if (line)
        line.style.strokeWidth =
          !this.flowWidths || sum === undefined || !(p && p.maxFlow > 0)
            ? ''
            : `${1.2 + 4.8 * Math.min(1, Math.abs(sum) / p.maxFlow)}px`;
    }
    for (const grp of this.view_?.packed ?? []) {
      const reading = this.groupEls.get(grp.id)?.querySelector('.reading');
      const v = p ? groupTotal(m, grp.id, p.values) : undefined;
      if (reading) reading.textContent = v === undefined ? '' : `Σ ${formatNumber(v)}`;
    }
  }

  // ---- input --------------------------------------------------------------

  private emit(detail: EditDetail): void {
    this.dispatchEvent(new CustomEvent<EditDetail>('diagram-edit', { detail, bubbles: true }));
  }

  private select(s: Selection): void {
    this._selection = s;
    this.dispatchEvent(new CustomEvent<Selection>('diagram-select', { detail: s, bubbles: true }));
    this.render();
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 || !this._model) return;
    this.root.focus({ preventScroll: true });
    const target = e.target as Element;
    const p = this.toModel(e);
    const key = `g${++this.gestureSeq}`;
    const toggle = target.closest('[data-group-toggle]');
    const group = target.closest('[data-group]');
    const bundle = target.closest('[data-bundle]');
    if (toggle) {
      const id = toggle.getAttribute('data-group-toggle') ?? '';
      const g = findGroup(this._model, id);
      if (g) {
        this.emit({
          model: setCollapsed(this._model, id, !g.collapsed),
          label: `${g.collapsed ? 'Unpack' : 'Pack'} ${g.label}`,
          select: { kind: 'group', id },
        });
      }
      return;
    }
    if (bundle) {
      this.select({ kind: 'bundle', id: bundle.getAttribute('data-bundle') ?? '' });
      return;
    }
    const port = target.closest('[data-port]');
    const handle = target.closest('[data-edge-handle]');
    const resize = target.closest('[data-resize]');
    const node = target.closest('[data-node]');
    const edge = target.closest('[data-edge]');
    const boundary = target.closest('[data-boundary]');
    if (port) {
      const from = port.getAttribute('data-port') ?? '';
      this.drag = { kind: 'wire', from, to: p };
      this.root.classList.add('wiring');
    } else if (handle) {
      this.drag = {
        kind: 'ctrl',
        edgeId: handle.getAttribute('data-edge-handle') ?? '',
        which: handle.getAttribute('data-ctrl') === '2' ? 2 : 1,
        key,
      };
    } else if (resize) {
      this.drag = { kind: 'resize', id: resize.getAttribute('data-resize') ?? '', key };
    } else if (node) {
      const id = node.getAttribute('data-node') ?? '';
      const n = findNode(this._model, id);
      if (!n) return;
      const current = selectedNodeIds(this._selection);
      if (e.shiftKey) {
        // Shift-click adds a node to the selection, or takes it out (FR-EDIT-011).
        this.select(
          selectNodes(current.includes(id) ? current.filter((x) => x !== id) : [...current, id])
        );
        return;
      }
      const ids = current.includes(id) ? current : [id];
      this.drag = { kind: 'node', ids, start: p, applied: { x: 0, y: 0 }, key };
      if (!current.includes(id)) this.select({ kind: 'node', id });
    } else if (group) {
      // A group, packed or as a frame, drags everything it holds.
      const id = group.getAttribute('data-group') ?? '';
      const ids = nodesIn(this._model, id);
      const current = selectedNodeIds(this._selection);
      if (e.shiftKey) {
        const all = ids.every((x) => current.includes(x));
        this.select(
          selectNodes(all ? current.filter((x) => !ids.includes(x)) : [...current, ...ids])
        );
        return;
      }
      // The first click re-renders the symbol, so a native dblclick never lands: count clicks here.
      const now = performance.now();
      const packed = group.classList.contains('group');
      if (packed && this.lastGroupClick?.id === id && now - this.lastGroupClick.at < 450) {
        this.lastGroupClick = null;
        this.unpack(id);
        return;
      }
      this.lastGroupClick = packed ? { id, at: now } : null;
      const within = ids.length > 0 && ids.every((x) => current.includes(x));
      this.drag = {
        kind: 'node',
        ids: within ? current : ids,
        start: p,
        applied: { x: 0, y: 0 },
        key,
      };
      if (!within && !(this._selection?.kind === 'group' && this._selection.id === id))
        this.select({ kind: 'group', id });
    } else if (edge) {
      this.select({ kind: 'edge', id: edge.getAttribute('data-edge') ?? '' });
      return;
    } else if (boundary) {
      const id = boundary.getAttribute('data-boundary') ?? '';
      const b = this._model._diagram.boundaries.find((x) => x.id === id);
      if (!b) return;
      this.drag = {
        kind: 'boundary',
        id,
        offset: { x: p.x - b.x, y: p.y - b.y },
        key,
        moved: false,
      };
      if (!(this._selection?.kind === 'boundary' && this._selection.id === id))
        this.select({ kind: 'boundary', id });
    } else if (e.shiftKey) {
      this.drag = { kind: 'marquee', start: p, to: p, add: true };
    } else {
      this.drag = {
        kind: 'pan',
        start: { x: e.clientX, y: e.clientY },
        view: { x: this.view.x, y: this.view.y },
        moved: false,
      };
      this.root.classList.add('panning');
    }
    this.root.setPointerCapture(e.pointerId);
  }

  private onPointerMove(e: PointerEvent): void {
    const d = this.drag;
    const m = this._model;
    if (!d || !m) return;
    const p = this.toModel(e);
    switch (d.kind) {
      case 'pan':
        this.view.x = d.view.x + e.clientX - d.start.x;
        this.view.y = d.view.y + e.clientY - d.start.y;
        d.moved ||= Math.hypot(e.clientX - d.start.x, e.clientY - d.start.y) > 3;
        this.applyView();
        break;
      case 'node': {
        const dx = snap(p.x - d.start.x, GRID);
        const dy = snap(p.y - d.start.y, GRID);
        if (dx === d.applied.x && dy === d.applied.y) break;
        const model = moveNodes(m, d.ids, dx - d.applied.x, dy - d.applied.y);
        d.applied = { x: dx, y: dy };
        this.emit({ model, label: `Move ${d.ids.join(', ')}`, coalesce: d.key });
        break;
      }
      case 'marquee': {
        d.to = p;
        const r = rectOf(d.start, p);
        this.layers.overlay.replaceChildren(
          svg('rect', { class: 'marquee', x: r.x, y: r.y, width: r.w, height: r.h })
        );
        break;
      }
      case 'boundary': {
        const x = snap(p.x - d.offset.x, GRID);
        const y = snap(p.y - d.offset.y, GRID);
        d.moved = true;
        this.emit({
          model: updateBoundary(m, d.id, (b) => Object.assign(b, { x, y })),
          label: 'Move boundary',
          coalesce: d.key,
        });
        break;
      }
      case 'resize':
        this.emit({
          model: updateBoundary(m, d.id, (b) => {
            b.w = Math.max(120, snap(p.x - b.x, GRID));
            b.h = Math.max(80, snap(p.y - b.y, GRID));
          }),
          label: 'Resize boundary',
          coalesce: d.key,
        });
        break;
      case 'ctrl': {
        const edge = m.edges.find((x) => x.id === d.edgeId);
        const o = edge && findNode(m, edge.origin);
        const t = edge && findNode(m, edge.target);
        if (!edge || !o || !t) break;
        const c = edgeCurve(edge, o, t);
        const anchor = d.which === 1 ? c.p0 : c.p1;
        const offset = { x: Math.round(p.x - anchor.x), y: Math.round(p.y - anchor.y) };
        this.emit({
          model: updateEdge(m, d.edgeId, (x) => {
            x.visual = { ...x.visual, [d.which === 1 ? 'ctrl1' : 'ctrl2']: offset };
          }),
          label: 'Shape flow',
          coalesce: d.key,
        });
        break;
      }
      case 'wire': {
        d.to = p;
        const from = findNode(m, d.from);
        this.layers.overlay.replaceChildren();
        for (const x of this.root.querySelectorAll('.drop-target'))
          x.classList.remove('drop-target');
        this.dropTarget(e)?.classList.add('drop-target');
        if (from)
          this.layers.overlay.append(
            svg('path', { class: 'wire', d: `M${from.visual.x},${from.visual.y} L${p.x},${p.y}` })
          );
        break;
      }
    }
  }

  /** The node or flow under the pointer during a wire drag. */
  private dropTarget(e: { clientX: number; clientY: number }): Element | null {
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    if (!hit || !this.root.contains(hit)) return null;
    const n = hit.closest('[data-node]');
    if (n && n.getAttribute('data-node') !== (this.drag?.kind === 'wire' ? this.drag.from : ''))
      return n;
    return hit.closest('.node.group') ?? hit.closest('[data-edge]');
  }

  private onPointerUp(e: PointerEvent): void {
    const d = this.drag;
    const m = this._model;
    if (d?.kind === 'wire' && m) {
      const target = this.dropTarget(e);
      const nodeId = target?.getAttribute('data-node');
      const edgeId = target?.getAttribute('data-edge');
      const groupId = target?.classList.contains('group')
        ? target.getAttribute('data-group')
        : null;
      if (groupId) {
        const g = findGroup(m, groupId);
        this.dispatchEvent(
          new CustomEvent('diagram-hint', {
            detail: `Unpack “${g?.label ?? groupId}” to connect to a symbol inside it.`,
            bubbles: true,
          })
        );
      } else if (nodeId) {
        const { model, id } = connect(m, d.from, nodeId);
        if (id)
          this.emit({
            model,
            label: `Connect ${d.from} → ${nodeId}`,
            select: { kind: 'edge', id },
          });
      } else if (edgeId) {
        this.emit({
          model: setControl(m, edgeId, d.from),
          label: `${d.from} controls ${edgeId}`,
          select: { kind: 'edge', id: edgeId },
        });
      }
    } else if (d?.kind === 'pan' && !d.moved) {
      this.select(null);
    } else if (d?.kind === 'marquee' && m) {
      const r = rectOf(d.start, d.to);
      const within = (q: Point) => q.x >= r.x && q.x <= r.x + r.w && q.y >= r.y && q.y <= r.y + r.h;
      const view = this.view_ ?? diagramView(m);
      // A packed group is taken whole when its symbol is inside the box.
      const inside = [
        ...m.nodes.filter((n) => view.nodes.has(n.id) && within(n.visual)).map((n) => n.id),
        ...view.packed.filter((g) => within(groupCentre(m, g.id))).flatMap((g) => nodesIn(m, g.id)),
      ];
      this.select(selectNodes([...(d.add ? selectedNodeIds(this._selection) : []), ...inside]));
    }
    this.endDrag();
  }

  private endDrag(): void {
    this.drag = null;
    this.root.classList.remove('wiring', 'panning');
    for (const x of this.root.querySelectorAll('.drop-target')) x.classList.remove('drop-target');
    this.render();
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const r = this.root.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX) * 2) {
      this.zoomBy(Math.exp(-e.deltaY * 0.0015), { x: e.clientX - r.left, y: e.clientY - r.top });
    } else {
      this.view.x -= e.deltaX;
      this.view.y -= e.deltaY;
      this.applyView();
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    const m = this._model;
    if (!m) return;
    const sel = this._selection;
    const focused = (e.target as Element).closest?.('[data-node]')?.getAttribute('data-node');
    if (e.key === 'Enter' && focused) {
      this.select({ kind: 'node', id: focused });
      e.preventDefault();
      return;
    }
    const focusedGroup = (e.target as Element).closest?.('.node.group')?.getAttribute('data-group');
    if (e.key === 'Enter' && focusedGroup) {
      this.select({ kind: 'group', id: focusedGroup });
      e.preventDefault();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
      // Ctrl+G packs the selected symbols into a group (FR-GRP-001).
      e.preventDefault();
      const ids = selectedNodeIds(sel);
      if (e.shiftKey || ids.length === 0) return;
      const { model, id } = groupNodes(m, ids);
      if (id)
        this.emit({ model, label: `Group ${ids.length} symbols`, select: { kind: 'group', id } });
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
      e.preventDefault();
      this.emit({
        model: removeSelection(m, sel),
        label: `Delete ${selectionKey(sel)}`,
        select: null,
      });
      return;
    }
    if (e.key === 'Escape') {
      if (this.drag) this.endDrag();
      else this.select(null);
      return;
    }
    const step = e.shiftKey ? GRID * 5 : GRID;
    const dirs: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    const dir = dirs[e.key];
    const ids = sel?.kind === 'group' ? nodesIn(m, sel.id) : selectedNodeIds(sel);
    if (dir && ids.length) {
      e.preventDefault();
      this.emit({
        model: moveNodes(m, ids, dir.x, dir.y),
        label: `Move ${ids.join(', ')}`,
        coalesce: `nudge:${ids.join(',')}`,
      });
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      this.select(selectNodes(m.nodes.map((n) => n.id)));
    }
  }

  private unpack(id: string): void {
    const g = this._model ? findGroup(this._model, id) : undefined;
    if (!g || !this._model) return;
    this.emit({
      model: setCollapsed(this._model, id, false),
      label: `Unpack ${g.label}`,
      select: { kind: 'group', id },
    });
  }

  private onDoubleClick(e: MouseEvent): void {
    const node = (e.target as Element).closest('[data-node]');
    if (node)
      this.dispatchEvent(
        new CustomEvent('diagram-rename', { detail: node.getAttribute('data-node'), bubbles: true })
      );
  }

  private onDrop(e: DragEvent): void {
    if (e.dataTransfer?.types.includes(TRANSACTION_DRAG_TYPE) && this._model) {
      e.preventDefault();
      const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-edge]');
      const id = hit?.getAttribute('data-edge');
      const edge = id ? this._model.edges.find((x) => x.id === id) : undefined;
      if (edge && !transactionOf(this._model, edge)) {
        this.emit({
          model: toggleTransaction(this._model, edge.id),
          label: `Transaction on ${edge.id}`,
          select: { kind: 'edge', id: edge.id },
        });
      } else {
        this.dispatchEvent(
          new CustomEvent('diagram-hint', {
            detail: edge
              ? 'That flow is already part of a transaction.'
              : 'Drop the transaction onto a flow.',
            bubbles: true,
          })
        );
      }
      return;
    }
    if (e.dataTransfer?.types.includes(SENSOR_DRAG_TYPE) && this._model) {
      e.preventDefault();
      const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-edge]');
      const id = hit?.getAttribute('data-edge');
      const edge = id ? this._model.edges.find((x) => x.id === id) : undefined;
      if (edge && !edge.visual?.sensor) {
        this.emit({
          model: toggleSensor(this._model, edge.id),
          label: `Sensor on ${edge.id}`,
          select: { kind: 'edge', id: edge.id },
        });
      } else if (!edge) {
        this.dispatchEvent(
          new CustomEvent('diagram-hint', { detail: 'Drop the sensor onto a flow.', bubbles: true })
        );
      }
      return;
    }
    const type = e.dataTransfer?.getData(NODE_DRAG_TYPE);
    if (!type || !isNodeType(type) || !this._model) return;
    e.preventDefault();
    const p = this.toModel(e);
    this.place(type, { x: snap(p.x, GRID), y: snap(p.y, GRID) });
  }

  /** The drawn diagram, for export: the live SVG element. */
  get svgElement(): SVGSVGElement {
    return this.root;
  }

  /** Pan just enough to bring a point (with a symbol's margin) into view. */
  reveal(p: Point): void {
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    const pad = SIZE * this.view.s;
    const sx = p.x * this.view.s + this.view.x;
    const sy = p.y * this.view.s + this.view.y;
    if (sx < pad) this.view.x += pad - sx;
    else if (sx > w - pad) this.view.x -= sx - (w - pad);
    if (sy < pad) this.view.y += pad - sy;
    else if (sy > h - pad) this.view.y -= sy - (h - pad);
    this.applyView();
  }

  /** Is a model point inside the visible canvas, a symbol's margin in from the edge? */
  private visible(p: Point): boolean {
    const pad = (SIZE / 2) * this.view.s;
    const sx = p.x * this.view.s + this.view.x;
    const sy = p.y * this.view.s + this.view.y;
    return (
      sx >= pad &&
      sy >= pad &&
      sx <= this.root.clientWidth - pad &&
      sy <= this.root.clientHeight - pad
    );
  }

  /**
   * Add a symbol and select it: at the drop point, or for a palette click at
   * the free grid spot nearest the viewport centre, preferring one in view.
   */
  place(type: string, at?: Point): void {
    const m = this._model;
    if (!isNodeType(type) || !m) return;
    let p = at;
    if (!p) {
      const c = this.centre();
      const free = (q: Point) =>
        m.nodes.every((n) => Math.hypot(n.visual.x - q.x, n.visual.y - q.y) >= SIZE * 1.6);
      const cells: Point[] = [];
      for (let i = -8; i <= 8; i++) {
        for (let j = -6; j <= 6; j++)
          cells.push({ x: c.x + i * SIZE * 1.75, y: c.y + j * SIZE * 1.6 });
      }
      // Nearest first; on a tie, right before left, so a row built by clicks reads left to right.
      const near = (q: Point) => Math.hypot(q.x - c.x, (q.y - c.y) * 1.3) + (q.x < c.x ? 1 : 0);
      cells.sort((a, b) => near(a) - near(b));
      const spot = cells.find((q) => free(q) && this.visible(q)) ?? cells.find(free) ?? c;
      p = { x: snap(spot.x, GRID), y: snap(spot.y, GRID) };
    }
    const { model, id } = addNode(m, type, p);
    this.reveal(p);
    this.emit({ model, label: `Add ${symbolFor(type).label}`, select: { kind: 'node', id } });
  }
}

define('diagram-canvas', DiagramCanvas);
