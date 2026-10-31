import * as ener from '../../../../src/sdk/energese/index.ts';

const m = new ener.Model('Buying water for a home', {
  description:
    'A utility sells water to a home, which pays from its bank account; the home is packed into one symbol that still shows which store each flow reaches (FR-GRP-001, FR-TRX-001).',
  tStart: 0,
  tEnd: 24,
  dt: 0.05,
  method: 'rk4',
});

// Carriers
new ener.Carrier(m, 'water', { label: 'Water', unit: 'kL' });
new ener.Carrier(m, 'aud', { label: 'Australian dollar', currency: 'AUD' });

// Symbols
const rain = new ener.Source(m, 'Catchment rain', {
  id: 'rain',
  value: 400,
  carrier: 'water',
  at: [100, 140],
});
const dam = new ener.Storage(m, 'Utility dam', {
  id: 'dam',
  value: 5000,
  carrier: 'water',
  at: [280, 140],
  capacity: 20000,
});
const revenue = new ener.Storage(m, 'Utility revenue', {
  id: 'revenue',
  value: 0,
  carrier: 'aud',
  at: [280, 340],
  capacity: 2000,
});
const tank = new ener.Storage(m, 'Water tank', {
  id: 'tank',
  value: 2,
  carrier: 'water',
  at: [640, 140],
  capacity: 10,
});
const use = new ener.HeatSink(m, 'Household use', {
  id: 'use',
  value: 0,
  carrier: 'water',
  at: [820, 140],
});
const bank = new ener.Storage(m, 'Bank account', {
  id: 'bank',
  value: 1500,
  carrier: 'aud',
  at: [640, 340],
  capacity: 5000,
});
const wages = new ener.Source(m, 'Wages', { value: 300, carrier: 'aud', at: [900, 340] });

// Flows
new ener.Flow(m, rain, dam, ener.linear(1), { id: 'inflow', carrier: 'water' });
const supply = new ener.Flow(m, dam, tank, ener.constant(15), { id: 'supply', carrier: 'water' });
new ener.Flow(m, tank, use, ener.linear(7.5), { id: 'drink', carrier: 'water' });
const waterBill = new ener.Flow(m, bank, revenue, ener.constant(45), {
  id: 'water_bill',
  carrier: 'aud',
});
new ener.Flow(m, wages, bank, ener.linear(1), { id: 'earn', carrier: 'aud' });

// Transactions
new ener.Transaction(m, supply, { counter: waterBill, purpose: '04', tags: ['utilities'] });

// Groups
new ener.Group(m, 'Home', [tank, use, bank], { id: 'home', collapsed: true });
new ener.Group(m, 'Water utility', [dam, revenue], { id: 'utility' });

export default m;
