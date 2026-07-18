export const UNCERTAINTY_TRIPWIRE_VERSION = 'uncertainty-tripwire-v1';

const DEFAULT_THRESHOLDS = Object.freeze({
  moderateModelDisagreement: 0.08,
  highModelDisagreement: 0.18,
  moderateCalibrationDrift: 0.03,
  highCalibrationDrift: 0.06,
  lowConfidenceZ: -2,
  highConfidenceZ: 2,
  minimumBaselineSample: 30,
  baselinePriorStrength: 30,
  minimumBaselineStandardDeviation: 0.01,
});

export function evaluateUncertaintyTripwire(input = {}) {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(input.thresholds ?? {}) };
  const modelDisagreement = resolveModelDisagreement(input);
  const calibrationDrift = finiteNonnegative(input.calibrationDrift);
  const confidenceZ = shrunkenConfidenceZ(input.confidenceBaseline, thresholds);
  const reasons = [];

  if (input.marketAvailable === false) {
    reasons.push(reason(
      'MISSING_LIVE_MARKET',
      'PAPER',
      '缺少可核验的临场赔率或彩池快照。',
    ));
  }
  if (input.probabilityStatus && input.probabilityStatus !== 'CALIBRATED') {
    reasons.push(reason(
      'PROBABILITY_NOT_CALIBRATED',
      'PAPER',
      '概率模型尚未通过校准晋级。',
    ));
  }
  if (modelDisagreement != null && modelDisagreement >= thresholds.highModelDisagreement) {
    reasons.push(reason(
      'HIGH_MODEL_DISAGREEMENT',
      'PAPER',
      '模型分歧过大，当前排序不稳定。',
    ));
  } else if (modelDisagreement != null && modelDisagreement >= thresholds.moderateModelDisagreement) {
    reasons.push(reason(
      'MODEL_DISAGREEMENT',
      'REDUCE',
      '模型分歧高于正常范围，注码减半。',
    ));
  }
  if (calibrationDrift != null && calibrationDrift >= thresholds.highCalibrationDrift) {
    reasons.push(reason(
      'HIGH_CALIBRATION_DRIFT',
      'PAPER',
      '近期校准漂移过大，暂停现金下注。',
    ));
  } else if (calibrationDrift != null && calibrationDrift >= thresholds.moderateCalibrationDrift) {
    reasons.push(reason(
      'CALIBRATION_DRIFT',
      'REDUCE',
      '近期校准出现中度漂移，注码减半。',
    ));
  }
  if (confidenceZ != null && confidenceZ <= thresholds.lowConfidenceZ) {
    reasons.push(reason(
      'ABNORMALLY_LOW_CONFIDENCE',
      'PAPER',
      '当前信心显著低于近 90 日基线。',
    ));
  } else if (confidenceZ != null && confidenceZ >= thresholds.highConfidenceZ) {
    reasons.push(reason(
      'ABNORMALLY_HIGH_CONFIDENCE',
      'REDUCE',
      '当前信心异常高于近 90 日基线，先按漂移风险减注。',
    ));
  }

  const status = reasons.some((item) => item.action === 'PAPER')
    ? 'PAPER'
    : reasons.some((item) => item.action === 'REDUCE')
      ? 'REDUCE'
      : 'PASS';
  const stakeMultiplier = status === 'PAPER' ? 0 : status === 'REDUCE' ? 0.5 : 1;
  const uncertaintyScore = roundProbability(Math.max(
    status === 'PAPER' ? 1 : status === 'REDUCE' ? 0.5 : 0,
    normalizeMetric(modelDisagreement, thresholds.highModelDisagreement),
    normalizeMetric(calibrationDrift, thresholds.highCalibrationDrift),
    normalizeMetric(confidenceZ == null ? null : Math.abs(confidenceZ), 3),
  ));

  return {
    version: UNCERTAINTY_TRIPWIRE_VERSION,
    status,
    stakeMultiplier,
    uncertaintyScore,
    reasonCodes: reasons.map((item) => item.code),
    reasons,
    summaryZh: summaryFor(status, reasons),
    metrics: {
      modelDisagreement,
      calibrationDrift,
      confidenceZ,
      ensembleModels: validProbabilities(input.modelProbabilities).length,
      baselineSampleSize: finiteNonnegative(input.confidenceBaseline?.sampleSize),
    },
  };
}

export function applyUncertaintyToStake(stake, tripwire, minUnit = 10) {
  const amount = finiteNonnegative(stake) ?? 0;
  const unit = positiveNumber(minUnit) ?? 10;
  const multiplier = finiteNonnegative(tripwire?.stakeMultiplier) ?? 0;
  return Math.floor((amount * Math.min(multiplier, 1)) / unit) * unit;
}

export function buildRecentConfidenceBaseline(entries, options = {}) {
  const asOf = validTimestamp(options.asOf);
  const currentProbability = validProbability(options.currentProbability);
  const lookbackDays = positiveNumber(options.lookbackDays) ?? 90;
  if (asOf == null || currentProbability == null) return null;

  const lowerBound = asOf - lookbackDays * 24 * 60 * 60 * 1000;
  const values = (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry?.raceId !== options.excludeRaceId)
    .filter(isSettledEntry)
    .map((entry) => ({
      timestamp: entryTimestamp(entry),
      probability: entryTopProbability(entry),
    }))
    .filter((item) => (
      item.timestamp != null
      && item.timestamp < asOf
      && item.timestamp >= lowerBound
      && item.probability != null
    ))
    .map((item) => item.probability);

  if (!values.length) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return {
    recent: roundProbability(currentProbability),
    mean: roundProbability(mean),
    standardDeviation: roundProbability(Math.sqrt(variance)),
    sampleSize: values.length,
    lookbackDays,
  };
}

function resolveModelDisagreement(input) {
  const explicit = finiteNonnegative(input.modelDisagreement);
  if (explicit != null) return explicit;
  const probabilities = validProbabilities(input.modelProbabilities);
  if (probabilities.length < 2) return null;
  return Math.max(...probabilities) - Math.min(...probabilities);
}

function validProbabilities(values) {
  return (Array.isArray(values) ? values : [])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= 1);
}

function entryTopProbability(entry) {
  const explicit = validProbability(entry?.forecast?.topPick?.probability);
  if (explicit != null) return explicit;
  const predictions = Array.isArray(entry?.forecast?.predictions)
    ? entry.forecast.predictions
    : [];
  const values = predictions.map((runner) => validProbability(runner?.probability)).filter((value) => value != null);
  return values.length ? Math.max(...values) : null;
}

function entryTimestamp(entry) {
  return validTimestamp(
    entry?.forecast?.generatedAt
      ?? entry?.postTime
      ?? entry?.scheduledPostTime
      ?? entry?.date,
  );
}

function isSettledEntry(entry) {
  if (!entry?.settlement) return false;
  return !['OPEN', 'UPCOMING', 'PENDING'].includes(String(entry.settlement.status ?? '').toUpperCase());
}

function shrunkenConfidenceZ(baseline, thresholds) {
  const recent = finiteNumber(baseline?.recent);
  const mean = finiteNumber(baseline?.mean);
  const observedStandardDeviation = finiteNonnegative(baseline?.standardDeviation);
  const sampleSize = finiteNonnegative(baseline?.sampleSize);
  if (recent == null || mean == null || observedStandardDeviation == null || sampleSize == null) return null;
  if (sampleSize < thresholds.minimumBaselineSample) return null;
  const standardDeviation = Math.max(
    observedStandardDeviation,
    positiveNumber(thresholds.minimumBaselineStandardDeviation) ?? 0.01,
  );
  const reliability = sampleSize / (sampleSize + thresholds.baselinePriorStrength);
  return ((recent - mean) / standardDeviation) * reliability;
}

function reason(code, action, detailZh) {
  return { code, action, detailZh };
}

function summaryFor(status, reasons) {
  if (status === 'PASS') return '不确定性保护闸通过，维持原计划注码。';
  const details = reasons.map((item) => item.detailZh).join(' ');
  if (status === 'PAPER') return `${details} 已转为纸上模式。`;
  return `${details} 最终注码按最小投注单位向下取整。`;
}

function normalizeMetric(value, threshold) {
  if (value == null || !Number.isFinite(value) || !Number.isFinite(threshold) || threshold <= 0) return 0;
  return Math.min(Math.max(value / threshold, 0), 1);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function finiteNonnegative(value) {
  const number = finiteNumber(value);
  return number != null && number >= 0 ? number : null;
}

function positiveNumber(value) {
  const number = finiteNumber(value);
  return number != null && number > 0 ? number : null;
}

function validProbability(value) {
  const number = finiteNumber(value);
  return number != null && number >= 0 && number <= 1 ? number : null;
}

function validTimestamp(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function roundProbability(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
