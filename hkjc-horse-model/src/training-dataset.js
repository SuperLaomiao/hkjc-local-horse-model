const TRAIN_END = '2023-12-31';
const VALIDATION_END = '2025-12-31';

const MATRIX_METADATA_COLUMNS = [
  'raceId',
  'date',
  'split',
  'horseId',
  'horseNo',
  'racecourse',
  'raceNo',
  'fieldSize',
  'targetWin',
  'targetPlace',
];

const SUPPORTED_MATRIX_FORMATS = new Set(['jsonl', 'csv']);
const LEAKAGE_FEATURE_KEYS = new Set([
  'target',
  'targetwin',
  'targetplace',
  'placing',
  'place',
  'position',
  'rank',
  'finish',
  'finishposition',
  'finishingposition',
  'finishorder',
  'result',
  'raceresult',
  'resultstatus',
  'winresult',
  'placeresult',
  'winner',
  'dividend',
  'dividends',
  'windividend',
  'placedividend',
  'qindividend',
  'qpldividend',
  'payout',
  'payouts',
  'winpayout',
  'placepayout',
  'refund',
  'settlement',
  'postrace',
  'postraceplacing',
  'postraceresult',
  'postracepayout',
]);
const UNSAFE_FEATURE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

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

export function buildTrainingMatrix(payload) {
  if (!isPlainObject(payload) || !Array.isArray(payload.rows)) {
    throw new Error('Training dataset payload must contain a rows array');
  }

  const featureColumns = new Set();
  const validatedRows = payload.rows.map((row, index) => validateMatrixRow(row, index, featureColumns));
  const columns = [...MATRIX_METADATA_COLUMNS, ...[...featureColumns].sort((a, b) => a.localeCompare(b))];

  return {
    columns,
    rows: validatedRows.map((row) => {
      const matrixRow = {};
      for (const column of MATRIX_METADATA_COLUMNS) matrixRow[column] = row[column];
      for (const featureName of columns.slice(MATRIX_METADATA_COLUMNS.length)) {
        matrixRow[featureName] = Object.hasOwn(row.features, featureName) ? row.features[featureName] : null;
      }
      return matrixRow;
    }),
  };
}

export function serializeTrainingMatrix(matrix, format) {
  if (!SUPPORTED_MATRIX_FORMATS.has(format)) {
    throw new Error(`Unsupported training matrix format: ${format}`);
  }
  validateMatrix(matrix);

  if (format === 'jsonl') {
    return matrix.rows.map((row) => JSON.stringify(row)).join('\n') + (matrix.rows.length > 0 ? '\n' : '');
  }

  return [
    matrix.columns.map(escapeCsvValue).join(','),
    ...matrix.rows.map((row) => matrix.columns.map((column) => escapeCsvValue(row[column])).join(',')),
    '',
  ].join('\n');
}

export function trainingMatrixFormatFor({ format, output } = {}) {
  if (format != null) {
    if (!SUPPORTED_MATRIX_FORMATS.has(format)) {
      throw new Error(`Unsupported training matrix format: ${format}`);
    }
    return format;
  }

  const extension = String(output ?? '').match(/\.([^.]+)$/)?.[1]?.toLowerCase();
  if (!extension) return 'jsonl';
  if (SUPPORTED_MATRIX_FORMATS.has(extension)) return extension;
  throw new Error(`Unsupported training matrix format: ${extension}`);
}

function validateMatrixRow(row, index, featureColumns) {
  if (!isPlainObject(row)) throw new Error(`Training matrix row ${index} must be an object`);
  if (!isPlainObject(row.features)) throw new Error(`Training matrix row ${index} features must be an object`);

  requireNonEmptyString(row.raceId, `Training matrix row ${index} raceId`);
  requireNonEmptyString(row.date, `Training matrix row ${index} date`);
  if (!['train', 'validation', 'holdout'].includes(row.split)) {
    throw new Error(`Training matrix row ${index} split must be train, validation, or holdout`);
  }
  requireNonEmptyString(row.horseId, `Training matrix row ${index} horseId`);
  requireNullableScalar(row.horseNo, `Training matrix row ${index} horseNo`);
  requireNullableString(row.racecourse, `Training matrix row ${index} racecourse`);
  requireNullableFiniteNumber(row.raceNo, `Training matrix row ${index} raceNo`);
  requireNullableFiniteNumber(row.fieldSize, `Training matrix row ${index} fieldSize`);
  requireBinaryLabel(row.targetWin, `Training matrix row ${index} targetWin`);
  requireBinaryLabel(row.targetPlace, `Training matrix row ${index} targetPlace`);

  for (const [featureName, value] of Object.entries(row.features)) {
    if (!featureName || UNSAFE_FEATURE_KEYS.has(featureName)) {
      throw new Error(`Training matrix row ${index} has an unsafe feature key`);
    }
    if (LEAKAGE_FEATURE_KEYS.has(featureName.toLowerCase())) {
      throw new Error(`Training matrix row ${index} feature ${featureName} is explicit post-race leakage`);
    }
    requireNullableScalar(value, `Training matrix row ${index} feature ${featureName}`);
    featureColumns.add(featureName);
  }

  return row;
}

function validateMatrix(matrix) {
  if (!isPlainObject(matrix) || !Array.isArray(matrix.columns) || !Array.isArray(matrix.rows)) {
    throw new Error('Training matrix must contain columns and rows arrays');
  }
  if (matrix.columns.some((column) => typeof column !== 'string' || !column)) {
    throw new Error('Training matrix columns must be non-empty strings');
  }
  for (const [index, row] of matrix.rows.entries()) {
    if (!isPlainObject(row)) throw new Error(`Training matrix row ${index} must be an object`);
    for (const column of matrix.columns) {
      requireNullableScalar(row[column], `Training matrix row ${index} column ${column}`);
    }
  }
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value) throw new Error(`${label} must be a non-empty string`);
}

function requireNullableString(value, label) {
  if (value !== null && typeof value !== 'string') throw new Error(`${label} must be a string or null`);
}

function requireNullableFiniteNumber(value, label) {
  if (value !== null && (!Number.isFinite(value) || typeof value !== 'number')) {
    throw new Error(`${label} must be a finite number or null`);
  }
}

function requireBinaryLabel(value, label) {
  if (value !== 0 && value !== 1) throw new Error(`${label} must be 0 or 1`);
}

function requireNullableScalar(value, label) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  throw new Error(`${label} must be a scalar or null`);
}

function isPlainObject(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function escapeCsvValue(value) {
  if (value == null) return '';
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
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
