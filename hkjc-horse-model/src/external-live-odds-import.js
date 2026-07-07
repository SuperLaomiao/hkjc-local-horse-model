import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

import { recordOddsSnapshots } from './sqlite-store.js';

const DEFAULT_SOURCE = 'eprochasson/horserace_data';
export const DEFAULT_EPROCHASSON_RACES_URL = 'https://raw.githubusercontent.com/eprochasson/horserace_data/master/data/races.csv.gz';
export const DEFAULT_EPROCHASSON_LIVE_ODDS_URL = 'https://raw.githubusercontent.com/eprochasson/horserace_data/master/data/live_odds.csv.gz';
const POOL_MAP = [
  ['win', 'WIN'],
  ['pla', 'PLACE'],
];

export async function importExternalLiveOddsToDatabase({
  dbPath,
  racesPath,
  liveOddsPath,
  source = DEFAULT_SOURCE,
  limit = null,
}) {
  if (!dbPath) throw new Error('importExternalLiveOddsToDatabase requires dbPath');
  if (!racesPath) throw new Error('importExternalLiveOddsToDatabase requires racesPath');
  if (!liveOddsPath) throw new Error('importExternalLiveOddsToDatabase requires liveOddsPath');

  const [racesCsv, liveOddsCsv] = await Promise.all([
    readExternalText(racesPath),
    readExternalText(liveOddsPath),
  ]);
  const result = normalizeExternalLiveOddsRows({
    racesCsv,
    liveOddsCsv,
    source,
    limit,
  });

  recordOddsSnapshots({ dbPath, snapshots: result.snapshots });

  return result;
}

export function normalizeExternalLiveOddsRows({
  racesCsv,
  liveOddsCsv,
  source = DEFAULT_SOURCE,
  limit = null,
}) {
  if (!racesCsv) throw new Error('normalizeExternalLiveOddsRows requires racesCsv');
  if (!liveOddsCsv) throw new Error('normalizeExternalLiveOddsRows requires liveOddsCsv');

  const raceTimes = buildRaceTimeIndex(parseCsv(racesCsv));
  const summary = {
    source,
    rowsSeen: 0,
    rowsMatched: 0,
    rowsSkippedNoRace: 0,
    rowsSkippedBadData: 0,
    oddsSnapshots: 0,
    pools: {},
  };
  const snapshots = [];

  for (const row of parseCsv(liveOddsCsv)) {
    if (limit != null && summary.rowsSeen >= Number(limit)) break;
    summary.rowsSeen += 1;

    const raceKey = externalRaceKey({
      date: normalizeExternalDate(row.race_date),
      racecourse: normalizeRacecourse(row.race_location),
      raceNo: toInteger(row.race_no),
    });
    const race = raceTimes.get(raceKey);
    if (!race) {
      summary.rowsSkippedNoRace += 1;
      continue;
    }

    const captureTime = parseNaiveUtc(row.capture_time);
    const oddsPayload = parseOddsPayload(row.data);
    if (!captureTime || !oddsPayload) {
      summary.rowsSkippedBadData += 1;
      continue;
    }

    const minutesToPost = Math.round((race.postTimeUtcMs - captureTime.getTime()) / 60000);
    let rowSnapshots = 0;

    for (const [externalPool, pool] of POOL_MAP) {
      const prices = oddsPayload[externalPool];
      if (!prices || typeof prices !== 'object') continue;

      for (const [horseNoText, oddsText] of Object.entries(prices)) {
        const horseNo = toInteger(horseNoText);
        const oddsValue = toNumber(oddsText);
        if (!Number.isInteger(horseNo) || !Number.isFinite(oddsValue) || oddsValue <= 0) continue;

        snapshots.push({
          raceId: race.raceId,
          date: race.date,
          racecourse: race.racecourse,
          raceNo: race.raceNo,
          capturedAt: captureTime.toISOString(),
          minutesToPost,
          pool,
          combination: [horseNo],
          oddsValue,
          source,
          raw: {
            source,
            externalRaceKey: raceKey,
            captureTime: row.capture_time,
            captureTimeAssumption: 'eprochasson capture_time treated as UTC; HK post time converted to UTC for minutes_to_post',
            pool: externalPool,
            horseNo: horseNoText,
            odds: oddsText,
          },
        });
        summary.pools[pool] = (summary.pools[pool] ?? 0) + 1;
        summary.oddsSnapshots += 1;
        rowSnapshots += 1;
      }
    }

    if (rowSnapshots > 0) {
      summary.rowsMatched += 1;
    } else {
      summary.rowsSkippedBadData += 1;
    }
  }

  return { summary, snapshots };
}

function buildRaceTimeIndex(rows) {
  const raceTimes = new Map();
  for (const row of rows) {
    if (String(row.race_country ?? '').trim().toUpperCase() !== 'HK') continue;
    const date = normalizeExternalDate(row.race_date);
    const racecourse = normalizeRacecourse(row.race_location);
    const raceNo = toInteger(row.race_no);
    const postTimeUtcMs = parseHongKongPostTimeUtcMs(date, row.race_time);
    if (!date || !racecourse || !Number.isInteger(raceNo) || !Number.isFinite(postTimeUtcMs)) continue;

    raceTimes.set(externalRaceKey({ date, racecourse, raceNo }), {
      raceId: `${date}-${racecourse}-${raceNo}`,
      date,
      racecourse,
      raceNo,
      postTimeUtcMs,
    });
  }
  return raceTimes;
}

function parseCsv(text) {
  const lines = String(text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((line) => line.trim() !== '');
  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && inQuotes && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

async function readExternalText(location) {
  const buffer = await readExternalBuffer(location);
  const bytes = String(location).endsWith('.gz') ? gunzipSync(buffer) : buffer;
  return bytes.toString('utf8');
}

async function readExternalBuffer(location) {
  const text = String(location);
  if (/^https?:\/\//i.test(text)) {
    const response = await fetch(text);
    if (!response.ok) throw new Error(`Failed to fetch ${text}: ${response.status} ${response.statusText}`);
    return Buffer.from(await response.arrayBuffer());
  }
  return readFile(text);
}

function parseOddsPayload(value) {
  try {
    const parsed = JSON.parse(String(value ?? ''));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeExternalDate(value) {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function normalizeRacecourse(value) {
  const text = String(value ?? '').trim().toUpperCase();
  if (text === 'HV' || text.includes('HAPPY')) return 'HV';
  if (text === 'ST' || text.includes('SHA')) return 'ST';
  return text || null;
}

function parseHongKongPostTimeUtcMs(date, time) {
  if (!date) return NaN;
  const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = String(time ?? '').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!dateMatch || !timeMatch) return NaN;

  const [, year, month, day] = dateMatch.map(Number);
  const [, hour, minute, second = '0'] = timeMatch;
  return Date.UTC(year, month - 1, day, Number(hour) - 8, Number(minute), Number(second));
}

function parseNaiveUtc(value) {
  const match = String(value ?? '').match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/,
  );
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction = '0'] = match;
  const millisecond = Number(fraction.padEnd(3, '0').slice(0, 3));
  return new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    millisecond,
  ));
}

function externalRaceKey({ date, racecourse, raceNo }) {
  return `${date}|${racecourse}|${raceNo}`;
}

function toInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}
