import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildDueSnapshotPlan } from '../src/live-snapshot-planner.js';

const race = {
  raceId: '2026-07-12-ST-1',
  date: '2026-07-12',
  racecourse: 'ST',
  raceNo: 1,
  startTime: '18:30',
  status: 'upcoming',
};

describe('race-day live snapshot planner', () => {
  it('returns the configured due window at T-30, T-10, and T-3 in Hong Kong time', () => {
    const cases = [
      ['2026-07-12T10:00:00.000Z', 'T-30', 30],
      ['2026-07-12T10:20:00.000Z', 'T-10', 10],
      ['2026-07-12T10:27:00.000Z', 'T-3', 3],
    ];

    for (const [now, window, minutesToPost] of cases) {
      assert.deepEqual(buildDueSnapshotPlan({ races: [race], now }), [{
        raceId: race.raceId,
        date: race.date,
        racecourse: race.racecourse,
        raceNo: race.raceNo,
        postTime: '2026-07-12T18:30:00+08:00',
        minutesToPost,
        window,
      }]);
    }
  });

  it('skips races outside configured windows', () => {
    assert.deepEqual(buildDueSnapshotPlan({
      races: [race],
      now: '2026-07-12T09:00:00.000Z',
    }), []);
  });

  it('never labels an observation captured after post time as a pre-race snapshot', () => {
    assert.deepEqual(buildDueSnapshotPlan({
      races: [race],
      now: '2026-07-12T10:30:10.000Z',
    }), []);
  });

  it('skips settled and scratched races', () => {
    assert.deepEqual(buildDueSnapshotPlan({
      races: [
        { ...race, status: 'settled' },
        { ...race, raceId: '2026-07-12-ST-2', status: 'scratched' },
      ],
      now: '2026-07-12T10:00:00.000Z',
    }), []);
  });
});
