import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COCKPIT_DESTINATIONS,
  buildCockpitViewModel,
  buildProspectiveCoverageView,
  normalizeCockpitDestination,
} from '../dashboard-cockpit.js';

describe('prospective coverage view', () => {
  it('builds a sanitized view and fails closed on invalid reports', () => {
    const report = {
      version: 'prospective-coverage-v1',
      generatedAt: '2026-10-15T10:00:00.000Z',
      summary: { races: 62, dueRaces: 50, usableRaces: 41, missingCells: 120, settledLocks: 900 },
      gate: { status: 'BLOCKED_DATA', declaredMinimums: { races: 100 } },
      byPoolWindow: [{ pool: 'WIN', window: 'T-30', usableCells: 41, dueCells: 50, missingCells: 9 }],
    };

    assert.deepEqual(buildProspectiveCoverageView(report), {
      available: true, generatedAt: report.generatedAt, cashMode: 'NO_BET',
      loadedRaces: 62, usableRaces: 41, futureRaces: 12, missingCells: 120,
      settledLocks: 900, racesNeeded: 59, requiredRaces: 100, gateStatus: 'BLOCKED_DATA',
      cells: [{ pool: 'WIN', window: 'T-30', usable: 41, due: 50, missing: 9 }],
    });
    assert.deepEqual(buildProspectiveCoverageView({ ...report, summary: { ...report.summary, usableRaces: 51 } }), {
      available: false, cashMode: 'NO_BET',
    });
  });
});

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

  it('prints horse numbers from structured selections instead of object strings', () => {
    const view = buildCockpitViewModel({
      entry,
      entries: [entry],
      refreshStatus: 'ready',
      executionPolicy: { allowExecutableRecommendations: true },
      availability: { canBetNow: true },
      portfolio: {
        cashLines: [],
        watchLines: [{ type: 'QUINELLA_PLACE', selections: [{ horseNo: 2 }, { horseNo: 8 }], stake: 0 }],
      },
    });
    assert.equal(view.lines[0].context, 'R3 · QUINELLA_PLACE · 2+8');
    assert.equal(view.lines[0].type, 'QUINELLA_PLACE');
    assert.deepEqual(view.lines[0].selections, [{ horseNo: 2 }, { horseNo: 8 }]);
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
