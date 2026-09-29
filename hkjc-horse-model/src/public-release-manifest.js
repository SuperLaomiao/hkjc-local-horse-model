import { createHash } from 'node:crypto';

export const PUBLIC_RELEASE_MANIFEST_VERSION = 'public-release-manifest-v1';

export function buildPublicReleaseManifest({ dashboard, dashboardText }) {
  const text = String(dashboardText ?? `${JSON.stringify(dashboard, null, 2)}\n`);
  const upcomingEntries = Array.isArray(dashboard?.upcomingEntries) ? dashboard.upcomingEntries : [];
  const meetings = new Map();
  let upcomingRunners = 0;
  for (const entry of upcomingEntries) {
    const date = validDate(entry?.date ?? entry?.forecast?.date);
    const racecourse = String(entry?.racecourse ?? entry?.forecast?.racecourse ?? '').toUpperCase();
    if (!date || !racecourse) continue;
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
  const settledThrough = validDate(dashboard?.latestSettlement?.date)
    ?? latestDate((dashboard?.recentEntries ?? []).map((entry) => entry?.settlement?.date ?? entry?.date));
  const upcomingFrom = upcomingMeetings[0]?.date
    ?? validDate(dashboard?.latestUpcomingForecast?.date)
    ?? null;

  return {
    version: PUBLIC_RELEASE_MANIFEST_VERSION,
    generatedAt: validTimestamp(dashboard?.generatedAt),
    dashboardSha256: createHash('sha256').update(text).digest('hex'),
    scope: dashboard?.scope ?? null,
    publicationPolicyVersion: dashboard?.publication?.policyVersion ?? null,
    data: {
      settledRaces: count(dashboard?.dataSource?.settledRaces ?? dashboard?.summary?.racesSettled),
      settledThrough,
      upcomingRaces: count(dashboard?.dataSource?.upcomingRaces ?? upcomingEntries.length),
      upcomingFrom,
      upcomingRunners,
      upcomingMeetings,
    },
  };
}

export function validatePublicReleaseTransition({ previous, candidate, asOfDate }) {
  if (!previous || previous.version !== PUBLIC_RELEASE_MANIFEST_VERSION) return [];
  const issues = [];
  if (candidate.data.settledRaces < previous.data.settledRaces) {
    issues.push(issue('SETTLED_COUNT_REGRESSION', `${previous.data.settledRaces} -> ${candidate.data.settledRaces}`));
  }
  if (previous.data.settledThrough && (!candidate.data.settledThrough
    || candidate.data.settledThrough < previous.data.settledThrough)) {
    issues.push(issue('SETTLED_DATE_REGRESSION', `${previous.data.settledThrough} -> ${candidate.data.settledThrough ?? 'missing'}`));
  }
  const today = validDate(asOfDate) ?? new Date().toISOString().slice(0, 10);
  if (previous.data.upcomingFrom && previous.data.upcomingFrom >= today && !candidate.data.upcomingFrom) {
    issues.push(issue('FUTURE_MEETING_DISAPPEARED', `${previous.data.upcomingFrom} is still current or future`));
  }
  if (previous.data.upcomingFrom && candidate.data.upcomingFrom === previous.data.upcomingFrom
    && candidate.data.upcomingRaces < previous.data.upcomingRaces) {
    issues.push(issue('FUTURE_RACE_COUNT_REGRESSION', `${previous.data.upcomingRaces} -> ${candidate.data.upcomingRaces}`));
  }
  return issues;
}

export function verifyPublicReleaseFiles({ dashboardText, manifest }) {
  const issues = [];
  if (manifest?.version !== PUBLIC_RELEASE_MANIFEST_VERSION) {
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
  return issues;
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
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
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
