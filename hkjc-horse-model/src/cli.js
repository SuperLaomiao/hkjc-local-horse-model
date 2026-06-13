#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { backtestRaces, buildDashboardSnapshot, calibrateConfig } from './model.js';
import {
  fetchFixtureMeetings,
  fetchMeetingRaceCards,
  fetchMeetingResults,
  normalizeRaceDate,
  parseRaceUrl,
} from './hkjc-parser.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(dirname, '..');
const rawDataDir = path.join(projectRoot, 'data', 'raw');
const upcomingDataDir = path.join(projectRoot, 'data', 'upcoming');
const processedDataDir = path.join(projectRoot, 'data', 'processed');

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

function printHelp() {
  console.log(`
HKJC local horse model

Commands:
  fetch      --date 2026-01-04 --course ST --races 1-11
  fetch-racecard --date 2026-06-13 --course ST --races 1-11
  refresh    --historyDays 14 --futureDays 21 --bankroll 200 --minEdge 0 --minProbability 0.15
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

main(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
