/**
 * Series colour slots (dataviz reference palette, validated in both modes).
 * Colour follows the entity: a node keeps its slot while it is charted, and
 * turning another series on or off never repaints it. Eight at once at most —
 * a ninth is never a generated hue.
 */
export const SLOTS = 8;

export class SlotAssigner {
  private readonly slots = new Map<string, number>();

  /** The slot for id, assigning the lowest free one; null when all eight are taken. */
  take(id: string): number | null {
    const have = this.slots.get(id);
    if (have !== undefined) return have;
    const used = new Set(this.slots.values());
    for (let s = 1; s <= SLOTS; s++) {
      if (!used.has(s)) {
        this.slots.set(id, s);
        return s;
      }
    }
    return null;
  }

  release(id: string): void {
    this.slots.delete(id);
  }

  get(id: string): number | undefined {
    return this.slots.get(id);
  }

  ids(): string[] {
    return [...this.slots.keys()];
  }

  retain(keep: ReadonlySet<string>): void {
    for (const id of this.slots.keys()) if (!keep.has(id)) this.slots.delete(id);
  }
}

export const seriesColor = (slot: number) => `var(--series-${slot})`;
