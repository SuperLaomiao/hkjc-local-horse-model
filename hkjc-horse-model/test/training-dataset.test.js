import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildAsOfTrainingRows,
  splitTrainingRows,
  summarizeTrainingRows,
} from '../src/training-dataset.js';

describe('as-of training dataset', () => {
  it('uses only prior races when building runner features', () => {
    const rows = buildAsOfTrainingRows([
      race('2023-12-30-ST-1', '2023-12-30', [
        runner('A', 1, 'J1', 'T1', 1),
        runner('B', 2, 'J2', 'T2', 2),
      ]),
      race('2024-01-07-ST-1', '2024-01-07', [
        runner('A', 1, 'J1', 'T1', 2),
        runner('C', 3, 'J3', 'T3', 1),
      ]),
    ]);

    const firstA = rows.find((row) => row.raceId === '2023-12-30-ST-1' && row.horseId === 'A');
    const secondA = rows.find((row) => row.raceId === '2024-01-07-ST-1' && row.horseId === 'A');
    const secondC = rows.find((row) => row.raceId === '2024-01-07-ST-1' && row.horseId === 'C');

    assert.equal(firstA.features.horseRunsBefore, 0);
    assert.equal(firstA.features.horseWinsBefore, 0);
    assert.equal(firstA.features.jockeyRunsBefore, 0);
    assert.equal(firstA.targetWin, 1);
    assert.equal(firstA.targetPlace, 1);

    assert.equal(secondA.features.horseRunsBefore, 1);
    assert.equal(secondA.features.horseWinsBefore, 1);
    assert.equal(secondA.features.horsePlacesBefore, 1);
    assert.equal(secondA.features.jockeyRunsBefore, 1);
    assert.equal(secondA.features.jockeyWinsBefore, 1);
    assert.equal(secondA.features.trainerRunsBefore, 1);
    assert.equal(secondA.features.trainerWinsBefore, 1);
    assert.equal(secondA.targetWin, 0);
    assert.equal(secondA.targetPlace, 1);

    assert.equal(secondC.features.horseRunsBefore, 0);
    assert.equal(secondC.features.jockeyRunsBefore, 0);
    assert.equal(secondC.targetWin, 1);
  });

  it('assigns fixed calendar splits and summarizes row counts', () => {
    const rows = splitTrainingRows([
      row('2023-12-31', 'a'),
      row('2024-01-01', 'b'),
      row('2025-12-31', 'c'),
      row('2026-01-01', 'd'),
    ]);
    assert.deepEqual(rows.map((item) => item.split), ['train', 'validation', 'validation', 'holdout']);

    const summary = summarizeTrainingRows(rows);
    assert.equal(summary.rows, 4);
    assert.equal(summary.trainRows, 1);
    assert.equal(summary.validationRows, 2);
    assert.equal(summary.holdoutRows, 1);
  });
});

function row(date, horseId) {
  return {
    raceId: `${date}-ST-1`,
    date,
    racecourse: 'ST',
    raceNo: 1,
    horseId,
    targetWin: horseId === 'a' ? 1 : 0,
    targetPlace: 1,
    features: {},
  };
}

function race(raceId, date, runners) {
  return {
    raceId,
    date,
    racecourse: 'ST',
    raceNo: 1,
    distance: 1200,
    surface: 'TURF',
    going: 'GOOD',
    raceClass: 4,
    runners,
  };
}

function runner(horseId, horseNo, jockey, trainer, placing) {
  return {
    horseId,
    horseName: `Horse ${horseId}`,
    horseNo,
    jockey,
    trainer,
    draw: horseNo,
    actualWeight: 120 + horseNo,
    placing,
    lbw: placing === 1 ? 0 : placing,
  };
}
