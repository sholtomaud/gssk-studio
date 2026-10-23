/** The model library (FR-LIB-001): every model lives in this browser until exported. */
import { normaliseModel } from '../model/io.ts';
import type { StudioModel } from '../model/types.ts';
import { request, store } from './db.ts';

export interface SavedModel {
  id: string;
  model: StudioModel;
  createdAt: string;
  updatedAt: string;
}

export interface ModelSummary {
  id: string;
  name: string;
  description: string;
  nodes: number;
  edges: number;
  updatedAt: string;
}

function summary(s: SavedModel): ModelSummary {
  return {
    id: s.id,
    name: s.model.metadata.name,
    description: s.model.metadata.description ?? '',
    nodes: s.model.nodes.length,
    edges: s.model.edges.length,
    updatedAt: s.updatedAt,
  };
}

export async function listModels(): Promise<ModelSummary[]> {
  const all = await request(
    (await store('models', 'readonly')).getAll() as IDBRequest<SavedModel[]>
  );
  return all.map(summary).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getModel(id: string): Promise<SavedModel | null> {
  const s = await request(
    (await store('models', 'readonly')).get(id) as IDBRequest<SavedModel | undefined>
  );
  // Normalise on read, so a record written by an older version still opens.
  return s ? { ...s, model: normaliseModel(s.model).model } : null;
}

export async function createModel(model: StudioModel): Promise<string> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await request(
    (await store('models', 'readwrite')).add({ id, model, createdAt: now, updatedAt: now })
  );
  return id;
}

export async function saveModel(id: string, model: StudioModel): Promise<void> {
  const s = await store('models', 'readwrite');
  const prev = (await request(s.get(id) as IDBRequest<SavedModel | undefined>)) ?? null;
  const now = new Date().toISOString();
  await request(s.put({ id, model, createdAt: prev?.createdAt ?? now, updatedAt: now }));
}

export async function deleteModel(id: string): Promise<void> {
  await request((await store('models', 'readwrite')).delete(id));
}
