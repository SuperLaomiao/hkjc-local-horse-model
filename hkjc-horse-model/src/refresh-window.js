import { projectAbandonedRace } from './race-terminal.js';

export function resolveRefreshStartDate({
  today,
  from,
  historyDays = 14,
  resumeFromLatest = false,
  availableRaceDates = [],
}) {
  if (validDate(from)) return from;
  if (enabled(resumeFromLatest)) {
    const latest = availableRaceDates.filter(validDate).sort().at(-1);
    if (latest) return latest;
  }
  return addDays(today, -Number(historyDays ?? 14));
}

function enabled(value) {
  return value === true || String(value).toLowerCase() === 'true' || String(value) === '1';
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''));
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + Number(days));
  return value.toISOString().slice(0, 10);
}

export function mergeOfficialMeetingRecords(existing, fetched) {
  const races = new Map();
  for (const race of [...existing, ...fetched]) {
    if (race.status === 'abandoned') projectAbandonedRace(race);
    const key = race.raceId ?? `${race.date}-${race.racecourse}-${race.raceNo}`;
    const previous = races.get(key);
    if (previous && (previous.status === 'abandoned') !== (race.status === 'abandoned')) {
      throw new Error(`Official terminal race status conflict: ${race.raceId}`);
    }
    races.set(key, race);
  }
  return [...races.values()].sort((a, b) => a.date.localeCompare(b.date) || a.racecourse.localeCompare(b.racecourse) || a.raceNo - b.raceNo);
}
