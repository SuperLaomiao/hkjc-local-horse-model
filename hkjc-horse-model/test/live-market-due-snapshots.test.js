import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runDueLiveMarketSnapshots } from '../src/live-market-due-snapshots.js';

const dueRace = {
  raceId: '2026-07-18-ST-1',
  date: '2026-07-18',
  racecourse: 'ST',
  raceNo: 1,
  minutesToPost: 30,
  window: 'T-30',
};

describe('due live market snapshot runner', () => {
  it('reports due windows in dry-run mode without capturing', async () => {
    let captures = 0;
    const report = await runDueLiveMarketSnapshots({
      dbPath: '/tmp/hkjc.sqlite',
      dryRun: true,
      pools: ['WIN', 'PLA'],
      loadPlan: () => [dueRace],
      loadCapturedWindows: () => new Set(),
      capture: async () => { captures += 1; },
      now: '2026-07-18T10:00:00.000Z',
    });

    assert.equal(captures, 0);
    assert.equal(report.summary.due, 1);
    assert.equal(report.summary.captured, 0);
    assert.deepEqual(report.due, [{ ...dueRace, status: 'dry-run' }]);
  });

  it('captures uncaptured windows and skips duplicate race windows', async () => {
    const calls = [];
    const report = await runDueLiveMarketSnapshots({
      dbPath: '/tmp/hkjc.sqlite',
      pools: ['WIN', 'PLA', 'QIN', 'QPL'],
      loadPlan: () => [
        dueRace,
        { ...dueRace, raceId: '2026-07-18-ST-2', raceNo: 2 },
      ],
      loadCapturedWindows: () => new Set(['2026-07-18-ST-1|T-30']),
      capture: async (options) => {
        calls.push(options);
        return { oddsSnapshots: 12, poolSnapshots: 4 };
      },
      now: '2026-07-18T10:00:00.000Z',
    });

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      dbPath: '/tmp/hkjc.sqlite',
      date: '2026-07-18',
      venueCode: 'ST',
      raceNo: 2,
      pools: ['WIN', 'PLA', 'QIN', 'QPL'],
      capturedAt: '2026-07-18T10:00:00.000Z',
    });
    assert.equal(report.summary.captured, 1);
    assert.equal(report.summary.skippedDuplicates, 1);
    assert.equal(report.summary.oddsSnapshots, 12);
    assert.equal(report.summary.poolSnapshots, 4);
  });

  it('exposes a dry-run CLI that writes a no-due report without fetching', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-due-market-'));
    try {
      const dbPath = path.join(tempDir, 'hkjc.sqlite');
      const reportPath = path.join(tempDir, 'due-report.json');
      const result = spawnSync(process.execPath, [
        'hkjc-horse-model/src/cli.js',
        'live-market-due-snapshots',
        '--db', dbPath,
        '--output', reportPath,
        '--dryRun',
      ], {
        cwd: path.resolve(import.meta.dirname, '..', '..'),
        encoding: 'utf8',
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /Due live market snapshots: 0 due/);
      const report = JSON.parse(await readFile(reportPath, 'utf8'));
      assert.equal(report.dryRun, true);
      assert.equal(report.summary.due, 0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
