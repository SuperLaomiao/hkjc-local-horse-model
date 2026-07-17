const DAY_MS = 86400000;

export function normalizeTianxiHorseCode(value) {
  const text = String(value ?? '').trim().toUpperCase();
  if (/^[A-Z]\d{3}$/.test(text)) return text;
  return text.match(/(?:^|_)([A-Z]\d{3})$/)?.[1] ?? null;
}

export function buildTianxiFormFeatures({
  horseCode,
  targetDate,
  targetDistance = null,
  rows = [],
  availabilityLagDays = 1,
} = {}) {
  const normalizedHorseCode = normalizeTianxiHorseCode(horseCode);
  const targetDateMs = parseIsoDate(targetDate);
  const audit = {
    inputRows: rows.length,
    eligibleRows: 0,
    excludedNotAvailableRows: 0,
    invalidDateRows: 0,
    horseMismatchRows: 0,
  };
  const eligible = [];

  for (const row of rows) {
    const rowHorseCode = normalizeTianxiHorseCode(row.horse_no ?? row.horseCode ?? normalizedHorseCode);
    if (normalizedHorseCode && rowHorseCode && rowHorseCode !== normalizedHorseCode) {
      audit.horseMismatchRows += 1;
      continue;
    }
    const sourceDateMs = parseTianxiDate(row.date);
    if (!Number.isFinite(sourceDateMs) || !Number.isFinite(targetDateMs)) {
      audit.invalidDateRows += 1;
      continue;
    }
    const availableAtMs = sourceDateMs + Number(availabilityLagDays ?? 1) * DAY_MS;
    if (availableAtMs > targetDateMs) {
      audit.excludedNotAvailableRows += 1;
      continue;
    }
    eligible.push(normalizeFormRow(row, sourceDateMs));
  }

  eligible.sort((a, b) => b.sourceDateMs - a.sourceDateMs);
  audit.eligibleRows = eligible.length;

  return {
    features: aggregateFeatures({ eligible, targetDateMs, targetDistance }),
    audit,
  };
}

function aggregateFeatures({ eligible, targetDateMs, targetDistance }) {
  if (eligible.length === 0) return emptyTianxiFormFeatures();

  const wins = eligible.filter((row) => row.place === 1).length;
  const places = eligible.filter((row) => Number.isFinite(row.place) && row.place <= 3).length;
  const recent3 = eligible.slice(0, 3);
  const recent5 = eligible.slice(0, 5);
  const ratingRows = recent3.filter((row) => Number.isFinite(row.rating));
  const sameDistance = eligible.filter((row) => (
    Number.isFinite(row.distance) && Number(row.distance) === Number(targetDistance)
  ));

  return {
    tianxiFormAvailable: 1,
    tianxiPriorStarts: eligible.length,
    tianxiPriorWins: wins,
    tianxiPriorPlaces: places,
    tianxiPriorWinRate: rate(wins, eligible.length),
    tianxiPriorPlaceRate: rate(places, eligible.length),
    tianxiDaysSinceLastRun: Math.max(0, Math.round((targetDateMs - eligible[0].sourceDateMs) / DAY_MS)),
    tianxiLatestRating: firstFinite(eligible.map((row) => row.rating)),
    tianxiRatingTrend3: ratingRows.length >= 2
      ? round(ratingRows[0].rating - ratingRows.at(-1).rating)
      : null,
    tianxiRecentAverageLbw3: average(recent3.map((row) => row.lbw)),
    tianxiRecentAverageWinOdds5: average(recent5.map((row) => row.winOdds)),
    tianxiSameDistanceStarts: sameDistance.length,
    tianxiSameDistanceWinRate: rate(
      sameDistance.filter((row) => row.place === 1).length,
      sameDistance.length,
    ),
  };
}

export function emptyTianxiFormFeatures() {
  return {
    tianxiFormAvailable: 0,
    tianxiPriorStarts: 0,
    tianxiPriorWins: 0,
    tianxiPriorPlaces: 0,
    tianxiPriorWinRate: 0,
    tianxiPriorPlaceRate: 0,
    tianxiDaysSinceLastRun: null,
    tianxiLatestRating: null,
    tianxiRatingTrend3: null,
    tianxiRecentAverageLbw3: null,
    tianxiRecentAverageWinOdds5: null,
    tianxiSameDistanceStarts: 0,
    tianxiSameDistanceWinRate: 0,
  };
}

function normalizeFormRow(row, sourceDateMs) {
  return {
    sourceDateMs,
    place: integerOrNull(row.place),
    rating: numericOrNull(row.rating),
    distance: numericOrNull(row.distance_m ?? row.distance),
    winOdds: numericOrNull(row.win_odds ?? row.winOdds),
    lbw: beatenMargin(row.lbw),
  };
}

function parseTianxiDate(value) {
  const text = String(value ?? '').trim();
  const iso = parseIsoDate(text);
  if (Number.isFinite(iso)) return iso;
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return Number.NaN;
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  return Date.UTC(year, Number(match[2]) - 1, Number(match[1]));
}

function parseIsoDate(value) {
  const text = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return Number.NaN;
  const parsed = Date.parse(`${text}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function beatenMargin(value) {
  const text = String(value ?? '').trim().toUpperCase();
  if (!text || text === '-') return 0;
  const mixed = text.match(/^(\d+)-(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = text.match(/^(\d+)\/(\d+)$/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function integerOrNull(value) {
  const number = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(number) ? number : null;
}

function numericOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstFinite(values) {
  return values.find((value) => Number.isFinite(value)) ?? null;
}

function average(values) {
  const numbers = values.filter((value) => Number.isFinite(value));
  return numbers.length > 0 ? round(numbers.reduce((total, value) => total + value, 0) / numbers.length) : null;
}

function rate(numerator, denominator) {
  return denominator > 0 ? round(numerator / denominator) : 0;
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}
