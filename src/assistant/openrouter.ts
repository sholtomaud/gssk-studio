/**
 * Sign in with OpenRouter (ADR 0016, after budget-app's ADR 0047): OAuth
 * PKCE, so a person without an API key gets one tied to their own OpenRouter
 * account, with no server of ours. Pure parts only; the redirect and the
 * exchange live in src/app/openrouter.ts.
 *
 * 1. Make a random verifier and its S256 challenge; keep the verifier for the
 *    round trip.
 * 2. Send the person to `authUrl`. OpenRouter returns them to the callback
 *    with `?code=…`.
 * 3. POST the code and the verifier (`keyRequest`): the reply's `key` is an
 *    API key for that account, used with OpenRouter's OpenAI-compatible API.
 */
import type { HttpRequest } from './providers.ts';

export const OPENROUTER_ORIGIN = 'https://openrouter.ai';

/** base64url without padding (RFC 4648 §5), as PKCE uses. */
export function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A fresh verifier: 32 random bytes, 43 characters (RFC 7636 §4.1). */
export function newVerifier(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** The S256 challenge: base64url(SHA-256(verifier)). */
export async function challengeOf(verifier: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(d));
}

/** Where to send the person to sign in and approve a key for this app. */
export function authUrl(callback: string, challenge: string): string {
  const q = new URLSearchParams({
    callback_url: callback,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `${OPENROUTER_ORIGIN}/auth?${q}`;
}

/** The exchange: the code from the callback and the verifier, for a key. */
export function keyRequest(code: string, verifier: string): HttpRequest {
  return {
    url: `${OPENROUTER_ORIGIN}/api/v1/auth/keys`,
    headers: { 'content-type': 'application/json' },
    body: { code, code_verifier: verifier, code_challenge_method: 'S256' },
  };
}

/** The key from the exchange's reply, or undefined if it has none. */
export function keyFrom(reply: unknown): string | undefined {
  const k = (reply as { key?: unknown } | null)?.key;
  return typeof k === 'string' && k.trim() ? k.trim() : undefined;
}
