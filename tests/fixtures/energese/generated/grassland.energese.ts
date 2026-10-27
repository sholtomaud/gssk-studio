import * as ener from '../../../../src/sdk/energese/index.ts';

const m = new ener.Model('Grassland food chain', {
  description: 'Sunlight drives a producer; grazers feed on it; both lose heat.',
  tStart: 0,
  tEnd: 200,
  dt: 0.1,
  method: 'rk4',
});

// Symbols
const sun = new ener.Source(m, 'Sunlight', { id: 'sun', value: 100, at: [100, 260] });
const grass = new ener.Producer(m, 'Grass', { value: 20, at: [330, 260], capacity: 200 });
const grazers = new ener.Consumer(m, 'Grazers', { value: 5, at: [580, 260], capacity: 100 });
const heat = new ener.HeatSink(m, 'Heat', { value: 0, at: [460, 480] });

// Flows
new ener.Flow(m, sun, grass, ener.linear(0.02), { id: 'photosynthesis' });
new ener.Flow(m, grass, grazers, ener.interaction(0.01, grazers), { id: 'grazing' });
new ener.Flow(m, grass, heat, ener.linear(0.01), { id: 'grass_loss' });
new ener.Flow(m, grazers, heat, ener.linear(0.02), { id: 'grazer_loss' });

// Boundaries
new ener.Boundary(m, 'Pasture', { id: 'pasture', x: 220, y: 150, w: 480, h: 420 });

export default m;
