/** Undo and redo over model snapshots (FR-EDIT-007). */
import type { StudioModel } from './types.ts';

export class History {
  private past: StudioModel[] = [];
  private future: StudioModel[] = [];
  private readonly limit: number;

  constructor(limit = 200) {
    this.limit = limit;
  }

  /** Record `before`, the state an edit replaced. */
  push(before: StudioModel): void {
    this.past.push(before);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  undo(current: StudioModel): StudioModel | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(current);
    return prev;
  }

  redo(current: StudioModel): StudioModel | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(current);
    return next;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}
