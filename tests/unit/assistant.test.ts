import { describe, expect, it } from 'vitest';
import { runTurn, SYSTEM_PROMPT } from '../../src/assistant/conversation.ts';
import {
  createGate,
  EgressRefused,
  isAllowedUrl,
  type Consent,
} from '../../src/assistant/egress.ts';
import { checkFigures } from '../../src/assistant/figures.ts';
import {
  chatRequest,
  parseReply,
  type ProviderConfig,
  type Turn,
} from '../../src/assistant/providers.ts';
import { TOOLS, type ToolContext } from '../../src/assistant/tools.ts';
import { assumedCount } from '../../src/model/provenance.ts';
import { emptyModel } from '../../src/model/types.ts';

const local: ProviderConfig = { kind: 'local', endpoint: 'http://127.0.0.1:8080', model: 'local' };
const claude: ProviderConfig = {
  kind: 'anthropic',
  endpoint: 'https://api.anthropic.com',
  model: 'claude-opus-5-5',
};
const turns: Turn[] = [{ role: 'user', text: 'Hi' }];

/** A fetch that answers with the given JSON bodies in order, recording each request. */
function scripted(replies: unknown[]) {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    const body = replies.shift();
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, seen };
}

const openaiCall = (name: string, args: unknown, id = 'c1') => ({
  model: 'local',
  choices: [
    {
      message: {
        content: null,
        tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
      },
      finish_reason: 'tool_calls',
    },
  ],
});
const openaiText = (text: string) => ({
  model: 'local',
  choices: [{ message: { content: text }, finish_reason: 'stop' }],
});

describe('providers (ADR 0016)', () => {
  it('asks Claude with strict tools, auto tool choice, explicit effort and refusal fallbacks', () => {
    const r = chatRequest(claude, { system: 'S', turns, tools: TOOLS });
    expect(r.url).toBe('https://api.anthropic.com/v1/messages');
    expect(r.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(r.headers['anthropic-beta']).toBe('server-side-fallback-2026-07-01');
    expect(r.body).toMatchObject({
      model: 'claude-opus-5-5',
      tool_choice: { type: 'auto' },
      fallbacks: 'default',
      output_config: { effort: 'medium' },
    });
    expect((r.body.tools as { strict: boolean }[]).every((t) => t.strict)).toBe(true);
    expect(r.headers['x-api-key']).toBeUndefined();
  });

  it('asks an OpenAI-compatible server (a local llamafile) with function tools', () => {
    const r = chatRequest(local, { system: 'S', turns, tools: TOOLS });
    expect(r.url).toBe('http://127.0.0.1:8080/v1/chat/completions');
    expect((r.body.messages as { role: string }[])[0]).toEqual({ role: 'system', content: 'S' });
    expect((r.body.tools as { type: string }[])[0]?.type).toBe('function');
    const g = chatRequest(
      { kind: 'gemini', endpoint: 'https://generativelanguage.googleapis.com', model: 'm' },
      { system: 'S', turns, tools: [] }
    );
    expect(g.url).toMatch(/\/v1beta\/openai\/chat\/completions$/);
  });

  it('reads tool calls and stop reasons from both kinds of reply', () => {
    const a = parseReply(claude, {
      model: 'claude-opus-5-5',
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'Adding a tank.' },
        { type: 'tool_use', id: 't1', name: 'add_symbol', input: { type: 'storage' } },
      ],
    });
    expect(a).toMatchObject({
      text: 'Adding a tank.',
      stop: 'tool',
      calls: [{ id: 't1', name: 'add_symbol', input: { type: 'storage' } }],
    });
    expect(parseReply(claude, { content: [], stop_reason: 'refusal' }).stop).toBe('refusal');
    const o = parseReply(local, openaiCall('describe_model', {}));
    expect(o.calls).toEqual([{ id: 'c1', name: 'describe_model', input: {} }]);
    expect(parseReply(local, openaiText('Done.')).stop).toBe('end');
  });

  it('replays a tool call exactly as sent, keeping Gemini’s thought signature', () => {
    const gemini: ProviderConfig = {
      kind: 'gemini',
      endpoint: 'https://generativelanguage.googleapis.com',
      model: 'gemini-test',
    };
    const call = {
      id: 'g1',
      type: 'function',
      function: { name: 'describe_model', arguments: '{}' },
      extra_content: { google: { thought_signature: 'sig==' } },
    };
    const reply = parseReply(gemini, {
      choices: [
        {
          message: { role: 'assistant', content: null, tool_calls: [call] },
          finish_reason: 'tool_calls',
        },
      ],
    });
    const next = chatRequest(gemini, {
      system: 'S',
      turns: [
        { role: 'user', text: 'Hi' },
        { role: 'assistant', text: reply.text, calls: reply.calls, raw: reply.raw },
        { role: 'tool', results: [{ id: 'g1', content: '{}' }] },
      ],
      tools: [],
    });
    const sent = (next.body.messages as { tool_calls?: unknown[] }[])[2];
    expect(sent?.tool_calls).toEqual([call]);
    // A server that leaves out the id still gets one its tool result can name.
    const bare = parseReply(local, {
      choices: [
        {
          message: {
            content: null,
            tool_calls: [{ function: { name: 'get_checks', arguments: '' } }],
          },
          finish_reason: 'tool_calls',
        },
      ],
    });
    expect(
      (bare.raw as { tool_calls: { id: string; type: string }[] }).tool_calls[0]
    ).toMatchObject({ id: 'call_0', type: 'function' });
    expect(bare.calls[0]?.id).toBe('call_0');
  });
});

describe('the egress gate (NFR-PRIV-003, ADR 0016)', () => {
  it('allows only the listed origins, any port on this computer', () => {
    expect(isAllowedUrl('http://127.0.0.1:11434/v1/chat/completions')).toBe(true);
    expect(isAllowedUrl('http://localhost:8080/x')).toBe(true);
    expect(isAllowedUrl('https://api.anthropic.com/v1/messages')).toBe(true);
    expect(isAllowedUrl('https://evil.example/v1/messages')).toBe(false);
    expect(isAllowedUrl('http://api.anthropic.com/v1/messages')).toBe(false);
  });

  it('sends nothing without consent, shows the exact body, sends the key only to its provider, and logs', async () => {
    const { fetch, seen } = scripted([openaiText('ok'), openaiText('ok')]);
    const asked: string[] = [];
    let answer: Consent = 'cancel';
    const gate = createGate({
      fetch,
      consent: async (c) => (asked.push(c.body), answer),
      now: () => 'T',
    });
    const req = chatRequest(local, { system: 'S', turns, tools: [] });
    await expect(gate.send(local, undefined, req)).rejects.toBeInstanceOf(EgressRefused);
    expect(seen).toHaveLength(0);
    expect(JSON.parse(asked[0]!)).toEqual(req.body);
    answer = 'send-always';
    await gate.send(local, undefined, req);
    await gate.send(local, undefined, req);
    expect(asked).toHaveLength(2);
    expect(seen).toHaveLength(2);
    expect((seen[0]!.init.headers as Record<string, string>).authorization).toBeUndefined();
    expect(gate.log.map((l) => l.status)).toEqual(['not sent', 200, 200]);
    expect(gate.log[1]!.bodySha256).toMatch(/^[0-9a-f]{64}$/);

    const k = scripted([{ content: [], stop_reason: 'end_turn' }]);
    const keyed = createGate({ fetch: k.fetch, consent: async () => 'send' });
    await keyed.send(claude, 'sk-test', chatRequest(claude, { system: 'S', turns, tools: [] }));
    expect((k.seen[0]!.init.headers as Record<string, string>)['x-api-key']).toBe('sk-test');
  });

  it('refuses an origin that is not listed, before asking', async () => {
    const gate = createGate({ consent: async () => 'send' });
    const cfg: ProviderConfig = { kind: 'openai', endpoint: 'https://evil.example', model: 'm' };
    await expect(
      gate.send(cfg, 'k', chatRequest(cfg, { system: '', turns, tools: [] }))
    ).rejects.toThrow(/not an origin/);
  });
});

describe('a turn (M12)', () => {
  it('runs the tools the model asks for on a draft, sends results back, and ends in words', async () => {
    const { fetch, seen } = scripted([
      openaiCall('add_symbol', {
        type: 'storage',
        label: 'Tank',
        x: null,
        y: null,
        value: 20,
        capacity: null,
        carrier: null,
        why: 'a guess',
      }),
      openaiText('I added a tank holding 20, an assumption you can change.'),
    ]);
    const gate = createGate({ fetch, consent: async () => 'send' });
    const history: Turn[] = [];
    const ctx: ToolContext = {
      draft: emptyModel(),
      steps: [],
      author: { provider: 'local', model: 'local' },
    };
    const out = await runTurn({
      cfg: local,
      key: undefined,
      gate,
      history,
      userText: 'Add a tank',
      ctx,
    });
    expect(out.stop).toBe('end');
    expect(ctx.steps).toEqual(['Add storage “Tank”']);
    expect(assumedCount(ctx.draft)).toBe(1);
    expect(history.map((t) => t.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    // The second request carries the tool's result back, and the system prompt.
    const second = JSON.parse(String(seen[1]!.init.body)) as {
      messages: { role: string; content: string }[];
    };
    expect(second.messages[0]?.content).toBe(SYSTEM_PROMPT);
    expect(second.messages.find((m) => m.role === 'tool')?.content).toMatch(/"id":"tank"/);
    expect(out.toolText.join(' ')).toMatch(/tank/);
  });
});

describe('figures in a reply (NFR-HON-002)', () => {
  it('flags numbers no tool result, message or model supports', () => {
    const parts = checkFigures('The tank ends at 1,234.6 and the dam at 99.5; 3 symbols.', [
      '{"final":{"tank":1234.567}}',
    ]);
    expect(parts.filter((p) => p.flagged).map((p) => p.text)).toEqual(['99.5']);
    expect(parts.map((p) => p.text).join('')).toBe(
      'The tank ends at 1,234.6 and the dam at 99.5; 3 symbols.'
    );
    expect(checkFigures('All 3 run.', []).some((p) => p.flagged)).toBe(false);
  });
});

describe('Sign in with OpenRouter (PKCE, ADR 0016)', () => {
  it('makes a 43-character verifier and its S256 challenge, and asks for a key with them', async () => {
    const { authUrl, challengeOf, keyFrom, keyRequest, newVerifier } =
      await import('../../src/assistant/openrouter.ts');
    const { createHash } = await import('node:crypto');
    const v = newVerifier();
    expect(v).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newVerifier()).not.toBe(v);
    const expected = createHash('sha256').update(v).digest('base64url');
    expect(await challengeOf(v)).toBe(expected);
    const url = new URL(authUrl('https://example.org/app/', 'abc'));
    expect(url.origin + url.pathname).toBe('https://openrouter.ai/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      callback_url: 'https://example.org/app/',
      code_challenge: 'abc',
      code_challenge_method: 'S256',
    });
    const req = keyRequest('code1', v);
    expect(req.url).toBe('https://openrouter.ai/api/v1/auth/keys');
    expect(req.body).toEqual({ code: 'code1', code_verifier: v, code_challenge_method: 'S256' });
    expect(keyFrom({ key: ' sk-or-1 ' })).toBe('sk-or-1');
    expect(keyFrom({})).toBeUndefined();
    expect(isAllowedUrl(req.url)).toBe(true);
  });

  it('chats with OpenRouter through its OpenAI-compatible API', () => {
    const r = chatRequest(
      { kind: 'openrouter', endpoint: 'https://openrouter.ai/api', model: 'openrouter/auto' },
      { system: 'S', turns, tools: [] }
    );
    expect(r.url).toBe('https://openrouter.ai/api/v1/chat/completions');
  });
});
