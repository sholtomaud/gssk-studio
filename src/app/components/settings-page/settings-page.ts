/**
 * <settings-page>: the assistant's provider (ADR 0016), after budget-app's
 * Settings: provider, endpoint and model, a key held for this session only,
 * Sign in with OpenRouter, and the log of every call made.
 */
import { BaseComponent, define } from '../../core/base-component.ts';
import { PROVIDERS, providerInfo, type ProviderKind } from '../../../assistant/providers.ts';
import {
  assistantGate,
  assistantSettings,
  chooseProvider,
  keyFor,
  onAssistantChange,
  saveAssistantSettings,
  setKey,
} from '../../assistant-state.ts';
import { finishSignIn, pendingSignIn, startSignIn } from '../../openrouter.ts';
import { el } from '../../ui.ts';
import template from './settings-page.html?raw';
import style from './settings-page.css?raw';

export class SettingsPage extends BaseComponent {
  private stop: (() => void) | null = null;

  constructor() {
    super(template, style);
  }

  override init(): void {
    const select = this.$<HTMLSelectElement>('select[name="active"]');
    if (select.options.length === 1)
      for (const p of PROVIDERS) select.append(el('option', { value: p.kind, text: p.label }));
    select.onchange = () => {
      chooseProvider((select.value || null) as ProviderKind | null);
      this.say('');
    };
    const endpoint = this.$<HTMLInputElement>('input[name="endpoint"]');
    const model = this.$<HTMLInputElement>('input[name="model"]');
    endpoint.onchange = () =>
      saveAssistantSettings({ ...assistantSettings(), endpoint: endpoint.value.trim() });
    model.onchange = () =>
      saveAssistantSettings({ ...assistantSettings(), model: model.value.trim() });
    const key = this.$<HTMLInputElement>('input[name="key"]');
    key.onchange = () => {
      const kind = assistantSettings().active;
      if (kind) setKey(kind, key.value);
      this.say(key.value.trim() ? 'Key held for this session.' : '', 'good');
    };
    this.$<HTMLButtonElement>('.forget-key').onclick = () => {
      const kind = assistantSettings().active;
      if (kind) setKey(kind, '');
      this.say('Key forgotten.');
    };
    this.$<HTMLButtonElement>('.openrouter-signin').onclick = () =>
      void startSignIn().catch((err: unknown) =>
        this.say(
          `Could not start signing in: ${err instanceof Error ? err.message : String(err)}`,
          'bad'
        )
      );
    this.stop = onAssistantChange(() => this.render());
    this.render();
    const pending = pendingSignIn();
    if (pending) {
      this.say('Finishing signing in with OpenRouter…');
      finishSignIn(pending)
        .then(() =>
          this.say(
            'Signed in with OpenRouter. The assistant can use it until the page reloads.',
            'good'
          )
        )
        .catch((err: unknown) =>
          this.say(
            `Signing in did not finish: ${err instanceof Error ? err.message : String(err)}`,
            'bad'
          )
        )
        .finally(() => this.renderLog());
    }
  }

  override destroy(): void {
    this.stop?.();
    this.stop = null;
  }

  private say(text: string, kind: 'good' | 'bad' | '' = ''): void {
    const msg = this.$('.msg');
    msg.textContent = text;
    msg.className = `msg ${kind}`;
  }

  private render(): void {
    const s = assistantSettings();
    const info = s.active ? providerInfo(s.active) : null;
    this.$<HTMLSelectElement>('select[name="active"]').value = s.active ?? '';
    this.$<HTMLInputElement>('input[name="endpoint"]').value = s.endpoint;
    this.$<HTMLInputElement>('input[name="model"]').value = s.model;
    const key = this.$<HTMLInputElement>('input[name="key"]');
    key.value = s.active ? (keyFor(s.active) ?? '') : '';
    this.$('.about').textContent = info?.about ?? 'The assistant is off.';
    for (const d of this.querySelectorAll<HTMLElement>('.detail')) d.hidden = !info;
    this.$('.openrouter').hidden = s.active !== 'openrouter';
    const needsKey = !!info?.needsKey;
    this.$('.key-row').hidden = !needsKey;
    this.$('.key-note').hidden = !needsKey;
    this.renderLog();
  }

  private renderLog(): void {
    const log = assistantGate().log;
    this.$('table.calls tbody').replaceChildren(
      ...(log.length
        ? [...log]
            .reverse()
            .map((c) =>
              el(
                'tr',
                {},
                el('td', { text: new Date(c.at).toLocaleTimeString() }),
                el('td', { text: providerInfo(c.provider as ProviderKind).label }),
                el('td', { text: c.purpose }),
                el('td', { class: 'num', text: String(c.bytes) }),
                el('td', { text: String(c.status) }),
                el('td', {}, el('code', { text: c.bodySha256.slice(0, 16) }))
              )
            )
        : [el('tr', {}, el('td', { colspan: '6', text: 'None yet.' }))])
    );
    this.$('details.log summary').textContent = `Calls made this session (${log.length})`;
  }
}

define('settings-page', SettingsPage);
