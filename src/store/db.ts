/**
 * IndexedDB, opened once, with versioned migrations (NFR-STO-001). A
 * migration only ever adds; a released version's step is never edited.
 */
const DB_NAME = 'gssk-studio';

type Migration = (db: IDBDatabase, tx: IDBTransaction) => void;

/** MIGRATIONS[i] upgrades from version i to i + 1. */
const MIGRATIONS: readonly Migration[] = [
  (db) => {
    const models = db.createObjectStore('models', { keyPath: 'id' });
    models.createIndex('updatedAt', 'updatedAt');
    db.createObjectStore('kv');
  },
];

export const DB_VERSION = MIGRATIONS.length;

let opened: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const tx = req.transaction;
      if (!tx) return;
      for (let v = e.oldVersion; v < DB_VERSION; v++) MIGRATIONS[v]?.(req.result, tx);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('Another tab is upgrading the model library.'));
  });
  opened.catch(() => (opened = null));
  return opened;
}

export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

export async function store(
  name: 'models' | 'kv',
  mode: IDBTransactionMode
): Promise<IDBObjectStore> {
  const db = await openDb();
  return db.transaction(name, mode).objectStore(name);
}
