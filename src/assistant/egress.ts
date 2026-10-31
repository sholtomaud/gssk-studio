/**
 * The assistant's one way out (NFR-PRIV-003, ADR 0016). Every call to a
 * provider goes through `send`:
 *
 * 1. Its origin must be one of ALLOWED_ORIGINS, the same list the build puts
 *    in the Content Security Policy's connect-src (vite.config.ts).
 * 2. The person sees the exact request body and says Send, or not. "Send
 *    without asking" lasts until the page reloads.
 * 3. A key, held only in memory by the caller, goes only to its own provider.
 * 4. Each call is logged: time, provider, origin, SHA-256 of the body, bytes
 *    and status. The log lives in memory for the session.
 */
import { authHeaders, type HttpRequest, type ProviderConfig } from './providers.ts';

/** Origins the assistant may call. A meta CSP cannot be widened at runtime, so this list is static. */
export const ALLOWED_ORIGINS = [
  'http://localhost:*',
  'http://127.0.0.1:*',
  'https://api.anthropic.com',
  'https://api.openai.com',
  'https://generativelanguage.googleapis.com',
  'https://openrouter.ai',
] as const;

/** Whether a URL's origin is on the list; a `:*` entry allows any port. */
export function isAllowedUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return ALLOWED_ORIGINS.some((o) =>
    o.endsWith(':*') ? `${u.protocol}//${u.hostname}` === o.slice(0, -2) : u.origin === o
  );
}

export interface LogEntry {
  at: string;
  provider: string;
  /** What the call was for: a chat turn, or signing in. */
  purpose: string;
  origin: string;
  bodySha256: string;
  bytes: number;
  status: number | 'not sent' | 'failed';
}

/** What the person is asked before a call. */
export interface PendingCall {
  provider: string;
  /** What the call is for, in words. */
  purpose: string;
  url: string;
  /** The body exactly as it will be sent, formatted. */
  body: string;
}

export type Consent = 'send' | 'send-always' | 'cancel';

export class EgressRefused extends Error {}

/** What `send` returns when the reply streamed: its events went to `onEvent` instead. */
export const STREAMED = Symbol('streamed');

export interface Gate {
  /**
   * Send a request. A JSON reply is returned parsed. A reply of server-sent
   * events, when `onEvent` is given, is passed on event by event (each
   * `data:` payload) and `STREAMED` returned.
   */
  send(
    cfg: ProviderConfig,
    key: string | undefined,
    req: HttpRequest,
    purpose?: string,
    onEvent?: (data: string) => void
  ): Promise<unknown>;
  readonly log: readonly LogEntry[];
}

/** Read a server-sent event stream, handing on each event's data. */
async function readEvents(res: Response, onEvent: (data: string) => void): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';
  const flush = (block: string) => {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).replace(/^ /, ''))
      .join('\n');
    if (data && data !== '[DONE]') onEvent(data);
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let at: number;
    while ((at = buffer.search(/\r?\n\r?\n/)) >= 0) {
      flush(buffer.slice(0, at));
      buffer = buffer.slice(at).replace(/^\r?\n\r?\n/, '');
    }
  }
  if (buffer.trim()) flush(buffer);
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function createGate(deps: {
  consent: (call: PendingCall) => Promise<Consent>;
  fetch?: typeof fetch;
  now?: () => string;
}): Gate {
  const log: LogEntry[] = [];
  let always = false;
  const doFetch = deps.fetch ?? ((input, init) => fetch(input, init));
  const now = deps.now ?? (() => new Date().toISOString());
  return {
    log,
    async send(cfg, key, req, purpose = 'A message to the assistant', onEvent) {
      if (!isAllowedUrl(req.url)) {
        throw new EgressRefused(
          `${new URL(req.url).origin} is not an origin the assistant may call. Use a local server, or Anthropic, OpenAI or Gemini.`
        );
      }
      const body = JSON.stringify(req.body);
      const entry: LogEntry = {
        at: now(),
        provider: cfg.kind,
        purpose,
        origin: new URL(req.url).origin,
        bodySha256: await sha256(body),
        bytes: new TextEncoder().encode(body).length,
        status: 'not sent',
      };
      if (!always) {
        const answer = await deps.consent({
          provider: cfg.kind,
          purpose,
          url: req.url,
          body: JSON.stringify(req.body, null, 2),
        });
        if (answer === 'cancel') {
          log.push(entry);
          throw new EgressRefused('Not sent.');
        }
        if (answer === 'send-always') always = true;
      }
      let res: Response;
      try {
        res = await doFetch(req.url, {
          method: 'POST',
          headers: { ...req.headers, ...(key ? authHeaders(cfg, key) : {}) },
          body,
        });
      } catch (err) {
        log.push({ ...entry, status: 'failed' });
        throw new Error(
          `Could not reach ${entry.origin}${cfg.kind === 'local' ? ': is the local model server running?' : ''} (${err instanceof Error ? err.message : String(err)})`
        );
      }
      log.push({ ...entry, status: res.status });
      if (res.ok && onEvent && res.headers.get('content-type')?.includes('text/event-stream')) {
        await readEvents(res, onEvent);
        return STREAMED;
      }
      const text = await res.text();
      if (!res.ok) throw new Error(`${entry.origin} answered ${res.status}: ${text.slice(0, 300)}`);
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new Error(`${entry.origin} did not answer with JSON.`);
      }
    },
  };
}
