import * as ener from '../../../../src/sdk/energese/index.ts';

const m = new ener.Model('Seasonal river', {
  description:
    'Rain is forced by a seasonal sine wave; a wetland stores the flood and drains to the river.',
  tStart: 0,
  tEnd: 48,
  dt: 0.05,
  method: 'rk4',
});

// Symbols
const rain = new ener.Source(m, 'Seasonal rain', {
  id: 'rain',
  value: 10,
  at: [100, 220],
  forcing: { waveform: 'sine', period: 12, mean: 10, amplitude: 8 },
});
const wetland = new ener.Storage(m, 'Wetland', { value: 40, at: [360, 220], capacity: 150 });
const river = new ener.HeatSink(m, 'River', { value: 0, at: [620, 220] });
const air = new ener.HeatSink(m, 'Evaporation', { id: 'air', value: 0, at: [360, 420] });

// Flows
new ener.Flow(m, rain, wetland, ener.linear(0.5), { id: 'inflow' });
new ener.Flow(m, wetland, river, ener.linear(0.08), { id: 'drainage' });
new ener.Flow(m, wetland, air, ener.linear(0.01), {
  id: 'evaporation',
  forcing: { waveform: 'square', period: 12, phase: 3, mean: 0.03, amplitude: 0.02 },
});

export default m;
