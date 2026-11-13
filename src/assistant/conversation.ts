/**
 * One turn of the assistant (M12, ADR 0016): send the conversation, run the
 * tools it asks for on the turn's draft, send their results back, until it
 * answers in words. DOM-free; the chat panel supplies the gate and the run.
 */
import { STREAMED, type Gate } from './egress.ts';
import {
  chatRequest,
  parseReply,
  streamReader,
  type ProviderConfig,
  type Turn,
} from './providers.ts';
import { callTool, modelBrief, symbolCatalogue, TOOLS, type ToolContext } from './tools.ts';
import type { StudioModel } from '../model/types.ts';

/** Tool rounds in one turn before the assistant must stop and answer. */
export const MAX_ROUNDS = 12;

export const SYSTEM_PROMPT = `You are the assistant in GSSK Studio, a browser app for drawing H.T. Odum's energy systems diagrams and running them on the GSSK simulation kernel. You help people build valid models of their own systems, and learn the language as they go.

Each message from the person starts with a short summary of their model as it is now. Answer about that model.

How to answer:
- Be brief and specific: a few sentences, or a short list. Name the symbols you mean by their labels. Use Markdown sparingly: bold for a term, a short list for steps.
- When the person asks for a change, or asks whether something should be done and the answer is yes, make it with your tools in the same turn rather than only describing it. Then say in a sentence or two what you did and why. Your edits reach their model only as a card they apply, so acting is safe.
- Keep each turn to a few related changes. Read the checks each tool returns and fix what they report: the app's checks, not your own guesses, say what is valid.
- Declare a carrier before using it: money by its ISO 4217 currency, physical things by a UCUM unit (kL, kW.h, kg).

Odum's energy systems language:
- The app has a reference on it, odum_reference: each symbol (what it means, how to draw it here, common mistakes) and each convention (losses, money, materials, information, layout, flow logics, how to build a model). Read the entry before explaining a symbol or convention, or when unsure how to draw something, and answer from it rather than from memory.
- The rules that matter most: every storage of energy or materials has a loss to a heat sink (add_loss); money circulates against what it buys and never goes to a heat sink; producers and consumers have their heat sink built in.

Numbers:
- You never produce a result. Levels, flows, prices and any outcome come only from run_model, quoted with the run id it returns.
- You may set inputs (initial values, capacities, rates k) when the person has none. Each one is shown to them as your assumption, so give a short reason in "why".
- When the model has observations, fit its rates to them with calibrate rather than guessing; report a fit only with the figures calibrate returns.
- For a whole new structure, or many changes at once, you may write an Energese script with propose_energese instead of many small edits.
- State no other figure as fact.

Symbols you can add:
${symbolCatalogue()}`;

export interface TurnOutcome {
  /** The assistant's words in this turn, every round's, in order. */
  text: string;
  /** Why it stopped: answered, ran out of rounds, refused, or hit the output limit. */
  stop: 'end' | 'rounds' | 'refusal' | 'max_tokens' | 'other';
  /** Every tool result of the turn, as sent back: the figures a reply may quote. */
  toolText: string[];
  model: string;
}

/**
 * Run one turn. `history` is appended to in place (the person's message, each
 * assistant message and each tool result), so the next turn replays it
 * unchanged. Edits land on `ctx.draft` and `ctx.steps`.
 */
export async function runTurn(opts: {
  cfg: ProviderConfig;
  key: string | undefined;
  gate: Gate;
  history: Turn[];
  userText: string;
  ctx: ToolContext;
  onStep?: (text: string) => void;
  /** After each tool call that changed the draft: the draft as it now stands, to draw live. */
  onDraft?: (draft: StudioModel) => void;
  /** Ask for a streamed reply and hand on its text as it arrives. */
  onText?: (piece: string) => void;
}): Promise<TurnOutcome> {
  const { cfg, key, gate, history, ctx } = opts;
  // The model as it is, so the reply is about it; the person's words follow.
  history.push({
    role: 'user',
    text: `[The model now]\n${modelBrief(ctx.draft)}\n\n${opts.userText}`,
  });
  const toolText: string[] = [];
  const said: string[] = [];
  let model = cfg.model;
  const stream = !!opts.onText;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const req = chatRequest(cfg, { system: SYSTEM_PROMPT, turns: history, tools: TOOLS, stream });
    const reader = streamReader(cfg);
    let first = true;
    const got = await gate.send(cfg, key, req, undefined, (data) => {
      const piece = reader.push(data);
      if (!piece) return;
      // A new round's words start a new paragraph after the last round's.
      if (first && said.length) opts.onText?.('\n\n');
      first = false;
      opts.onText?.(piece);
    });
    const reply = got === STREAMED ? reader.reply() : parseReply(cfg, got);
    // A server that ignored the request to stream: show its words now.
    if (got !== STREAMED && reply.text) {
      if (said.length) opts.onText?.('\n\n');
      opts.onText?.(reply.text);
    }
    if (reply.text.trim()) said.push(reply.text.trim());
    model = reply.model;
    history.push({ role: 'assistant', text: reply.text, calls: reply.calls, raw: reply.raw });
    const text = said.join('\n\n');
    if (reply.stop === 'refusal') return { text, stop: 'refusal', toolText, model };
    if (reply.calls.length === 0) {
      const stop = reply.stop === 'tool' ? 'other' : reply.stop;
      return { text, stop, toolText, model };
    }
    // Every call's result goes back in one message, failed ones marked.
    const results: { id: string; content: string; isError?: boolean }[] = [];
    for (const call of reply.calls) {
      opts.onStep?.(call.name);
      const was = ctx.draft;
      const r = await callTool(ctx, call.name, call.input);
      if (ctx.draft !== was) opts.onDraft?.(ctx.draft);
      const content = JSON.stringify(r.result);
      toolText.push(content);
      results.push({ id: call.id, content, ...(r.ok ? {} : { isError: true }) });
    }
    history.push({ role: 'tool', results });
  }
  return {
    text: [
      ...said,
      'I stopped after many steps without finishing. Apply or discard what I did, then ask me to continue.',
    ].join('\n\n'),
    stop: 'rounds',
    toolText,
    model,
  };
}
