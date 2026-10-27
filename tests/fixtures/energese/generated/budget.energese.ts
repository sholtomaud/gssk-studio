import * as ener from '../../../../src/sdk/energese/index.ts';

const m = new ener.Model('Household budget', {
  description:
    'Pay into the bank; every bill and renewal is its own flow out, packed into nested groups (FR-GRP-001).',
  tStart: 0,
  tEnd: 36,
  dt: 0.05,
  method: 'rk4',
});

// Symbols
const salary = new ener.Source(m, 'Salary', { value: 5200, at: [100, 300] });
const bank = new ener.Storage(m, 'Bank account', {
  id: 'bank',
  value: 2000,
  at: [340, 300],
  capacity: 25000,
});
const savings = new ener.Storage(m, 'Savings', { value: 0, at: [340, 520], capacity: 50000 });
const rent = new ener.HeatSink(m, 'Rent', { value: 0, at: [640, 90] });
const electricity = new ener.HeatSink(m, 'Electricity', { value: 0, at: [760, 90] });
const water = new ener.HeatSink(m, 'Water', { value: 0, at: [880, 90] });
const phone = new ener.HeatSink(m, 'Phone', { value: 0, at: [640, 250] });
const internet = new ener.HeatSink(m, 'Internet', { value: 0, at: [760, 250] });
const groceries = new ener.HeatSink(m, 'Groceries', { value: 0, at: [640, 410] });
const eatingOut = new ener.HeatSink(m, 'Eating out', { value: 0, at: [760, 410] });
const clothes = new ener.HeatSink(m, 'Clothes', { value: 0, at: [880, 410] });
const shoes = new ener.HeatSink(m, 'Shoes', { value: 0, at: [1000, 410] });
const carInsurance = new ener.HeatSink(m, 'Car insurance', { value: 0, at: [640, 570] });
const computer = new ener.HeatSink(m, 'Computer', { value: 0, at: [760, 570] });

// Flows
new ener.Flow(m, salary, bank, ener.linear(1), { id: 'pay' });
new ener.Flow(m, bank, savings, ener.linear(0.1), { id: 'save' });
new ener.Flow(m, bank, rent, ener.constant(1800), { id: 'rent_bill' });
new ener.Flow(m, bank, electricity, ener.constant(150), { id: 'electricity_bill' });
new ener.Flow(m, bank, water, ener.constant(60), { id: 'water_bill' });
new ener.Flow(m, bank, phone, ener.constant(50), { id: 'phone_bill' });
new ener.Flow(m, bank, internet, ener.constant(70), { id: 'internet_bill' });
new ener.Flow(m, bank, groceries, ener.constant(700), { id: 'groceries_bill' });
new ener.Flow(m, bank, eatingOut, ener.constant(250), { id: 'eating_out_bill' });
new ener.Flow(m, bank, clothes, ener.constant(120), { id: 'clothes_bill' });
new ener.Flow(m, bank, shoes, ener.constant(0), {
  id: 'shoes_bill',
  forcing: {
    waveform: 'table',
    times: [0, 1, 6],
    values: [150, 0, 0],
    interpolation: 'step',
    extrapolation: 'cycle',
  },
});
new ener.Flow(m, bank, carInsurance, ener.constant(0), {
  id: 'car_insurance_bill',
  forcing: {
    waveform: 'table',
    times: [0, 1, 12],
    values: [1200, 0, 0],
    interpolation: 'step',
    extrapolation: 'cycle',
  },
});
new ener.Flow(m, bank, computer, ener.constant(0), {
  id: 'computer_bill',
  forcing: {
    waveform: 'table',
    times: [0, 1, 36],
    values: [2400, 0, 0],
    interpolation: 'step',
    extrapolation: 'cycle',
  },
});

// Groups
const expenses = new ener.Group(m, 'Expenses', [], { id: 'expenses', collapsed: true });
new ener.Group(m, 'Housing', [rent, electricity, water], { id: 'housing', parent: expenses });
new ener.Group(m, 'Phone and internet', [phone, internet], { id: 'comms', parent: expenses });
new ener.Group(m, 'Living', [groceries, eatingOut, clothes, shoes], {
  id: 'living',
  parent: expenses,
});
new ener.Group(m, 'Renewals', [carInsurance, computer], {
  id: 'renewals',
  parent: expenses,
  collapsed: true,
});

export default m;
