import * as ener from '../../../../src/sdk/energese/index.ts';

const m = new ener.Model('Resource economy', {
  description: 'Capital works with a renewable resource to make more capital.',
  tStart: 0,
  tEnd: 100,
  dt: 0.1,
  method: 'rk4',
});

// Symbols
const resource = new ener.Source(m, 'Natural resources', {
  id: 'resource',
  value: 10,
  at: [100, 250],
});
const capital = new ener.Storage(m, 'Capital', { value: 100, at: [360, 250], capacity: 2000 });
const households = new ener.Storage(m, 'Households', { value: 50, at: [620, 140], capacity: 1000 });
const government = new ener.Storage(m, 'Government', { value: 20, at: [620, 370], capacity: 1000 });
const waste = new ener.HeatSink(m, 'Depreciation', { id: 'waste', value: 0, at: [820, 250] });

// Flows
new ener.Flow(m, resource, capital, ener.interaction(0.01, capital), { id: 'production' });
new ener.Flow(m, capital, households, ener.linear(0.05), { id: 'wages' });
new ener.Flow(m, capital, government, ener.linear(0.03), { id: 'taxes' });
new ener.Flow(m, households, capital, ener.linear(0.02), { id: 'investment' });
new ener.Flow(m, government, capital, ener.linear(0.05), { id: 'public_works' });
new ener.Flow(m, capital, waste, ener.linear(0.01), { id: 'depreciation' });
new ener.Flow(m, households, waste, ener.linear(0.02), { id: 'household_use' });
new ener.Flow(m, government, waste, ener.linear(0.01), { id: 'government_use' });

// Boundaries
new ener.Boundary(m, 'National economy', { id: 'nation', x: 230, y: 50, w: 540, h: 420 });

export default m;
