export const VALUE_RULE_VERSION = 'value-betting-v1';

const SELLING_STATUSES = new Set(['SELLING', 'OPEN', 'SALE_OPEN']);

const REASONS = {
  EDGE_CLEARS_BUFFER: '保守期望回报达到安全门槛，可以进入执行候选。',
  EDGE_BELOW_BUFFER: '存在可能的正期望，但未达到保守安全门槛，继续观察。',
  NEGATIVE_EDGE: '当前价格低于模型公平价，没有正期望空间。',
  MISSING_PRICE: '缺少可验证的临场价格，禁止下注。',
  MISSING_CAPTURE_TIME: '价格缺少抓取时间，无法证明是赛前数据。',
  STALE_PRICE: '价格已过期，不能用于当前下注决策。',
  FUTURE_PRICE: '价格时间晚于评估时间，时间顺序无效。',
  POOL_NOT_SELLING: '彩池当前不是可售状态，禁止下注。',
  PROBABILITY_NOT_PROMOTED: '概率模型尚未通过晋级门槛，仅作纸上跟踪。',
  INVALID_PROBABILITY: '概率输入无效，禁止下注。',
  INVALID_CONSERVATIVE_PROBABILITY: '保守概率输入无效，禁止下注。',
};

export function fairDividendPer10(probability) {
  const value = validProbability(probability);
  if (value == null) throw new RangeError('fairDividendPer10 requires probability > 0 and <= 1');
  return 10 / value;
}

export function requiredDividendPer10(conservativeProbability, safetyBuffer = 0.08) {
  const probability = validProbability(conservativeProbability);
  const buffer = Number(safetyBuffer);
  if (probability == null) {
    throw new RangeError('requiredDividendPer10 requires probability > 0 and <= 1');
  }
  if (!Number.isFinite(buffer) || buffer < 0) {
    throw new RangeError('requiredDividendPer10 requires a non-negative safetyBuffer');
  }
  return (10 * (1 + buffer)) / probability;
}

export function marketFreshness({ capturedAt, evaluatedAt, maxAgeMinutes = 15 } = {}) {
  const maxAge = Number(maxAgeMinutes);
  const captured = new Date(capturedAt);
  const evaluated = new Date(evaluatedAt);
  if (!capturedAt || !Number.isFinite(captured.getTime())) {
    return { status: 'MISSING', ageMinutes: null, maxAgeMinutes: finiteMaxAge(maxAge) };
  }
  if (!evaluatedAt || !Number.isFinite(evaluated.getTime())) {
    return { status: 'INVALID_EVALUATED_AT', ageMinutes: null, maxAgeMinutes: finiteMaxAge(maxAge) };
  }
  const ageMinutes = (evaluated.getTime() - captured.getTime()) / 60_000;
  if (ageMinutes < 0) {
    return {
      status: 'FUTURE',
      ageMinutes: round(ageMinutes, 3),
      maxAgeMinutes: finiteMaxAge(maxAge),
    };
  }
  if (!Number.isFinite(maxAge) || maxAge < 0 || ageMinutes > maxAge) {
    return {
      status: 'STALE',
      ageMinutes: round(ageMinutes, 3),
      maxAgeMinutes: finiteMaxAge(maxAge),
    };
  }
  return {
    status: 'FRESH',
    ageMinutes: round(ageMinutes, 3),
    maxAgeMinutes: maxAge,
  };
}

export function evaluateValueCandidate({
  pool,
  probability,
  conservativeProbability,
  dividendPer10,
  capturedAt,
  evaluatedAt,
  sellStatus,
  safetyBuffer = 0.08,
  maxAgeMinutes = 15,
  probabilityStatus = 'RESEARCH_ONLY',
} = {}) {
  const central = validProbability(probability);
  if (central == null) {
    return decision({
      status: 'NO_BET',
      reasonCode: 'INVALID_PROBABILITY',
      pool,
      probability,
      conservativeProbability,
    });
  }
  const conservative = validProbability(conservativeProbability);
  if (conservative == null || conservative > central) {
    return decision({
      status: 'NO_BET',
      reasonCode: 'INVALID_CONSERVATIVE_PROBABILITY',
      pool,
      probability: central,
      conservativeProbability,
    });
  }
  const price = positiveNumber(dividendPer10);
  const freshness = marketFreshness({ capturedAt, evaluatedAt, maxAgeMinutes });
  const market = {
    dividendPer10: price == null ? null : round(price, 2),
    capturedAt: capturedAt ?? null,
    evaluatedAt: evaluatedAt ?? null,
    sellStatus: sellStatus ?? null,
    ...freshness,
  };
  const fair = fairDividendPer10(central);
  const required = requiredDividendPer10(conservative, safetyBuffer);
  const common = {
    pool,
    probability: central,
    conservativeProbability: conservative,
    probabilityStatus,
    safetyBuffer: round(Number(safetyBuffer), 4),
    fairDividendPer10: round(fair, 2),
    requiredDividendPer10: round(required, 2),
    market,
  };

  if (price == null) {
    return decision({ ...common, status: 'NO_BET', reasonCode: 'MISSING_PRICE' });
  }
  if (freshness.status === 'MISSING' || freshness.status === 'INVALID_EVALUATED_AT') {
    return decision({ ...common, status: 'NO_BET', reasonCode: 'MISSING_CAPTURE_TIME' });
  }
  if (freshness.status === 'FUTURE') {
    return decision({ ...common, status: 'NO_BET', reasonCode: 'FUTURE_PRICE' });
  }
  if (freshness.status === 'STALE') {
    return decision({ ...common, status: 'NO_BET', reasonCode: 'STALE_PRICE' });
  }
  if (!SELLING_STATUSES.has(String(sellStatus ?? '').trim().toUpperCase())) {
    return decision({ ...common, status: 'NO_BET', reasonCode: 'POOL_NOT_SELLING' });
  }

  const expectedRoi = central * (price / 10) - 1;
  const conservativeExpectedRoi = conservative * (price / 10) - 1;
  const priced = {
    ...common,
    expectedRoi: round(expectedRoi, 4),
    conservativeExpectedRoi: round(conservativeExpectedRoi, 4),
    priceEdgeVsFair: round(price / fair - 1, 4),
    priceEdgeVsRequired: round(price / required - 1, 4),
  };
  if (String(probabilityStatus).toUpperCase() !== 'CALIBRATED') {
    return decision({
      ...priced,
      status: 'PAPER',
      reasonCode: 'PROBABILITY_NOT_PROMOTED',
      hypotheticalStatus: price >= required ? 'PLAY' : price >= fair ? 'WATCH' : 'NO_BET',
    });
  }
  if (price >= required) {
    return decision({ ...priced, status: 'PLAY', reasonCode: 'EDGE_CLEARS_BUFFER' });
  }
  if (price >= fair) {
    return decision({ ...priced, status: 'WATCH', reasonCode: 'EDGE_BELOW_BUFFER' });
  }
  return decision({ ...priced, status: 'NO_BET', reasonCode: 'NEGATIVE_EDGE' });
}

function decision({ reasonCode, ...values }) {
  return {
    ruleVersion: VALUE_RULE_VERSION,
    ...values,
    reasonCode,
    reasonZh: REASONS[reasonCode] ?? '未知决策原因。',
  };
}

function validProbability(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= 1 ? number : null;
}

function positiveNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function finiteMaxAge(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function round(value, digits) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
