import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { splitDashboardForPublishing } from '../src/dashboard-publish.js';

describe('dashboard publishing split', () => {
  it('removes personal betting details from public data and keeps full history private', () => {
    const snapshot = {
      generatedAt: '2026-07-07T10:00:00.000Z',
      scope: 'HKJC local races only',
      summary: { racesSettled: 6, roi: -0.12 },
      dataSource: { source: 'sqlite', settledRaces: 6, upcomingRaces: 1 },
      ledger: Array.from({ length: 6 }, (_, index) => ({
        raceId: `race-${index + 1}`,
        cumulativeProfit: index - 3,
      })),
      performance: {
        overall: { races: 6 },
        recent: { races: 3 },
        byMeeting: Array.from({ length: 5 }, (_, index) => ({
          key: `2026-07-0${index + 1}-ST`,
          races: index + 1,
        })),
      },
      latestSettlement: {
        raceId: 'race-6',
        winnerHorseName: 'Public Winner',
        recommendedHorseName: 'Private Pick',
        stake: 50,
        profit: -50,
      },
      recentEntries: [{
        raceId: 'race-6',
        cumulativeProfit: -50,
        cumulativeRoi: -1,
        forecast: {
          raceId: 'race-6',
          topPick: { horseName: 'Public Top Pick', probability: 0.3 },
          recommendation: { horseName: 'Private Pick', suggestedStake: 50 },
          finalBetPlan: { mode: 'PLAY', plannedStake: 50 },
        },
        settlement: {
          raceId: 'race-6',
          winnerHorseName: 'Public Winner',
          recommendedHorseName: 'Private Pick',
          stake: 50,
          returned: 0,
          profit: -50,
        },
      }],
      assumptions: {
        minProbability: 0.15,
        stakePolicy: 'private bankroll rule',
      },
      dataSource: {
        source: 'sqlite',
        database: '/Users/example/private/hkjc.sqlite',
        settledRaces: 6,
      },
    };

    const { publicSnapshot, historySnapshot } = splitDashboardForPublishing(snapshot, {
      embeddedLedgerLimit: 2,
      embeddedPerformanceMeetingLimit: 2,
    });

    assert.deepEqual(publicSnapshot.ledger, []);
    assert.deepEqual(publicSnapshot.performance.byMeeting.map((meeting) => meeting.key), [
      '2026-07-01-ST',
      '2026-07-02-ST',
    ]);
    assert.equal(publicSnapshot.history.ledgerUrl, undefined);
    assert.equal(publicSnapshot.history.rowLevelHistoryPublished, false);
    assert.equal(publicSnapshot.history.totalLedgerEntries, 6);
    assert.equal(publicSnapshot.history.embeddedLedgerEntries, 0);
    assert.equal(publicSnapshot.history.isLedgerTruncated, true);
    assert.equal(publicSnapshot.history.totalPerformanceMeetings, 5);
    assert.equal(publicSnapshot.history.embeddedPerformanceMeetings, 2);
    assert.equal(publicSnapshot.recentEntries[0].cumulativeProfit, undefined);
    assert.equal(publicSnapshot.recentEntries[0].forecast.topPick.horseName, 'Public Top Pick');
    assert.equal(publicSnapshot.recentEntries[0].forecast.recommendation, undefined);
    assert.equal(publicSnapshot.recentEntries[0].forecast.finalBetPlan, undefined);
    assert.equal(publicSnapshot.recentEntries[0].settlement.winnerHorseName, 'Public Winner');
    assert.equal(publicSnapshot.recentEntries[0].settlement.recommendedHorseName, undefined);
    assert.equal(publicSnapshot.recentEntries[0].settlement.stake, undefined);
    assert.equal(publicSnapshot.latestSettlement.recommendedHorseName, undefined);
    assert.equal(publicSnapshot.assumptions.stakePolicy, undefined);
    assert.equal(publicSnapshot.dataSource.database, undefined);
    assert.equal(publicSnapshot.publication.visibility, 'PUBLIC_FUNCTIONAL_SANITIZED');
    assert.equal(publicSnapshot.publication.executableRecommendationsPublished, true);
    assert.equal(publicSnapshot.publication.personalDataPublished, false);
    assert.equal(publicSnapshot.publication.rowLevelHistoryPublished, false);

    assert.deepEqual(historySnapshot.ledger.map((entry) => entry.raceId), [
      'race-1',
      'race-2',
      'race-3',
      'race-4',
      'race-5',
      'race-6',
    ]);
    assert.deepEqual(historySnapshot.performance.byMeeting.map((meeting) => meeting.key), [
      '2026-07-01-ST',
      '2026-07-02-ST',
      '2026-07-03-ST',
      '2026-07-04-ST',
      '2026-07-05-ST',
    ]);
    assert.equal(historySnapshot.summary.racesSettled, 6);
    assert.equal(historySnapshot.dataSource.source, 'sqlite');
    assert.equal(historySnapshot.dataSource.database, '/Users/example/private/hkjc.sqlite');
    assert.equal(historySnapshot.recentEntries[0].forecast.finalBetPlan.plannedStake, 50);
    assert.equal(historySnapshot.publication.visibility, 'PRIVATE_LOCAL');
  });

  it('preserves aggregate history counts when a sanitized snapshot is published again', () => {
    const snapshot = {
      ledger: [{ raceId: 'race-1' }, { raceId: 'race-2' }],
      performance: {
        byMeeting: [{ key: 'm1' }, { key: 'm2' }, { key: 'm3' }],
      },
    };

    const first = splitDashboardForPublishing(snapshot).publicSnapshot;
    const second = splitDashboardForPublishing(first).publicSnapshot;

    assert.equal(second.history.totalLedgerEntries, 2);
    assert.equal(second.history.totalPerformanceMeetings, 3);
    assert.deepEqual(second.ledger, []);
  });
});
