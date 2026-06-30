import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildPerformanceSnapshot,
  buildProbabilityCalibration,
  groupByMeeting,
  groupTopPickOddsBuckets,
  summarizeEntries,
} from '../src/performance.js';

const entries = [
  entry({
    raceId: '2026-06-21-ST-1',
    date: '2026-06-21',
    racecourse: 'ST',
    raceNo: 1,
    topPick: { horseName: 'Alpha', probability: 0.22, winOdds: 2.5 },
    topPickHit: true,
    recommended: { action: 'value', horseName: 'Alpha' },
    stake: 10,
    returned: 25,
    favourite: { placing: 2, winOdds: 2.2 },
  }),
  entry({
    raceId: '2026-06-21-ST-2',
    date: '2026-06-21',
    racecourse: 'ST',
    raceNo: 2,
    topPick: { horseName: 'Bravo', probability: 0.16, winOdds: 8 },
    topPickHit: false,
    recommended: { action: 'pass' },
    stake: 0,
    returned: 0,
    favourite: { placing: 1, winOdds: 3.1 },
  }),
  entry({
    raceId: '2026-06-24-HV-1',
    date: '2026-06-24',
    racecourse: 'HV',
    raceNo: 1,
    topPick: { horseName: 'Cedar', probability: 0.08, winOdds: 22 },
    topPickHit: false,
    recommended: { action: 'value', horseName: 'Delta' },
    stake: 10,
    returned: 0,
    favourite: { placing: 5, winOdds: 2.8 },
  }),
];

describe('performance summaries', () => {
  it('summarizes top picks, value bets, and market favourites', () => {
    const summary = summarizeEntries(entries);

    assert.equal(summary.races, 3);
    assert.equal(summary.topPickWins, 1);
    assert.equal(summary.topPickWinRate, 1 / 3);
    assert.equal(summary.topPickRoi, (2.5 - 3) / 3);
    assert.equal(summary.valueBets, 2);
    assert.equal(summary.valueWins, 1);
    assert.equal(summary.valueRoi, (25 - 20) / 20);
    assert.equal(summary.marketFavouriteWins, 1);
    assert.equal(summary.marketFavouriteRoi, (3.1 - 3) / 3);
  });

  it('groups meeting records by date and racecourse', () => {
    const meetings = groupByMeeting(entries);

    assert.deepEqual(
      meetings.map((meeting) => ({
        key: meeting.key,
        races: meeting.races,
        topPickWins: meeting.topPickWins,
        valueBets: meeting.valueBets,
      })),
      [
        { key: '2026-06-24-HV', races: 1, topPickWins: 0, valueBets: 1 },
        { key: '2026-06-21-ST', races: 2, topPickWins: 1, valueBets: 1 },
      ],
    );
  });

  it('builds top-pick odds bucket records with win rate and ROI', () => {
    const buckets = groupTopPickOddsBuckets(entries);

    assert.deepEqual(
      buckets.map((bucket) => ({
        label: bucket.label,
        races: bucket.races,
        wins: bucket.wins,
        roi: bucket.roi,
      })),
      [
        { label: '<=3', races: 1, wins: 1, roi: 1.5 },
        { label: '3.1-6', races: 0, wins: 0, roi: 0 },
        { label: '6.1-10', races: 1, wins: 0, roi: -1 },
        { label: '10+', races: 1, wins: 0, roi: -1 },
      ],
    );
  });

  it('calibrates predicted probability buckets against actual hit rate', () => {
    const calibration = buildProbabilityCalibration(entries);

    assert.deepEqual(
      calibration.map((bucket) => ({
        label: bucket.label,
        races: bucket.races,
        wins: bucket.wins,
        averageProbability: bucket.averageProbability,
        actualWinRate: bucket.actualWinRate,
      })),
      [
        { label: '<10%', races: 1, wins: 0, averageProbability: 0.08, actualWinRate: 0 },
        { label: '10-15%', races: 0, wins: 0, averageProbability: 0, actualWinRate: 0 },
        { label: '15-20%', races: 1, wins: 0, averageProbability: 0.16, actualWinRate: 0 },
        { label: '20%+', races: 1, wins: 1, averageProbability: 0.22, actualWinRate: 1 },
      ],
    );
  });

  it('builds one compact performance snapshot for the dashboard', () => {
    const snapshot = buildPerformanceSnapshot(entries);

    assert.equal(snapshot.overall.races, 3);
    assert.equal(snapshot.byMeeting.length, 2);
    assert.equal(snapshot.topPickOddsBuckets.length, 4);
    assert.equal(snapshot.probabilityCalibration.length, 4);
    assert.match(snapshot.warning, /not proof/i);
  });
});

function entry({
  raceId,
  date,
  racecourse,
  raceNo,
  topPick,
  topPickHit,
  recommended,
  stake,
  returned,
  favourite,
}) {
  return {
    raceId,
    date,
    racecourse,
    raceNo,
    forecast: {
      topPick,
      recommendation: recommended,
    },
    settlement: {
      topPickHit,
      stake,
      returned,
      resultLabel: stake > 0 && returned > 0 ? 'WIN' : stake > 0 ? 'MISS' : 'PASS',
      marketFavourite: favourite,
    },
  };
}
