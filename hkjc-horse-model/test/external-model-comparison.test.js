import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

import { buildExternalModelComparison } from '../src/external-model-comparison.js';
import { syncRaceFilesToDatabase } from '../src/sqlite-store.js';

describe('external model comparison', () => {
  it('builds tomorrow predictions for current and external-inspired models', () => {
    const report = buildExternalModelComparison({
      settledRaces: settledRaces(),
      upcomingRaces: [upcomingRace()],
      trainingReport: trainingReportFixture(),
      generatedAt: '2026-07-07T12:00:00.000Z',
    });

    assert.equal(report.summary.upcomingRaces, 1);
    assert.equal(report.models.some((model) => model.modelId === 'hkjc-current-heuristic'), true);
    assert.equal(report.models.some((model) => model.modelId === 'catowabisabi-lgb-no-odds-proxy'), true);
    assert.equal(report.models.some((model) => model.modelId === 'jerrydaphantom-market-free-calibrated-proxy'), true);
    assert.equal(report.models.some((model) => model.modelId === 'jerrydaphantom-catboost-market-aware'), true);

    const race = report.races[0];
    assert.equal(race.raceId, '2026-07-08-HV-1');
    assert.equal(race.comparison.currentTopPick.horseNo, 1);
    assert.equal(race.comparison.catowabisabi.topQuinellaBox.length, 2);
    assert.equal(race.comparison.jerrydaphantomMarketAware.status, 'pending-live-market');
    assert.match(race.comparison.agreementSummary, /current/);

    const jerrySum = race.models
      .find((model) => model.modelId === 'jerrydaphantom-market-free-calibrated-proxy')
      .predictions
      .reduce((sum, runner) => sum + runner.probability, 0);
    assert.equal(Math.abs(jerrySum - 1) < 0.000001, true);
  });

  it('uses latest live win odds to unlock the market-aware proxy', () => {
    const report = buildExternalModelComparison({
      settledRaces: settledRaces(),
      upcomingRaces: [upcomingRace()],
      trainingReport: trainingReportFixture(),
      marketOddsByRunner: new Map([
        ['2026-07-08-HV-1|1', { winOdds: 3.5 }],
        ['2026-07-08-HV-1|2', { winOdds: 5.0 }],
        ['2026-07-08-HV-1|5', { winOdds: 12.0 }],
      ]),
      generatedAt: '2026-07-07T12:00:00.000Z',
    });

    const race = report.races[0];
    const marketModel = race.models.find((model) => model.modelId === 'jerrydaphantom-catboost-market-aware');
    assert.equal(report.summary.marketAwareReadyRaces, 1);
    assert.equal(marketModel.status, 'available');
    assert.equal(marketModel.predictions.length, 3);
    assert.equal(race.comparison.jerrydaphantomMarketAware.status, 'available');
  });

  it('exposes a CLI command that writes the comparison report from SQLite', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-external-comparison-'));
    try {
      const rawDir = path.join(tempDir, 'raw');
      const upcomingDir = path.join(tempDir, 'upcoming');
      const dbPath = path.join(tempDir, 'hkjc.sqlite');
      const trainingPath = path.join(tempDir, 'model-training-report.json');
      const outputPath = path.join(tempDir, 'external-model-comparison.json');
      await mkdir(rawDir, { recursive: true });
      await mkdir(upcomingDir, { recursive: true });
      await writeFile(path.join(rawDir, '2026-07-01-HV.json'), JSON.stringify(settledRaces(), null, 2), 'utf8');
      await writeFile(path.join(upcomingDir, '2026-07-08-HV.json'), JSON.stringify([upcomingRace()], null, 2), 'utf8');
      await writeFile(trainingPath, JSON.stringify(trainingReportFixture(), null, 2), 'utf8');

      syncRaceFilesToDatabase({ dbPath, inputPath: rawDir, sourceKind: 'raw' });
      syncRaceFilesToDatabase({ dbPath, inputPath: upcomingDir, sourceKind: 'upcoming' });

      const result = spawnSync(process.execPath, [
        'hkjc-horse-model/src/cli.js',
        'external-model-comparison',
        '--db',
        dbPath,
        '--trainingReport',
        trainingPath,
        '--output',
        outputPath,
      ], {
        cwd: path.resolve(import.meta.dirname, '..', '..'),
        encoding: 'utf8',
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /External model comparison/);
      const payload = JSON.parse(await readFile(outputPath, 'utf8'));
      assert.equal(payload.races[0].raceId, '2026-07-08-HV-1');
      assert.equal(payload.summary.modelCount, 4);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

function settledRaces() {
  return [
    race('2026-07-01-HV-1', '2026-07-01', [
      runner('A', 1, 'J1', 'T1', 1),
      runner('B', 2, 'J2', 'T2', 2),
      runner('C', 3, 'J3', 'T3', 3),
    ]),
    race('2026-07-01-HV-2', '2026-07-01', [
      runner('A', 1, 'J1', 'T1', 1),
      runner('B', 2, 'J2', 'T2', 3),
      runner('D', 4, 'J4', 'T4', 2),
    ]),
  ];
}

function upcomingRace() {
  return {
    ...race('2026-07-08-HV-1', '2026-07-08', [
      runner('A', 1, 'J1', 'T1', null),
      runner('B', 2, 'J2', 'T2', null),
      runner('E', 5, 'J5', 'T5', null),
    ]),
    status: 'upcoming',
  };
}

function race(raceId, date, runners) {
  return {
    raceId,
    date,
    racecourse: 'HV',
    raceNo: Number(raceId.split('-').at(-1)),
    raceName: 'TEST HANDICAP',
    startTime: '18:30',
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
    horseNo,
    horseName: `Horse ${horseId}`,
    jockey,
    trainer,
    draw: horseNo,
    actualWeight: 120 + horseNo,
    placing,
    lbw: placing === 1 ? 0 : placing,
  };
}

function trainingReportFixture() {
  const features = [
    'horseWinRateBefore',
    'horsePlaceRateBefore',
    'jockeyWinRateBefore',
    'trainerWinRateBefore',
    'distanceSurfaceWinRateBefore',
    'draw',
  ];
  return {
    modelId: 'logit-runner-v1',
    features,
    weights: [-0.2, 1.6, 0.8, 0.5, 0.4, 0.6, -0.08],
    featureMeans: [0, 0, 0, 0, 0, 5],
    featureStds: [1, 1, 1, 1, 1, 2],
    metrics: {
      bySplit: {
        holdout: {
          logLoss: 0.267266,
          brierScore: 0.07197,
          topPickWinRate: 0.211215,
        },
      },
    },
  };
}
