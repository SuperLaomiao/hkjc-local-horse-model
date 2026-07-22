const SUPPORTED_POOLS = ['WIN', 'PLA', 'QIN', 'QPL'];

export function buildIdenticalProspectiveCohort({
  locks = [],
  modelIds = [],
  pools = SUPPORTED_POOLS,
  freeze,
} = {}) {
  const freezeDate = normalizeDate(freeze, 'freeze');
  const requestedModels = uniqueText(modelIds, 'modelIds');
  const requestedPools = uniquePools(pools);
  const exclusions = {
    beforeFreezeLines: 0,
    unsupportedLines: 0,
    nonSettledLines: 0,
    voidLines: 0,
    invalidLines: 0,
    nonCommonLines: 0,
    missingByModel: Object.fromEntries(requestedModels.map((modelId) => [modelId, 0])),
  };
  const eligible = [];

  for (const lock of Array.isArray(locks) ? locks : []) {
    const classification = normalizeEvaluationLock(lock, { requestedModels, requestedPools, freezeDate });
    if (classification.reason) {
      exclusions[classification.reason] += 1;
      continue;
    }
    eligible.push(classification.line);
  }

  const cellModels = new Map();
  for (const line of eligible) {
    const key = racePoolKey(line);
    if (!cellModels.has(key)) cellModels.set(key, new Set());
    cellModels.get(key).add(line.modelId);
  }
  const commonCellKeys = new Set([...cellModels.entries()]
    .filter(([, models]) => requestedModels.every((modelId) => models.has(modelId)))
    .map(([key]) => key));

  for (const [key, models] of cellModels) {
    if (commonCellKeys.has(key)) continue;
    for (const modelId of requestedModels) {
      if (!models.has(modelId)) exclusions.missingByModel[modelId] += 1;
    }
  }
  const lines = eligible.filter((line) => {
    const included = commonCellKeys.has(racePoolKey(line));
    if (!included) exclusions.nonCommonLines += 1;
    return included;
  }).sort(compareLines);
  const raceIds = [...new Set(lines.map((line) => line.raceId))].sort();
  const dates = lines.map((line) => line.date).filter(Boolean).sort();

  return {
    version: 'identical-prospective-cohort-v1',
    freezeDate,
    modelIds: requestedModels,
    pools: requestedPools,
    fresh: lines.every((line) => line.date >= freezeDate),
    dateRange: {
      from: dates[0] ?? null,
      to: dates.at(-1) ?? null,
    },
    summary: {
      models: requestedModels.length,
      pools: requestedPools.length,
      races: raceIds.length,
      racePoolCells: commonCellKeys.size,
      lines: lines.length,
      meetings: new Set(lines.map((line) => line.meeting)).size,
    },
    exclusions,
    lines,
  };
}

export function evaluateProspectiveCandidates({
  cohort,
  bootstrapSeed = 1701,
  bootstrapIterations = 1000,
} = {}) {
  validateCohort(cohort);
  const iterations = normalizeIterations(bootstrapIterations);
  const seed = normalizeSeed(bootstrapSeed);
  const models = cohort.modelIds.map((modelId, modelIndex) => {
    const lines = cohort.lines.filter((line) => line.modelId === modelId);
    const metrics = evaluateLineSet(lines, {
      seed: seed + modelIndex * 1009,
      iterations,
    });
    const byPool = Object.fromEntries(cohort.pools.map((pool, poolIndex) => [
      pool,
      evaluateLineSet(lines.filter((line) => line.pool === pool), {
        seed: seed + modelIndex * 1009 + (poolIndex + 1) * 7919,
        iterations,
      }),
    ]));
    return {
      modelId,
      artifactIds: unique(lines.map((line) => line.artifactId).filter(Boolean)),
      featurePolicyIds: unique(lines.map((line) => line.featurePolicyId).filter(Boolean)),
      calibrationMethods: unique(lines.map((line) => line.calibrationMethod).filter(Boolean)),
      trainingCutoffs: unique(lines.map((line) => line.trainingCutoff).filter(Boolean)),
      metrics,
      byPool,
    };
  });

  return {
    version: 'prospective-evaluation-v1',
    generatedAt: cohort.dateRange.to ? `${cohort.dateRange.to}T23:59:59.999Z` : null,
    evaluationPolicy: {
      cohort: 'IDENTICAL_RACE_POOL_CELLS',
      population: 'LOCKED_RECOMMENDATION_LINES',
      topPickScope: 'HIGHEST_PROBABILITY_LOCKED_LINE_PER_RACE_POOL',
      missingData: 'EXCLUDE_COMMON_CELL_NOT_ZERO_RETURN',
      bootstrapUnit: 'MEETING',
      drawdownRateDenominator: 'TOTAL_STAKE',
      returnConcentration: 'MAX_SINGLE_LINE_RETURN_SHARE',
      bootstrapSeed: seed,
      bootstrapIterations: iterations,
      placebo: ['LABEL_PERMUTATION', 'LOCKED_PRICE_PERMUTATION'],
      cashMode: 'NO_BET',
    },
    cohort: {
      version: cohort.version,
      freezeDate: cohort.freezeDate,
      fresh: cohort.fresh,
      dateRange: structuredClone(cohort.dateRange),
      summary: structuredClone(cohort.summary),
      exclusions: structuredClone(cohort.exclusions),
    },
    models,
  };
}

function normalizeEvaluationLock(lock, { requestedModels, requestedPools, freezeDate }) {
  if (!lock || typeof lock !== 'object' || Array.isArray(lock)) return { reason: 'invalidLines' };
  const modelId = text(lock.modelId ?? lock.lineage?.modelId);
  const pool = canonicalPool(lock.pool ?? lock.poolKey);
  if (!modelId || !requestedModels.includes(modelId) || !pool || !requestedPools.includes(pool)) {
    return { reason: 'unsupportedLines' };
  }
  const date = text(lock.date) ?? inferDate(lock.raceId);
  if (!date || date < freezeDate) return { reason: 'beforeFreezeLines' };
  const status = text(lock.status)?.toUpperCase();
  if (status === 'VOID' || text(lock.settlement?.outcome)?.toUpperCase() === 'VOID') {
    return { reason: 'voidLines' };
  }
  if (status !== 'SETTLED' || !lock.settlement) return { reason: 'nonSettledLines' };
  const outcomeText = text(lock.settlement.outcome)?.toUpperCase();
  if (!['HIT', 'MISS'].includes(outcomeText)) return { reason: 'invalidLines' };
  const probability = probabilityNumber(lock.decision?.rawProbability ?? lock.rawProbability);
  const stake = nonNegativeNumber(lock.settlement.stake ?? lock.decision?.stake);
  const returned = nonNegativeNumber(lock.settlement.returned);
  const profit = finiteNumber(lock.settlement.profit);
  const raceId = text(lock.raceId);
  if (!raceId || probability == null || stake == null || returned == null || profit == null) {
    return { reason: 'invalidLines' };
  }
  return {
    line: {
      lockId: text(lock.lockId),
      raceId,
      date,
      meeting: inferMeeting(lock),
      pool,
      modelId,
      artifactId: text(lock.artifactId ?? lock.lineage?.artifactId),
      featurePolicyId: text(lock.featurePolicyId ?? lock.lineage?.featurePolicyId),
      calibrationMethod: text(lock.calibrationMethod ?? lock.lineage?.calibrationMethod),
      trainingCutoff: text(lock.trainingCutoff ?? lock.lineage?.trainingCutoff),
      generatedAt: normalizeOptionalTimestamp(lock.generatedAt),
      probability,
      conservativeProbability: probabilityNumber(lock.decision?.conservativeProbability),
      currentDividendPer10: positiveNumber(lock.decision?.currentDividendPer10),
      outcome: outcomeText === 'HIT' ? 1 : 0,
      stake,
      returned,
      profit,
      indicativeClv: finiteNumber(lock.settlement.indicativeClv),
    },
  };
}

function evaluateLineSet(lines, { seed, iterations }) {
  const rows = Array.isArray(lines) ? lines : [];
  const probability = probabilityMetrics(rows);
  const value = valueMetrics(rows);
  return {
    lines: rows.length,
    races: new Set(rows.map((line) => line.raceId)).size,
    racePoolCells: new Set(rows.map(racePoolKey)).size,
    meetings: new Set(rows.map((line) => line.meeting)).size,
    ...probability,
    ...value,
    topPickByPool: topPickMetrics(rows),
    risk: riskMetrics(rows),
    stability: stabilityMetrics(rows),
    bootstrap: meetingBlockBootstrap(rows, { seed, iterations }),
    placebo: placeboChecks(rows, { seed: seed + 104729, iterations }),
  };
}

function probabilityMetrics(rows) {
  if (rows.length === 0) {
    return { logLoss: null, brierScore: null, calibrationError: null, calibrationBuckets: [] };
  }
  let logLoss = 0;
  let brier = 0;
  for (const row of rows) {
    const probability = clampProbability(row.probability);
    logLoss -= row.outcome * Math.log(probability) + (1 - row.outcome) * Math.log(1 - probability);
    brier += (probability - row.outcome) ** 2;
  }
  const calibrationBuckets = calibration(rows);
  const calibrationError = calibrationBuckets.reduce(
    (total, bucket) => total + bucket.weight * Math.abs(bucket.actualRate - bucket.averageProbability),
    0,
  );
  return {
    logLoss: round(logLoss / rows.length, 6),
    brierScore: round(brier / rows.length, 6),
    calibrationError: round(calibrationError, 6),
    calibrationBuckets,
  };
}

function calibration(rows) {
  const buckets = Array.from({ length: 5 }, (_, index) => ({
    label: `${index * 20}-${(index + 1) * 20}%`,
    min: index * 0.2,
    max: (index + 1) * 0.2 + (index === 4 ? 1e-9 : 0),
  }));
  return buckets.map((bucket) => {
    const values = rows.filter((row) => row.probability >= bucket.min && row.probability < bucket.max);
    const averageProbability = mean(values.map((row) => row.probability));
    const actualRate = mean(values.map((row) => row.outcome));
    return {
      label: bucket.label,
      rows: values.length,
      weight: rows.length ? round(values.length / rows.length, 6) : 0,
      averageProbability: roundOrNull(averageProbability, 6),
      actualRate: roundOrNull(actualRate, 6),
      gap: values.length ? round(actualRate - averageProbability, 6) : null,
    };
  }).filter((bucket) => bucket.rows > 0);
}

function valueMetrics(rows) {
  const staked = rows.filter((row) => row.stake > 0);
  const stake = sum(staked, (row) => row.stake);
  const returned = sum(staked, (row) => row.returned);
  const profit = sum(staked, (row) => row.profit);
  const clvValues = rows.map((row) => row.indicativeClv).filter(Number.isFinite);
  return {
    stake: round(stake, 2),
    returned: round(returned, 2),
    profit: round(profit, 2),
    roi: stake > 0 ? round(profit / stake, 6) : null,
    clvLines: clvValues.length,
    averageClv: roundOrNull(mean(clvValues), 6),
    returnConcentration: returned > 0
      ? round(Math.max(...staked.map((row) => row.returned)) / returned, 6)
      : null,
  };
}

function topPickMetrics(rows) {
  const result = {};
  for (const pool of SUPPORTED_POOLS) {
    const poolRows = rows.filter((row) => row.pool === pool);
    const groups = groupBy(poolRows, (row) => row.raceId);
    const picks = [...groups.values()].map((values) => [...values].sort((left, right) => (
      right.probability - left.probability || String(left.lockId).localeCompare(String(right.lockId))
    ))[0]);
    const hits = picks.filter((row) => row?.outcome === 1).length;
    result[pool] = {
      races: picks.length,
      hits,
      hitRate: picks.length ? round(hits / picks.length, 6) : null,
    };
  }
  return result;
}

function riskMetrics(rows) {
  const staked = [...rows].filter((row) => row.stake > 0).sort(compareLines);
  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let longestLosingRun = 0;
  let losingRun = 0;
  for (const row of staked) {
    cumulative += row.profit;
    peak = Math.max(peak, cumulative);
    maxDrawdown = Math.max(maxDrawdown, peak - cumulative);
    if (row.profit < 0) {
      losingRun += 1;
      longestLosingRun = Math.max(longestLosingRun, losingRun);
    } else {
      losingRun = 0;
    }
  }
  const totalStake = sum(staked, (row) => row.stake);
  return {
    maxDrawdown: round(maxDrawdown, 2),
    maxDrawdownPct: totalStake > 0 ? round(maxDrawdown / totalStake, 6) : null,
    longestLosingRun,
  };
}

function stabilityMetrics(rows) {
  const byMeeting = summarizeGroups(rows, (row) => row.meeting, 'meeting');
  const byMonth = summarizeGroups(rows, (row) => row.date.slice(0, 7), 'month');
  const stakedMeetings = byMeeting.filter((row) => row.stake > 0);
  const stakedMonths = byMonth.filter((row) => row.stake > 0);
  return {
    byMeeting,
    byMonth,
    positiveMeetingRate: stakedMeetings.length
      ? round(stakedMeetings.filter((row) => row.profit > 0).length / stakedMeetings.length, 6)
      : null,
    positiveMonthRate: stakedMonths.length
      ? round(stakedMonths.filter((row) => row.profit > 0).length / stakedMonths.length, 6)
      : null,
  };
}

function summarizeGroups(rows, selector, keyName) {
  return [...groupBy(rows, selector).entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([key, values]) => {
      const stake = sum(values, (row) => row.stake);
      const returned = sum(values, (row) => row.returned);
      const profit = sum(values, (row) => row.profit);
      return {
        [keyName]: key,
        lines: values.length,
        stake: round(stake, 2),
        returned: round(returned, 2),
        profit: round(profit, 2),
        roi: stake > 0 ? round(profit / stake, 6) : null,
      };
    });
}

function meetingBlockBootstrap(rows, { seed, iterations }) {
  const groups = [...groupBy(rows.filter((row) => row.stake > 0), (row) => row.meeting).values()];
  if (groups.length === 0) return { unit: 'MEETING', iterations, roi: { lower: null, median: null, upper: null } };
  const random = seededRandom(seed);
  const values = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sample = [];
    for (let index = 0; index < groups.length; index += 1) {
      sample.push(...groups[Math.floor(random() * groups.length)]);
    }
    const stake = sum(sample, (row) => row.stake);
    values.push(stake > 0 ? sum(sample, (row) => row.profit) / stake : 0);
  }
  values.sort((left, right) => left - right);
  return {
    unit: 'MEETING',
    iterations,
    meetings: groups.length,
    roi: {
      lower: round(percentile(values, 0.025), 6),
      median: round(percentile(values, 0.5), 6),
      upper: round(percentile(values, 0.975), 6),
    },
  };
}

function placeboChecks(rows, { seed, iterations }) {
  if (rows.length === 0) return unavailablePlacebo(iterations);
  const random = seededRandom(seed);
  const actualBrier = probabilityMetrics(rows).brierScore;
  const actualRoi = valueMetrics(rows).roi;
  const outcomes = rows.map((row) => row.outcome);
  const prices = rows.map((row) => row.currentDividendPer10);
  const labelScores = [];
  const priceRois = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const shuffledOutcomes = shuffled(outcomes, random);
    labelScores.push(probabilityMetrics(rows.map((row, index) => ({
      ...row,
      outcome: shuffledOutcomes[index],
    }))).brierScore);
    if (prices.every((price) => Number.isFinite(price))) {
      const shuffledPrices = shuffled(prices, random);
      const stake = sum(rows, (row) => row.stake);
      const returned = sum(rows, (row, index) => (
        row.outcome === 1 && row.stake > 0 ? row.stake * (shuffledPrices[index] / 10) : 0
      ));
      priceRois.push(stake > 0 ? (returned - stake) / stake : 0);
    }
  }
  labelScores.sort((left, right) => left - right);
  priceRois.sort((left, right) => left - right);
  const labelMedian = percentile(labelScores, 0.5);
  const priceMedian = percentile(priceRois, 0.5);
  return {
    iterations,
    labelPermutation: {
      actualBrier,
      placeboMedianBrier: roundOrNull(labelMedian, 6),
      pass: Number.isFinite(actualBrier) && Number.isFinite(labelMedian) && actualBrier < labelMedian,
    },
    pricePermutation: {
      actualRoi,
      placeboMedianRoi: roundOrNull(priceMedian, 6),
      pass: Number.isFinite(actualRoi) && Number.isFinite(priceMedian) && actualRoi > priceMedian,
    },
  };
}

function unavailablePlacebo(iterations) {
  return {
    iterations,
    labelPermutation: { actualBrier: null, placeboMedianBrier: null, pass: false },
    pricePermutation: { actualRoi: null, placeboMedianRoi: null, pass: false },
  };
}

function validateCohort(cohort) {
  if (!cohort || cohort.version !== 'identical-prospective-cohort-v1' || !Array.isArray(cohort.lines)) {
    throw new Error('evaluateProspectiveCandidates requires an identical prospective cohort');
  }
}

function canonicalPool(value) {
  const compact = String(value ?? '').trim().toUpperCase().replaceAll(/[^A-Z]/g, '');
  if (compact === 'WIN') return 'WIN';
  if (['PLA', 'PLACE'].includes(compact)) return 'PLA';
  if (['QIN', 'QUINELLA'].includes(compact)) return 'QIN';
  if (['QPL', 'QUINELLAPLACE'].includes(compact)) return 'QPL';
  return null;
}

function uniquePools(values) {
  const pools = unique((Array.isArray(values) ? values : []).map(canonicalPool).filter(Boolean));
  if (pools.length === 0) throw new Error('pools must include at least one supported pool');
  return pools;
}

function uniqueText(values, label) {
  const result = unique((Array.isArray(values) ? values : []).map(text).filter(Boolean));
  if (result.length === 0) throw new Error(`${label} must not be empty`);
  return result;
}

function inferDate(raceId) {
  return String(raceId ?? '').match(/^(\d{4}-\d{2}-\d{2})-/)?.[1] ?? null;
}

function inferMeeting(lock) {
  const date = text(lock.date) ?? inferDate(lock.raceId) ?? 'UNKNOWN';
  const course = text(lock.racecourse)?.toUpperCase()
    ?? String(lock.raceId ?? '').match(/^\d{4}-\d{2}-\d{2}-([A-Za-z]+)-R\d+$/)?.[1]?.toUpperCase()
    ?? 'UNKNOWN';
  return `${date}-${course}`;
}

function normalizeDate(value, label) {
  const match = String(value ?? '').trim().match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match || !Number.isFinite(Date.parse(`${match[1]}T00:00:00Z`))) {
    throw new Error(`${label} must be a valid YYYY-MM-DD date`);
  }
  return match[1];
}

function normalizeOptionalTimestamp(value) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function racePoolKey(line) {
  return `${line.raceId}|${line.pool}`;
}

function compareLines(left, right) {
  return String(left.generatedAt ?? '').localeCompare(String(right.generatedAt ?? ''))
    || left.raceId.localeCompare(right.raceId)
    || left.pool.localeCompare(right.pool)
    || left.modelId.localeCompare(right.modelId)
    || String(left.lockId ?? '').localeCompare(String(right.lockId ?? ''));
}

function groupBy(values, selector) {
  const groups = new Map();
  for (const value of values) {
    const key = selector(value);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(value);
  }
  return groups;
}

function percentile(sortedValues, quantile) {
  if (sortedValues.length === 0) return null;
  const index = (sortedValues.length - 1) * quantile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (index - lower);
}

function shuffled(values, random) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeSeed(value) {
  const number = Number(value);
  if (!Number.isInteger(number)) throw new Error('bootstrapSeed must be an integer');
  return number;
}

function normalizeIterations(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 100 || number > 10000) {
    throw new Error('bootstrapIterations must be an integer between 100 and 10000');
  }
  return number;
}

function clampProbability(value) {
  return Math.min(0.999999, Math.max(0.000001, Number(value)));
}

function probabilityNumber(value) {
  const number = finiteNumber(value);
  return number != null && number >= 0 && number <= 1 ? number : null;
}

function nonNegativeNumber(value) {
  const number = finiteNumber(value);
  return number != null && number >= 0 ? number : null;
}

function positiveNumber(value) {
  const number = finiteNumber(value);
  return number != null && number > 0 ? number : null;
}

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function mean(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function sum(values, selector) {
  return values.reduce((total, value, index) => total + Number(selector(value, index) ?? 0), 0);
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function unique(values) {
  return [...new Set(values)];
}

function roundOrNull(value, digits) {
  return Number.isFinite(value) ? round(value, digits) : null;
}

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}
