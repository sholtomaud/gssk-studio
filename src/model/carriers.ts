/**
 * Energetic types (FR-TYP-001, ADR 0015): what a carrier measures, named by
 * the standard that governs it. Units are UCUM codes; fiat money is an ISO
 * 4217 currency and a crypto-asset an ISO 24165 Digital Token Identifier;
 * what a household spends on is a COICOP 2018 purpose. Kind is read from the
 * unit's SI dimension, so it is asked for only when the unit cannot tell.
 */
import { CARRIER_KINDS, type Carrier, type CarrierKind, type StudioModel } from './types.ts';

/** UCUM atoms by what they measure; prefixes (k, M, G, …) are allowed on each. */
const ATOMS: Record<string, CarrierKind> = {
  J: 'energy',
  'W.h': 'energy',
  Wh: 'energy',
  cal: 'energy',
  eV: 'energy',
  '[Btu_IT]': 'energy',
  'W.s': 'energy',
  g: 'material',
  t: 'material',
  L: 'material',
  l: 'material',
  m3: 'material',
  '[gal_us]': 'material',
  bit: 'information',
  By: 'information',
};

const PREFIXES = ['', 'k', 'M', 'G', 'T', 'P', 'm', 'u', 'h', 'da', 'c', 'd', 'n'];

/** The kind a UCUM unit's dimension gives, if it gives one. Annotations (`{…}`) give none. */
export function kindOfUnit(unit: string | undefined): CarrierKind | undefined {
  const u = unit?.trim();
  if (!u || u.includes('{') || u.includes('/')) return undefined;
  for (const p of PREFIXES) {
    if (!u.startsWith(p)) continue;
    const atom = ATOMS[u.slice(p.length)];
    if (atom) return atom;
  }
  return undefined;
}

/** ISO 4217 codes, from the runtime's own ICU data where it has it. */
const ISO_4217: ReadonlySet<string> | null = (() => {
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    const codes = intl.supportedValuesOf?.('currency');
    return codes?.length ? new Set(codes) : null;
  } catch {
    return null;
  }
})();

/** Is `code` an ISO 4217 alphabetic code? Without ICU data, its shape is all that is checked. */
export function isCurrency(code: string): boolean {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  return ISO_4217 ? ISO_4217.has(code) : true;
}

export function currencies(): string[] {
  return ISO_4217 ? [...ISO_4217].sort() : [];
}

/** The currency's English name, as the runtime knows it. */
export function currencyName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'currency' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * An ISO 24165 DTI has nine characters, digits and capitals, the last a
 * check character. Only the shape is checked: the registry is not shipped.
 */
export function isDti(code: string): boolean {
  return /^[0-9A-Z]{9}$/.test(code);
}

/** What a carrier measures: monetary if it names a currency, else its unit's kind, else as stated. */
export function kindOf(c: Carrier): CarrierKind | undefined {
  if (c._currency || c._dti) return 'monetary';
  return (
    kindOfUnit(c.unit) ?? (CARRIER_KINDS.includes(c._kind as CarrierKind) ? c._kind : undefined)
  );
}

/** Does the carrier obey conservation? Information is copied, not used up, unless said otherwise. */
export function conservedOf(c: Carrier): boolean {
  return c.conserved ?? kindOf(c) !== 'information';
}

/** What a carrier is measured in: its currency, its DTI or its unit. */
export function unitOf(c: Carrier): string | undefined {
  return c._currency ?? c._dti ?? c.unit;
}

export function findCarrier(m: StudioModel, id: string | undefined): Carrier | undefined {
  return id === undefined ? undefined : m.carriers?.find((c) => c.id === id);
}

/** The kind of what a flow carries, by its carrier id. */
export function kindOfCarrierId(m: StudioModel, id: string | undefined): CarrierKind | undefined {
  const c = findCarrier(m, id);
  return c ? kindOf(c) : undefined;
}

/** What is wrong with one carrier, in words (FR-VAL-001). */
export function carrierProblems(c: Carrier): { severity: 'error' | 'warning'; text: string }[] {
  const out: { severity: 'error' | 'warning'; text: string }[] = [];
  if (c._currency && c._dti)
    out.push({ severity: 'error', text: 'give a currency or a digital token, not both' });
  if (c._currency && !isCurrency(c._currency))
    out.push({ severity: 'error', text: `“${c._currency}” is not an ISO 4217 currency code` });
  if (c._dti && !isDti(c._dti))
    out.push({
      severity: 'error',
      text: `“${c._dti}” is not an ISO 24165 DTI (nine characters, digits and capitals)`,
    });
  if ((c._currency || c._dti) && c.unit)
    out.push({
      severity: 'warning',
      text: 'money is measured in its currency; its unit is ignored',
    });
  if (!c._currency && !c._dti && !kindOf(c))
    out.push({
      severity: 'warning',
      text: c.unit
        ? `its unit “${c.unit}” does not say whether it is energy, material or information: choose a kind`
        : 'give it a unit (UCUM) or a currency, so data can be matched to it',
    });
  return out;
}

/**
 * COICOP 2018 divisions, the household budget accounts (UN Classification of
 * Individual Consumption According to Purpose). Finer codes (`04.5.1`) are
 * accepted and titled by their division.
 */
export const COICOP_DIVISIONS: Readonly<Record<string, string>> = {
  '01': 'Food and non-alcoholic beverages',
  '02': 'Alcoholic beverages, tobacco and narcotics',
  '03': 'Clothing and footwear',
  '04': 'Housing, water, electricity, gas and other fuels',
  '05': 'Furnishings, household equipment and routine household maintenance',
  '06': 'Health',
  '07': 'Transport',
  '08': 'Information and communication',
  '09': 'Recreation, sport and culture',
  '10': 'Education services',
  '11': 'Restaurants and accommodation services',
  '12': 'Insurance and financial services',
  '13': 'Personal care, social protection and miscellaneous goods and services',
};

export function isCoicop(code: string): boolean {
  return /^(0[1-9]|1[0-3])(\.\d{1,2}){0,3}$/.test(code);
}

/** “04 Housing, water, …” for a division or any code below it. */
export function coicopTitle(code: string): string {
  const div = COICOP_DIVISIONS[code.slice(0, 2)];
  return div ? `${code} ${div}` : code;
}

// ---- operations ------------------------------------------------------------

/** Ready-made carriers: a unit or currency for what households commonly buy and use. */
export const CARRIER_PRESETS: readonly Carrier[] = [
  { id: 'aud', _label: 'Australian dollar', _currency: 'AUD' },
  { id: 'usd', _label: 'US dollar', _currency: 'USD' },
  { id: 'electricity', _label: 'Electricity', unit: 'kW.h' },
  { id: 'gas', _label: 'Natural gas', unit: 'MJ' },
  { id: 'water', _label: 'Water', unit: 'kL' },
  { id: 'food', _label: 'Food', unit: 'kg' },
  { id: 'data', _label: 'Data', unit: 'GBy' },
];

function copy(m: StudioModel): StudioModel {
  return structuredClone(m);
}

/** Add a carrier (a preset or a blank one) under an id no other carrier has. */
export function addCarrier(m: StudioModel, preset: Carrier): { model: StudioModel; id: string } {
  const next = copy(m);
  next.carriers ??= [];
  const ids = new Set(next.carriers.map((c) => c.id));
  let id = preset.id;
  for (let i = 2; ids.has(id); i++) id = `${preset.id}_${i}`;
  next.carriers.push({ ...structuredClone(preset), id });
  return { model: next, id };
}

export function updateCarrier(
  m: StudioModel,
  id: string,
  patch: (c: Carrier) => void
): StudioModel {
  const next = copy(m);
  const c = next.carriers?.find((x) => x.id === id);
  if (!c) return m;
  patch(c);
  for (const k of Object.keys(c) as (keyof Carrier)[])
    if (c[k] === '' || c[k] === undefined) delete c[k];
  return next;
}

/** Remove a carrier; what carried it keeps the id, and the checks say it is undeclared. */
export function removeCarrier(m: StudioModel, id: string): StudioModel {
  const next = copy(m);
  next.carriers = (next.carriers ?? []).filter((c) => c.id !== id);
  if (next.carriers.length === 0) delete next.carriers;
  return next;
}

/** Rename a carrier and everything that carries it. Refuses an empty or taken id. */
export function renameCarrier(m: StudioModel, from: string, to: string): StudioModel {
  if (!to || from === to || m.carriers?.some((c) => c.id === to)) return m;
  const next = copy(m);
  const c = next.carriers?.find((x) => x.id === from);
  if (!c) return m;
  c.id = to;
  for (const x of [...next.nodes, ...next.edges]) if (x.carrier === from) x.carrier = to;
  return next;
}
