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
  toggleSensor,
  type Selection,
} from '../../../model/ops.ts';
import {
  cloneModel,
  EDGE_LOGICS,
  METHODS,
  NODE_TYPES,
  type EdgeLogic,
  type Method,
  type ModelEdge,
  type ModelNode,
  type NodeType,
  type StudioModel,
} from '../../../model/types.ts';
import type { Issue } from '../../../model/validate.ts';
import { symbolIcon } from '../../symbol-icon.ts';
import { el, icon } from '../../ui.ts';
import type { EditDetail } from '../diagram-canvas/diagram-canvas.ts';
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
    this._model = m;
    if (this.form) this.renderForm(!echo);
  }

  set selection(s: Selection) {
    const same =
      (s?.kind ?? '') === (this._selection?.kind ?? '') &&
      (s?.id ?? '') === (this._selection?.id ?? '');
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
    const key = s ? `${s.kind}:${s.id}` : 'model';
    if (!force && key === this.formKey) return;
    this.formKey = key;
    this.form.replaceChildren();
    if (!m) return;
    if (s?.kind === 'node') {
      const n = findNode(m, s.id);
      if (n) return this.nodeForm(m, n);
    } else if (s?.kind === 'edge') {
      const e = findEdge(m, s.id);
      if (e) return this.edgeForm(m, e);
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
        })
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
      )
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
        )
      ),
      el(
        'section',
        {},
        el('h3', { text: 'Values' }),
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
        this.textField(
          'Carrier (optional)',
          n.carrier ?? '',
          (v) => patch('Carrier', 'carrier', (x) => (v ? (x.carrier = v) : delete x.carrier)),
          'carrier'
        ),
        spec.composite
          ? el('p', {
              class: 'hint',
              text: 'A composite: the kernel expands it into members at load, and its chart shows the body.',
            })
          : null
      ),
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
        this.textField(
          'Carrier (optional)',
          e.carrier ?? '',
          (v) => patch('Carrier', 'carrier', (x) => (v ? (x.carrier = v) : delete x.carrier)),
          'carrier'
        ),
        needsControl
          ? el('p', {
              class: 'hint',
              text: 'Or drag from a symbol’s port onto this flow to make it the control.',
            })
          : null,
        sensorField,
        el('div', { class: 'actions' }, reset, del)
      )
    );
  }

  private renderChecks(): void {
    const errors = this._issues.filter((i) => i.severity === 'error');
    const warnings = this._issues.filter((i) => i.severity === 'warning');
    const list = el('ul', { class: 'issues' });
    if (this._issues.length === 0) {
      list.append(
        el('li', { class: 'ok' }, icon('check'), el('span', { text: 'No problems found.' }))
      );
    }
    for (const i of [...errors, ...warnings]) {
      const text: Node =
        i.ref && i.ref.kind !== 'config'
          ? (() => {
              const b = el('button', { type: 'button', class: 'link', text: i.message });
              const ref = i.ref;
              b.onclick = () => this.selectRef({ kind: ref.kind as 'node' | 'edge', id: ref.id });
              return b;
            })()
          : el('span', { text: i.message });
      list.append(el('li', { class: i.severity }, icon('alert'), text));
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
