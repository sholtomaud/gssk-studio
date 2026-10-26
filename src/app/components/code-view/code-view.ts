/**
 * <code-view>: the model as Energese TypeScript (FR-SDK-006, ADR 0013).
 * It shows the model's generated code, or the script that built it while
 * that script still describes the model (FR-SDK-007). tsrs checks every edit;
 * Apply runs the script in a sandboxed worker and proposes what it builds as
 * one undoable `diagram-edit`. The view never owns the model.
 *
 * Loaded on demand with Monaco and tsrs, so the studio's first load is
 * unchanged.
 */
import { BaseComponent, define } from '../../core/base-component.ts';
import { compile, compilerReady, runScript } from '../../code-client.ts';
import { monaco } from '../../monaco.ts';
import { el, toast } from '../../ui.ts';
import { toProblem, type Problem } from '../../../code/diagnostics.ts';
import { SCRIPT, toAbsolute } from '../../../code/project.ts';
import { normaliseModel } from '../../../model/io.ts';
import { canonicalJson, toKernelModel } from '../../../model/kernel-json.ts';
import type { StudioModel } from '../../../model/types.ts';
import { toEnergese } from '../../../sdk/energese/codegen.ts';
import { sha256Hex } from '../../../sim/gssk.ts';
import type { CompileResult } from '../../../workers/compiler.worker.ts';
import type { EditDetail } from '../diagram-canvas/diagram-canvas.ts';
import style from './code-view.css?raw';

const CHECK_DELAY_MS = 400;

/** The run manifest's model hash (FR-SIM-003): layout and editor data excluded. */
export function modelHash(m: StudioModel): Promise<string> {
  return sha256Hex(canonicalJson(toKernelModel(m)));
}

/** What the editor holds: generated code, the current script, or a script the model has outgrown. */
type Shown = 'generated' | 'script' | 'stale';

export class CodeView extends BaseComponent {
  private _model: StudioModel | null = null;
  private editor: monaco.editor.IStandaloneCodeEditor | null = null;
  private readonly textModel = monaco.editor.createModel(
    '',
    'typescript',
    monaco.Uri.parse(`file://${toAbsolute(SCRIPT)}`)
  );
  /** The text the view last put in the editor; anything else is the author's edit. */
  private baseline = '';
  private shown: Shown = 'generated';
  private compiled: { text: string; result: CompileResult; problems: Problem[] } | null = null;
  private checkTimer = 0;
  private syncToken = 0;
  private busy = false;
  /** Whether the model's script still describes it. */
  private scriptCurrent = false;

  private stateEl!: HTMLElement;
  private noteEl!: HTMLElement;
  private checkEl!: HTMLElement;
  private applyBtn!: HTMLButtonElement;
  private generatedBtn!: HTMLButtonElement;
  private scriptBtn!: HTMLButtonElement;
  private problemsEl!: HTMLElement;
  private outputEl!: HTMLElement;
  private host!: HTMLElement;

  constructor() {
    super('', style);
  }

  get model(): StudioModel | null {
    return this._model;
  }

  set model(m: StudioModel | null) {
    if (m === this._model) return;
    this._model = m;
    if (this.editor) void this.sync();
  }

  override init(): void {
    if (this.editor) return;
    // Generated code and scripts use \n; a platform default of \r\n would make
    // every shown text look edited.
    this.textModel.setEOL(monaco.editor.EndOfLineSequence.LF);
    this.stateEl = el('span', { class: 'state', role: 'status' });
    this.checkEl = el('span', { class: 'check', role: 'status', text: 'Loading TypeScript…' });
    this.applyBtn = el('button', {
      type: 'button',
      class: 'primary',
      text: 'Apply',
      title: 'Run the script and make what it builds the model (Ctrl+S)',
    });
    this.generatedBtn = el('button', {
      type: 'button',
      text: 'Generated code',
      title: 'Replace the editor’s text with the model’s generated code',
    });
    this.scriptBtn = el('button', {
      type: 'button',
      text: 'Last script',
      title: 'Open the script that last built this model',
    });
    this.applyBtn.onclick = () => void this.apply();
    this.generatedBtn.onclick = () => {
      if (this._model) this.show(toEnergese(this._model), 'generated');
    };
    this.scriptBtn.onclick = () => {
      const s = this._model?._energese;
      if (s) this.show(s.source, this.scriptCurrent ? 'script' : 'stale');
    };
    this.noteEl = el('p', { class: 'note', hidden: '' });
    this.host = el('div', { class: 'editor' });
    this.problemsEl = el('ul', { class: 'problems', 'aria-label': 'Problems' });
    this.outputEl = el('ul', { class: 'output', 'aria-label': 'Script output' });
    this.setContent(
      el(
        'header',
        { class: 'bar' },
        this.stateEl,
        this.checkEl,
        el('span', { class: 'spacer' }),
        this.scriptBtn,
        this.generatedBtn,
        this.applyBtn
      ),
      this.noteEl,
      this.host,
      el(
        'div',
        { class: 'panels' },
        el('section', {}, el('h3', { text: 'Problems' }), this.problemsEl),
        el('section', {}, el('h3', { text: 'Output' }), this.outputEl)
      )
    );

    this.editor = monaco.editor.create(this.host, {
      model: this.textModel,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      scrollBeyondLastLine: false,
      tabSize: 2,
      ariaLabel: 'Energese code',
    });
    this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void this.apply());
    this.textModel.onDidChangeContent(() => {
      this.renderState();
      window.clearTimeout(this.checkTimer);
      this.checkTimer = window.setTimeout(() => void this.check(), CHECK_DELAY_MS);
    });
    compilerReady().then(
      () => void this.check(),
      (err: unknown) => this.setCheck('critical', `TypeScript did not load: ${String(err)}`)
    );
    void this.sync();
  }

  override destroy(): void {
    window.clearTimeout(this.checkTimer);
  }

  /** Free the editor; the element is not reused after this. */
  dispose(): void {
    this.editor?.dispose();
    this.textModel.dispose();
    this.editor = null;
  }

  private get dirty(): boolean {
    return this.textModel.getValue() !== this.baseline;
  }

  /** Show the model's script while it still describes the model, else its generated code. */
  private async sync(): Promise<void> {
    const m = this._model;
    if (!m) return;
    const token = ++this.syncToken;
    const script = m._energese;
    const current = script ? (await modelHash(m)) === script.modelHash : false;
    if (token !== this.syncToken) return;
    this.scriptCurrent = current;
    this.scriptBtn.hidden = !script;
    if (this.dirty) {
      this.note(
        'The model has changed since you began editing. Apply replaces it with what this script builds.'
      );
      return;
    }
    if (script && current) {
      this.note(null);
      this.show(script.source, 'script');
    } else {
      this.note(
        script
          ? 'The model was edited after its script last ran, so this is its generated code. “Last script” opens the script.'
          : null
      );
      this.show(toEnergese(m), 'generated');
    }
  }

  /** Replace the text, keeping the editor's own undo. */
  private show(text: string, shown: Shown): void {
    this.shown = shown;
    this.baseline = text;
    if (this.textModel.getValue() !== text) {
      this.textModel.pushEditOperations(
        [],
        [{ range: this.textModel.getFullModelRange(), text }],
        () => null
      );
    }
    this.renderState();
  }

  private note(text: string | null): void {
    this.noteEl.hidden = text === null;
    this.noteEl.textContent = text ?? '';
  }

  private renderState(): void {
    const label = this.dirty
      ? 'Edited, not applied'
      : this.shown === 'script'
        ? 'The script that built this model'
        : this.shown === 'stale'
          ? 'The last script; the model has changed since it ran'
          : 'Generated from the model';
    this.stateEl.textContent = label;
    this.stateEl.className = `state ${this.dirty ? 'edited' : this.shown}`;
  }

  private setCheck(kind: 'good' | 'warning' | 'critical' | 'busy', text: string): void {
    this.checkEl.className = `check ${kind}`;
    this.checkEl.textContent = text;
  }

  private async compiledFor(text: string) {
    if (this.compiled?.text === text) return this.compiled;
    const result = await compile(text);
    const problems = result.diagnostics.map(toProblem);
    this.compiled = { text, result, problems };
    return this.compiled;
  }

  private async check(): Promise<void> {
    const text = this.textModel.getValue();
    this.setCheck('busy', 'Checking…');
    try {
      const c = await this.compiledFor(text);
      if (this.textModel.getValue() !== text) return;
      this.renderProblems(c.problems);
    } catch (err) {
      this.setCheck(
        'critical',
        `Check failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private renderProblems(problems: Problem[]): void {
    monaco.editor.setModelMarkers(
      this.textModel,
      'tsrs',
      problems
        .filter((p) => p.file === SCRIPT || p.file === null)
        .map((p) => ({
          startLineNumber: p.startLineNumber,
          startColumn: p.startColumn,
          endLineNumber: p.endLineNumber,
          endColumn: p.endColumn,
          message: p.message,
          code: `TS${p.code}`,
          source: 'tsrs',
          severity:
            p.severity === 'error'
              ? monaco.MarkerSeverity.Error
              : p.severity === 'warning'
                ? monaco.MarkerSeverity.Warning
                : monaco.MarkerSeverity.Info,
        }))
    );
    const errors = problems.filter((p) => p.severity === 'error').length;
    this.setCheck(
      errors ? 'critical' : problems.length ? 'warning' : 'good',
      problems.length
        ? `${problems.length} problem${problems.length > 1 ? 's' : ''}`
        : 'No problems'
    );
    this.problemsEl.replaceChildren(
      ...problems.map((p) => {
        const b = el('button', {
          type: 'button',
          class: p.severity,
          text: `${p.file === SCRIPT ? '' : `${p.file ?? ''} `}${p.startLineNumber}:${p.startColumn}  ${p.message}`,
        });
        b.onclick = () => {
          this.editor?.setPosition({ lineNumber: p.startLineNumber, column: p.startColumn });
          this.editor?.revealLineInCenter(p.startLineNumber);
          this.editor?.focus();
        };
        return el('li', {}, b);
      })
    );
  }

  private output(lines: { level: string; text: string }[]): void {
    this.outputEl.replaceChildren(...lines.map((l) => el('li', { class: l.level, text: l.text })));
  }

  /** Check, run in the sandbox, and propose the result as one edit (FR-SDK-006). */
  private async apply(): Promise<void> {
    const m = this._model;
    if (!m || this.busy) return;
    this.busy = true;
    this.applyBtn.disabled = true;
    const text = this.textModel.getValue();
    try {
      const c = await this.compiledFor(text);
      this.renderProblems(c.problems);
      const errors = c.problems.filter((p) => p.severity === 'error').length;
      if (errors) {
        toast(`Fix ${errors === 1 ? 'the problem' : `the ${errors} problems`} before applying.`);
        return;
      }
      const r = await runScript({ modules: c.result.modules, previous: m });
      if (!r.ok) {
        this.output([...r.logs, { level: 'error', text: r.message }]);
        return;
      }
      const { model: built, notes } = normaliseModel(r.model);
      const generated = toEnergese(built) === text;
      delete built._energese;
      if (!generated) built._energese = { source: text, modelHash: await modelHash(built) };
      this.output([
        ...r.logs,
        ...notes.map((n) => ({ level: 'warn', text: n })),
        {
          level: 'info',
          text: `Applied: ${built.nodes.length} symbols, ${built.edges.length} flows (${Math.round(r.durationMs)} ms).`,
        },
      ]);
      this.baseline = text;
      this.shown = generated ? 'generated' : 'script';
      this.renderState();
      this.dispatchEvent(
        new CustomEvent<EditDetail>('diagram-edit', {
          detail: { model: built, label: 'Apply script' },
          bubbles: true,
        })
      );
    } catch (err) {
      this.output([{ level: 'error', text: err instanceof Error ? err.message : String(err) }]);
    } finally {
      this.busy = false;
      this.applyBtn.disabled = false;
    }
  }
}

define('code-view', CodeView);
