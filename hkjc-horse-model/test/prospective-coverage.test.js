import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

import {
  buildProspectiveCoverage,
  evaluateProspectiveDataGate,
} from '../src/prospective-coverage.js';

describe('prospective coverage and backup-health gate', () => {
  it('groups due evidence and distinguishes collection gaps without inventing losing bets', () => {
    const report = buildProspectiveCoverage({
      generatedAt: '2026-07-22T12:00:00Z',
      freeze: '2026-07-01',
      races: [race()],
      snapshots: {
        odds: [
          snapshot({ pool: 'WIN', minutesToPost: 30, sellStatus: 'START_SELL' }),
          snapshot({ pool: 'PLA', minutesToPost: 30, sellStatus: 'STOP_SELL' }),
        ],
        pools: [],
        summary: { retries: 2 },
        events: [
          event({ pool: 'QIN', window: 'T-30', status: 'duplicate-skipped' }),
          event({ pool: 'QPL', window: 'T-30', status: 'offline' }),
          event({ pool: 'WIN', window: 'T-10', status: 'collector-error' }),
          event({ pool: 'QIN', window: 'T-10', status: 'not-selling' }),
          {
            raceId: '2026-07-22-HV-R2',
            date: '2026-07-22',
            racecourse: 'HV',
            raceNo: 2,
            window: 'T-30',
            status: 'missing-racecard',
          },
        ],
      },
      locks: [
        lock({ lockId: 'lock-1', pool: 'WIN', marketWindow: 'T-30', status: 'SETTLED', outcome: 'HIT' }),
        lock({ lockId: 'lock-2', pool: 'WIN', marketWindow: 'T-30', status: 'OPEN' }),
      ],
      backupManifest: {
        backups: [{
          status: 'SUCCESS',
          completedAt: '2026-07-22T10:00:00Z',
          sha256: 'abc123',
          path: '/Users/private/backups/hkjc.sqlite',
        }],
      },
    });

    assert.equal(report.version, 'prospective-coverage-v1');
    assert.equal(report.summary.meetings, 1);
    assert.equal(report.summary.races, 2);
    assert.equal(report.byMeeting[0].meeting, '2026-07-22-HV');
    assert.equal(report.byPool.some((row) => row.pool === 'WIN'), true);
    assert.equal(report.byWindow.some((row) => row.window === 'T-30'), true);
    assert.equal(report.summary.reasonCounts.missingRacecard > 0, true);
    assert.equal(report.summary.reasonCounts.offline > 0, true);
    assert.equal(report.summary.reasonCounts.collectorError > 0, true);
    assert.equal(report.summary.reasonCounts.duplicate > 0, true);
    assert.equal(report.summary.reasonCounts.notSelling > 0, true);
    assert.equal(report.summary.reasonCounts.missedWindow > 0, true);
    assert.equal(report.summary.retryCount, 2);
    assert.equal(report.summary.locks, 2);
    assert.equal(report.summary.settledLocks, 1);
    assert.equal(report.summary.openLocks, 1);
    assert.equal(report.summary.outcomes.hits, 1);
    assert.equal(report.summary.outcomes.misses, 0);
    assert.equal(report.summary.absentLockPolicy, 'MISSING_NOT_LOSS');
    assert.equal(report.backup.status, 'OK');
    assert.equal(report.backup.latestSuccessfulAt, '2026-07-22T10:00:00.000Z');
    assert.equal(report.backup.path, undefined);
  });

  it('declares exact deficits and never reads an ROI field before the data gate passes', () => {
    const coverage = {
      summary: {
        races: 8,
        usableCells: 30,
        locks: 12,
        settledLocks: 8,
        settlementCoverage: 0.6667,
      },
      byPoolWindow: [
        { pool: 'WIN', window: 'T-30', usableCells: 4 },
        { pool: 'PLA', window: 'T-30', usableCells: 3 },
      ],
      backup: { status: 'OK', ageHours: 6, checksumPresent: true },
    };
    Object.defineProperty(coverage, 'roi', {
      get() { throw new Error('ROI must not be read'); },
    });

    const blocked = evaluateProspectiveDataGate({
      coverage,
      minimums: {
        races: 10,
        usableCells: 40,
        locks: 20,
        settledLocks: 16,
        settlementCoverage: 0.8,
        perPoolWindowUsableCells: 5,
        requiredPools: ['WIN', 'PLA'],
        requiredWindows: ['T-30'],
        backupMaxAgeHours: 24,
      },
    });

    assert.equal(blocked.status, 'BLOCKED_DATA');
    assert.equal(blocked.cashMode, 'NO_BET');
    assert.deepEqual(blocked.declaredMinimums.requiredPools, ['WIN', 'PLA']);
    assert(blocked.deficits.some((item) => item.metric === 'races' && item.actual === 8));
    assert(blocked.deficits.some((item) => item.metric === 'WIN.T-30.usableCells'));
    assert(blocked.deficits.some((item) => item.metric === 'PLA.T-30.usableCells'));

    const ready = evaluateProspectiveDataGate({
      coverage: {
        summary: {
          races: 10,
          usableCells: 40,
          locks: 20,
          settledLocks: 16,
          settlementCoverage: 0.8,
        },
        byPoolWindow: [
          { pool: 'WIN', window: 'T-30', usableCells: 5 },
          { pool: 'PLA', window: 'T-30', usableCells: 5 },
        ],
        backup: { status: 'OK', ageHours: 6, checksumPresent: true },
      },
      minimums: blocked.declaredMinimums,
    });

    assert.equal(ready.status, 'READY');
    assert.deepEqual(ready.deficits, []);
  });

  it('writes a privacy-safe aggregate CLI report from SQLite inputs', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-prospective-coverage-'));
    const dbPath = path.join(tempDir, 'hkjc.sqlite');
    const backupPath = path.join(tempDir, 'backup-manifest.json');
    const outputPath = path.join(tempDir, 'coverage.json');

    try {
      await writeFile(backupPath, JSON.stringify({
        backups: [{ status: 'SUCCESS', completedAt: '2026-07-22T10:00:00Z', sha256: 'abc123' }],
      }), 'utf8');
      const result = spawnSync(process.execPath, [
        'hkjc-horse-model/src/cli.js',
        'prospective-coverage',
        '--db',
        dbPath,
        '--freezeDate',
        '2026-07-01',
        '--generatedAt',
        '2026-07-22T12:00:00Z',
        '--backupManifest',
        backupPath,
        '--output',
        outputPath,
      ], {
        cwd: path.resolve(import.meta.dirname, '..', '..'),
        encoding: 'utf8',
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /BLOCKED_DATA/);
      const report = JSON.parse(await readFile(outputPath, 'utf8'));
      assert.equal(report.gate.status, 'BLOCKED_DATA');
      assert.equal(report.summary.races, 0);
      assert.equal(report.database, undefined);
      assert.equal(JSON.stringify(report).includes(tempDir), false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

function race() {
  return {
    raceId: '2026-07-22-HV-R1',
    date: '2026-07-22',
    racecourse: 'HV',
    raceNo: 1,
    startTime: '18:30',
    status: 'settled',
    runners: [{ horseNo: 1 }],
  };
}

function snapshot(overrides = {}) {
  return {
    raceId: '2026-07-22-HV-R1',
    date: '2026-07-22',
    racecourse: 'HV',
    raceNo: 1,
    capturedAt: '2026-07-22T10:00:00Z',
    minutesToPost: 30,
    pool: 'WIN',
    sellStatus: 'START_SELL',
    ...overrides,
  };
}

function event(overrides = {}) {
  return {
    raceId: '2026-07-22-HV-R1',
    date: '2026-07-22',
    racecourse: 'HV',
    raceNo: 1,
    pool: 'WIN',
    window: 'T-30',
    status: 'captured',
    ...overrides,
  };
}

function lock({ lockId, pool, marketWindow, status, outcome = null }) {
  return {
    lockId,
    raceId: '2026-07-22-HV-R1',
    pool,
    marketWindow,
    status,
    settlement: outcome ? { outcome } : null,
  };
}
