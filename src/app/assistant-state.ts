/**
 * The assistant's settings and its way out, shared by the Settings page and
 * the chat panel (ADR 0016).
 *
 * - Which provider, its endpoint and model are remembered in this browser.
 *   "Off" is a choice too, and the default.
 * - A key is held in memory for this page only: never stored, never
 *   exported, forgotten on reload, sent only to its own provider.
 * - One egress gate for the whole app, asking through the consent dialog,
 *   with one call log.
 */
import { createGate, type Gate } from '../assistant/egress.ts';
import {
  PROVIDERS,
  providerInfo,
  type ProviderConfig,
  type ProviderKind,
} from '../assistant/providers.ts';
import { consentDialog } from './components/consent-dialog/consent-dialog.ts';

const KEY = 'gssk-studio-assistant';

export interface AssistantSettings {
  /** The chosen provider, or null when the assistant is off. */
  active: ProviderKind | null;
  endpoint: string;
  model: string;
}

const isKind = (k: unknown): k is ProviderKind => PROVIDERS.some((p) => p.kind === k);

function load(): AssistantSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Record<string, unknown> | null;
    // `active` is the choice; an older record kept only kind/endpoint/model, and meant off.
    const kind = isKind(raw?.active) ? raw.active : isKind(raw?.kind) ? raw.kind : null;
    if (raw && kind) {
      const info = providerInfo(kind);
      return {
        active: isKind(raw.active) ? raw.active : null,
        endpoint: typeof raw.endpoint === 'string' && raw.endpoint ? raw.endpoint : info.endpoint,
        model: typeof raw.model === 'string' && raw.model ? raw.model : info.model,
      };
    }
  } catch {
    // Defaults.
  }
  return { active: null, endpoint: PROVIDERS[0]!.endpoint, model: PROVIDERS[0]!.model };
}

let settings = load();
const keys = new Map<ProviderKind, string>();
const listeners = new Set<() => void>();

const changed = () => {
  for (const f of listeners) f();
};

export function assistantSettings(): AssistantSettings {
  return { ...settings };
}

export function saveAssistantSettings(next: AssistantSettings): void {
  settings = { ...next };
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Not remembered.
  }
  changed();
}

/** Choose a provider (or null for off), with its default endpoint and model. */
export function chooseProvider(kind: ProviderKind | null): void {
  const info = providerInfo(kind ?? settings.active ?? PROVIDERS[0]!.kind);
  saveAssistantSettings({ active: kind, endpoint: info.endpoint, model: info.model });
}

export function keyFor(kind: ProviderKind): string | undefined {
  return keys.get(kind);
}

/** Hold a key in memory for this page; an empty one forgets it. */
export function setKey(kind: ProviderKind, key: string): void {
  if (key.trim()) keys.set(kind, key.trim());
  else keys.delete(kind);
  changed();
}

/** Call when the settings or a key change; returns a function that stops it. */
export function onAssistantChange(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** What the chat can use now, or why it cannot. */
export function assistantReady():
  | { ok: true; cfg: ProviderConfig; key: string | undefined; label: string }
  | { ok: false; why: string } {
  const kind = settings.active;
  if (!kind) return { ok: false, why: 'The assistant is off. Choose a provider in Settings.' };
  const info = providerInfo(kind);
  if (!settings.model) return { ok: false, why: `Name a model for ${info.label} in Settings.` };
  const key = keys.get(kind);
  if (info.needsKey && !key)
    return {
      ok: false,
      why:
        kind === 'openrouter'
          ? 'Sign in with OpenRouter in Settings: keys last only until the page reloads.'
          : `${info.label} needs your API key: add it in Settings (it lasts until the page reloads).`,
    };
  return {
    ok: true,
    cfg: { kind, endpoint: settings.endpoint, model: settings.model },
    key,
    label: `${info.label.replace(/ \(.*\)$/, '')} · ${settings.model}`,
  };
}

let gate: Gate | null = null;

/** The app's one egress gate: every call asks first, and is logged. */
export function assistantGate(): Gate {
  gate ??= createGate({
    consent: (call) => consentDialog().ask(call, isKind(call.provider) && keys.has(call.provider)),
  });
  return gate;
}
