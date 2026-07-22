import { publicProspectiveCoverageProjection } from './prospective-coverage.js';

const DEFAULT_EMBEDDED_PERFORMANCE_MEETING_LIMIT = 40;

const PUBLIC_FORECAST_FIELDS = [
  'date',
  'distance',
  'going',
  'predictions',
  'raceClass',
  'raceId',
  'raceNo',
  'racecourse',
  'startTime',
  'status',
  'surface',
  'topPick',
  'trainingRacesBefore',
];

const PUBLIC_SETTLEMENT_FIELDS = [
  'date',
  'raceId',
  'raceNo',
  'racecourse',
  'resultLabel',
  'topPickHit',
  'topPickHorseName',
  'topPickPlacing',
  'winnerHorseId',
  'winnerHorseName',
];

const PUBLIC_ASSUMPTION_FIELDS = [
  'betType',
  'settlement',
  'minProbability',
  'minEdge',
  'finalEdgeBuffer',
  'allowProbabilityOnly',
  'responsibleUse',
];

const PUBLIC_DATA_SOURCE_FIELDS = [
  'settledRaces',
  'upcomingRaces',
  'lastSyncAt',
];

export function splitDashboardForPublishing(snapshot, options = {}) {
  const ledger = Array.isArray(snapshot?.ledger) ? snapshot.ledger : [];
  const fullPerformance = snapshot?.performance;
  const performanceMeetings = Array.isArray(fullPerformance?.byMeeting)
    ? fullPerformance.byMeeting
    : [];
  const totalLedgerEntries = Math.max(
    ledger.length,
    normalizeCount(snapshot?.history?.totalLedgerEntries),
  );
  const totalPerformanceMeetings = Math.max(
    performanceMeetings.length,
    normalizeCount(snapshot?.history?.totalPerformanceMeetings),
  );
  const embeddedPerformanceMeetingLimit = normalizeLimit(
    options.embeddedPerformanceMeetingLimit,
    DEFAULT_EMBEDDED_PERFORMANCE_MEETING_LIMIT,
  );
  const embeddedPerformanceMeetings = embeddedPerformanceMeetingLimit > 0
    ? performanceMeetings.slice(0, embeddedPerformanceMeetingLimit)
    : [];

  const history = {
    totalLedgerEntries,
    embeddedLedgerEntries: 0,
    isLedgerTruncated: totalLedgerEntries > 0,
    rowLevelHistoryPublished: false,
    totalPerformanceMeetings,
    embeddedPerformanceMeetings: embeddedPerformanceMeetings.length,
    isPerformanceTruncated: embeddedPerformanceMeetings.length < totalPerformanceMeetings,
    note: 'Public dashboard excludes row-level betting history, personal recommendations, stakes, tickets, and audit records.',
  };

  const publicSnapshot = {
    generatedAt: snapshot?.generatedAt ?? null,
    scope: snapshot?.scope ?? null,
    summary: cloneJson(snapshot?.summary),
    dataSource: {
      source: 'sanitized-public',
      ...pickFields(snapshot?.dataSource, PUBLIC_DATA_SOURCE_FIELDS),
    },
    assumptions: pickFields(snapshot?.assumptions, PUBLIC_ASSUMPTION_FIELDS),
    fixtureWindow: cloneJson(snapshot?.fixtureWindow),
    nextLocalMeetings: cloneJson(snapshot?.nextLocalMeetings ?? []),
    performance: trimPerformance(fullPerformance, embeddedPerformanceMeetings),
    research: cloneJson(snapshot?.research),
    ledger: [],
    history,
    recentEntries: sanitizeEntries(snapshot?.recentEntries),
    upcomingEntries: sanitizeEntries(snapshot?.upcomingEntries),
    latestForecast: sanitizeForecast(snapshot?.latestForecast),
    latestUpcomingForecast: sanitizeForecast(snapshot?.latestUpcomingForecast),
    latestSettlement: sanitizeSettlement(snapshot?.latestSettlement),
    prospectiveCoverage: publicProspectiveCoverageProjection(snapshot?.prospectiveCoverage),
    publication: {
      visibility: 'PUBLIC_FUNCTIONAL_SANITIZED',
      policyVersion: 'public-dashboard-v2',
      executableRecommendationsPublished: true,
      personalDataPublished: false,
      rowLevelHistoryPublished: false,
    },
  };

  const historySnapshot = {
    ...cloneJson(snapshot),
    publication: {
      visibility: 'PRIVATE_LOCAL',
      policyVersion: 'private-dashboard-history-v1',
    },
  };

  return {
    publicSnapshot,
    historySnapshot,
  };
}

function sanitizeEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.map((entry) => ({
    date: entry?.date ?? entry?.forecast?.date ?? null,
    raceId: entry?.raceId ?? entry?.forecast?.raceId ?? null,
    raceNo: entry?.raceNo ?? entry?.forecast?.raceNo ?? null,
    racecourse: entry?.racecourse ?? entry?.forecast?.racecourse ?? null,
    forecast: sanitizeForecast(entry?.forecast),
    settlement: sanitizeSettlement(entry?.settlement),
  }));
}

function sanitizeForecast(forecast) {
  if (!forecast || typeof forecast !== 'object') return null;
  return pickFields(forecast, PUBLIC_FORECAST_FIELDS);
}

function sanitizeSettlement(settlement) {
  if (!settlement || typeof settlement !== 'object') return null;
  return pickFields(settlement, PUBLIC_SETTLEMENT_FIELDS);
}

function pickFields(source, fields) {
  if (!source || typeof source !== 'object') return {};
  return Object.fromEntries(fields
    .filter((field) => source[field] !== undefined)
    .map((field) => [field, cloneJson(source[field])]));
}

function trimPerformance(performance, embeddedPerformanceMeetings) {
  if (!performance || typeof performance !== 'object') return null;
  const cloned = cloneJson(performance);
  if (!Array.isArray(performance.byMeeting)) return cloned;
  return {
    ...cloned,
    byMeeting: cloneJson(embeddedPerformanceMeetings),
  };
}

function normalizeLimit(value, fallback) {
  if (value == null) return fallback;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(0, Math.floor(numberValue));
}

function normalizeCount(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.max(0, Math.floor(numberValue));
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}
