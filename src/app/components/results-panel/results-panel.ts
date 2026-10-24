/**
 * <results-panel>: a run's time series, its provenance, and playback
 * (SPEC §8). The chart is in-house SVG (ADR 0001): one shared y-axis, series
 * coloured by entity, a crosshair with a tooltip, direct end labels when four
 * or fewer lines are drawn, and a table view of the same numbers.
 */
import { BaseComponent, define } from '../../core/base-component.ts';
import type { RunResult } from '../../../sim/run.ts';
import { resultCsv } from '../../../viz/csv.ts';
import { seriesColor, SlotAssigner } from '../../../viz/colors.ts';
import { decimate, extent, linear, niceTicks, tickLabel } from '../../../viz/scale.ts';
import { downloadText, el, formatNumber, icon, iconButton, svg } from '../../ui.ts';
import type { Playback } from '../diagram-canvas/diagram-canvas.ts';
import style from './results-panel.css?raw';

const M = { l: 56, r: 16, t: 14, b: 26 };
const END_LABEL_W = 96;

/** One chartable line: a node's level, or the rate of a flow that carries a sensor. */
interface Series {
  id: string;
  label: string;
  values: Float64Array;
  /** Charted when a run first arrives: storages, not heat sinks or sensed flows. */
  byDefault: boolean;
}

function seriesOf(r: RunResult): Series[] {
  return [
    ...r.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      values: n.values,
      // Heat sinks only accumulate and would flatten the axis.
      byDefault: n.holdsState && n.type !== 'sink',
    })),
    ...r.flows
      .filter((f) => f.sensed)
      .map((f) => ({
        id: `flow:${f.id}`,
        label: `${f.id} (J)`,
        values: f.values,
        byDefault: false,
      })),
  ];
}

export type RunStatus =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'error'; message: string }
  | { state: 'done'; stale: boolean };

export class ResultsPanel extends BaseComponent {
  private result: RunResult | null = null;
  private status: RunStatus = { state: 'idle' };
  private readonly slots = new SlotAssigner();
  private sample = 0;
  private showTable = false;
  private playing = 0;
  private fileName = 'results';
  private maxFlow = 0;

  private statusEl!: HTMLElement;
  private seriesEl!: HTMLElement;
  private plot!: HTMLElement;
  private range!: HTMLInputElement;
  private timeEl!: HTMLElement;
  private playBtn!: HTMLButtonElement;
  private tableBtn!: HTMLButtonElement;
  private csvBtn!: HTMLButtonElement;

  constructor() {
    super('', style);
  }

  override init(): void {
    if (this.statusEl) return;
    this.statusEl = el('span', { class: 'status', role: 'status' });
    this.tableBtn = iconButton('table', 'Show as table');
    this.tableBtn.setAttribute('aria-pressed', 'false');
    this.tableBtn.onclick = () => {
      this.showTable = !this.showTable;
      this.tableBtn.setAttribute('aria-pressed', String(this.showTable));
      this.drawPlot();
    };
    this.csvBtn = iconButton('download', 'Download results as CSV');
    this.csvBtn.onclick = () => {
      if (this.result) downloadText(`${this.fileName}.csv`, resultCsv(this.result), 'text/csv');
    };
    this.append(
      el(
        'header',
        { class: 'head' },
        el('h2', { text: 'Results' }),
        this.statusEl,
        el('span', { class: 'spacer' }),
        this.tableBtn,
        this.csvBtn
      )
    );
    this.seriesEl = el('div', { class: 'series', role: 'group', 'aria-label': 'Series to chart' });
    this.plot = el('div', { class: 'plot' });
    this.append(el('div', { class: 'body' }, this.seriesEl, this.plot));
    this.playBtn = iconButton('play', 'Play the run');
    this.playBtn.onclick = () => this.togglePlay();
    this.range = el('input', {
      type: 'range',
      min: '0',
      max: '0',
      value: '0',
      'aria-label': 'Time',
    });
    this.range.oninput = () => this.seek(Number(this.range.value));
    this.timeEl = el('span', { class: 'time' });
    this.append(el('footer', { class: 'scrub' }, this.playBtn, this.range, this.timeEl));
    new ResizeObserver(() => this.drawPlot()).observe(this.plot);
    this.renderAll();
  }

  override destroy(): void {
    cancelAnimationFrame(this.playing);
    this.playing = 0;
  }

  setRun(result: RunResult | null, status: RunStatus, fileName = 'results'): void {
    const fresh = result !== this.result;
    this.result = result;
    if (status.state === 'running' && this.status.state !== 'running') this.lastFraction = 0;
    this.status = status;
    this.fileName = fileName;
    if (fresh && result) {
      const all = seriesOf(result);
      this.slots.retain(new Set(all.map((x) => x.id)));
      if (this.slots.ids().length === 0) {
        for (const x of all.filter((x) => x.byDefault)) this.slots.take(x.id);
        if (this.slots.ids().length === 0) for (const x of all) this.slots.take(x.id);
      }
      this.sample = result.times.length - 1;
      this.maxFlow = 0;
      for (const f of result.flows) {
        for (const v of f.values)
          if (Number.isFinite(v)) this.maxFlow = Math.max(this.maxFlow, Math.abs(v));
      }
    }
    if (this.statusEl) this.renderAll();
  }

  private lastFraction = 0;

  /** Update the running run's progress in place (FR-SIM-005). */
  setProgress(fraction: number): void {
    this.lastFraction = fraction;
    const bar = this.statusEl?.querySelector<HTMLProgressElement>('progress');
    if (bar) bar.value = fraction;
    const pct = this.statusEl?.querySelector('.pct');
    if (pct) pct.textContent = ` ${Math.floor(fraction * 100)}%`;
  }

  private renderAll(): void {
    this.renderStatus();
    this.renderSeries();
    this.drawPlot();
    this.renderScrub();
    this.emitPlayback();
  }

  private renderStatus(): void {
    const s = this.status;
    const r = this.result;
    this.statusEl.replaceChildren();
    if (s.state === 'running') {
      const bar = el('progress', {
        class: 'progress',
        max: '1',
        value: '0',
        'aria-label': 'Run progress',
      });
      this.statusEl.append(
        el('span', { text: 'Running on the kernel… ' }),
        bar,
        el('span', { class: 'pct', text: ' 0%' })
      );
      this.setProgress(this.lastFraction);
    } else if (s.state === 'error') {
      this.statusEl.append(el('span', { class: 'badge critical' }, icon('alert'), s.message));
    } else if (r) {
      const m = r.manifest;
      const solver = r.diagnostics.solverConfident
        ? el(
            'span',
            { class: 'badge good', title: 'The kernel reported no solver divergence.' },
            icon('check'),
            'Solver OK'
          )
        : el(
            'span',
            {
              class: 'badge warning',
              title: `${r.diagnostics.divergedSteps} step(s) warned of solver divergence. Try a smaller step or the rk4 method.`,
            },
            icon('alert'),
            'Solver diverged'
          );
      this.statusEl.append(
        solver,
        ' ',
        el('span', {
          text: `${m.steps.toLocaleString('en')} steps · ${m.method} · dt ${m.dt} · ${r.elapsedMs.toFixed(0)} ms · GSSK ${m.kernelVersion} · model ${m.modelHash.slice(0, 8)}`,
          title: `Model hash ${m.modelHash}\nKernel SHA-256 ${m.kernelSha256}`,
        })
      );
      if (s.state === 'done' && s.stale)
        this.statusEl.append(
          ' ',
          el('span', { class: 'badge warning', text: 'Model changed since this run' })
        );
    } else {
      this.statusEl.textContent = 'Run the model to see how it behaves over time.';
    }
    this.csvBtn.disabled = !r;
    this.tableBtn.disabled = !r;
  }

  private renderSeries(): void {
    const r = this.result;
    this.seriesEl.replaceChildren();
    if (!r) return;
    for (const n of seriesOf(r)) {
      const slot = this.slots.get(n.id);
      const sw = el('span', { class: 'sw' });
      if (slot) sw.style.background = seriesColor(slot);
      const b = el(
        'button',
        { type: 'button', 'aria-pressed': String(slot !== undefined), title: n.id },
        sw,
        el('span', { class: 'name', text: n.label })
      );
      b.onclick = () => {
        if (this.slots.get(n.id) !== undefined) this.slots.release(n.id);
        else if (this.slots.take(n.id) === null) {
          this.flashNote('Eight series at most: turn one off first.');
          return;
        }
        this.renderSeries();
        this.drawPlot();
      };
      this.seriesEl.append(b);
    }
  }

  private flashNote(text: string): void {
    this.seriesEl.querySelector('.note')?.remove();
    const n = el('p', { class: 'note', role: 'status', text });
    this.seriesEl.prepend(n);
    setTimeout(() => n.remove(), 3000);
  }

  private visible(): { id: string; label: string; slot: number; values: Float64Array }[] {
    const r = this.result;
    if (!r) return [];
    return seriesOf(r).flatMap((n) => {
      const slot = this.slots.get(n.id);
      return slot === undefined ? [] : [{ id: n.id, label: n.label, slot, values: n.values }];
    });
  }

  private drawPlot(): void {
    if (!this.plot) return;
    const r = this.result;
    this.plot.replaceChildren();
    if (!r) {
      this.plot.append(
        el('div', {
          class: 'empty',
          text:
            this.status.state === 'running'
              ? 'Running on the GSSK kernel…'
              : 'No run yet. Press Run.',
        })
      );
      return;
    }
    const series = this.visible();
    if (this.showTable) return this.drawTable(r, series);
    const W = this.plot.clientWidth;
    const H = this.plot.clientHeight;
    if (W < 50 || H < 50) return;
    const endLabels = series.length > 0 && series.length <= 4;
    const right = endLabels ? END_LABEL_W : M.r;
    const t0 = r.times[0] ?? 0;
    const t1 = r.times[r.times.length - 1] ?? 1;
    const xt = niceTicks(t0, t1, Math.max(2, Math.floor((W - M.l - right) / 90)));
    const x = linear([t0, t1], [M.l, W - right]);
    const [lo, hi] = extent(series.map((s) => s.values));
    const yt = niceTicks(Math.min(0, lo), hi, Math.max(2, Math.floor((H - M.t - M.b) / 40)));
    const y = linear(yt.domain, [H - M.b, M.t]);

    const root = svg('svg', {
      role: 'img',
      'aria-label': `Time series of ${series.map((s) => s.label).join(', ') || 'nothing'}`,
    });
    const grid = svg('g', { class: 'grid' });
    const axis = svg('g', { class: 'axis' });
    for (const v of yt.ticks) {
      grid.append(svg('line', { x1: M.l, x2: W - right, y1: y(v), y2: y(v) }));
      const t = svg('text', { x: M.l - 8, y: y(v) + 4, 'text-anchor': 'end' });
      t.textContent = tickLabel(v);
      axis.append(t);
    }
    for (const v of xt.ticks) {
      if (v < t0 - 1e-9 || v > t1 + 1e-9) continue;
      const t = svg('text', { x: x(v), y: H - 8, 'text-anchor': 'middle' });
      t.textContent = tickLabel(v);
      axis.append(t);
    }
    root.append(
      grid,
      axis,
      svg('line', { class: 'baseline', x1: M.l, x2: W - right, y1: H - M.b, y2: H - M.b })
    );

    const budget = Math.max(50, Math.floor((W - M.l - right) * 1.5));
    const ends: { y: number; label: string; slot: number }[] = [];
    for (const s of series) {
      const idx = decimate(s.values, budget);
      let d = '';
      for (const i of idx) {
        const v = s.values[i] ?? NaN;
        if (!Number.isFinite(v)) continue;
        d += `${d ? 'L' : 'M'}${x(r.times[i] ?? 0).toFixed(1)},${y(v).toFixed(1)}`;
      }
      root.append(svg('path', { class: 'series-line', d, stroke: seriesColor(s.slot) }));
      const last = s.values[s.values.length - 1] ?? NaN;
      if (Number.isFinite(last)) ends.push({ y: y(last), label: s.label, slot: s.slot });
    }
    if (endLabels) {
      ends.sort((a, b) => a.y - b.y);
      for (let i = 1; i < ends.length; i++) {
        const prev = ends[i - 1];
        const cur = ends[i];
        if (prev && cur && cur.y - prev.y < 13) cur.y = prev.y + 13;
      }
      for (const e of ends) {
        const t = svg('text', { class: 'end-label', x: W - right + 8, y: e.y + 4 });
        t.textContent = e.label.length > 14 ? `${e.label.slice(0, 13)}…` : e.label;
        root.append(t);
      }
    }
    const cursorX = x(r.times[this.sample] ?? t1);
    root.append(svg('line', { class: 'cursor', x1: cursorX, x2: cursorX, y1: M.t, y2: H - M.b }));

    // Hover layer: crosshair, dots and a tooltip; a click moves playback there.
    const hoverLine = svg('line', { class: 'hover', y1: M.t, y2: H - M.b, visibility: 'hidden' });
    const dots = svg('g');
    root.append(hoverLine, dots);
    const tip = el('div', { class: 'tip', hidden: '' });
    const hit = svg('rect', {
      x: M.l,
      y: M.t,
      width: Math.max(0, W - right - M.l),
      height: Math.max(0, H - M.b - M.t),
      fill: 'transparent',
    });
    root.append(hit);
    const nearest = (clientX: number) => {
      const bx = root.getBoundingClientRect().left;
      const t = t0 + ((clientX - bx - M.l) / (W - right - M.l)) * (t1 - t0);
      let lo2 = 0;
      let hi2 = r.times.length - 1;
      while (lo2 < hi2) {
        const mid = (lo2 + hi2) >> 1;
        if ((r.times[mid] ?? 0) < t) lo2 = mid + 1;
        else hi2 = mid;
      }
      return lo2;
    };
    hit.addEventListener('pointermove', (ev) => {
      const i = nearest(ev.clientX);
      const tx = x(r.times[i] ?? 0);
      hoverLine.setAttribute('x1', String(tx));
      hoverLine.setAttribute('x2', String(tx));
      hoverLine.setAttribute('visibility', 'visible');
      dots.replaceChildren();
      tip.replaceChildren(el('div', { class: 't', text: `t = ${formatNumber(r.times[i] ?? 0)}` }));
      for (const s of series) {
        const v = s.values[i] ?? NaN;
        if (Number.isFinite(v))
          dots.append(
            svg('circle', { class: 'dot', cx: tx, cy: y(v), r: 4, fill: seriesColor(s.slot) })
          );
        const sw = el('span', { class: 'sw' });
        sw.style.background = seriesColor(s.slot);
        tip.append(
          el(
            'div',
            { class: 'r' },
            sw,
            el('span', { text: s.label }),
            el('b', { text: formatNumber(v) })
          )
        );
      }
      tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = `${tx + 12 + tw > W ? tx - 12 - tw : tx + 12}px`;
      tip.style.top = `${M.t}px`;
    });
    hit.addEventListener('pointerleave', () => {
      hoverLine.setAttribute('visibility', 'hidden');
      dots.replaceChildren();
      tip.hidden = true;
    });
    hit.addEventListener('click', (ev) => this.seek(nearest(ev.clientX)));
    this.plot.append(root, tip);
  }

  private drawTable(r: RunResult, series: ReturnType<ResultsPanel['visible']>): void {
    const cols = series.length
      ? series
      : seriesOf(r).map((n) => ({ id: n.id, label: n.label, slot: 0, values: n.values }));
    const step = Math.max(1, Math.ceil(r.times.length / 200));
    const head = el(
      'tr',
      {},
      el('th', { text: 't' }),
      ...cols.map((c) => el('th', { text: c.label, title: c.id }))
    );
    const rows: HTMLTableRowElement[] = [];
    for (let i = 0; i < r.times.length; i += step) {
      rows.push(
        el(
          'tr',
          {},
          el('td', { text: formatNumber(r.times[i] ?? NaN) }),
          ...cols.map((c) => el('td', { text: formatNumber(c.values[i] ?? NaN) }))
        )
      );
    }
    const caption =
      step > 1
        ? el('caption', {
            class: 'visually-hidden',
            text: `Every ${step}th sample; download CSV for all.`,
          })
        : null;
    this.plot.append(
      el(
        'div',
        { class: 'table-wrap' },
        el('table', {}, caption, el('thead', {}, head), el('tbody', {}, ...rows))
      )
    );
  }

  private renderScrub(): void {
    const r = this.result;
    const n = r ? r.times.length - 1 : 0;
    this.range.max = String(n);
    this.range.value = String(this.sample);
    this.range.disabled = !r;
    this.playBtn.disabled = !r;
    this.timeEl.textContent = r ? `t = ${formatNumber(r.times[this.sample] ?? 0)}` : '';
  }

  private seek(i: number): void {
    const r = this.result;
    if (!r) return;
    this.sample = Math.max(0, Math.min(r.times.length - 1, i));
    this.renderScrub();
    this.drawPlot();
    this.emitPlayback();
  }

  private togglePlay(): void {
    const r = this.result;
    if (!r) return;
    if (this.playing) {
      cancelAnimationFrame(this.playing);
      this.playing = 0;
      this.playBtn.replaceChildren(icon('play'));
      return;
    }
    if (this.sample >= r.times.length - 1) this.sample = 0;
    const durationMs = 6000;
    const start = performance.now() - (this.sample / Math.max(1, r.times.length - 1)) * durationMs;
    this.playBtn.replaceChildren(icon('x'));
    this.playBtn.setAttribute('aria-label', 'Stop playback');
    const frame = (now: number) => {
      const f = Math.min(1, (now - start) / durationMs);
      this.seek(Math.round(f * (r.times.length - 1)));
      if (f < 1 && this.playing) this.playing = requestAnimationFrame(frame);
      else {
        this.playing = 0;
        this.playBtn.replaceChildren(icon('play'));
        this.playBtn.setAttribute('aria-label', 'Play the run');
      }
    };
    this.playing = requestAnimationFrame(frame);
  }

  private emitPlayback(): void {
    const r = this.result;
    let detail: Playback | null = null;
    if (r) {
      const i = this.sample;
      const values = new Map(r.nodes.map((n) => [n.id, n.values[i] ?? NaN]));
      const flows = new Map(r.flows.map((f) => [f.id, f.values[i] ?? NaN]));
      detail = { values, flows, maxFlow: this.maxFlow };
    }
    this.dispatchEvent(new CustomEvent<Playback | null>('playback', { detail, bubbles: true }));
  }
}

define('results-panel', ResultsPanel);
