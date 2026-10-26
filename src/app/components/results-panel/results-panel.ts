/**
 * <results-panel>: a run's time series, its provenance, and playback
 * (SPEC §8). The chart is in-house SVG (ADR 0001): one shared y-axis, series
 * coloured by entity, a crosshair with a tooltip, direct end labels when four
 * or fewer lines are drawn, and a table view of the same numbers.
 */
import { BaseComponent, define } from '../../core/base-component.ts';
import { sampleAt, type RunResult } from '../../../sim/run.ts';
import { fitSeries } from '../../../fit/stats.ts';
import type { Elasticity } from '../../../fit/sensitivity.ts';
import type { EnsembleOptions, EnsembleResult, EnsembleSeries } from '../../../sim/ensemble.ts';
import type { ObservationSeries } from '../../../model/types.ts';
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
  /** What the plot area shows: the chart, its numbers, or fit to observations. */
  private view: 'chart' | 'table' | 'fit' | 'sens' = 'chart';
  /** Elasticities for the current run, once asked for (FR-SEN-001). */
  private sens: { result: RunResult; key: string; data: Elasticity[] | string } | null = null;
  /** The request in flight, so a redraw does not ask twice. */
  private sensPending = '';
  /** The ensemble band for the current run, once asked for (FR-ENS-001). */
  private ens: { result: RunResult; data: EnsembleResult | string | null } | null = null;
  private ensOpts: EnsembleOptions = { runs: 50, perturbation: 0.1, seed: '1' };
  private ensBtn!: HTMLButtonElement;
  private ensForm!: HTMLElement;
  private obs: ObservationSeries[] = [];
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
  private baselineBtn!: HTMLButtonElement;
  private fitBtn!: HTMLButtonElement;
  private sensBtn!: HTMLButtonElement;
  /** A kept run, drawn dashed under the current one (FR-RES-006). */
  private baseline: RunResult | null = null;

  constructor() {
    super('', style);
  }

  override init(): void {
    if (this.statusEl) return;
    this.statusEl = el('span', { class: 'status', role: 'status' });
    this.tableBtn = iconButton('table', 'Show as table');
    this.tableBtn.setAttribute('aria-pressed', 'false');
    this.tableBtn.onclick = () => this.setView(this.view === 'table' ? 'chart' : 'table');
    this.fitBtn = iconButton('target', 'Fit to observations');
    this.fitBtn.setAttribute('aria-pressed', 'false');
    this.fitBtn.onclick = () => this.setView(this.view === 'fit' ? 'chart' : 'fit');
    this.sensBtn = iconButton('sliders', 'Sensitivity to rates');
    this.sensBtn.setAttribute('aria-pressed', 'false');
    this.sensBtn.onclick = () => this.setView(this.view === 'sens' ? 'chart' : 'sens');
    this.baselineBtn = iconButton('pin', 'Keep this run as a baseline to compare against');
    this.baselineBtn.setAttribute('aria-pressed', 'false');
    this.baselineBtn.onclick = () => {
      this.baseline = this.baseline ? null : this.result;
      this.renderAll();
    };
    this.ensBtn = iconButton(
      'spread',
      'Ensemble: how far the run spreads when its rates are uncertain'
    );
    this.ensBtn.setAttribute('aria-pressed', 'false');
    this.ensBtn.onclick = () => {
      this.ensForm.hidden = !this.ensForm.hidden;
      this.ensBtn.setAttribute('aria-pressed', String(!this.ensForm.hidden));
    };
    this.ensForm = this.ensembleForm();
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
        this.baselineBtn,
        this.ensBtn,
        this.fitBtn,
        this.sensBtn,
        this.tableBtn,
        this.csvBtn
      )
    );
    this.append(this.ensForm);
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
    if (fresh) this.ens = null;
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

  /** The model's observed series (FR-OBS-002), drawn over the series they measure. */
  set observations(o: ObservationSeries[]) {
    this.obs = o;
    if (this.plot) this.drawPlot();
  }

  /** The studio answers a `sensitivity-request` with this. */
  setSensitivity(result: RunResult, targets: readonly string[], data: Elasticity[] | string): void {
    this.sens = { result, key: targets.join('|'), data };
    this.sensPending = '';
    if (this.view === 'sens') this.drawPlot();
  }

  /** The studio answers an `ensemble-request` with this; null while it runs. */
  setEnsemble(result: RunResult, data: EnsembleResult | string | null): void {
    if (result !== this.result) return;
    this.ens = { result, data };
    this.renderStatus();
    this.renderEnsembleForm();
    this.drawPlot();
  }

  /** The envelope to draw for a series, if the ensemble covers it. */
  private bandFor(id: string): EnsembleSeries | undefined {
    const d = this.ens?.result === this.result ? this.ens?.data : null;
    return d && typeof d !== 'string' ? d.nodes.find((n) => n.id === id) : undefined;
  }

  private ensembleForm(): HTMLElement {
    const field = (label: string, input: HTMLInputElement, title: string) => {
      const l = el('label', { class: 'field', title }, label, input);
      return l;
    };
    const runs = el('input', { type: 'number', name: 'ens_runs', min: '2', max: '500', step: '1' });
    const pct = el('input', {
      type: 'number',
      name: 'ens_pct',
      min: '0.1',
      max: '99',
      step: 'any',
    });
    const seed = el('input', {
      type: 'text',
      name: 'ens_seed',
      inputmode: 'numeric',
      spellcheck: 'false',
    });
    runs.value = String(this.ensOpts.runs);
    pct.value = String(this.ensOpts.perturbation * 100);
    seed.value = this.ensOpts.seed;
    const go = el(
      'button',
      { type: 'button', class: 'primary go' },
      icon('spread'),
      'Run ensemble'
    );
    const clear = el('button', { type: 'button', class: 'clear', text: 'Clear band' });
    const msg = el('p', { class: 'ens-note', role: 'status' });
    go.onclick = () => {
      const opts: EnsembleOptions = {
        runs: Number(runs.value),
        perturbation: Number(pct.value) / 100,
        seed: seed.value.trim(),
      };
      this.ensOpts = opts;
      this.dispatchEvent(
        new CustomEvent<EnsembleOptions>('ensemble-request', { detail: opts, bubbles: true })
      );
    };
    clear.onclick = () => {
      this.ens = null;
      this.renderStatus();
      this.renderEnsembleForm();
      this.drawPlot();
    };
    const form = el(
      'div',
      { class: 'ens-form', hidden: '', role: 'group', 'aria-label': 'Ensemble' },
      field('Runs', runs, 'How many perturbed runs, 2–500. Each is a whole kernel run.'),
      field(
        'Rates ± %',
        pct,
        'Each run multiplies every flow’s k by its own uniform draw from [1 − p, 1 + p].'
      ),
      field(
        'Seed',
        seed,
        'The kernel RNG seed. The same seed, model and kernel give the same band.'
      ),
      go,
      clear,
      msg
    );
    return form;
  }

  private renderEnsembleForm(): void {
    const go = this.ensForm.querySelector<HTMLButtonElement>('.go');
    const clear = this.ensForm.querySelector<HTMLButtonElement>('.clear');
    const msg = this.ensForm.querySelector('.ens-note');
    const d = this.ens?.result === this.result ? this.ens?.data : undefined;
    const running = this.ens !== null && d === null;
    if (go) go.disabled = !this.result || running;
    if (clear) clear.disabled = !this.ens || running;
    if (msg)
      msg.textContent = !this.result
        ? 'Run the model first: the band is drawn around that run.'
        : running
          ? 'Running the ensemble on the kernel…'
          : typeof d === 'string'
            ? d
            : 'Every run is perturbed, so the band’s mean is not the run itself. Only flows’ rates k are varied, not initial or fixed values.';
  }

  private setView(v: 'chart' | 'table' | 'fit' | 'sens'): void {
    this.view = v;
    this.sensBtn.setAttribute('aria-pressed', String(v === 'sens'));
    this.tableBtn.setAttribute('aria-pressed', String(v === 'table'));
    this.fitBtn.setAttribute('aria-pressed', String(v === 'fit'));
    this.drawPlot();
  }

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
    this.baselineBtn.disabled = !r && !this.baseline;
    this.baselineBtn.setAttribute('aria-pressed', String(this.baseline !== null));
    const label = this.baseline
      ? 'Stop comparing against the baseline'
      : 'Keep this run as a baseline to compare against';
    this.baselineBtn.title = label;
    this.baselineBtn.setAttribute('aria-label', label);
    const b = this.baseline;
    if (b && b !== r) {
      this.statusEl.append(
        ' ',
        el('span', {
          class: 'badge',
          text: `Dashed: baseline, model ${b.manifest.modelHash.slice(0, 8)}`,
          title: 'The kept run, drawn dashed in each series’ colour',
        })
      );
    }
    const ens = this.ens?.result === r ? this.ens?.data : undefined;
    if (ens && typeof ens !== 'string') {
      const em = ens.manifest;
      this.statusEl.append(
        ' ',
        el('span', {
          class: 'badge ens',
          text: `Band: ${em.runs} runs, k ± ${+(em.perturbation * 100).toPrecision(3)} %, seed ${em.seed}`,
          title: `Shaded: the lowest to highest value any of ${em.runs} runs reached at each time; dotted: their mean. Each run scales every flow’s k by a uniform draw from [1 − p, 1 + p] (GSSK_EnsembleForecast). ${ens.elapsedMs.toFixed(0)} ms. Model ${em.modelHash.slice(0, 8)}.`,
        })
      );
    }
    this.tableBtn.disabled = !r;
    this.ensBtn.disabled = !r;
    this.renderEnsembleForm();
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
    if (this.view === 'table') return this.drawTable(r, series);
    if (this.view === 'fit') return this.drawFit(r);
    if (this.view === 'sens') return this.drawSensitivity(r, series);
    const W = this.plot.clientWidth;
    const H = this.plot.clientHeight;
    if (W < 50 || H < 50) return;
    const endLabels = series.length > 0 && series.length <= 4;
    const right = endLabels ? END_LABEL_W : M.r;
    const t0 = r.times[0] ?? 0;
    const t1 = r.times[r.times.length - 1] ?? 1;
    const xt = niceTicks(t0, t1, Math.max(2, Math.floor((W - M.l - right) / 90)));
    const x = linear([t0, t1], [M.l, W - right]);
    const base = this.baseline && this.baseline !== r ? this.baseline : null;
    const baseSeries = base ? seriesOf(base) : [];
    const baseOf = (id: string) => baseSeries.find((b) => b.id === id);
    const obsFor = (id: string) => this.obs.filter((o) => o.target === id);
    const [lo, hi] = extent([
      ...series.map((s) => s.values),
      ...series.flatMap((s) => obsFor(s.id).map((o) => o.values)),
      ...series.flatMap((s) => (baseOf(s.id) ? [baseOf(s.id)!.values] : [])),
      ...series.flatMap((s) => {
        const b = this.bandFor(s.id);
        return b ? [b.min, b.max] : [];
      }),
    ]);
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
    const ens = this.ens?.data && typeof this.ens.data !== 'string' ? this.ens.data : null;
    for (const s of series) {
      const b = this.bandFor(s.id);
      if (!ens || !b) continue;
      const idx = decimate(b.max, budget);
      const pt = (i: number, v: Float64Array) =>
        `${x(ens.times[i] ?? 0).toFixed(1)},${y(v[i] ?? 0).toFixed(1)}`;
      const ok = idx.filter((i) => Number.isFinite(b.min[i]) && Number.isFinite(b.max[i]));
      if (ok.length < 2) continue;
      const d = `M${ok.map((i) => pt(i, b.max)).join('L')}L${[...ok]
        .reverse()
        .map((i) => pt(i, b.min))
        .join('L')}Z`;
      root.append(
        svg('path', { class: 'band', 'data-series': s.id, d, fill: seriesColor(s.slot) })
      );
      root.append(
        svg('path', {
          class: 'series-line mean',
          d: `M${ok.map((i) => pt(i, b.mean)).join('L')}`,
          stroke: seriesColor(s.slot),
        })
      );
    }
    const ends: { y: number; label: string; slot: number }[] = [];
    for (const s of series) {
      const idx = decimate(s.values, budget);
      let d = '';
      for (const i of idx) {
        const v = s.values[i] ?? NaN;
        if (!Number.isFinite(v)) continue;
        d += `${d ? 'L' : 'M'}${x(r.times[i] ?? 0).toFixed(1)},${y(v).toFixed(1)}`;
      }
      const b = base ? baseOf(s.id) : undefined;
      if (base && b) {
        let bd = '';
        for (const i of decimate(b.values, budget)) {
          const v = b.values[i] ?? NaN;
          const t = base.times[i] ?? NaN;
          if (!Number.isFinite(v) || t < t0 || t > t1) continue;
          bd += `${bd ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`;
        }
        root.append(svg('path', { class: 'series-line base', d: bd, stroke: seriesColor(s.slot) }));
      }
      root.append(svg('path', { class: 'series-line', d, stroke: seriesColor(s.slot) }));
      const last = s.values[s.values.length - 1] ?? NaN;
      if (Number.isFinite(last)) ends.push({ y: y(last), label: s.label, slot: s.slot });
    }
    // Observations: hollow markers in the series' colour; hollow vs line is the second encoding.
    for (const s of series) {
      for (const o of obsFor(s.id)) {
        o.times.forEach((t, i) => {
          const v = o.values[i] ?? NaN;
          if (t < t0 || t > t1 || !Number.isFinite(v)) return;
          const c = svg('circle', {
            class: 'obs',
            cx: x(t),
            cy: y(v),
            r: 4,
            stroke: seriesColor(s.slot),
          });
          const title = svg('title');
          title.textContent = `${o.name}: ${formatNumber(v)} at t = ${formatNumber(t)}`;
          c.append(title);
          root.append(c);
        });
      }
    }
    if (root.querySelector('circle.obs')) {
      const key = svg('text', { class: 'obs-key', x: M.l + 8, y: M.t + 12 });
      key.textContent = '○ observed';
      root.append(key);
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
        const band = this.bandFor(s.id);
        if (ens && band) {
          const j = sampleAt(ens.times, r.times[i] ?? 0);
          tip.append(
            el(
              'div',
              { class: 'r base' },
              el('span', { class: 'sw' }),
              el('span', { text: 'band' }),
              el('b', {
                text: `${formatNumber(band.min[j] ?? NaN)} – ${formatNumber(band.max[j] ?? NaN)}`,
              })
            )
          );
        }
        const b = base ? baseOf(s.id) : undefined;
        if (base && b) {
          const bv = b.values[sampleAt(base.times, r.times[i] ?? 0)] ?? NaN;
          tip.append(
            el(
              'div',
              { class: 'r base' },
              el('span', { class: 'sw' }),
              el('span', { text: 'baseline' }),
              el('b', { text: formatNumber(bv) })
            )
          );
        }
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

  /** Elasticity of each charted series to each rate (FR-SEN-001). */
  private drawSensitivity(r: RunResult, series: ReturnType<ResultsPanel['visible']>): void {
    const targets = series.map((s) => s.id);
    const key = targets.join('|');
    const have = this.sens?.result === r && this.sens.key === key ? this.sens.data : null;
    if (targets.length === 0) {
      this.plot.append(
        el('div', { class: 'empty', text: 'Chart at least one series to see its sensitivity.' })
      );
      return;
    }
    if (!have) {
      this.plot.append(
        el('div', {
          class: 'empty',
          role: 'status',
          text: 'Measuring sensitivity: two kernel runs per rate…',
        })
      );
      if (this.sensPending !== key) {
        this.sensPending = key;
        this.dispatchEvent(
          new CustomEvent<string[]>('sensitivity-request', { detail: targets, bubbles: true })
        );
      }
      return;
    }
    if (typeof have !== 'string' && have.length === 0) {
      this.plot.append(el('div', { class: 'empty', text: 'No flow has a positive rate to vary.' }));
      return;
    }
    if (typeof have === 'string') {
      this.plot.append(el('div', { class: 'empty', role: 'alert', text: have }));
      return;
    }
    const edges = [...new Set(have.map((e) => e.edgeId))];
    const cell = (edge: string, t: string) => have.find((e) => e.edgeId === edge && e.target === t);
    const strongest = (edge: string) =>
      Math.max(...targets.map((t) => Math.abs(cell(edge, t)?.mean ?? 0)));
    edges.sort((a, b) => strongest(b) - strongest(a));
    const f = (v: number | undefined) =>
      v === undefined || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
    const head = el(
      'tr',
      {},
      el('th', { text: 'Rate' }),
      ...series.map((s) => el('th', { text: s.label, title: s.id }))
    );
    const rows = edges.map((edge) =>
      el(
        'tr',
        { 'data-rate': edge },
        el('td', { text: edge }),
        ...targets.map((t) => {
          const c = cell(edge, t);
          return el('td', { class: 'num', text: f(c?.mean), title: `final value: ${f(c?.final)}` });
        })
      )
    );
    const note = el('p', {
      class: 'fit-note',
      text: 'Elasticity of each series’ mean over the run to each rate k: +0.50 means a 1 % rise in k raises the mean by about 0.5 %. Central differences at k × (1 ± 1 %), on real kernel runs; local to the current rates. Hover a value for the elasticity of the final value. Rates are sorted by their strongest effect.',
    });
    this.plot.append(
      el(
        'div',
        { class: 'table-wrap' },
        el('table', { class: 'fit sens' }, el('thead', {}, head), el('tbody', {}, ...rows)),
        note
      )
    );
  }

  /** Fit of each compared observation series to this run (FR-FIT-001). */
  private drawFit(r: RunResult): void {
    const all = new Map(seriesOf(r).map((x) => [x.id, x]));
    const compared = this.obs.filter((o) => o.target && all.has(o.target));
    if (compared.length === 0) {
      this.plot.append(
        el('div', {
          class: 'empty',
          text: this.obs.length
            ? 'No observation series is compared with a series of this run. Pick a target under Observations, then run.'
            : 'No observations yet. Import a CSV under Observations (select nothing on the canvas to see it).',
        })
      );
      return;
    }
    const f = (v: number) => (Number.isFinite(v) ? formatNumber(v) : '—');
    const head = el(
      'tr',
      {},
      ...['Observed', 'Compared with', 'n', 'RMSE', 'MAE', 'Bias', 'NSE', 'KGE', 'r²'].map((h) =>
        el('th', { text: h })
      )
    );
    const rows = compared.map((o) => {
      const sim = all.get(o.target ?? '');
      const st = fitSeries(r.times, sim?.values ?? [], o.times, o.values);
      return el(
        'tr',
        { 'data-obs': o.id },
        el('td', { text: o.name, title: o.source ?? '' }),
        el('td', { text: sim?.label ?? '' }),
        el('td', {
          text: st.excluded ? `${st.n} (+${st.excluded} outside the run)` : String(st.n),
        }),
        ...[st.rmse, st.mae, st.bias, st.nse, st.kge, st.r2].map((v) =>
          el('td', { class: 'num', text: f(v) })
        )
      );
    });
    const note = el('p', {
      class: 'fit-note',
      text: 'The run is interpolated at each observation time. RMSE, MAE and bias (sim − obs) are in the series’ units. NSE: Nash–Sutcliffe efficiency, 1 is perfect, 0 is no better than the observed mean. KGE: Kling–Gupta efficiency (Gupta et al. 2009). r²: squared Pearson correlation. These describe fit; none is a significance test, so no p-value is given.',
    });
    const calibrate = el(
      'button',
      { type: 'button', class: 'calibrate' },
      icon('target'),
      'Calibrate rates…'
    );
    calibrate.onclick = () =>
      this.dispatchEvent(new CustomEvent('calibrate-request', { bubbles: true }));
    this.plot.append(el('div', { class: 'fit-actions' }, calibrate));
    this.plot.append(
      el(
        'div',
        { class: 'table-wrap' },
        el('table', { class: 'fit' }, el('thead', {}, head), el('tbody', {}, ...rows)),
        note
      )
    );
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
