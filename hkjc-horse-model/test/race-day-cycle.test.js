import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

import { runRaceDayCycle } from '../src/race-day-cycle.js';

describe('race-day cycle', () => {
  it('processes data-ready due windows and writes zero-stake immutable shadow locks', async () => {
    const calls = { collect: 0, score: 0, write: 0 };
    let writtenLocks = [];
    const report = await runRaceDayCycle({
      now: '2026-07-22T10:20:00Z',
      dbPath: '/tmp/hkjc.sqlite',
      windows: ['T-30', 'T-10', 'T-3'],
      pools: ['WIN', 'PLA', 'QIN', 'QPL'],
      dependencies: {
        collectDue: async ({ pools }) => {
          calls.collect += 1;
          assert.deepEqual(pools, ['WIN', 'PLA', 'QIN', 'QPL']);
          return {
            generatedAt: '2026-07-22T10:20:00Z',
            summary: { due: 2, captured: 1, skippedDuplicates: 1, oddsSnapshots: 2, poolSnapshots: 1 },
            due: [
              dueRace(),
              { ...dueRace(), raceId: '2026-07-22-HV-R2', raceNo: 2, status: 'duplicate-skipped' },
            ],
            nextDue: { raceId: '2026-07-22-HV-R1', window: 'T-3', dueAt: '2026-07-22T10:27:00Z' },
          };
        },
        loadRace: ({ raceId }) => raceId === '2026-07-22-HV-R1' ? upcomingRace() : null,
        loadMarketSnapshots: () => [marketSnapshot()],
        scoreRace: async () => {
          calls.score += 1;
          return scoreBundle();
        },
        buildDecisions: () => [{
          pool: 'PLACE',
          combination: [2],
          rawProbability: 0.55,
          conservativeProbability: 0.52,
          paperStake: 10,
          marketWindow: 'T-10',
        }],
        writeLocks: ({ locks }) => {
          calls.write += 1;
          writtenLocks = locks;
          return locks;
        },
      },
    });

    assert.deepEqual(calls, { collect: 1, score: 1, write: 1 });
    assert.equal(writtenLocks.length, 1);
    assert.equal(writtenLocks[0].decision.executionStatus, 'PAPER_ONLY');
    assert.equal(writtenLocks[0].decision.stake, 0);
    assert.equal(report.summary.locksRecorded, 1);
    assert.equal(report.summary.postTimeSkipped, 0);
    assert.deepEqual(report.nextDue, {
      raceId: '2026-07-22-HV-R1',
      window: 'T-3',
      dueAt: '2026-07-22T10:27:00Z',
    });
    assert.match(report.summaryZh, /锁定 1 条/);
  });

  it('skips a captured item at or after post time before scoring', async () => {
    let scored = 0;
    const report = await runRaceDayCycle({
      now: '2026-07-22T10:31:00Z',
      dbPath: '/tmp/hkjc.sqlite',
      dependencies: {
        collectDue: async () => ({
          generatedAt: '2026-07-22T10:31:00Z',
          summary: { due: 1, captured: 1, skippedDuplicates: 0, oddsSnapshots: 2, poolSnapshots: 1 },
          due: [{ ...dueRace(), status: 'captured' }],
          nextDue: null,
        }),
        loadRace: () => upcomingRace(),
        loadMarketSnapshots: () => [marketSnapshot()],
        scoreRace: async () => { scored += 1; return scoreBundle(); },
        buildDecisions: () => [],
        writeLocks: () => [],
      },
    });

    assert.equal(scored, 0);
    assert.equal(report.summary.postTimeSkipped, 1);
    assert.equal(report.races[0].status, 'post-time-skipped');
  });

  it('resumes scoring and locking from an already captured duplicate window', async () => {
    let writes = 0;
    const report = await runRaceDayCycle({
      now: '2026-07-22T10:20:00Z',
      dbPath: '/tmp/hkjc.sqlite',
      dependencies: {
        collectDue: async () => ({
          generatedAt: '2026-07-22T10:20:00Z',
          summary: { due: 1, captured: 0, skippedDuplicates: 1, oddsSnapshots: 0, poolSnapshots: 0 },
          due: [{ ...dueRace(), status: 'duplicate-skipped' }],
          nextDue: null,
        }),
        loadRace: () => upcomingRace(),
        loadMarketSnapshots: () => [marketSnapshot()],
        scoreRace: () => scoreBundle(),
        buildDecisions: () => [{
          pool: 'PLACE',
          combination: [2],
          rawProbability: 0.55,
          conservativeProbability: 0.52,
          paperStake: 10,
          marketWindow: 'T-10',
        }],
        writeLocks: ({ locks }) => { writes += 1; return locks; },
      },
    });

    assert.equal(writes, 1);
    assert.equal(report.summary.captured, 0);
    assert.equal(report.summary.skippedDuplicates, 1);
    assert.equal(report.summary.locksRecorded, 1);
  });

  it('bounds collector retries and reports the retry count', async () => {
    let attempts = 0;
    const report = await runRaceDayCycle({
      now: '2026-07-22T09:00:00Z',
      dbPath: '/tmp/hkjc.sqlite',
      maxRetries: 2,
      dependencies: {
        collectDue: async () => {
          attempts += 1;
          if (attempts < 3) throw new Error('temporary network error');
          return {
            generatedAt: '2026-07-22T09:00:00Z',
            summary: { due: 0, captured: 0, skippedDuplicates: 0, oddsSnapshots: 0, poolSnapshots: 0 },
            due: [],
            nextDue: null,
          };
        },
      },
    });

    assert.equal(attempts, 3);
    assert.equal(report.summary.retries, 2);
    assert.match(report.summaryZh, /重试 2 次/);
  });

  it('exposes a dry-run CLI that writes a private cycle report without network capture', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-race-day-cycle-'));
    const dbPath = path.join(tempDir, 'hkjc.sqlite');
    const outputPath = path.join(tempDir, 'private', 'cycle.json');

    try {
      const result = spawnSync(process.execPath, [
        'hkjc-horse-model/src/cli.js',
        'race-day-cycle',
        '--db',
        dbPath,
        '--now',
        '2026-07-22T09:00:00Z',
        '--dryRun',
        '--output',
        outputPath,
      ], {
        cwd: path.resolve(import.meta.dirname, '..', '..'),
        encoding: 'utf8',
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /赛马日周期/);
      const report = JSON.parse(await readFile(outputPath, 'utf8'));
      assert.equal(report.dryRun, true);
      assert.equal(report.summary.captured, 0);
      assert.equal(report.summary.locksRecorded, 0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

function dueRace() {
  return {
    raceId: '2026-07-22-HV-R1',
    date: '2026-07-22',
    racecourse: 'HV',
    raceNo: 1,
    postTime: '2026-07-22T10:30:00Z',
    minutesToPost: 10,
    window: 'T-10',
    status: 'captured',
  };
}

function upcomingRace() {
  return {
    raceId: '2026-07-22-HV-R1',
    date: '2026-07-22',
    racecourse: 'HV',
    raceNo: 1,
    startTime: '18:30',
    status: 'upcoming',
    runners: [{ horseId: 'H002', horseNo: 2, horseName: 'Horse 2' }],
  };
}

function marketSnapshot() {
  return {
    raceId: '2026-07-22-HV-R1',
    pool: 'PLACE',
    combination: [2],
    oddsValue: 2.1,
    minutesToPost: 10,
    capturedAt: '2026-07-22T10:19:00Z',
    sellStatus: 'START_SELL',
  };
}

function scoreBundle() {
  return {
    researchMode: 'SHADOW',
    executionStatus: 'PAPER_ONLY',
    probabilityStatus: 'RESEARCH_ONLY',
    generatedAt: '2026-07-22T10:20:00Z',
    modelId: 'catboost-market-aware-t10-v1',
    artifactId: 'sha256:abc123',
    featurePolicyId: 'market-aware-t10-v1',
    calibrationMethod: 'sigmoid',
    trainingCutoff: '2026-06-30',
    lineage: {
      reportLineage: 'holdout-selection-v1',
      modelPath: 'model.cbm',
      reportPath: 'report.json',
      featureManifestPath: 'manifest.json',
    },
    predictions: [{ raceId: '2026-07-22-HV-R1', runnerId: 'H002', probability: 0.55 }],
  };
}
