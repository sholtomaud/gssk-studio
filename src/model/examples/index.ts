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
];

export function exampleById(id: string): Example | undefined {
  return EXAMPLES.find((e) => e.id === id);
}
