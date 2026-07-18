import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildMarketSnapshotCoverageReport } from '../src/market-snapshot-coverage.js';

describe('market snapshot coverage report', () => {
  it('counts race coverage once and groups snapshots by minutes-to-post window and pool', () => {
    const report = buildMarketSnapshotCoverageReport({
      races: [
        race('2026-07-08-HV-1'),
        race('2026-07-08-HV-2'),
        race('2026-07-08-HV-3'),
      ],
      odds: [
        odds('2026-07-08-HV-1', 'WIN', [2], 30, '2026-07-08T10:00:00.000Z'),
        odds('2026-07-08-HV-1', 'PLACE', [2], 29, '2026-07-08T10:01:00.000Z'),
        odds('2026-07-08-HV-2', 'QUINELLA_PLACE', [2, 8], 10, '2026-07-08T10:20:00.000Z'),
        odds('2026-07-08-HV-2', 'WIN', [1], 3, '2026-07-08T10:27:00.000Z'),
      ],
      pools: [
        pool('2026-07-08-HV-1', 'WIN', 30, '2026-07-08T10:00:00.000Z'),
        pool('2026-07-08-HV-2', 'WIN', 10, '2026-07-08T10:20:00.000Z'),
      ],
    });

    assert.equal(report.summary.races, 3);
    assert.equal(report.summary.racesWithOdds, 2);
    assert.equal(report.summary.racesWithPools, 2);
    assert.equal(report.summary.oddsSnapshots, 4);
    assert.equal(report.summary.poolSnapshots, 2);
    assert.equal(report.summary.oddsRaceCoverage, 0.6667);
    assert.equal(report.summary.poolRaceCoverage, 0.6667);
    assert.equal(report.summary.latestCapturedAt, '2026-07-08T10:27:00.000Z');
    assert.equal(report.summary.readiness, 'partial-market-data');

    assert.equal(report.byWindow['T-30'].oddsSnapshots, 2);
    assert.equal(report.byWindow['T-30'].racesWithOdds, 1);
    assert.equal(report.byWindow['T-10'].oddsSnapshots, 1);
    assert.equal(report.byWindow['T-3'].oddsSnapshots, 1);
    assert.equal(report.byWindow.unknown.oddsSnapshots, 0);

    assert.equal(report.byPool.WIN.oddsSnapshots, 2);
    assert.equal(report.byPool.WIN.poolSnapshots, 2);
    assert.equal(report.byPool.WIN.racesWithOdds, 2);
    assert.equal(report.byPool.PLACE.oddsSnapshots, 1);
    assert.equal(report.byPool.QUINELLA_PLACE.oddsSnapshots, 1);
  });

  it('returns explicit missing-data guidance when no market snapshots exist', () => {
    const report = buildMarketSnapshotCoverageReport({
      races: [race('2026-07-08-HV-1')],
      odds: [],
      pools: [],
    });

    assert.equal(report.summary.readiness, 'missing-market-data');
    assert.equal(report.summary.oddsRaceCoverage, 0);
    assert.equal(report.summary.poolRaceCoverage, 0);
    assert.match(report.gaps.join(' '), /No market snapshots/i);
  });

  it('never counts a negative-zero post-time observation as T-3 coverage', () => {
    const report = buildMarketSnapshotCoverageReport({
      odds: [odds('2026-07-08-HV-1', 'WIN', [8], -0, '2026-07-08T10:30:10.000Z')],
    });

    assert.equal(report.byWindow['T-3'].oddsSnapshots, 0);
    assert.equal(report.byWindow.unknown.oddsSnapshots, 1);
  });
});

function race(raceId) {
  return {
    raceId,
    status: 'upcoming',
  };
}

function odds(raceId, poolKey, combination, minutesToPost, capturedAt) {
  return {
    raceId,
    poolKey,
    pool: poolKey,
    combination,
    oddsValue: 2.5,
    minutesToPost,
    capturedAt,
  };
}

function pool(raceId, poolKey, minutesToPost, capturedAt) {
  return {
    raceId,
    poolKey,
    pool: poolKey,
    investment: 123456,
    minutesToPost,
    capturedAt,
  };
}
