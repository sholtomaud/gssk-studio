import * as ener from '../../../../src/sdk/energese/index.ts';

const m = new ener.Model('Reservoir', {
  description:
    'Catchment inflow fills a reservoir; the town draws through a saturating (limit) supply.',
  tStart: 0,
  tEnd: 100,
  dt: 0.1,
  method: 'rk4',
});

// Symbols
const rain = new ener.Source(m, 'Catchment inflow', { id: 'rain', value: 10, at: [100, 200] });
const reservoir = new ener.Storage(m, 'Reservoir', { value: 50, at: [360, 200], capacity: 300 });
const town = new ener.Consumer(m, 'Town demand', {
  id: 'town',
  value: 5,
  at: [620, 200],
  capacity: 50,
});
const downstream = new ener.HeatSink(m, 'Downstream', { value: 0, at: [360, 420] });

// Flows
new ener.Flow(m, rain, reservoir, ener.linear(0.8), { id: 'runoff' });
new ener.Flow(m, reservoir, downstream, ener.linear(0.02), { id: 'release' });
new ener.Flow(m, reservoir, town, ener.limit(0.05, 100), { id: 'supply' });

export default m;
