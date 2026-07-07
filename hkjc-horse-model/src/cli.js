#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { backtestRaces, buildDashboardSnapshot, buildRollingPredictionLedger, calibrateConfig } from './model.js';
import { splitDashboardForPublishing } from './dashboard-publish.js';
import { auditRecommendationRuns } from './recommendation-audit.js';
import {
  buildAsOfTrainingRows,
  summarizeTrainingRows,
} from './training-dataset.js';
import {
  buildModelLeaderboard,
  predictionRowsFromLedger,
} from './model-leaderboard.js';
import {
  fetchFixtureMeetings,
  fetchMeetingRaceCards,
  fetchMeetingResults,
  normalizeRaceDate,
  parseRaceUrl,
} from './hkjc-parser.js';
import {
  getDatabaseStats,
  loadRacesFromDatabase,
  loadRecommendationRuns,
  recordOddsSnapshot,
  recordPoolSnapshot,
  recordRecommendationRun,
  syncRaceFilesToDatabase,
} from './sqlite-store.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(dirname, '..');
const rawDataDir = path.join(projectRoot, 'data', 'raw');
const upcomingDataDir = path.join(projectRoot, 'data', 'upcoming');
const processedDataDir = path.join(projectRoot, 'data', 'processed');
const sqliteDbPath = path.join(projectRoot, 'data', 'hkjc.sqlite');

async function main(argv) {
  const [command, ...rest] = argv;
  const args = parseArgs(rest);

  if (!command || command === 'help' || args.help) {
    printHelp();
    return;
  }

  if (command === 'fetch') {
    await fetchCommand(args);
    return;
  }

  if (command === 'fetch-url') {
    await fetchUrlCommand(rest);
    return;
  }

  if (command === 'fetch-racecard') {
    await fetchRaceCardCommand(args);
    return;
  }

  if (command === 'refresh') {
    await refreshCommand(args);
    return;
  }

  if (command === 'auto-run') {
    await autoRunCommand(args);
    return;
  }

  if (command === 'sync-db') {
    await syncDbCommand(args);
    return;
  }

  if (command === 'dashboard-db') {
    await dashboardDbCommand(args);
    return;
  }

  if (command === 'training-dataset') {
    await trainingDatasetCommand(args);
    return;
  }

  if (command === 'model-leaderboard') {
    await modelLeaderboardCommand(args);
    return;
  }

  if (command === 'train-model') {
    await trainModelCommand(args);
    return;
  }

  if (command === 'market-snapshot') {
    await marketSnapshotCommand(args);
    return;
  }

  if (command === 'recommendation-audit') {
    await recommendationAuditCommand(args);
    return;
  }

  if (command === 'backtest') {
    await backtestCommand(args);
    return;
  }

  if (command === 'calibrate') {
    await calibrateCommand(args);
    return;
  }

  if (command === 'dashboard') {
    await dashboardCommand(args);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

async function syncDbCommand(args) {
  const dbPath = path.resolve(args.db ?? sqliteDbPath);
  const inputPath = path.resolve(args.input ?? rawDataDir);
  const upcomingPath = path.resolve(args.upcoming ?? upcomingDataDir);

  let upcomingSummary = null;
  if (!args.skipUpcoming && existsSync(upcomingPath)) {
    upcomingSummary = syncRaceFilesToDatabase({
      dbPath,
      inputPath: upcomingPath,
      sourceKind: 'upcoming',
    });
  }

  const rawSummary = syncRaceFilesToDatabase({
    dbPath,
    inputPath,
    sourceKind: 'raw',
  });

  const stats = getDatabaseStats(dbPath);
  console.log(`SQLite database synced: ${dbPath}`);
  console.log(`Raw files ${rawSummary.filesSeen}, races ${rawSummary.racesSeen}, runners ${rawSummary.runnersSeen}, dividends ${rawSummary.dividendsSeen}`);
  if (upcomingSummary) {
    console.log(`Upcoming files ${upcomingSummary.filesSeen}, races ${upcomingSummary.racesSeen}, runners ${upcomingSummary.runnersSeen}`);
  }
  console.log(`Database totals: ${stats.races} races (${stats.settledRaces} settled, ${stats.upcomingRaces} upcoming), ${stats.runners} runners, ${stats.dividends} dividends`);
}

async function autoRunCommand(args) {
  await syncDbCommand(args);
  const dashboardOutput = args.output ?? path.join(process.cwd(), 'data', 'dashboard.json');

  if (args.marketInput) {
    const marketInputPath = path.resolve(args.marketInput);
    if (existsSync(marketInputPath)) {
      await marketSnapshotCommand({
        ...args,
        input: marketInputPath,
      });
    } else {
      console.log(`Market snapshot skipped: ${marketInputPath} does not exist`);
    }
  }

  await dashboardDbCommand({
    ...args,
    output: dashboardOutput,
  });

  await recommendationAuditCommand({
    ...args,
    output: args.auditOutput ?? path.join(path.dirname(path.resolve(dashboardOutput)), 'latest-recommendation-audit.json'),
  });

  console.log('Auto run complete');
}

async function dashboardDbCommand(args) {
  const dbPath = path.resolve(args.db ?? sqliteDbPath);
  const settledRaces = loadRacesFromDatabase({ dbPath, status: 'settled' });
  const upcomingRaces = loadRacesFromDatabase({ dbPath, status: 'upcoming' });
  const snapshot = buildDashboardSnapshot(settledRaces, {
    minEdge: args.minEdge == null ? 0 : Number(args.minEdge),
    minProbability: args.minProbability == null ? 0.15 : Number(args.minProbability),
    bankroll: args.bankroll == null ? 1000 : Number(args.bankroll),
    maxStakePct: args.maxStakePct == null ? 0.0125 : Number(args.maxStakePct),
    finalEdgeBuffer: args.finalEdgeBuffer == null ? 0.08 : Number(args.finalEdgeBuffer),
    allowProbabilityOnly: args.allowProbabilityOnly !== 'false',
    upcomingRaces,
  });

  snapshot.dataSource = {
    source: 'sqlite',
    database: publicDatabaseLabel(dbPath),
    settledRaces: settledRaces.length,
    upcomingRaces: upcomingRaces.length,
  };

  recordDashboardRecommendationRun({
    dbPath,
    snapshot,
    args,
  });

  const outputPath = path.resolve(args.output ?? path.join(processedDataDir, 'dashboard.json'));
  const historyOutputPath = path.resolve(args.historyOutput ?? path.join(path.dirname(outputPath), 'dashboard-history.json'));
  const { publicSnapshot, historySnapshot } = splitDashboardForPublishing(snapshot, {
    embeddedLedgerLimit: args.embeddedLedgerLimit,
    historyUrl: path.basename(historyOutputPath),
  });

  await mkdir(path.dirname(outputPath), { recursive: true });
  await mkdir(path.dirname(historyOutputPath), { recursive: true });
  await writeJson(outputPath, publicSnapshot);
  await writeJson(historyOutputPath, historySnapshot);

  console.log(`Dashboard snapshot from SQLite: ${snapshot.summary.racesSettled} settled races`);
  console.log(`Upcoming forecasts: ${snapshot.upcomingEntries.length}`);
  console.log(`Saved dashboard data to ${outputPath}`);
  console.log(`Saved dashboard history to ${historyOutputPath}`);
}

async function trainingDatasetCommand(args) {
  const dbPath = path.resolve(args.db ?? sqliteDbPath);
  const settledRaces = loadRacesFromDatabase({ dbPath, status: 'settled' });
  const rows = buildAsOfTrainingRows(settledRaces);
  const summary = summarizeTrainingRows(rows);
  const outputPath = path.resolve(args.output ?? path.join(processedDataDir, 'training-dataset.json'));

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeJson(outputPath, {
    generatedAt: summary.generatedAt,
    dataSource: {
      source: 'sqlite',
      database: publicDatabaseLabel(dbPath),
      settledRaces: settledRaces.length,
    },
    summary,
    rows,
  });

  console.log(`Training dataset from SQLite: ${summary.rows} runner rows, ${summary.races} races`);
  console.log(`Saved training dataset to ${outputPath}`);
}

async function modelLeaderboardCommand(args) {
  const dbPath = path.resolve(args.db ?? sqliteDbPath);
  const settledRaces = loadRacesFromDatabase({ dbPath, status: 'settled' });
  const ledger = buildRollingPredictionLedger(settledRaces, {
    minEdge: args.minEdge == null ? 0 : Number(args.minEdge),
    minProbability: args.minProbability == null ? 0.15 : Number(args.minProbability),
  });
  const predictionRows = predictionRowsFromLedger(ledger.entries);
  const leaderboard = buildModelLeaderboard([
    {
      modelId: 'heuristic-current',
      label: 'Current heuristic rolling model',
      rows: predictionRows,
    },
  ]);
  const outputPath = path.resolve(args.output ?? path.join(processedDataDir, 'model-leaderboard.json'));

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeJson(outputPath, {
    ...leaderboard,
    dataSource: {
      source: 'sqlite',
      database: publicDatabaseLabel(dbPath),
      settledRaces: settledRaces.length,
    },
  });

  console.log(`Model leaderboard from SQLite: ${settledRaces.length} settled races`);
  console.log(`Saved model leaderboard to ${outputPath}`);
}

async function trainModelCommand(args) {
  const inputPath = path.resolve(args.input ?? path.join(processedDataDir, 'training-dataset.json'));
  const outputPath = path.resolve(args.output ?? path.join(processedDataDir, 'model-training-report.json'));
  const scriptPath = path.join(projectRoot, 'python', 'train_logit_model.py');
  const result = spawnSync('python3', [
    scriptPath,
    '--input',
    inputPath,
    '--output',
    outputPath,
    '--iterations',
    String(args.iterations ?? 160),
    '--learningRate',
    String(args.learningRate ?? 0.05),
    '--l2',
    String(args.l2 ?? 0.001),
  ], {
    encoding: 'utf8',
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`train-model failed with exit code ${result.status}`);
  }
}

function recordDashboardRecommendationRun({ dbPath, snapshot, args }) {
  const forecast = snapshot.latestUpcomingForecast?.raceId
    ? snapshot.latestUpcomingForecast
    : snapshot.latestForecast;
  if (!forecast?.raceId) return null;

  return recordRecommendationRun({
    dbPath,
    run: {
      raceId: forecast.raceId,
      raceNo: forecast.raceNo,
      date: forecast.date,
      racecourse: forecast.racecourse,
      generatedAt: snapshot.generatedAt,
      modelVersion: 'hkjc-local-horse-model',
      strategyVersion: forecast.finalBetPlan?.strategyVersion ?? 'ev-portfolio-v1',
      bankroll: args.bankroll == null ? 1000 : Number(args.bankroll),
      finalEdgeBuffer: args.finalEdgeBuffer == null ? 0.08 : Number(args.finalEdgeBuffer),
      recommendations: extractRecommendationLines(forecast),
      summary: {
        status: forecast.status,
        mode: forecast.finalBetPlan?.mode ?? forecast.recommendation?.action ?? 'unknown',
        topPickHorseNo: forecast.topPick?.horseNo ?? null,
        topPickHorseName: forecast.topPick?.horseName ?? null,
        upcomingEntries: snapshot.upcomingEntries?.length ?? 0,
      },
    },
  });
}

function extractRecommendationLines(forecast) {
  if (Array.isArray(forecast.finalBetPlan?.cashLines)) return forecast.finalBetPlan.cashLines;
  if (forecast.finalBetPlan) return [forecast.finalBetPlan];
  if (forecast.recommendation) return [forecast.recommendation];
  return [];
}

async function marketSnapshotCommand(args) {
  const dbPath = path.resolve(args.db ?? sqliteDbPath);
  const inputPath = path.resolve(args.input ?? path.join(projectRoot, 'data', 'market-snapshot.json'));
  const payload = JSON.parse(await readFile(inputPath, 'utf8'));
  const oddsSnapshots = normalizeMarketSnapshotItems(payload, ['odds', 'oddsSnapshots']);
  const poolSnapshots = normalizeMarketSnapshotItems(payload, ['pools', 'poolSnapshots']);

  for (const snapshot of oddsSnapshots) {
    recordOddsSnapshot({ dbPath, snapshot });
  }
  for (const snapshot of poolSnapshots) {
    recordPoolSnapshot({ dbPath, snapshot });
  }

  const stats = getDatabaseStats(dbPath);
  console.log(`Market snapshots imported: ${oddsSnapshots.length} odds, ${poolSnapshots.length} pools`);
  console.log(`Database market totals: ${stats.oddsSnapshots} odds snapshots, ${stats.poolSnapshots} pool snapshots`);
}

async function recommendationAuditCommand(args) {
  const dbPath = path.resolve(args.db ?? sqliteDbPath);
  const races = loadRacesFromDatabase({ dbPath, status: 'settled' });
  const runs = loadRecommendationRuns({ dbPath });
  const report = auditRecommendationRuns({ runs, races });
  const outputPath = path.resolve(args.output ?? path.join(processedDataDir, 'latest-recommendation-audit.json'));

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeJson(outputPath, report);

  console.log(`Saved recommendation audit to ${outputPath}`);
  console.log(`Recommendation audit: ${report.summary.settledRuns}/${report.summary.runs} runs settled, stake ${money(report.summary.totalStake)}, return ${money(report.summary.totalReturn)}, profit ${formatSigned(report.summary.profit)}, ROI ${report.summary.roi == null ? 'n/a' : percent(report.summary.roi)}`);
  console.log(`Lines: ${report.summary.hitLines} hit, ${report.summary.missLines} miss, ${report.summary.passLines} pass`);
}

async function fetchCommand(args) {
  const date = normalizeRaceDate(args.date);
  const racecourse = String(args.course ?? args.racecourse ?? '').toUpperCase();
  const races = parseRaceRange(args.races ?? args.race ?? '1-11');

  if (!date || !racecourse || races.length === 0) {
    throw new Error('fetch requires --date, --course, and --races');
  }

  const result = await fetchMeetingResults({
    date,
    racecourse,
    races,
    continueOnError: args.strict !== 'true',
  });

  await mkdir(rawDataDir, { recursive: true });
  const outputPath = path.join(rawDataDir, `${date}-${racecourse}.json`);
  await writeJson(outputPath, result.races);

  console.log(`Saved ${result.races.length} HKJC local races to ${outputPath}`);
  if (result.errors.length > 0) {
    console.log(`Skipped ${result.errors.length} races without parsable official results`);
    for (const error of result.errors) {
      console.log(`- race ${error.raceNo}: ${error.message}`);
    }
  }
}

async function fetchUrlCommand(rest) {
  const url = rest.find((item) => item.startsWith('http'));
  if (!url) throw new Error('fetch-url requires an HKJC local result URL');

  const { date, racecourse, raceNo } = parseRaceUrl(url);
  if (!date || !racecourse || !raceNo) {
    throw new Error(`Could not parse date, racecourse, and race number from ${url}`);
  }

  const result = await fetchMeetingResults({
    date,
    racecourse,
    races: [raceNo],
    continueOnError: false,
  });

  await mkdir(rawDataDir, { recursive: true });
  const outputPath = path.join(rawDataDir, `${date}-${racecourse}-R${raceNo}.json`);
  await writeJson(outputPath, result.races);
  console.log(`Saved ${result.races.length} HKJC local race to ${outputPath}`);
}

async function fetchRaceCardCommand(args) {
  const date = normalizeRaceDate(args.date);
  const racecourse = String(args.course ?? args.racecourse ?? '').toUpperCase();
  const races = parseRaceRange(args.races ?? args.race ?? '1-11');

  if (!date || !racecourse || races.length === 0) {
    throw new Error('fetch-racecard requires --date, --course, and --races');
  }

  const result = await fetchMeetingRaceCards({
    date,
    racecourse,
    races,
    continueOnError: args.strict !== 'true',
  });

  await mkdir(upcomingDataDir, { recursive: true });
  const outputPath = path.join(upcomingDataDir, `${date}-${racecourse}.json`);
  await writeJson(outputPath, result.races);

  console.log(`Saved ${result.races.length} HKJC local race cards to ${outputPath}`);
  if (result.errors.length > 0) {
    console.log(`Skipped ${result.errors.length} race cards without parsable starters`);
    for (const error of result.errors) {
      console.log(`- race ${error.raceNo}: ${error.message}`);
    }
  }
}

async function refreshCommand(args) {
  const today = normalizeRaceDate(args.today) ?? hongKongToday();
  const from = normalizeRaceDate(args.from) ?? addDays(today, -Number(args.historyDays ?? 14));
  const to = normalizeRaceDate(args.to) ?? addDays(today, Number(args.futureDays ?? 21));
  const courseFilter = args.course ? String(args.course).toUpperCase() : null;
  const meetings = await loadFixtureWindow(from, to);
  const selectedMeetings = meetings.filter((meeting) => {
    if (courseFilter && meeting.racecourse !== courseFilter) return false;
    return meeting.date >= from && meeting.date <= to;
  });
  let resultRaces = 0;
  let raceCardRaces = 0;

  console.log(`Refreshing HKJC local meetings ${from} to ${to} (today ${today})`);
  for (const meeting of selectedMeetings) {
    const races = parseRaceRange(args.races ?? `1-${meeting.raceCount ?? 11}`);

    if (meeting.date <= today) {
      const result = await fetchMeetingResults({
        date: meeting.date,
        racecourse: meeting.racecourse,
        races,
        continueOnError: true,
      });

      if (result.races.length > 0) {
        await mkdir(rawDataDir, { recursive: true });
        const outputPath = path.join(rawDataDir, `${meeting.date}-${meeting.racecourse}.json`);
        await writeJson(outputPath, result.races);
        resultRaces += result.races.length;
        console.log(`Results ${meeting.date} ${meeting.racecourse}: saved ${result.races.length}/${races.length}`);
      } else {
        console.log(`Results ${meeting.date} ${meeting.racecourse}: no official result rows yet`);
      }
    }

    if (meeting.date >= today) {
      const raceCards = await fetchMeetingRaceCards({
        date: meeting.date,
        racecourse: meeting.racecourse,
        races,
        continueOnError: true,
      });

      if (raceCards.races.length > 0) {
        await mkdir(upcomingDataDir, { recursive: true });
        const outputPath = path.join(upcomingDataDir, `${meeting.date}-${meeting.racecourse}.json`);
        await writeJson(outputPath, raceCards.races);
        raceCardRaces += raceCards.races.length;
        console.log(`Race cards ${meeting.date} ${meeting.racecourse}: saved ${raceCards.races.length}/${races.length}`);
      } else {
        console.log(`Race cards ${meeting.date} ${meeting.racecourse}: not published or not parsable yet`);
      }
    }
  }

  if (selectedMeetings.length === 0) {
    console.log('No HKJC local meetings found in the selected window.');
  }

  console.log(`Refresh fetched ${resultRaces} settled races and ${raceCardRaces} race-card races`);
  const nextLocalMeetings = selectedMeetings
    .filter((meeting) => meeting.date > today)
    .slice(0, 5);
  await dashboardCommand({
    ...args,
    input: args.input ?? rawDataDir,
    upcoming: args.upcoming ?? upcomingDataDir,
    nextLocalMeetings,
    fixtureWindow: {
      from,
      to,
      today,
      source: 'HKJC local fixture',
    },
  });
}

async function backtestCommand(args) {
  const races = await loadRaces(args.input ?? rawDataDir);
  const report = backtestRaces(races, {
    minEdge: args.minEdge == null ? 0 : Number(args.minEdge),
  });

  await mkdir(processedDataDir, { recursive: true });
  const outputPath = path.join(processedDataDir, 'latest-backtest.json');
  await writeJson(outputPath, report);

  printBacktestReport(report);
  console.log(`Saved report to ${outputPath}`);
}

async function calibrateCommand(args) {
  const races = await loadRaces(args.input ?? rawDataDir);
  const top = calibrateConfig(races).slice(0, Number(args.top ?? 5));

  await mkdir(processedDataDir, { recursive: true });
  const outputPath = path.join(processedDataDir, 'latest-calibration.json');
  await writeJson(outputPath, top);

  console.log('Top configs by model top-pick ROI:');
  for (const [index, item] of top.entries()) {
    console.log(`${index + 1}. ROI ${percent(item.report.modelTopPickRoi)} | win ${percent(item.report.modelTopPickWinRate)} | ${JSON.stringify(item.config)}`);
  }
  console.log(`Saved calibration to ${outputPath}`);
}

async function dashboardCommand(args) {
  const races = await loadRaces(args.input ?? rawDataDir);
  const upcomingRaces = await loadRacesIfExists(args.upcoming ?? upcomingDataDir);
  const snapshot = buildDashboardSnapshot(races, {
    minEdge: args.minEdge == null ? 0 : Number(args.minEdge),
    minProbability: args.minProbability == null ? 0.15 : Number(args.minProbability),
    bankroll: args.bankroll == null ? 1000 : Number(args.bankroll),
    maxStakePct: args.maxStakePct == null ? 0.0125 : Number(args.maxStakePct),
    finalEdgeBuffer: args.finalEdgeBuffer == null ? 0.08 : Number(args.finalEdgeBuffer),
    allowProbabilityOnly: args.allowProbabilityOnly !== 'false',
    upcomingRaces,
    nextLocalMeetings: args.nextLocalMeetings ?? [],
    fixtureWindow: args.fixtureWindow ?? null,
  });

  await mkdir(processedDataDir, { recursive: true });
  const outputPath = path.join(processedDataDir, 'dashboard.json');
  await writeJson(outputPath, snapshot);

  console.log(`Dashboard snapshot: ${snapshot.summary.racesSettled} settled races`);
  console.log(`Upcoming forecasts: ${snapshot.upcomingEntries.length}`);
  console.log(`Value bets: ${snapshot.summary.valueWins}/${snapshot.summary.valueBets} ROI ${percent(snapshot.summary.roi)}`);
  console.log(`Saved dashboard data to ${outputPath}`);
}

async function loadRaces(inputPath) {
  const absolutePath = path.resolve(inputPath);
  const statEntries = await collectJsonFiles(absolutePath);
  const races = [];

  for (const file of statEntries) {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    if (Array.isArray(parsed)) races.push(...parsed);
    else if (Array.isArray(parsed.races)) races.push(...parsed.races);
    else races.push(parsed);
  }

  return races.filter((race) => race?.runners?.length);
}

async function loadRacesIfExists(inputPath) {
  try {
    return await loadRaces(inputPath);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function collectJsonFiles(inputPath) {
  if (inputPath.endsWith('.json')) return [inputPath];
  const entries = await readdir(inputPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(inputPath, entry.name));
}

function normalizeMarketSnapshotItems(payload, keys) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

function parseArgs(values) {
  const args = {};
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function parseRaceRange(value) {
  const text = String(value).trim();
  const range = text.match(/^(\d+)-(\d+)$/);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }
  return text.split(',').map((item) => Number(item.trim())).filter(Number.isFinite);
}

async function loadFixtureWindow(from, to) {
  const meetings = [];
  for (const { year, month } of monthsBetween(from, to)) {
    meetings.push(...await fetchFixtureMeetings({ year, month }));
  }
  return meetings.sort((a, b) => a.date.localeCompare(b.date) || a.racecourse.localeCompare(b.racecourse));
}

function monthsBetween(from, to) {
  const start = parseDateParts(from);
  const end = parseDateParts(to);
  const months = [];
  let year = start.year;
  let month = start.month;

  while (year < end.year || (year === end.year && month <= end.month)) {
    months.push({ year, month });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return months;
}

function addDays(dateText, days) {
  const { year, month, day } = parseDateParts(dateText);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function parseDateParts(dateText) {
  const normalized = normalizeRaceDate(dateText);
  const [year, month, day] = normalized.split('-').map(Number);
  return { year, month, day };
}

function hongKongToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

async function writeJson(outputPath, value) {
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function printBacktestReport(report) {
  console.log(`Races: ${report.races}`);
  console.log(`Model top pick: ${report.modelTopPickWins}/${report.modelTopPickBets} win ${percent(report.modelTopPickWinRate)} ROI ${percent(report.modelTopPickRoi)}`);
  console.log(`HKJC market favourite: ${report.marketFavouriteWins}/${report.marketFavouriteBets} win ${percent(report.marketFavouriteWinRate)} ROI ${percent(report.marketFavouriteRoi)}`);
  console.log(`Value bets: ${report.valueWins}/${report.valueBets} win ${percent(report.valueWinRate)} ROI ${percent(report.valueRoi)}`);
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function money(value) {
  return Number(value ?? 0).toFixed(2);
}

function formatSigned(value) {
  const number = Number(value ?? 0);
  return `${number >= 0 ? '+' : ''}${number.toFixed(2)}`;
}

function printHelp() {
  console.log(`
HKJC local horse model

Commands:
  fetch      --date 2026-01-04 --course ST --races 1-11
  fetch-racecard --date 2026-06-13 --course ST --races 1-11
  refresh    --historyDays 14 --futureDays 21 --bankroll 200 --minEdge 0 --minProbability 0.15
  auto-run   --input hkjc-horse-model/data/raw --db hkjc-horse-model/data/hkjc.sqlite --output data/dashboard.json --auditOutput data/latest-recommendation-audit.json
  sync-db    --input hkjc-horse-model/data/raw --upcoming hkjc-horse-model/data/upcoming --db hkjc-horse-model/data/hkjc.sqlite
  dashboard-db --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/processed/dashboard.json --historyOutput hkjc-horse-model/data/processed/dashboard-history.json
  training-dataset --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/processed/training-dataset.json
  model-leaderboard --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/processed/model-leaderboard.json
  train-model --input hkjc-horse-model/data/processed/training-dataset.json --output hkjc-horse-model/data/processed/model-training-report.json
  market-snapshot --input hkjc-horse-model/data/market-snapshot.json --db hkjc-horse-model/data/hkjc.sqlite
  recommendation-audit --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/processed/latest-recommendation-audit.json
  fetch-url  https://racing.hkjc.com/en-us/local/information/localresults?RaceNo=2&Racecourse=ST&racedate=2026%2F01%2F04
  backtest   --input hkjc-horse-model/data/raw --minEdge 0
  calibrate  --input hkjc-horse-model/data/raw --top 5
  dashboard  --input hkjc-horse-model/data/raw --bankroll 1000 --minEdge 0 --minProbability 0.15

Notes:
  - Only local Hong Kong races are fetched from official HKJC result pages.
  - Race cards are unsettled pre-race inputs, stored separately under data/upcoming.
  - ST = Sha Tin, HV = Happy Valley.
  - Backtest predicts each race using only races seen earlier in chronological order.
`);
}

function publicDatabaseLabel(dbPath) {
  const relative = path.relative(process.cwd(), dbPath);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return relative;
  return path.basename(dbPath);
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
