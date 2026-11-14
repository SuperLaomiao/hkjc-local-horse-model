import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildPublicReleaseManifest, validatePublicReleaseTransition, verifyPublicReleaseFiles } from '../src/public-release-manifest.js';
import { splitDashboardForPublishing } from '../src/dashboard-publish.js';
import { abandonedRace } from './abandoned-fixtures.js';
import { abandonedHtml } from './abandoned-fixtures.js';
import { parseLocalResultHtml } from '../src/hkjc-parser.js';

function before() {
  return { generatedAt: '2026-11-14T09:00:00Z', dataSource: { settledRaces: 100, upcomingRaces: 2 }, latestSettlement: { date: '2026-11-11' },
    upcomingEntries: [1, 2].map((raceNo) => ({ raceId: `2026-11-14-ST-${raceNo}`, date: '2026-11-14', racecourse: 'ST', raceNo, forecast: { predictions: [] } })) };
}
function manifest(snapshot) { return buildPublicReleaseManifest({ dashboard: snapshot }); }
function oldManifest(snapshot, version = 'v2') {
  const m = manifest(snapshot); m.version = `public-release-manifest-${version}`; delete m.data.abandonedRaces;
  if (version === 'v1') { delete m.data.upcomingRaceIds; delete m.data.recentSettledRaceIds; }
  return m;
}
function after({ mixed = false } = {}) {
  const d = before(); d.generatedAt = '2026-11-15T00:00:00Z'; d.upcomingEntries = []; d.dataSource.upcomingRaces = 0;
  d.terminalEntries = mixed ? [abandonedRace(2)] : [abandonedRace(1), abandonedRace(2)];
  if (mixed) {
    const settlement = { raceId: '2026-11-14-ST-1', date: '2026-11-14', racecourse: 'ST', raceNo: 1, resultLabel: 'PASS', winnerHorseId: 'HK_2025_L123' };
    d.recentEntries = [{ ...settlement, settlement }]; d.latestSettlement = settlement; d.dataSource.settledRaces += 1;
  }
  return d;
}

describe('abandoned public release protection', () => {
  for (const version of ['v1', 'v2', 'v3']) for (const mixed of [true, false]) {
    it(`allows ${mixed ? 'mixed settlement/cancellation' : 'all cancellations'} from ${version} with stable normal coverage`, () => {
      const d = before();
      assert.deepEqual(validatePublicReleaseTransition({
        previous: version === 'v3' ? manifest(d) : oldManifest(d, version), candidate: manifest(after({ mixed })),
        previousDashboardText: `${JSON.stringify(d, null, 2)}\n`, asOfDate: '2026-11-15',
      }), []);
    });
  }

  it('still blocks zero-upcoming loss when one cancellation proof is absent, even after the race day', () => {
    const d = after(); d.terminalEntries.pop();
    const issues = validatePublicReleaseTransition({ previous: oldManifest(before()), candidate: manifest(d), asOfDate: '2026-11-15' });
    assert.ok(issues.some((item) => item.code === 'FUTURE_MEETING_DISAPPEARED' && item.detail.includes('2026-11-14-ST-2')));
  });

  it('allows a fully cancelled first meeting without inventing any settled count or cutoff', () => {
    const old = before(); old.dataSource.settledRaces = 0; old.latestSettlement = null;
    const next = after(); next.dataSource.settledRaces = 0; next.latestSettlement = null;
    assert.deepEqual(validatePublicReleaseTransition({ previous: oldManifest(old), candidate: manifest(next), asOfDate: '2026-11-15' }), []);
    assert.equal(manifest(next).data.settledThrough, null);
  });

  it('uses explicit official cancellation evidence rather than waiting for a meeting date to expire', () => {
    const old = before();
    old.upcomingEntries = old.upcomingEntries.slice(0, 1).map((e) => ({ ...e, date: '2026-11-18', raceId: '2026-11-18-ST-1' }));
    old.dataSource.upcomingRaces = 1;
    const next = { ...old, generatedAt: '2026-11-15T01:00:00Z', dataSource: { ...old.dataSource, upcomingRaces: 0 }, upcomingEntries: [],
      terminalEntries: [parseLocalResultHtml(abandonedHtml({ date: '18/11/2026', raceNo: 1 }), { date: '2026-11-18', racecourse: 'ST', raceNo: 1, observedAt: '2026-11-15T00:00:00Z' })] };
    assert.deepEqual(validatePublicReleaseTransition({ previous: oldManifest(old), candidate: manifest(next), asOfDate: '2026-11-15' }), []);
  });

  it('does not let cancellation hide normal settled-count or date regression', () => {
    const d = after(); d.dataSource.settledRaces = 99; d.latestSettlement.date = '2026-11-08';
    const codes = validatePublicReleaseTransition({ previous: oldManifest(before()), candidate: manifest(d), asOfDate: '2026-11-15' }).map((item) => item.code);
    assert.ok(codes.includes('SETTLED_COUNT_REGRESSION')); assert.ok(codes.includes('SETTLED_DATE_REGRESSION'));
    const mixed = after({ mixed: true }); mixed.dataSource.settledRaces = 100;
    assert.ok(validatePublicReleaseTransition({ previous: manifest(before()), candidate: manifest(mixed), asOfDate: '2026-11-15' }).some((item) => item.code === 'SETTLEMENT_COUNT_MISMATCH'));
  });

  it('rejects forged identities, source hosts, missing refunds, and future captures', () => {
    for (const change of [
      (e) => { e.terminalEvidence.raceNo = 1; },
      (e) => { e.terminalEvidence.url = e.terminalEvidence.url.replace('racing.hkjc.com', 'example.com'); },
      (e) => { e.terminalEvidence.refund = false; },
      (e) => { e.terminalEvidence.sha256 = 'missing'; },
    ]) { const d = after(); change(d.terminalEntries[1]); assert.throws(() => manifest(d)); }
    const future = after(); future.terminalEntries[1].terminalEvidence.observedAt = '2026-11-16T00:00:00Z';
    assert.throws(() => manifest(future), /captured after/i);
  });

  it('prevents a previously abandoned race from reopening as upcoming or a normal winner', () => {
    const previous = manifest(after());
    const d = before(); d.generatedAt = '2026-11-15T01:00:00Z';
    assert.ok(validatePublicReleaseTransition({ previous, candidate: manifest(d), asOfDate: '2026-11-15' }).some((item) => item.code === 'TERMINAL_RACE_REOPENED'));
    const normal = after({ mixed: true }); normal.terminalEntries = [];
    assert.ok(validatePublicReleaseTransition({ previous, candidate: manifest(normal), asOfDate: '2026-11-15' }).some((item) => item.code === 'TERMINAL_RACE_REOPENED'));
  });

  it('verifies old v2 bytes and binds new terminal evidence to the dashboard hash', () => {
    const d = before(), text = `${JSON.stringify(d, null, 2)}\n`;
    assert.deepEqual(verifyPublicReleaseFiles({ dashboardText: text, manifest: oldManifest(d) }), []);
    const next = after(), nextText = `${JSON.stringify(next, null, 2)}\n`, m = manifest(next);
    assert.deepEqual(verifyPublicReleaseFiles({ dashboardText: nextText, manifest: m }), []);
    m.data.abandonedRaces.pop();
    assert.ok(verifyPublicReleaseFiles({ dashboardText: nextText, manifest: m }).length);
  });

  it('publishes only the terminal identity and official source evidence, never private payloads', () => {
    const d = after(); d.terminalEntries[0].privateNotes = 'PRIVATE_SENTINEL';
    d.terminalEntries[0].stake = 123; d.terminalEntries[0].runners = [{ private: 'PRIVATE_SENTINEL' }];
    d.terminalEntries[0].terminalEvidence.rawHtml = 'PRIVATE_SENTINEL';
    const { publicSnapshot } = splitDashboardForPublishing(d);
    const m = manifest(publicSnapshot);
    assert.doesNotMatch(JSON.stringify({ publicSnapshot, m }), /PRIVATE_SENTINEL|rawHtml|"stake"/);
    assert.equal(m.data.settledRaces, 100);
    assert.deepEqual(publicSnapshot.ledger, []);
  });
});
