import * as ener from '../../../../src/sdk/energese/index.ts';

const m = new ener.Model('Predator and prey', {
  description: 'Lotka–Volterra cycles: predation is an interaction of prey and predators.',
  tStart: 0,
  tEnd: 100,
  dt: 0.05,
  method: 'rk4',
});

// Symbols
const food = new ener.Source(m, 'Forage', { id: 'food', value: 1, at: [100, 220] });
const prey = new ener.Storage(m, 'Prey', { value: 40, at: [330, 220], capacity: 200 });
const predator = new ener.Storage(m, 'Predators', {
  id: 'predator',
  value: 9,
  at: [600, 220],
  capacity: 100,
});
const loss = new ener.HeatSink(m, 'Mortality', { id: 'loss', value: 0, at: [470, 420] });

// Flows
new ener.Flow(m, food, prey, ener.interaction(1, prey), { id: 'births' });
new ener.Flow(m, prey, predator, ener.interaction(0.02, predator), { id: 'predation' });
new ener.Flow(m, predator, loss, ener.linear(0.4), { id: 'predator_deaths' });

export default m;
