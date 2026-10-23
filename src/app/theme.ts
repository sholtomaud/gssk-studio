/** Light, dark or the system's choice; remembered in this browser. */
export type Theme = 'system' | 'light' | 'dark';
const KEY = 'gssk-studio-theme';

export function storedTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(t: Theme): void {
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // Private mode: the choice lasts this page only.
  }
}

export function applyStoredTheme(): void {
  applyTheme(storedTheme());
}
