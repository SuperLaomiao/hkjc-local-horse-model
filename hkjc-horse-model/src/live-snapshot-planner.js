import { loadRacesFromDatabase } from './sqlite-store.js';

export const DEFAULT_SNAPSHOT_WINDOWS = [
  { label: 'T-30', minMinutes: 21, maxMinutes: 45 },
  { label: 'T-10', minMinutes: 6, maxMinutes: 20 },
  { label: 'T-3', minMinutes: 0, maxMinutes: 5 },
];

export function loadDueSnapshotPlan({ dbPath, now = new Date(), windows = DEFAULT_SNAPSHOT_WINDOWS } = {}) {
  if (!dbPath) throw new Error('loadDueSnapshotPlan requires dbPath');
  const races = loadRacesFromDatabase({ dbPath, status: 'upcoming' });
  return buildDueSnapshotPlan({ races, now, windows });
}

export function buildDueSnapshotPlan({ races = [], now = new Date(), windows = DEFAULT_SNAPSHOT_WINDOWS } = {}) {
  const nowDate = new Date(now);
  if (!Number.isFinite(nowDate.getTime())) throw new Error('buildDueSnapshotPlan requires a valid now value');

  return races
    .filter(isCaptureEligible)
    .map((race) => dueSnapshot(race, nowDate, windows))
    .filter(Boolean)
    .sort((a, b) => a.postTime.localeCompare(b.postTime) || a.raceNo - b.raceNo);
}

function dueSnapshot(race, now, windows) {
  const postTime = racePostTime(race);
  if (!postTime) return null;
  const minutesToPost = Math.round((new Date(postTime).getTime() - now.getTime()) / 60000);
  const window = windows.find((candidate) => (
    minutesToPost >= candidate.minMinutes && minutesToPost <= candidate.maxMinutes
  ));
  if (!window) return null;

  return {
    raceId: race.raceId,
    date: race.date,
    racecourse: race.racecourse,
    raceNo: race.raceNo,
    postTime,
    minutesToPost,
    window: window.label,
  };
}

function isCaptureEligible(race) {
  return String(race?.status ?? '').toLowerCase() === 'upcoming';
}

function racePostTime(race) {
  if (!race?.date || !race?.startTime) return null;
  if (/^\d{2}:\d{2}(?::\d{2})?$/.test(race.startTime)) {
    const time = race.startTime.length === 5 ? `${race.startTime}:00` : race.startTime;
    return `${race.date}T${time}+08:00`;
  }
  const parsed = new Date(race.startTime);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
