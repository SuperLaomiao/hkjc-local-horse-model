import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COCKPIT_DESTINATIONS,
  buildCockpitViewModel,
  normalizeCockpitDestination,
} from '../dashboard-cockpit.js';

const entry = {
  raceId: '2026-07-19-ST-R3',
  date: '2026-07-19',
  racecourse: 'ST',
  raceNo: 3,
  forecast: { startTime: '13:25', predictions: [] },
  settlement: null,
};

describe('race-day cockpit', () => {
  it('normalizes linkable destinations and falls back to today', () => {
    assert.deepEqual(COCKPIT_DESTINATIONS.map((item) => item.id), [
      'today',
      'review',
      'research',
      'more',
    ]);
    assert.equal(normalizeCockpitDestination('#research'), 'research');
    assert.equal(normalizeCockpitDestination('more'), 'more');
    assert.equal(normalizeCockpitDestination('#unknown'), 'today');
  });

  it('renders no meeting without inventing an executable race', () => {
    const view = buildCockpitViewModel({
      snapshot: { generatedAt: '2026-07-19T04:00:00.000Z', nextLocalMeetings: [] },
      entry: null,
      entries: [],
      refreshStatus: 'ready',
      executionPolicy: { allowExecutableRecommendations: true },
    });

    assert.equal(view.state, 'NO_MEETING');
    assert.equal(view.totalStake, 0);
    assert.equal(view.canExecute, false);
    assert.match(view.headline, /今天不可下注/);
  });

  it('distinguishes a failed refresh from a verified no-meeting state', () => {
    const view = buildCockpitViewModel({
      snapshot: { generatedAt: '2026-07-19T04:00:00.000Z', nextLocalMeetings: [] },
      entry: null,
      entries: [],
      refreshStatus: 'error',
      executionPolicy: { allowExecutableRecommendations: true },
    });

    assert.equal(view.state, 'BLOCK');
    assert.equal(view.totalStake, 0);
    assert.match(view.reason, /刷新失败/);
  });

  it('blocks a stale screen even when an old portfolio had cash lines', () => {
    const view = buildCockpitViewModel({
      snapshot: { generatedAt: '2026-07-19T04:00:00.000Z' },
      entry,
      entries: [entry],
      refreshStatus: 'error',
      executionPolicy: { allowExecutableRecommendations: true },
      availability: { canBetNow: true },
      portfolio: {
        cashLines: [{ label: '位置', type: 'PLACE', selections: ['8'], stake: 10 }],
        watchLines: [],
      },
    });

    assert.equal(view.state, 'BLOCK');
    assert.equal(view.totalStake, 0);
    assert.equal(view.lines[0].amount, 0);
    assert.match(view.reason, /刷新失败/);
  });

  it('shows an exact race-level WATCH line with zero stake', () => {
    const view = buildCockpitViewModel({
      snapshot: { generatedAt: '2026-07-19T04:00:00.000Z' },
      entry,
      entries: [entry],
      refreshStatus: 'ready',
      executionPolicy: { allowExecutableRecommendations: true },
      availability: { canBetNow: true },
      portfolio: {
        cashLines: [],
        watchLines: [{ label: '位置Q', type: 'QPL', selections: ['2', '8'], stake: 0, rationale: 'EV 未越线' }],
      },
    });

    assert.equal(view.state, 'WATCH');
    assert.equal(view.lines[0].context, 'R3 · QPL · 2+8');
    assert.equal(view.lines[0].amount, 0);
  });

  it('keeps a valid cash portfolio executable with the exact total', () => {
    const view = buildCockpitViewModel({
      snapshot: { generatedAt: '2026-07-19T04:00:00.000Z' },
      entry,
      entries: [entry],
      refreshStatus: 'ready',
      executionPolicy: { allowExecutableRecommendations: true },
      availability: { canBetNow: true },
      portfolio: {
        cashLines: [
          { label: '位置', type: 'PLACE', selections: ['8'], stake: 10 },
          { label: '位置Q', type: 'QPL', selections: ['2', '8'], stake: 10 },
        ],
        watchLines: [],
      },
    });

    assert.equal(view.state, 'PLAY');
    assert.equal(view.canExecute, true);
    assert.equal(view.totalStake, 20);
    assert.deepEqual(view.lines.map((line) => line.context), [
      'R3 · PLACE · 8',
      'R3 · QPL · 2+8',
    ]);
  });

  it('never executes a cash line whose race context is unknown', () => {
    const view = buildCockpitViewModel({
      entry: { raceId: 'unknown', forecast: {} },
      entries: [],
      availability: { canBetNow: true },
      executionPolicy: { allowExecutableRecommendations: true },
      portfolio: {
        cashLines: [{ type: 'PLACE', selections: ['8'], stake: 10 }],
        watchLines: [],
      },
    });

    assert.equal(view.state, 'BLOCK');
    assert.equal(view.canExecute, false);
    assert.equal(view.totalStake, 0);
    assert.equal(view.lines[0].context, 'R- · PLACE · 8');
    assert.equal(view.lines[0].amount, 0);
    assert.match(view.headline, /场次信息不完整/);
  });
});
