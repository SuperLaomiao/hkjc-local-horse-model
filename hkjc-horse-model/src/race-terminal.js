// Public-safe evidence for an official race-level abandonment, never a betting ledger.
export const ABANDONED_EVIDENCE_VERSION = 'hkjc-abandoned-refund-v1';

export function projectAbandonedRace(race) {
  const evidence = race?.terminalEvidence;
  if (race?.status !== 'abandoned' || evidence?.version !== ABANDONED_EVIDENCE_VERSION
    || evidence.status !== 'ABANDONED' || evidence.refund !== true
    || evidence.identityMethod !== 'displayed-meeting-and-selected-race'
    || !/^[a-f0-9]{64}$/.test(String(evidence.sha256 ?? ''))
    || typeof evidence.observedAt !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(evidence.observedAt)
    || !Number.isFinite(Date.parse(evidence.observedAt))) {
    throw new Error('Invalid official abandoned race evidence');
  }
  const identity = officialResultIdentity(evidence.url);
  if (!identity || !validRaceDate(race.date) || !['ST', 'HV'].includes(race.racecourse)
    || !Number.isInteger(race.raceNo) || race.raceNo < 1 || race.raceNo > 15
    || race.raceId !== `${race.date}-${race.racecourse}-${race.raceNo}`
    || ['date', 'racecourse', 'raceNo'].some((key) => (
      identity[key] !== race[key] || evidence[key] !== race[key]
    ))) {
    throw new Error('Abandoned race evidence identity mismatch');
  }
  return {
    raceId: race.raceId, date: race.date, racecourse: race.racecourse, raceNo: race.raceNo,
    status: 'abandoned',
    terminalEvidence: {
      version: ABANDONED_EVIDENCE_VERSION, status: 'ABANDONED', refund: true,
      date: race.date, racecourse: race.racecourse, raceNo: race.raceNo,
      identityMethod: evidence.identityMethod,
      url: evidence.url, sha256: evidence.sha256,
      observedAt: new Date(evidence.observedAt).toISOString(),
    },
  };
}

export function officialResultIdentity(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'racing.hkjc.com' || url.port
      || url.username || url.password || url.hash || url.pathname !== '/en-us/local/information/localresults') return null;
    const params = new Map();
    for (const [key, item] of url.searchParams) {
      const lower = key.toLowerCase();
      if (params.has(lower) || !['racedate', 'racecourse', 'raceno'].includes(lower)) return null;
      params.set(lower, item);
    }
    const date = String(params.get('racedate') ?? '').replaceAll('/', '-');
    const racecourse = params.get('racecourse');
    const raceNo = Number(params.get('raceno'));
    return validRaceDate(date) && ['ST', 'HV'].includes(racecourse)
      && Number.isInteger(raceNo) && raceNo >= 1 && raceNo <= 15 ? { date, racecourse, raceNo } : null;
  } catch {
    return null;
  }
}

function validRaceDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')) && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}
