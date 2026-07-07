import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  importExternalLiveOddsToDatabase,
  normalizeExternalLiveOddsRows,
} from '../src/external-live-odds-import.js';
import {
  loadMarketSnapshots,
} from '../src/sqlite-store.js';

const RACES_CSV = [
  'race_date,race_no,race_location,race_country,race_id,race_time,track,race_class,course,going,distance,rating,horse_list,results_available,last_updated',
  '2016-09-28 00:00:00.000000,1,HV,HK,,19:15,Turf,Class 5,A,GOOD,1200,,"1,2",1,2016-09-28 12:00:00.000000',
].join('\n');

const LIVE_ODDS_CSV = [
  'race_date,race_location,race_country,race_no,data,capture_time,last_updated',
  '2016-09-28 00:00:00.000000,HV,HK,1,"{""win"":{""1"":""3.2"",""2"":""12""},""pla"":{""1"":""1.5"",""2"":""3.4""}}",2016-09-28 10:45:00.000000,2016-09-28 10:45:02.000000',
].join('\n');

describe('external eprochasson live odds import', () => {
  it('normalizes win and place odds snapshots with Hong Kong minutes-to-post', () => {
    const result = normalizeExternalLiveOddsRows({
      racesCsv: RACES_CSV,
      liveOddsCsv: LIVE_ODDS_CSV,
      source: 'test-eprochasson',
    });

    assert.equal(result.summary.rowsSeen, 1);
    assert.equal(result.summary.rowsMatched, 1);
    assert.equal(result.summary.oddsSnapshots, 4);
    assert.deepEqual(result.summary.pools, { WIN: 2, PLACE: 2 });

    assert.deepEqual(result.snapshots.map((snapshot) => ({
      raceId: snapshot.raceId,
      capturedAt: snapshot.capturedAt,
      minutesToPost: snapshot.minutesToPost,
      pool: snapshot.pool,
      combination: snapshot.combination,
      oddsValue: snapshot.oddsValue,
      source: snapshot.source,
    })), [
      {
        raceId: '2016-09-28-HV-1',
        capturedAt: '2016-09-28T10:45:00.000Z',
        minutesToPost: 30,
        pool: 'WIN',
        combination: [1],
        oddsValue: 3.2,
        source: 'test-eprochasson',
      },
      {
        raceId: '2016-09-28-HV-1',
        capturedAt: '2016-09-28T10:45:00.000Z',
        minutesToPost: 30,
        pool: 'WIN',
        combination: [2],
        oddsValue: 12,
        source: 'test-eprochasson',
      },
      {
        raceId: '2016-09-28-HV-1',
        capturedAt: '2016-09-28T10:45:00.000Z',
        minutesToPost: 30,
        pool: 'PLACE',
        combination: [1],
        oddsValue: 1.5,
        source: 'test-eprochasson',
      },
      {
        raceId: '2016-09-28-HV-1',
        capturedAt: '2016-09-28T10:45:00.000Z',
        minutesToPost: 30,
        pool: 'PLACE',
        combination: [2],
        oddsValue: 3.4,
        source: 'test-eprochasson',
      },
    ]);
  });

  it('imports compressed external live odds into the existing SQLite market snapshot table', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-external-odds-'));
    try {
      const dbPath = path.join(tempDir, 'hkjc.sqlite');
      const racesPath = path.join(tempDir, 'races.csv.gz');
      const liveOddsPath = path.join(tempDir, 'live_odds.csv.gz');
      await writeFile(racesPath, gzipSync(RACES_CSV), 'binary');
      await writeFile(liveOddsPath, gzipSync(LIVE_ODDS_CSV), 'binary');

      const result = await importExternalLiveOddsToDatabase({
        dbPath,
        racesPath,
        liveOddsPath,
        source: 'test-eprochasson',
      });

      assert.equal(result.summary.oddsSnapshots, 4);
      const snapshots = loadMarketSnapshots({ dbPath });
      assert.equal(snapshots.odds.length, 4);
      assert.equal(snapshots.pools.length, 0);
      assert.deepEqual(snapshots.odds.map((snapshot) => snapshot.poolKey), [
        'place',
        'place',
        'win',
        'win',
      ]);
      assert.equal(snapshots.odds[0].minutesToPost, 30);
      assert.equal(snapshots.odds[0].source, 'test-eprochasson');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('exposes a CLI command for importing external live odds files', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-external-odds-'));
    try {
      const dbPath = path.join(tempDir, 'hkjc.sqlite');
      const racesPath = path.join(tempDir, 'races.csv.gz');
      const liveOddsPath = path.join(tempDir, 'live_odds.csv.gz');
      await writeFile(racesPath, gzipSync(RACES_CSV), 'binary');
      await writeFile(liveOddsPath, gzipSync(LIVE_ODDS_CSV), 'binary');

      const result = spawnSync(process.execPath, [
        'hkjc-horse-model/src/cli.js',
        'external-live-odds',
        '--races',
        racesPath,
        '--liveOdds',
        liveOddsPath,
        '--db',
        dbPath,
        '--source',
        'test-eprochasson',
      ], {
        cwd: path.resolve(import.meta.dirname, '..', '..'),
        encoding: 'utf8',
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /External live odds imported/);
      assert.match(result.stdout, /4 odds snapshots/);
      const snapshots = loadMarketSnapshots({ dbPath });
      assert.equal(snapshots.odds.length, 4);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
