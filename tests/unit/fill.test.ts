import { describe, expect, it } from 'vitest';
import { SYMBOL_DEFS } from '../../src/diagram/symbols.ts';
import { exampleById } from '../../src/model/examples/index.ts';
import { FILL_SWATCHES, isFillColour, setNodeFill } from '../../src/model/fill.ts';
import { parseModel, serialiseModel } from '../../src/model/io.ts';
import { canonicalJson, toKernelModel } from '../../src/model/kernel-json.ts';
import { cloneModel } from '../../src/model/types.ts';
import { toEnergese } from '../../src/sdk/energese/codegen.ts';
import * as ener from '../../src/sdk/energese/index.ts';

const reservoir = () => cloneModel(exampleById('reservoir')!.model);

describe('a storage’s fill colour', () => {
  it('paints no symbol shape: its outline is a line, and only the level fill is coloured', () => {
    // The gate is the exception: it sits on a flow and covers the line beneath it.
    const symbols = SYMBOL_DEFS.match(/<symbol id="([^"]+)"[\s\S]*?<\/symbol>/g) ?? [];
    expect(symbols.length).toBeGreaterThan(10);
    for (const s of symbols.filter((x) => !x.includes('id="odum-gate"')))
      for (const shape of s.match(/<(circle|path|line|polygon|rect|ellipse)\b[^>]*>/g) ?? [])
        expect(shape, shape).toMatch(/\bfill="none"/);
  });

  it('takes a #rrggbb colour, offers a few to start from, and clears back to the default', () => {
    expect(isFillColour('#86B6EF')).toBe(true);
    for (const bad of ['blue', '#fff', 'url(#x)', '#12345g', 'red;background:red', ''])
      expect(isFillColour(bad), bad).toBe(false);
    expect(FILL_SWATCHES.length).toBeGreaterThan(3);
    for (const s of FILL_SWATCHES) expect(isFillColour(s.colour), s.label).toBe(true);

    const m = setNodeFill(reservoir(), 'reservoir', '#e3c35a');
    expect(m.nodes.find((n) => n.id === 'reservoir')!.visual.fill).toBe('#e3c35a');
    const cleared = setNodeFill(m, 'reservoir', undefined);
    expect(cleared.nodes.find((n) => n.id === 'reservoir')!.visual).not.toHaveProperty('fill');
    expect(setNodeFill(m, 'reservoir', 'red')).toBe(m);
    expect(setNodeFill(m, 'nowhere', '#000000')).toBe(m);
  });

  it('travels in the model file, drops what is not a colour, and never reaches the kernel', () => {
    const m = setNodeFill(reservoir(), 'reservoir', '#8fca7a');
    const back = parseModel(serialiseModel(m)).model;
    expect(back.nodes.find((n) => n.id === 'reservoir')!.visual.fill).toBe('#8fca7a');
    expect(canonicalJson(toKernelModel(m))).toBe(canonicalJson(toKernelModel(reservoir())));

    const raw = JSON.parse(serialiseModel(m));
    raw.nodes.find((n: { id: string }) => n.id === 'reservoir').visual.fill = 'url(#evil)';
    expect(parseModel(JSON.stringify(raw)).model.nodes[1]!.visual).not.toHaveProperty('fill');
  });

  it('is written in Energese, and kept from the previous model when a script leaves it out', () => {
    const m = setNodeFill(reservoir(), 'reservoir', '#8fca7a');
    expect(toEnergese(m)).toContain("fill: '#8fca7a'");

    const s = new ener.Model('Tank');
    new ener.Storage(s, 'Tank', { fill: '#e3c35a' });
    new ener.Storage(s, 'Pond');
    const built = s.synth();
    expect(built.nodes.find((n) => n.id === 'tank')!.visual.fill).toBe('#e3c35a');
    const before = setNodeFill(built, 'pond', '#86b6ef');
    expect(s.synth({ previous: before }).nodes.find((n) => n.id === 'pond')!.visual.fill).toBe(
      '#86b6ef'
    );
  });
});
