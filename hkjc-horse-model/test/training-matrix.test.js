import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import * as trainingDataset from '../src/training-dataset.js';
import { writeTrainingMatrixAtomically } from '../src/training-matrix-writer.js';

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

  it('sorts feature columns by Unicode code point rather than the host locale', () => {
    const matrix = trainingDataset.buildTrainingMatrix({
      rows: [trainingRow({ features: { z: 1, ä: 2, a: 3 } })],
    });

    assert.deepEqual(matrix.columns.slice(10), ['a', 'z', 'ä']);
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

  it('deduplicates exact generator metadata features but rejects other metadata and identifier aliases', () => {
    const deduplicatedMetadataColumns = ['racecourse', 'fieldSize'];
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

    for (const featureName of [
      'raceId', 'date', 'split', 'horseId', 'horseNo', 'raceNo',
      'race_id', 'horse_id', 'runner_id', 'race_identifier', 'horseIdentifier',
      'race_course', 'field_size', 'raceNumber', 'race_number', 'horseNumber',
      'horse_number', 'runnerNumber', 'runner_number', 'runnerNo',
    ]) {
      assert.throws(
        () => trainingDataset.buildTrainingMatrix({
          rows: [trainingRow({ features: { [featureName]: 'not-a-feature' } })],
        }),
        /metadata|identifier/i,
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

  it('rejects post-race result fields and preserves explicitly timed pre-race features', () => {
    for (const featureName of [
      'officialResult', 'officialResults', 'raceResults', 'resultsStatus', 'finishingOrder',
      'dividendAmount', 'postRaceComment', 'finishTime', 'finishSeconds', 'racePosition',
      'racePlacing', 'placingPosition', 'finalRank', 'win',
    ]) {
      assert.throws(
        () => trainingDataset.buildTrainingMatrix({ rows: [trainingRow({ features: { [featureName]: 1 } })] }),
        /leakage/i,
      );
    }

    for (const featureName of [
      'preRaceComment', 'horseWinsBefore', 'horseWinRateBefore', 'marketWinOddsT30',
      'marketWinRankT30', 'horseAverageLbwBefore', 'priorFinishPosition', 'placingRankAsOf',
    ]) {
      assert.doesNotThrow(() => trainingDataset.buildTrainingMatrix({
        rows: [trainingRow({ features: { [featureName]: 1 } })],
      }));
    }
  });

  it('rejects obvious winner, outcome, and entry aliases without rejecting historical as-of features', () => {
    for (const featureName of [
      'winnerFlag', 'winner_flag', 'isWinner', 'is_winner', 'won',
      'raceOutcome', 'race_outcome', 'entryNo', 'entry_no',
      'entryNumber', 'entry_number',
    ]) {
      assert.throws(
        () => trainingDataset.buildTrainingMatrix({ rows: [trainingRow({ features: { [featureName]: 1 } })] }),
        /leakage|metadata|identifier/i,
        featureName,
      );
    }

    for (const featureName of [
      'horseWinsBefore', 'priorRaceResult', 'historicalResult',
      'raceResultAsOf', 'marketWinOddsT30',
    ]) {
      assert.doesNotThrow(
        () => trainingDataset.buildTrainingMatrix({ rows: [trainingRow({ features: { [featureName]: 1 } })] }),
        featureName,
      );
    }
  });

  it('prepares validated source rows for streaming without creating dense matrix rows', () => {
    const row = trainingRow({ features: { z: 1, a: 2 } });
    const prepared = trainingDataset.prepareTrainingMatrix({ rows: [row] });

    assert.deepEqual(prepared.columns.slice(10), ['a', 'z']);
    assert.equal(prepared.sourceRows[0], row);
    assert.equal(Object.hasOwn(prepared.sourceRows[0], 'a'), false);
  });

  it('rejects a hand-built prepared matrix when sourceRows contain a leakage feature', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'training-matrix-prepared-validation-'));
    try {
      const outputPath = path.join(tempDir, 'matrix.jsonl');
      const prepared = {
        columns: [
          'raceId', 'date', 'split', 'horseId', 'horseNo',
          'racecourse', 'raceNo', 'fieldSize', 'targetWin', 'targetPlace',
        ],
        sourceRows: [trainingRow({ features: { winnerFlag: 1 } })],
      };

      await assert.rejects(
        writeTrainingMatrixAtomically({ outputPath, format: 'jsonl', matrix: prepared }),
        /leakage/i,
      );

      assert.deepEqual(await readdir(tempDir), []);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects a hand-built prepared matrix when columns do not match sourceRows features', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'training-matrix-column-validation-'));
    try {
      const outputPath = path.join(tempDir, 'matrix.jsonl');
      const prepared = {
        columns: [
          'raceId', 'date', 'split', 'horseId', 'horseNo',
          'racecourse', 'raceNo', 'fieldSize', 'targetWin', 'targetPlace', 'marketWinOddsT30',
        ],
        sourceRows: [trainingRow()],
      };

      await assert.rejects(
        writeTrainingMatrixAtomically({ outputPath, format: 'jsonl', matrix: prepared }),
        /columns.*sourceRows/i,
      );

      assert.deepEqual(await readdir(tempDir), []);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('atomically replaces a destination with streamed matrix lines', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'training-matrix-atomic-'));
    try {
      const outputPath = path.join(tempDir, 'matrix.jsonl');
      await writeFile(outputPath, 'old-output\n', 'utf8');
      const prepared = trainingDataset.prepareTrainingMatrix({
        rows: [trainingRow({ features: { marketWinOddsT30: 3.4 } })],
      });

      await writeTrainingMatrixAtomically({ outputPath, format: 'jsonl', matrix: prepared });

      assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), {
        raceId: 'R1', date: '2026-01-03', split: 'holdout', horseId: 'H1', horseNo: 1,
        racecourse: 'ST', raceNo: 1, fieldSize: 12, targetWin: 1, targetPlace: 1,
        marketWinOddsT30: 3.4,
      });
      assert.deepEqual((await readdir(tempDir)).filter((name) => name.includes('.tmp')), []);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('cleans the temporary file when atomic rename fails and preserves the original destination', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'training-matrix-atomic-'));
    try {
      const outputPath = path.join(tempDir, 'matrix.jsonl');
      await writeFile(outputPath, 'old-output\n', 'utf8');
      const prepared = trainingDataset.prepareTrainingMatrix({ rows: [trainingRow()] });
      await assert.rejects(
        writeTrainingMatrixAtomically({
          outputPath,
          format: 'jsonl',
          matrix: prepared,
          renameFn: async () => {
            throw new Error('simulated rename failure');
          },
        }),
        /simulated rename failure/,
      );

      assert.equal(await readFile(outputPath, 'utf8'), 'old-output\n');
      assert.deepEqual((await readdir(tempDir)).filter((name) => name.includes('.tmp')), []);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('propagates a real write-stream failure, removes the temporary file, and preserves the destination', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'training-matrix-stream-failure-'));
    try {
      const outputPath = path.join(tempDir, 'matrix.jsonl');
      await writeFile(outputPath, 'old-output\n', 'utf8');
      const prepared = trainingDataset.prepareTrainingMatrix({
        rows: Array.from({ length: 20 }, (_, index) => trainingRow({
          raceId: `R${index}`,
          horseId: `H${index}`,
          features: { marketWinOddsT30: index + 1 },
        })),
      });
      let writeCalls = 0;

      await assert.rejects(
        writeTrainingMatrixAtomically({
          outputPath,
          format: 'jsonl',
          matrix: prepared,
          highWaterMark: 1,
          createWriteStreamFn: (temporaryPath, options) => {
            const stream = createWriteStream(temporaryPath, options);
            const write = stream.write.bind(stream);
            stream.write = (...args) => {
              writeCalls += 1;
              if (writeCalls === 3) {
                queueMicrotask(() => stream.destroy(new Error('simulated mid-stream write failure')));
                return false;
              }
              return write(...args);
            };
            return stream;
          },
        }),
        /simulated mid-stream write failure/,
      );

      assert.equal(writeCalls, 3);
      assert.equal(await readFile(outputPath, 'utf8'), 'old-output\n');
      assert.deepEqual((await readdir(tempDir)).filter((name) => name.includes('.tmp')), []);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('streams successfully under low highWaterMark backpressure', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'training-matrix-backpressure-'));
    try {
      const outputPath = path.join(tempDir, 'matrix.jsonl');
      const prepared = trainingDataset.prepareTrainingMatrix({
        rows: Array.from({ length: 64 }, (_, index) => trainingRow({
          raceId: `R${index}`,
          horseId: `H${index}`,
          features: { marketWinOddsT30: index + 1 },
        })),
      });
      let backpressureSignals = 0;

      await writeTrainingMatrixAtomically({
        outputPath,
        format: 'jsonl',
        matrix: prepared,
        highWaterMark: 1,
        createWriteStreamFn: (temporaryPath, options) => {
          assert.equal(options.highWaterMark, 1);
          const stream = createWriteStream(temporaryPath, options);
          const write = stream.write.bind(stream);
          stream.write = (...args) => {
            const accepted = write(...args);
            if (!accepted) backpressureSignals += 1;
            return accepted;
          };
          return stream;
        },
      });

      assert.equal((await readFile(outputPath, 'utf8')).trim().split('\n').length, 64);
      assert.ok(backpressureSignals > 0);
      assert.deepEqual((await readdir(tempDir)).filter((name) => name.includes('.tmp')), []);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
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
