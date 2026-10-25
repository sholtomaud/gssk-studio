import { describe, expect, it } from 'vitest';
import { parseCsv } from '../../src/fit/csv.ts';
import {
  guessTarget,
  observationsFromCsv,
  ObservationFormatError,
} from '../../src/fit/observations.ts';
import { fitPairs, fitSeries, interpolate } from '../../src/fit/stats.ts';
import { EXAMPLES } from '../../src/model/examples/index.ts';
import { parseModel, serialiseModel } from '../../src/model/io.ts';
import { removeNode, renameNode, toggleSensor } from '../../src/model/ops.ts';

describe('CSV (FR-OBS-001)', () => {
  it('reads quoted fields, CRLF, a BOM, and semicolons', () => {
    expect(parseCsv('﻿t,"a, b",c\r\n0,1,"x ""y"""\r\n\r\n1,2,3\n')).toEqual({
      headers: ['t', 'a, b', 'c'],
      rows: [
        ['0', '1', 'x "y"'],
        ['1', '2', '3'],
      ],
    });
    expect(parseCsv('t;v\n0;1,5\n').rows).toEqual([['0', '1,5']]);
  });
});

describe('observations from a file', () => {
  const model = EXAMPLES[1]!.model; // predator-prey: food, prey, predator, loss

  it('maps columns to nodes by id or label, and keeps the rest unmapped', () => {
    const obs = observationsFromCsv(
      'time,Prey,PREDATORS,rain\n0,40,9,1\n10,,12,2\n5,30,10,\n',
      model,
      'f.csv'
    );
    expect(obs.map((o) => [o.id, o.target])).toEqual([
      ['prey', 'prey'],
      ['predators', 'predator'],
      ['rain', null],
    ]);
    // Sorted by time, blank cells dropped.
    expect(obs[0]).toMatchObject({ times: [0, 5], values: [40, 30], source: 'f.csv' });
    expect(obs[1]?.times).toEqual([0, 5, 10]);
  });

  it('names a non-numeric time row', () => {
    expect(() => observationsFromCsv('t,prey\n0,1\nnoon,2\n', model, 'x')).toThrow(/Row 3/);
    expect(() => observationsFromCsv('only\n1\n', model, 'x')).toThrow(ObservationFormatError);
  });

  it('can target a sensed flow', () => {
    const m = toggleSensor(model, 'predation');
    expect(guessTarget(m, 'predation')).toBe('flow:predation');
    expect(guessTarget(model, 'predation')).toBeNull();
  });

  it('follows renames and unmaps on delete, and survives a file round trip', () => {
    const m = structuredClone(model);
    m._observations = observationsFromCsv('t,prey\n0,40\n1,41\n', m, 'f.csv');
    expect(renameNode(m, 'prey', 'hares')._observations?.[0]?.target).toBe('hares');
    expect(removeNode(m, 'prey')._observations?.[0]?.target).toBeNull();
    expect(parseModel(serialiseModel(m)).model._observations).toEqual(m._observations);
  });
});

describe('fit statistics (FR-FIT-001)', () => {
  const obs = [1, 2, 3, 4];

  it('scores a perfect fit as perfect', () => {
    const f = fitPairs(obs, obs);
    expect(f).toMatchObject({ n: 4, rmse: 0, mae: 0, bias: 0, nse: 1 });
    expect(f.r2).toBeCloseTo(1, 12);
    expect(f.kge).toBeCloseTo(1, 12);
  });

  it('matches hand-computed values for an offset', () => {
    const f = fitPairs(
      obs.map((v) => v + 1),
      obs
    );
    expect(f.bias).toBe(1);
    expect(f.rmse).toBe(1);
    expect(f.r2).toBeCloseTo(1, 12);
    expect(f.nse).toBeCloseTo(1 - 4 / 5, 12); // SSE 4, SST 5
    expect(f.kge).toBeCloseTo(1 - 0.4, 12); // r 1, α 1, β 3.5/2.5
  });

  it('gives NSE 0 for the observed mean, and no KGE without variance', () => {
    const f = fitPairs([2.5, 2.5, 2.5, 2.5], obs);
    expect(f.nse).toBeCloseTo(0, 12);
    expect(f.kge).toBeNaN();
  });

  it('interpolates the run at observation times and leaves out those outside it', () => {
    expect(interpolate([0, 10], [0, 100], 2.5)).toBe(25);
    expect(interpolate([0, 10], [0, 100], 11)).toBeNaN();
    const f = fitSeries([0, 10], [0, 100], [-1, 5, 10, 20], [0, 50, 100, 200]);
    expect(f).toMatchObject({ n: 2, excluded: 2, rmse: 0 });
  });
});
