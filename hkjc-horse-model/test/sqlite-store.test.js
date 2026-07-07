import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

import * as sqliteStore from '../src/sqlite-store.js';
import {
  getDatabaseStats,
  loadRacesFromDatabase,
  syncRaceFilesToDatabase,
} from '../src/sqlite-store.js';

describe('local SQLite race store', () => {
  it('imports settled HKJC race JSON idempotently and reconstructs model races', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-sqlite-'));
    try {
      const rawDir = path.join(tempDir, 'raw');
      const dbPath = path.join(tempDir, 'hkjc.sqlite');
      await mkdir(rawDir, { recursive: true });
      await writeFile(path.join(rawDir, '2026-07-04-ST.json'), JSON.stringify([settledRace()], null, 2), 'utf8');

      const first = syncRaceFilesToDatabase({ dbPath, inputPath: rawDir, sourceKind: 'raw' });
      const second = syncRaceFilesToDatabase({ dbPath, inputPath: rawDir, sourceKind: 'raw' });
      const stats = getDatabaseStats(dbPath);
      const races = loadRacesFromDatabase({ dbPath });

      assert.deepEqual(first, {
        filesSeen: 1,
        racesSeen: 1,
        runnersSeen: 3,
        dividendsSeen: 5,
      });
      assert.deepEqual(second, first);
      assert.equal(stats.races, 1);
      assert.equal(stats.runners, 3);
      assert.equal(stats.dividends, 5);
      assert.equal(stats.sourceFiles, 1);
      assert.equal(races.length, 1);
      assert.equal(races[0].raceId, '2026-07-04-ST-1');
      assert.equal(races[0].runners[0].horseNo, 2);
      assert.equal(races[0].runners[0].placing, 1);
      assert.deepEqual(races[0].dividends.quinellaPlace[0].combination, [1, 2]);
      assert.equal(races[0].source.kind, 'raw');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('imports upcoming race cards without pretending they are settled results', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-sqlite-'));
    try {
      const upcomingDir = path.join(tempDir, 'upcoming');
      const dbPath = path.join(tempDir, 'hkjc.sqlite');
      await mkdir(upcomingDir, { recursive: true });
      await writeFile(path.join(upcomingDir, '2026-07-12-ST.json'), JSON.stringify([upcomingRace()], null, 2), 'utf8');

      syncRaceFilesToDatabase({ dbPath, inputPath: upcomingDir, sourceKind: 'upcoming' });
      const stats = getDatabaseStats(dbPath);
      const races = loadRacesFromDatabase({ dbPath, status: 'upcoming' });

      assert.equal(stats.races, 1);
      assert.equal(stats.upcomingRaces, 1);
      assert.equal(stats.settledRaces, 0);
      assert.equal(stats.dividends, 0);
      assert.equal(races[0].status, 'upcoming');
      assert.equal(races[0].runners[0].placing, null);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('exposes a CLI sync command for the local database', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-sqlite-'));
    try {
      const rawDir = path.join(tempDir, 'raw');
      const dbPath = path.join(tempDir, 'hkjc.sqlite');
      await mkdir(rawDir, { recursive: true });
      await writeFile(path.join(rawDir, '2026-07-04-ST.json'), JSON.stringify([settledRace()], null, 2), 'utf8');

      const result = spawnSync(process.execPath, [
        'hkjc-horse-model/src/cli.js',
        'sync-db',
        '--input',
        rawDir,
        '--db',
        dbPath,
        '--skipUpcoming',
      ], {
        cwd: path.resolve(import.meta.dirname, '..', '..'),
        encoding: 'utf8',
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /SQLite database synced/);
      assert.equal(getDatabaseStats(dbPath).races, 1);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('keeps settled results authoritative over stale upcoming race cards', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-sqlite-'));
    try {
      const rawDir = path.join(tempDir, 'raw');
      const upcomingDir = path.join(tempDir, 'upcoming');
      const dbPath = path.join(tempDir, 'hkjc.sqlite');
      await mkdir(rawDir, { recursive: true });
      await mkdir(upcomingDir, { recursive: true });
      await writeFile(path.join(rawDir, '2026-07-04-ST.json'), JSON.stringify([settledRace()], null, 2), 'utf8');
      await writeFile(path.join(upcomingDir, '2026-07-04-ST.json'), JSON.stringify([{
        ...upcomingRace(),
        raceId: '2026-07-04-ST-1',
        date: '2026-07-04',
        racecourse: 'ST',
        raceNo: 1,
      }], null, 2), 'utf8');

      const result = spawnSync(process.execPath, [
        'hkjc-horse-model/src/cli.js',
        'sync-db',
        '--input',
        rawDir,
        '--upcoming',
        upcomingDir,
        '--db',
        dbPath,
      ], {
        cwd: path.resolve(import.meta.dirname, '..', '..'),
        encoding: 'utf8',
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      const stats = getDatabaseStats(dbPath);
      const races = loadRacesFromDatabase({ dbPath });
      assert.equal(stats.settledRaces, 1);
      assert.equal(stats.upcomingRaces, 0);
      assert.equal(races[0].status, 'settled');
      assert.equal(races[0].dividends.win[0].dividendPer10, 78);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('builds a dashboard snapshot from the local SQLite database', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-sqlite-'));
    try {
      const rawDir = path.join(tempDir, 'raw');
      const dbPath = path.join(tempDir, 'hkjc.sqlite');
      const dashboardPath = path.join(tempDir, 'dashboard.json');
      const dashboardHistoryPath = path.join(tempDir, 'dashboard-history.json');
      await mkdir(rawDir, { recursive: true });
      await writeFile(path.join(rawDir, '2026-07-04-ST.json'), JSON.stringify([settledRace()], null, 2), 'utf8');
      syncRaceFilesToDatabase({ dbPath, inputPath: rawDir, sourceKind: 'raw' });

      const result = spawnSync(process.execPath, [
        'hkjc-horse-model/src/cli.js',
        'dashboard-db',
        '--db',
        dbPath,
        '--output',
        dashboardPath,
        '--bankroll',
        '200',
      ], {
        cwd: path.resolve(import.meta.dirname, '..', '..'),
        encoding: 'utf8',
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /Dashboard snapshot from SQLite/);
      const dashboard = JSON.parse(await readFile(dashboardPath, 'utf8'));
      assert.equal(dashboard.summary.racesSettled, 1);
      assert.equal(dashboard.scope, 'HKJC local races only');
      assert.equal(dashboard.dataSource.source, 'sqlite');
      assert.equal(dashboard.dataSource.database, 'hkjc.sqlite');
      assert.equal(dashboard.dataSource.database.includes(tempDir), false);
      assert.equal(dashboard.history.ledgerUrl, 'dashboard-history.json');
      assert.equal(dashboard.history.totalLedgerEntries, 1);
      assert.equal(dashboard.history.embeddedLedgerEntries, 1);
      assert.equal(dashboard.history.isLedgerTruncated, false);
      const dashboardHistory = JSON.parse(await readFile(dashboardHistoryPath, 'utf8'));
      assert.equal(dashboardHistory.summary.racesSettled, 1);
      assert.equal(dashboardHistory.dataSource.database, 'hkjc.sqlite');
      assert.equal(dashboardHistory.ledger.length, 1);
      assert.equal(getDatabaseStats(dbPath).recommendationRuns, 1);
      const runs = sqliteStore.loadRecommendationRuns({ dbPath });
      assert.equal(runs[0].raceId, dashboard.latestForecast.raceId);
      assert.equal(runs[0].modelVersion, 'hkjc-local-horse-model');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('records odds and pool snapshots for pre-race value calculations', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-sqlite-'));
    try {
      const dbPath = path.join(tempDir, 'hkjc.sqlite');

      sqliteStore.recordOddsSnapshot({
        dbPath,
        snapshot: {
          raceId: '2026-07-08-HV-1',
          raceNo: 1,
          date: '2026-07-08',
          racecourse: 'HV',
          capturedAt: '2026-07-08T10:00:00.000Z',
          minutesToPost: 30,
          pool: 'WIN',
          combination: [8],
          oddsValue: 7.2,
          source: 'official-graphql',
          raw: { combString: '8', oddsValue: '7.2' },
        },
      });
      sqliteStore.recordPoolSnapshot({
        dbPath,
        snapshot: {
          raceId: '2026-07-08-HV-1',
          raceNo: 1,
          date: '2026-07-08',
          racecourse: 'HV',
          capturedAt: '2026-07-08T10:00:00.000Z',
          minutesToPost: 30,
          pool: 'WIN',
          investment: 123456,
          sellStatus: 'START_SELLING',
          source: 'official-graphql',
          raw: { investment: 123456 },
        },
      });

      const latest = sqliteStore.loadLatestMarketSnapshots({
        dbPath,
        raceId: '2026-07-08-HV-1',
      });
      const stats = getDatabaseStats(dbPath);

      assert.equal(stats.oddsSnapshots, 1);
      assert.equal(stats.poolSnapshots, 1);
      assert.equal(latest.odds.length, 1);
      assert.equal(latest.odds[0].pool, 'WIN');
      assert.deepEqual(latest.odds[0].combination, [8]);
      assert.equal(latest.odds[0].oddsValue, 7.2);
      assert.equal(latest.pools.length, 1);
      assert.equal(latest.pools[0].investment, 123456);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('records recommendation runs for later betting strategy audits', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-sqlite-'));
    try {
      const dbPath = path.join(tempDir, 'hkjc.sqlite');

      const runId = sqliteStore.recordRecommendationRun({
        dbPath,
        run: {
          raceId: '2026-07-08-HV-1',
          raceNo: 1,
          date: '2026-07-08',
          racecourse: 'HV',
          generatedAt: '2026-07-08T10:00:30.000Z',
          modelVersion: 'test-model',
          strategyVersion: 'ev-portfolio-v1',
          bankroll: 100,
          finalEdgeBuffer: 0.08,
          recommendations: [
            {
              pool: 'PLACE',
              combination: [2],
              stake: 10,
              expectedRoi: 0.12,
            },
          ],
          summary: { cashLines: 1, expectedRoi: 0.12 },
        },
      });

      const runs = sqliteStore.loadRecommendationRuns({
        dbPath,
        raceId: '2026-07-08-HV-1',
      });
      const stats = getDatabaseStats(dbPath);

      assert.equal(stats.recommendationRuns, 1);
      assert.match(runId, /^rec_/);
      assert.equal(runs.length, 1);
      assert.equal(runs[0].modelVersion, 'test-model');
      assert.equal(runs[0].strategyVersion, 'ev-portfolio-v1');
      assert.equal(runs[0].recommendations[0].pool, 'PLACE');
      assert.equal(runs[0].summary.expectedRoi, 0.12);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('deduplicates identical recommendation runs across repeated scheduled refreshes', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-sqlite-'));
    try {
      const dbPath = path.join(tempDir, 'hkjc.sqlite');
      const baseRun = {
        raceId: '2026-07-08-HV-1',
        raceNo: 1,
        date: '2026-07-08',
        racecourse: 'HV',
        modelVersion: 'test-model',
        strategyVersion: 'ev-portfolio-v1',
        bankroll: 100,
        finalEdgeBuffer: 0.08,
        recommendations: [
          {
            pool: 'PLACE',
            combination: [2],
            stake: 10,
            expectedRoi: 0.12,
          },
        ],
        summary: { cashLines: 1, expectedRoi: 0.12 },
      };

      const firstRunId = sqliteStore.recordRecommendationRun({
        dbPath,
        run: {
          ...baseRun,
          generatedAt: '2026-07-08T10:00:30.000Z',
        },
      });
      const secondRunId = sqliteStore.recordRecommendationRun({
        dbPath,
        run: {
          ...baseRun,
          generatedAt: '2026-07-08T10:05:30.000Z',
        },
      });
      const runs = sqliteStore.loadRecommendationRuns({
        dbPath,
        raceId: '2026-07-08-HV-1',
      });
      const stats = getDatabaseStats(dbPath);

      assert.equal(secondRunId, firstRunId);
      assert.equal(stats.recommendationRuns, 1);
      assert.equal(runs.length, 1);
      assert.equal(runs[0].generatedAt, '2026-07-08T10:05:30.000Z');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('exposes a CLI command for importing market snapshots', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-sqlite-'));
    try {
      const dbPath = path.join(tempDir, 'hkjc.sqlite');
      const snapshotPath = path.join(tempDir, 'market-snapshot.json');
      await writeFile(snapshotPath, JSON.stringify({
        odds: [{
          raceId: '2026-07-08-HV-1',
          raceNo: 1,
          date: '2026-07-08',
          racecourse: 'HV',
          capturedAt: '2026-07-08T10:00:00.000Z',
          minutesToPost: 30,
          pool: 'PLACE',
          combination: [2],
          oddsValue: 2.4,
          source: 'manual-test',
        }],
        pools: [{
          raceId: '2026-07-08-HV-1',
          raceNo: 1,
          date: '2026-07-08',
          racecourse: 'HV',
          capturedAt: '2026-07-08T10:00:00.000Z',
          minutesToPost: 30,
          pool: 'PLACE',
          investment: 98765,
          sellStatus: 'START_SELLING',
          source: 'manual-test',
        }],
      }, null, 2), 'utf8');

      const result = spawnSync(process.execPath, [
        'hkjc-horse-model/src/cli.js',
        'market-snapshot',
        '--input',
        snapshotPath,
        '--db',
        dbPath,
      ], {
        cwd: path.resolve(import.meta.dirname, '..', '..'),
        encoding: 'utf8',
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /Market snapshots imported/);
      const stats = getDatabaseStats(dbPath);
      assert.equal(stats.oddsSnapshots, 1);
      assert.equal(stats.poolSnapshots, 1);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('exposes a CLI auto-run command for scheduled local refreshes', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-sqlite-'));
    try {
      const rawDir = path.join(tempDir, 'raw');
      const dbPath = path.join(tempDir, 'hkjc.sqlite');
      const dashboardPath = path.join(tempDir, 'dashboard.json');
      await mkdir(rawDir, { recursive: true });
      await writeFile(path.join(rawDir, '2026-07-04-ST.json'), JSON.stringify([settledRace()], null, 2), 'utf8');

      const result = spawnSync(process.execPath, [
        'hkjc-horse-model/src/cli.js',
        'auto-run',
        '--input',
        rawDir,
        '--db',
        dbPath,
        '--output',
        dashboardPath,
        '--skipUpcoming',
        '--bankroll',
        '200',
      ], {
        cwd: path.resolve(import.meta.dirname, '..', '..'),
        encoding: 'utf8',
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /Auto run complete/);
      assert.match(result.stdout, /Recommendation audit/);
      assert.equal(getDatabaseStats(dbPath).races, 1);
      const dashboard = JSON.parse(await readFile(dashboardPath, 'utf8'));
      assert.equal(dashboard.summary.racesSettled, 1);
      assert.equal(dashboard.dataSource.source, 'sqlite');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('exposes a CLI recommendation-audit command for post-race review', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-sqlite-'));
    try {
      const rawDir = path.join(tempDir, 'raw');
      const dbPath = path.join(tempDir, 'hkjc.sqlite');
      const outputPath = path.join(tempDir, 'recommendation-audit.json');
      await mkdir(rawDir, { recursive: true });
      await writeFile(path.join(rawDir, '2026-07-04-ST.json'), JSON.stringify([settledRace()], null, 2), 'utf8');
      syncRaceFilesToDatabase({ dbPath, inputPath: rawDir, sourceKind: 'raw' });
      sqliteStore.recordRecommendationRun({
        dbPath,
        run: {
          raceId: '2026-07-04-ST-1',
          date: '2026-07-04',
          racecourse: 'ST',
          raceNo: 1,
          generatedAt: '2026-07-04T08:00:00.000Z',
          modelVersion: 'test-model',
          strategyVersion: 'audit-test',
          recommendations: [
            { pool: 'PLACE', combination: [2], stake: 10 },
            { pool: 'WIN', combination: [8], stake: 10 },
          ],
        },
      });

      const result = spawnSync(process.execPath, [
        'hkjc-horse-model/src/cli.js',
        'recommendation-audit',
        '--db',
        dbPath,
        '--output',
        outputPath,
      ], {
        cwd: path.resolve(import.meta.dirname, '..', '..'),
        encoding: 'utf8',
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /Recommendation audit/);
      assert.match(result.stdout, /profit -5.00/);
      const report = JSON.parse(await readFile(outputPath, 'utf8'));
      assert.equal(report.summary.totalStake, 20);
      assert.equal(report.summary.totalReturn, 15);
      assert.equal(report.summary.profit, -5);
      assert.equal(report.summary.hitLines, 1);
      assert.equal(report.summary.missLines, 1);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

function settledRace() {
  return {
    raceId: '2026-07-04-ST-1',
    date: '2026-07-04',
    racecourse: 'ST',
    raceNo: 1,
    raceIndex: 827,
    raceClass: 'Class 5',
    distance: 1200,
    ratingBand: '40-0',
    surface: 'TURF',
    course: 'TURF - "C+3" Course',
    going: 'GOOD TO YIELDING',
    runners: [
      runner({ placing: 1, horseNo: 2, horseId: 'HK_2025_L245', horseName: 'ALMIGHTY WARRIOR', winOdds: 7.8 }),
      runner({ placing: 2, horseNo: 1, horseId: 'HK_2025_L441', horseName: 'JEDI SPURS', winOdds: 1.1 }),
      runner({ placing: 3, horseNo: 9, horseId: 'HK_2025_L393', horseName: 'QUANTUM WUKONG', winOdds: 15 }),
    ],
    dividends: {
      win: [{ pool: 'WIN', combination: [2], dividendPer10: 78 }],
      place: [
        { pool: 'PLACE', combination: [2], dividendPer10: 15 },
        { pool: 'PLACE', combination: [1], dividendPer10: 10.1 },
      ],
      quinella: [{ pool: 'QUINELLA', combination: [1, 2], dividendPer10: 22 }],
      quinellaPlace: [{ pool: 'QUINELLA PLACE', combination: [1, 2], dividendPer10: 13.5 }],
    },
    source: { url: 'https://racing.hkjc.com/example/result' },
  };
}

function upcomingRace() {
  return {
    raceId: '2026-07-12-ST-1',
    date: '2026-07-12',
    racecourse: 'ST',
    raceNo: 1,
    raceIndex: 900,
    raceClass: 'Class 4',
    distance: 1400,
    surface: 'TURF',
    course: 'TURF',
    going: null,
    runners: [
      runner({ placing: null, horseNo: 1, horseId: 'HK_2025_M001', horseName: 'NEXT START', winOdds: null }),
      runner({ placing: null, horseNo: 2, horseId: 'HK_2025_M002', horseName: 'SECOND START', winOdds: null }),
    ],
    source: { url: 'https://racing.hkjc.com/example/racecard' },
  };
}

function runner({ placing, horseNo, horseId, horseName, winOdds }) {
  return {
    placing,
    horseNo,
    horseId,
    brandNo: horseId.split('_').at(-1),
    horseName,
    jockey: 'Test Jockey',
    trainer: 'Test Trainer',
    actualWeight: 126,
    declaredHorseWeight: 1080,
    draw: horseNo,
    lbw: placing === 1 ? 0 : 1.5,
    runningPosition: placing ? [placing, placing] : [],
    finishSeconds: placing ? 70 + placing : null,
    winOdds,
  };
}
