import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildPublicReleaseManifest,
  validatePublicReleaseTransition,
  verifyPublicReleaseFiles,
} from '../src/public-release-manifest.js';

function dashboard(overrides = {}) {
  return {
    generatedAt: '2026-09-29T06:34:40.287Z',
    scope: 'HKJC local races only',
    dataSource: { source: 'sanitized-public', settledRaces: 14306, upcomingRaces: 2 },
    latestSettlement: { date: '2026-09-27', raceId: '2026-09-27-ST-11' },
    upcomingEntries: [
      { date: '2026-10-01', raceId: '2026-10-01-ST-1', racecourse: 'ST', forecast: { predictions: [{ horseNo: 1 }, { horseNo: 2 }] } },
      { date: '2026-10-01', raceId: '2026-10-01-ST-2', racecourse: 'ST', forecast: { predictions: [{ horseNo: 1 }] } },
    ],
    publication: { visibility: 'PUBLIC_FUNCTIONAL_SANITIZED', policyVersion: 'public-dashboard-v2' },
    ...overrides,
  };
}

describe('public release manifest', () => {
  it('records the public cutoff, counts, meetings, runners, and exact dashboard hash', () => {
    const text = `${JSON.stringify(dashboard(), null, 2)}\n`;
    const manifest = buildPublicReleaseManifest({ dashboard: JSON.parse(text), dashboardText: text });

    assert.equal(manifest.version, 'public-release-manifest-v1');
    assert.equal(manifest.data.settledRaces, 14306);
    assert.equal(manifest.data.settledThrough, '2026-09-27');
    assert.equal(manifest.data.upcomingRaces, 2);
    assert.equal(manifest.data.upcomingFrom, '2026-10-01');
    assert.equal(manifest.data.upcomingRunners, 3);
    assert.deepEqual(manifest.data.upcomingMeetings, [{ date: '2026-10-01', racecourse: 'ST', races: 2, runners: 3 }]);
    assert.match(manifest.dashboardSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(verifyPublicReleaseFiles({ dashboardText: text, manifest }), []);
  });

  it('blocks count/date regression and disappearance of a still-future meeting', () => {
    const previous = buildPublicReleaseManifest({
      dashboard: dashboard(), dashboardText: JSON.stringify(dashboard()),
    });
    const regressedDashboard = dashboard({
      dataSource: { source: 'sanitized-public', settledRaces: 14278, upcomingRaces: 0 },
      latestSettlement: { date: '2026-09-23', raceId: '2026-09-23-HV-9' },
      upcomingEntries: [],
    });
    const candidate = buildPublicReleaseManifest({
      dashboard: regressedDashboard, dashboardText: JSON.stringify(regressedDashboard),
    });
    const issues = validatePublicReleaseTransition({ previous, candidate, asOfDate: '2026-09-29' });

    assert.deepEqual(issues.map((issue) => issue.code), [
      'SETTLED_COUNT_REGRESSION',
      'SETTLED_DATE_REGRESSION',
      'FUTURE_MEETING_DISAPPEARED',
    ]);
  });

  it('allows an old upcoming meeting to disappear after its date', () => {
    const previous = buildPublicReleaseManifest({ dashboard: dashboard(), dashboardText: JSON.stringify(dashboard()) });
    const nextDashboard = dashboard({
      generatedAt: '2026-10-02T01:00:00.000Z',
      dataSource: { source: 'sanitized-public', settledRaces: 14308, upcomingRaces: 0 },
      latestSettlement: { date: '2026-10-01', raceId: '2026-10-01-ST-2' },
      upcomingEntries: [],
    });
    const candidate = buildPublicReleaseManifest({ dashboard: nextDashboard, dashboardText: JSON.stringify(nextDashboard) });
    assert.deepEqual(validatePublicReleaseTransition({ previous, candidate, asOfDate: '2026-10-02' }), []);
  });
});
