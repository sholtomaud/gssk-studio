import * as ener from '../../../../src/sdk/energese/index.ts';

const m = new ener.Model('Paying for electricity and streaming', {
  description:
    'Odum’s transactions: electricity and a video stream flow in, money flows out against each (FR-TRX-001).',
  tStart: 0,
  tEnd: 12,
  dt: 0.05,
  method: 'rk4',
});

// Carriers
new ener.Carrier(m, 'electricity', { label: 'Electricity', unit: 'kW.h' });
new ener.Carrier(m, 'video', { label: 'Video stream', unit: 'GBy' });
new ener.Carrier(m, 'aud', { label: 'Australian dollar', currency: 'AUD' });

// Symbols
const grid = new ener.Source(m, 'Electricity grid', {
  id: 'grid',
  value: 1,
  carrier: 'electricity',
  at: [100, 140],
});
const appliances = new ener.HeatSink(m, 'Appliances', {
  value: 0,
  carrier: 'electricity',
  at: [660, 140],
});
const streaming = new ener.Source(m, 'Streaming service', {
  id: 'streaming',
  value: 1,
  carrier: 'video',
  at: [100, 540],
});
const screen = new ener.HeatSink(m, 'Screen time', {
  id: 'screen',
  value: 0,
  carrier: 'video',
  at: [660, 540],
});
const salary = new ener.Source(m, 'Salary', { value: 300, carrier: 'aud', at: [880, 340] });
const bank = new ener.Storage(m, 'Bank account', {
  id: 'bank',
  value: 1000,
  carrier: 'aud',
  at: [660, 340],
  capacity: 30000,
});
const retailer = new ener.Storage(m, 'Power retailer', {
  id: 'retailer',
  value: 0,
  carrier: 'aud',
  at: [100, 280],
  capacity: 2000,
});
const streamer = new ener.Storage(m, 'Streaming company', {
  id: 'streamer',
  value: 0,
  carrier: 'aud',
  at: [100, 400],
  capacity: 500,
});

// Flows
const power = new ener.Flow(m, grid, appliances, ener.constant(300), {
  id: 'power',
  carrier: 'electricity',
});
const stream = new ener.Flow(m, streaming, screen, ener.constant(50), {
  id: 'stream',
  carrier: 'video',
});
new ener.Flow(m, salary, bank, ener.linear(1), { id: 'pay', carrier: 'aud' });
const powerBill = new ener.Flow(m, bank, retailer, ener.constant(96), {
  id: 'power_bill',
  carrier: 'aud',
});
const subscription = new ener.Flow(m, bank, streamer, ener.constant(22), {
  id: 'subscription',
  carrier: 'aud',
});

// Transactions
new ener.Transaction(m, power, { counter: powerBill, purpose: '04', tags: ['utilities'] });
new ener.Transaction(m, stream, { counter: subscription, purpose: '08', tags: ['subscription'] });

export default m;
