import { describe, expect, it } from 'vitest';
import { exampleById } from '../../src/model/examples/index.ts';
import { BUILTIN_ICONS, DEFAULT_ICON, ICON_DEFS } from '../../src/diagram/icons.ts';
import {
  addIcon,
  iconsOf,
  isIconHref,
  MAX_ICON_CHARS,
  removeIcon,
  setNodeIcon,
} from '../../src/model/icons.ts';
import { parseModel, serialiseModel } from '../../src/model/io.ts';
import { canonicalJson, toKernelModel } from '../../src/model/kernel-json.ts';
import { cloneModel, NODE_TYPES } from '../../src/model/types.ts';

const svg = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>')}`;
const water = () => cloneModel(exampleById('water')!.model);

describe('the icon view (FR-EDIT-014)', () => {
  it('has a built-in default for every symbol type, each shape with its own paint', () => {
    const names = new Set(BUILTIN_ICONS.map((i) => i.name));
    for (const t of NODE_TYPES) expect(names, t).toContain(DEFAULT_ICON[t]);
    for (const shape of ICON_DEFS.match(/<(circle|path|rect|ellipse|line|polygon)\b[^>]*>/g) ??
      []) {
      expect(shape, shape).toMatch(/\bfill="/);
      expect(shape, shape).toMatch(/\bstroke="/);
    }
  });

  it('keeps only images as data URLs, never markup or links', () => {
    expect(isIconHref(svg)).toBe(true);
    expect(isIconHref('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(isIconHref('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
    expect(isIconHref('https://example.com/a.svg')).toBe(false);
    expect(isIconHref('javascript:alert(1)')).toBe(false);
    expect(isIconHref('data:image/svg+xml,<svg onload="x"/>')).toBe(false);
    expect(isIconHref(`data:image/png;base64,${'A'.repeat(MAX_ICON_CHARS)}`)).toBe(false);
  });

  it('adds a model’s own icon for a symbol, and removing it puts the symbol back to its default', () => {
    const { model, id } = addIcon(water(), 'Water Tank.svg', svg, 'tank');
    expect(id).toBe('icon_water_tank');
    expect(iconsOf(model)).toEqual([{ id, label: 'Water Tank', href: svg }]);
    expect(model.nodes.find((n) => n.id === 'tank')?.visual.icon).toBe(id);
    expect(addIcon(water(), 'x.html', 'data:text/html;base64,AA==').id).toBeNull();

    const gone = removeIcon(model, id!);
    expect(iconsOf(gone)).toEqual([]);
    expect(gone._diagram.icons).toBeUndefined();
    expect(gone.nodes.find((n) => n.id === 'tank')?.visual.icon).toBeUndefined();
    expect(
      setNodeIcon(gone, 'bank', 'builtin:house').nodes.find((n) => n.id === 'bank')?.visual.icon
    ).toBe('builtin:house');
  });

  it('travels in the model file, drops what is not an image, and never reaches the kernel', () => {
    const { model } = addIcon(water(), 'tank.svg', svg, 'tank');
    const back = parseModel(serialiseModel(model)).model;
    expect(back._diagram.icons).toEqual(model._diagram.icons);
    expect(back.nodes.find((n) => n.id === 'tank')?.visual.icon).toBe('icon_tank');
    expect(canonicalJson(toKernelModel(model))).toBe(canonicalJson(toKernelModel(water())));

    const raw = JSON.parse(serialiseModel(model));
    raw._diagram.icons.push({ id: 'bad', label: 'Bad', href: 'data:text/html;base64,AA==' });
    const { model: m, notes } = parseModel(JSON.stringify(raw));
    expect(iconsOf(m).map((i) => i.id)).toEqual(['icon_tank']);
    expect(notes.join(' ')).toMatch(/Bad/);
  });
});
