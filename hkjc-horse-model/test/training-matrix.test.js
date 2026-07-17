import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import * as trainingDataset from '../src/training-dataset.js';

describe('training matrix exporter', () => {
  it('exposes a deterministic matrix builder', () => {
    assert.equal(typeof trainingDataset.buildTrainingMatrix, 'function');
  });

  it('builds a deduplicated matrix from real as-of training rows', () => {
    const rows = trainingDataset.buildAsOfTrainingRows([{
      raceId: '2026-01-03-ST-1',
      date: '2026-01-03',
      racecourse: 'ST',
      raceNo: 1,
      distance: 1200,
      surface: 'TURF',
      runners: [
        { horseId: 'H1', horseNo: 1, placing: 1 },
        { horseId: 'H2', horseNo: 2, placing: 2 },
      ],
    }]);

    const matrix = trainingDataset.buildTrainingMatrix({ rows });

    assert.equal(matrix.rows.length, 2);
    assert.equal(matrix.columns.filter((column) => column === 'racecourse').length, 1);
    assert.equal(matrix.columns.filter((column) => column === 'fieldSize').length, 1);
    assert.deepEqual(
      matrix.rows.map(({ raceId, racecourse, fieldSize }) => ({ raceId, racecourse, fieldSize })),
      [
        { raceId: '2026-01-03-ST-1', racecourse: 'ST', fieldSize: 2 },
        { raceId: '2026-01-03-ST-1', racecourse: 'ST', fieldSize: 2 },
      ],
    );
  });

  it('keeps approved metadata first, sorts nested feature columns, and preserves JSON values', () => {
    const matrix = trainingDataset.buildTrainingMatrix({
      rows: [
        trainingRow({
          raceId: 'R2',
          horseId: 'H2',
          horseNo: 2,
          targetWin: 0,
          features: {
            zScore: 2,
            poolLabel: 'A, "quoted" 馬',
            marketWinOddsT30: null,
          },
        }),
        trainingRow({
          raceId: 'R1',
          horseId: 'H1',
          features: {
            tianxiCategory: '在港',
            draw: 4,
            marketWinOddsT30: 3.4,
          },
          unexpectedTopLevel: 'must not be exported',
        }),
      ],
    });

    assert.deepEqual(matrix.columns, [
      'raceId', 'date', 'split', 'horseId', 'horseNo',
      'racecourse', 'raceNo', 'fieldSize', 'targetWin', 'targetPlace',
      'draw', 'marketWinOddsT30', 'poolLabel', 'tianxiCategory', 'zScore',
    ]);
    assert.deepEqual(matrix.rows[0], {
      raceId: 'R2', date: '2026-01-03', split: 'holdout', horseId: 'H2', horseNo: 2,
      racecourse: 'ST', raceNo: 1, fieldSize: 12, targetWin: 0, targetPlace: 1,
      draw: null, marketWinOddsT30: null, poolLabel: 'A, "quoted" 馬',
      tianxiCategory: null, zScore: 2,
    });

    const jsonl = trainingDataset.serializeTrainingMatrix(matrix, 'jsonl');
    const exported = jsonl.trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(exported, matrix.rows);
    assert.deepEqual(Object.keys(exported[0]), matrix.columns);
  });

  it('serializes CSV with correct quoting and empty fields for missing values', () => {
    const matrix = trainingDataset.buildTrainingMatrix({
      rows: [trainingRow({
        features: { category: 'A, "quoted" 馬', missing: null },
      })],
    });

    assert.equal(
      trainingDataset.serializeTrainingMatrix(matrix, 'csv'),
      [
        'raceId,date,split,horseId,horseNo,racecourse,raceNo,fieldSize,targetWin,targetPlace,category,missing',
        'R1,2026-01-03,holdout,H1,1,ST,1,12,1,1,"A, ""quoted"" 馬",',
        '',
      ].join('\n'),
    );
  });

  it('deduplicates identical non-label metadata features and rejects mismatched values', () => {
    const deduplicatedMetadataColumns = [
      'raceId', 'date', 'split', 'horseId', 'horseNo', 'racecourse', 'raceNo', 'fieldSize',
    ];
    const baseRow = trainingRow();

    for (const featureName of deduplicatedMetadataColumns) {
      const matrix = trainingDataset.buildTrainingMatrix({
        rows: [trainingRow({ features: { [featureName]: baseRow[featureName] } })],
      });

      assert.equal(matrix.columns.filter((column) => column === featureName).length, 1);
      assert.equal(matrix.rows[0][featureName], baseRow[featureName]);
      assert.throws(
        () => trainingDataset.buildTrainingMatrix({
          rows: [trainingRow({ features: { [featureName]: differentScalar(baseRow[featureName]) } })],
        }),
        new RegExp(`feature ${featureName}.*reserved metadata column.*does not match`, 'i'),
      );
    }
  });

  it('rejects label metadata features as leakage even when values match', () => {
    for (const featureName of ['targetWin', 'targetPlace']) {
      assert.throws(
        () => trainingDataset.buildTrainingMatrix({
          rows: [trainingRow({ features: { [featureName]: trainingRow()[featureName] } })],
        }),
        /leakage/i,
      );
    }
  });

  it('rejects composite post-race leakage names while allowing normal pre-race features', () => {
    for (const featureName of ['officialResult', 'dividendAmount', 'postRaceComment']) {
      assert.throws(
        () => trainingDataset.buildTrainingMatrix({ rows: [trainingRow({ features: { [featureName]: 1 } })] }),
        /leakage/i,
      );
    }

    for (const featureName of ['preRaceComment', 'marketWinOddsT30', 'horseAverageLbwBefore']) {
      assert.doesNotThrow(() => trainingDataset.buildTrainingMatrix({
        rows: [trainingRow({ features: { [featureName]: 1 } })],
      }));
    }
  });

  it('rejects malformed input and explicit post-race leakage without rejecting as-of LBW features', () => {
    assert.throws(() => trainingDataset.buildTrainingMatrix({}), /rows/i);
    assert.throws(() => trainingDataset.buildTrainingMatrix({ rows: [{}] }), /features|raceId/i);
    assert.throws(
      () => trainingDataset.buildTrainingMatrix({ rows: [trainingRow({ features: { targetWin: 1 } })] }),
      /leakage|reserved metadata column/i,
    );
    assert.throws(
      () => trainingDataset.buildTrainingMatrix({ rows: [trainingRow({ features: { postRacePayout: 10 } })] }),
      /leakage/i,
    );
    assert.throws(
      () => trainingDataset.buildTrainingMatrix({ rows: [trainingRow({ features: { market: { win: 3 } } })] }),
      /scalar/i,
    );
    assert.throws(
      () => trainingDataset.buildTrainingMatrix({ rows: [trainingRow({ features: { marketWinOddsT30: undefined } })] }),
      /scalar/i,
    );
    assert.doesNotThrow(() => trainingDataset.buildTrainingMatrix({
      rows: [trainingRow({ features: { horseAverageLbwBefore: 1.25 } })],
    }));
    assert.throws(() => trainingDataset.serializeTrainingMatrix({ columns: [], rows: [] }, 'parquet'), /format/i);
  });

  it('exports a generated training dataset through the CLI using format or output extension', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'training-matrix-'));
    try {
      const inputPath = path.join(tempDir, 'training-dataset.json');
      const csvPath = path.join(tempDir, 'matrix.csv');
      const jsonlPath = path.join(tempDir, 'matrix.jsonl');
      await writeFile(inputPath, JSON.stringify({
        generatedAt: '2026-07-18T00:00:00.000Z',
        rows: [trainingRow({ features: { marketWinOddsT30: 3.4 } })],
      }));

      const csvResult = runCli('training-matrix', '--input', inputPath, '--output', csvPath, '--format', 'csv');
      assert.equal(csvResult.status, 0, csvResult.stderr);
      assert.match(await readFile(csvPath, 'utf8'), /^raceId,date,split,horseId,/);

      const jsonlResult = runCli('training-matrix', '--input', inputPath, '--output', jsonlPath);
      assert.equal(jsonlResult.status, 0, jsonlResult.stderr);
      assert.deepEqual(JSON.parse(await readFile(jsonlPath, 'utf8')), {
        raceId: 'R1', date: '2026-01-03', split: 'holdout', horseId: 'H1', horseNo: 1,
        racecourse: 'ST', raceNo: 1, fieldSize: 12, targetWin: 1, targetPlace: 1,
        marketWinOddsT30: 3.4,
      });

      const invalidResult = runCli('training-matrix', '--input', inputPath, '--output', csvPath, '--format', 'parquet');
      assert.notEqual(invalidResult.status, 0);
      assert.match(invalidResult.stderr, /Unsupported training matrix format: parquet/);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

function trainingRow(overrides = {}) {
  return {
    raceId: 'R1',
    date: '2026-01-03',
    split: 'holdout',
    horseId: 'H1',
    horseNo: 1,
    racecourse: 'ST',
    raceNo: 1,
    fieldSize: 12,
    targetWin: 1,
    targetPlace: 1,
    features: {},
    ...overrides,
  };
}

function differentScalar(value) {
  return typeof value === 'number' ? value + 1 : `${value}-different`;
}

function runCli(...args) {
  return spawnSync(process.execPath, ['hkjc-horse-model/src/cli.js', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}
