/**
 * <calibrate-dialog>: fit flow rates to the observations (FR-CAL-001). The
 * user picks rates, the sim worker runs Levenberg–Marquardt on the kernel
 * (ADR 0008), and the result is shown before anything changes: Apply makes
 * it one undoable edit, Discard leaves the model as it was.
 */
import { BaseComponent, define } from '../../core/base-component.ts';
import type { CalibrationResult } from '../../../fit/calibrate.ts';
import type { StudioModel } from '../../../model/types.ts';
import { simWorker } from '../../sim-client.ts';
import { el, formatNumber, icon, iconButton } from '../../ui.ts';
import style from './calibrate-dialog.css?raw';

const STOP: Record<string, string> = {
  converged: 'Converged: further steps no longer lower the misfit.',
  'max-iterations': 'Stopped at the iteration limit; more iterations may improve the fit.',
  'no-progress':
    'Stopped: no step lowered the misfit. The rates may already be at a (local) optimum.',
};

export class CalibrateDialog extends BaseComponent {
  private dialog!: HTMLDialogElement;
  private body!: HTMLElement;
  private model: StudioModel | null = null;
  private token = 0;
  private cancelled = false;
  /** Called with the calibrated model when the user applies it. */
  onApply: ((model: StudioModel) => void) | null = null;

  constructor() {
    super('', style);
  }

  override init(): void {
    if (this.dialog) return;
    this.body = el('div', { class: 'wrap' });
    this.dialog = el('dialog', { 'aria-label': 'Calibrate rates' }, this.body);
    this.dialog.addEventListener('close', () => void this.stop());
    this.append(this.dialog);
  }

  open(model: StudioModel): void {
    this.model = model;
    this.choose();
    this.dialog.showModal();
  }

  private header(title: string): HTMLElement {
    const close = iconButton('x', 'Close');
    close.onclick = () => this.dialog.close();
    return el('header', {}, el('h2', { text: title }), close);
  }

  private async stop(): Promise<void> {
    this.cancelled = true;
    if (this.token) await simWorker().calibrateCancel(this.token);
    this.token = 0;
  }

  /** Step 1: which rates to tune. */
  private choose(): void {
    const m = this.model;
    if (!m) return;
    const targets = new Set(
      (m._observations ?? []).flatMap((o) => (o.target ? [o.target.replace(/^flow:/, '')] : []))
    );
    const boxes = m.edges
      .filter((e) => e.params.k > 0)
      .map((e) => {
        const box = el('input', { type: 'checkbox', name: 'rate', value: e.id });
        // Pre-select rates on flows into or out of an observed symbol.
        box.checked = targets.has(e.origin) || targets.has(e.target) || targets.has(e.id);
        return el(
          'label',
          {},
          box,
          el('span', { text: `${e.id} (${e.origin} → ${e.target})` }),
          el('span', { class: 'k', text: `k = ${formatNumber(e.params.k)}` })
        );
      });
    const iters = el('input', {
      type: 'number',
      min: '1',
      max: '500',
      value: '40',
      name: 'iterations',
    });
    const start = el('button', { type: 'button', class: 'primary' }, icon('play'), 'Calibrate');
    const compared = (m._observations ?? []).filter((o) => o.target).length;
    start.onclick = () => {
      const ids = [
        ...this.body.querySelectorAll<HTMLInputElement>('input[name="rate"]:checked'),
      ].map((b) => b.value);
      void this.calibrate(ids, Math.max(1, Math.min(500, Number(iters.value) || 40)));
    };
    this.body.replaceChildren(
      this.header('Calibrate rates'),
      el('p', {
        class: 'lede',
        text: `Adjusts the chosen rates k to minimise the misfit to ${compared} compared observation series. Each step is a set of real runs on the GSSK kernel.`,
      }),
      boxes.length
        ? el('div', { class: 'rates', role: 'group', 'aria-label': 'Rates to calibrate' }, ...boxes)
        : el('p', { class: 'note', text: 'No flow has a positive rate to calibrate.' }),
      el(
        'div',
        { class: 'row' },
        el('label', { class: 'field' }, 'Max iterations', iters),
        el('span', { class: 'spacer' }),
        start
      ),
      el('p', {
        class: 'note',
        text: 'Fewer rates calibrate faster and more reliably. Rates stay positive (fitted on a log scale). Nothing changes until you apply the result.',
      })
    );
  }

  /** Step 2: run it, with progress and Cancel. */
  private async calibrate(edgeIds: string[], maxIterations: number): Promise<void> {
    const m = this.model;
    if (!m) return;
    const bar = el('progress', {
      max: String(maxIterations),
      value: '0',
      'aria-label': 'Calibration progress',
    });
    const status = el('p', { class: 'lede', role: 'status', text: 'Starting…' });
    const cancel = el('button', { type: 'button' }, icon('x'), 'Cancel');
    cancel.onclick = () => {
      this.cancelled = true;
    };
    this.body.replaceChildren(
      this.header('Calibrating…'),
      bar,
      status,
      el('div', { class: 'row' }, el('span', { class: 'spacer' }), cancel)
    );
    const w = simWorker();
    this.cancelled = false;
    try {
      this.token = await w.calibrateBegin(m, edgeIds, maxIterations);
      for (;;) {
        if (this.cancelled) {
          await this.stop();
          this.choose();
          return;
        }
        const p = await w.calibrateAdvance(this.token, 150);
        bar.value = p.iteration;
        status.textContent = `Iteration ${p.iteration} of up to ${p.maxIterations} · misfit ${formatNumber(p.sse)}`;
        if (p.done) break;
      }
      const result = await w.calibrateFinish(this.token);
      this.token = 0;
      this.show(result);
    } catch (err) {
      this.token = 0;
      this.body.replaceChildren(
        this.header('Calibration failed'),
        el('p', {
          class: 'lede',
          role: 'alert',
          text: err instanceof Error ? err.message : String(err),
        }),
        el(
          'div',
          { class: 'row' },
          el('span', { class: 'spacer' }),
          Object.assign(el('button', { type: 'button', text: 'Back' }), {
            onclick: () => this.choose(),
          })
        )
      );
    }
  }

  /** Step 3: before and after; apply or discard. */
  private show(r: CalibrationResult): void {
    const rateRows = r.rates.map((x) =>
      el(
        'tr',
        { 'data-rate': x.edgeId },
        el('td', { text: x.edgeId }),
        el('td', { text: formatNumber(x.before) }),
        el('td', { text: formatNumber(x.after) }),
        el('td', { text: x.se === null ? '—' : `± ${formatNumber(x.se)}` }),
        x.informed
          ? el('td', { text: '' })
          : el('td', { class: 'flag', text: 'not informed by the data: unchanged' })
      )
    );
    const fitRows = r.fits.map((f) =>
      el(
        'tr',
        {},
        el('td', { text: f.name }),
        el('td', { text: formatNumber(f.before.nse) }),
        el('td', { text: formatNumber(f.after.nse) }),
        el('td', { text: formatNumber(f.before.rmse) }),
        el('td', { text: formatNumber(f.after.rmse) })
      )
    );
    const apply = el('button', { type: 'button', class: 'primary' }, icon('check'), 'Apply rates');
    apply.onclick = () => {
      this.onApply?.(r.model);
      this.dialog.close();
    };
    const discard = el('button', { type: 'button', text: 'Discard' });
    discard.onclick = () => this.dialog.close();
    const th = (...h: string[]) => el('tr', {}, ...h.map((t) => el('th', { text: t })));
    this.body.replaceChildren(
      this.header('Calibration result'),
      el('p', {
        class: 'lede',
        role: 'status',
        text: `${STOP[r.stop] ?? r.stop} ${r.iterations} iterations, ${r.runs} kernel runs. Scaled misfit ${formatNumber(r.sseBefore)} → ${formatNumber(r.sseAfter)}.`,
      }),
      el(
        'table',
        { class: 'rates-result' },
        el('thead', {}, th('Rate', 'Before', 'After', 'Std. error', '')),
        el('tbody', {}, ...rateRows)
      ),
      el(
        'table',
        { class: 'fits-result' },
        el('thead', {}, th('Observed', 'NSE before', 'NSE after', 'RMSE before', 'RMSE after')),
        el('tbody', {}, ...fitRows)
      ),
      el('p', {
        class: 'note',
        text: 'Standard errors are linearised at the optimum (σ²(JᵀJ)⁻¹, on the log-rate scale) and assume independent errors; read them as indicative. A dash means they cannot be estimated: too few observations, or a rate the data do not inform.',
      }),
      el('div', { class: 'row' }, el('span', { class: 'spacer' }), discard, apply)
    );
  }
}

define('calibrate-dialog', CalibrateDialog);
