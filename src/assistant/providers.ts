/**
 * LLM providers for the assistant (M12, ADR 0016), as pure functions: build
 * a request (without the key) and parse a reply. One conversation shape maps
 * onto Anthropic's Messages API and onto OpenAI-compatible chat completions,
 * which a local llamafile or llama-server, OpenAI and Gemini all speak. No
 * SDK (ADR 0001): plain fetch, done by the egress gate (egress.ts).
 */
import type { ToolSpec } from './tools.ts';

export type ProviderKind = 'local' | 'openrouter' | 'anthropic' | 'openai' | 'gemini';

export interface ProviderConfig {
  kind: ProviderKind;
  /** Base URL: scheme, host and port. */
  endpoint: string;
  model: string;
}

export interface ProviderInfo {
  kind: ProviderKind;
  label: string;
  endpoint: string;
  /** A default model id, or '' when the person must name one. */
  model: string;
  needsKey: boolean;
  about: string;
}

/** Local first (ADR 0016): nothing leaves the machine and no key is needed. */
export const PROVIDERS: readonly ProviderInfo[] = [
  {
    kind: 'local',
    label: 'Local model (llamafile, llama-server, Ollama)',
    endpoint: 'http://127.0.0.1:8080',
    model: 'local',
    needsKey: false,
    about:
      'An OpenAI-compatible server on this computer. Nothing leaves the machine. Start a llamafile with --server, or llama-server, on port 8080 (Ollama: http://127.0.0.1:11434).',
  },
  {
    kind: 'openrouter',
    label: 'OpenRouter (sign in, no key to copy)',
    endpoint: 'https://openrouter.ai/api',
    model: 'openrouter/auto',
    needsKey: true,
    about:
      'Many models through one account. openrouter/auto may pick a model without tool calls: if the assistant’s tools fail, name one that has them.',
  },
  {
    kind: 'anthropic',
    label: 'Anthropic (Claude)',
    endpoint: 'https://api.anthropic.com',
    model: 'claude-opus-5-5',
    needsKey: true,
    about: 'The Anthropic Messages API, called from this browser with your key.',
  },
  {
    kind: 'openai',
    label: 'OpenAI',
    endpoint: 'https://api.openai.com',
    model: 'gpt-4.1',
    needsKey: true,
    about: 'OpenAI chat completions, called from this browser with your key.',
  },
  {
    kind: 'gemini',
    label: 'Google Gemini',
    endpoint: 'https://generativelanguage.googleapis.com',
    model: 'gemini-3.8-flash',
    needsKey: true,
    about: 'Gemini through its OpenAI-compatible endpoint, with your key.',
  },
];

export function providerInfo(kind: ProviderKind): ProviderInfo {
  return PROVIDERS.find((p) => p.kind === kind) ?? PROVIDERS[0]!;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** A conversation, provider-neutral. */
export type Turn =
  | { role: 'user'; text: string }
  /** `raw` is the provider's own message content, replayed unchanged on the next request. */
  | { role: 'assistant'; text: string; calls: ToolCall[]; raw: unknown }
  | { role: 'tool'; results: { id: string; content: string; isError?: boolean }[] };

export interface HttpRequest {
  url: string;
  /** Headers except authentication, which the egress gate adds. */
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface Reply {
  text: string;
  calls: ToolCall[];
  raw: unknown;
  stop: 'end' | 'tool' | 'max_tokens' | 'refusal' | 'other';
  model: string;
}

const ANTHROPIC_VERSION = '2023-06-01';
/** Server-side refusal fallback, routed by category (fallbacks: "default"). */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const usesFallback = (model: string) => /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model);
const trim = (s: string) => s.replace(/\/+$/, '');

export function authHeaders(cfg: ProviderConfig, key: string): Record<string, string> {
  return cfg.kind === 'anthropic' ? { 'x-api-key': key } : { authorization: `Bearer ${key}` };
}

function anthropicMessages(turns: readonly Turn[]): unknown[] {
  return turns.map((t) => {
    if (t.role === 'user') return { role: 'user', content: t.text };
    if (t.role === 'assistant') return { role: 'assistant', content: t.raw };
    return {
      role: 'user',
      content: t.results.map((r) => ({
        type: 'tool_result',
        tool_use_id: r.id,
        content: r.content,
        ...(r.isError ? { is_error: true } : {}),
      })),
    };
  });
}

function openaiMessages(system: string, turns: readonly Turn[]): unknown[] {
  const out: unknown[] = [{ role: 'system', content: system }];
  for (const t of turns) {
    if (t.role === 'user') out.push({ role: 'user', content: t.text });
    else if (t.role === 'assistant') out.push(t.raw);
    else
      for (const r of t.results) out.push({ role: 'tool', tool_call_id: r.id, content: r.content });
  }
  return out;
}

/** A tool-using chat request. */
export function chatRequest(
  cfg: ProviderConfig,
  opts: {
    system: string;
    turns: readonly Turn[];
    tools: readonly ToolSpec[];
    maxTokens?: number;
    /** Ask for server-sent events, read by `streamReader`. */
    stream?: boolean;
  }
): HttpRequest {
  const maxTokens = opts.maxTokens ?? 16_000;
  if (cfg.kind === 'anthropic') {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': ANTHROPIC_VERSION,
      // The person's own key, called from their own browser.
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    const body: Record<string, unknown> = {
      model: cfg.model,
      max_tokens: maxTokens,
      // Claude Opus 5.5 defaults to medium; say so rather than rely on it.
      output_config: { effort: 'medium' },
      system: opts.system,
      messages: anthropicMessages(opts.turns),
      tools: opts.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
        strict: true,
      })),
      tool_choice: { type: 'auto' },
      ...(opts.stream ? { stream: true } : {}),
    };
    if (usesFallback(cfg.model)) {
      headers['anthropic-beta'] = FALLBACK_BETA;
      body.fallbacks = 'default';
    }
    return { url: `${trim(cfg.endpoint)}/v1/messages`, headers, body };
  }
  const path = cfg.kind === 'gemini' ? '/v1beta/openai/chat/completions' : '/v1/chat/completions';
  return {
    url: `${trim(cfg.endpoint)}${path}`,
    headers: { 'content-type': 'application/json' },
    body: {
      model: cfg.model,
      max_tokens: maxTokens,
      messages: openaiMessages(opts.system, opts.turns),
      tools: opts.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
          strict: true,
        },
      })),
      tool_choice: 'auto',
      ...(opts.stream ? { stream: true } : {}),
    },
  };
}

const parseArgs = (s: unknown): Record<string, unknown> => {
  if (s && typeof s === 'object') return s as Record<string, unknown>;
  if (typeof s !== 'string' || !s.trim()) return {};
  try {
    const v: unknown = JSON.parse(s);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/** Read a provider's reply. Throws on a shape it does not recognise. */
export function parseReply(cfg: ProviderConfig, json: unknown): Reply {
  if (cfg.kind === 'anthropic') {
    const r = json as {
      content?: { type: string; text?: string; id?: string; name?: string; input?: unknown }[];
      stop_reason?: string;
      model?: string;
    };
    if (!Array.isArray(r.content)) throw new Error('The reply had no content.');
    const text = r.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
    const calls = r.content
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ id: b.id ?? '', name: b.name ?? '', input: parseArgs(b.input) }));
    const stop =
      r.stop_reason === 'tool_use'
        ? 'tool'
        : r.stop_reason === 'end_turn' || r.stop_reason === 'stop_sequence'
          ? 'end'
          : r.stop_reason === 'max_tokens'
            ? 'max_tokens'
            : r.stop_reason === 'refusal'
              ? 'refusal'
              : 'other';
    return { text, calls, raw: r.content, stop, model: r.model ?? cfg.model };
  }
  const r = json as {
    choices?: {
      message?: {
        content?: string | null;
        tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[];
      };
      finish_reason?: string;
    }[];
    model?: string;
  };
  const choice = r.choices?.[0];
  const msg = choice?.message;
  if (!msg) throw new Error('The reply had no message.');
  const calls = (msg.tool_calls ?? []).map((c, i) => ({
    id: c.id ?? `call_${i}`,
    name: c.function?.name ?? '',
    input: parseArgs(c.function?.arguments),
  }));
  const f = choice.finish_reason;
  const stop =
    calls.length || f === 'tool_calls'
      ? 'tool'
      : f === 'stop'
        ? 'end'
        : f === 'length'
          ? 'max_tokens'
          : f === 'content_filter'
            ? 'refusal'
            : 'other';
  // Replayed as the provider sent it: Gemini's thinking models put a thought_signature on
  // each tool call (extra_content) and refuse a history without it. Only an id or type a
  // server left out is filled in, so the tool results can name their call.
  const raw = {
    ...(msg as Record<string, unknown>),
    role: 'assistant',
    content: msg.content ?? '',
    ...(msg.tool_calls?.length
      ? {
          tool_calls: msg.tool_calls.map((c, i) => ({
            ...c,
            id: calls[i]!.id,
            type: (c as { type?: string }).type ?? 'function',
          })),
        }
      : {}),
  };
  return { text: msg.content ?? '', calls, raw, stop, model: r.model ?? cfg.model };
}

/**
 * Reads a streamed reply event by event, handing back each piece of text as
 * it arrives, then rebuilds the provider's own message from the pieces, so it
 * replays unchanged: Gemini's thought signatures and Anthropic's thinking
 * blocks with their signatures included. `push` throws on an error event.
 */
export interface StreamReader {
  /** One event's data; returns the text it adds, if any. */
  push(data: string): string;
  /** The whole reply, once the stream has ended. */
  reply(): Reply;
}

export function streamReader(cfg: ProviderConfig): StreamReader {
  return cfg.kind === 'anthropic' ? anthropicStream(cfg) : openaiStream(cfg);
}

type Json = Record<string, unknown>;

function parseEvent(data: string): Json {
  try {
    const v: unknown = JSON.parse(data);
    return v && typeof v === 'object' ? (v as Json) : {};
  } catch {
    return {};
  }
}

function openaiStream(cfg: ProviderConfig): StreamReader {
  let text = '';
  let model = cfg.model;
  let finish: string | undefined;
  const calls: Json[] = [];
  return {
    push(data) {
      const e = parseEvent(data);
      if (e.error)
        throw new Error(`The provider sent an error: ${JSON.stringify(e.error).slice(0, 300)}`);
      if (typeof e.model === 'string') model = e.model;
      const choice = (e.choices as Json[] | undefined)?.[0];
      if (!choice) return '';
      if (typeof choice.finish_reason === 'string') finish = choice.finish_reason;
      const delta = (choice.delta ?? {}) as Json;
      for (const d of (delta.tool_calls as Json[] | undefined) ?? []) {
        const i = typeof d.index === 'number' ? d.index : calls.length;
        const slot = (calls[i] ??= { function: { name: '', arguments: '' } });
        // Everything but the index and the pieces of the function is kept as sent (extra_content).
        for (const [k, v] of Object.entries(d))
          if (k !== 'index' && k !== 'function' && v != null) slot[k] = v;
        const fn = slot.function as { name: string; arguments: string };
        const part = (d.function ?? {}) as { name?: string; arguments?: string };
        if (part.name) fn.name += part.name;
        if (part.arguments) fn.arguments += part.arguments;
      }
      const piece = typeof delta.content === 'string' ? delta.content : '';
      text += piece;
      return piece;
    },
    reply() {
      const message: Json = { role: 'assistant', content: text || null };
      if (calls.length) message.tool_calls = calls.filter(Boolean);
      return parseReply(cfg, { model, choices: [{ message, finish_reason: finish }] });
    },
  };
}

function anthropicStream(cfg: ProviderConfig): StreamReader {
  const blocks: Json[] = [];
  const partialJson: string[] = [];
  let stop: string | undefined;
  let model = cfg.model;
  return {
    push(data) {
      const e = parseEvent(data);
      switch (e.type) {
        case 'error':
          throw new Error(`The provider sent an error: ${JSON.stringify(e.error).slice(0, 300)}`);
        case 'message_start': {
          const m = (e.message ?? {}) as Json;
          if (typeof m.model === 'string') model = m.model;
          return '';
        }
        case 'content_block_start': {
          const i = e.index as number;
          blocks[i] = { ...((e.content_block ?? {}) as Json) };
          partialJson[i] = '';
          return '';
        }
        case 'content_block_delta': {
          const i = e.index as number;
          const b = (blocks[i] ??= {});
          const d = (e.delta ?? {}) as Json;
          if (d.type === 'text_delta' && typeof d.text === 'string') {
            b.text = `${(b.text as string | undefined) ?? ''}${d.text}`;
            return d.text;
          }
          if (d.type === 'input_json_delta' && typeof d.partial_json === 'string')
            partialJson[i] = (partialJson[i] ?? '') + d.partial_json;
          else if (d.type === 'thinking_delta' && typeof d.thinking === 'string')
            b.thinking = `${(b.thinking as string | undefined) ?? ''}${d.thinking}`;
          else if (d.type === 'signature_delta' && typeof d.signature === 'string')
            b.signature = `${(b.signature as string | undefined) ?? ''}${d.signature}`;
          return '';
        }
        case 'content_block_stop': {
          const i = e.index as number;
          const b = blocks[i];
          if (b?.type === 'tool_use' && partialJson[i]) {
            try {
              b.input = JSON.parse(partialJson[i]!);
            } catch {
              b.input = {};
            }
          }
          return '';
        }
        case 'message_delta': {
          const d = (e.delta ?? {}) as Json;
          if (typeof d.stop_reason === 'string') stop = d.stop_reason;
          return '';
        }
        default:
          return '';
      }
    },
    reply() {
      return parseReply(cfg, { content: blocks.filter(Boolean), stop_reason: stop, model });
    },
  };
}
