import { splitForDate } from './training-dataset.js';

const SPLITS = ['train', 'validation', 'holdout'];

export function buildModelLeaderboard(models, options = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const scoredModels = (models ?? []).map((model) => ({
    modelId: model.modelId,
    label: model.label,
    status: 'baseline',
    metrics: scoreProbabilityRows(model.rows),
  }));

  scoredModels.sort(compareModels);
  scoredModels.forEach((model, index) => {
    model.status = index === 0 ? 'candidate' : 'baseline';
  });

  return {
    generatedAt,
    selectionMetric: 'holdout.logLoss then validation.logLoss',
    models: scoredModels,
  };
}

export function attachProspectiveEvaluation(leaderboard, evaluation) {
  const base = leaderboard && typeof leaderboard === 'object' ? structuredClone(leaderboard) : {};
  const prospectiveModels = new Map((Array.isArray(evaluation?.models) ? evaluation.models : [])
    .map((model) => [model.modelId, model]));
  base.models = (Array.isArray(base.models) ? base.models : []).map((model) => ({
    ...model,
    prospective: prospectiveModels.has(model.modelId)
      ? structuredClone(prospectiveModels.get(model.modelId))
      : null,
  }));
  base.prospective = {
    policy: 'IDENTICAL_RACE_POOL_CELLS',
    commonCohortRaces: Number(evaluation?.cohort?.summary?.races ?? 0),
    exclusions: structuredClone(evaluation?.cohort?.exclusions ?? {}),
  };
  base.cashMode = 'NO_BET';
  return base;
}

export function scoreProbabilityRows(rows) {
  const items = (rows ?? []).filter((row) => Number.isFinite(Number(row.probability)));
  return {
    overall: summarizeRows(items),
    bySplit: Object.fromEntries(SPLITS.map((split) => [
      split,
      summarizeRows(items.filter((row) => row.split === split)),
    ])),
    calibration: buildCalibration(items),
  };
}

export function predictionRowsFromLedger(ledger) {
  return (ledger ?? []).flatMap((entry) => {
    const split = splitForDate(entry.date);
    const winnerHorseId = entry.settlement?.winnerHorseId == null
      ? null
      : String(entry.settlement.winnerHorseId);
    return (entry.forecast?.predictions ?? []).map((runner) => {
      const horseId = String(runner.horseId ?? runner.horseNo ?? runner.horseName);
      return {
        raceId: entry.raceId,
        date: entry.date,
        split,
        horseId,
        horseNo: runner.horseNo ?? null,
        horseName: runner.horseName ?? null,
        probability: Number(runner.probability),
        targetWin: winnerHorseId === horseId ? 1 : 0,
      };
    });
  });
}

function summarizeRows(rows) {
  const races = groupByRace(rows);
  const topPicks = [...races.values()]
    .map((raceRows) => (
      [...raceRows].sort((a, b) => Number(b.probability) - Number(a.probability))[0]
    ))
    .filter(Boolean);
  const topPickWins = topPicks.filter((row) => Number(row.targetWin) === 1).length;
  const brierTotal = rows.reduce((sum, row) => {
    const probability = clampProbability(row.probability);
    const outcome = Number(row.targetWin) === 1 ? 1 : 0;
    return sum + (probability - outcome) ** 2;
  }, 0);
  const logLossTotal = rows.reduce((sum, row) => {
    const probability = clampProbability(row.probability);
    const outcome = Number(row.targetWin) === 1 ? 1 : 0;
    return sum - (outcome * Math.log(probability) + (1 - outcome) * Math.log(1 - probability));
  }, 0);

  return {
    rows: rows.length,
    races: races.size,
    brierScore: rows.length ? round(brierTotal / rows.length, 6) : null,
    logLoss: rows.length ? round(logLossTotal / rows.length, 6) : null,
    topPickWins,
    topPickWinRate: topPicks.length ? round(topPickWins / topPicks.length, 6) : null,
  };
}

function buildCalibration(rows) {
  const buckets = [
    { label: '<10%', min: 0, max: 0.1 },
    { label: '10-15%', min: 0.1, max: 0.15 },
    { label: '15-20%', min: 0.15, max: 0.2 },
    { label: '20%+', min: 0.2, max: 1.000001 },
  ];

  return buckets.map((bucket) => {
    const bucketRows = rows.filter((row) => {
      const probability = Number(row.probability);
      return probability >= bucket.min && probability < bucket.max;
    });
    const predicted = bucketRows.reduce((sum, row) => sum + Number(row.probability), 0);
    const actual = bucketRows.reduce((sum, row) => sum + (Number(row.targetWin) === 1 ? 1 : 0), 0);
    return {
      label: bucket.label,
      rows: bucketRows.length,
      averageProbability: bucketRows.length ? round(predicted / bucketRows.length, 6) : null,
      actualWinRate: bucketRows.length ? round(actual / bucketRows.length, 6) : null,
      calibrationGap: bucketRows.length ? round(actual / bucketRows.length - predicted / bucketRows.length, 6) : null,
    };
  });
}

function compareModels(a, b) {
  const aHoldout = metricOrInfinity(a.metrics.bySplit.holdout.logLoss);
  const bHoldout = metricOrInfinity(b.metrics.bySplit.holdout.logLoss);
  if (aHoldout !== bHoldout) return aHoldout - bHoldout;
  const aValidation = metricOrInfinity(a.metrics.bySplit.validation.logLoss);
  const bValidation = metricOrInfinity(b.metrics.bySplit.validation.logLoss);
  return aValidation - bValidation;
}

function groupByRace(rows) {
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.raceId)) grouped.set(row.raceId, []);
    grouped.get(row.raceId).push(row);
  }
  return grouped;
}

function metricOrInfinity(value) {
  return Number.isFinite(Number(value)) ? Number(value) : Infinity;
}

function clampProbability(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.min(0.999999, Math.max(0.000001, number));
}

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}
