/**
 * <diagram-canvas>: the Odum diagram editor (SPEC §6). It draws a model and
 * turns pointer and keyboard input into model operations from
 * src/model/ops.ts. It never owns the model: every edit is dispatched as a
 * `diagram-edit` event and comes back through the `model` property, so the
 * studio screen keeps history and saving in one place.
 */
import { BaseComponent, define } from '../../core/base-component.ts';
import { isNodeType, symbolFor } from '../../../model/catalogue.ts';
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
import type { ModelEdge, ModelNode, Point, StudioModel } from '../../../model/types.ts';
import {
  bounds,
  edgeCurve,
  halfExtent,
  pathData,
  pointAt,
  SIZE,
} from '../../../diagram/geometry.ts';
import { SYMBOL_DEFS } from '../../../diagram/symbols.ts';
import { el, formatNumber, iconButton, svg } from '../../ui.ts';
import style from './diagram-canvas.css?raw';

export const NODE_DRAG_TYPE = 'application/x-gssk-node-type';
/** Dragged from the palette's Sensor tool; dropped on a flow (FR-EDIT-010). */
export const SENSOR_DRAG_TYPE = 'application/x-gssk-sensor';
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
  private _invalid = new Set<string>();
  private view = { x: 0, y: 0, s: 1 };
  /** Draw flows as wide as their rate during playback (FR-RES-003); off by default. */
  private flowWidths = storedFlowWidths();
  private drag: Drag | null = null;
  private fitted = false;
  private gestureSeq = 0;
  private readonly nodeEls = new Map<string, SVGGElement>();
  private readonly edgeEls = new Map<string, SVGGElement>();

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
      if (e.dataTransfer && (types.includes(NODE_DRAG_TYPE) || types.includes(SENSOR_DRAG_TYPE))) {
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

  /** Ids of nodes and flows with an error, drawn in the critical colour. */
  set invalid(ids: ReadonlySet<string>) {
    this._invalid = new Set(ids);
    if (this.root) this.render();
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
      const b = bounds(pts, SIZE);
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
    for (const e of m.edges) this.renderEdge(m, e);
    for (const n of m.nodes) this.renderNode(n);
    this.applyPlayback();
    this.applyView();
  }

  private renderNode(n: ModelNode): void {
    const spec = symbolFor(n.type);
    const { w, h } = halfExtent(n.type);
    const selected = selectedNodeIds(this._selection).includes(n.id);
    const label = n.visual.label ?? n.id;
    const g = svg('g', {
      class: `node${selected ? ' selected' : ''}${this._invalid.has(n.id) ? ' invalid' : ''}`,
      'data-node': n.id,
      transform: `translate(${n.visual.x} ${n.visual.y})`,
      tabindex: 0,
      role: 'button',
      'aria-label': `${spec.label}: ${label}`,
      'aria-pressed': selected ? 'true' : 'false',
    });
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
    const title = svg('title');
    title.textContent = `${spec.label} “${label}” (${n.id})`;
    g.append(title);
    this.nodeEls.set(n.id, g);
    this.layers.nodes.append(g);
  }

  private renderEdge(m: StudioModel, e: ModelEdge): void {
    const o = findNode(m, e.origin);
    const t = findNode(m, e.target);
    if (!o || !t) return;
    const curve = edgeCurve(e, o, t);
    const selected = this._selection?.kind === 'edge' && this._selection.id === e.id;
    const g = svg('g', {
      class: `edge ${e.logic}${selected ? ' selected' : ''}${this._invalid.has(e.id) ? ' invalid' : ''}`,
      'data-edge': e.id,
    });
    const d = pathData(curve);
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
      g.append(
        svg('line', {
          class: 'control',
          x1: control.visual.x,
          y1: control.visual.y,
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
    const title = svg('title');
    title.textContent = `${e.id}: ${e.logic}, k = ${e.params.k}${control ? `, controlled by ${control.id}` : ''}${e.visual?.sensor ? ', sensed' : ''}`;
    g.append(title);
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
    return hit.closest('[data-edge]');
  }

  private onPointerUp(e: PointerEvent): void {
    const d = this.drag;
    const m = this._model;
    if (d?.kind === 'wire' && m) {
      const target = this.dropTarget(e);
      const nodeId = target?.getAttribute('data-node');
      const edgeId = target?.getAttribute('data-edge');
      if (nodeId) {
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
      const inside = m.nodes
        .filter(
          (n) =>
            n.visual.x >= r.x &&
            n.visual.x <= r.x + r.w &&
            n.visual.y >= r.y &&
            n.visual.y <= r.y + r.h
        )
        .map((n) => n.id);
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
    const ids = selectedNodeIds(sel);
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

  private onDoubleClick(e: MouseEvent): void {
    const node = (e.target as Element).closest('[data-node]');
    if (node)
      this.dispatchEvent(
        new CustomEvent('diagram-rename', { detail: node.getAttribute('data-node'), bubbles: true })
      );
  }

  private onDrop(e: DragEvent): void {
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
