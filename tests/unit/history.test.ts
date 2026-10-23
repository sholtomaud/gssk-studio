import { describe, expect, it } from 'vitest';
import { History } from '../../src/model/history.ts';
import { emptyModel } from '../../src/model/types.ts';

describe('undo and redo (FR-EDIT-007)', () => {
  it('walks back and forward, and a new edit clears redo', () => {
    const h = new History();
    const a = emptyModel('a');
    const b = emptyModel('b');
    const c = emptyModel('c');
    h.push(a);
    h.push(b);
    expect(h.undo(c)).toBe(b);
    expect(h.undo(b)).toBe(a);
    expect(h.canUndo).toBe(false);
    expect(h.redo(a)).toBe(b);
    h.push(b);
    expect(h.canRedo).toBe(false);
  });

  it('keeps at most its limit', () => {
    const h = new History(2);
    for (const n of ['1', '2', '3']) h.push(emptyModel(n));
    expect(h.undo(emptyModel('x'))?.metadata.name).toBe('3');
    expect(h.undo(emptyModel('x'))?.metadata.name).toBe('2');
    expect(h.undo(emptyModel('x'))).toBeNull();
  });
});
