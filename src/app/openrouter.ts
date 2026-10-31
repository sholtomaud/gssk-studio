/**
 * Sign in with OpenRouter (ADR 0016, after budget-app's ADR 0047): the round
 * trip in the browser.
 *
 * `startSignIn` chooses OpenRouter, keeps the PKCE verifier in this tab's
 * sessionStorage (one use, not a key) and sends the person to OpenRouter.
 * They come back to the app's root with `?code=…`; `routeSignInReturn` opens
 * Settings, where `finishSignIn` exchanges the code through the egress gate
 * (consent, log) and holds the key in memory like any other.
 */
import { authUrl, challengeOf, keyFrom, keyRequest, newVerifier } from '../assistant/openrouter.ts';
import { providerInfo } from '../assistant/providers.ts';
import { assistantGate, chooseProvider, setKey } from './assistant-state.ts';

const VERIFIER = 'gssk-studio-openrouter-pkce';

/**
 * Where OpenRouter sends the person back: the app's root, a real page on any
 * static host (a deep link is a 404 on GitHub Pages).
 */
export const callbackUrl = () => new URL(import.meta.env.BASE_URL, location.origin).toString();

/** At start-up: back from OpenRouter at the root? Show Settings, which finishes the sign-in. */
export function routeSignInReturn(): void {
  if (!pendingSignIn()) return;
  const here = new URL(location.href);
  if (here.pathname !== import.meta.env.BASE_URL) return;
  history.replaceState(history.state, '', `${import.meta.env.BASE_URL}settings${here.search}`);
}

export async function startSignIn(): Promise<void> {
  chooseProvider('openrouter');
  const verifier = newVerifier();
  sessionStorage.setItem(VERIFIER, verifier);
  location.assign(authUrl(callbackUrl(), await challengeOf(verifier)));
}

/** A sign-in to finish: a code in the address and the verifier this tab kept. */
export function pendingSignIn(): { code: string; verifier: string } | null {
  const code = new URLSearchParams(location.search).get('code');
  let verifier: string | null = null;
  try {
    verifier = sessionStorage.getItem(VERIFIER);
  } catch {
    verifier = null;
  }
  return code && verifier ? { code, verifier } : null;
}

/**
 * Exchange the code for a key. The code and verifier are used once: both are
 * cleared whatever happens, and the code leaves the address bar.
 */
export async function finishSignIn(p: { code: string; verifier: string }): Promise<void> {
  try {
    sessionStorage.removeItem(VERIFIER);
  } catch {
    // Storage blocked: nothing to clear.
  }
  const url = new URL(location.href);
  url.searchParams.delete('code');
  history.replaceState(history.state, '', url);
  const info = providerInfo('openrouter');
  const reply = await assistantGate().send(
    { kind: 'openrouter', endpoint: info.endpoint, model: info.model },
    undefined,
    keyRequest(p.code, p.verifier),
    'Sign in: the one-time code OpenRouter just gave this app, for an API key. Nothing about your models is sent.'
  );
  const key = keyFrom(reply);
  if (!key) throw new Error('OpenRouter sent no key. Try signing in again.');
  setKey('openrouter', key);
}
