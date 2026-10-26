import * as ener from '../../../../src/sdk/energese/index.ts';

const m = new ener.Model('Household money', {
  description: 'Income splits into tax, spending and saving; savings earn a return.',
  tStart: 0,
  tEnd: 120,
  dt: 0.1,
  method: 'auto',
});

// Symbols
const income = new ener.Source(m, 'Income', { value: 100, at: [80, 270] });
const bank = new ener.Storage(m, 'Bank account', {
  id: 'bank',
  value: 1000,
  at: [260, 270],
  capacity: 5000,
});
const savings = new ener.Storage(m, 'Investments', {
  id: 'savings',
  value: 5000,
  at: [480, 420],
  capacity: 50000,
});
const spending = new ener.HeatSink(m, 'Spending', { value: 0, at: [720, 270] });
const tax = new ener.HeatSink(m, 'Tax', { value: 0, at: [260, 470] });

// Flows
new ener.Flow(m, income, bank, ener.linear(0.7), { id: 'pay' });
new ener.Flow(m, income, tax, ener.linear(0.3), { id: 'withholding' });
new ener.Flow(m, bank, spending, ener.linear(0.05), { id: 'spend' });
new ener.Flow(m, bank, savings, ener.linear(0.01), { id: 'save' });
new ener.Flow(m, savings, bank, ener.linear(0.002), { id: 'drawdown' });

// Boundaries
new ener.Boundary(m, 'Household', { id: 'home', x: 170, y: 160, w: 450, h: 380 });

export default m;
