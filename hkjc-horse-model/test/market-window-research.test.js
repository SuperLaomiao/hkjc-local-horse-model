import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { buildMarketWindowResearchReport } from '../src/market-window-research.js';
import {
  recordOddsSnapshots,
  syncRaceFilesToDatabase,
} from '../src/sqlite-store.js';

describe('eprochasson-inspired market window research', () => {
  it('evaluates T-30 market favourite ROI and odds-cap filters', () => {
    const report = buildMarketWindowResearchReport({
      races: [
        race('2026-07-04-ST-1', [
          runner(1, 2),
          runner(2, 1),
        ], 2, 30),
        race('2026-07-04-ST-2', [
          runner(1, 2),
          runner(2, 1),
        ], 2, 80),
      ],
      featuresByRunner: new Map([
        ['2026-07-04-ST-1|1', { marketWinOddsT60: 4, marketWinOddsT30: 3.5, marketWinOddsPctChangeT60ToT30: -0.125 }],
        ['2026-07-04-ST-1|2', { marketWinOddsT60: 3.5, marketWinOddsT30: 3, marketWinOddsPctChangeT60ToT30: -0.142857 }],
        ['2026-07-04-ST-2|1', { marketWinOddsT60: 8, marketWinOddsT30: 9, marketWinOddsPctChangeT60ToT30: 0.125 }],
        ['2026-07-04-ST-2|2', { marketWinOddsT60: 12, marketWinOddsT30: 11, marketWinOddsPctChangeT60ToT30: -0.083333 }],
      ]),
      oddsCaps: [7.5],
      stake: 10,
    });

    assert.equal(report.summary.racesWithT30WinOdds, 2);
    assert.equal(report.status, 'ready');
    assert.deepEqual(report.strategies.t30MarketFavourite, {
      label: 'T-30 market favourite',
      bets: 2,
      wins: 1,
      stake: 20,
      return: 30,
      profit: 10,
      roi: 0.5,
      hitRate: 0.5,
      averageT30Odds: 6,
    });
    assert.deepEqual(report.byMaxOdds['7.5'], {
      label: 'T-30 market favourite <= 7.5',
      bets: 1,
      wins: 1,
      stake: 10,
      return: 30,
      profit: 20,
      roi: 2,
      hitRate: 1,
      averageT30Odds: 3,
    });
    assert.equal(report.strategies.t30FavouriteShortening.bets, 1);
    assert.equal(report.strategies.t30FavouriteShortening.roi, 2);
    assert.match(report.takeaways.join(' '), /odds cap/i);
  });

  it('exposes a CLI report for market-window odds-cap research', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-market-window-'));
    try {
      const rawDir = path.join(tempDir, 'raw');
      const dbPath = path.join(tempDir, 'hkjc.sqlite');
      const outputPath = path.join(tempDir, 'market-window-research.json');
      await mkdir(rawDir, { recursive: true });
      await writeFile(path.join(rawDir, '2026-07-04-ST.json'), JSON.stringify([
        race('2026-07-04-ST-1', [
          runner(1, 2),
          runner(2, 1),
        ], 2, 30),
      ], null, 2), 'utf8');
      syncRaceFilesToDatabase({ dbPath, inputPath: rawDir, sourceKind: 'raw' });
      recordOddsSnapshots({
        dbPath,
        snapshots: [
          oddsSnapshot('2026-07-04-ST-1', 1, 3.5, 30),
          oddsSnapshot('2026-07-04-ST-1', 2, 3, 30),
        ],
      });

      const result = spawnSync(process.execPath, [
        'hkjc-horse-model/src/cli.js',
        'market-window-research',
        '--db',
        dbPath,
        '--output',
        outputPath,
      ], {
        cwd: path.resolve(import.meta.dirname, '..', '..'),
        encoding: 'utf8',
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /Market window research/);
      const payload = JSON.parse(await readFile(outputPath, 'utf8'));
      assert.equal(payload.summary.racesWithT30WinOdds, 1);
      assert.equal(payload.strategies.t30MarketFavourite.roi, 2);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

function race(raceId, runners, winnerHorseNo, winDividendPer10) {
  const [, date, racecourse, raceNo] = raceId.match(/^(\d{4}-\d{2}-\d{2})-([A-Z]+)-(\d+)$/);
  return {
    raceId,
    date,
    racecourse,
    raceNo: Number(raceNo),
    status: 'settled',
    runners,
    dividends: {
      win: [{ pool: 'WIN', combination: [winnerHorseNo], dividendPer10: winDividendPer10 }],
    },
  };
}

function runner(horseNo, placing) {
  return {
    horseNo,
    horseId: `H${horseNo}`,
    horseName: `Horse ${horseNo}`,
    placing,
  };
}

function oddsSnapshot(raceId, horseNo, oddsValue, minutesToPost) {
  const [, date, racecourse, raceNo] = raceId.match(/^(\d{4}-\d{2}-\d{2})-([A-Z]+)-(\d+)$/);
  return {
    raceId,
    date,
    racecourse,
    raceNo: Number(raceNo),
    capturedAt: `${date}T07:00:00.000Z`,
    minutesToPost,
    pool: 'WIN',
    combination: [horseNo],
    oddsValue,
    source: 'test-market-window',
  };
}
