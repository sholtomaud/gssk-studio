/**
 * <assistant-panel>: the assistant's chat (M12, ADR 0016). Its provider is
 * chosen in Settings (src/app/assistant-state.ts); every call asks first,
 * showing the exact request. Each turn's edits arrive as one card listing its
 * steps, to Apply (one undoable `diagram-edit`) or Discard. The panel never
 * owns the model.
 */
import { BaseComponent, define } from '../../core/base-component.ts';
import { runTurn } from '../../../assistant/conversation.ts';
import { EgressRefused } from '../../../assistant/egress.ts';
import { checkFigures } from '../../../assistant/figures.ts';
import type { Turn } from '../../../assistant/providers.ts';
import type { RunSummary, ToolContext } from '../../../assistant/tools.ts';
import { serialiseModel } from '../../../model/io.ts';
import type { StudioModel } from '../../../model/types.ts';
import { assistantGate, assistantReady, onAssistantChange } from '../../assistant-state.ts';
import { renderMarkdown } from '../../markdown.ts';
import { el, icon, iconButton } from '../../ui.ts';
import type { EditDetail } from '../diagram-canvas/diagram-canvas.ts';
import style from './assistant-panel.css?raw';

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
  private busy = false;
  private readonly history: Turn[] = [];
  private cards: Card[] = [];
  private lastRun: RunSummary | undefined;
  private log!: HTMLElement;
  private using!: HTMLElement;
  private input!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private status!: HTMLElement;
  private stop: (() => void) | null = null;
  /** Runs a model on the kernel through the app's worker; set by the studio. */
  runModel: ((m: StudioModel) => Promise<RunSummary>) | null = null;

  constructor() {
    super('', style);
  }

  set model(m: StudioModel | null) {
    this._model = m;
  }

  override init(): void {
    this.stop ??= onAssistantChange(() => this.renderUsing());
    if (this.log) return;
    this.using = el('p', { class: 'using', role: 'status' });
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
    const settings = el(
      'a',
      {
        class: 'button ghost icon',
        href: 'settings',
        'data-route': '/settings',
        'aria-label': 'Assistant settings',
        title: 'Assistant settings: provider, model and key',
      },
      icon('sliders')
    );
    this.setContent(
      el(
        'header',
        {},
        el('h3', { text: 'Assistant' }),
        el('span', { class: 'spacer' }),
        settings,
        close
      ),
      this.using,
      this.log,
      this.status,
      el('div', { class: 'compose' }, this.input, this.sendBtn)
    );
    this.renderUsing();
    this.log.append(
      el(
        'div',
        { class: 'intro' },
        el('p', {
          text: 'Ask about energy systems diagrams, or have the assistant build or change this model with you. Its changes come as cards to apply or discard; numbers it sets are marked ≈ as its assumptions; results come only from runs.',
        })
      )
    );
  }

  override destroy(): void {
    this.stop?.();
    this.stop = null;
  }

  /** Which provider the chat uses, or what it needs first, with the way to Settings. */
  private renderUsing(): void {
    if (!this.using) return;
    const ready = assistantReady();
    this.using.className = `using${ready.ok ? '' : ' off'}`;
    this.using.replaceChildren(
      ready.ok ? `Using ${ready.label}. ` : `${ready.why} `,
      el('a', { href: 'settings', 'data-route': '/settings', text: 'Settings' })
    );
  }

  // ---- conversation -----------------------------------------------------------

  private async send(): Promise<void> {
    const text = this.input.value.trim();
    const m = this._model;
    if (!text || !m || this.busy) return;
    const ready = assistantReady();
    if (!ready.ok) {
      this.status.textContent = ready.why;
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
      author: { provider: ready.cfg.kind, model: ready.cfg.model },
      ...(this.runModel ? { run: this.runModel } : {}),
      ...(this.lastRun ? { lastRun: this.lastRun } : {}),
    };
    this.input.value = '';
    this.busy = true;
    this.sendBtn.disabled = true;
    this.addMessage('user', text);
    this.status.textContent = 'Thinking…';
    // The reply streams in as plain text, then is drawn as Markdown with its figures checked.
    const bubble = el('div', { class: 'msg assistant streaming' });
    let streamed = '';
    try {
      const out = await runTurn({
        cfg: ready.cfg,
        key: ready.key,
        gate: assistantGate(),
        history: this.history,
        userText: note + text,
        ctx,
        onStep: (name) => (this.status.textContent = `Working: ${name.replace(/_/g, ' ')}…`),
        onText: (piece) => {
          if (!bubble.isConnected) this.log.append(bubble);
          streamed += piece;
          bubble.textContent = streamed;
          this.status.textContent = 'Writing…';
          this.log.scrollTop = this.log.scrollHeight;
        },
      });
      this.lastRun = ctx.lastRun;
      card.draft = ctx.draft;
      if (card.steps.length) this.cards.push(card);
      this.addReply(
        bubble,
        out.text ||
          (out.stop === 'refusal' ? 'The model declined to answer that.' : '(No answer in words.)'),
        // A reply may quote tool results, the message, and the model's inputs, its own marked ones too.
        [...out.toolText, text, serialiseModel(m), serialiseModel(ctx.draft), ...card.steps],
        card.steps.length ? card : undefined
      );
      if (out.stop === 'max_tokens') this.addNote('The answer was cut off at the length limit.');
      if (out.stop === 'rounds') this.addNote('Stopped after many tool calls in one turn.');
    } catch (err) {
      bubble.remove();
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
    }
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
  /** The reply as Markdown, with figures no tool result supports struck through (NFR-HON-002). */
  private addReply(body: HTMLElement, text: string, sources: string[], card?: Card): void {
    let flagged = false;
    const mark = (t: string): Node[] =>
      checkFigures(t, sources).map((p) => {
        if (!p.flagged) return document.createTextNode(p.text);
        flagged = true;
        return el('s', {
          class: 'unsupported',
          text: p.text,
          title:
            'Not from any tool result: the assistant may not state results (NFR-HON-002). Run the model to get the number.',
        });
      });
    body.classList.remove('streaming');
    body.replaceChildren(renderMarkdown(text, mark));
    if (flagged)
      body.append(
        el('p', {
          class: 'hint',
          text: 'Struck-through figures are not from a run or any tool result, so treat them as unchecked.',
        })
      );
    if (!body.isConnected) this.log.append(body);
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
