import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { splitDashboardForPublishing } from '../src/dashboard-publish.js';

describe('dashboard publishing split', () => {
  it('keeps the public dashboard lightweight and moves full ledger history to a companion payload', () => {
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
      recentEntries: [{ raceId: 'race-6' }],
    };

    const { publicSnapshot, historySnapshot } = splitDashboardForPublishing(snapshot, {
      embeddedLedgerLimit: 2,
      embeddedPerformanceMeetingLimit: 2,
      historyUrl: 'dashboard-history.json',
    });

    assert.deepEqual(publicSnapshot.ledger.map((entry) => entry.raceId), ['race-5', 'race-6']);
    assert.deepEqual(publicSnapshot.performance.byMeeting.map((meeting) => meeting.key), [
      '2026-07-01-ST',
      '2026-07-02-ST',
    ]);
    assert.equal(publicSnapshot.history.ledgerUrl, 'dashboard-history.json');
    assert.equal(publicSnapshot.history.totalLedgerEntries, 6);
    assert.equal(publicSnapshot.history.embeddedLedgerEntries, 2);
    assert.equal(publicSnapshot.history.isLedgerTruncated, true);
    assert.equal(publicSnapshot.history.totalPerformanceMeetings, 5);
    assert.equal(publicSnapshot.history.embeddedPerformanceMeetings, 2);

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
  });
});
