/**
 * <assistant-panel>: the assistant's chat (M12, ADR 0016). Off until the
 * person turns it on; every call to the provider asks first, showing the
 * exact request (src/assistant/egress.ts). Each turn's edits arrive as one
 * card listing its steps, to Apply (one undoable `diagram-edit`) or Discard.
 * The panel never owns the model.
 */
import { BaseComponent, define } from '../../core/base-component.ts';
import { runTurn } from '../../../assistant/conversation.ts';
import { createGate, EgressRefused, type Consent, type Gate } from '../../../assistant/egress.ts';
import { checkFigures } from '../../../assistant/figures.ts';
import {
  PROVIDERS,
  providerInfo,
  type ProviderConfig,
  type ProviderKind,
  type Turn,
} from '../../../assistant/providers.ts';
import type { RunSummary, ToolContext } from '../../../assistant/tools.ts';
import { serialiseModel } from '../../../model/io.ts';
import type { StudioModel } from '../../../model/types.ts';
import { el, icon, iconButton } from '../../ui.ts';
import type { EditDetail } from '../diagram-canvas/diagram-canvas.ts';
import style from './assistant-panel.css?raw';

const SETTINGS_KEY = 'gssk-studio-assistant';

/** Provider, endpoint and model are remembered in this browser; the key never is. */
function storedConfig(): ProviderConfig {
  const fallback = PROVIDERS[0]!;
  try {
    const raw = JSON.parse(
      localStorage.getItem(SETTINGS_KEY) ?? 'null'
    ) as Partial<ProviderConfig> | null;
    if (raw && PROVIDERS.some((p) => p.kind === raw.kind)) {
      const info = providerInfo(raw.kind as ProviderKind);
      return {
        kind: info.kind,
        endpoint: typeof raw.endpoint === 'string' ? raw.endpoint : info.endpoint,
        model: typeof raw.model === 'string' ? raw.model : info.model,
      };
    }
  } catch {
    // Defaults.
  }
  return { kind: fallback.kind, endpoint: fallback.endpoint, model: fallback.model };
}

/** A turn's proposal: its steps, and the draft they build on the model it began from. */
interface Card {
  base: StudioModel;
  draft: StudioModel;
  steps: string[];
  state: 'pending' | 'applied' | 'discarded' | 'stale';
  /** Draw it again after its state changes. */
  redraw?: () => void;
}

export class AssistantPanel extends BaseComponent {
  private _model: StudioModel | null = null;
  private config = storedConfig();
  /** In memory only, for this page (ADR 0016). */
  private key = '';
  private enabled = false;
  private busy = false;
  private readonly history: Turn[] = [];
  private cards: Card[] = [];
  private lastRun: RunSummary | undefined;
  private gate!: Gate;
  private log!: HTMLElement;
  private settings!: HTMLElement;
  private input!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private status!: HTMLElement;
  private consentDialog!: HTMLDialogElement;
  /** Runs a model on the kernel through the app's worker; set by the studio. */
  runModel: ((m: StudioModel) => Promise<RunSummary>) | null = null;

  constructor() {
    super('', style);
  }

  set model(m: StudioModel | null) {
    this._model = m;
  }

  override init(): void {
    if (this.log) return;
    this.consentDialog = el('dialog', { class: 'consent', 'aria-label': 'Send to the assistant?' });
    this.gate = createGate({ consent: (call) => this.askConsent(call) });
    this.settings = el('section', { class: 'settings' });
    this.log = el('div', { class: 'log', role: 'log', 'aria-live': 'polite' });
    this.status = el('p', { class: 'status', role: 'status' });
    this.input = el('textarea', {
      name: 'assistant-input',
      rows: '3',
      placeholder: 'Ask, or say what to build: “a house that buys water from a utility”',
      'aria-label': 'Message to the assistant',
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void this.send();
      }
    });
    this.sendBtn = el('button', { type: 'button', class: 'primary', text: 'Send' });
    this.sendBtn.onclick = () => void this.send();
    const close = iconButton('x', 'Close the assistant');
    close.onclick = () => this.dispatchEvent(new CustomEvent('assistant-close', { bubbles: true }));
    const gear = iconButton('sliders', 'Assistant settings');
    gear.onclick = () => {
      this.settings.hidden = !this.settings.hidden;
    };
    this.setContent(
      el(
        'header',
        {},
        el('h3', { text: 'Assistant' }),
        el('span', { class: 'spacer' }),
        gear,
        close
      ),
      this.settings,
      this.log,
      this.status,
      el('div', { class: 'compose' }, this.input, this.sendBtn),
      this.consentDialog
    );
    this.renderSettings();
    this.renderLog();
  }

  // ---- settings -------------------------------------------------------------

  private saveConfig(): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.config));
    } catch {
      // Not remembered.
    }
  }

  private renderSettings(): void {
    const info = providerInfo(this.config.kind);
    const provider = el('select', { name: 'assistant-provider' });
    for (const p of PROVIDERS) {
      const o = el('option', { value: p.kind, text: p.label });
      if (p.kind === this.config.kind) o.selected = true;
      provider.append(o);
    }
    provider.onchange = () => {
      const next = providerInfo(provider.value as ProviderKind);
      this.config = { kind: next.kind, endpoint: next.endpoint, model: next.model };
      this.key = '';
      this.enabled = false;
      this.saveConfig();
      this.renderSettings();
      this.renderLog();
    };
    const endpoint = el('input', { name: 'assistant-endpoint', value: this.config.endpoint });
    endpoint.onchange = () => {
      this.config.endpoint = endpoint.value.trim();
      this.saveConfig();
    };
    const model = el('input', {
      name: 'assistant-model',
      value: this.config.model,
      placeholder: 'Model id',
    });
    model.onchange = () => {
      this.config.model = model.value.trim();
      this.saveConfig();
    };
    const key = el('input', {
      type: 'password',
      name: 'assistant-key',
      value: this.key,
      autocomplete: 'off',
      placeholder: 'Held in memory for this page only',
    });
    key.oninput = () => (this.key = key.value.trim());
    const toggle = el(
      'button',
      { type: 'button', class: this.enabled ? '' : 'primary', name: 'assistant-toggle' },
      this.enabled ? 'Turn off' : 'Turn on'
    );
    toggle.onclick = () => {
      if (!this.enabled && !this.config.model) {
        this.status.textContent = 'Name the model first.';
        return;
      }
      if (!this.enabled && info.needsKey && !this.key) {
        this.status.textContent = `${info.label} needs your API key.`;
        return;
      }
      this.enabled = !this.enabled;
      this.status.textContent = '';
      this.settings.hidden = this.enabled;
      this.renderSettings();
      this.renderLog();
    };
    const calls = el(
      'details',
      { class: 'calls' },
      el('summary', { text: `Calls this session (${this.gate.log.length})` }),
      el(
        'ul',
        {},
        ...this.gate.log.map((c) =>
          el('li', {
            class: 'mono',
            text: `${c.at.slice(11, 19)} ${c.provider} ${c.origin} ${c.bytes} B ${c.status} sha256:${c.bodySha256.slice(0, 12)}`,
          })
        )
      )
    );
    this.settings.replaceChildren(
      el('p', {
        class: 'hint',
        text: 'Off until you turn it on. Every call shows you exactly what is sent, and sends nothing unless you agree. Your key is never saved.',
      }),
      el('label', { class: 'field' }, 'Provider', provider),
      el('p', { class: 'hint', text: info.about }),
      el('label', { class: 'field' }, 'Endpoint', endpoint),
      el('label', { class: 'field' }, 'Model', model),
      ...(info.needsKey ? [el('label', { class: 'field' }, 'API key', key)] : []),
      el('div', { class: 'actions' }, toggle),
      calls
    );
  }

  // ---- consent --------------------------------------------------------------

  private askConsent(call: { provider: string; url: string; body: string }): Promise<Consent> {
    return new Promise((resolve) => {
      const d = this.consentDialog;
      const answer = (a: Consent) => () => {
        d.close();
        resolve(a);
      };
      const send = el('button', { type: 'button', class: 'primary', text: 'Send' });
      const always = el('button', { type: 'button', text: 'Send without asking until I reload' });
      const cancel = el('button', { type: 'button', text: 'Don’t send' });
      send.onclick = answer('send');
      always.onclick = answer('send-always');
      cancel.onclick = answer('cancel');
      d.oncancel = () => resolve('cancel');
      d.replaceChildren(
        el('h2', { text: 'Send this to the assistant?' }),
        el('p', {
          class: 'hint',
          text: `To ${call.url}. This is exactly what is sent${providerInfo(this.config.kind).needsKey ? ', with your key in a header' : ''}.`,
        }),
        el('pre', { class: 'payload', tabindex: '0', text: call.body }),
        el('div', { class: 'actions' }, send, always, cancel)
      );
      d.showModal();
      send.focus();
    });
  }

  // ---- conversation -----------------------------------------------------------

  private async send(): Promise<void> {
    const text = this.input.value.trim();
    const m = this._model;
    if (!text || !m || this.busy) return;
    if (!this.enabled) {
      this.settings.hidden = false;
      this.status.textContent = 'Turn the assistant on first.';
      return;
    }
    // Say what became of the last proposal, so the model knows where it stands.
    const prev = this.cards.at(-1);
    let note = '';
    if (prev?.state === 'pending') {
      prev.state = 'discarded';
      prev.redraw?.();
      note = '[The person did not apply your last changes.] ';
    } else if (prev?.state === 'applied') note = '[The person applied your last changes.] ';
    else if (prev?.state === 'discarded') note = '[The person discarded your last changes.] ';
    const card: Card = { base: m, draft: m, steps: [], state: 'pending' };
    const ctx: ToolContext = {
      draft: m,
      steps: card.steps,
      author: { provider: this.config.kind, model: this.config.model },
      ...(this.runModel ? { run: this.runModel } : {}),
      ...(this.lastRun ? { lastRun: this.lastRun } : {}),
    };
    this.input.value = '';
    this.busy = true;
    this.sendBtn.disabled = true;
    this.addMessage('user', text);
    this.status.textContent = 'Thinking…';
    try {
      const out = await runTurn({
        cfg: this.config,
        key: this.key || undefined,
        gate: this.gate,
        history: this.history,
        userText: note + text,
        ctx,
        onStep: (name) => (this.status.textContent = `Working: ${name.replace(/_/g, ' ')}…`),
      });
      this.lastRun = ctx.lastRun;
      card.draft = ctx.draft;
      if (card.steps.length) this.cards.push(card);
      this.addReply(
        out.text ||
          (out.stop === 'refusal' ? 'The model declined to answer that.' : '(No answer in words.)'),
        // A reply may quote tool results, the message, and the model's inputs, its own marked ones too.
        [...out.toolText, text, serialiseModel(m), serialiseModel(ctx.draft), ...card.steps],
        card.steps.length ? card : undefined
      );
      if (out.stop === 'max_tokens') this.addNote('The answer was cut off at the length limit.');
      if (out.stop === 'rounds') this.addNote('Stopped after many tool calls in one turn.');
    } catch (err) {
      // Nothing sent, or the provider failed: drop the unanswered message from the history.
      while (this.history.length && this.history.at(-1)?.role !== 'user') this.history.pop();
      this.history.pop();
      this.addNote(
        err instanceof EgressRefused
          ? err.message
          : `Error: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      this.busy = false;
      this.sendBtn.disabled = false;
      this.status.textContent = '';
      this.renderSettings();
    }
  }

  private renderLog(): void {
    if (this.log.childElementCount === 0) {
      this.log.append(
        el(
          'div',
          { class: 'intro' },
          el('p', {
            text: 'Ask about energy systems diagrams, or have the assistant build or change this model with you. Its changes come as cards to apply or discard; numbers it sets are marked ≈ as its assumptions; results come only from runs.',
          }),
          ...(this.enabled
            ? []
            : [
                el('p', {
                  class: 'hint',
                  text: 'Choose a provider and turn the assistant on to start.',
                }),
              ])
        )
      );
    } else {
      this.log.querySelector('.intro .hint')?.remove();
    }
    this.settings.hidden = this.enabled;
  }

  private addMessage(who: 'user', text: string): void {
    this.log.querySelector('.intro')?.remove();
    this.log.append(el('div', { class: `msg ${who}`, text }));
    this.log.scrollTop = this.log.scrollHeight;
  }

  private addNote(text: string): void {
    this.log.append(el('p', { class: 'note', text }));
    this.log.scrollTop = this.log.scrollHeight;
  }

  /** The reply, with figures no tool result supports struck through (NFR-HON-002). */
  private addReply(text: string, sources: string[], card?: Card): void {
    const parts = checkFigures(text, sources);
    const body = el('div', { class: 'msg assistant' });
    for (const p of parts) {
      if (!p.flagged) body.append(document.createTextNode(p.text));
      else
        body.append(
          el('s', {
            class: 'unsupported',
            text: p.text,
            title:
              'Not from any tool result: the assistant may not state results (NFR-HON-002). Run the model to get the number.',
          })
        );
    }
    if (parts.some((p) => p.flagged))
      body.append(
        el('p', {
          class: 'hint',
          text: 'Struck-through figures are not from a run or any tool result, so treat them as unchecked.',
        })
      );
    this.log.append(body);
    if (card) this.log.append(this.renderCard(card));
    this.log.scrollTop = this.log.scrollHeight;
  }

  private renderCard(card: Card): HTMLElement {
    const box = el('div', { class: 'card', role: 'group', 'aria-label': 'Proposed changes' });
    const draw = () => {
      const apply = el(
        'button',
        { type: 'button', class: 'primary', name: 'apply-card' },
        icon('check'),
        'Apply'
      );
      const discard = el('button', { type: 'button', name: 'discard-card', text: 'Discard' });
      apply.onclick = () => {
        if (this._model !== card.base) {
          card.state = 'stale';
          draw();
          return;
        }
        card.state = 'applied';
        const detail: EditDetail = {
          model: card.draft,
          label: `Assistant: ${card.steps.length} step${card.steps.length === 1 ? '' : 's'}`,
          by: 'assistant',
        };
        this.dispatchEvent(new CustomEvent<EditDetail>('diagram-edit', { detail, bubbles: true }));
        draw();
      };
      discard.onclick = () => {
        card.state = 'discarded';
        draw();
      };
      const state =
        card.state === 'applied'
          ? el('p', { class: 'done', text: 'Applied. Undo takes it back in one step.' })
          : card.state === 'discarded'
            ? el('p', { class: 'done', text: 'Discarded.' })
            : card.state === 'stale'
              ? el('p', {
                  class: 'done warn-text',
                  text: 'The model changed since this was proposed, so it was not applied. Ask again.',
                })
              : el('div', { class: 'actions' }, apply, discard);
      box.replaceChildren(
        el('strong', {
          text: `Proposed: ${card.steps.length} change${card.steps.length === 1 ? '' : 's'}`,
        }),
        el('ol', {}, ...card.steps.map((s) => el('li', { text: s }))),
        state
      );
      box.dataset.state = card.state;
    };
    card.redraw = draw;
    draw();
    return box;
  }
}

define('assistant-panel', AssistantPanel);
