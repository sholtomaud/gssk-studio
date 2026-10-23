/**
 * What an import changed (ADR 0006), handed from the library to the studio
 * screen for the session. Kept beside the model id, never in the model.
 */
const key = (id: string) => `gssk-studio-import-notes:${id}`;

export function setImportNotes(id: string, notes: readonly string[]): void {
  try {
    if (notes.length) sessionStorage.setItem(key(id), JSON.stringify(notes));
  } catch {
    // Storage unavailable: the notes are a convenience.
  }
}

export function importNotes(id: string): string[] {
  try {
    const raw = sessionStorage.getItem(key(id));
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
