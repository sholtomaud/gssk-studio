/**
 * Built-in example models (FR-LIB-002). Each is drawn with Odum's own symbols
 * and runs on the pinned kernel unchanged; tests/kernel/examples.test.ts
 * runs every one and pins its final state.
 */
import type { ModelEdge, ModelNode, NodeType, StudioModel } from '../types.ts';

export interface Example {
  id: string;
  title: string;
  summary: string;
  model: StudioModel;
}

function n(
  id: string,
  type: NodeType,
  value: number,
  x: number,
  y: number,
  label: string,
  capacity?: number
): ModelNode {
  return { id, type, value, visual: { x, y, label, ...(capacity ? { capacity } : {}) } };
}

function f(
  id: string,
  origin: string,
  target: string,
  k: number,
  logic: ModelEdge['logic'] = 'linear',
  control?: string
): ModelEdge {
  return {
    id,
    origin,
    target,
    logic,
    params: { k, ...(control ? { control_node: control } : {}) },
  };
}

const grassland: StudioModel = {
  metadata: {
    schema_version: 4,
    name: 'Grassland food chain',
    description: 'Sunlight drives a producer; grazers feed on it; both lose heat.',
  },
  config: { t_start: 0, t_end: 200, dt: 0.1, method: 'rk4' },
  nodes: [
    n('sun', 'source', 100, 100, 260, 'Sunlight'),
    n('grass', 'producer', 20, 330, 260, 'Grass', 200),
    n('grazers', 'consumer', 5, 580, 260, 'Grazers', 100),
    n('heat', 'sink', 0, 460, 480, 'Heat'),
  ],
  edges: [
    f('photosynthesis', 'sun', 'grass', 0.02),
    f('grazing', 'grass', 'grazers', 0.01, 'interaction', 'grazers'),
    f('grass_loss', 'grass', 'heat', 0.01),
    f('grazer_loss', 'grazers', 'heat', 0.02),
  ],
  _diagram: { boundaries: [{ id: 'pasture', x: 220, y: 150, w: 480, h: 420, label: 'Pasture' }] },
};

const predatorPrey: StudioModel = {
  metadata: {
    schema_version: 4,
    name: 'Predator and prey',
    description: 'Lotka–Volterra cycles: predation is an interaction of prey and predators.',
  },
  config: { t_start: 0, t_end: 100, dt: 0.05, method: 'rk4' },
  nodes: [
    n('food', 'source', 1, 100, 220, 'Forage'),
    n('prey', 'storage', 40, 330, 220, 'Prey', 200),
    n('predator', 'storage', 9, 600, 220, 'Predators', 100),
    n('loss', 'sink', 0, 470, 420, 'Mortality'),
  ],
  edges: [
    f('births', 'food', 'prey', 1, 'interaction', 'prey'),
    f('predation', 'prey', 'predator', 0.02, 'interaction', 'predator'),
    f('predator_deaths', 'predator', 'loss', 0.4),
  ],
  _diagram: { boundaries: [] },
};

const reservoir: StudioModel = {
  metadata: {
    schema_version: 4,
    name: 'Reservoir',
    description:
      'Catchment inflow fills a reservoir; the town draws through a saturating (limit) supply.',
  },
  config: { t_start: 0, t_end: 100, dt: 0.1, method: 'rk4' },
  nodes: [
    n('rain', 'source', 10, 100, 200, 'Catchment inflow'),
    n('reservoir', 'storage', 50, 360, 200, 'Reservoir', 300),
    n('town', 'consumer', 5, 620, 200, 'Town demand', 50),
    n('downstream', 'sink', 0, 360, 420, 'Downstream'),
  ],
  edges: [
    f('runoff', 'rain', 'reservoir', 0.8),
    f('release', 'reservoir', 'downstream', 0.02),
    {
      id: 'supply',
      origin: 'reservoir',
      target: 'town',
      logic: 'limit',
      params: { k: 0.05, threshold: 100 },
    },
  ],
  _diagram: { boundaries: [] },
  // Synthetic gauge readings (the run with a fixed ±4 % error pattern), to show the fit (M3).
  _observations: [
    {
      id: 'gauge',
      name: 'Reservoir gauge (synthetic)',
      target: 'reservoir',
      times: [0, 5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90, 100],
      values: [50, 76.4, 92.4, 115.8, 122.1, 150.7, 160.2, 184, 196.4, 196.7, 209, 203.4, 215.5],
    },
  ],
};

const household: StudioModel = {
  metadata: {
    schema_version: 4,
    name: 'Household money',
    description: 'Income splits into tax, spending and saving; savings earn a return.',
  },
  config: { t_start: 0, t_end: 120, dt: 0.1, method: 'auto' },
  nodes: [
    n('income', 'source', 100, 80, 270, 'Income'),
    n('bank', 'storage', 1000, 260, 270, 'Bank account', 5000),
    n('savings', 'storage', 5000, 480, 420, 'Investments', 50000),
    n('spending', 'sink', 0, 720, 270, 'Spending'),
    n('tax', 'sink', 0, 260, 470, 'Tax'),
  ],
  edges: [
    f('pay', 'income', 'bank', 0.7),
    f('withholding', 'income', 'tax', 0.3),
    f('spend', 'bank', 'spending', 0.05),
    f('save', 'bank', 'savings', 0.01),
    f('drawdown', 'savings', 'bank', 0.002),
  ],
  _diagram: { boundaries: [{ id: 'home', x: 170, y: 160, w: 450, h: 380, label: 'Household' }] },
};

const economy: StudioModel = {
  metadata: {
    schema_version: 4,
    name: 'Resource economy',
    description: 'Capital works with a renewable resource to make more capital.',
  },
  config: { t_start: 0, t_end: 100, dt: 0.1, method: 'rk4' },
  nodes: [
    n('resource', 'source', 10, 100, 250, 'Natural resources'),
    n('capital', 'storage', 100, 360, 250, 'Capital', 2000),
    n('households', 'storage', 50, 620, 140, 'Households', 1000),
    n('government', 'storage', 20, 620, 370, 'Government', 1000),
    n('waste', 'sink', 0, 820, 250, 'Depreciation'),
  ],
  edges: [
    f('production', 'resource', 'capital', 0.01, 'interaction', 'capital'),
    f('wages', 'capital', 'households', 0.05),
    f('taxes', 'capital', 'government', 0.03),
    f('investment', 'households', 'capital', 0.02),
    f('public_works', 'government', 'capital', 0.05),
    f('depreciation', 'capital', 'waste', 0.01),
    f('household_use', 'households', 'waste', 0.02),
    f('government_use', 'government', 'waste', 0.01),
  ],
  _diagram: {
    boundaries: [{ id: 'nation', x: 230, y: 50, w: 540, h: 420, label: 'National economy' }],
  },
};

const seasonal: StudioModel = {
  metadata: {
    schema_version: 4,
    name: 'Seasonal river',
    description:
      'Rain is forced by a seasonal sine wave; a wetland stores the flood and drains to the river.',
  },
  config: { t_start: 0, t_end: 48, dt: 0.05, method: 'rk4' },
  nodes: [
    {
      ...n('rain', 'source', 10, 100, 220, 'Seasonal rain'),
      forcing: { waveform: 'sine', mean: 10, amplitude: 8, period: 12 },
    },
    n('wetland', 'storage', 40, 360, 220, 'Wetland', 150),
    n('river', 'sink', 0, 620, 220, 'River'),
    n('air', 'sink', 0, 360, 420, 'Evaporation'),
  ],
  edges: [
    f('inflow', 'rain', 'wetland', 0.5),
    f('drainage', 'wetland', 'river', 0.08),
    // Evaporation peaks in summer: its rate is a square wave, high half the year.
    {
      ...f('evaporation', 'wetland', 'air', 0.01),
      forcing: { waveform: 'square', mean: 0.03, amplitude: 0.02, period: 12, phase: 3 },
    },
  ],
  _diagram: { boundaries: [] },
};

/** A bill of `amount` per month, out of the bank to whoever is paid (`to`). */
const bill = (to: string, amount: number): ModelEdge =>
  f(`${to}_bill`, 'bank', to, amount, 'constant');

/** A charge of `amount` in the first month of every `months`, as a repeating table. */
const renewal = (to: string, amount: number, months: number): ModelEdge => ({
  ...bill(to, 0),
  forcing: {
    waveform: 'table',
    times: [0, 1, months],
    values: [amount, 0, 0],
    interpolation: 'step',
    extrapolation: 'cycle',
  },
});

const budget: StudioModel = {
  metadata: {
    schema_version: 4,
    name: 'Household budget',
    description:
      'Pay into the bank; every bill and renewal is its own flow out, packed into nested groups (FR-GRP-001).',
  },
  // Months.
  config: { t_start: 0, t_end: 36, dt: 0.05, method: 'rk4' },
  nodes: [
    n('salary', 'source', 5200, 100, 300, 'Salary'),
    n('bank', 'storage', 2000, 340, 300, 'Bank account', 25000),
    n('savings', 'storage', 0, 340, 520, 'Savings', 50000),
    n('rent', 'sink', 0, 640, 90, 'Rent'),
    n('electricity', 'sink', 0, 760, 90, 'Electricity'),
    n('water', 'sink', 0, 880, 90, 'Water'),
    n('phone', 'sink', 0, 640, 250, 'Phone'),
    n('internet', 'sink', 0, 760, 250, 'Internet'),
    n('groceries', 'sink', 0, 640, 410, 'Groceries'),
    n('eating_out', 'sink', 0, 760, 410, 'Eating out'),
    n('clothes', 'sink', 0, 880, 410, 'Clothes'),
    n('shoes', 'sink', 0, 1000, 410, 'Shoes'),
    n('car_insurance', 'sink', 0, 640, 570, 'Car insurance'),
    n('computer', 'sink', 0, 760, 570, 'Computer'),
  ],
  edges: [
    f('pay', 'salary', 'bank', 1),
    f('save', 'bank', 'savings', 0.1),
    bill('rent', 1800),
    bill('electricity', 150),
    bill('water', 60),
    bill('phone', 50),
    bill('internet', 70),
    bill('groceries', 700),
    bill('eating_out', 250),
    bill('clothes', 120),
    renewal('shoes', 150, 6),
    renewal('car_insurance', 1200, 12),
    renewal('computer', 2400, 36),
  ],
  _diagram: {
    boundaries: [],
    groups: [
      { id: 'expenses', label: 'Expenses', nodes: [], collapsed: true },
      {
        id: 'housing',
        label: 'Housing',
        nodes: ['rent', 'electricity', 'water'],
        parent: 'expenses',
        collapsed: false,
      },
      {
        id: 'comms',
        label: 'Phone and internet',
        nodes: ['phone', 'internet'],
        parent: 'expenses',
        collapsed: false,
      },
      {
        id: 'living',
        label: 'Living',
        nodes: ['groceries', 'eating_out', 'clothes', 'shoes'],
        parent: 'expenses',
        collapsed: false,
      },
      {
        id: 'renewals',
        label: 'Renewals',
        nodes: ['car_insurance', 'computer'],
        parent: 'expenses',
        collapsed: true,
      },
    ],
  },
};

/** A flow of `carrier` at a constant rate `k` per month. */
const paid = (id: string, o: string, t: string, k: number, carrier: string): ModelEdge => ({
  ...f(id, o, t, k, 'constant'),
  carrier,
});

const purchases: StudioModel = {
  metadata: {
    schema_version: 4,
    name: 'Paying for electricity and streaming',
    description:
      'Odum’s transactions: electricity and a video stream flow in, money flows out against each (FR-TRX-001).',
  },
  // Months.
  config: { t_start: 0, t_end: 12, dt: 0.05, method: 'rk4' },
  nodes: [
    // Sellers on the left, the household on the right: each money flow runs back
    // alongside what it pays for, under one transaction diamond (Odum's convention).
    { ...n('grid', 'source', 1, 100, 140, 'Electricity grid'), carrier: 'electricity' },
    { ...n('appliances', 'sink', 0, 660, 140, 'Appliances'), carrier: 'electricity' },
    { ...n('streaming', 'source', 1, 100, 540, 'Streaming service'), carrier: 'video' },
    { ...n('screen', 'sink', 0, 660, 540, 'Screen time'), carrier: 'video' },
    { ...n('salary', 'source', 300, 880, 340, 'Salary'), carrier: 'aud' },
    { ...n('bank', 'storage', 1000, 660, 340, 'Bank account', 30000), carrier: 'aud' },
    { ...n('retailer', 'storage', 0, 100, 280, 'Power retailer', 2000), carrier: 'aud' },
    { ...n('streamer', 'storage', 0, 100, 400, 'Streaming company', 500), carrier: 'aud' },
  ],
  edges: [
    {
      ...paid('power', 'grid', 'appliances', 300, 'electricity'),
      coupled_edge: 'power_bill',
      visual: { transaction: { purpose: '04', tags: ['utilities'] } },
    },
    {
      ...paid('stream', 'streaming', 'screen', 50, 'video'),
      coupled_edge: 'subscription',
      visual: { transaction: { purpose: '08', tags: ['subscription'] } },
    },
    { ...f('pay', 'salary', 'bank', 1), carrier: 'aud' },
    { ...paid('power_bill', 'bank', 'retailer', 96, 'aud'), coupled_edge: 'power' },
    { ...paid('subscription', 'bank', 'streamer', 22, 'aud'), coupled_edge: 'stream' },
  ],
  carriers: [
    { id: 'electricity', unit: 'kW.h', _label: 'Electricity' },
    { id: 'video', unit: 'GBy', _label: 'Video stream' },
    { id: 'aud', _label: 'Australian dollar', _currency: 'AUD' },
  ],
  _diagram: { boundaries: [] },
};

const water: StudioModel = {
  metadata: {
    schema_version: 4,
    name: 'Buying water for a home',
    description:
      'A utility sells water to a home, which pays from its bank account; the home is packed into one symbol that still shows which store each flow reaches (FR-GRP-001, FR-TRX-001).',
  },
  // Months.
  config: { t_start: 0, t_end: 24, dt: 0.05, method: 'rk4' },
  nodes: [
    { ...n('rain', 'source', 400, 100, 140, 'Catchment rain'), carrier: 'water' },
    { ...n('dam', 'storage', 5000, 280, 140, 'Utility dam', 20000), carrier: 'water' },
    { ...n('revenue', 'storage', 0, 280, 340, 'Utility revenue', 2000), carrier: 'aud' },
    { ...n('tank', 'storage', 2, 640, 140, 'Water tank', 10), carrier: 'water' },
    { ...n('use', 'sink', 0, 820, 140, 'Household use'), carrier: 'water' },
    { ...n('bank', 'storage', 1500, 640, 340, 'Bank account', 5000), carrier: 'aud' },
    { ...n('wages', 'source', 300, 900, 340, 'Wages'), carrier: 'aud' },
  ],
  edges: [
    { ...f('inflow', 'rain', 'dam', 1), carrier: 'water' },
    {
      ...paid('supply', 'dam', 'tank', 15, 'water'),
      coupled_edge: 'water_bill',
      visual: { transaction: { purpose: '04', tags: ['utilities'] } },
    },
    { ...f('drink', 'tank', 'use', 7.5), carrier: 'water' },
    { ...paid('water_bill', 'bank', 'revenue', 45, 'aud'), coupled_edge: 'supply' },
    { ...f('earn', 'wages', 'bank', 1), carrier: 'aud' },
  ],
  carriers: [
    { id: 'water', unit: 'kL', _label: 'Water' },
    { id: 'aud', _label: 'Australian dollar', _currency: 'AUD' },
  ],
  _diagram: {
    boundaries: [],
    groups: [
      { id: 'home', label: 'Home', nodes: ['tank', 'use', 'bank'], collapsed: true },
      { id: 'utility', label: 'Water utility', nodes: ['dam', 'revenue'], collapsed: false },
    ],
  },
};

export const EXAMPLES: readonly Example[] = [
  {
    id: 'grassland',
    title: grassland.metadata.name,
    summary: grassland.metadata.description ?? '',
    model: grassland,
  },
  {
    id: 'predator-prey',
    title: predatorPrey.metadata.name,
    summary: predatorPrey.metadata.description ?? '',
    model: predatorPrey,
  },
  {
    id: 'reservoir',
    title: reservoir.metadata.name,
    summary: reservoir.metadata.description ?? '',
    model: reservoir,
  },
  {
    id: 'household',
    title: household.metadata.name,
    summary: household.metadata.description ?? '',
    model: household,
  },
  {
    id: 'economy',
    title: economy.metadata.name,
    summary: economy.metadata.description ?? '',
    model: economy,
  },
  {
    id: 'seasonal',
    title: seasonal.metadata.name,
    summary: seasonal.metadata.description ?? '',
    model: seasonal,
  },
  {
    id: 'budget',
    title: budget.metadata.name,
    summary: budget.metadata.description ?? '',
    model: budget,
  },
  {
    id: 'purchases',
    title: purchases.metadata.name,
    summary: purchases.metadata.description ?? '',
    model: purchases,
  },
  {
    id: 'water',
    title: water.metadata.name,
    summary: water.metadata.description ?? '',
    model: water,
  },
];

export function exampleById(id: string): Example | undefined {
  return EXAMPLES.find((e) => e.id === id);
}
