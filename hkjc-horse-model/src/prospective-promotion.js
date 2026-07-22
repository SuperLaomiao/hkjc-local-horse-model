const GATE_VERSION = 'prospective-promotion-v1';

export const DEFAULT_PROSPECTIVE_PROMOTION_THRESHOLDS = Object.freeze({
  minRaces: 100,
  minLines: 100,
  minRoiLowerBound: 0,
  minAverageClv: 0,
  maxCalibrationError: 0.05,
  maxDrawdownPct: 0.25,
  minPositiveMeetingRate: 0.55,
  maxReturnConcentration: 0.25,
  requireLabelPlacebo: true,
  requirePricePlacebo: true,
  requireFreshCohort: true,
  requireLineage: true,
});

export function evaluatePoolPromotion({
  evaluation,
  coverageGate,
  modelId,
  pool,
  thresholds = {},
} = {}) {
  const normalizedModelId = requiredText(modelId, 'modelId');
  const normalizedPool = canonicalPool(pool);
  const frozenThresholds = normalizeThresholds(thresholds);
  const model = (Array.isArray(evaluation?.models) ? evaluation.models : [])
    .find((candidate) => candidate?.modelId === normalizedModelId);
  const base = {
    version: GATE_VERSION,
    gateVersion: GATE_VERSION,
    modelId: normalizedModelId,
    pool: normalizedPool,
    cashMode: 'NO_BET',
    executionStatus: 'PAPER_ONLY',
    frozenThresholds,
    cohort: cohortLineage(evaluation?.cohort),
  };

  if (coverageGate?.status !== 'READY') {
    return {
      ...base,
      state: 'BLOCKED_DATA',
      transitions: [],
      failedGates: [{
        id: 'coverage',
        actual: coverageGate?.status ?? 'MISSING',
        expected: 'READY',
      }],
      coverageDeficits: structuredClone(coverageGate?.deficits ?? []),
      lineage: modelLineage(model, normalizedModelId),
    };
  }

  const metrics = model?.byPool?.[normalizedPool];
  if (!model || !metrics) {
    return {
      ...base,
      state: 'BLOCKED_DATA',
      transitions: [],
      failedGates: [{
        id: 'candidate-data',
        actual: model ? 'POOL_MISSING' : 'MODEL_MISSING',
        expected: 'MODEL_AND_POOL_METRICS',
      }],
      coverageDeficits: [],
      lineage: modelLineage(model, normalizedModelId),
    };
  }

  const lineage = modelLineage(model, normalizedModelId);
  const gateResults = buildGateResults({
    evaluation,
    metrics,
    lineage,
    thresholds: frozenThresholds,
  });
  const failedGates = gateResults.filter((gate) => !gate.pass);

  if (failedGates.length > 0) {
    return {
      ...base,
      state: 'NO_GO',
      transitions: ['BLOCKED_DATA->NO_GO'],
      gateResults,
      failedGates,
      lineage,
    };
  }

  return {
    ...base,
    state: 'REVIEW_REQUIRED',
    transitions: [
      'BLOCKED_DATA->RESEARCH_CHAMPION',
      'RESEARCH_CHAMPION->REVIEW_REQUIRED',
    ],
    gateResults,
    failedGates: [],
    lineage,
  };
}

export function advanceProspectivePromotion({ promotion, to, manualReview } = {}) {
  if (!promotion || typeof promotion !== 'object' || Array.isArray(promotion)) {
    throw new TypeError('promotion must be an object');
  }
  const target = requiredText(to, 'to').toUpperCase();
  if (promotion.state !== 'REVIEW_REQUIRED' || target !== 'APPROVED_CANDIDATE') {
    throw new Error(`transition is not allowed: ${promotion.state ?? 'UNKNOWN'}->${target}`);
  }
  const reviewedBy = requiredText(manualReview?.reviewedBy, 'manualReview.reviewedBy');
  const reviewedAt = normalizeTimestamp(manualReview?.reviewedAt, 'manualReview.reviewedAt');
  return {
    ...structuredClone(promotion),
    state: 'APPROVED_CANDIDATE',
    transitions: [
      ...(Array.isArray(promotion.transitions) ? promotion.transitions : []),
      'REVIEW_REQUIRED->APPROVED_CANDIDATE',
    ],
    manualReview: { reviewedBy, reviewedAt },
    cashMode: 'NO_BET',
    executionStatus: 'PAPER_ONLY',
  };
}

function buildGateResults({ evaluation, metrics, lineage, thresholds }) {
  const races = finiteNumber(metrics.races);
  const lines = finiteNumber(metrics.lines);
  const roiLower = finiteNumber(metrics.bootstrap?.roi?.lower);
  const averageClv = finiteNumber(metrics.averageClv);
  const calibrationError = finiteNumber(metrics.calibrationError);
  const maxDrawdownPct = finiteNumber(metrics.risk?.maxDrawdownPct);
  const positiveMeetingRate = finiteNumber(metrics.stability?.positiveMeetingRate);
  const returnConcentration = finiteNumber(metrics.returnConcentration);
  const labelPlacebo = metrics.placebo?.labelPermutation?.pass === true;
  const pricePlacebo = metrics.placebo?.pricePermutation?.pass === true;
  const freshCohort = evaluation?.cohort?.fresh === true;
  const completeLineage = Boolean(
    lineage.modelId
    && lineage.artifactIds.length === 1
    && lineage.featurePolicyIds.length === 1
    && lineage.calibrationMethods.length === 1
    && lineage.trainingCutoffs.length === 1,
  );

  return [
    result('sample-size', races != null && lines != null
      && races >= thresholds.minRaces && lines >= thresholds.minLines,
    { races, lines }, { minRaces: thresholds.minRaces, minLines: thresholds.minLines }),
    result('roi-lower-bound', roiLower != null && roiLower > thresholds.minRoiLowerBound,
      roiLower, `>${thresholds.minRoiLowerBound}`),
    result('clv', averageClv != null && averageClv > thresholds.minAverageClv,
      averageClv, `>${thresholds.minAverageClv}`),
    result('calibration', calibrationError != null
      && calibrationError <= thresholds.maxCalibrationError,
    calibrationError, `<=${thresholds.maxCalibrationError}`),
    result('drawdown', maxDrawdownPct != null && maxDrawdownPct <= thresholds.maxDrawdownPct,
      maxDrawdownPct, `<=${thresholds.maxDrawdownPct}`),
    result('stability', positiveMeetingRate != null
      && positiveMeetingRate >= thresholds.minPositiveMeetingRate,
    positiveMeetingRate, `>=${thresholds.minPositiveMeetingRate}`),
    result('concentration', returnConcentration != null
      && returnConcentration <= thresholds.maxReturnConcentration,
    returnConcentration, `<=${thresholds.maxReturnConcentration}`),
    result('placebo', (!thresholds.requireLabelPlacebo || labelPlacebo)
      && (!thresholds.requirePricePlacebo || pricePlacebo),
    { labelPermutation: labelPlacebo, pricePermutation: pricePlacebo },
    {
      labelPermutation: thresholds.requireLabelPlacebo,
      pricePermutation: thresholds.requirePricePlacebo,
    }),
    result('fresh-cohort', !thresholds.requireFreshCohort || freshCohort,
      freshCohort, thresholds.requireFreshCohort),
    result('lineage', !thresholds.requireLineage || completeLineage,
      completeLineage, thresholds.requireLineage),
  ];
}

function result(id, pass, actual, expected) {
  return { id, pass: Boolean(pass), actual, expected };
}

function normalizeThresholds(overrides) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new TypeError('thresholds must be an object');
  }
  const merged = { ...DEFAULT_PROSPECTIVE_PROMOTION_THRESHOLDS, ...overrides };
  for (const key of [
    'minRaces',
    'minLines',
    'minRoiLowerBound',
    'minAverageClv',
    'maxCalibrationError',
    'maxDrawdownPct',
    'minPositiveMeetingRate',
    'maxReturnConcentration',
  ]) {
    if (!Number.isFinite(Number(merged[key]))) throw new TypeError(`${key} must be finite`);
    merged[key] = Number(merged[key]);
  }
  for (const key of ['requireLabelPlacebo', 'requirePricePlacebo', 'requireFreshCohort', 'requireLineage']) {
    merged[key] = merged[key] === true;
  }
  return merged;
}

function cohortLineage(cohort) {
  return {
    freezeDate: cohort?.freezeDate ?? null,
    dateRange: structuredClone(cohort?.dateRange ?? { from: null, to: null }),
    fresh: cohort?.fresh === true,
  };
}

function modelLineage(model, modelId) {
  return {
    modelId,
    artifactIds: uniqueText(model?.artifactIds),
    featurePolicyIds: uniqueText(model?.featurePolicyIds),
    calibrationMethods: uniqueText(model?.calibrationMethods),
    trainingCutoffs: uniqueText(model?.trainingCutoffs),
  };
}

function uniqueText(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value ?? '').trim())
    .filter(Boolean))];
}

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function canonicalPool(value) {
  const compact = requiredText(value, 'pool').toUpperCase().replaceAll(/[^A-Z]/g, '');
  if (compact === 'WIN') return 'WIN';
  if (['PLA', 'PLACE'].includes(compact)) return 'PLA';
  if (['QIN', 'QUINELLA'].includes(compact)) return 'QIN';
  if (['QPL', 'QUINELLAPLACE'].includes(compact)) return 'QPL';
  throw new TypeError('pool must be a supported pool: WIN, PLACE, QIN, or QPL');
}

function requiredText(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
}

function normalizeTimestamp(value, label) {
  const normalized = requiredText(value, label);
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) throw new TypeError(`${label} must be an ISO timestamp`);
  return new Date(timestamp).toISOString();
}
