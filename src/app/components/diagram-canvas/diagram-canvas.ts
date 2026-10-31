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
  findEdge,
  findNode,
  removeSelection,
  setControl,
  snap,
  updateBoundary,
  updateEdge,
  updateNode,
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
  boxOf,
  couplePoint,
  coupledCurve,
  edgeCurve,
  GROUP_HALF,
  halfExtent,
  pathData,
  pointAt,
  SCALE,
  type Curve,
  SIZE,
  SYMBOL_SCALE,
  type Shape,
} from '../../../diagram/geometry.ts';
import { OUTLINES, SYMBOL_DEFS } from '../../../diagram/symbols.ts';
import { builtinIcon, DEFAULT_ICON, ICON_DEFS } from '../../../diagram/icons.ts';
import { iconsOf } from '../../../model/icons.ts';
import { marksFor } from '../../../model/provenance.ts';
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
const GAUGES_KEY = 'gssk-studio-level-gauges';
const FILL_KEY = 'gssk-studio-level-fill';
const ICONS_KEY = 'gssk-studio-icons';

/** A view switch remembered in this browser, or its default. */
function storedFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

function storeFlag(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    // Not remembered.
  }
}
const MIN_SCALE = 0.2;
const MAX_SCALE = 4;
/** A packed group's ports: the symbols inside it that flows reach, drawn this small (FR-GRP-001). */
const PORT_SCALE = 0.38;
/** Ports sit this far apart: wider for two, which then have room for a short label each. */
const portStep = (count: number) => (count <= 2 ? 56 : 38);
/** How far above a selected symbol its turn knob sits. */
const ROTATE_REACH = 30;

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
  /**
   * Who made the edit, for the marks on inputs (ADR 0016): the assistant sets
   * its own; calibration and (by default) a person replace the ones they change.
   */
  by?: 'assistant' | 'calibration';
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
  | { kind: 'resize'; id: string; key: string }
  /** Turning by the knob: the pointer's angle and the symbol's turn when the drag began. */
  | { kind: 'rotate'; id: string; key: string; from: number; base: number }
  | { kind: 'scale'; id: string; key: string };

export class DiagramCanvas extends BaseComponent {
  private _model: StudioModel | null = null;
  private _selection: Selection = null;
  private _playback: Playback | null = null;
  private _issues = new Map<string, Marked>();
  private view = { x: 0, y: 0, s: 1 };
  /** Draw flows as wide as their rate during playback (FR-RES-003); off by default. */
  private flowWidths = storedFlag(FLOW_WIDTHS_KEY, false);
  /** Show each storage's level as a gauge beside it, as a fill of the symbol, or both (FR-RES-003). */
  private gauges = storedFlag(GAUGES_KEY, true);
  private fill = storedFlag(FILL_KEY, false);
  /** Draw each symbol as a picture instead of its Energese symbol (FR-EDIT-014). */
  private icons = storedFlag(ICONS_KEY, false);
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
  /** Flow badges, appended to the overlay once every flow is drawn. */
  private edgeBadges: SVGGElement[] = [];

  private root!: SVGSVGElement;
  private world!: SVGGElement;
  private layers!: {
    boundaries: SVGGElement;
    /** Packed groups, beneath the flows, so a flow reaching a port inside one is seen to. */
    groups: SVGGElement;
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
      ${ICON_DEFS}
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
      groups: svg('g', { class: 'groups' }),
      edges: svg('g', { class: 'edges' }),
      nodes: svg('g', { class: 'nodes' }),
      overlay: svg('g', { class: 'overlay' }),
    };
    this.world.append(
      bg,
      this.layers.boundaries,
      this.layers.groups,
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
    const widths = this.switchButton(
      'flow',
      'Flow widths: draw each flow as wide as its rate',
      FLOW_WIDTHS_KEY,
      () => this.flowWidths,
      (on) => {
        this.flowWidths = on;
        this.applyPlayback();
      }
    );
    const gauges = this.switchButton(
      'gauge',
      'Level gauges: show each storage’s level in a bar beside it',
      GAUGES_KEY,
      () => this.gauges,
      (on) => {
        this.gauges = on;
        this.render();
      }
    );
    const fill = this.switchButton(
      'level',
      'Level fill: fill each storage’s symbol from the bottom up to its level',
      FILL_KEY,
      () => this.fill,
      (on) => {
        this.fill = on;
        this.render();
      }
    );
    const pictures = this.switchButton(
      'image',
      'Icons: draw each symbol as a picture instead of its Energese symbol',
      ICONS_KEY,
      () => this.icons,
      (on) => {
        this.icons = on;
        this.render();
      }
    );
    this.append(
      this.root,
      this.hint,
      el(
        'div',
        { class: 'zoom' },
        pictures,
        el('span', { class: 'sep' }),
        widths,
        gauges,
        fill,
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

  /** A pressed/unpressed view switch, remembered in this browser. */
  private switchButton(
    name: string,
    label: string,
    key: string,
    get: () => boolean,
    set: (on: boolean) => void
  ): HTMLButtonElement {
    const b = iconButton(name, label);
    b.setAttribute('aria-pressed', String(get()));
    b.onclick = () => {
      const on = !get();
      b.setAttribute('aria-pressed', String(on));
      storeFlag(key, on);
      set(on);
    };
    return b;
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

  /**
   * The "assumed" mark (ADR 0016): on a symbol or flow with an input the
   * assistant set and nobody has replaced, saying which and why.
   */
  private assumedMark(kind: 'node' | 'edge', id: string, x: number, y: number): SVGElement | null {
    const marks = this._model
      ? marksFor(this._model, kind, id).filter((x) => x.mark.by === 'assistant')
      : [];
    if (marks.length === 0) return null;
    const t = svg('text', { class: 'assumed', x, y });
    t.textContent = '≈';
    const title = svg('title');
    title.textContent = `Assumed by the assistant, not from data: ${marks
      .map((x) => `${x.field.replace(/^params\./, '')}${x.mark.why ? ` (${x.mark.why})` : ''}`)
      .join('; ')}. Edit or calibrate to replace.`;
    t.append(title);
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
    for (const e of view.edges) this.renderEdge(m, e);
    for (const b of view.bundles) this.renderBundle(m, b);
    this.layers.overlay.append(...this.edgeBadges);
    for (const n of m.nodes) if (view.nodes.has(n.id)) this.renderNode(n);
    for (const g of view.packed) this.renderGroup(m, g);
    this.applyPlayback();
    this.applyView();
  }

  private renderNode(n: ModelNode): void {
    const spec = symbolFor(n.type);
    // The symbol is drawn at its own size and turn; its labels, gauge and port sit
    // upright around the box that holds it (FR-EDIT-013).
    const { w, h } = halfExtent(n.type);
    const box = boxOf(n);
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
    const glow = this.glow(this._issues.get(n.id), box.w, box.h);
    if (glow) g.append(glow);
    g.append(
      svg('rect', {
        class: 'halo',
        x: -box.w - 8,
        y: -box.h - 8,
        width: 2 * box.w + 16,
        height: 2 * box.h + 16,
        rx: 6,
      })
    );
    const shape = svg('g', {
      class: 'shape',
      transform: `rotate(${n.visual.rotation ?? 0}) scale(${n.visual.scale ?? 1})`,
    });
    g.append(shape);
    shape.append(svg('rect', { class: 'body', x: -w, y: -h, width: 2 * w, height: 2 * h, rx: 4 }));
    const leveled = spec.holdsState && !!n.visual.capacity;
    // In the icon view a picture has no outline to fill, so its level shows as a gauge.
    const outline = this.icons ? undefined : OUTLINES[spec.symbol];
    if (leveled && this.fill && outline) {
      // The symbol filled from the bottom up to its level: a hard-stopped gradient over its outline.
      const id = `level-${this.nodeEls.size}`;
      const grad = svg('linearGradient', { id, x1: 0, y1: 1, x2: 0, y2: 0 });
      grad.append(
        svg('stop', { class: 'level-on', offset: 0 }),
        svg('stop', { class: 'level-off', offset: 0 })
      );
      shape.append(
        grad,
        svg('path', {
          class: 'level-fill',
          d: outline,
          fill: `url(#${id})`,
          transform: `translate(${-SIZE / 2} ${-SIZE / 2}) scale(${SCALE})`,
        })
      );
    }
    shape.append(
      this.icons
        ? this.picture(n)
        : svg('use', {
            href: `#${spec.symbol}`,
            x: -SIZE / 2,
            y: -SIZE / 2,
            width: SIZE,
            height: SIZE,
          })
    );
    const gauge = leveled && (this.gauges || !outline);
    if (gauge) {
      const { w, h } = box;
      g.append(
        svg('rect', { class: 'gauge-bg', x: w + 6, y: -h, width: 6, height: 2 * h, rx: 2 }),
        svg('rect', { class: 'gauge', x: w + 6, y: h, width: 6, height: 0, rx: 2 })
      );
    }
    const text = svg('text', { class: 'label', y: box.h + 18 });
    text.textContent = label;
    const reading = svg('text', { class: 'reading', y: box.h + 32 });
    g.append(
      text,
      reading,
      svg('circle', {
        class: 'port',
        'data-port': n.id,
        cx: box.w + (gauge ? 20 : 8),
        cy: 0,
        r: 6,
      })
    );
    if (n.forcing) g.append(this.forcedMark(box.w + 2, -box.h + 4));
    const title = svg('title');
    title.textContent = `${spec.label} “${label}” (${n.id})${n.forcing ? `, forced: ${describeForcing(n.forcing)}` : ''}`;
    g.append(title);
    const nb = this.badge(n.id, -box.w - 2, -box.h - 2);
    if (nb) g.append(nb);
    const assumed = this.assumedMark('node', n.id, -box.w - 4, box.h - 2);
    if (assumed) g.append(assumed);
    this.nodeEls.set(n.id, g);
    this.layers.nodes.append(g);
    if (selected && this._selection?.kind === 'node') this.renderShapeHandles(n);
  }

  /**
   * A symbol in the icon view (FR-EDIT-014): the model's own picture as an
   * image, or a built-in line icon; its type's default when it names none or
   * one that is gone.
   */
  private picture(n: ModelNode): SVGElement {
    const size = SIZE * 0.7;
    const own = n.visual.icon
      ? iconsOf(this._model!).find((i) => i.id === n.visual.icon)
      : undefined;
    if (own) {
      return svg('image', {
        class: 'picture',
        href: own.href,
        x: -size / 2,
        y: -size / 2,
        width: size,
        height: size,
        preserveAspectRatio: 'xMidYMid meet',
      });
    }
    const named = n.visual.icon?.startsWith('builtin:') ? n.visual.icon.slice(8) : undefined;
    const name = named && builtinIcon(named) ? named : DEFAULT_ICON[n.type];
    return svg('use', {
      class: 'picture',
      href: `#icon-${name}`,
      x: -size / 2,
      y: -size / 2,
      width: size,
      height: size,
    });
  }

  /**
   * Turn and size handles on a single selected symbol (FR-EDIT-013), upright
   * whatever its turn: a knob above it turns it, in 15° steps (Shift: 1°); the
   * bottom-right corner sizes it.
   */
  private renderShapeHandles(n: ModelNode): void {
    const { w, h } = boxOf(n);
    const { x, y } = n.visual;
    const top = { x, y: y - h - 8 };
    const knob = { x, y: y - h - ROTATE_REACH };
    const corner = { x: x + w + 8, y: y + h + 8 };
    const turner = svg('circle', {
      class: 'handle rotate-handle',
      'data-rotate': n.id,
      cx: knob.x,
      cy: knob.y,
      r: 6,
    });
    const sizer = svg('rect', {
      class: 'handle size-handle',
      'data-scale': n.id,
      x: corner.x - 5,
      y: corner.y - 5,
      width: 10,
      height: 10,
      rx: 2,
    });
    const rt = svg('title');
    rt.textContent = `Drag to turn (Shift: by 1°); now ${n.visual.rotation ?? 0}°`;
    const st = svg('title');
    st.textContent = `Drag to resize; now ${Math.round((n.visual.scale ?? 1) * 100)} %`;
    turner.append(rt);
    sizer.append(st);
    this.layers.overlay.append(
      svg('line', { class: 'handle-line', x1: top.x, y1: top.y, x2: knob.x, y2: knob.y }),
      turner,
      sizer
    );
  }

  /** Where on a flow its transaction diamond sits: clear of a gate or sensor at the middle. */
  private diamondT(m: StudioModel, e: ModelEdge): number {
    const control = e.params.control_node ? findNode(m, e.params.control_node) : undefined;
    return control || e.visual?.sensor ? 0.64 : 0.5;
  }

  /**
   * The marked flow a counter-flow runs alongside (FR-TRX-001): while both are
   * drawn, the counter-flow has not been shaped by hand, and its ends lie
   * back the way the marked flow came, as Odum draws a purchase.
   */
  private coupledTo(m: StudioModel, e: ModelEdge): ModelEdge | undefined {
    const trx = transactionOf(m, e);
    if (!trx || trx.marked === e || e.visual?.ctrl1 || e.visual?.ctrl2) return undefined;
    const base = trx.marked;
    if (partnerOf(m, base) !== e || !this.view_?.edges.some((x) => x.id === base.id)) return;
    const chord = (x: ModelEdge): Point | undefined => {
      const o = findNode(m, x.origin);
      const t = findNode(m, x.target);
      return o && t ? { x: t.visual.x - o.visual.x, y: t.visual.y - o.visual.y } : undefined;
    };
    const a = chord(base);
    const b = chord(e);
    if (!a || !b) return undefined;
    const cos = (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y) || 1);
    return cos < -0.3 ? base : undefined;
  }

  /**
   * Which of the parallel flows from the same origin to the same target this
   * is (FR-EDIT-003): 0 for the first, each later one bowing further out.
   */
  private laneOf(m: StudioModel, e: ModelEdge): number {
    let lane = 0;
    for (const x of m.edges) {
      if (x === e) return lane;
      if (x.origin === e.origin && x.target === e.target) lane++;
    }
    return 0;
  }

  /** A flow's curve; a counter-flow follows its marked flow. */
  private curveOf(m: StudioModel, e: ModelEdge): Curve | undefined {
    const o = findNode(m, e.origin);
    const t = findNode(m, e.target);
    if (!o || !t) return undefined;
    const base = this.coupledTo(m, e);
    const bo = base && findNode(m, base.origin);
    const bt = base && findNode(m, base.target);
    if (base && bo && bt)
      return coupledCurve(
        edgeCurve(base, bo, bt, this.laneOf(m, base)),
        this.diamondT(m, base),
        o,
        t
      );
    return edgeCurve(e, o, t, this.laneOf(m, e));
  }

  private renderEdge(m: StudioModel, e: ModelEdge): void {
    const curve = this.curveOf(m, e);
    if (!curve) return;
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
    const counter = trx && trx.marked !== e;
    const alongside = counter ? this.coupledTo(m, e) : undefined;
    if (trx && !alongside) {
      // Odum's transaction diamond: one across both flows when the counter-flow runs alongside.
      const t = this.diamondT(m, e);
      let at = pointAt(curve, t);
      const p = counter ? undefined : partnerOf(m, e);
      if (p && this.coupledTo(m, p) === e) {
        const po = findNode(m, p.origin);
        const pt = findNode(m, p.target);
        if (po && pt) {
          const pass = couplePoint(curve, t, po, pt);
          at = { x: (at.x + pass.x) / 2, y: (at.y + pass.y) / 2 };
        }
      }
      // A counter-flow drawn apart from its marked flow carries a small diamond of its own.
      const size = counter ? 28 : 44;
      g.append(
        svg('use', {
          class: `transaction${counter ? ' counter' : ''}`,
          href: '#odum-transaction',
          x: at.x - size / 2,
          y: at.y - size / 2,
          width: size,
          height: size,
        })
      );
      if (!counter) g.append(svg('text', { class: 'price-reading', x: at.x, y: at.y + 32 }));
    }
    if (e.forcing) {
      // Clear of the labels at the origin end, the gate or sensor mid-flow and the badge at 0.78.
      const at = pointAt(curve, 0.38);
      g.append(this.forcedMark(at.x + 10, at.y - 6));
    }
    const guess = pointAt(curve, 0.22);
    const assumed = this.assumedMark('edge', e.id, guess.x, guess.y - 8);
    if (assumed) g.append(assumed);
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

  /** Where a packed group draws the small copy of a symbol inside it that flows reach. */
  private portAt(m: StudioModel, groupId: string, nodeId: string): Point | undefined {
    const ports = this.view_?.ports.get(groupId);
    const i = ports?.indexOf(nodeId) ?? -1;
    if (!ports || i < 0) return undefined;
    const c = groupCentre(m, groupId);
    return { x: c.x + (i - (ports.length - 1) / 2) * portStep(ports.length), y: c.y + 4 };
  }

  /** Where a flow end is drawn, and its outline: a symbol, a packed group's box, or a port in it. */
  private shapeOf(m: StudioModel, end: End): Shape {
    const port = end.port ? findNode(m, end.port) : undefined;
    const at = port && this.portAt(m, end.id, port.id);
    if (port && at) return { type: port.type, visual: { ...at, scale: PORT_SCALE } };
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
    const ports = this.view_?.ports.get(grp.id) ?? [];
    const n = svg('text', { class: 'group-count', y: ports.length ? -h + 13 : 4 });
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
    // Odum's inset: what the flows across the edge reach inside, drawn small; wire onto one.
    for (const id of ports) {
      const inner = findNode(m, id);
      const at = this.portAt(m, grp.id, id);
      if (!inner || !at) continue;
      const pg = svg('g', {
        class: 'inner-port',
        'data-inner': id,
        transform: `translate(${at.x - c.x} ${at.y - c.y}) scale(${PORT_SCALE})`,
      });
      const pt = svg('title');
      pt.textContent = `${inner.visual.label ?? id} (${id}), inside “${grp.label}”: flows across the edge reach it`;
      pg.append(
        svg('rect', {
          class: 'inner-hit',
          x: -SIZE / 2,
          y: -SIZE / 2,
          width: SIZE,
          height: SIZE,
        }),
        this.icons
          ? this.picture(inner)
          : svg('use', {
              href: `#${symbolFor(inner.type).symbol}`,
              x: -SIZE / 2,
              y: -SIZE / 2,
              width: SIZE,
              height: SIZE,
            }),
        pt
      );
      g.append(pg);
      if (ports.length <= 2) {
        const name = inner.visual.label ?? id;
        const tag = svg('text', { class: 'inner-label', x: at.x - c.x, y: at.y - c.y + 21 });
        tag.textContent = name.length > 9 ? `${name.slice(0, 8)}…` : name;
        g.append(tag);
      }
    }
    const badge = this.badgeFor(mark, -w - 2, -h - 2);
    if (badge) g.append(badge);
    this.groupEls.set(grp.id, g);
    this.layers.groups.append(g);
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
    // One flow drawn to a port is that flow: dashed for money, with its transaction diamond.
    const only = b.edges.length === 1 ? findEdge(m, b.edges[0] ?? '') : undefined;
    const kind = only ? kindOfCarrierId(m, only.carrier) : undefined;
    if (kind) g.classList.add(`kind-${kind}`);
    g.append(
      svg('path', { class: 'hit', d }),
      svg('path', { class: 'line', d, 'marker-end': 'url(#arrow)' }),
      count,
      svg('text', { class: 'sensor-reading bundle-reading', x: mid.x, y: mid.y + 18 }),
      title
    );
    const trx = only && transactionOf(m, only);
    if (trx) {
      const size = trx.marked === only ? 44 : 28;
      g.append(
        svg('use', {
          class: `transaction${trx.marked === only ? '' : ' counter'}`,
          href: '#odum-transaction',
          x: mid.x - size / 2,
          y: mid.y - size / 2,
          width: size,
          height: size,
        })
      );
    }
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
      if (!n.visual.capacity) continue;
      const frac = Math.max(0, Math.min(1, (v ?? n.value) / n.visual.capacity));
      const gauge = g.querySelector<SVGRectElement>('.gauge');
      if (gauge) {
        const { h } = boxOf(n);
        gauge.setAttribute('y', String(h - 2 * h * frac));
        gauge.setAttribute('height', String(2 * h * frac));
      }
      for (const stop of g.querySelectorAll('.level-on, .level-off'))
        stop.setAttribute('offset', String(frac));
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
    const turner = target.closest('[data-rotate]');
    const sizer = target.closest('[data-scale]');
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
    } else if (turner) {
      const id = turner.getAttribute('data-rotate') ?? '';
      const n = findNode(this._model, id);
      if (!n) return;
      this.drag = {
        kind: 'rotate',
        id,
        key,
        from: Math.atan2(p.y - n.visual.y, p.x - n.visual.x),
        base: n.visual.rotation ?? 0,
      };
    } else if (sizer) {
      this.drag = { kind: 'scale', id: sizer.getAttribute('data-scale') ?? '', key };
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
      case 'rotate': {
        const n = findNode(m, d.id);
        if (!n) break;
        // Turned by as much as the pointer has swung about the symbol's centre.
        const swing = Math.atan2(p.y - n.visual.y, p.x - n.visual.x) - d.from;
        const raw = d.base + (swing * 180) / Math.PI;
        const step = e.shiftKey ? 1 : 15;
        const deg = (((Math.round(raw / step) * step) % 360) + 360) % 360;
        if (deg === (n.visual.rotation ?? 0)) break;
        this.emit({
          model: updateNode(m, d.id, (x) => {
            if (deg === 0) delete x.visual.rotation;
            else x.visual.rotation = deg;
          }),
          label: `Turn ${d.id}`,
          coalesce: d.key,
        });
        break;
      }
      case 'scale': {
        const n = findNode(m, d.id);
        if (!n) break;
        // The corner handle sits 8 units past the box's corner; this is where it sits at size 1.
        const { w, h } = boxOf({ type: n.type, visual: { ...n.visual, scale: 1 } });
        const k = Math.hypot(p.x - n.visual.x, p.y - n.visual.y) / Math.hypot(w + 8, h + 8);
        const { min, max, step } = SYMBOL_SCALE;
        const scale = Math.min(max, Math.max(min, Math.round(k / step) * step));
        const rounded = Math.round(scale * 100) / 100;
        if (rounded === (n.visual.scale ?? 1)) break;
        this.emit({
          model: updateNode(m, d.id, (x) => {
            if (rounded === 1) delete x.visual.scale;
            else x.visual.scale = rounded;
          }),
          label: `Resize ${d.id}`,
          coalesce: d.key,
        });
        break;
      }
      case 'ctrl': {
        const edge = m.edges.find((x) => x.id === d.edgeId);
        const c = edge && this.curveOf(m, edge);
        if (!edge || !c) break;
        const anchor = d.which === 1 ? c.p0 : c.p1;
        const offset = { x: Math.round(p.x - anchor.x), y: Math.round(p.y - anchor.y) };
        // Shaping a counter-flow by hand keeps its other handle where it was drawn.
        const coupled = this.coupledTo(m, edge);
        const held = (q: Point, at: Point) => ({
          x: Math.round(q.x - at.x),
          y: Math.round(q.y - at.y),
        });
        this.emit({
          model: updateEdge(m, d.edgeId, (x) => {
            x.visual = {
              ...x.visual,
              ...(coupled ? { ctrl1: held(c.c1, c.p0), ctrl2: held(c.c2, c.p1) } : {}),
              [d.which === 1 ? 'ctrl1' : 'ctrl2']: offset,
            };
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
    const from = this.drag?.kind === 'wire' ? this.drag.from : '';
    let fallback: Element | null = null;
    // A symbol wins over a flow; a port in a packed group (the symbol inside it
    // stands for) wins over the flows drawn to it, which lie above the group.
    for (const hit of document.elementsFromPoint(e.clientX, e.clientY)) {
      if (!this.root.contains(hit)) continue;
      const n = hit.closest('[data-node]') ?? hit.closest('[data-inner]');
      const id = n?.getAttribute('data-node') ?? n?.getAttribute('data-inner');
      if (n && id !== from) return n;
      fallback ??= hit.closest('.node.group') ?? hit.closest('[data-edge]');
    }
    return fallback;
  }

  private onPointerUp(e: PointerEvent): void {
    const d = this.drag;
    const m = this._model;
    if (d?.kind === 'wire' && m) {
      const target = this.dropTarget(e);
      const nodeId = target?.getAttribute('data-node') ?? target?.getAttribute('data-inner');
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
