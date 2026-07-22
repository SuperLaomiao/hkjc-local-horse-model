import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { normalizeTianxiHorseCode } from './tianxi-form-features.js';
import { splitForDate } from './training-dataset.js';

const SOURCE_ID = 'sleepingarhat-tianxi-speedpro';
const HONG_KONG_OFFSET_MS = 8 * 60 * 60 * 1000;

export async function loadSpeedproFeatureIndex({
  rootPath,
  races = [],
  checkoutRef = null,
  prospectiveFreezeDate = null,
} = {}) {
  if (!rootPath) throw new Error('loadSpeedproFeatureIndex requires rootPath');
  const normalizedProspectiveFreezeDate = normalizeOptionalDate(
    prospectiveFreezeDate,
    'prospectiveFreezeDate',
  );

  const runnerRequests = (races ?? []).flatMap((race) => (
    (race.runners ?? []).map((runner) => ({ race, runner }))
  ));
  const featuresByRunner = new Map(
    runnerRequests.map(({ race, runner }) => [
      speedproRunnerFeatureKey(race, runner),
      emptySpeedproFeatures(),
    ]),
  );
  const provenanceByRunner = new Map(
    runnerRequests.map(({ race, runner }) => [speedproRunnerFeatureKey(race, runner), null]),
  );
  const meetings = groupRequestsByMeeting(runnerRequests);
  const coverageByRaceDate = buildEmptyDateCoverage(runnerRequests);
  const coverageByCohort = buildEmptyCohortCoverage(
    runnerRequests,
    normalizedProspectiveFreezeDate,
  );
  const audit = {
    meetingFilesRequested: meetings.size,
    meetingFilesRead: 0,
    missingMeetingFiles: 0,
    invalidMeetingFiles: 0,
    excludedMissingSnapshotTimeRunnerRows: 0,
    excludedMissingCutoffRunnerRows: 0,
    excludedPostTimeSnapshotRunnerRows: 0,
    excludedIdentityMismatchRunnerRows: 0,
    excludedCurrentOrFutureFormRows: 0,
    invalidFormDateRows: 0,
  };
  let availableFeatureRows = 0;

  for (const [meetingKey, requests] of meetings) {
    const [date, venue] = meetingKey.split('|');
    const sourcePath = path.join(rootPath, 'speedpro', 'data', `${date}_${venue}.json`);
    let document;
    try {
      document = JSON.parse(await readFile(sourcePath, 'utf8'));
      audit.meetingFilesRead += 1;
    } catch (error) {
      if (error?.code === 'ENOENT') audit.missingMeetingFiles += 1;
      else audit.invalidMeetingFiles += 1;
      continue;
    }

    if (!isMatchingMeeting(document, date, venue)) {
      audit.invalidMeetingFiles += 1;
      continue;
    }

    const capturedAtMs = parseSnapshotTime(document);
    const sourceRaces = new Map(
      (document.races ?? []).map((sourceRace) => [Number(sourceRace?.raceno), sourceRace]),
    );

    for (const { race, runner } of requests) {
      const dateCoverage = coverageByRaceDate[race.date];
      const cohortCoverage = coverageByCohort[
        speedproCohortForDate(race.date, normalizedProspectiveFreezeDate)
      ];
      if (!Number.isFinite(capturedAtMs)) {
        audit.excludedMissingSnapshotTimeRunnerRows += 1;
        dateCoverage.excludedTimingRunnerRows += 1;
        cohortCoverage.excludedTimingRunnerRows += 1;
        continue;
      }

      const sourceRace = sourceRaces.get(Number(race.raceNo));
      const cutoffMs = parseRaceCutoff(race, sourceRace);
      if (!Number.isFinite(cutoffMs)) {
        audit.excludedMissingCutoffRunnerRows += 1;
        dateCoverage.excludedTimingRunnerRows += 1;
        cohortCoverage.excludedTimingRunnerRows += 1;
        continue;
      }
      if (capturedAtMs >= cutoffMs) {
        audit.excludedPostTimeSnapshotRunnerRows += 1;
        dateCoverage.excludedTimingRunnerRows += 1;
        cohortCoverage.excludedTimingRunnerRows += 1;
        continue;
      }

      const result = buildRunnerFeatures({
        race,
        runner,
        sourceRace,
        snapshotLeadMinutes: Math.floor((cutoffMs - capturedAtMs) / 60000),
      });
      audit.excludedCurrentOrFutureFormRows += result.audit.excludedCurrentOrFutureFormRows;
      audit.invalidFormDateRows += result.audit.invalidFormDateRows;
      const runnerKey = speedproRunnerFeatureKey(race, runner);
      featuresByRunner.set(runnerKey, result.features);
      if (!result.identityMatched) {
        audit.excludedIdentityMismatchRunnerRows += 1;
        dateCoverage.excludedIdentityMismatchRunnerRows += 1;
        cohortCoverage.excludedIdentityMismatchRunnerRows += 1;
        continue;
      }
      if (result.features.speedproAvailable === 1) {
        availableFeatureRows += 1;
        dateCoverage.availableFeatureRows += 1;
        cohortCoverage.availableFeatureRows += 1;
        provenanceByRunner.set(runnerKey, {
          sourceId: SOURCE_ID,
          observedAt: new Date(capturedAtMs).toISOString(),
          horseCode: result.matchedHorseCode,
          identityMatched: true,
          observedBeforePost: capturedAtMs < cutoffMs,
        });
      }
    }
  }

  return {
    featuresByRunner,
    provenanceByRunner,
    summary: {
      sourceId: SOURCE_ID,
      checkoutRef: checkoutRef ?? await readGitHead(rootPath),
      requestedRunnerRows: runnerRequests.length,
      availableFeatureRows,
      unavailableFeatureRows: runnerRequests.length - availableFeatureRows,
      coverageByRaceDate: finalizeCoverage(coverageByRaceDate),
      coverageByCohort: finalizeCoverage(coverageByCohort),
      prospectiveFreezeDate: normalizedProspectiveFreezeDate,
      ...audit,
      publicationBoundary: 'Derived features and compact coverage only; raw paths, rows, and comments omitted.',
    },
  };
}

export function speedproRunnerFeatureKey(race, runner) {
  const horseCode = normalizeTianxiHorseCode(runner?.horseId ?? runner?.horseCode ?? runner?.brandNo);
  return `${race?.raceId ?? ''}|${horseCode ?? `horse-no-${runner?.horseNo ?? 'unknown'}`}`;
}

export function emptySpeedproFeatures() {
  return {
    speedproAvailable: 0,
    speedproSnapshotLeadMinutes: null,
    speedproEnergyRequired: null,
    speedproProjectedEnergy: null,
    speedproEnergyDifference: null,
    speedproFitnessRating: null,
    speedproLastRunEnergy: null,
    speedproBestEnergy12Months: null,
    speedproBestAtDistanceEnergy: null,
    speedproPriorRunCount: 0,
    speedproRecentEnergyAverage3: null,
    speedproRecentEnergyTrend3: null,
    speedproRecentFastPaceRate3: 0,
    speedproPriorIncidentRate5: 0,
    speedproPriorHealthIssueRate5: 0,
    speedproRecentFinalSectionalAverage3: null,
    speedproSameDistanceStarts: 0,
    speedproSameDistanceEnergyAverage: null,
  };
}

function buildRunnerFeatures({ race, runner, sourceRace, snapshotLeadMinutes }) {
  const horseCode = normalizeTianxiHorseCode(runner?.horseId ?? runner?.horseCode ?? runner?.brandNo);
  const energyRow = (sourceRace?.energy ?? []).find((row) => (
    normalizeTianxiHorseCode(row?.brandno) === horseCode
  ));
  const formRow = (sourceRace?.formguide ?? []).find((row) => (
    normalizeTianxiHorseCode(row?.brandno) === horseCode
  ));
  if (!horseCode || (!energyRow && !formRow)) {
    return {
      features: emptySpeedproFeatures(),
      audit: { excludedCurrentOrFutureFormRows: 0, invalidFormDateRows: 0 },
      identityMatched: false,
      matchedHorseCode: null,
    };
  }

  const priorRows = [];
  const audit = { excludedCurrentOrFutureFormRows: 0, invalidFormDateRows: 0 };
  for (const row of formRow?.runnerrecords ?? []) {
    const sourceDate = normalizeDate(row?.racedate ?? row?.runDate);
    if (!sourceDate) {
      audit.invalidFormDateRows += 1;
      continue;
    }
    if (sourceDate >= race.date) {
      audit.excludedCurrentOrFutureFormRows += 1;
      continue;
    }
    priorRows.push(normalizePriorRun(row, sourceDate));
  }
  priorRows.sort((left, right) => right.sourceDate.localeCompare(left.sourceDate));

  const recent3 = priorRows.slice(0, 3);
  const recent5 = priorRows.slice(0, 5);
  const sameDistance = priorRows.filter((row) => row.distance === numericOrNull(race.distance));
  const recentEnergies = recent3.map((row) => row.energy);
  const finalSectionals = recent3.map((row) => row.finalSectional);

  return {
    features: {
      speedproAvailable: 1,
      speedproSnapshotLeadMinutes: snapshotLeadMinutes,
      speedproEnergyRequired: numericOrNull(energyRow?.energyrequired),
      speedproProjectedEnergy: numericOrNull(energyRow?.speedproenergy),
      speedproEnergyDifference: numericOrNull(energyRow?.speedproenergydifference),
      speedproFitnessRating: numericOrNull(energyRow?.fitnessrating ?? formRow?.fitnessrating),
      speedproLastRunEnergy: numericOrNull(energyRow?.lastrun?.energy),
      speedproBestEnergy12Months: numericOrNull(energyRow?.bestlast12months?.energy),
      speedproBestAtDistanceEnergy: numericOrNull(energyRow?.bestatdistance?.energy),
      speedproPriorRunCount: priorRows.length,
      speedproRecentEnergyAverage3: average(recentEnergies),
      speedproRecentEnergyTrend3: finiteValues(recentEnergies).length >= 2
        ? round(finiteValues(recentEnergies)[0] - finiteValues(recentEnergies).at(-1))
        : null,
      speedproRecentFastPaceRate3: rate(recent3.filter((row) => row.fastPace).length, recent3.length),
      speedproPriorIncidentRate5: rate(recent5.filter((row) => row.hasIncident).length, recent5.length),
      speedproPriorHealthIssueRate5: rate(recent5.filter((row) => row.hasHealthIssue).length, recent5.length),
      speedproRecentFinalSectionalAverage3: average(finalSectionals),
      speedproSameDistanceStarts: sameDistance.length,
      speedproSameDistanceEnergyAverage: average(sameDistance.map((row) => row.energy)),
    },
    audit,
    identityMatched: true,
    matchedHorseCode: horseCode,
  };
}

function normalizePriorRun(row, sourceDate) {
  const sectionalTimes = Array.isArray(row?.sectional_times)
    ? row.sectional_times.map((sectional) => numericOrNull(sectional?.Key ?? sectional)).filter(Number.isFinite)
    : (row?.sectionalTimes ?? []).map(numericOrNull).filter(Number.isFinite);
  const pace = String(row?.pace_eng ?? row?.pace ?? row?.comment ?? '');
  return {
    sourceDate,
    energy: numericOrNull(row?.energy),
    distance: numericOrNull(row?.dist ?? row?.distance),
    finalSectional: sectionalTimes.at(-1) ?? null,
    fastPace: /fast/i.test(pace),
    hasIncident: hasText(row?.incident_eng ?? row?.incident),
    hasHealthIssue: hasText(row?.healthissue_eng ?? row?.healthIssue),
  };
}

function groupRequestsByMeeting(requests) {
  const meetings = new Map();
  for (const request of requests) {
    const key = `${request.race?.date ?? ''}|${String(request.race?.racecourse ?? '').toUpperCase()}`;
    const group = meetings.get(key) ?? [];
    group.push(request);
    meetings.set(key, group);
  }
  return meetings;
}

function buildEmptyDateCoverage(requests) {
  const coverage = {};
  for (const { race } of requests) {
    if (!coverage[race.date]) {
      coverage[race.date] = {
        requestedRunnerRows: 0,
        availableFeatureRows: 0,
        excludedTimingRunnerRows: 0,
        excludedIdentityMismatchRunnerRows: 0,
      };
    }
    coverage[race.date].requestedRunnerRows += 1;
  }
  return coverage;
}

function buildEmptyCohortCoverage(requests, prospectiveFreezeDate) {
  const coverage = Object.fromEntries(['train', 'validation', 'holdout', 'prospective'].map((cohort) => [
    cohort,
    {
      requestedRunnerRows: 0,
      availableFeatureRows: 0,
      excludedTimingRunnerRows: 0,
      excludedIdentityMismatchRunnerRows: 0,
    },
  ]));
  for (const { race } of requests) {
    coverage[speedproCohortForDate(race.date, prospectiveFreezeDate)].requestedRunnerRows += 1;
  }
  return coverage;
}

function speedproCohortForDate(date, prospectiveFreezeDate) {
  if (prospectiveFreezeDate && date >= prospectiveFreezeDate) return 'prospective';
  return splitForDate(date);
}

function finalizeCoverage(coverage) {
  return Object.fromEntries(Object.entries(coverage).map(([key, value]) => [key, {
    ...value,
    unavailableFeatureRows: value.requestedRunnerRows - value.availableFeatureRows,
  }]));
}

function isMatchingMeeting(document, date, venue) {
  return document != null
    && typeof document === 'object'
    && !Array.isArray(document)
    && document.racedate === date
    && String(document.venue ?? '').toUpperCase() === venue
    && Array.isArray(document.races);
}

function parseSnapshotTime(document) {
  const scrapedAtText = String(document?.scraped_at ?? '').trim();
  const lastUpdatedAtText = String(document?.lastupdatetime ?? '').trim();
  const timestamps = [];
  if (scrapedAtText) {
    const scrapedAt = parseAbsoluteTimestamp(scrapedAtText);
    if (!Number.isFinite(scrapedAt)) return Number.NaN;
    timestamps.push(scrapedAt);
  }
  if (lastUpdatedAtText) {
    const lastUpdatedAt = parseHongKongTimestamp(lastUpdatedAtText);
    if (!Number.isFinite(lastUpdatedAt)) return Number.NaN;
    timestamps.push(lastUpdatedAt);
  }
  return timestamps.length > 0 ? Math.max(...timestamps) : Number.NaN;
}

function parseAbsoluteTimestamp(value) {
  const text = String(value ?? '').trim();
  const match = text.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):?(\d{2}))$/i,
  );
  if (!match) return Number.NaN;
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6]),
    millisecond: Number(String(match[7] ?? '0').padEnd(3, '0')),
  };
  if (!isValidDateTime(parts)) return Number.NaN;

  let offsetMinutes = 0;
  if (match[8].toUpperCase() !== 'Z') {
    const offsetHour = Number(match[10]);
    const offsetMinute = Number(match[11]);
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) {
      return Number.NaN;
    }
    offsetMinutes = (offsetHour * 60 + offsetMinute) * (match[9] === '-' ? -1 : 1);
  }

  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  ) - offsetMinutes * 60000;
}

function parseHongKongTimestamp(value) {
  const match = String(value ?? '').trim().match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})\s+(AM|PM)$/i,
  );
  if (!match) return Number.NaN;
  const hour12 = Number(match[4]);
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: hour24(hour12, match[6]),
    minute: Number(match[5]),
    second: 0,
    millisecond: 0,
  };
  if (hour12 < 1 || hour12 > 12 || !isValidDateTime(parts)) return Number.NaN;
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
    - HONG_KONG_OFFSET_MS;
}

function parseRaceCutoff(race, sourceRace) {
  const startTimeText = String(race?.startTime ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(startTimeText)) {
    const absolute = parseAbsoluteTimestamp(startTimeText);
    const localDateTime = parseHongKongDateTime(startTimeText);
    const fullDateTime = Number.isFinite(absolute) ? absolute : localDateTime;
    if (!Number.isFinite(fullDateTime) || hongKongDate(fullDateTime) !== race?.date) {
      return Number.NaN;
    }
    return fullDateTime;
  }

  const localTime = parseClock(startTimeText)
    ?? parseClock(sourceRace?.raceinfo_eng?.PostTime)
    ?? parseClock(sourceRace?.raceinfo_chi?.PostTime);
  if (!localTime || !/^\d{4}-\d{2}-\d{2}$/.test(String(race?.date ?? ''))) return Number.NaN;
  const [year, month, day] = race.date.split('-').map(Number);
  return Date.UTC(year, month - 1, day, localTime.hour, localTime.minute) - HONG_KONG_OFFSET_MS;
}

function parseHongKongDateTime(value) {
  const match = String(value ?? '').trim().match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/,
  );
  if (!match) return Number.NaN;
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
    millisecond: 0,
  };
  if (!isValidDateTime(parts)) return Number.NaN;
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    - HONG_KONG_OFFSET_MS;
}

function parseClock(value) {
  const text = String(value ?? '').trim();
  const twentyFourHour = text.match(/^(\d{1,2}):(\d{2})$/);
  if (twentyFourHour) {
    const hour = Number(twentyFourHour[1]);
    const minute = Number(twentyFourHour[2]);
    return hour <= 23 && minute <= 59 ? { hour, minute } : null;
  }
  const twelveHour = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!twelveHour) return null;
  const hour = Number(twelveHour[1]);
  const minute = Number(twelveHour[2]);
  return hour >= 1 && hour <= 12 && minute <= 59
    ? { hour: hour24(hour, twelveHour[3]), minute }
    : null;
}

function hour24(hour, meridiem) {
  const normalized = hour % 12;
  return String(meridiem).toUpperCase() === 'PM' ? normalized + 12 : normalized;
}

function isValidDateTime({ year, month, day, hour, minute, second, millisecond }) {
  if (!Number.isInteger(year)
    || month < 1 || month > 12
    || day < 1 || day > 31
    || hour < 0 || hour > 23
    || minute < 0 || minute > 59
    || second < 0 || second > 59
    || millisecond < 0 || millisecond > 999) {
    return false;
  }
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
    && parsed.getUTCHours() === hour
    && parsed.getUTCMinutes() === minute
    && parsed.getUTCSeconds() === second
    && parsed.getUTCMilliseconds() === millisecond;
}

function hongKongDate(timestampMs) {
  return new Date(timestampMs + HONG_KONG_OFFSET_MS).toISOString().slice(0, 10);
}

function normalizeDate(value) {
  const text = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

function normalizeOptionalDate(value, label) {
  if (value == null || value === '') return null;
  const normalized = normalizeDate(value);
  if (!normalized) throw new Error(`${label} must be a valid YYYY-MM-DD date`);
  const [year, month, day] = normalized.split('-').map(Number);
  if (!isValidDateTime({ year, month, day, hour: 0, minute: 0, second: 0, millisecond: 0 })) {
    throw new Error(`${label} must be a valid YYYY-MM-DD date`);
  }
  return normalized;
}

function numericOrNull(value) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function hasText(value) {
  return String(value ?? '').replace(/<br\s*\/?>/gi, '').trim().length > 0;
}

function finiteValues(values) {
  return values.filter(Number.isFinite);
}

function average(values) {
  const numbers = finiteValues(values);
  return numbers.length > 0 ? round(numbers.reduce((total, value) => total + value, 0) / numbers.length) : null;
}

function rate(numerator, denominator) {
  return denominator > 0 ? round(numerator / denominator) : 0;
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

async function readGitHead(rootPath) {
  try {
    const head = (await readFile(path.join(rootPath, '.git', 'HEAD'), 'utf8')).trim();
    if (!head.startsWith('ref: ')) return head || null;
    const refPath = head.slice(5);
    try {
      return (await readFile(path.join(rootPath, '.git', refPath), 'utf8')).trim() || null;
    } catch {
      const packedRefs = await readFile(path.join(rootPath, '.git', 'packed-refs'), 'utf8');
      const match = packedRefs.split(/\r?\n/).find((line) => line.endsWith(` ${refPath}`));
      return match?.split(' ')[0] ?? null;
    }
  } catch {
    return null;
  }
}
