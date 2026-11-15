import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildPublicReleaseManifest,
  validatePublicReleaseTransition,
  verifyPublicReleaseFiles,
  verifyPublishedSite,
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

function manifest(snapshot = dashboard()) {
  return buildPublicReleaseManifest({ dashboard: snapshot });
}

function settledEntry(raceNo, overrides = {}) {
  return {
    date: '2026-10-01', racecourse: 'ST', raceNo, raceId: `2026-10-01-ST-${raceNo}`,
    settlement: {
      date: '2026-10-01', racecourse: 'ST', raceNo, raceId: `2026-10-01-ST-${raceNo}`,
      resultLabel: 'PASS', winnerHorseId: `HK_2024_K00${raceNo}`,
      ...overrides,
    },
  };
}

function afterSettlement(raceNos = [1]) {
  const before = dashboard();
  const recentEntries = raceNos.map((raceNo) => settledEntry(raceNo));
  const upcomingEntries = before.upcomingEntries.filter((entry) => !raceNos.includes(Number(entry.raceId.split('-').at(-1))));
  return dashboard({
    generatedAt: '2026-10-01T09:00:00Z',
    dataSource: { settledRaces: 14306 + raceNos.length, upcomingRaces: upcomingEntries.length },
    latestSettlement: recentEntries.at(-1)?.settlement,
    latestUpcomingForecast: upcomingEntries[0]?.forecast ?? null,
    recentEntries,
    upcomingEntries,
  });
}

function legacyManifest(snapshot = dashboard()) {
  const result = manifest(snapshot);
  result.version = 'public-release-manifest-v1';
  delete result.data.upcomingRaceIds;
  delete result.data.recentSettledRaceIds;
  delete result.data.abandonedRaces;
  return result;
}

describe('public release manifest', () => {
  it('records the public cutoff, counts, meetings, runners, and exact dashboard hash', () => {
    const text = `${JSON.stringify(dashboard(), null, 2)}\n`;
    const manifest = buildPublicReleaseManifest({ dashboard: JSON.parse(text), dashboardText: text });

    assert.equal(manifest.version, 'public-release-manifest-v3');
    assert.equal(manifest.data.settledRaces, 14306);
    assert.equal(manifest.data.settledThrough, '2026-09-27');
    assert.equal(manifest.data.upcomingRaces, 2);
    assert.equal(manifest.data.upcomingFrom, '2026-10-01');
    assert.equal(manifest.data.upcomingRunners, 3);
    assert.deepEqual(manifest.data.upcomingMeetings, [{ date: '2026-10-01', racecourse: 'ST', races: 2, runners: 3 }]);
    assert.deepEqual(manifest.data.upcomingRaceIds, ['2026-10-01-ST-1', '2026-10-01-ST-2']);
    assert.deepEqual(manifest.data.recentSettledRaceIds, []);
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

  for (const raceNos of [[1], [1, 2]]) {
    it(`allows ${raceNos.length === 1 ? 'partial' : 'full'} same-day settlement with exact race evidence`, () => {
      assert.deepEqual(validatePublicReleaseTransition({
        previous: manifest(), candidate: manifest(afterSettlement(raceNos)), asOfDate: '2026-10-01',
      }), []);
    });
  }

  it('allows the next meeting to advance only after all previous races settle', () => {
    const snapshot = afterSettlement([1, 2]);
    snapshot.upcomingEntries = [{ date: '2026-10-04', racecourse: 'ST', raceId: '2026-10-04-ST-1', forecast: { predictions: [] } }];
    snapshot.dataSource.upcomingRaces = 1;
    assert.deepEqual(validatePublicReleaseTransition({ previous: manifest(), candidate: manifest(snapshot), asOfDate: '2026-10-01' }), []);
  });

  for (const asOfDate of ['2026-10-01', '2026-10-02']) {
    it(`blocks missing races without settlement even on ${asOfDate}`, () => {
      const snapshot = afterSettlement([1, 2]);
      snapshot.recentEntries = [];
      snapshot.latestSettlement = { date: '2026-10-01' };
      assert.ok(validatePublicReleaseTransition({ previous: manifest(), candidate: manifest(snapshot), asOfDate }).length);
    });
  }

  it('blocks a partial loss despite unrelated settled growth and a newer cutoff', () => {
    const snapshot = afterSettlement([1]);
    snapshot.recentEntries = [settledEntry(9)];
    snapshot.latestSettlement = snapshot.recentEntries[0].settlement;
    const issues = validatePublicReleaseTransition({ previous: manifest(), candidate: manifest(snapshot), asOfDate: '2026-10-01' });
    assert.equal(issues.some((item) => item.code === 'FUTURE_RACE_COUNT_REGRESSION'), true);
  });

  it('blocks same-count replacement and loss masked by additional meetings', () => {
    for (const extra of [[], [{ date: '2026-10-04', racecourse: 'ST', raceId: '2026-10-04-ST-1', forecast: {} }]]) {
      const snapshot = dashboard();
      snapshot.upcomingEntries[0].raceId = '2026-10-01-ST-3';
      snapshot.upcomingEntries.push(...extra);
      snapshot.dataSource.upcomingRaces = snapshot.upcomingEntries.length;
      assert.equal(validatePublicReleaseTransition({ previous: manifest(), candidate: manifest(snapshot), asOfDate: '2026-10-01' })[0].code, 'UPCOMING_RACE_DISAPPEARED');
    }
  });

  it('requires settled count growth consistent with removed race identities', () => {
    const snapshot = afterSettlement([1, 2]);
    snapshot.dataSource.settledRaces = 14307;
    assert.equal(validatePublicReleaseTransition({ previous: manifest(), candidate: manifest(snapshot), asOfDate: '2026-10-01' })[0].code, 'SETTLEMENT_COUNT_MISMATCH');
  });

  it('does not accept empty, mismatched, or future settlement evidence', () => {
    for (const overrides of [{ winnerHorseId: null }, { resultLabel: 'OPEN' }, { raceNo: 2 }, { racecourse: 'HV' }, { raceId: '2026-10-01-ST-2' }]) {
      const snapshot = afterSettlement([1]);
      snapshot.recentEntries = [settledEntry(1, overrides)];
      snapshot.latestSettlement = null;
      assert.ok(validatePublicReleaseTransition({ previous: manifest(), candidate: manifest(snapshot), asOfDate: '2026-10-01' }).length);
    }
    assert.ok(validatePublicReleaseTransition({ previous: manifest(), candidate: manifest(afterSettlement()), asOfDate: '2026-09-30' }).length);
  });

  it('rejects malformed, duplicate, conflicting, or count-inconsistent upcoming identities', () => {
    for (const change of [
      (snapshot) => { snapshot.upcomingEntries[0].raceId = 'unknown'; },
      (snapshot) => { snapshot.upcomingEntries[1] = snapshot.upcomingEntries[0]; },
      (snapshot) => { snapshot.upcomingEntries[0].forecast.raceId = '2026-10-01-ST-9'; },
      (snapshot) => { snapshot.upcomingEntries[0].raceNo = 9; },
      (snapshot) => { snapshot.dataSource.upcomingRaces = 3; },
    ]) {
      const snapshot = dashboard();
      change(snapshot);
      assert.throws(() => manifest(snapshot), /upcoming/i);
    }
  });

  it('upgrades v1 using the hash-bound previous dashboard for partial and full settlement', () => {
    for (const raceNos of [[1], [1, 2]]) {
      assert.deepEqual(validatePublicReleaseTransition({
        previous: legacyManifest(), previousDashboardText: `${JSON.stringify(dashboard(), null, 2)}\n`,
        candidate: manifest(afterSettlement(raceNos)), asOfDate: '2026-10-01',
      }), []);
    }
  });

  it('replays an eleven-race legacy meeting with five results or a fully settled day', () => {
    const before = dashboard();
    before.upcomingEntries = Array.from({ length: 11 }, (_, index) => ({
      raceId: `2026-10-01-ST-${index + 1}`, date: '2026-10-01', racecourse: 'ST', raceNo: index + 1,
      forecast: { predictions: [] },
    }));
    before.dataSource.upcomingRaces = 11;
    for (const settledCount of [5, 11]) {
      const recentEntries = Array.from({ length: settledCount }, (_, index) => settledEntry(index + 1));
      const after = dashboard({
        generatedAt: '2026-10-01T09:00:00Z',
        dataSource: { settledRaces: 14306 + settledCount, upcomingRaces: 11 - settledCount },
        upcomingEntries: before.upcomingEntries.slice(settledCount),
        recentEntries, latestSettlement: recentEntries.at(-1).settlement,
      });
      assert.deepEqual(validatePublicReleaseTransition({
        previous: legacyManifest(before), previousDashboardText: `${JSON.stringify(before, null, 2)}\n`,
        candidate: manifest(after), asOfDate: '2026-10-01',
      }), []);
    }
  });

  it('fails closed when legacy identity evidence is unavailable or mismatched', () => {
    for (const previousDashboardText of [undefined, '{}', 'broken-json']) {
      assert.ok(validatePublicReleaseTransition({
        previous: legacyManifest(), previousDashboardText, candidate: manifest(afterSettlement()), asOfDate: '2026-10-01',
      }).some((item) => /PREVIOUS|LEGACY/.test(item.code)));
    }
    const previous = legacyManifest();
    previous.data.upcomingRaces = 3;
    assert.ok(validatePublicReleaseTransition({
      previous, previousDashboardText: `${JSON.stringify(dashboard(), null, 2)}\n`, candidate: manifest(afterSettlement()), asOfDate: '2026-10-01',
    }).some((item) => /PREVIOUS/.test(item.code)));
  });

  it('keeps same-count replacement protected when upgrading from v1', () => {
    const snapshot = dashboard();
    snapshot.upcomingEntries[0].raceId = '2026-10-01-ST-3';
    assert.equal(validatePublicReleaseTransition({
      previous: legacyManifest(), previousDashboardText: `${JSON.stringify(dashboard(), null, 2)}\n`,
      candidate: manifest(snapshot), asOfDate: '2026-10-01',
    })[0].code, 'UPCOMING_RACE_DISAPPEARED');
  });

  it('keeps v2 dashboard pairing checked and permits an unchanged v1 baseline', () => {
    const text = `${JSON.stringify(dashboard(), null, 2)}\n`;
    assert.deepEqual(validatePublicReleaseTransition({ previous: legacyManifest(), previousDashboardText: text, candidate: manifest() }), []);
    assert.equal(validatePublicReleaseTransition({ previous: manifest(), previousDashboardText: '{}', candidate: manifest() })[0].code, 'PREVIOUS_RELEASE_INVALID');
  });

  it('retains settled coverage and generation-time rollback guards during the v1 upgrade', () => {
    const snapshot = afterSettlement();
    snapshot.dataSource.settledRaces = 1;
    snapshot.latestSettlement = { date: '2026-09-01' };
    snapshot.recentEntries = [];
    snapshot.generatedAt = '2026-09-01T00:00:00Z';
    const issues = validatePublicReleaseTransition({
      previous: legacyManifest(), previousDashboardText: `${JSON.stringify(dashboard(), null, 2)}\n`, candidate: manifest(snapshot), asOfDate: '2026-10-01',
    });
    for (const code of ['SETTLED_COUNT_REGRESSION', 'SETTLED_DATE_REGRESSION', 'GENERATED_AT_REGRESSION']) {
      assert.ok(issues.some((item) => item.code === code));
    }
  });

  it('verifies old v1 releases and new identity fields against dashboard bytes', async () => {
    const text = `${JSON.stringify(dashboard(), null, 2)}\n`;
    assert.deepEqual(verifyPublicReleaseFiles({ dashboardText: text, manifest: legacyManifest() }), []);
    const changed = manifest();
    changed.data.upcomingRaceIds[0] = '2026-10-01-ST-9';
    assert.ok(verifyPublicReleaseFiles({ dashboardText: text, manifest: changed }).length);
    const previous = legacyManifest();
    const fetchImpl = async (url) => ({ ok: true, text: async () => url.includes('publication-manifest') ? JSON.stringify(previous) : text });
    assert.equal((await verifyPublishedSite({ baseUrl: 'https://example.com', expectedManifest: previous, fetchImpl, retries: 1 })).status, 'PASS');
  });

  it('rejects unsupported versions and missing identity arrays instead of bypassing the guard', () => {
    const previous = manifest();
    previous.version = 'unknown';
    assert.ok(validatePublicReleaseTransition({ previous, candidate: manifest() }).length);
    const candidate = manifest();
    delete candidate.data.upcomingRaceIds;
    assert.ok(validatePublicReleaseTransition({ previous: manifest(), candidate }).length);
    for (const data of [{ settledRaces: undefined }, { upcomingRaces: -1 }]) {
      const invalid = legacyManifest();
      Object.assign(invalid.data, data);
      assert.ok(validatePublicReleaseTransition({ previous: invalid, candidate: manifest() }).length);
    }
  });
});
