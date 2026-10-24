/**
 * <studio-page>: the workbench for one model (SPEC §6–§8). It owns the model,
 * its undo history and its saving; the canvas and inspector propose edits,
 * the results panel shows runs. Runs happen in the sim worker.
 */
import { BaseComponent, define } from '../../core/base-component.ts';
import { PALETTE } from '../../../model/catalogue.ts';
import { History } from '../../../model/history.ts';
import { fileNameFor, serialiseModel } from '../../../model/io.ts';
import { addBoundary, toggleSensor, type Selection } from '../../../model/ops.ts';
import type { StudioModel } from '../../../model/types.ts';
import { hasErrors, validate, type Issue } from '../../../model/validate.ts';
import type { RunResult } from '../../../sim/run.ts';
import { getModel, saveModel } from '../../../store/models.ts';
import { importNotes } from '../../import-notes.ts';
import { simWorker } from '../../sim-client.ts';
import { symbolIcon } from '../../symbol-icon.ts';
import { downloadText, el, icon, iconButton, toast } from '../../ui.ts';
import {
  NODE_DRAG_TYPE,
  SENSOR_DRAG_TYPE,
  type DiagramCanvas,
  type EditDetail,
  type Playback,
} from '../diagram-canvas/diagram-canvas.ts';
import type { InspectorPanel } from '../inspector-panel/inspector-panel.ts';
import type { ResultsPanel } from '../results-panel/results-panel.ts';
import '../diagram-canvas/diagram-canvas.ts';
import '../inspector-panel/inspector-panel.ts';
import '../results-panel/results-panel.ts';
import style from './studio-page.css?raw';

const SAVE_DELAY_MS = 400;
const RESULTS_H_KEY = 'gssk-studio-results-h';

export class StudioPage extends BaseComponent {
  params: Record<string, string> = {};
  private modelId = '';
  private model: StudioModel | null = null;
  private selection: Selection = null;
  private issues: Issue[] = [];
  private readonly history = new History();
  private lastCoalesce: string | undefined;
  private saveTimer = 0;
  private dirty = false;
  private result: RunResult | null = null;
  private resultModel: StudioModel | null = null;
  /** The run in progress: its worker token (0 while starting) and whether Cancel was pressed. */
  private running: { token: number; cancelled: boolean } | null = null;

  private canvas!: DiagramCanvas;
  private inspector!: InspectorPanel;
  private results!: ResultsPanel;
  private nameEl!: HTMLElement;
  private savedEl!: HTMLElement;
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;
  private runBtn!: HTMLButtonElement;
  private checksBadge!: HTMLElement;

  private readonly onKey = (e: KeyboardEvent) => this.onKeyDown(e);
  private readonly onUnload = () => void this.flush();

  constructor() {
    super('', style);
  }

  override init(): void {
    this.modelId = this.params.id ?? '';
    document.addEventListener('keydown', this.onKey);
    window.addEventListener('pagehide', this.onUnload);
    void this.load();
  }

  override destroy(): void {
    document.removeEventListener('keydown', this.onKey);
    window.removeEventListener('pagehide', this.onUnload);
    if (this.running) this.running.cancelled = true;
    void this.flush();
  }

  private async load(): Promise<void> {
    const saved = await getModel(this.modelId).catch(() => null);
    if (!saved) {
      this.setContent(
        el(
          'div',
          { class: 'missing' },
          el('h1', { text: 'Model not found' }),
          el('p', { text: 'It may have been deleted, or it lives in another browser.' }),
          el('a', { class: 'button', href: './', 'data-route': '/', text: 'Back to models' })
        )
      );
      return;
    }
    this.model = saved.model;
    this.build();
    this.inspector.notes = importNotes(this.modelId);
    this.update();
    document.title = `${saved.model.metadata.name} · GSSK Studio`;
  }

  private build(): void {
    const back = el(
      'a',
      {
        class: 'button ghost icon',
        href: './',
        'data-route': '/',
        'aria-label': 'All models',
        title: 'All models',
      },
      icon('back')
    );
    this.nameEl = el('span', { class: 'name' });
    this.savedEl = el('span', { class: 'saved', role: 'status', text: 'Saved' });
    this.undoBtn = iconButton('undo', 'Undo (Ctrl+Z)');
    this.redoBtn = iconButton('redo', 'Redo (Ctrl+Shift+Z)');
    this.undoBtn.onclick = () => this.undo();
    this.redoBtn.onclick = () => this.redo();
    this.checksBadge = el('span', { class: 'badge hide-narrow' });
    const exportBtn = el(
      'button',
      { type: 'button', title: 'Download the model as a .gssk.json file' },
      icon('download'),
      el('span', { class: 'hide-narrow', text: 'Export' })
    );
    exportBtn.onclick = () => {
      if (this.model) downloadText(fileNameFor(this.model), serialiseModel(this.model));
    };
    this.runBtn = el(
      'button',
      { type: 'button', class: 'primary run', title: 'Run the model (Ctrl+Enter)' },
      icon('play'),
      'Run'
    );
    this.runBtn.onclick = () => {
      if (this.running) this.running.cancelled = true;
      else void this.run();
    };
    const toolbar = el(
      'header',
      { class: 'toolbar' },
      back,
      this.nameEl,
      this.savedEl,
      el('span', { class: 'sep' }),
      this.undoBtn,
      this.redoBtn,
      el('span', { class: 'spacer' }),
      this.checksBadge,
      exportBtn,
      this.runBtn
    );

    const grid = el('div', { class: 'grid' });
    for (const s of PALETTE) {
      const b = el(
        'button',
        {
          type: 'button',
          draggable: 'true',
          title: `${s.label}: ${s.summary}`,
          'data-type': s.type,
        },
        symbolIcon(s.type),
        el('span', { text: s.label })
      );
      b.setAttribute('aria-label', `Add ${s.label}`);
      b.onclick = () => this.canvas.place(s.type);
      b.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData(NODE_DRAG_TYPE, s.type);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
      });
      grid.append(b);
    }
    const frame = el(
      'button',
      {
        type: 'button',
        class: 'boundary-tool',
        title: 'A labelled region of the diagram; the kernel ignores it.',
        'aria-label': 'Add boundary',
      },
      icon('frame'),
      el('span', { text: 'Boundary' })
    );
    frame.onclick = () => {
      if (!this.model) return;
      const c = this.canvas.centre();
      const { model, id } = addBoundary(this.model, { x: c.x - 160, y: c.y - 110, w: 320, h: 220 });
      this.commit({ model, label: 'Add boundary', select: { kind: 'boundary', id } });
    };
    const sensor = el(
      'button',
      {
        type: 'button',
        class: 'boundary-tool',
        draggable: 'true',
        title:
          'Odum’s sensor: reads a flow’s rate J without taking from it. Drag onto a flow, or select a flow and click.',
        'aria-label': 'Add sensor',
      },
      icon('sensor'),
      el('span', { text: 'Sensor' })
    );
    sensor.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData(SENSOR_DRAG_TYPE, 'sensor');
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
    });
    sensor.onclick = () => {
      const s = this.selection;
      if (!this.model || s?.kind !== 'edge') {
        toast('Select a flow first, or drag the sensor onto a flow.');
        return;
      }
      this.commit({ model: toggleSensor(this.model, s.id), label: `Sensor on ${s.id}` });
    };
    grid.append(frame, sensor);
    const palette = el(
      'aside',
      { class: 'palette', 'aria-label': 'Symbols' },
      el('h3', { text: 'Symbols' }),
      grid
    );

    this.canvas = document.createElement('diagram-canvas') as DiagramCanvas;
    this.inspector = document.createElement('inspector-panel') as InspectorPanel;
    this.results = document.createElement('results-panel') as ResultsPanel;
    const splitter = el('div', {
      class: 'splitter',
      role: 'separator',
      'aria-orientation': 'horizontal',
      'aria-label': 'Resize results',
    });
    this.setupSplitter(splitter);
    const centre = el('div', { class: 'centre' }, this.canvas, splitter, this.results);
    this.setContent(toolbar, el('div', { class: 'work' }, palette, centre, this.inspector));

    for (const target of [this.canvas, this.inspector]) {
      target.addEventListener('diagram-edit', (e) =>
        this.commit((e as CustomEvent<EditDetail>).detail)
      );
      target.addEventListener('diagram-select', (e) =>
        this.select((e as CustomEvent<Selection>).detail)
      );
    }
    this.canvas.addEventListener('diagram-hint', (e) => toast((e as CustomEvent<string>).detail));
    this.canvas.addEventListener('diagram-rename', () => {
      this.inspector.querySelector<HTMLInputElement>('input[name="label"]')?.select();
    });
    this.results.addEventListener(
      'playback',
      (e) => (this.canvas.playback = (e as CustomEvent<Playback | null>).detail)
    );
    if (this.model) this.canvas.model = this.model;
    this.results.setRun(null, { state: 'idle' });
  }

  private setupSplitter(s: HTMLElement): void {
    try {
      const h = Number(localStorage.getItem(RESULTS_H_KEY));
      if (h > 0) this.style.setProperty('--results-h', `${h}px`);
    } catch {
      // No storage: default height.
    }
    s.addEventListener('pointerdown', (e) => {
      s.setPointerCapture(e.pointerId);
      s.classList.add('active');
      const startY = e.clientY;
      const startH = this.results.getBoundingClientRect().height;
      const move = (ev: PointerEvent) => {
        const h = Math.max(120, Math.min(window.innerHeight - 220, startH - (ev.clientY - startY)));
        this.style.setProperty('--results-h', `${h}px`);
      };
      const up = () => {
        s.classList.remove('active');
        s.removeEventListener('pointermove', move);
        try {
          localStorage.setItem(
            RESULTS_H_KEY,
            String(Math.round(this.results.getBoundingClientRect().height))
          );
        } catch {
          // Not remembered.
        }
      };
      s.addEventListener('pointermove', move);
      s.addEventListener('pointerup', up, { once: true });
    });
  }

  // ---- state --------------------------------------------------------------

  private commit(d: EditDetail): void {
    if (!this.model || d.model === this.model) return;
    if (!d.coalesce || d.coalesce !== this.lastCoalesce) this.history.push(this.model);
    this.lastCoalesce = d.coalesce;
    this.model = d.model;
    if (d.select !== undefined) this.selection = d.select;
    this.update();
    this.scheduleSave();
  }

  private select(s: Selection): void {
    this.selection = s;
    this.lastCoalesce = undefined;
    this.canvas.selection = s;
    this.inspector.selection = s;
  }

  private update(): void {
    const m = this.model;
    if (!m) return;
    // A selection whose target is gone (undo, delete) falls back to the model.
    const s = this.selection;
    if (
      s &&
      !(s.kind === 'node'
        ? m.nodes.some((n) => n.id === s.id)
        : s.kind === 'edge'
          ? m.edges.some((e) => e.id === s.id)
          : m._diagram.boundaries.some((b) => b.id === s.id))
    ) {
      this.selection = null;
    }
    this.issues = validate(m);
    const errors = this.issues.filter((i) => i.severity === 'error').length;
    const warnings = this.issues.length - errors;
    this.checksBadge.className = `badge hide-narrow ${errors ? 'critical' : warnings ? 'warning' : 'good'}`;
    this.checksBadge.replaceChildren(
      icon(errors || warnings ? 'alert' : 'check'),
      errors
        ? `${errors} to fix`
        : warnings
          ? `${warnings} warning${warnings > 1 ? 's' : ''}`
          : 'Checks pass'
    );
    this.canvas.invalid = new Set(
      this.issues
        .filter((i) => i.severity === 'error' && i.ref && i.ref.kind !== 'config')
        .map((i) => i.ref?.id ?? '')
    );
    this.canvas.selection = this.selection;
    this.canvas.model = m;
    this.inspector.model = m;
    this.inspector.selection = this.selection;
    this.inspector.issues = this.issues;
    this.nameEl.textContent = m.metadata.name || 'Untitled model';
    this.undoBtn.disabled = !this.history.canUndo;
    this.redoBtn.disabled = !this.history.canRedo;
    this.runBtn.replaceChildren(icon(this.running ? 'x' : 'play'), this.running ? 'Cancel' : 'Run');
    this.runBtn.title = this.running ? 'Stop this run' : 'Run the model (Ctrl+Enter)';
    this.results.setRun(
      this.result,
      this.running
        ? { state: 'running' }
        : this.result
          ? { state: 'done', stale: this.resultModel !== m }
          : { state: 'idle' },
      fileNameFor(m).replace(/\.gssk\.json$/, '')
    );
  }

  private undo(): void {
    if (!this.model) return;
    const prev = this.history.undo(this.model);
    if (!prev) return;
    this.model = prev;
    this.lastCoalesce = undefined;
    this.update();
    this.scheduleSave();
  }

  private redo(): void {
    if (!this.model) return;
    const next = this.history.redo(this.model);
    if (!next) return;
    this.model = next;
    this.lastCoalesce = undefined;
    this.update();
    this.scheduleSave();
  }

  private scheduleSave(): void {
    this.dirty = true;
    this.savedEl.textContent = 'Saving…';
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.flush(), SAVE_DELAY_MS);
  }

  private async flush(): Promise<void> {
    clearTimeout(this.saveTimer);
    if (!this.dirty || !this.model) return;
    this.dirty = false;
    try {
      await saveModel(this.modelId, this.model);
      if (!this.dirty) this.savedEl.textContent = 'Saved';
      document.title = `${this.model.metadata.name} · GSSK Studio`;
    } catch (err) {
      this.dirty = true;
      this.savedEl.textContent = 'Not saved';
      toast(`Couldn't save: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async run(): Promise<void> {
    const m = this.model;
    if (!m || this.running) return;
    if (hasErrors(this.issues)) {
      toast('Fix the problems listed under Checks before running.');
      this.select(null);
      return;
    }
    const run = { token: 0, cancelled: false };
    this.running = run;
    this.update();
    const worker = simWorker();
    try {
      const { token } = await worker.begin(m);
      run.token = token;
      // Chunks of ~120 ms keep progress live and make Cancel take effect quickly.
      for (;;) {
        if (run.cancelled) {
          await worker.cancel(token);
          this.running = null;
          this.update();
          toast('Run cancelled.');
          return;
        }
        const p = await worker.advance(token, 120);
        this.results.setProgress(p.step / p.steps);
        if (p.done) break;
      }
      this.result = await worker.finish(token);
      this.resultModel = m;
      this.running = null;
      this.update();
    } catch (err) {
      this.running = null;
      this.update();
      this.results.setRun(this.result, {
        state: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const t = e.target as HTMLElement;
    const typing = t.closest('input, textarea, select') !== null;
    if (e.key === 'Enter') {
      e.preventDefault();
      void this.run();
    } else if (!typing && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if (!typing && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.redo();
    } else if (e.key.toLowerCase() === 's') {
      e.preventDefault();
      void this.flush();
    }
  }
}

define('studio-page', StudioPage);
