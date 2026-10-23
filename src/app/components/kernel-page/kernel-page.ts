import { BaseComponent, define } from '../../core/base-component.ts';
import { CATALOGUE } from '../../../model/catalogue.ts';
import { EXAMPLES } from '../../../model/examples/index.ts';
import { simWorker } from '../../sim-client.ts';
import { symbolIcon } from '../../symbol-icon.ts';
import { el, icon } from '../../ui.ts';
import template from './kernel-page.html?raw';
import style from './kernel-page.css?raw';

export class KernelPage extends BaseComponent {
  constructor() {
    super(template, style);
  }

  override init(): void {
    const status = this.$('.k-status');
    simWorker()
      .kernelInfo()
      .then((k) => {
        status.textContent = 'Verified: SHA-256 matches the pin';
        status.dataset.ok = 'true';
        this.$('.k-version').textContent = k.version;
        this.$('.k-source').textContent =
          `${k.pin.repo} @ ${k.pin.branch} ${k.pin.commit.slice(0, 12)}`;
        this.$('.k-sha').textContent = k.sha256;
      })
      .catch((err: unknown) => {
        status.textContent = `Refused: ${err instanceof Error ? err.message : String(err)}`;
        status.dataset.ok = 'false';
      });

    const run = this.$<HTMLButtonElement>('.run');
    run.onclick = () => void this.selfTest(run);

    this.$('.types tbody').replaceChildren(
      ...CATALOGUE.map((s) =>
        el(
          'tr',
          {},
          el('td', {}, symbolIcon(s.type), s.label),
          el('td', {}, el('code', { text: s.type })),
          el('td', { text: s.holdsState ? (s.composite ? 'yes (composite)' : 'yes') : 'no' }),
          el('td', { text: s.summary })
        )
      )
    );
  }

  private async selfTest(button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    const table = this.$<HTMLTableElement>('.result');
    const body = this.$('.result tbody');
    body.replaceChildren();
    table.hidden = false;
    let ok = 0;
    for (const ex of EXAMPLES) {
      try {
        const r = await simWorker().run(ex.model);
        ok++;
        body.append(
          el(
            'tr',
            { 'data-example': ex.id },
            el('td', { text: ex.title }),
            el('td', { class: 'num', text: r.manifest.steps.toLocaleString('en') }),
            el('td', { class: 'num', text: `${r.elapsedMs.toFixed(0)} ms` }),
            el(
              'td',
              {},
              r.diagnostics.solverConfident
                ? el('span', { class: 'badge good' }, icon('check'), 'OK')
                : el('span', { class: 'badge warning' }, icon('alert'), 'diverged')
            ),
            el('td', {}, el('code', { text: r.manifest.modelHash.slice(0, 16) }))
          )
        );
      } catch (err) {
        body.append(
          el(
            'tr',
            {},
            el('td', { text: ex.title }),
            el(
              'td',
              { colspan: '4' },
              el('span', { class: 'badge critical' }, icon('alert'), String(err))
            )
          )
        );
      }
    }
    table.dataset.ready = 'true';
    table.dataset.passed = String(ok === EXAMPLES.length);
    button.disabled = false;
  }
}

define('kernel-page', KernelPage);
