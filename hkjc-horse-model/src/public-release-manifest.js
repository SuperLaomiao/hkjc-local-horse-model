import { createHash } from 'node:crypto';
import { projectAbandonedRace } from './race-terminal.js';

export const PUBLIC_RELEASE_MANIFEST_VERSION = 'public-release-manifest-v3';
const IDENTITY_MANIFEST_VERSION = 'public-release-manifest-v2';
const LEGACY_MANIFEST_VERSION = 'public-release-manifest-v1';
const LEGACY_DATA_FIELDS = [
  'settledRaces', 'settledThrough', 'upcomingRaces', 'upcomingFrom',
  'upcomingRunners', 'upcomingMeetings',
];

export function buildPublicReleaseManifest({ dashboard, dashboardText }) {
  const text = String(dashboardText ?? `${JSON.stringify(dashboard, null, 2)}\n`);
  const upcomingEntries = Array.isArray(dashboard?.upcomingEntries) ? dashboard.upcomingEntries : [];
  const upcomingRaceIds = [];
  const meetings = new Map();
  let upcomingRunners = 0;
  for (const entry of upcomingEntries) {
    const raceId = entryRaceId(entry);
    if (!raceId || entry?.settlement || entry?.status === 'abandoned' || upcomingRaceIds.includes(raceId)) {
      throw new Error(`invalid or duplicate upcoming race identity: ${entry?.raceId ?? 'missing'}`);
    }
    upcomingRaceIds.push(raceId);
    const { date, racecourse } = parseRaceId(raceId);
    const runners = Array.isArray(entry?.forecast?.predictions) ? entry.forecast.predictions.length : 0;
    const key = `${date}|${racecourse}`;
    const meeting = meetings.get(key) ?? { date, racecourse, races: 0, runners: 0 };
    meeting.races += 1;
    meeting.runners += runners;
    upcomingRunners += runners;
    meetings.set(key, meeting);
  }
  const upcomingMeetings = [...meetings.values()].sort((left, right) => (
    left.date.localeCompare(right.date) || left.racecourse.localeCompare(right.racecourse)
  ));
  const upcomingRaces = count(dashboard?.dataSource?.upcomingRaces ?? upcomingEntries.length);
  if (upcomingRaces !== upcomingRaceIds.length) {
    throw new Error('upcoming race count does not match the published race identities');
  }
  // Evidence is limited to results already present in the public dashboard.
  // Never read the private ledger or expand the public history to make a release pass.
  const recentSettledRaceIds = [...new Set([
    ...(dashboard?.recentEntries ?? []).map((entry) => (
      entryRaceId(entry) === settledRaceId(entry?.settlement) ? settledRaceId(entry?.settlement) : null
    )),
    settledRaceId(dashboard?.latestSettlement),
  ].filter(Boolean))].sort();
  if (recentSettledRaceIds.some((raceId) => upcomingRaceIds.includes(raceId))) {
    throw new Error('settled race is still listed as upcoming');
  }
  const abandonedRaces = (dashboard?.terminalEntries ?? []).map(projectAbandonedRace);
  const generatedAt = validTimestamp(dashboard?.generatedAt);
  if (abandonedRaces.some((race) => !generatedAt || Date.parse(race.terminalEvidence.observedAt) > Date.parse(generatedAt))) {
    throw new Error('Abandoned race evidence was captured after dashboard generation');
  }
  const abandonedIds = abandonedRaces.map((race) => race.raceId);
  if (new Set(abandonedIds).size !== abandonedIds.length
    || abandonedIds.some((id) => upcomingRaceIds.includes(id) || recentSettledRaceIds.includes(id))) {
    throw new Error('Conflicting or duplicate abandoned race identities');
  }
  const settledThrough = validDate(dashboard?.latestSettlement?.date)
    ?? latestDate((dashboard?.recentEntries ?? []).map((entry) => entry?.settlement?.date ?? entry?.date));
  const upcomingFrom = upcomingMeetings[0]?.date
    ?? validDate(dashboard?.latestUpcomingForecast?.date)
    ?? null;

  return {
    version: PUBLIC_RELEASE_MANIFEST_VERSION,
    generatedAt,
    dashboardSha256: createHash('sha256').update(text).digest('hex'),
    scope: dashboard?.scope ?? null,
    publicationPolicyVersion: dashboard?.publication?.policyVersion ?? null,
    data: {
      settledRaces: count(dashboard?.dataSource?.settledRaces ?? dashboard?.summary?.racesSettled),
      settledThrough,
      upcomingRaces,
      upcomingFrom,
      upcomingRunners,
      upcomingMeetings,
      upcomingRaceIds: upcomingRaceIds.sort(),
      recentSettledRaceIds,
      abandonedRaces,
    },
  };
}

export function validatePublicReleaseTransition({ previous, candidate, asOfDate, previousDashboardText }) {
  if (!previous) return [];
  const issues = [];
  if (!supportedVersion(previous?.version) || candidate?.version !== PUBLIC_RELEASE_MANIFEST_VERSION
    || !validCoverageData(previous) || !validCoverageData(candidate)) {
    return [issue('INVALID_RELEASE_MANIFEST', 'Unsupported version or invalid release coverage')];
  }
  if (previous.version === LEGACY_MANIFEST_VERSION && previous.data.upcomingRaces > 0 && previousDashboardText == null) {
    return [issue('LEGACY_DASHBOARD_REQUIRED', 'The v1 release needs its hash-matched public dashboard to recover race identities')];
  }
  if (previousDashboardText != null) {
    const previousIssues = verifyPublicReleaseFiles({ dashboardText: previousDashboardText, manifest: previous });
    if (previousIssues.length) {
      return [issue('PREVIOUS_RELEASE_INVALID', previousIssues.map((item) => item.code).join(', '))];
    }
    try {
      const recovered = buildPublicReleaseManifest({
        dashboard: JSON.parse(previousDashboardText), dashboardText: previousDashboardText,
      });
      if (LEGACY_DATA_FIELDS.some((key) => JSON.stringify(recovered.data[key]) !== JSON.stringify(previous.data[key]))) {
        return [issue('PREVIOUS_RELEASE_INVALID', 'The previous counts and meetings disagree with its dashboard')];
      }
      previous = recovered;
    } catch (error) {
      return [issue('PREVIOUS_RELEASE_INVALID', error.message)];
    }
  }
  if (!validIdentityData(candidate) || (previous.version !== LEGACY_MANIFEST_VERSION && !validIdentityData(previous))) {
    return [issue('INVALID_RELEASE_MANIFEST', 'Invalid or missing race identity evidence')];
  }
  if (candidate.data.settledRaces < previous.data.settledRaces) {
    issues.push(issue('SETTLED_COUNT_REGRESSION', `${previous.data.settledRaces} -> ${candidate.data.settledRaces}`));
  }
  if (previous.data.settledThrough && (!candidate.data.settledThrough
    || candidate.data.settledThrough < previous.data.settledThrough)) {
    issues.push(issue('SETTLED_DATE_REGRESSION', `${previous.data.settledThrough} -> ${candidate.data.settledThrough ?? 'missing'}`));
  }
  if (Date.parse(candidate.generatedAt) < Date.parse(previous.generatedAt)) {
    issues.push(issue('GENERATED_AT_REGRESSION', `${previous.generatedAt} -> ${candidate.generatedAt}`));
  }
  const today = validDate(asOfDate) ?? new Date().toISOString().slice(0, 10);
  const upcomingIds = new Set(candidate.data.upcomingRaceIds);
  const settledIds = new Set(candidate.data.recentSettledRaceIds.filter((raceId) => (
    parseRaceId(raceId).date <= today && parseRaceId(raceId).date <= candidate.generatedAt.slice(0, 10)
      && parseRaceId(raceId).date <= candidate.data.settledThrough
  )));
  const abandonedIds = new Set(candidate.data.abandonedRaces.filter((race) => (
    Date.parse(race.terminalEvidence.observedAt) <= Date.parse(candidate.generatedAt)
  )).map((race) => race.raceId));
  for (const race of previous.data.abandonedRaces ?? []) {
    if (upcomingIds.has(race.raceId) || settledIds.has(race.raceId)) {
      issues.push(issue('TERMINAL_RACE_REOPENED', race.raceId));
    }
  }
  const removed = (previous.data.upcomingRaceIds ?? []).filter((raceId) => !upcomingIds.has(raceId));
  const missing = removed.filter((raceId) => !settledIds.has(raceId) && !abandonedIds.has(raceId));
  if (missing.length) {
    const code = !candidate.data.upcomingFrom ? 'FUTURE_MEETING_DISAPPEARED'
      : candidate.data.upcomingRaces < previous.data.upcomingRaces ? 'FUTURE_RACE_COUNT_REGRESSION'
        : 'UPCOMING_RACE_DISAPPEARED';
    issues.push(issue(code, `No matching official settlement or abandonment for ${missing.join(', ')}`));
  }
  const newlySettled = removed.filter((raceId) => settledIds.has(raceId)).length;
  if (newlySettled > 0 && newlySettled > candidate.data.settledRaces - previous.data.settledRaces) {
    issues.push(issue('SETTLEMENT_COUNT_MISMATCH', `${newlySettled} removed races exceed settled-count growth`));
  }
  return issues;
}

export function verifyPublicReleaseFiles({ dashboardText, manifest }) {
  const issues = [];
  if (!supportedVersion(manifest?.version)) {
    issues.push(issue('INVALID_RELEASE_MANIFEST', 'Unsupported or missing manifest version'));
    return issues;
  }
  const actualHash = createHash('sha256').update(String(dashboardText)).digest('hex');
  if (manifest.dashboardSha256 !== actualHash) {
    issues.push(issue('DASHBOARD_HASH_MISMATCH', `${manifest.dashboardSha256 ?? 'missing'} != ${actualHash}`));
  }
  if (!manifest.generatedAt || !Number.isFinite(Date.parse(manifest.generatedAt))) {
    issues.push(issue('INVALID_GENERATED_AT', String(manifest.generatedAt)));
  }
  if (manifest.version !== LEGACY_MANIFEST_VERSION) {
    try {
      const rebuilt = buildPublicReleaseManifest({ dashboard: JSON.parse(dashboardText), dashboardText });
      const expectedData = { ...rebuilt.data };
      if (manifest.version === IDENTITY_MANIFEST_VERSION) delete expectedData.abandonedRaces;
      if (!validIdentityData(manifest) || JSON.stringify(expectedData) !== JSON.stringify(manifest.data)
        || rebuilt.generatedAt !== manifest.generatedAt) {
        issues.push(issue('RELEASE_DATA_MISMATCH', 'Manifest race evidence does not match the public dashboard'));
      }
    } catch (error) {
      issues.push(issue('INVALID_RELEASE_DATA', error.message));
    }
  }
  return issues;
}

function supportedVersion(version) {
  return [PUBLIC_RELEASE_MANIFEST_VERSION, IDENTITY_MANIFEST_VERSION, LEGACY_MANIFEST_VERSION].includes(version);
}

function parseRaceId(value) {
  const match = /^(\d{4}-\d{2}-\d{2})-(ST|HV)-([1-9]\d*)$/.exec(String(value ?? ''));
  return match && validDate(match[1]) ? { date: match[1], racecourse: match[2], raceNo: Number(match[3]) } : null;
}

function matchesIdentity(value, raceId) {
  const identity = parseRaceId(raceId);
  return identity && value && ['date', 'racecourse', 'raceNo'].every((key) => (
    value[key] == null || String(value[key]) === String(identity[key])
  )) && (value.raceId == null || value.raceId === raceId);
}

function entryRaceId(entry) {
  const raceId = entry?.raceId ?? entry?.forecast?.raceId;
  return matchesIdentity(entry, raceId) && (!entry.forecast || matchesIdentity(entry.forecast, raceId))
    ? raceId : null;
}

function settledRaceId(settlement) {
  return matchesIdentity(settlement, settlement?.raceId)
    && ['PASS', 'WIN', 'MISS'].includes(settlement?.resultLabel)
    && typeof settlement?.winnerHorseId === 'string' && settlement.winnerHorseId.trim()
    ? settlement.raceId : null;
}

function validIdentityData(manifest) {
  const { upcomingRaceIds, recentSettledRaceIds, upcomingRaces, settledRaces } = manifest.data;
  const valid = [upcomingRaceIds, recentSettledRaceIds].every((ids) => (
    Array.isArray(ids) && ids.every((raceId) => parseRaceId(raceId)) && new Set(ids).size === ids.length
  )) && Number.isInteger(upcomingRaces) && upcomingRaces === upcomingRaceIds.length
    && Number.isInteger(settledRaces) && settledRaces >= recentSettledRaceIds.length
    && !recentSettledRaceIds.some((raceId) => upcomingRaceIds.includes(raceId));
  if (!valid) return false;
  if (manifest.version !== PUBLIC_RELEASE_MANIFEST_VERSION) return true;
  try {
    const abandoned = manifest.data.abandonedRaces.map(projectAbandonedRace);
    const ids = abandoned.map((race) => race.raceId);
    return new Set(ids).size === ids.length && ids.every((id) => !upcomingRaceIds.includes(id) && !recentSettledRaceIds.includes(id));
  } catch { return false; }
}

function validCoverageData(manifest) {
  const data = manifest?.data;
  return data && ['settledRaces', 'upcomingRaces'].every((key) => Number.isInteger(data[key]) && data[key] >= 0)
    && ['settledThrough', 'upcomingFrom'].every((key) => data[key] == null || validDate(data[key]))
    && Number.isFinite(Date.parse(manifest.generatedAt));
}

export async function verifyPublishedSite({ baseUrl, expectedManifest, fetchImpl = fetch, retries = 6, retryDelayMs = 5000 }) {
  const root = String(baseUrl).replace(/\/+$/, '');
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const cacheBust = `verify=${Date.now()}`;
      const [indexResponse, dashboardResponse, manifestResponse] = await Promise.all([
        fetchImpl(`${root}/?${cacheBust}`, { cache: 'no-store' }),
        fetchImpl(`${root}/data/dashboard.json?${cacheBust}`, { cache: 'no-store' }),
        fetchImpl(`${root}/data/publication-manifest.json?${cacheBust}`, { cache: 'no-store' }),
      ]);
      if (!indexResponse.ok || !dashboardResponse.ok || !manifestResponse.ok) {
        throw new Error(`HTTP ${indexResponse.status}/${dashboardResponse.status}/${manifestResponse.status}`);
      }
      const dashboardText = await dashboardResponse.text();
      const manifest = JSON.parse(await manifestResponse.text());
      const issues = verifyPublicReleaseFiles({ dashboardText, manifest });
      if (expectedManifest?.dashboardSha256 !== manifest.dashboardSha256) {
        issues.push(issue('DEPLOYED_HASH_MISMATCH', `${expectedManifest?.dashboardSha256 ?? 'missing'} != ${manifest.dashboardSha256 ?? 'missing'}`));
      }
      if (issues.length) throw new Error(issues.map((item) => item.code).join(', '));
      return { status: 'PASS', manifest };
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  throw new Error(`public site verification failed: ${lastError?.message ?? 'unknown error'}`);
}

function count(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function validDate(value) {
  const text = String(value ?? '');
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && Number.isFinite(Date.parse(text))
    && new Date(text).toISOString().slice(0, 10) === text ? text : null;
}

function latestDate(values) {
  return values.map(validDate).filter(Boolean).sort().at(-1) ?? null;
}

function validTimestamp(value) {
  return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function issue(code, detail) {
  return { code, detail };
}
