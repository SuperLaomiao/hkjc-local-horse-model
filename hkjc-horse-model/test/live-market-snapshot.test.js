import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildLiveMarketSnapshotReport,
  normalizeLiveMarketPayload,
} from '../src/live-market-snapshot.js';
import {
  loadMarketSnapshots,
} from '../src/sqlite-store.js';

const GRAPHQL_FIXTURE = {
  data: {
    raceMeetings: [
      {
        id: 'MTG_20260708_HV',
        date: '2026-07-08',
        venueCode: 'HV',
        status: 'START_SELL',
        races: [
          {
            no: '1',
            postTime: '2026-07-08T18:30:00+08:00',
            status: 'START_SELL',
            wageringFieldSize: 12,
          },
        ],
        pmPools: [
          {
            id: 'MTG_20260708_0001PLA1',
            status: 'START_SELL',
            sellStatus: 'START_SELL',
            oddsType: 'PLA',
            lastUpdateTime: '2026-07-08T18:00:00+08:00',
            leg: { number: 1, races: [1] },
            oddsNodes: [
              { combString: '08', oddsValue: '2.1', hotFavourite: false, oddsDropValue: 0 },
              { combString: '04', oddsValue: 'SCR', hotFavourite: false, oddsDropValue: 0 },
            ],
          },
          {
            id: 'MTG_20260708_0001QPL1',
            status: 'START_SELL',
            sellStatus: 'START_SELL',
            oddsType: 'QPL',
            lastUpdateTime: '2026-07-08T18:00:00+08:00',
            leg: { number: 1, races: [1] },
            oddsNodes: [
              { combString: '02,08', oddsValue: '18', hotFavourite: false, oddsDropValue: 0 },
            ],
          },
          {
            id: 'MTG_20260708_0001WIN1',
            status: 'START_SELL',
            sellStatus: 'START_SELL',
            oddsType: 'WIN',
            lastUpdateTime: '2026-07-08T18:00:00+08:00',
            leg: { number: 1, races: [1] },
            oddsNodes: [
              { combString: '08', oddsValue: '6.5', hotFavourite: true, oddsDropValue: -0.4 },
            ],
          },
        ],
        poolInvs: [
          {
            id: 'MTG_20260708_0001WIN1',
            status: 'START_SELL',
            sellStatus: 'START_SELL',
            oddsType: 'WIN',
            investment: '726818',
            lastUpdateTime: '2026-07-08T18:00:05+08:00',
            leg: { number: 1, races: [1] },
          },
          {
            id: 'MTG_20260708_0001QPL1',
            status: 'START_SELL',
            sellStatus: 'START_SELL',
            oddsType: 'QPL',
            investment: '835027',
            lastUpdateTime: '2026-07-08T18:00:05+08:00',
            leg: { number: 1, races: [1] },
          },
        ],
      },
    ],
  },
};

describe('HKJC live market snapshot normalization', () => {
  it('normalizes GraphQL odds and pool investments for existing market snapshot tables', () => {
    const result = normalizeLiveMarketPayload({
      payload: GRAPHQL_FIXTURE,
      source: 'hkjc-live-graphql-test',
      capturedAt: '2026-07-08T10:00:00.000Z',
      date: '2026-07-08',
      venueCode: 'HV',
      raceNo: 1,
    });

    assert.equal(result.summary.oddsSnapshots, 3);
    assert.equal(result.summary.poolSnapshots, 2);
    assert.deepEqual(result.summary.pools, {
      'PLACE': 1,
      'QUINELLA PLACE': 1,
      'WIN': 1,
    });

    assert.deepEqual(result.oddsSnapshots.map((snapshot) => ({
      raceId: snapshot.raceId,
      capturedAt: snapshot.capturedAt,
      minutesToPost: snapshot.minutesToPost,
      pool: snapshot.pool,
      combination: snapshot.combination,
      oddsValue: snapshot.oddsValue,
      source: snapshot.source,
    })), [
      {
        raceId: '2026-07-08-HV-1',
        capturedAt: '2026-07-08T10:00:00.000Z',
        minutesToPost: 30,
        pool: 'PLACE',
        combination: [8],
        oddsValue: 2.1,
        source: 'hkjc-live-graphql-test',
      },
      {
        raceId: '2026-07-08-HV-1',
        capturedAt: '2026-07-08T10:00:00.000Z',
        minutesToPost: 30,
        pool: 'QUINELLA PLACE',
        combination: [2, 8],
        oddsValue: 18,
        source: 'hkjc-live-graphql-test',
      },
      {
        raceId: '2026-07-08-HV-1',
        capturedAt: '2026-07-08T10:00:00.000Z',
        minutesToPost: 30,
        pool: 'WIN',
        combination: [8],
        oddsValue: 6.5,
        source: 'hkjc-live-graphql-test',
      },
    ]);

    assert.deepEqual(result.poolSnapshots.map((snapshot) => ({
      raceId: snapshot.raceId,
      capturedAt: snapshot.capturedAt,
      minutesToPost: snapshot.minutesToPost,
      pool: snapshot.pool,
      investment: snapshot.investment,
      sellStatus: snapshot.sellStatus,
    })), [
      {
        raceId: '2026-07-08-HV-1',
        capturedAt: '2026-07-08T10:00:00.000Z',
        minutesToPost: 30,
        pool: 'WIN',
        investment: 726818,
        sellStatus: 'START_SELL',
      },
      {
        raceId: '2026-07-08-HV-1',
        capturedAt: '2026-07-08T10:00:00.000Z',
        minutesToPost: 30,
        pool: 'QUINELLA PLACE',
        investment: 835027,
        sellStatus: 'START_SELL',
      },
    ]);
  });

  it('rejects exact-post and post-time observations before they reach market storage', () => {
    for (const capturedAt of [
      '2026-07-08T10:30:00.000Z',
      '2026-07-08T10:30:10.000Z',
    ]) {
      const result = normalizeLiveMarketPayload({
        payload: GRAPHQL_FIXTURE,
        source: 'hkjc-live-graphql-test',
        capturedAt,
        date: '2026-07-08',
        venueCode: 'HV',
        raceNo: 1,
      });

      assert.equal(result.summary.oddsSnapshots, 0, capturedAt);
      assert.equal(result.summary.poolSnapshots, 0, capturedAt);
      assert.equal(result.summary.skipped.postTime, 5, capturedAt);
      assert.deepEqual(result.oddsSnapshots, [], capturedAt);
      assert.deepEqual(result.poolSnapshots, [], capturedAt);
    }
  });

  it('builds a compact report for dry-run visibility', () => {
    const normalized = normalizeLiveMarketPayload({
      payload: GRAPHQL_FIXTURE,
      source: 'hkjc-live-graphql-test',
      capturedAt: '2026-07-08T10:00:00.000Z',
      date: '2026-07-08',
      venueCode: 'HV',
      raceNo: 1,
    });
    const report = buildLiveMarketSnapshotReport({
      ...normalized,
      dryRun: true,
      database: 'hkjc.sqlite',
    });

    assert.equal(report.status, 'ready');
    assert.equal(report.summary.oddsSnapshots, 3);
    assert.equal(report.summary.poolSnapshots, 2);
    assert.equal(report.summary.imported, false);
    assert.deepEqual(report.summary.races, ['2026-07-08-HV-1']);
  });

  it('exposes a CLI command that imports fixture snapshots into SQLite', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-live-market-'));
    try {
      const dbPath = path.join(tempDir, 'hkjc.sqlite');
      const fixturePath = path.join(tempDir, 'live-market.json');
      const reportPath = path.join(tempDir, 'report.json');
      await writeFile(fixturePath, JSON.stringify(GRAPHQL_FIXTURE), 'utf8');

      const result = spawnSync(process.execPath, [
        'hkjc-horse-model/src/cli.js',
        'live-market-snapshot',
        '--input',
        fixturePath,
        '--db',
        dbPath,
        '--output',
        reportPath,
        '--date',
        '2026-07-08',
        '--venue',
        'HV',
        '--race',
        '1',
        '--source',
        'hkjc-live-graphql-test',
        '--capturedAt',
        '2026-07-08T10:00:00.000Z',
      ], {
        cwd: path.resolve(import.meta.dirname, '..', '..'),
        encoding: 'utf8',
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /Live market snapshots imported: 3 odds, 2 pools/);

      const snapshots = loadMarketSnapshots({ dbPath });
      assert.equal(snapshots.odds.length, 3);
      assert.equal(snapshots.pools.length, 2);
      assert.deepEqual(snapshots.odds.map((snapshot) => snapshot.poolKey), [
        'place',
        'quinellaPlace',
        'win',
      ]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
