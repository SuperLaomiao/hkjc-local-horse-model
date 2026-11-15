import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseLocalResultHtml, fetchLocalResultRace, fetchMeetingResults } from '../src/hkjc-parser.js';
import { getDatabaseStats, loadRacesFromDatabase, syncRaceFilesToDatabase } from '../src/sqlite-store.js';
import { buildDashboardSnapshot, buildRaceForecast, settleForecast } from '../src/model.js';
import { projectAbandonedRace } from '../src/race-terminal.js';
import { mergeOfficialMeetingRecords } from '../src/refresh-window.js';
import { abandonedHtml, abandonedRace } from './abandoned-fixtures.js';

const context = { date: '2026-11-14', racecourse: 'ST', raceNo: 6, observedAt: '2026-11-14T11:00:00Z' };

describe('official abandoned race lifecycle', () => {
  it('parses an identity-checked official cancellation/refund without a winner or normal result', () => {
    const race = abandonedRace();
    assert.equal(race.status, 'abandoned');
    assert.deepEqual(race.runners, []);
    assert.equal(race.winnerHorseId, undefined);
    assert.equal(race.dividends, undefined);
    assert.equal(race.terminalEvidence.status, 'ABANDONED');
    assert.equal(race.terminalEvidence.refund, true);
    assert.match(race.terminalEvidence.sha256, /^[a-f0-9]{64}$/);
    assert.equal(race.terminalEvidence.observedAt, '2026-11-14T11:00:00.000Z');
    assert.equal(projectAbandonedRace(race).raceId, '2026-11-14-ST-6');
  });

  it('rejects wrong or missing displayed date, course, selected race, refund and cancellation evidence', () => {
    for (const html of [
      abandonedHtml({ date: '11/11/2026' }), abandonedHtml({ racecourse: 'HV' }),
      abandonedHtml({ raceNo: 7 }), abandonedHtml({ refund: false }),
      abandonedHtml().replace('Race Meeting:', 'Unknown:'),
      abandonedHtml().replace('racecard_rt_6_o.gif', 'racecard_rt_6.gif'),
      abandonedHtml().replace('This race is declared abandoned.', ''),
      abandonedHtml().replace('</tr></table>', '<td><img src="racecard_rt_7_o.gif"></td></tr></table>'),
    ]) assert.throws(() => parseLocalResultHtml(html, context));
  });

  it('rejects fallback/foreign final response URLs and preserves a verified terminal during meeting fetching', async () => {
    for (const url of [
      'https://racing.hkjc.com/en-us/local/information/localresults?racedate=2026/11/11&Racecourse=ST&RaceNo=6',
      'https://example.com/en-us/local/information/localresults?racedate=2026/11/14&Racecourse=ST&RaceNo=6',
    ]) await assert.rejects(fetchLocalResultRace({ ...context, fetchImpl: async () => ({ ok: true, url, text: async () => abandonedHtml() }) }));
    const result = await fetchMeetingResults({ ...context, races: [6], fetchImpl: async () => ({ ok: true, text: async () => abandonedHtml() }) });
    assert.equal(result.races[0].status, 'abandoned');
    assert.deepEqual(result.errors, []);
  });

  it('persists cancellation idempotently and prevents stale cards or normal rows from resurrecting it', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'hkjc-abandoned-'));
    try {
      const file = path.join(root, 'races.json');
      const dbPath = path.join(root, 'test.sqlite');
      const race = abandonedRace();
      await writeFile(file, JSON.stringify([race]));
      syncRaceFilesToDatabase({ dbPath, inputPath: file });
      syncRaceFilesToDatabase({ dbPath, inputPath: file });
      await writeFile(file, JSON.stringify([{ ...race, status: 'upcoming', terminalEvidence: undefined }]));
      syncRaceFilesToDatabase({ dbPath, inputPath: file, sourceKind: 'upcoming' });
      const stats = getDatabaseStats(dbPath);
      assert.equal(stats.settledRaces, 0);
      assert.equal(stats.upcomingRaces, 0);
      assert.equal(stats.abandonedRaces, 1);
      const stored = loadRacesFromDatabase({ dbPath, status: 'abandoned' });
      assert.deepEqual(projectAbandonedRace(stored[0]), projectAbandonedRace(race));
      await writeFile(file, JSON.stringify([{ ...race, status: 'settled', terminalEvidence: undefined }]));
      assert.throws(() => syncRaceFilesToDatabase({ dbPath, inputPath: file }), /terminal|conflict|abandoned/i);
      assert.equal(getDatabaseStats(dbPath).abandonedRaces, 1);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('excludes cancellations from forecasting, settled totals, training and performance', () => {
    const race = abandonedRace();
    const snapshot = buildDashboardSnapshot([race], { upcomingRaces: [{ ...race, status: 'upcoming' }] });
    assert.equal(snapshot.summary.racesSettled, 0);
    assert.equal(snapshot.summary.modelStateRaces, 0);
    assert.deepEqual(snapshot.upcomingEntries, []);
    assert.deepEqual(snapshot.recentEntries, []);
    assert.equal(snapshot.latestSettlement, null);
    assert.equal(snapshot.latestUpcomingForecast, null);
    assert.equal(snapshot.terminalEntries[0].raceId, race.raceId);
    assert.equal(snapshot.terminalEntries[0].forecast, undefined);
    assert.throws(() => buildRaceForecast(race), /abandoned|terminal/i);
    assert.throws(() => settleForecast({}, race), /abandoned|normal/i);
  });

  it('exports a terminal from SQLite through the real dashboard CLI without private rows', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'hkjc-abandoned-cli-'));
    try {
      const input = path.join(root, 'race.json');
      const dbPath = path.join(root, 'test.sqlite');
      const output = path.join(root, 'dashboard.json');
      await writeFile(input, JSON.stringify([abandonedRace()]));
      syncRaceFilesToDatabase({ dbPath, inputPath: input });
      const result = spawnSync(process.execPath, ['hkjc-horse-model/src/cli.js', 'dashboard-db', '--db', dbPath, '--output', output, '--privateHistoryOutput', path.join(root, 'private-history.json')], { cwd: path.resolve(import.meta.dirname, '../..'), encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      const snapshot = JSON.parse(await readFile(output, 'utf8'));
      assert.equal(snapshot.dataSource.settledRaces, 0);
      assert.equal(snapshot.dataSource.upcomingRaces, 0);
      assert.equal(snapshot.terminalEntries[0].status, 'abandoned');
      assert.deepEqual(snapshot.ledger, []);
      assert.equal(snapshot.dataSource.database, undefined);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('keeps known cancellation evidence during partial refreshes and rejects conflicting rewrites', () => {
    const race = abandonedRace();
    assert.deepEqual(mergeOfficialMeetingRecords([race], []), [race]);
    assert.deepEqual(mergeOfficialMeetingRecords([race], [race]), [race]);
    assert.throws(() => mergeOfficialMeetingRecords([race], [{ raceId: race.raceId }]), /conflict/i);
  });

  it('leaves mixed-meeting normal performance and model training unchanged', () => {
    const race = { raceId: '2026-11-14-ST-1', date: '2026-11-14', racecourse: 'ST', raceNo: 1, distance: 1200, surface: 'TURF',
      runners: [1, 2, 3].map((n) => ({ horseId: `H${n}`, horseNo: n, horseName: `Horse ${n}`, placing: n, winOdds: n + 1 })) };
    const baseline = buildDashboardSnapshot([race]);
    const mixed = buildDashboardSnapshot([race, abandonedRace()]);
    assert.deepEqual(mixed.summary, baseline.summary);
    assert.deepEqual(mixed.performance, baseline.performance);
    assert.equal(mixed.summary.racesSettled, 1);
    assert.equal(mixed.summary.modelStateRaces, 1);
    assert.equal(mixed.terminalEntries.length, 1);
    assert.throws(() => buildDashboardSnapshot([race, { ...abandonedRace(1) }]), /conflict/i);
  });
});
