const TRAIN_END = '2023-12-31';
const VALIDATION_END = '2025-12-31';

export function buildAsOfTrainingRows(races, options = {}) {
  const orderedRaces = [...(races ?? [])]
    .filter((race) => race?.status !== 'upcoming')
    .filter((race) => Array.isArray(race.runners) && race.runners.length > 0)
    .sort(compareRaces);
  const placeCutoffForRace = options.placeCutoffForRace ?? defaultPlaceCutoff;
  const state = createAsOfState();
  const rows = [];
  const marketFeaturesForRunner = options.marketFeaturesForRunner ?? (() => ({}));
  const externalFeaturesForRunner = options.externalFeaturesForRunner ?? (() => ({}));

  for (const race of orderedRaces) {
    const fieldSize = race.runners.length;
    const placeCutoff = placeCutoffForRace(race);

    for (const runner of race.runners) {
      const horseId = stableId(runner.horseId ?? runner.horseName ?? runner.horseNo);
      const jockeyId = stableId(runner.jockey);
      const trainerId = stableId(runner.trainer);
      const horseStats = state.horses.get(horseId) ?? emptyStats();
      const jockeyStats = state.jockeys.get(jockeyId) ?? emptyStats();
      const trainerStats = state.trainers.get(trainerId) ?? emptyStats();
      const distanceSurfaceStats = state.distanceSurface.get(distanceSurfaceKey(horseId, race)) ?? emptyStats();

      const marketFeatures = marketFeaturesForRunner({ race, runner }) ?? {};
      const externalFeatures = externalFeaturesForRunner({ race, runner }) ?? {};

      rows.push({
        raceId: race.raceId,
        date: race.date,
        racecourse: race.racecourse,
        raceNo: race.raceNo,
        horseId,
        horseNo: runner.horseNo ?? null,
        horseName: runner.horseName ?? null,
        targetWin: runner.placing === 1 ? 1 : 0,
        targetPlace: Number.isFinite(runner.placing) && runner.placing <= placeCutoff ? 1 : 0,
        fieldSize,
        split: splitForDate(race.date),
        features: {
          racecourse: race.racecourse ?? null,
          distance: numericOrNull(race.distance),
          surface: race.surface ?? null,
          going: race.going ?? null,
          raceClass: numericOrNull(race.raceClass),
          fieldSize,
          draw: numericOrNull(runner.draw),
          actualWeight: numericOrNull(runner.actualWeight),
          horseRunsBefore: horseStats.runs,
          horseWinsBefore: horseStats.wins,
          horsePlacesBefore: horseStats.places,
          horseWinRateBefore: rate(horseStats.wins, horseStats.runs),
          horsePlaceRateBefore: rate(horseStats.places, horseStats.runs),
          horseAverageLbwBefore: horseStats.runs > 0 ? round(horseStats.totalLbw / horseStats.runs, 4) : null,
          daysSinceLastRun: horseStats.lastDate ? daysBetween(horseStats.lastDate, race.date) : null,
          jockeyRunsBefore: jockeyStats.runs,
          jockeyWinsBefore: jockeyStats.wins,
          jockeyPlacesBefore: jockeyStats.places,
          jockeyWinRateBefore: rate(jockeyStats.wins, jockeyStats.runs),
          jockeyPlaceRateBefore: rate(jockeyStats.places, jockeyStats.runs),
          trainerRunsBefore: trainerStats.runs,
          trainerWinsBefore: trainerStats.wins,
          trainerPlacesBefore: trainerStats.places,
          trainerWinRateBefore: rate(trainerStats.wins, trainerStats.runs),
          trainerPlaceRateBefore: rate(trainerStats.places, trainerStats.runs),
          distanceSurfaceStartsBefore: distanceSurfaceStats.runs,
          distanceSurfaceWinRateBefore: rate(distanceSurfaceStats.wins, distanceSurfaceStats.runs),
          distanceSurfacePlaceRateBefore: rate(distanceSurfaceStats.places, distanceSurfaceStats.runs),
          ...marketFeatures,
          ...externalFeatures,
        },
      });
    }

    updateStateWithRace(state, race, placeCutoff);
  }

  return rows;
}

export function splitTrainingRows(rows) {
  return (rows ?? []).map((row) => ({
    ...row,
    split: splitForDate(row.date),
  }));
}

export function summarizeTrainingRows(rows) {
  const items = rows ?? [];
  return {
    rows: items.length,
    races: new Set(items.map((row) => row.raceId)).size,
    trainRows: items.filter((row) => row.split === 'train').length,
    validationRows: items.filter((row) => row.split === 'validation').length,
    holdoutRows: items.filter((row) => row.split === 'holdout').length,
    generatedAt: new Date().toISOString(),
  };
}

function updateStateWithRace(state, race, placeCutoff) {
  for (const runner of race.runners) {
    const horseId = stableId(runner.horseId ?? runner.horseName ?? runner.horseNo);
    const jockeyId = stableId(runner.jockey);
    const trainerId = stableId(runner.trainer);
    const win = runner.placing === 1 ? 1 : 0;
    const place = Number.isFinite(runner.placing) && runner.placing <= placeCutoff ? 1 : 0;
    updateStats(state.horses, horseId, race.date, runner, win, place);
    updateStats(state.jockeys, jockeyId, race.date, runner, win, place);
    updateStats(state.trainers, trainerId, race.date, runner, win, place);
    updateStats(state.distanceSurface, distanceSurfaceKey(horseId, race), race.date, runner, win, place);
  }
}

function updateStats(map, key, date, runner, win, place) {
  if (!key) return;
  const current = map.get(key) ?? emptyStats();
  map.set(key, {
    runs: current.runs + 1,
    wins: current.wins + win,
    places: current.places + place,
    totalLbw: current.totalLbw + Number(runner.lbw ?? 0),
    lastDate: date,
  });
}

function createAsOfState() {
  return {
    horses: new Map(),
    jockeys: new Map(),
    trainers: new Map(),
    distanceSurface: new Map(),
  };
}

function emptyStats() {
  return {
    runs: 0,
    wins: 0,
    places: 0,
    totalLbw: 0,
    lastDate: null,
  };
}

function defaultPlaceCutoff(race) {
  const fieldSize = race.runners?.length ?? 0;
  return fieldSize > 0 && fieldSize <= 6 ? 2 : 3;
}

export function splitForDate(date) {
  if (date <= TRAIN_END) return 'train';
  if (date <= VALIDATION_END) return 'validation';
  return 'holdout';
}

function compareRaces(a, b) {
  return String(a.date).localeCompare(String(b.date))
    || String(a.racecourse).localeCompare(String(b.racecourse))
    || Number(a.raceNo ?? 0) - Number(b.raceNo ?? 0);
}

function distanceSurfaceKey(horseId, race) {
  return [horseId, race.racecourse, race.distance, race.surface]
    .map((value) => value ?? '')
    .join('|');
}

function stableId(value) {
  if (value == null || value === '') return '';
  return String(value);
}

function numericOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rate(numerator, denominator) {
  return denominator > 0 ? round(numerator / denominator, 4) : 0;
}

function daysBetween(from, to) {
  const ms = Date.parse(to) - Date.parse(from);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round(ms / 86400000));
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(Number(value ?? 0) * factor) / factor;
}
