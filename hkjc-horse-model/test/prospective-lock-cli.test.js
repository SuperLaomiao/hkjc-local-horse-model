import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

import { loadProspectiveLocks } from '../src/sqlite-store.js';

describe('prospective lock CLI', () => {
  it('records a paper-only lock and auto-settles it from an official race payload', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-prospective-cli-'));
    try {
      const dbPath = path.join(tempDir, 'hkjc.sqlite');
      const lockInputPath = path.join(tempDir, 'lock-input.json');
      const raceInputPath = path.join(tempDir, 'settled-race.json');
      const lockOutputPath = path.join(tempDir, 'lock-output.json');
      const settleOutputPath = path.join(tempDir, 'settle-output.json');
      await writeFile(lockInputPath, JSON.stringify(lockInput()), 'utf8');
      await writeFile(raceInputPath, JSON.stringify(settledRace()), 'utf8');

      const lockResult = runCli([
        'prospective-lock',
        '--input', lockInputPath,
        '--db', dbPath,
        '--output', lockOutputPath,
      ]);
      assert.equal(lockResult.status, 0, lockResult.stderr || lockResult.stdout);
      assert.match(lockResult.stdout, /Prospective locks recorded: 1/);
      assert.equal(loadProspectiveLocks({ dbPath, status: 'OPEN' }).length, 1);

      const settleResult = runCli([
        'prospective-settle',
        '--input', raceInputPath,
        '--db', dbPath,
        '--settledAt', '2026-07-22T12:00:00Z',
        '--output', settleOutputPath,
      ]);
      assert.equal(settleResult.status, 0, settleResult.stderr || settleResult.stdout);
      assert.match(settleResult.stdout, /Prospective locks settled: 1/);

      const stored = loadProspectiveLocks({ dbPath, status: 'SETTLED' });
      assert.equal(stored.length, 1);
      assert.equal(stored[0].settlement.outcome, 'HIT');
      assert.equal(stored[0].settlement.returned, 15);

      const report = JSON.parse(await readFile(settleOutputPath, 'utf8'));
      assert.equal(report.ledgers.paper.roi, 0.5);
      assert.equal(report.ledgers.cash.executionStatus, 'NO_BET');
      assert.equal(report.ledgers.shadow.hits, 1);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

function runCli(args) {
  return spawnSync(process.execPath, ['hkjc-horse-model/src/cli.js', ...args], {
    cwd: path.resolve(import.meta.dirname, '..', '..'),
    encoding: 'utf8',
  });
}

function lockInput() {
  return {
    generatedAt: '2026-07-22T10:20:00Z',
    race: {
      raceId: '2026-07-22-HV-R1',
      date: '2026-07-22',
      racecourse: 'HV',
      raceNo: 1,
      startTime: '18:30',
      status: 'upcoming',
      runners: [{ horseId: 'H002', horseNo: 2, horseName: 'Horse 2' }],
    },
    scoreBundles: [{
      researchMode: 'SHADOW',
      executionStatus: 'PAPER_ONLY',
      probabilityStatus: 'RESEARCH_ONLY',
      generatedAt: '2026-07-22T10:18:00Z',
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
    }],
    marketSnapshots: [{
      raceId: '2026-07-22-HV-R1',
      pool: 'PLACE',
      combination: [2],
      oddsValue: 2.1,
      minutesToPost: 10,
      capturedAt: '2026-07-22T10:19:00Z',
      sellStatus: 'START_SELL',
    }],
    decisions: [{
      pool: 'PLACE',
      combination: [2],
      modelId: 'catboost-market-aware-t10-v1',
      rawProbability: 0.55,
      conservativeProbability: 0.52,
      paperStake: 10,
      marketWindow: 'T-10',
    }],
  };
}

function settledRace() {
  return {
    raceId: '2026-07-22-HV-R1',
    date: '2026-07-22',
    racecourse: 'HV',
    raceNo: 1,
    startTime: '18:30',
    status: 'settled',
    dividends: {
      place: [{ pool: 'PLACE', combination: [2], dividendPer10: 15 }],
    },
  };
}
