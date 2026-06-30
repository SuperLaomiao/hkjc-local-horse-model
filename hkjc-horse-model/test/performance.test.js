import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildPerformanceSnapshot,
  buildProbabilityCalibration,
  buildStakingStrategyPerformance,
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
    assert.equal(typeof snapshot.stakingStrategy.strategyBets, 'number');
    assert.match(snapshot.warning, /not proof/i);
  });

  it('replays the HK$10-100 staking strategy over settled history', () => {
    const strategy = buildStakingStrategyPerformance(strategyEntries);

    assert.equal(strategy.races, 3);
    assert.equal(strategy.strategyBets, 2);
    assert.equal(strategy.passRaces, 1);
    assert.equal(strategy.totalStake, 80);
    assert.equal(strategy.officialWinStake, 20);
    assert.equal(strategy.officialWinReturn, 68);
    assert.equal(strategy.officialWinProfit, 48);
    assert.equal(strategy.officialWinRoi, 2.4);
    assert.equal(strategy.fullStrategyRoi, null);
    assert.equal(strategy.anyHitRate, 1);
    assert.equal(strategy.winHits, 1);
    assert.equal(strategy.placeHits, 2);
    assert.equal(strategy.quinellaPlaceHits, 1);
    assert.equal(strategy.unpricedPoolStake, 60);
    assert.equal(strategy.breakEvenReturnNeededFromUnpricedPools, 12);
    assert.equal(strategy.breakEvenReturnPerUnpricedHit, 4);
    assert.match(strategy.roiNote, /Place.*Quinella Place/i);
  });
});

const strategyEntries = [
  strategyEntry({
    raceId: '2026-06-21-ST-1',
    topProbability: 0.162,
    topWinOdds: 6.8,
    secondProbability: 0.12,
    thirdProbability: 0.1,
    results: [
      result('A', 'Main Chance', 1, 6.8),
      result('D', 'Pace Setter', 2, 18),
      result('E', 'Late Closer', 3, 21),
      result('B', 'Support B', 4, 9),
      result('C', 'Support C', 5, 12),
      result('F', 'Wide Draw', 6, 34),
      result('G', 'Outsider', 7, 55),
    ],
  }),
  strategyEntry({
    raceId: '2026-06-21-ST-2',
    topProbability: 0.188,
    topWinOdds: 7.5,
    secondProbability: 0.142,
    thirdProbability: 0.118,
    results: [
      result('D', 'Pace Setter', 1, 18),
      result('A', 'Main Chance', 2, 7.5),
      result('B', 'Support B', 3, 6.2),
      result('E', 'Late Closer', 4, 21),
      result('C', 'Support C', 5, 11),
      result('F', 'Wide Draw', 6, 34),
      result('G', 'Outsider', 7, 55),
    ],
  }),
  strategyEntry({
    raceId: '2026-06-21-ST-3',
    topProbability: 0.105,
    topWinOdds: 20,
    secondProbability: 0.095,
    thirdProbability: 0.09,
    results: [
      result('C', 'Weak Three', 1, 5),
      result('B', 'Weak Two', 2, 8),
      result('D', 'Pace Setter', 3, 18),
      result('E', 'Late Closer', 4, 21),
      result('F', 'Wide Draw', 5, 34),
      result('G', 'Outsider', 6, 55),
      result('A', 'Weak One', 7, 20),
    ],
  }),
];

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

function strategyEntry({
  raceId,
  topProbability,
  topWinOdds,
  secondProbability,
  thirdProbability,
  results,
}) {
  const predictions = [
    prediction('A', 'Main Chance', topProbability, topWinOdds),
    prediction('B', 'Support B', secondProbability, 6.2),
    prediction('C', 'Support C', thirdProbability, 11),
  ];
  return {
    raceId,
    date: '2026-06-21',
    racecourse: 'ST',
    raceNo: Number(raceId.split('-').at(-1)),
    forecast: {
      topPick: predictions[0],
      predictions,
    },
    settlement: {
      runnerResults: results,
    },
  };
}

function prediction(horseId, horseName, probability, winOdds) {
  return {
    horseId,
    horseNo: horseId.charCodeAt(0) - 64,
    horseName,
    probability,
    fairOdds: probability > 0 ? 1 / probability : null,
    winOdds,
  };
}

function result(horseId, horseName, placing, winOdds) {
  return {
    horseId,
    horseNo: horseId.charCodeAt(0) - 64,
    horseName,
    placing,
    winOdds,
  };
}
