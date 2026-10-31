/**
 * One turn of the assistant (M12, ADR 0016): send the conversation, run the
 * tools it asks for on the turn's draft, send their results back, until it
 * answers in words. DOM-free; the chat panel supplies the gate and the run.
 */
import type { Gate } from './egress.ts';
import { chatRequest, parseReply, type ProviderConfig, type Turn } from './providers.ts';
import { callTool, symbolCatalogue, TOOLS, type ToolContext } from './tools.ts';

/** Tool rounds in one turn before the assistant must stop and answer. */
export const MAX_ROUNDS = 12;

export const SYSTEM_PROMPT = `You are the assistant in GSSK Studio, a browser app for drawing and running H.T. Odum's energy systems diagrams on the GSSK simulation kernel. You help people build valid models and learn how: what each symbol means, how flows and their logics work, how money runs against what it buys (Odum's transactions), and how to pack symbols into groups.

How you work:
- You change the model only through your tools. Your edits build up a draft; the person sees them as one card listing each step and chooses Apply or Discard. Say what you changed and why, in plain words.
- Prefer small steps: a few symbols and flows per turn, then let the person apply them and ask for more.
- Use describe_model before changing a model you have not seen this turn. Ids come from labels.
- After each edit, read the checks the tool returns and fix what they report. The checks, not your own guesses, say what is valid.
- Declare carriers before using them: money by its ISO 4217 currency, physical things by a UCUM unit.

Numbers:
- You never produce a result. Levels, flows, prices and any outcome come only from run_model, and you quote them with the run id it returns.
- You may set inputs (initial values, capacities, rates k) when the person has none. Each one you set is shown to them as your assumption, not data, so give a short reason in "why".
- Do not state any other figure as fact.

Symbols you can add:
${symbolCatalogue()}`;

export interface TurnOutcome {
  /** The assistant's final words. */
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
}): Promise<TurnOutcome> {
  const { cfg, key, gate, history, ctx } = opts;
  history.push({ role: 'user', text: opts.userText });
  const toolText: string[] = [];
  let model = cfg.model;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const json = await gate.send(
      cfg,
      key,
      chatRequest(cfg, { system: SYSTEM_PROMPT, turns: history, tools: TOOLS })
    );
    const reply = parseReply(cfg, json);
    model = reply.model;
    history.push({ role: 'assistant', text: reply.text, calls: reply.calls, raw: reply.raw });
    if (reply.stop === 'refusal') return { text: reply.text, stop: 'refusal', toolText, model };
    if (reply.calls.length === 0) {
      const stop = reply.stop === 'tool' ? 'other' : reply.stop;
      return { text: reply.text, stop, toolText, model };
    }
    // Every call's result goes back in one message, failed ones marked.
    const results: { id: string; content: string; isError?: boolean }[] = [];
    for (const call of reply.calls) {
      opts.onStep?.(call.name);
      const r = await callTool(ctx, call.name, call.input);
      const content = JSON.stringify(r.result);
      toolText.push(content);
      results.push({ id: call.id, content, ...(r.ok ? {} : { isError: true }) });
    }
    history.push({ role: 'tool', results });
  }
  return {
    text: 'I stopped after many steps without finishing. Apply or discard what I did, then ask me to continue.',
    stop: 'rounds',
    toolText,
    model,
  };
}
