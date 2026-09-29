import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveRefreshStartDate } from '../src/refresh-window.js';

describe('refresh resume window', () => {
  it('re-fetches from the newest available result date in an ephemeral checkout', () => {
    assert.equal(resolveRefreshStartDate({
      today: '2026-09-29',
      historyDays: 14,
      resumeFromLatest: true,
      availableRaceDates: ['2026-07-12', '2026-07-15'],
    }), '2026-07-15');
  });

  it('uses an explicit from date and otherwise keeps the bounded history window', () => {
    assert.equal(resolveRefreshStartDate({
      today: '2026-09-29', from: '2026-09-01', resumeFromLatest: true,
      availableRaceDates: ['2026-07-15'],
    }), '2026-09-01');
    assert.equal(resolveRefreshStartDate({ today: '2026-09-29', historyDays: 14 }), '2026-09-15');
  });
});
