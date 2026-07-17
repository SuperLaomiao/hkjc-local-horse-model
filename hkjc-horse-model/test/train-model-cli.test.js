import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

describe('train-model CLI', () => {
  it('trains a compact logistic baseline report from a training dataset', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-train-'));
    try {
      const inputPath = path.join(tempDir, 'training-dataset.json');
      const outputPath = path.join(tempDir, 'model-training-report.json');
      await mkdir(tempDir, { recursive: true });
      await writeFile(inputPath, JSON.stringify(trainingFixture(), null, 2), 'utf8');

      const result = spawnSync(process.execPath, [
        'hkjc-horse-model/src/cli.js',
        'train-model',
        '--input',
        inputPath,
        '--output',
        outputPath,
        '--iterations',
        '80',
        '--learningRate',
        '0.15',
      ], {
        cwd: path.resolve(import.meta.dirname, '..', '..'),
        encoding: 'utf8',
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /Trained model logit-runner-v1/);
      const report = JSON.parse(await readFile(outputPath, 'utf8'));
      assert.equal(report.modelId, 'logit-runner-v1');
      assert.equal(report.training.input, 'training-dataset.json');
      assert.equal(JSON.stringify(report).includes(tempDir), false);
      assert.equal(report.training.externalFeatures.tianxi.availableFeatureRows, 6);
      assert.equal(report.metrics.bySplit.train.races, 2);
      assert.equal(report.metrics.bySplit.validation.races, 1);
      assert.equal(report.metrics.bySplit.holdout.races, 1);
      assert.equal(report.features.includes('horseWinRateBefore'), true);
      assert.equal(report.features.includes('marketWinOddsT30'), true);
      assert.equal(report.features.includes('marketWinOddsPctChangeT60ToT30'), true);
      for (const feature of expectedPoolModelFeatures()) {
        assert.equal(report.features.includes(feature), true, `missing pool model feature ${feature}`);
      }
      assert.equal(report.features.includes('tianxiFormAvailable'), true);
      assert.equal(report.features.includes('tianxiPriorWinRate'), true);
      assert.equal(report.features.includes('tianxiLatestRating'), true);
      assert.equal(report.features.includes('tianxiSameDistanceWinRate'), true);
      assert.equal(report.weights.length, report.features.length + 1);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

function expectedPoolModelFeatures() {
  const definitions = [
    ['Win', 'MarketShare', 'Imbalance'],
    ['Place', 'MarketShare', 'Imbalance'],
    ['Quinella', 'InvolvementShare', 'InvolvementImbalance'],
    ['QuinellaPlace', 'InvolvementShare', 'InvolvementImbalance'],
  ];
  const windows = ['T30', 'T10', 'T3'];
  const features = definitions.flatMap(([pool, share, imbalance]) => windows.flatMap((window) => [
    `pool${pool}OddsAvailable${window}`,
    `pool${pool}InvestmentAvailable${window}`,
    `pool${pool}Available${window}`,
    `pool${pool}Investment${window}`,
    `pool${pool}${share}${window}`,
    `pool${pool}EstimatedMoney${window}`,
    `pool${pool}CrowdingRatio${window}`,
    `pool${pool}Concentration${window}`,
    `pool${pool}Overround${window}`,
    `pool${pool}${imbalance}${window}`,
  ]));
  features.push(...definitions.flatMap(([pool]) => [
    `pool${pool}InvestmentPctChangeT60ToT30`,
    `pool${pool}InvestmentPctChangeT30ToT10`,
    `pool${pool}InvestmentPctChangeT10ToT3`,
  ]));
  return features;
}

function trainingFixture() {
  return {
    generatedAt: '2026-07-07T00:00:00.000Z',
    summary: { rows: 8, races: 4 },
    externalFeatures: {
      tianxi: {
        sourceId: 'sleepingarhat-tianxi-database',
        checkoutRef: 'test-checkout',
        availableFeatureRows: 6,
      },
    },
    rows: [
      row('r1', '2023-01-01', 'train', 'A', 1, { horseWinRateBefore: 0.4, jockeyWinRateBefore: 0.3, trainerWinRateBefore: 0.2, draw: 1 }),
      row('r1', '2023-01-01', 'train', 'B', 0, { horseWinRateBefore: 0.1, jockeyWinRateBefore: 0.1, trainerWinRateBefore: 0.1, draw: 8 }),
      row('r2', '2023-02-01', 'train', 'C', 1, { horseWinRateBefore: 0.5, jockeyWinRateBefore: 0.4, trainerWinRateBefore: 0.3, draw: 2 }),
      row('r2', '2023-02-01', 'train', 'D', 0, { horseWinRateBefore: 0.05, jockeyWinRateBefore: 0.1, trainerWinRateBefore: 0.1, draw: 9 }),
      row('r3', '2024-01-01', 'validation', 'E', 1, { horseWinRateBefore: 0.45, jockeyWinRateBefore: 0.35, trainerWinRateBefore: 0.25, draw: 3 }),
      row('r3', '2024-01-01', 'validation', 'F', 0, { horseWinRateBefore: 0.08, jockeyWinRateBefore: 0.1, trainerWinRateBefore: 0.1, draw: 10 }),
      row('r4', '2026-01-01', 'holdout', 'G', 1, { horseWinRateBefore: 0.5, jockeyWinRateBefore: 0.35, trainerWinRateBefore: 0.25, draw: 2 }),
      row('r4', '2026-01-01', 'holdout', 'H', 0, { horseWinRateBefore: 0.05, jockeyWinRateBefore: 0.1, trainerWinRateBefore: 0.1, draw: 11 }),
    ],
  };
}

function row(raceId, date, split, horseId, targetWin, features) {
  return {
    raceId,
    date,
    split,
    horseId,
    horseNo: horseId.charCodeAt(0),
    horseName: `Horse ${horseId}`,
    targetWin,
    targetPlace: targetWin,
    fieldSize: 2,
    features: {
      distance: 1200,
      raceClass: 4,
      fieldSize: 2,
      actualWeight: 120,
      horseRunsBefore: 4,
      horsePlacesBefore: 2,
      horsePlaceRateBefore: 0.25,
      jockeyRunsBefore: 10,
      jockeyPlacesBefore: 3,
      jockeyPlaceRateBefore: 0.2,
      trainerRunsBefore: 20,
      trainerPlacesBefore: 5,
      trainerPlaceRateBefore: 0.2,
      distanceSurfaceStartsBefore: 2,
      distanceSurfaceWinRateBefore: 0.1,
      distanceSurfacePlaceRateBefore: 0.2,
      marketWinOddsT30: 4.2,
      marketWinImpliedProbT30: 0.238095,
      marketWinRankT30: 1,
      marketWinOddsPctChangeT60ToT30: -0.125,
      marketPlaceOddsT30: 1.6,
      marketPlaceImpliedProbT30: 0.625,
      marketPlaceRankT30: 1,
      marketPlaceOddsPctChangeT60ToT30: -0.058824,
      ...features,
    },
  };
}
