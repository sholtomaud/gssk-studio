/**
 * <inspector-panel>: properties of the selection, or of the model when
 * nothing is selected, and the model's checks (SPEC §6.4, FR-VAL-001). Edits
 * go out as `diagram-edit` events, like the canvas's, so the studio screen
 * owns history and saving.
 */
import { BaseComponent, define } from '../../core/base-component.ts';
import { logicFor, symbolFor } from '../../../model/catalogue.ts';
import {
  findEdge,
  findNode,
  removeSelection,
  renameNode,
  updateBoundary,
  updateEdge,
  updateNode,
  alignNodes,
  distributeNodes,
  selectionKey,
  selectNodes,
  toggleSensor,
  type Alignment,
  type Selection,
} from '../../../model/ops.ts';
import {
  childGroups,
  diagramView,
  findGroup,
  groupNodes,
  groupOfNode,
  nodesIn,
  renameGroup,
  revealNode,
  setCollapsed,
  ungroup,
  type End,
} from '../../../model/groups.ts';
import {
  addCarrier,
  CARRIER_PRESETS,
  COICOP_DIVISIONS,
  conservedOf,
  currencies,
  currencyName,
  findCarrier,
  isCoicop,
  kindOf,
  kindOfCarrierId,
  kindOfUnit,
  removeCarrier,
  renameCarrier,
  unitOf,
  updateCarrier,
} from '../../../model/carriers.ts';
import {
  addCounterFlow,
  impliedPrice,
  partnerOf,
  priceUnit,
  toggleTransaction,
  transactionOf,
  updateTransaction,
} from '../../../model/transactions.ts';
import {
  canForceNode,
  defaultForcing,
  describeForcing,
  evaluateForcing,
  WAVEFORM_INFO,
} from '../../../model/forcing.ts';
import {
  CARRIER_KINDS,
  cloneModel,
  type Carrier,
  type CarrierKind,
  EDGE_LOGICS,
  WAVEFORMS,
  METHODS,
  NODE_TYPES,
  type EdgeLogic,
  type Forcing,
  type Method,
  type ModelEdge,
  type ModelNode,
  type NodeType,
  type Process,
  type StudioModel,
  type Waveform,
  controlsOf,
} from '../../../model/types.ts';
import { validate, type Issue } from '../../../model/validate.ts';
import { symbolIcon } from '../../symbol-icon.ts';
import { downloadText, el, formatNumber, icon, iconButton, svg, toast } from '../../ui.ts';
import { observationsFromCsv, observationTargets } from '../../../fit/observations.ts';
import type { EditDetail } from '../diagram-canvas/diagram-canvas.ts';
import { SYMBOL_SCALE } from '../../../diagram/geometry.ts';
import { canonicalJson, kernelHash, toKernelModel } from '../../../model/kernel-json.ts';
import {
  addControl,
  describeProcess,
  findProcess,
  flowToProcess,
  pathways,
  processGaps,
  processOfEdge,
  removeControl,
  removeProcess,
  renameProcess,
  setControlUsed,
  setInput,
  setOp,
  setProduct,
  setSink,
} from '../../../model/processes.ts';
import { citeInput, inputKeys, marksFor, sourceCounts, uncite } from '../../../model/provenance.ts';
import {
  BLOCK_EXTENSION,
  blockFileName,
  blockHash,
  parseBlock,
  placeBlock,
  blockFromGroup,
  CODE_SCHEMES,
  metaProblems,
  scoreTests,
  serialiseBlock,
  TEST_METRICS,
  trustLevel,
  type BlockCode,
  type CodeScheme,
  type TestMetric,
  type TestScore,
  type TrustLevel,
} from '../../../model/blocks.ts';
import { slugify } from '../../../model/ids.ts';
import { ModelFormatError } from '../../../model/io.ts';
import { simWorker } from '../../sim-client.ts';
import KERNEL_PIN from '../../../../vendor/gssk/GSSK_PIN.json' with { type: 'json' };
import { BUILTIN_ICONS, builtinIcon, DEFAULT_ICON } from '../../../diagram/icons.ts';
import {
  addIcon,
  iconsOf,
  isIconHref,
  MAX_ICON_CHARS,
  removeIcon,
  setNodeIcon,
} from '../../../model/icons.ts';
import style from './inspector-panel.css?raw';

type NodeParam = keyof NonNullable<ModelNode['params']>;

/** Type-specific node parameters the inspector offers. */
const NODE_PARAMS: Partial<Record<NodeType, { key: NodeParam; label: string }[]>> = {
  producer: [
    { key: 'k_production', label: 'Production gain' },
    { key: 'k_respiration', label: 'Respiration rate' },
  ],
  consumer: [{ key: 'k_metabolism', label: 'Metabolism rate' }],
  loop_limited: [
    { key: 'k', label: 'Gain k' },
    { key: 'C', label: 'Saturation C' },
  ],
  switch: [{ key: 'threshold', label: 'Threshold' }],
  gain: [{ key: 'k', label: 'Gain k' }],
  exchange: [{ key: 'price', label: 'Price' }],
};

export class InspectorPanel extends BaseComponent {
  private _model: StudioModel | null = null;
  private _selection: Selection = null;
  private _issues: Issue[] = [];
  private _notes: string[] = [];
  /** The last model this panel emitted: echoing it back must not rebuild the form mid-typing. */
  private emitted: StudioModel | null = null;
  private formKey = '';
  private form!: HTMLElement;
  private checks!: HTMLElement;

  constructor() {
    super('', style);
  }

  override init(): void {
    if (this.form) return;
    this.form = el('div', { class: 'form' });
    this.checks = el('section', { class: 'checks', 'aria-labelledby': 'checks-h' });
    this.append(this.form, this.checks);
    this.renderForm(true);
    this.renderChecks();
  }

  set model(m: StudioModel) {
    const echo = m === this.emitted;
    // An echo is the immediate round trip of our own edit; the same model coming back later (undo) is not.
    this.emitted = null;
    this._model = m;
    if (this.form) this.renderForm(!echo);
  }

  set selection(s: Selection) {
    const same = selectionKey(s) === selectionKey(this._selection);
    this._selection = s;
    if (this.form && !same) this.renderForm(true);
  }

  set issues(i: Issue[]) {
    this._issues = i;
    if (this.checks) this.renderChecks();
  }

  set notes(n: string[]) {
    this._notes = n;
    if (this.checks) this.renderChecks();
  }

  private emit(model: StudioModel, label: string, field?: string, select?: Selection): void {
    this.emitted = model;
    this._model = model;
    const detail: EditDetail = {
      model,
      label,
      ...(field ? { coalesce: `field:${this.formKey}:${field}` } : {}),
      ...(select !== undefined ? { select } : {}),
    };
    this.dispatchEvent(new CustomEvent<EditDetail>('diagram-edit', { detail, bubbles: true }));
  }

  private selectRef(s: Selection): void {
    this.dispatchEvent(new CustomEvent<Selection>('diagram-select', { detail: s, bubbles: true }));
  }

  // ---- field builders -----------------------------------------------------

  private numberField(
    label: string,
    value: number | undefined,
    commit: (v: number | undefined) => void,
    opts: { optional?: boolean; step?: string; name: string }
  ): HTMLLabelElement {
    const input = el('input', {
      type: 'number',
      step: opts.step ?? 'any',
      value: value === undefined ? '' : String(value),
      name: opts.name,
      inputmode: 'decimal',
    });
    input.addEventListener('input', () => {
      const raw = input.value.trim();
      if (raw === '' && opts.optional) {
        input.removeAttribute('aria-invalid');
        commit(undefined);
        return;
      }
      const v = Number(raw);
      if (raw === '' || !Number.isFinite(v)) {
        input.setAttribute('aria-invalid', 'true');
        return;
      }
      input.removeAttribute('aria-invalid');
      commit(v);
    });
    return el('label', { class: 'field' }, label, input);
  }

  private textField(
    label: string,
    value: string,
    commit: (v: string) => void,
    name: string,
    multiline = false
  ): HTMLLabelElement {
    const input = multiline
      ? el('textarea', { rows: '3', name })
      : el('input', { type: 'text', value, name });
    if (multiline) (input as HTMLTextAreaElement).value = value;
    input.addEventListener('input', () => commit(input.value));
    return el('label', { class: 'field' }, label, input);
  }

  private selectField<T extends string>(
    label: string,
    value: T | '',
    options: { value: T | ''; label: string }[],
    commit: (v: T | '') => void,
    name: string
  ): HTMLLabelElement {
    const sel = el('select', { name });
    for (const o of options) {
      const opt = el('option', { value: o.value, text: o.label });
      if (o.value === value) opt.selected = true;
      sel.append(opt);
    }
    sel.addEventListener('change', () => commit(sel.value as T | ''));
    return el('label', { class: 'field' }, label, sel);
  }

  // ---- forms --------------------------------------------------------------

  private renderForm(force: boolean): void {
    const m = this._model;
    const s = this._selection;
    const key = selectionKey(s);
    if (!force && key === this.formKey) return;
    this.formKey = key;
    this.form.replaceChildren();
    if (!m) return;
    if (s?.kind === 'node') {
      const n = findNode(m, s.id);
      if (n) return this.nodeForm(m, n);
    } else if (s?.kind === 'nodes') {
      return this.multiForm(m, s.ids);
    } else if (s?.kind === 'edge') {
      const e = findEdge(m, s.id);
      if (e) return this.edgeForm(m, e);
    } else if (s?.kind === 'process') {
      const pr = findProcess(m, s.id);
      if (pr) return this.processForm(m, pr);
    } else if (s?.kind === 'group') {
      if (findGroup(m, s.id)) return this.groupForm(m, s.id);
    } else if (s?.kind === 'bundle') {
      const b = diagramView(m).bundles.find((x) => x.id === s.id);
      if (b) return this.bundleForm(m, b.id);
    } else if (s?.kind === 'boundary') {
      const b = m._diagram.boundaries.find((x) => x.id === s.id);
      if (b) {
        const del = el(
          'button',
          { type: 'button', class: 'danger' },
          icon('trash'),
          'Delete boundary'
        );
        del.onclick = () => this.emit(removeSelection(m, s), 'Delete boundary', undefined, null);
        this.form.append(
          el(
            'section',
            {},
            el(
              'div',
              { class: 'kind' },
              icon('frame'),
              el('span', { class: 't', text: 'System boundary' })
            ),
            this.textField(
              'Label',
              b.label,
              (v) =>
                this.emit(
                  updateBoundary(this._model ?? m, b.id, (x) => (x.label = v)),
                  'Rename boundary',
                  'label'
                ),
              'label'
            ),
            el('p', {
              class: 'hint',
              text: 'A boundary is a drawing aid: the kernel never sees it.',
            }),
            el('div', { class: 'actions' }, del)
          )
        );
        return;
      }
    }
    this.modelForm(m);
  }

  /**
   * On a flow's form: the process it is a pathway of (ADR 0018), or for a
   * plain interaction flow, the offer to make it one.
   */
  private processNote(m: StudioModel, e: ModelEdge): HTMLElement | null {
    const cur = () => this._model ?? m;
    const pr = processOfEdge(m, e);
    if (pr) {
      const role = e.visual?.process?.role;
      const b = el('button', { type: 'button', text: describeProcess(m, pr) });
      b.onclick = () => this.selectRef({ kind: 'process', id: pr.id });
      return el(
        'div',
        { class: 'links' },
        el('span', {
          class: 'hint',
          text: `The ${role === 'heat' ? 'used-energy' : role === 'use' ? 'use' : 'product'} pathway of`,
        }),
        b
      );
    }
    const control = controlsOf(e)[0];
    if (e.logic !== 'interaction' || !control) return null;
    const make = el('button', { type: 'button', name: 'make-process', text: 'Make it a process' });
    make.onclick = () => {
      const o = findNode(cur(), e.origin);
      const t = findNode(cur(), e.target);
      const at = {
        x: ((o?.visual.x ?? 0) + (t?.visual.x ?? 0)) / 2,
        y: ((o?.visual.y ?? 0) + (t?.visual.y ?? 0)) / 2,
      };
      const { model, id } = flowToProcess(cur(), e.id, control, {
        x: Math.round(at.x / 10) * 10,
        y: Math.round(at.y / 10) * 10,
      });
      if (id) this.emit(model, `Make ${e.id} a process`, undefined, { kind: 'process', id });
    };
    return el(
      'div',
      { class: 'make-process' },
      el('p', {
        class: 'hint',
        text: 'Odum’s interaction is a production process: its used energy goes to a heat sink, and an ingredient is drawn down. Make this flow the product of one to draw and edit those pathways.',
      }),
      el('div', { class: 'actions' }, make)
    );
  }

  /** An interaction process (ADR 0018): its operation, inputs, product, heat sink and every pathway's k. */
  private processForm(m: StudioModel, pr: Process): void {
    const id = pr.id;
    const cur = () => this._model ?? m;
    const go = (model: StudioModel, label: string, field?: string) => {
      this.emit(model, label, field);
      this.renderForm(true);
    };
    const name = (nid: string) => findNode(m, nid)?.visual.label ?? nid;
    const options = (filter: (n: ModelNode) => boolean = () => true) => [
      { value: '', label: '— choose —' },
      ...m.nodes.filter(filter).map((n) => ({ value: n.id, label: name(n.id) })),
    ];
    const ways = pathways(m, id);
    const gaps = processGaps(pr);
    const rate = (label: string, e: ModelEdge | undefined, field: string) =>
      e
        ? this.numberField(
            label,
            e.params.k,
            (v) =>
              v !== undefined &&
              this.emit(
                updateEdge(cur(), e.id, (x) => (x.params.k = v)),
                label,
                field
              ),
            { name: field }
          )
        : null;
    const controls = pr.controls.map((c) => {
      const used = el('input', { type: 'checkbox', name: `used-${c.node}` });
      used.checked = c.used;
      used.onchange = () =>
        go(
          setControlUsed(cur(), id, c.node, used.checked),
          `${name(c.node)} ${used.checked ? 'used up' : 'only read'}`
        );
      const remove = iconButton('x', `Remove ${name(c.node)}`, 'ghost icon');
      remove.onclick = () =>
        go(removeControl(cur(), id, c.node), `Remove ${name(c.node)} from interaction`);
      return el(
        'li',
        { class: 'control-row', 'data-control': c.node },
        el('span', { class: 'name', text: name(c.node) }),
        el('label', { class: 'check' }, used, 'Used up'),
        remove
      );
    });
    const del = el(
      'button',
      { type: 'button', class: 'danger' },
      icon('trash'),
      'Delete interaction'
    );
    del.onclick = () => this.emit(removeProcess(cur(), id), 'Delete interaction', undefined, null);
    this.form.append(
      el(
        'section',
        {},
        el(
          'div',
          { class: 'kind' },
          symbolIcon('interaction'),
          el(
            'div',
            {},
            el('div', { class: 't', text: 'Interaction' }),
            el('div', { class: 's', text: describeProcess(m, pr) })
          )
        ),
        el('p', {
          class: 'summary',
          text: 'A production process (Odum’s work gate): every pathway in or out follows its production function, each with its own k. The used energy goes to the heat sink; a used-up control is drawn down too.',
        }),
        gaps.length
          ? el('p', { class: 'hint warn-text', text: `Needs ${gaps.join(', ')}.` })
          : null,
        this.textField(
          'Label',
          pr.label ?? '',
          (v) => this.emit(renameProcess(cur(), id, v), 'Rename interaction', 'label'),
          'label'
        ),
        this.selectField<Process['op']>(
          'Production function',
          pr.op,
          [
            { value: 'product', label: 'Product: k·A·B (inputs multiplied)' },
            { value: 'divide', label: 'Divisor: k·A/B (dilution)' },
            { value: 'subtract', label: 'Subtracting: k·(A − B)' },
          ],
          (v) => v && go(setOp(cur(), id, v), 'Production function'),
          'op'
        ),
        this.selectField(
          'Main input (from the left)',
          pr.input ?? '',
          options((n) => n.type !== 'sink'),
          (v) => v && go(setInput(cur(), id, v), 'Main input'),
          'input'
        ),
        this.selectField(
          'Makes (product)',
          pr.target ?? '',
          options((n) => n.type !== 'source' && n.type !== 'constant'),
          (v) => v && go(setProduct(cur(), id, v), 'Product'),
          'target'
        ),
        this.selectField(
          'Used energy to',
          pr.sink ?? '',
          options((n) => n.type === 'sink'),
          (v) => v && go(setSink(cur(), id, v), 'Heat sink'),
          'sink'
        )
      ),
      el(
        'section',
        {},
        el('h3', { text: 'Controls (from the right)' }),
        controls.length
          ? el('ul', { class: 'controls' }, ...controls)
          : el('p', { class: 'hint', text: 'None yet.' }),
        this.selectField(
          'Add a control',
          '',
          options(
            (n) =>
              n.id !== pr.input && !pr.controls.some((c) => c.node === n.id) && n.type !== 'sink'
          ),
          (v) => v && go(addControl(cur(), id, v), `Add ${name(v)} to interaction`),
          'add-control'
        )
      ),
      el(
        'section',
        {},
        el('h3', { text: 'Rates' }),
        ...(ways.product
          ? [
              rate('Product k', ways.product, 'k-product'),
              rate('Used energy k', ways.heat, 'k-heat'),
              ...[...ways.uses].map(([c, e]) => rate(`Use of ${name(c)} k`, e, `k-use-${c}`)),
            ]
          : [el('p', { class: 'hint', text: 'Its pathways appear once it is wired.' })]),
        el('div', { class: 'actions' }, del)
      )
    );
  }

  /** A zoom group (FR-GRP-001): its name, packing, what it holds and what crosses its edge. */
  private groupForm(m: StudioModel, id: string): void {
    const g = findGroup(m, id);
    if (!g) return;
    const cur = () => this._model ?? m;
    const inside = new Set(nodesIn(m, id));
    const flowsIn = m.edges.filter((e) => inside.has(e.target) && !inside.has(e.origin));
    const flowsOut = m.edges.filter((e) => inside.has(e.origin) && !inside.has(e.target));
    const internal = m.edges.filter((e) => inside.has(e.origin) && inside.has(e.target));
    const subgroups = childGroups(m, id);
    const toggle = el(
      'button',
      { type: 'button', class: 'primary', name: 'pack' },
      g.collapsed ? 'Unpack' : 'Pack'
    );
    toggle.onclick = () =>
      this.emit(
        setCollapsed(cur(), id, !g.collapsed),
        `${g.collapsed ? 'Unpack' : 'Pack'} ${g.label}`
      );
    const ung = el('button', { type: 'button', text: 'Ungroup' });
    ung.title = 'Remove the group and keep everything in it';
    ung.onclick = () =>
      this.emit(ungroup(cur(), id), `Ungroup ${g.label}`, undefined, selectNodes(g.nodes));
    const del = el(
      'button',
      { type: 'button', class: 'danger' },
      icon('trash'),
      `Delete group and ${inside.size} symbols`
    );
    del.onclick = () =>
      this.emit(
        removeSelection(cur(), { kind: 'group', id }),
        `Delete ${g.label}`,
        undefined,
        null
      );
    const nodeLink = (nodeId: string) => {
      const n = findNode(m, nodeId);
      const b = el('button', { type: 'button', text: n?.visual.label ?? nodeId });
      b.onclick = () =>
        this.emit(revealNode(cur(), nodeId), `Show ${nodeId}`, undefined, {
          kind: 'node',
          id: nodeId,
        });
      return b;
    };
    const groupLink = (gid: string) => {
      const b = el('button', { type: 'button', text: findGroup(m, gid)?.label ?? gid });
      b.onclick = () => this.selectRef({ kind: 'group', id: gid });
      return b;
    };
    const parent = g.parent ? findGroup(m, g.parent) : undefined;
    this.form.append(
      el(
        'section',
        {},
        el(
          'div',
          { class: 'kind' },
          el(
            'div',
            {},
            el('div', { class: 't', text: 'Group' }),
            el('div', {
              class: 's',
              text: `${inside.size} symbols${subgroups.length ? `, ${subgroups.length} groups inside` : ''} · ${g.collapsed ? 'packed' : 'unpacked'}`,
            })
          )
        ),
        el('p', {
          class: 'summary',
          text: 'Packed, the group draws as one symbol and its flows across the edge as one combined flow. The kernel always runs every symbol inside, so packing never changes a result.',
        }),
        this.textField(
          'Label',
          g.label,
          (v) => this.emit(renameGroup(cur(), id, v), 'Rename group', 'label'),
          'label'
        ),
        parent
          ? el(
              'div',
              { class: 'links' },
              el('span', { class: 'hint', text: 'Inside' }),
              groupLink(parent.id)
            )
          : null,
        el('div', { class: 'actions' }, toggle, ung)
      ),
      el(
        'section',
        {},
        el('h3', { text: 'Holds' }),
        subgroups.length
          ? el('div', { class: 'links' }, ...subgroups.map((c) => groupLink(c.id)))
          : null,
        g.nodes.length ? el('div', { class: 'links' }, ...g.nodes.map(nodeLink)) : null,
        el('p', {
          class: 'hint',
          text: `${internal.length} flows inside; ${flowsIn.length} in and ${flowsOut.length} out across its edge.`,
        }),
        el('div', { class: 'actions' }, del)
      ),
      this.crossingSection(m, [...flowsIn, ...flowsOut], inside),
      this.blockSection(m, id)
    );
  }

  /** The symbol or flow whose sources are open, kept open across a rebuild. */
  private sourcesOpen: string | null = null;

  /** Test runs of blocks, by group, with the contents they ran (stale once those change). */
  private blockRuns = new Map<
    string,
    { key: string; ran: boolean; scores: TestScore[]; error?: string }
  >();

  /**
   * A group as a building block (ADR 0017): where it came from, where its
   * numbers come from, its trust level and tests, and saving it to a file.
   */
  private blockSection(m: StudioModel, id: string): HTMLElement {
    const g = findGroup(m, id)!;
    const cur = () => this._model ?? m;
    const meta = {
      id: g.block?.id ?? `my.${slugify(g.label).replace(/_/g, '-') || 'block'}`,
      version: g.block?.version ?? '1.0.0',
      title: g.label,
    };
    const { block, notes } = blockFromGroup(m, id, meta);
    const errors = validate(block.model).filter((i) => i.severity === 'error').length;
    const key = canonicalJson(toKernelModel(block.model)) + canonicalJson(block.tests);
    const run = this.blockRuns.get(id);
    const fresh = run?.key === key ? run : undefined;
    const level = trustLevel({ errors, ran: fresh?.ran, scores: fresh?.scores });
    const src = sourceCounts(block.model);
    const total = src.cited + src.calibrated + src.assumed + src.unsourced;
    const LEVELS: Record<TrustLevel, string> = {
      unchecked: 'Unchecked: its contents have errors',
      structural: 'Structural: its checks pass',
      runs: 'Runs: it runs cleanly on its own',
      fitted: 'Fitted: it reproduces its observations',
      reviewed: 'Reviewed',
    };

    const testBtn = el(
      'button',
      { type: 'button', name: 'test-block' },
      icon('play'),
      block.tests.length ? 'Run its tests' : 'Run it on its own'
    );
    testBtn.disabled = errors > 0;
    testBtn.onclick = async () => {
      testBtn.disabled = true;
      testBtn.textContent = 'Running…';
      try {
        const worker = simWorker();
        const { token } = await worker.begin(block.model);
        for (;;) if ((await worker.advance(token, 120)).done) break;
        const r = await worker.finish(token);
        const series = (t: string) =>
          t.startsWith('flow:')
            ? r.flows.find((f) => f.id === t.slice(5))?.values
            : r.nodes.find((n) => n.id === t)?.values;
        const ran = r.diagnostics.solverConfident;
        this.blockRuns.set(id, { key, ran, scores: scoreTests(block.tests, r.times, series) });
      } catch (e) {
        this.blockRuns.set(id, { key, ran: false, scores: [], error: (e as Error).message });
      }
      this.renderForm(true);
    };

    const scoreRows = (fresh?.scores ?? []).map((s) =>
      el('li', {
        class: s.passed ? 'pass' : 'fail',
        text: `${s.passed ? '✓' : '✗'} ${s.test.name}: ${s.test.metric.toUpperCase()} ${Number.isFinite(s.value) ? s.value.toFixed(3) : '—'} (needs ≥ ${s.test.min}, ${s.n} points)`,
      })
    );

    // Saving: id, version, title, description, codes, and which observations become tests.
    const series = (m._observations ?? []).filter(
      (o) =>
        o.target &&
        (o.target.startsWith('flow:')
          ? block.model.edges.some((e) => `flow:${e.id}` === o.target)
          : block.model.nodes.some((n) => n.id === o.target))
    );
    const form = el(
      'form',
      { class: 'cite-form block-form' },
      el('label', {}, 'Id', el('input', { name: 'id', value: meta.id, required: '' })),
      el(
        'label',
        {},
        'Version',
        el('input', { name: 'version', value: meta.version, required: '' })
      ),
      el('label', {}, 'Title', el('input', { name: 'title', value: meta.title, required: '' })),
      el('label', {}, 'Description', el('textarea', { name: 'description', rows: '2' })),
      el(
        'label',
        {},
        'Codes, one per line',
        el('textarea', {
          name: 'codes',
          rows: '2',
          placeholder: 'SNA2008 S.14 Households\nANZSIC2006 D26',
        })
      ),
      ...series.map((o) =>
        el(
          'fieldset',
          { class: 'test-row' },
          el(
            'label',
            { class: 'check' },
            el('input', { type: 'checkbox', name: `test:${o.id}` }),
            `Test: reproduce ${o.name}`
          ),
          el(
            'select',
            { name: `metric:${o.id}`, 'aria-label': `Fit measure for ${o.name}` },
            ...TEST_METRICS.map((x) => el('option', { value: x, text: x.toUpperCase() }))
          ),
          el('input', {
            type: 'number',
            step: 'any',
            name: `min:${o.id}`,
            value: '0.5',
            'aria-label': `Least fit for ${o.name}`,
          })
        )
      ),
      el(
        'button',
        { type: 'submit', class: 'primary' },
        icon('download'),
        'Save as a building block'
      )
    );
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const f = new FormData(form);
      const get = (k: string) => String(f.get(k) ?? '').trim();
      const want = { id: get('id'), version: get('version'), title: get('title') };
      const problems = metaProblems(want);
      if (problems.length) {
        toast(problems.join(' '));
        return;
      }
      const codes: BlockCode[] = [];
      for (const line of get('codes')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)) {
        const [scheme, code, ...label] = line.split(/\s+/);
        if (!CODE_SCHEMES.includes(scheme as CodeScheme) || !code) {
          toast(
            `“${line}” is not a code: write the scheme (${CODE_SCHEMES.join(', ')}) then the code.`
          );
          return;
        }
        codes.push({
          scheme: scheme as CodeScheme,
          code,
          ...(label.length ? { label: label.join(' ') } : {}),
        });
      }
      const tests = series
        .filter((o) => f.get(`test:${o.id}`))
        .map((o) => ({
          series: o.id,
          metric: (get(`metric:${o.id}`) || 'nse') as TestMetric,
          min: Number(get(`min:${o.id}`) || '0.5'),
        }));
      const out = blockFromGroup(cur(), id, {
        ...want,
        ...(get('description') ? { description: get('description') } : {}),
        codes,
        tests,
        kernel: KERNEL_PIN.version,
      });
      downloadText(blockFileName(out.block), serialiseBlock(out.block));
      toast(
        out.notes.length ? `Saved. ${out.notes.join(' ')}` : `Saved ${blockFileName(out.block)}.`
      );
    };

    return el(
      'section',
      { class: 'block' },
      el('h3', { text: 'Building block' }),
      g.block
        ? el('p', {
            class: 'summary',
            text: `Placed from ${g.block.id} ${g.block.version}`,
            title: `Block hash ${g.block.hash}`,
          })
        : el('p', {
            class: 'hint',
            text: 'Save this group as a block to place it in other models. The symbols inside that flows from outside reach become its ports.',
          }),
      el('p', { class: `trust trust-${level}` }, el('strong', { text: LEVELS[level] })),
      el('p', {
        class: 'hint',
        text: `Ports: ${block.ports.length ? block.ports.map((p) => `${p.label ?? p.node} (${p.direction}${p.carrier ? `, ${p.carrier}` : ''})`).join('; ') : 'none yet'}.`,
      }),
      el('p', {
        class: 'hint',
        text: `Of ${total} inputs: ${src.cited} from cited data, ${src.calibrated} calibrated, ${src.assumed} assumed by the assistant, ${src.unsourced} with no stated source.`,
      }),
      notes.length
        ? el('p', { class: 'hint', text: `Saved, it would leave out: ${notes.join(' ')}` })
        : null,
      fresh?.error ? el('p', { class: 'hint', text: `It did not run: ${fresh.error}` }) : null,
      fresh && !fresh.error && !fresh.ran
        ? el('p', { class: 'hint', text: 'The solver lost confidence in its run.' })
        : null,
      scoreRows.length ? el('ul', { class: 'scores' }, ...scoreRows) : null,
      el('div', { class: 'actions' }, testBtn),
      el('details', {}, el('summary', { text: 'Save as a building block' }), form)
    );
  }

  /**
   * Every flow across a group's edge, and the symbol inside it really
   * reaches (FR-GRP-001): the wiring the kernel runs, whatever the packing.
   */
  private crossingSection(
    m: StudioModel,
    flows: readonly ModelEdge[],
    inside: ReadonlySet<string>
  ): HTMLElement {
    const cur = () => this._model ?? m;
    const name = (id: string) => findNode(m, id)?.visual.label ?? id;
    const rows = flows.map((e) => {
      const into = inside.has(e.target);
      const show = el('button', { type: 'button', text: e.id, title: 'Unpack to this flow' });
      show.onclick = () => {
        const next = revealNode(revealNode(cur(), e.origin), e.target);
        this.emit(next, `Show ${e.id}`, undefined, { kind: 'edge', id: e.id });
      };
      return el(
        'tr',
        { 'data-flow': e.id },
        el('td', {}, show),
        el('td', { text: into ? `in from ${name(e.origin)}` : `out to ${name(e.target)}` }),
        el('td', {
          class: 'inner',
          text: `${into ? '→' : '←'} ${name(into ? e.target : e.origin)}`,
          title: into ? e.target : e.origin,
        })
      );
    });
    return el(
      'section',
      { class: 'crossing' },
      el('h3', { text: 'Across its edge' }),
      flows.length
        ? el(
            'table',
            { class: 'bundle-flows' },
            el(
              'thead',
              {},
              el(
                'tr',
                {},
                el('th', { text: 'Flow' }),
                el('th', { text: 'Outside' }),
                el('th', { text: 'Inside' })
              )
            ),
            el('tbody', {}, ...rows)
          )
        : el('p', { class: 'hint', text: 'No flow crosses its edge.' }),
      el('p', {
        class: 'hint',
        text: 'Each flow runs between these two symbols in the model the kernel is given; the group is only how it is drawn.',
      }),
      this.kernelButton(m, 'See this group in the kernel model', inside)
    );
  }

  /** A combined flow: the flows it stands for, each a link that unpacks to it. */
  private bundleForm(m: StudioModel, bundleId: string): void {
    const b = diagramView(m).bundles.find((x) => x.id === bundleId);
    if (!b) return;
    const cur = () => this._model ?? m;
    const name = (e: End) =>
      e.kind === 'group'
        ? (findGroup(m, e.id)?.label ?? e.id)
        : (findNode(m, e.id)?.visual.label ?? e.id);
    const rows = b.edges.flatMap((id) => {
      const e = findEdge(m, id);
      if (!e) return [];
      const show = el('button', { type: 'button', text: id, title: 'Unpack to this flow' });
      show.onclick = () => {
        const next = revealNode(revealNode(cur(), e.origin), e.target);
        this.emit(next, `Show ${id}`, undefined, { kind: 'edge', id });
      };
      return [
        el(
          'tr',
          { 'data-flow': id },
          el('td', {}, show),
          el('td', {
            text: `${findNode(m, e.origin)?.visual.label ?? e.origin} → ${findNode(m, e.target)?.visual.label ?? e.target}`,
          }),
          el('td', { class: 'num', text: e.forcing ? '∿' : String(e.params.k) })
        ),
      ];
    });
    this.form.append(
      el(
        'section',
        {},
        el(
          'div',
          { class: 'kind' },
          el(
            'div',
            {},
            el('div', { class: 't', text: 'Combined flow' }),
            el('div', { class: 's', text: `${name(b.origin)} → ${name(b.target)}` })
          )
        ),
        el('p', {
          class: 'summary',
          text: `${b.edges.length} flow${b.edges.length === 1 ? '' : 's'} across a packed group’s edge, drawn as one. During playback its reading ΣJ is the sum of their rates.`,
        }),
        el(
          'table',
          { class: 'bundle-flows' },
          el(
            'thead',
            {},
            el(
              'tr',
              {},
              el('th', { text: 'Flow' }),
              el('th', { text: 'From → to' }),
              el('th', { text: 'k' })
            )
          ),
          el('tbody', {}, ...rows)
        )
      )
    );
  }

  /**
   * A button that shows the JSON the kernel is given for a run (SPEC §7.1),
   * so the wiring can be checked against the diagram: the whole model, or
   * the part about some symbols (`focus`) and every flow touching them.
   */
  private kernelButton(m: StudioModel, label: string, focus?: ReadonlySet<string>): HTMLElement {
    const b = el('button', { type: 'button', name: 'kernel-json', text: label });
    b.onclick = () => {
      const all = toKernelModel(m);
      const shown = focus
        ? {
            nodes: all.nodes.filter((n) => focus.has(String(n.id))),
            edges: all.edges.filter(
              (e) => focus.has(String(e.origin)) || focus.has(String(e.target))
            ),
          }
        : all;
      const text = JSON.stringify(shown, null, 2);
      const hash = el('code', { class: 'hash', text: '…' });
      void kernelHash(m).then((h) => (hash.textContent = h.slice(0, 16)));
      const copy = el('button', { type: 'button', text: 'Copy' });
      copy.onclick = () =>
        void navigator.clipboard?.writeText(text).then(
          () => toast('Copied the kernel JSON.'),
          () => toast('Could not copy; select the text instead.')
        );
      const close = iconButton('x', 'Close');
      const dialog = el(
        'dialog',
        { class: 'kernel-json', 'aria-label': 'What the kernel runs' },
        el(
          'header',
          {},
          el('h2', { text: 'What the kernel runs' }),
          el('span', { class: 'spacer' }),
          copy,
          close
        ),
        el('p', {
          class: 'hint',
          text: focus
            ? `The ${shown.nodes.length} symbols in this group and the ${shown.edges.length} flows that touch them, exactly as the kernel is given them. A run is given the whole model; the group itself is not in it, only how it is drawn.`
            : 'The model exactly as the kernel is given it for a run. Groups, boundaries and layout are not in it: they are how the diagram is drawn, so they never change a result.',
        }),
        el('p', { class: 'hint' }, 'Model hash (in every run’s manifest): ', hash),
        el('pre', { class: 'json', tabindex: '0', text })
      );
      close.onclick = () => dialog.close();
      dialog.addEventListener('close', () => dialog.remove());
      this.form.append(dialog);
      dialog.showModal();
    };
    return el('div', { class: 'actions' }, b);
  }

  /** Several symbols: align, distribute, delete (FR-EDIT-011, FR-EDIT-012). */
  private multiForm(m: StudioModel, ids: string[]): void {
    const cur = () => this._model ?? m;
    const button = (label: string, title: string, run: () => StudioModel) => {
      const b = el('button', { type: 'button', text: label, title });
      b.onclick = () => this.emit(run(), title);
      return b;
    };
    const align = (how: Alignment, label: string) =>
      button(label, `Align ${how}`, () => alignNodes(cur(), ids, how));
    const del = el(
      'button',
      { type: 'button', class: 'danger' },
      icon('trash'),
      `Delete ${ids.length}`
    );
    del.onclick = () =>
      this.emit(
        removeSelection(cur(), { kind: 'nodes', ids }),
        `Delete ${ids.length} symbols`,
        undefined,
        null
      );
    this.form.append(
      el(
        'section',
        {},
        el(
          'div',
          { class: 'kind' },
          el(
            'div',
            {},
            el('div', { class: 't', text: `${ids.length} symbols selected` }),
            el('div', { class: 's', text: 'Shift-click to add or remove one' })
          )
        ),
        el(
          'div',
          { class: 'actions' },
          (() => {
            const b = el(
              'button',
              { type: 'button', class: 'primary', name: 'group' },
              `Group ${ids.length} (Ctrl+G)`
            );
            b.title = 'Pack these symbols into one group symbol';
            b.onclick = () => {
              const { model, id } = groupNodes(cur(), ids);
              if (id)
                this.emit(model, `Group ${ids.length} symbols`, undefined, { kind: 'group', id });
            };
            return b;
          })()
        ),
        el('h3', { text: 'Align' }),
        el(
          'div',
          { class: 'links' },
          align('left', 'Left'),
          align('centre', 'Centre'),
          align('right', 'Right')
        ),
        el(
          'div',
          { class: 'links' },
          align('top', 'Top'),
          align('middle', 'Middle'),
          align('bottom', 'Bottom')
        ),
        el('h3', { text: 'Distribute' }),
        el(
          'div',
          { class: 'links' },
          button('Horizontally', 'Distribute horizontally', () => distributeNodes(cur(), ids, 'x')),
          button('Vertically', 'Distribute vertically', () => distributeNodes(cur(), ids, 'y'))
        ),
        el('p', {
          class: 'hint',
          text: 'Ctrl/⌘-C copies, Ctrl/⌘-D duplicates, with the flows between them.',
        }),
        el('div', { class: 'actions' }, del)
      )
    );
  }

  private modelForm(m: StudioModel): void {
    const cur = () => this._model ?? m;
    const c = m.config;
    const steps = c.dt > 0 ? Math.round((c.t_end - c.t_start) / c.dt) : NaN;
    const stepsEl = el('p', {
      class: 'hint',
      text: Number.isFinite(steps) ? `${steps.toLocaleString('en')} steps per run.` : '',
    });
    const cfg = (patch: Partial<StudioModel['config']>, label: string, field: string) => {
      const next = cloneModel(cur());
      Object.assign(next.config, patch);
      const n =
        next.config.dt > 0
          ? Math.round((next.config.t_end - next.config.t_start) / next.config.dt)
          : NaN;
      stepsEl.textContent = Number.isFinite(n) ? `${n.toLocaleString('en')} steps per run.` : '';
      this.emit(next, label, field);
    };
    this.form.append(
      el(
        'section',
        {},
        el('h3', { text: 'Model' }),
        this.textField(
          'Name',
          m.metadata.name,
          (v) => {
            const next = cloneModel(cur());
            next.metadata.name = v;
            this.emit(next, 'Rename model', 'name');
          },
          'name'
        ),
        this.textField(
          'Description',
          m.metadata.description ?? '',
          (v) => {
            const next = cloneModel(cur());
            if (v) next.metadata.description = v;
            else delete next.metadata.description;
            this.emit(next, 'Edit description', 'description');
          },
          'description',
          true
        ),
        el('p', {
          class: 'hint',
          text: `${m.nodes.length} symbols · ${m.edges.length} flows. Select a symbol or flow to edit it.`,
        }),
        this.kernelButton(m, 'See what the kernel runs')
      ),
      el(
        'section',
        {},
        el('h3', { text: 'Run settings' }),
        el(
          'div',
          { class: 'row2' },
          this.numberField(
            'Start time',
            c.t_start,
            (v) => v !== undefined && cfg({ t_start: v }, 'Start time', 't_start'),
            { name: 't_start' }
          ),
          this.numberField(
            'End time',
            c.t_end,
            (v) => v !== undefined && cfg({ t_end: v }, 'End time', 't_end'),
            { name: 't_end' }
          )
        ),
        el(
          'div',
          { class: 'row2' },
          this.numberField(
            'Time step',
            c.dt,
            (v) => v !== undefined && cfg({ dt: v }, 'Time step', 'dt'),
            { name: 'dt' }
          ),
          this.selectField<Method>(
            'Method',
            c.method,
            METHODS.map((x) => ({ value: x, label: x })),
            (v) => v && cfg({ method: v }, 'Method', 'method'),
            'method'
          )
        ),
        stepsEl,
        el('p', {
          class: 'hint',
          text: 'auto lets the kernel pick the matrix exponential where it can and verify it against RK4.',
        })
      ),
      this.carriersSection(m),
      this.observationsSection(m),
      this.placeBlockSection(m),
      ...(iconsOf(m).length ? [this.iconsSection(m)] : [])
    );
  }

  /** Place a building block from its file (ADR 0017): a packed copy, right of the diagram. */
  private placeBlockSection(m: StudioModel): HTMLElement {
    const cur = () => this._model ?? m;
    const file = el('input', {
      type: 'file',
      accept: `${BLOCK_EXTENSION},.json,application/json`,
      hidden: '',
      name: 'block-file',
    });
    const btn = el(
      'button',
      { type: 'button', name: 'place-block' },
      icon('upload'),
      'Place a building block'
    );
    btn.onclick = () => file.click();
    file.onchange = async () => {
      const f = file.files?.[0];
      file.value = '';
      if (!f) return;
      try {
        const { block, notes } = parseBlock(await f.text());
        const now = cur();
        const xs = now.nodes.map((n) => n.visual.x);
        const ys = now.nodes.map((n) => n.visual.y);
        const at = xs.length
          ? { x: Math.max(...xs) + 240, y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2) }
          : { x: 400, y: 300 };
        const { model, groupId } = placeBlock(now, block, at, await blockHash(block));
        this.emit(model, `Place ${block.title}`, undefined, { kind: 'group', id: groupId });
        toast(
          notes.length
            ? `Placed ${block.title}. ${notes.join(' ')}`
            : `Placed ${block.title} ${block.version}.`
        );
      } catch (e) {
        toast(
          e instanceof ModelFormatError
            ? e.message
            : `Could not read ${f.name}: ${(e as Error).message}`
        );
      }
    };
    return el(
      'section',
      {},
      el('h3', { text: 'Building blocks' }),
      el('p', {
        class: 'hint',
        text: 'Place a block saved from another model (a .gssk-block.json file). It comes in packed, with fresh ids; wire flows to its ports.',
      }),
      el('div', { class: 'actions' }, btn, file)
    );
  }

  /** What flows carry (FR-TYP-001): picked from the model's carriers, or typed. */
  private carrierField(
    m: StudioModel,
    value: string | undefined,
    commit: (v: string) => void
  ): HTMLLabelElement {
    const listId = 'carrier-options';
    const input = el('input', {
      type: 'text',
      value: value ?? '',
      name: 'carrier',
      list: listId,
      spellcheck: 'false',
    });
    input.addEventListener('input', () => commit(input.value.trim()));
    const list = el('datalist', { id: listId });
    for (const c of m.carriers ?? []) {
      list.append(el('option', { value: c.id, text: `${c._label ?? c.id} · ${unitOf(c) ?? '?'}` }));
    }
    const c = findCarrier(m, value);
    const kind = c ? kindOf(c) : undefined;
    return el(
      'label',
      { class: 'field' },
      'Carrier',
      input,
      list,
      el('span', {
        class: 'hint',
        text: c
          ? `${c._label ?? c.id}: ${kind ?? 'kind unknown'}${unitOf(c) ? `, in ${unitOf(c)}` : ''}`
          : value
            ? 'Not in the model’s carriers: add it under Carriers (select nothing).'
            : 'What flows: pick one of the model’s carriers.',
      })
    );
  }

  /** The model's carriers (FR-TYP-001, ADR 0015): unit, currency, kind. */
  private carriersSection(m: StudioModel): HTMLElement {
    const cur = () => this._model ?? m;
    const rows = (m.carriers ?? []).map((c) => {
      const kind = kindOf(c);
      const money = c._currency !== undefined ? 'fiat' : c._dti !== undefined ? 'token' : '';
      const set = (label: string, field: string, f: (x: Carrier) => void) =>
        this.emit(updateCarrier(cur(), c.id, f), label, `carrier:${c.id}:${field}`);
      const idInput = el('input', {
        type: 'text',
        value: c.id,
        name: `carrier-id-${c.id}`,
        spellcheck: 'false',
      });
      idInput.addEventListener('change', () => {
        const next = renameCarrier(cur(), c.id, idInput.value.trim());
        if (next === cur()) {
          idInput.setAttribute('aria-invalid', 'true');
          return;
        }
        this.emit(next, `Rename carrier ${c.id}`);
        this.renderForm(true);
      });
      const measure = this.selectField(
        'Measured as',
        money,
        [
          { value: '', label: 'A unit (UCUM)' },
          { value: 'fiat', label: 'Money: a currency (ISO 4217)' },
          { value: 'token', label: 'Money: a digital token (ISO 24165)' },
        ],
        (v) => {
          this.emit(
            updateCarrier(cur(), c.id, (x) => {
              delete x._currency;
              delete x._dti;
              if (v === 'fiat') x._currency = 'AUD';
              if (v === 'token') x._dti = '';
            }),
            'Carrier measure'
          );
          this.renderForm(true);
        },
        `carrier-measure-${c.id}`
      );
      const currencyList = el('datalist', { id: 'currency-options' });
      for (const code of currencies())
        currencyList.append(el('option', { value: code, text: currencyName(code) }));
      const amount =
        money === 'fiat'
          ? (() => {
              const input = el('input', {
                type: 'text',
                value: c._currency ?? '',
                name: `carrier-currency-${c.id}`,
                list: 'currency-options',
                spellcheck: 'false',
              });
              input.addEventListener('input', () =>
                set('Currency', 'currency', (x) => (x._currency = input.value.trim().toUpperCase()))
              );
              return el('label', { class: 'field' }, 'Currency', input, currencyList);
            })()
          : money === 'token'
            ? this.textField(
                'Digital token (DTI)',
                c._dti ?? '',
                (v) => set('Token', 'dti', (x) => (x._dti = v.trim().toUpperCase())),
                `carrier-dti-${c.id}`
              )
            : this.textField(
                'Unit (UCUM)',
                c.unit ?? '',
                (v) => set('Unit', 'unit', (x) => (x.unit = v.trim())),
                `carrier-unit-${c.id}`
              );
      const needKind = !money && kindOfUnit(c.unit) === undefined;
      const del = iconButton('trash', `Remove carrier ${c.id}`, 'ghost icon danger');
      del.onclick = () => {
        this.emit(removeCarrier(cur(), c.id), `Remove carrier ${c.id}`);
        this.renderForm(true);
      };
      return el(
        'div',
        { class: 'carrier', 'data-carrier': c.id },
        el(
          'div',
          { class: 'row2' },
          el('label', { class: 'field' }, 'Id', idInput),
          this.textField(
            'Name',
            c._label ?? '',
            (v) => set('Carrier name', 'label', (x) => (x._label = v)),
            `carrier-label-${c.id}`
          )
        ),
        el('div', { class: 'row2' }, measure, amount),
        needKind
          ? this.selectField<CarrierKind>(
              'Kind (the unit cannot tell)',
              c._kind ?? '',
              [
                { value: '', label: '— choose —' },
                ...CARRIER_KINDS.filter((k) => k !== 'monetary').map((k) => ({
                  value: k,
                  label: k,
                })),
              ],
              (v) => set('Carrier kind', 'kind', (x) => (v ? (x._kind = v) : delete x._kind)),
              `carrier-kind-${c.id}`
            )
          : null,
        el(
          'div',
          { class: 'carrier-foot' },
          el('span', {
            class: 'hint',
            text: `${kind ?? 'kind unknown'}${kind === 'monetary' && c._currency ? ` · ${currencyName(c._currency)}` : ''} · ${conservedOf(c) ? 'conserved' : 'not conserved'}`,
          }),
          del
        )
      );
    });
    const add = this.selectField(
      'Add a carrier',
      '',
      [
        { value: '', label: '— choose —' },
        ...CARRIER_PRESETS.map((p) => ({ value: p.id, label: `${p._label} (${unitOf(p)})` })),
        { value: '*', label: 'Other…' },
      ],
      (v) => {
        if (!v) return;
        const preset = CARRIER_PRESETS.find((p) => p.id === v) ?? { id: 'carrier' };
        const { model } = addCarrier(cur(), preset);
        this.emit(model, `Add carrier ${preset.id}`);
        this.renderForm(true);
      },
      'add-carrier'
    );
    return el(
      'section',
      { class: 'carriers' },
      el('h3', { text: 'Carriers' }),
      el('p', {
        class: 'hint',
        text: 'What flows, in Odum’s sense (his Code): each with a UCUM unit, or an ISO 4217 currency or ISO 24165 token for money. Money draws dashed and information dotted.',
      }),
      ...rows,
      add
    );
  }

  /**
   * Odum's transaction on a flow (FR-TRX-001): money flows against what it
   * buys. Invalid until the counter-flow exists; this section adds it.
   */
  private transactionSection(m: StudioModel, e: ModelEdge): HTMLElement {
    const cur = () => this._model ?? m;
    const trx = transactionOf(m, e);
    const head = el('h3', { text: 'Transaction' });
    if (!trx) {
      const box = el('input', { type: 'checkbox', name: 'transaction' });
      box.onchange = () => {
        this.emit(toggleTransaction(cur(), e.id), `Transaction on ${e.id}`);
        this.renderForm(true);
      };
      return el(
        'section',
        { class: 'transaction' },
        head,
        el(
          'label',
          { class: 'check' },
          box,
          el('span', { text: 'Transaction on this flow: it is paid for by a money counter-flow' })
        )
      );
    }
    const marked = trx.marked;
    const partner = partnerOf(m, marked);
    const link = (x: ModelEdge) => {
      const b = el('button', { type: 'button', text: x.id });
      b.onclick = () => this.selectRef({ kind: 'edge', id: x.id });
      return b;
    };
    const off = el('button', {
      type: 'button',
      text: 'Remove transaction',
      name: 'remove-transaction',
    });
    off.onclick = () => {
      this.emit(toggleTransaction(cur(), marked.id), `Remove transaction on ${marked.id}`);
      this.renderForm(true);
    };
    const section = el('section', { class: 'transaction' }, head);
    if (marked !== e) {
      section.append(
        el(
          'div',
          { class: 'links' },
          el('span', { class: 'hint', text: 'Pays for' }),
          link(marked)
        ),
        el('p', {
          class: 'hint',
          text: 'This flow is the money side of a transaction; its purpose and tags are on the other flow.',
        }),
        el('div', { class: 'actions' }, off)
      );
      return section;
    }
    // Purpose (COICOP 2018) and tags.
    const purpose = marked.visual?.transaction?.purpose ?? '';
    const division = purpose.slice(0, 2);
    const purposeSel = this.selectField(
      'Purpose (COICOP 2018)',
      COICOP_DIVISIONS[division] ? division : '',
      [
        { value: '', label: '— none —' },
        ...Object.entries(COICOP_DIVISIONS).map(([k, v]) => ({ value: k, label: `${k} ${v}` })),
      ],
      (v) => {
        this.emit(
          updateTransaction(cur(), marked.id, (t) => (v ? (t.purpose = v) : delete t.purpose)),
          'Transaction purpose'
        );
        this.renderForm(true);
      },
      'purpose'
    );
    const fine = this.textField(
      'Finer COICOP code (optional)',
      purpose.length > 2 ? purpose : '',
      (v) => {
        const code = v.trim();
        if (code && !isCoicop(code)) return;
        this.emit(
          updateTransaction(cur(), marked.id, (t) =>
            code ? (t.purpose = code) : division ? (t.purpose = division) : delete t.purpose
          ),
          'Transaction purpose',
          'purpose-code'
        );
      },
      'purpose_code'
    );
    const tags = this.textField(
      'Tags (comma-separated)',
      (marked.visual?.transaction?.tags ?? []).join(', '),
      (v) =>
        this.emit(
          updateTransaction(cur(), marked.id, (t) => {
            const list = v
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean);
            if (list.length) t.tags = list;
            else delete t.tags;
          }),
          'Transaction tags',
          'tags'
        ),
      'tags'
    );
    if (partner) {
      const money = trx.money;
      const goods = trx.goods;
      const fixed =
        money &&
        goods &&
        money.logic === 'constant' &&
        goods.logic === 'constant' &&
        !money.forcing &&
        !goods.forcing
          ? impliedPrice(money.params.k, goods.params.k)
          : undefined;
      section.append(
        el(
          'div',
          { class: 'links' },
          el('span', { class: 'hint', text: 'Counter-flow' }),
          link(partner)
        ),
        el('p', {
          class: 'hint',
          text:
            fixed !== undefined && money && goods
              ? `Implied price at these rates: ${formatNumber(fixed)} ${priceUnit(m, money, goods)}. Each flow keeps its own rate until the kernel prices the pair (K-9).`
              : 'Each flow keeps its own rate until the kernel prices the pair (K-9); during a run the diagram shows the implied price.',
        })
      );
    } else {
      section.append(
        el('p', {
          class: 'hint warn-text',
          text: 'Invalid until it has a money counter-flow running the other way.',
        }),
        this.counterFlowForm(m, marked)
      );
    }
    section.append(purposeSel, fine, tags, el('div', { class: 'actions' }, off));
    return section;
  }

  /** Draw the money flow that pays for a marked flow (FR-TRX-001). */
  private counterFlowForm(m: StudioModel, e: ModelEdge): HTMLElement {
    const cur = () => this._model ?? m;
    const moneyStores = m.nodes.filter(
      (n) => symbolFor(n.type).holdsState && kindOfCarrierId(m, n.carrier) === 'monetary'
    );
    const options = [
      { value: '+', label: 'A new money storage' },
      ...m.nodes
        .filter((n) => n.type !== 'sink')
        .map((n) => ({ value: n.id, label: n.visual.label ?? n.id })),
    ];
    let payer = moneyStores[0]?.id ?? '+';
    let payee = moneyStores.find((n) => n.id !== payer)?.id ?? '+';
    const monetary = (m.carriers ?? []).filter((c) => kindOf(c) === 'monetary');
    let currency = monetary[0]?.id ?? 'AUD';
    let k = 1;
    const go = el(
      'button',
      { type: 'button', class: 'primary', name: 'add-counter-flow' },
      'Add counter-flow'
    );
    go.onclick = () => {
      const o = findNode(cur(), e.origin);
      const t = findNode(cur(), e.target);
      const at = (n: typeof o, dy: number) => ({ x: n?.visual.x ?? 0, y: (n?.visual.y ?? 0) + dy });
      // The payer is on the receiving side; the payee on the supplying side.
      const { model, id } = addCounterFlow(cur(), e.id, {
        payer: payer === '+' ? at(t, 160) : payer,
        payee: payee === '+' ? at(o, 160) : payee,
        carrier: currency,
        k,
      });
      if (!id) {
        toast('Choose two different ends and a currency for the counter-flow.');
        return;
      }
      this.emit(model, `Counter-flow for ${e.id}`, undefined, { kind: 'edge', id: e.id });
      this.renderForm(true);
    };
    return el(
      'div',
      { class: 'counter-form' },
      this.selectField('Paid from', payer, options, (v) => (payer = v || '+'), 'payer'),
      this.selectField('Paid to', payee, options, (v) => (payee = v || '+'), 'payee'),
      el(
        'div',
        { class: 'row2' },
        monetary.length
          ? this.selectField(
              'Money',
              currency,
              monetary.map((c) => ({ value: c.id, label: `${c._label ?? c.id} (${unitOf(c)})` })),
              (v) => v && (currency = v),
              'counter-carrier'
            )
          : this.textField(
              'Currency (ISO 4217)',
              currency,
              (v) => (currency = v.trim().toUpperCase()),
              'counter-currency'
            ),
        this.numberField('Amount per unit time', k, (v) => v !== undefined && (k = v), {
          name: 'counter-k',
        })
      ),
      el('div', { class: 'actions' }, go)
    );
  }

  /**
   * Read a picture file as a data URL the icon view will draw (FR-EDIT-014),
   * or say why not. Nothing leaves the browser.
   */
  private async readIcon(f: File): Promise<string | null> {
    const ext = f.name.toLowerCase().split('.').pop() ?? '';
    const types: Record<string, string> = {
      svg: 'image/svg+xml',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      gif: 'image/gif',
    };
    const type = Object.values(types).includes(f.type) ? f.type : types[ext];
    if (!type) {
      toast(`${f.name} is not an SVG, PNG, JPEG, WebP or GIF picture.`);
      return null;
    }
    const bytes = new Uint8Array(await f.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const href = `data:${type};base64,${btoa(bin)}`;
    if (!isIconHref(href)) {
      toast(
        `${f.name} is too large for an icon (at most ${Math.floor((MAX_ICON_CHARS * 3) / 4 / 1024)} KB).`
      );
      return null;
    }
    return href;
  }

  /** What a symbol is drawn as in the icon view (FR-EDIT-014): a built-in, the model's own, or a new one. */
  private iconField(m: StudioModel, n: ModelNode): HTMLElement {
    const cur = () => this._model ?? m;
    const own = iconsOf(m);
    const def = builtinIcon(DEFAULT_ICON[n.type]);
    const file = el('input', {
      type: 'file',
      accept:
        'image/svg+xml,image/png,image/jpeg,image/webp,image/gif,.svg,.png,.jpg,.jpeg,.webp,.gif',
      hidden: '',
      name: 'icon-file',
    });
    file.onchange = async () => {
      const f = file.files?.[0];
      file.value = '';
      if (!f) return;
      const href = await this.readIcon(f);
      if (!href) return;
      const { model, id } = addIcon(cur(), f.name, href, n.id);
      if (id) {
        this.emit(model, `Icon for ${n.id}`);
        this.renderForm(true);
      }
    };
    const field = this.selectField(
      'Icon (in the icon view)',
      n.visual.icon ?? '',
      [
        { value: '', label: `Its symbol’s own (${def?.label ?? n.type})` },
        ...own.map((i) => ({ value: i.id, label: `${i.label} (this model’s)` })),
        ...BUILTIN_ICONS.map((i) => ({ value: `builtin:${i.name}`, label: i.label })),
        { value: '+', label: 'Add your own picture…' },
      ],
      (v) => {
        if (v === '+') {
          file.click();
          this.renderForm(true);
          return;
        }
        this.emit(setNodeIcon(cur(), n.id, v || undefined), `Icon for ${n.id}`, 'icon');
      },
      'icon'
    );
    return el('div', {}, field, file);
  }

  /** The model's own pictures for the icon view (FR-EDIT-014). */
  private iconsSection(m: StudioModel): HTMLElement {
    const own = iconsOf(m);
    const cur = () => this._model ?? m;
    const rows = own.map((i) => {
      const used = m.nodes.filter((n) => n.visual.icon === i.id).length;
      const del = iconButton('trash', `Remove ${i.label}`, 'ghost icon danger');
      del.onclick = () => {
        this.emit(removeIcon(cur(), i.id), `Remove icon ${i.label}`);
        this.renderForm(true);
      };
      return el(
        'li',
        { class: 'own-icon', 'data-icon': i.id },
        el('img', { src: i.href, alt: '', width: '28', height: '28' }),
        el('span', { text: `${i.label} · ${used} symbol${used === 1 ? '' : 's'}` }),
        del
      );
    });
    return el(
      'section',
      {},
      el('h3', { text: 'Icons' }),
      el('p', {
        class: 'hint',
        text: 'Pictures this model’s symbols are drawn as in the icon view. They are saved in the model file.',
      }),
      el('ul', { class: 'own-icons' }, ...rows)
    );
  }

  /**
   * Which of a symbol's or flow's inputs the assistant set, and why (ADR
   * 0016). Editing one, or calibrating it, replaces the mark.
   */
  private assumedNote(m: StudioModel, kind: 'node' | 'edge', id: string): HTMLElement | null {
    const marks = marksFor(m, kind, id).filter((x) => x.mark.by === 'assistant');
    if (marks.length === 0) return null;
    return el(
      'div',
      { class: 'assumed-note', role: 'note' },
      el('strong', { text: '≈ Assumed by the assistant, not from data' }),
      el(
        'ul',
        {},
        ...marks.map((x) =>
          el('li', {
            text: `${x.field.replace(/^params\./, '')}${x.mark.why ? `: ${x.mark.why}` : ''}${x.mark.model ? ` (${x.mark.model})` : ''}`,
          })
        )
      ),
      el('p', { class: 'hint', text: 'Edit a value, or calibrate it, to replace the assumption.' })
    );
  }

  /**
   * Where a symbol's or flow's numbers come from (ADR 0017): each cited value
   * with its source, and a form to cite one. A cited value that is edited by
   * hand loses its citation, since it no longer is the published number.
   */
  private sourcesField(m: StudioModel, kind: 'node' | 'edge', id: string): HTMLElement {
    const cur = () => this._model ?? m;
    const prefix = `${kind}:${id}:`;
    const fields = inputKeys(m)
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length));
    const cited = marksFor(m, kind, id).filter((x) => x.mark.by === 'data' && x.mark.source);
    const name = (f: string) => f.replace(/^params\./, '');
    const rows = cited.map(({ field, mark }) => {
      const s = mark.source!;
      const del = iconButton('trash', `Remove the source of ${name(field)}`, 'ghost icon danger');
      del.onclick = () => {
        this.emit(uncite(cur(), prefix + field), `Remove source of ${id}.${name(field)}`);
        this.sourcesOpen = prefix;
        this.renderForm(true);
      };
      const what = [s.dataset, s.table].filter(Boolean).join(', ');
      const meta = [s.retrieved && `retrieved ${s.retrieved}`, s.licence, s.note]
        .filter(Boolean)
        .join(' · ');
      return el(
        'li',
        {},
        el(
          'span',
          {},
          el('strong', { text: `${name(field)}: ` }),
          s.url
            ? el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', text: what })
            : what,
          meta ? el('span', { class: 'hint', text: ` (${meta})` }) : ''
        ),
        del
      );
    });
    const input = (label: string, key: string, type = 'text', placeholder = '') =>
      el('label', {}, label, el('input', { type, name: key, placeholder }));
    const form = el(
      'form',
      { class: 'cite-form' },
      el(
        'label',
        {},
        'Value',
        el(
          'select',
          { name: 'field' },
          ...fields.map((f) => el('option', { value: f, text: name(f) }))
        )
      ),
      input('Dataset', 'dataset', 'text', 'ABS 5206.0 National Accounts'),
      input('Table or series', 'table', 'text', 'Table 2, A2304402X'),
      input('Link', 'url', 'url', 'https://'),
      input('Retrieved', 'retrieved', 'date'),
      input('Licence', 'licence', 'text', 'CC BY 4.0'),
      input('How it was derived', 'note', 'text', 'read directly'),
      el('button', { type: 'submit' }, icon('check'), 'Cite')
    );
    form.onsubmit = (ev) => {
      ev.preventDefault();
      const f = new FormData(form);
      const get = (k: string) => String(f.get(k) ?? '').trim();
      const field = get('field');
      if (!get('dataset')) {
        toast('Name the dataset the value comes from.');
        return;
      }
      this.emit(
        citeInput(cur(), prefix + field, {
          dataset: get('dataset'),
          table: get('table'),
          url: get('url'),
          retrieved: get('retrieved'),
          licence: get('licence'),
          note: get('note'),
        }),
        `Cite a source for ${id}.${name(field)}`
      );
      this.sourcesOpen = prefix;
      this.renderForm(true);
    };
    const details = el(
      'details',
      { class: 'sources' },
      el('summary', { text: cited.length ? `Sources (${cited.length})` : 'Sources' }),
      rows.length
        ? el('ul', { class: 'cited' }, ...rows)
        : el('p', {
            class: 'hint',
            text: 'No value here cites a source yet. Cite the dataset a number comes from so others can check it.',
          }),
      fields.length ? form : ''
    );
    if (this.sourcesOpen === prefix) details.open = true;
    details.ontoggle = () => (this.sourcesOpen = details.open ? prefix : null);
    return details;
  }

  /** Observed data to fit runs against (FR-OBS-001). */
  private observationsSection(m: StudioModel): HTMLElement {
    const cur = () => this._model ?? m;
    const file = el('input', {
      type: 'file',
      accept: '.csv,text/csv,text/plain',
      hidden: '',
      name: 'observations-file',
    });
    const importBtn = el('button', { type: 'button' }, icon('upload'), 'Import CSV');
    importBtn.onclick = () => file.click();
    file.onchange = async () => {
      const f = file.files?.[0];
      file.value = '';
      if (!f) return;
      try {
        const added = observationsFromCsv(await f.text(), cur(), f.name);
        const next = cloneModel(cur());
        next._observations = [...(next._observations ?? []), ...added];
        this.emit(next, `Import ${f.name}`);
        const unmapped = added.filter((o) => !o.target).length;
        toast(
          `Imported ${added.length} series from ${f.name}${unmapped ? `; ${unmapped} need a target` : ''}.`
        );
        this.renderForm(true);
      } catch (err) {
        toast(`Couldn't read ${f.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    const targets = [{ value: '', label: '— not compared —' }, ...observationTargets(m)];
    const rows = (m._observations ?? []).map((o) => {
      const del = iconButton('trash', `Remove ${o.name}`, 'ghost icon danger');
      del.onclick = () => {
        const next = cloneModel(cur());
        next._observations = (next._observations ?? []).filter((x) => x.id !== o.id);
        if (next._observations.length === 0) delete next._observations;
        this.emit(next, `Remove ${o.name}`);
        this.renderForm(true);
      };
      const select = this.selectField(
        `${o.name} · ${o.times.length} points`,
        o.target ?? '',
        targets,
        (v) => {
          const next = cloneModel(cur());
          const x = next._observations?.find((y) => y.id === o.id);
          if (x) x.target = v || null;
          this.emit(next, `Compare ${o.name}`);
        },
        `obs-${o.id}`
      );
      return el('div', { class: 'obs-row' }, select, del);
    });
    return el(
      'section',
      {},
      el('h3', { text: 'Observations' }),
      ...rows,
      rows.length
        ? null
        : el('p', {
            class: 'hint',
            text: 'Import a CSV of measured data: model time in the first column, one series per column. Headings that match a symbol are compared with it.',
          }),
      el('div', { class: 'actions' }, importBtn, file)
    );
  }

  private nodeForm(m: StudioModel, n: ModelNode): void {
    const spec = symbolFor(n.type);
    const id = n.id;
    const cur = () => this._model ?? m;
    const patch = (label: string, field: string, f: (x: ModelNode) => void) =>
      this.emit(updateNode(cur(), id, f), label, field);
    const idInput = el('input', { type: 'text', value: n.id, name: 'id', spellcheck: 'false' });
    idInput.addEventListener('change', () => {
      const to = idInput.value.trim();
      const next = renameNode(cur(), id, to);
      if (next === cur()) {
        idInput.setAttribute('aria-invalid', 'true');
        idInput.title = 'That id is empty or already used.';
        return;
      }
      this.emit(next, `Rename ${id} → ${to}`, undefined, { kind: 'node', id: to });
    });
    const params = (NODE_PARAMS[n.type] ?? []).map((p) =>
      this.numberField(
        p.label,
        n.params?.[p.key] as number | undefined,
        (v) =>
          patch(p.label, p.key, (x) => {
            x.params ??= {};
            if (v === undefined) delete x.params[p.key];
            else (x.params as Record<string, number>)[p.key] = v;
            if (Object.keys(x.params).length === 0) delete x.params;
          }),
        { optional: true, name: p.key }
      )
    );
    if (n.type === 'exchange') {
      params.push(
        this.selectField(
          'Price from node',
          n.params?.price_node ?? '',
          [
            { value: '', label: '— constant price —' },
            ...cur()
              .nodes.filter((x) => x.id !== id)
              .map((x) => ({ value: x.id, label: x.visual.label ?? x.id })),
          ],
          (v) =>
            patch('Price node', 'price_node', (x) => {
              x.params ??= {};
              if (v) x.params.price_node = v;
              else delete x.params.price_node;
            }),
          'price_node'
        )
      );
    }
    const inflows = m.edges.filter((e) => e.target === id);
    const outflows = m.edges.filter((e) => e.origin === id);
    const link = (e: ModelEdge, text: string) => {
      const b = el('button', { type: 'button', text });
      b.onclick = () => this.selectRef({ kind: 'edge', id: e.id });
      return b;
    };
    const del = el('button', { type: 'button', class: 'danger' }, icon('trash'), 'Delete');
    del.onclick = () =>
      this.emit(removeSelection(cur(), { kind: 'node', id }), `Delete ${id}`, undefined, null);

    this.form.append(
      el(
        'section',
        {},
        el(
          'div',
          { class: 'kind' },
          symbolIcon(n.type),
          el(
            'div',
            {},
            el('div', { class: 't', text: spec.label }),
            el('div', { class: 's mono', text: n.type })
          )
        ),
        el('p', { class: 'summary', text: spec.summary }),
        ...(() => {
          const g = groupOfNode(m, id);
          if (!g) return [];
          const b = el('button', { type: 'button', text: g.label });
          b.onclick = () => this.selectRef({ kind: 'group', id: g.id });
          return [
            el('div', { class: 'links' }, el('span', { class: 'hint', text: 'In group' }), b),
          ];
        })(),
        this.textField(
          'Label',
          n.visual.label ?? '',
          (v) => patch('Label', 'label', (x) => (x.visual.label = v)),
          'label'
        ),
        el('label', { class: 'field' }, 'Id (used by the kernel)', idInput),
        this.selectField<NodeType>(
          'Symbol',
          n.type,
          // The palette's symbols, plus this node's own if the palette no longer offers it.
          NODE_TYPES.filter((t) => symbolFor(t).palette || t === n.type).map((t) => ({
            value: t,
            label: symbolFor(t).label,
          })),
          (v) => {
            if (!v) return;
            this.emit(
              updateNode(cur(), id, (x) => {
                x.type = v;
                delete x.params;
                if (symbolFor(v).holdsState) x.visual.capacity ??= 100;
                else delete x.visual.capacity;
              }),
              `Change ${id} to ${v}`
            );
            this.renderForm(true);
          },
          'type'
        ),
        // Layout only: the kernel never sees a symbol's size or turn (FR-EDIT-013).
        el(
          'div',
          { class: 'row2' },
          this.numberField(
            'Size (%)',
            Math.round((n.visual.scale ?? 1) * 100),
            (v) => {
              const { min, max } = SYMBOL_SCALE;
              const k = Math.min(max, Math.max(min, (v ?? 100) / 100));
              patch('Size', 'scale', (x) =>
                k === 1 ? delete x.visual.scale : (x.visual.scale = k)
              );
            },
            { optional: true, step: '5', name: 'scale' }
          ),
          this.numberField(
            'Turn (°)',
            n.visual.rotation ?? 0,
            (v) => {
              const deg = (((v ?? 0) % 360) + 360) % 360;
              patch('Turn', 'rotation', (x) =>
                deg === 0 ? delete x.visual.rotation : (x.visual.rotation = deg)
              );
            },
            { optional: true, step: '15', name: 'rotation' }
          )
        ),
        this.iconField(m, n)
      ),
      el(
        'section',
        {},
        el('h3', { text: 'Values' }),
        this.assumedNote(m, 'node', n.id),
        this.sourcesField(m, 'node', n.id),
        el(
          'div',
          { class: 'row2' },
          this.numberField(
            spec.valueLabel,
            n.value,
            (v) => v !== undefined && patch(spec.valueLabel, 'value', (x) => (x.value = v)),
            { name: 'value' }
          ),
          spec.holdsState
            ? this.numberField(
                'Gauge full at',
                n.visual.capacity,
                (v) =>
                  patch('Capacity', 'capacity', (x) =>
                    v === undefined ? delete x.visual.capacity : (x.visual.capacity = v)
                  ),
                { optional: true, name: 'capacity' }
              )
            : null
        ),
        ...params,
        this.carrierField(m, n.carrier, (v) =>
          patch('Carrier', 'carrier', (x) => (v ? (x.carrier = v) : delete x.carrier))
        ),
        spec.composite
          ? el('p', {
              class: 'hint',
              text: 'A composite: the kernel expands it into members at load, and its chart shows the body.',
            })
          : null
      ),
      ...(canForceNode(n.type) || n.forcing
        ? [
            this.forcingSection(
              m,
              n.forcing,
              n.value,
              'Drives this symbol’s value over time, in place of the fixed value above.',
              (label, field, f) => patch(label, field, (x) => f(x)),
              () => findNode(cur(), id)?.forcing
            ),
          ]
        : []),
      el(
        'section',
        {},
        el('h3', { text: 'Flows' }),
        inflows.length || outflows.length
          ? el(
              'div',
              { class: 'links' },
              ...inflows.map((e) => link(e, `← ${e.origin}`)),
              ...outflows.map((e) => link(e, `→ ${e.target}`))
            )
          : el('p', {
              class: 'hint',
              text: 'None. Drag from the blue port to another symbol to add one; drop on a flow to control it.',
            }),
        el('div', { class: 'actions' }, del)
      )
    );
  }

  private edgeForm(m: StudioModel, e: ModelEdge): void {
    const id = e.id;
    const cur = () => this._model ?? m;
    const patch = (label: string, field: string, f: (x: ModelEdge) => void) =>
      this.emit(updateEdge(cur(), id, f), label, field);
    const spec = logicFor(e.logic);
    const nodes = m.nodes.map((n) => ({ value: n.id, label: n.visual.label ?? n.id }));
    const needsControl =
      spec.needs.includes('control_node') || spec.needs.includes('control_or_threshold');
    const needsThreshold =
      spec.needs.includes('threshold') || spec.needs.includes('control_or_threshold');
    const del = el('button', { type: 'button', class: 'danger' }, icon('trash'), 'Delete');
    del.onclick = () =>
      this.emit(removeSelection(cur(), { kind: 'edge', id }), `Delete ${id}`, undefined, null);
    const reset = el('button', { type: 'button', text: 'Straighten curve' });
    reset.disabled = !e.visual?.ctrl1 && !e.visual?.ctrl2;
    reset.onclick = () =>
      this.emit(
        updateEdge(cur(), id, (x) => {
          const { sensor } = x.visual ?? {};
          if (sensor) x.visual = { sensor };
          else delete x.visual;
        }),
        'Straighten curve'
      );
    const sensorBox = el('input', { type: 'checkbox', name: 'sensor' });
    sensorBox.checked = e.visual?.sensor === true;
    sensorBox.onchange = () =>
      this.emit(toggleSensor(cur(), id), sensorBox.checked ? 'Add sensor' : 'Remove sensor');
    const sensorField = el(
      'label',
      { class: 'check' },
      sensorBox,
      el('span', { text: 'Sensor on this flow: show its rate J and chart it' })
    );
    const end = (nodeId: string) => {
      const b = el('button', { type: 'button', text: findNode(m, nodeId)?.visual.label ?? nodeId });
      b.onclick = () => this.selectRef({ kind: 'node', id: nodeId });
      return b;
    };
    this.form.append(
      el(
        'section',
        {},
        el(
          'div',
          { class: 'kind' },
          el(
            'div',
            {},
            el('div', { class: 't', text: 'Flow' }),
            el('div', { class: 's mono', text: id })
          )
        ),
        el(
          'div',
          { class: 'links' },
          end(e.origin),
          el('span', { class: 'hint', text: '→' }),
          end(e.target)
        ),
        this.assumedNote(m, 'edge', id),
        this.sourcesField(m, 'edge', id),
        this.processNote(m, e),
        this.selectField<EdgeLogic>(
          'Logic',
          e.logic,
          EDGE_LOGICS.map((l) => ({ value: l, label: logicFor(l).label })),
          (v) => {
            if (!v) return;
            patch('Logic', 'logic', (x) => (x.logic = v));
            this.renderForm(true);
          },
          'logic'
        ),
        el('p', { class: 'formula', text: spec.formula }),
        this.numberField(
          'Rate k',
          e.params.k,
          (v) => v !== undefined && patch('Rate k', 'k', (x) => (x.params.k = v)),
          { name: 'k' }
        ),
        needsControl || e.params.control_node
          ? this.selectField(
              'Control node',
              e.params.control_node ?? '',
              [{ value: '', label: '— none —' }, ...nodes],
              (v) => {
                patch('Control', 'control', (x) =>
                  v ? (x.params.control_node = v) : delete x.params.control_node
                );
                this.renderForm(true);
              },
              'control_node'
            )
          : null,
        needsThreshold || e.params.threshold !== undefined
          ? this.numberField(
              e.logic === 'limit' ? 'Half-saturation C' : 'Threshold θ',
              e.params.threshold,
              (v) =>
                patch('Threshold', 'threshold', (x) =>
                  v === undefined ? delete x.params.threshold : (x.params.threshold = v)
                ),
              { optional: true, name: 'threshold' }
            )
          : null,
        e.logic === 'ratio'
          ? this.selectField(
              'Numerator node',
              e.params.numerator_node ?? '',
              [{ value: '', label: '— the origin —' }, ...nodes],
              (v) =>
                patch('Numerator', 'numerator', (x) =>
                  v ? (x.params.numerator_node = v) : delete x.params.numerator_node
                ),
              'numerator_node'
            )
          : null,
        this.carrierField(m, e.carrier, (v) =>
          patch('Carrier', 'carrier', (x) => (v ? (x.carrier = v) : delete x.carrier))
        ),
        needsControl
          ? el('p', {
              class: 'hint',
              text: 'Or drag from a symbol’s port onto this flow to make it the control.',
            })
          : null,
        sensorField
      ),
      this.transactionSection(m, e),
      this.forcingSection(
        m,
        e.forcing,
        e.params.k,
        'Drives this flow’s rate k over time, in place of the fixed k above.',
        (label, field, f) => patch(label, field, (x) => f(x)),
        () => findEdge(cur(), id)?.forcing
      ),
      el('section', {}, el('div', { class: 'actions' }, reset, del))
    );
  }

  /**
   * The forcing editor (FR-FRC-001), shared by sources, constants and flows:
   * a waveform, its parameters in the kernel's own terms, and a preview of the
   * waveform over the run, drawn from the same formulas the kernel uses.
   */
  private forcingSection(
    m: StudioModel,
    forcing: Forcing | undefined,
    base: number,
    summary: string,
    patch: (label: string, field: string, f: (x: { forcing?: Forcing }) => void) => void,
    current: () => Forcing | undefined
  ): HTMLElement {
    const cfg = m.config;
    const preview = el('div', { class: 'forcing-preview' });
    const redraw = () => this.drawForcing(preview, current(), base, this._model?.config ?? cfg);
    const set = (label: string, field: string, f: (x: Forcing) => void) => {
      patch(label, field, (x) => {
        if (x.forcing) f(x.forcing);
      });
      redraw();
    };
    const waveform = this.selectField<Waveform>(
      'Waveform',
      forcing?.waveform ?? '',
      [
        { value: '', label: '— none: hold the fixed value —' },
        ...WAVEFORMS.map((w) => ({ value: w, label: WAVEFORM_INFO[w].label })),
      ],
      (v) => {
        patch(v ? `Force with ${v}` : 'Remove forcing', 'forcing', (x) => {
          if (v) x.forcing = defaultForcing(v, base, cfg);
          else delete x.forcing;
        });
        this.renderForm(true);
      },
      'waveform'
    );
    const section = el(
      'section',
      { class: 'forcing' },
      el('h3', { text: 'Forcing' }),
      el('p', { class: 'hint', text: summary }),
      waveform
    );
    if (!forcing) return section;
    const info = WAVEFORM_INFO[forcing.waveform];
    const num = (key: keyof Forcing & string, label: string, hint?: string) => {
      const f = this.numberField(
        label,
        forcing[key] as number | undefined,
        (v) =>
          set(label, `forcing.${key}`, (x) => {
            if (v === undefined) delete x[key];
            else (x as unknown as Record<string, number>)[key] = v;
          }),
        { optional: true, name: `forcing_${key}` }
      );
      if (hint) f.title = hint;
      return f;
    };
    section.append(el('p', { class: 'formula', text: info.formula }));
    const fields = info.fields.map((x) => num(x.key, x.label, x.hint));
    for (let i = 0; i < fields.length; i += 2)
      section.append(el('div', { class: 'row2' }, fields[i] ?? null, fields[i + 1] ?? null));
    if (forcing.waveform === 'table') section.append(...this.tableFields(forcing, set));
    section.append(
      el(
        'div',
        { class: 'row2' },
        num('min', 'Clamp below', 'Lower bound, applied after the formula. Blank for none.'),
        num('max', 'Clamp above', 'Upper bound, applied after the formula. Blank for none.')
      ),
      preview
    );
    redraw();
    return section;
  }

  private tableFields(
    f: Forcing,
    set: (label: string, field: string, fn: (x: Forcing) => void) => void
  ): HTMLElement[] {
    const area = el('textarea', { rows: '5', name: 'forcing_table', spellcheck: 'false' });
    area.value = (f.times ?? []).map((t, i) => `${t}, ${f.values?.[i] ?? ''}`).join('\n');
    area.addEventListener('input', () => {
      const rows = area.value
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => l.split(/[\s,;]+/).map(Number));
      if (rows.some((r) => r.length !== 2 || !r.every(Number.isFinite))) {
        area.setAttribute('aria-invalid', 'true');
        return;
      }
      area.removeAttribute('aria-invalid');
      set('Table', 'forcing.table', (x) => {
        x.times = rows.map((r) => r[0] ?? 0);
        x.values = rows.map((r) => r[1] ?? 0);
      });
    });
    return [
      el('label', { class: 'field' }, 'Points: one “t, value” per line, in model time', area),
      el(
        'div',
        { class: 'row2' },
        this.selectField(
          'Between points',
          f.interpolation ?? 'linear',
          [
            { value: 'linear', label: 'Linear' },
            { value: 'step', label: 'Step (hold)' },
          ],
          (v) => v && set('Interpolation', 'forcing.interpolation', (x) => (x.interpolation = v)),
          'forcing_interpolation'
        ),
        this.selectField(
          'Past the ends',
          f.extrapolation ?? 'hold',
          [
            { value: 'hold', label: 'Hold the end value' },
            { value: 'cycle', label: 'Repeat the table' },
          ],
          (v) => v && set('Extrapolation', 'forcing.extrapolation', (x) => (x.extrapolation = v)),
          'forcing_extrapolation'
        )
      ),
    ];
  }

  /** A small chart of the waveform over the run. */
  private drawForcing(
    host: HTMLElement,
    f: Forcing | undefined,
    base: number,
    cfg: StudioModel['config']
  ): void {
    host.replaceChildren();
    if (!f) return;
    const W = 248;
    const H = 72;
    const pad = 4;
    const N = 240;
    const t0 = cfg.t_start;
    const t1 = cfg.t_end > t0 ? cfg.t_end : t0 + 1;
    const ts = Array.from({ length: N + 1 }, (_, i) => t0 + ((t1 - t0) * i) / N);
    // An impulse lasts one step: sample its onset so the spike is drawn at any width.
    if (f.waveform === 'impulse') ts.push(f.t_on ?? t0, (f.t_on ?? t0) + cfg.dt * 0.5);
    ts.sort((a, b) => a - b);
    const vs = ts.map((t) => evaluateForcing(f, t, cfg));
    const jitter = f.waveform === 'jitter';
    const band = jitter ? Math.abs(f.amplitude ?? 0) : 0;
    const finite = vs.filter(Number.isFinite);
    let lo = Math.min(...finite, base) - band;
    let hi = Math.max(...finite, base) + band;
    if (!(hi > lo)) {
      lo -= 1;
      hi += 1;
    }
    const x = (t: number) => pad + ((t - t0) / (t1 - t0)) * (W - 2 * pad);
    const y = (v: number) => H - pad - ((v - lo) / (hi - lo)) * (H - 2 * pad);
    const root = svg('svg', {
      class: 'wave',
      viewBox: `0 0 ${W} ${H}`,
      role: 'img',
      'aria-label': `Preview: ${describeForcing(f)}, from t ${formatNumber(t0)} to ${formatNumber(t1)}`,
    });
    root.append(svg('line', { class: 'ref', x1: pad, x2: W - pad, y1: y(base), y2: y(base) }));
    if (jitter) {
      root.append(
        svg('rect', {
          class: 'band',
          x: pad,
          width: W - 2 * pad,
          y: y((f.mean ?? 0) + band),
          height: Math.max(1, y((f.mean ?? 0) - band) - y((f.mean ?? 0) + band)),
        })
      );
    }
    let d = '';
    ts.forEach((t, i) => {
      const v = vs[i] ?? NaN;
      if (Number.isFinite(v)) d += `${d ? 'L' : 'M'}${x(t).toFixed(1)},${y(v).toFixed(1)}`;
    });
    root.append(svg('path', { class: 'line', d }));
    host.append(
      root,
      el(
        'div',
        { class: 'wave-scale' },
        el('span', { text: `${formatNumber(lo)} – ${formatNumber(hi)}` }),
        el('span', { text: 'dashed: fixed value' })
      )
    );
  }

  private renderChecks(): void {
    const errors = this._issues.filter((i) => i.severity === 'error');
    const warnings = this._issues.filter((i) => i.severity === 'warning');
    const infos = this._issues.filter((i) => i.severity === 'info');
    const list = el('ul', { class: 'issues' });
    if (errors.length === 0 && warnings.length === 0) {
      list.append(
        el('li', { class: 'ok' }, icon('check'), el('span', { text: 'No problems found.' }))
      );
    }
    for (const i of [...errors, ...warnings, ...infos]) {
      const text: Node =
        i.ref && i.ref.kind !== 'config'
          ? (() => {
              const b = el('button', { type: 'button', class: 'link', text: i.message });
              const ref = i.ref;
              b.onclick = () => this.selectRef({ kind: ref.kind as 'node' | 'edge', id: ref.id });
              return b;
            })()
          : el('span', { text: i.message });
      list.append(
        el('li', { class: i.severity }, icon(i.severity === 'info' ? 'info' : 'alert'), text)
      );
    }
    for (const n of this._notes)
      list.append(
        el('li', { class: 'warning' }, icon('alert'), el('span', { text: `Import: ${n}` }))
      );
    this.checks.replaceChildren(
      el('h3', {
        id: 'checks-h',
        text: errors.length ? `Checks · ${errors.length} to fix` : 'Checks',
      }),
      list
    );
  }
}

define('inspector-panel', InspectorPanel);
