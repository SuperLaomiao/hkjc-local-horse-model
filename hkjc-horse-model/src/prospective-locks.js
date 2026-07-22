import { createHash } from 'node:crypto';

import { validateProbabilityArtifact } from './probability-artifact.js';
import { settleLineFromOfficialDividends } from './recommendation-audit.js';
import { evaluateValueCandidate } from './value-betting-engine.js';
import {
  recordProspectiveLock as storeRecordProspectiveLock,
  settleProspectiveLock as storeSettleProspectiveLock,
} from './sqlite-store.js';

const SUPPORTED_MARKET_WINDOWS = new Set(['T-30', 'T-10', 'T-3']);
const POOL_ARITY = new Map([
  ['win', 1],
  ['place', 1],
  ['quinella', 2],
  ['quinellaPlace', 2],
]);
const MARKET_WINDOWS = new Map([
  ['T-30', { min: 21, max: 45, target: 30 }],
  ['T-10', { min: 6, max: 20, target: 10 }],
  ['T-3', { min: 0, max: 5, target: 3 }],
]);

export function buildProspectiveLocks({
  race,
  scoreBundles = [],
  marketSnapshots = [],
  decisions = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!race || typeof race !== 'object' || Array.isArray(race)) {
    throw new Error('race must be an object');
  }
  const raceId = requiredText(race.raceId, 'race.raceId');
  const normalizedGeneratedAt = normalizeTimestamp(generatedAt, 'generatedAt');
  const postAt = racePostAt(race);
  if (Date.parse(normalizedGeneratedAt) >= Date.parse(postAt)) {
    throw new Error('generatedAt must be before race post time');
  }
  const bundles = normalizeScoreBundles(scoreBundles).map((bundle) => (
    validateProbabilityArtifact(bundle, { raceId, postAt })
  ));

  return decisions.map((decision, index) => {
    if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
      throw new Error(`decisions[${index}] must be an object`);
    }
    const cashStake = Number(decision.cashStake ?? 0);
    if (!Number.isFinite(cashStake) || cashStake !== 0) {
      throw new Error(`decisions[${index}].cashStake must remain zero`);
    }
    const pool = canonicalPoolLabel(normalizeSupportedPoolKey(decision.pool), decision.pool);
    const poolKey = normalizeSupportedPoolKey(pool);
    const combination = normalizeCombination(decision.combination);
    validateCombinationForPool(combination, poolKey, pool);
    const marketWindow = normalizeMarketWindow(decision.marketWindow);
    assertGeneratedInMarketWindow({ generatedAt: normalizedGeneratedAt, postAt, marketWindow });
    const bundle = selectScoreBundle(bundles, decision.modelId);
    const rawProbability = resolveDecisionProbability({ decision, bundle, race, poolKey, combination });
    const conservativeProbability = decision.conservativeProbability == null
      ? round(rawProbability * 0.95, 12)
      : finiteProbability(
        decision.conservativeProbability,
        `decisions[${index}].conservativeProbability`,
      );
    const market = selectMarketSnapshot({
      marketSnapshots,
      raceId,
      poolKey,
      combination,
      marketWindow,
      generatedAt: normalizedGeneratedAt,
      postAt,
    });
    const currentDividendPer10 = marketDividendPer10(market);
    const valueDecision = evaluateValueCandidate({
      pool,
      probability: rawProbability,
      conservativeProbability,
      dividendPer10: currentDividendPer10,
      capturedAt: market.capturedAt,
      evaluatedAt: normalizedGeneratedAt,
      sellStatus: market.sellStatus,
      safetyBuffer: decision.safetyBuffer == null ? 0.08 : Number(decision.safetyBuffer),
      maxAgeMinutes: marketWindowMaxAge(marketWindow),
      probabilityStatus: 'RESEARCH_ONLY',
    });
    if (!Number.isFinite(valueDecision.fairDividendPer10)
      || !Number.isFinite(valueDecision.requiredDividendPer10)) {
      throw new Error(`decisions[${index}] could not be priced`);
    }
    const paperStake = valueDecision.hypotheticalStatus === 'PLAY'
      ? nonNegativeNumber(decision.paperStake ?? decision.stake ?? 10, `decisions[${index}].paperStake`)
      : 0;
    const reasonCodes = [...new Set([
      ...normalizeReasonCodes(decision.reasonCodes, `decisions[${index}].reasonCodes`),
      valueDecision.reasonCode,
    ].filter(Boolean))];
    const lineage = prospectiveLineage({ decision, bundle, index });

    return normalizeProspectiveLock({
      raceId,
      marketWindow,
      pool,
      combination,
      modelId: lineage.modelId,
      artifactId: lineage.artifactId,
      featurePolicyId: lineage.featurePolicyId,
      generatedAt: normalizedGeneratedAt,
      decision: {
        executionStatus: 'PAPER_ONLY',
        rawProbability,
        conservativeProbability,
        fairDividendPer10: valueDecision.fairDividendPer10,
        requiredDividendPer10: valueDecision.requiredDividendPer10,
        currentDividendPer10,
        marketCapturedAt: market.capturedAt,
        sellStatus: market.sellStatus,
        reasonCodes,
        stake: paperStake,
      },
      lineage,
    });
  });
}

export function buildProspectiveLockId(lock) {
  const identity = normalizeProspectiveLockIdentity(lock);
  return `sha256:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
}

export function recordProspectiveLock({ dbPath, lock }) {
  const normalized = normalizeProspectiveLock(lock);
  return storeRecordProspectiveLock({ dbPath, lock: normalized });
}

export function settleProspectiveLock({ dbPath, lockId, settlement }) {
  return storeSettleProspectiveLock({
    dbPath,
    lockId: requiredText(lockId, 'lockId'),
    settlement: normalizeSettlement(settlement),
  });
}

export function settleProspectiveLocks({ locks, race, marketSnapshots = [] }) {
  const normalizedLocks = Array.isArray(locks) ? locks : [];
  if (!race || typeof race !== 'object' || Array.isArray(race)) {
    throw new Error('race must be an object');
  }
  if (!['settled', 'void', 'abandoned'].includes(String(race.status ?? '').toLowerCase())) {
    throw new Error('race must be settled before prospective locks can be settled');
  }

  const lines = normalizedLocks.map((lock) => {
    const normalized = normalizeProspectiveLock(lock);
    if (normalized.raceId !== race.raceId) {
      throw new Error(`lock raceId does not match official raceId: ${normalized.raceId}`);
    }
    if (isVoidedPool(race, normalized.poolKey)) {
      return addClosingPriceAudit({
        lockId: normalized.lockId,
        raceId: normalized.raceId,
        poolKey: normalized.poolKey,
        combination: normalized.combination,
        stake: normalized.decision.stake,
        dividendPer10: 10,
        returned: normalized.decision.stake,
        profit: 0,
        status: 'VOID',
      }, normalized, marketSnapshots, race);
    }
    if (!Array.isArray(race.dividends?.[normalized.poolKey])
      || race.dividends[normalized.poolKey].length === 0) {
      throw new Error(`official ${normalized.pool} dividends are missing`);
    }
    const settlement = settleLineFromOfficialDividends({
      pool: normalized.pool,
      combination: normalized.combination,
      stake: normalized.decision.stake,
      dividends: race.dividends,
    });
    return addClosingPriceAudit({
      lockId: normalized.lockId,
      raceId: normalized.raceId,
      poolKey: settlement.poolKey,
      combination: settlement.combination,
      stake: normalized.decision.stake,
      dividendPer10: settlement.dividendPer10,
      returned: settlement.returned,
      profit: settlement.profit,
      status: settlement.status,
    }, normalized, marketSnapshots, race);
  });

  return {
    status: lines.length > 0 && lines.every((line) => line.status === 'VOID') ? 'VOID' : 'SETTLED',
    lines,
  };
}

export function summarizeProspectiveLocks(locks = []) {
  const rows = Array.isArray(locks) ? locks : [];
  const settled = rows
    .filter((lock) => ['SETTLED', 'VOID'].includes(String(lock.status ?? '').toUpperCase())
      && lock.settlement)
    .sort((left, right) => (
      Date.parse(left.generatedAt ?? '') - Date.parse(right.generatedAt ?? '')
      || String(left.lockId ?? '').localeCompare(String(right.lockId ?? ''))
    ));
  const outcomes = settled.map((lock) => ({
    outcome: String(lock.settlement.outcome ?? (lock.status === 'VOID' ? 'VOID' : '')).toUpperCase(),
    stake: Number(lock.settlement.stake ?? lock.decision?.stake ?? 0),
    returned: Number(lock.settlement.returned ?? 0),
    profit: Number(lock.settlement.profit ?? 0),
    indicativeClv: nullableFiniteNumber(lock.settlement.indicativeClv),
  }));
  const paperOutcomes = outcomes.filter((line) => line.stake > 0);
  const paperStake = round(sum(paperOutcomes, (line) => line.stake), 2);
  const paperReturned = round(sum(paperOutcomes, (line) => line.returned), 2);
  const paperProfit = round(sum(paperOutcomes, (line) => line.profit), 2);
  const hits = outcomes.filter((line) => line.outcome === 'HIT').length;
  const misses = outcomes.filter((line) => line.outcome === 'MISS').length;
  const voids = outcomes.filter((line) => line.outcome === 'VOID').length;
  const clv = outcomes.map((line) => line.indicativeClv).filter(Number.isFinite);

  return {
    shadow: {
      locks: rows.length,
      open: rows.filter((lock) => String(lock.status ?? 'OPEN').toUpperCase() === 'OPEN').length,
      settled: settled.length,
      hits,
      misses,
      voids,
      hitRate: hits + misses > 0 ? round(hits / (hits + misses), 4) : null,
      clvLines: clv.length,
      averageIndicativeClv: clv.length > 0 ? round(sum(clv, (value) => value) / clv.length, 4) : null,
      executionStatus: 'SHADOW',
    },
    paper: {
      lines: paperOutcomes.length,
      stake: paperStake,
      returned: paperReturned,
      profit: paperProfit,
      roi: paperStake > 0 ? round(paperProfit / paperStake, 4) : null,
      maxDrawdown: maxDrawdown(paperOutcomes),
      longestLosingRun: longestLosingRun(paperOutcomes),
      executionStatus: 'PAPER_ONLY',
    },
    cash: {
      lines: 0,
      stake: 0,
      returned: 0,
      profit: 0,
      roi: null,
      maxDrawdown: 0,
      longestLosingRun: 0,
      executionStatus: 'NO_BET',
    },
  };
}

export function normalizeProspectiveLock(lock) {
  if (!lock || typeof lock !== 'object' || Array.isArray(lock)) {
    throw new Error('prospective lock must be an object');
  }

  const raceId = requiredText(lock.raceId, 'lock.raceId');
  const marketWindow = normalizeMarketWindow(lock.marketWindow);
  const pool = requiredText(lock.pool, 'lock.pool');
  const poolKey = normalizeSupportedPoolKey(pool);
  const combination = normalizeCombination(lock.combination);
  validateCombinationForPool(combination, poolKey, pool);

  const modelId = requiredText(lock.modelId ?? lock.lineage?.modelId, 'lock.modelId');
  const artifactId = requiredText(lock.artifactId ?? lock.lineage?.artifactId, 'lock.artifactId');
  const featurePolicyId = requiredText(
    lock.featurePolicyId ?? lock.lineage?.featurePolicyId,
    'lock.featurePolicyId',
  );
  const generatedAt = normalizeTimestamp(lock.generatedAt, 'lock.generatedAt');
  const decision = normalizeDecision(lock.decision, { generatedAt });
  const lineage = normalizeLineage(lock.lineage, {
    modelId,
    artifactId,
    featurePolicyId,
  });
  const identity = {
    raceId,
    marketWindow,
    poolKey,
    combination: normalizedCombinationForPool(combination, poolKey),
    modelId,
    artifactId,
    featurePolicyId,
    generatedAt,
  };
  const immutablePayload = {
    ...identity,
    pool,
    decision,
    lineage,
  };

  return {
    lockId: buildProspectiveLockId(identity),
    raceId,
    marketWindow,
    poolKey,
    pool,
    combination: identity.combination,
    combinationKey: combinationKey(identity.combination, poolKey),
    modelId,
    artifactId,
    featurePolicyId,
    generatedAt,
    decision,
    lineage,
    immutablePayload,
    immutablePayloadJson: JSON.stringify(immutablePayload),
    createdAt: normalizeTimestamp(lock.createdAt ?? new Date().toISOString(), 'lock.createdAt'),
  };
}

function normalizeProspectiveLockIdentity(lock) {
  const raceId = requiredText(lock.raceId, 'lock.raceId');
  const marketWindow = normalizeMarketWindow(lock.marketWindow);
  const pool = requiredText(lock.pool ?? lock.poolKey, 'lock.pool');
  const poolKey = normalizeSupportedPoolKey(pool);
  const combination = normalizeCombination(lock.combination);
  validateCombinationForPool(combination, poolKey, pool);
  return {
    raceId,
    marketWindow,
    poolKey,
    combination: normalizedCombinationForPool(combination, poolKey),
    modelId: requiredText(lock.modelId ?? lock.lineage?.modelId, 'lock.modelId'),
    artifactId: requiredText(lock.artifactId ?? lock.lineage?.artifactId, 'lock.artifactId'),
    featurePolicyId: requiredText(lock.featurePolicyId ?? lock.lineage?.featurePolicyId, 'lock.featurePolicyId'),
    generatedAt: normalizeTimestamp(lock.generatedAt, 'lock.generatedAt'),
  };
}

function normalizeDecision(decision, { generatedAt }) {
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
    throw new Error('lock.decision must be an object');
  }
  const executionStatus = requiredText(decision.executionStatus, 'lock.decision.executionStatus');
  if (executionStatus !== 'PAPER_ONLY') {
    throw new Error('lock.decision.executionStatus must remain PAPER_ONLY');
  }
  const reasonCodes = Array.isArray(decision.reasonCodes)
    ? decision.reasonCodes.map((value, index) => requiredText(value, `lock.decision.reasonCodes[${index}]`))
    : [];
  if (reasonCodes.length === 0) {
    throw new Error('lock.decision.reasonCodes must include at least one reason code');
  }
  const rawProbability = finiteProbability(decision.rawProbability, 'lock.decision.rawProbability');
  const conservativeProbability = finiteProbability(
    decision.conservativeProbability,
    'lock.decision.conservativeProbability',
  );
  if (conservativeProbability > rawProbability) {
    throw new Error('lock.decision.conservativeProbability must not exceed rawProbability');
  }
  const fairDividendPer10 = positiveNumber(decision.fairDividendPer10, 'lock.decision.fairDividendPer10');
  if (Math.abs(fairDividendPer10 - (10 / rawProbability)) > 0.011) {
    throw new Error('lock.decision.fairDividendPer10 must equal 10 divided by rawProbability');
  }
  const requiredDividendPer10 = positiveNumber(
    decision.requiredDividendPer10,
    'lock.decision.requiredDividendPer10',
  );
  if (requiredDividendPer10 < fairDividendPer10) {
    throw new Error('lock.decision.requiredDividendPer10 must not be below fairDividendPer10');
  }
  const marketCapturedAt = normalizeTimestamp(decision.marketCapturedAt, 'lock.decision.marketCapturedAt');
  if (Date.parse(marketCapturedAt) > Date.parse(generatedAt)) {
    throw new Error('lock.decision.marketCapturedAt must not be after generatedAt');
  }
  const sellStatus = requiredText(decision.sellStatus, 'lock.decision.sellStatus');
  const stake = nonNegativeNumber(decision.stake, 'lock.decision.stake');
  if (stake > 0 && !['SELLING', 'OPEN', 'SALE_OPEN', 'START_SELL', 'START_SELLING'].includes(sellStatus.toUpperCase())) {
    throw new Error('lock.decision.stake must be zero when the market is not selling');
  }
  return {
    executionStatus,
    rawProbability,
    conservativeProbability,
    fairDividendPer10,
    requiredDividendPer10,
    currentDividendPer10: positiveNumber(decision.currentDividendPer10, 'lock.decision.currentDividendPer10'),
    marketCapturedAt,
    sellStatus,
    reasonCodes,
    stake,
  };
}

function normalizeLineage(lineage, fallback) {
  if (!lineage || typeof lineage !== 'object' || Array.isArray(lineage)) {
    throw new Error('lock.lineage must be an object');
  }
  const normalized = {
    modelId: requiredText(lineage.modelId ?? fallback.modelId, 'lock.lineage.modelId'),
    artifactId: requiredText(lineage.artifactId ?? fallback.artifactId, 'lock.lineage.artifactId'),
    featurePolicyId: requiredText(lineage.featurePolicyId ?? fallback.featurePolicyId, 'lock.lineage.featurePolicyId'),
    calibrationMethod: requiredText(lineage.calibrationMethod, 'lock.lineage.calibrationMethod'),
    trainingCutoff: requiredText(lineage.trainingCutoff, 'lock.lineage.trainingCutoff'),
  };
  for (const key of ['modelId', 'artifactId', 'featurePolicyId']) {
    if (normalized[key] !== fallback[key]) {
      throw new Error(`lock.lineage ${key} must match lock ${key}`);
    }
  }
  return normalized;
}

function normalizeSettlement(settlement) {
  if (!settlement || typeof settlement !== 'object' || Array.isArray(settlement)) {
    throw new Error('settlement must be an object');
  }
  const status = requiredText(settlement.status, 'settlement.status');
  if (!['SETTLED', 'VOID'].includes(status)) {
    throw new Error('settlement.status must be SETTLED or VOID');
  }
  const returned = nonNegativeNumber(settlement.returned, 'settlement.returned');
  const profit = finiteNumber(settlement.profit, 'settlement.profit');
  const stake = nonNegativeNumber(
    settlement.stake ?? Math.max(0, returned - profit),
    'settlement.stake',
  );
  const outcome = requiredText(
    settlement.outcome ?? (status === 'VOID' ? 'VOID' : returned > 0 ? 'HIT' : 'MISS'),
    'settlement.outcome',
  ).toUpperCase();
  if (!['HIT', 'MISS', 'VOID'].includes(outcome)) {
    throw new Error('settlement.outcome must be HIT, MISS, or VOID');
  }
  return {
    status,
    outcome,
    settledAt: normalizeTimestamp(settlement.settledAt, 'settlement.settledAt'),
    stake,
    dividendPer10: nullableNonNegativeNumber(settlement.dividendPer10, 'settlement.dividendPer10'),
    returned,
    profit,
    closingDividendPer10: nullablePositiveNumber(
      settlement.closingDividendPer10,
      'settlement.closingDividendPer10',
    ),
    indicativeClv: nullableFiniteNumber(settlement.indicativeClv, 'settlement.indicativeClv'),
    priceSlippageToT3: nullableFiniteNumber(
      settlement.priceSlippageToT3,
      'settlement.priceSlippageToT3',
    ),
    officialDividendChangeFromLock: nullableFiniteNumber(
      settlement.officialDividendChangeFromLock,
      'settlement.officialDividendChangeFromLock',
    ),
  };
}

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeTimestamp(value, label) {
  const text = requiredText(value, label);
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime()) || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(text)) {
    throw new Error(`${label} must be an ISO-8601 timestamp with timezone`);
  }
  return text;
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${label} must be a finite number`);
  }
  return number;
}

function finiteProbability(value, label) {
  const number = finiteNumber(value, label);
  if (number <= 0 || number > 1) {
    throw new Error(`${label} must be between 0 and 1`);
  }
  return number;
}

function positiveNumber(value, label) {
  const number = finiteNumber(value, label);
  if (number <= 0) {
    throw new Error(`${label} must be greater than zero`);
  }
  return number;
}

function nonNegativeNumber(value, label) {
  const number = finiteNumber(value, label);
  if (number < 0) {
    throw new Error(`${label} must be zero or greater`);
  }
  return number;
}

function nullableFiniteNumber(value, label = 'value') {
  if (value == null || value === '') return null;
  return finiteNumber(value, label);
}

function nullablePositiveNumber(value, label) {
  if (value == null || value === '') return null;
  return positiveNumber(value, label);
}

function nullableNonNegativeNumber(value, label) {
  if (value == null || value === '') return null;
  return nonNegativeNumber(value, label);
}

function normalizeCombination(value) {
  if (!Array.isArray(value)) {
    throw new Error('lock.combination must be an array');
  }
  const combination = value.map(Number);
  if (combination.some((number) => !Number.isInteger(number) || number <= 0)) {
    throw new Error('lock.combination runner numbers must be positive integers');
  }
  if (new Set(combination).size !== combination.length) {
    throw new Error('lock.combination runner numbers must be unique');
  }
  return combination;
}

function normalizeMarketWindow(value) {
  const marketWindow = requiredText(value, 'lock.marketWindow').toUpperCase();
  if (!SUPPORTED_MARKET_WINDOWS.has(marketWindow)) {
    throw new Error('lock.marketWindow must be T-30, T-10, or T-3');
  }
  return marketWindow;
}

function validateCombinationForPool(combination, poolKey, pool) {
  const arity = POOL_ARITY.get(poolKey);
  if (combination.length !== arity) {
    throw new Error(`${canonicalPoolLabel(poolKey, pool)} combination must contain exactly ${arity} runner${arity === 1 ? '' : 's'}`);
  }
}

function normalizedCombinationForPool(combination, poolKey) {
  const normalized = [...combination];
  if (poolKey === 'quinella' || poolKey === 'quinellaPlace') {
    normalized.sort((left, right) => left - right);
  }
  return normalized;
}

function combinationKey(combination, poolKey) {
  return normalizedCombinationForPool(combination, poolKey).join(',');
}

function normalizePoolKey(pool) {
  const lower = String(pool).trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, ' ');
  const words = lower.split(/\s+/).filter(Boolean);
  return words
    .map((word, index) => (index === 0 ? word : `${word[0].toUpperCase()}${word.slice(1)}`))
    .join('');
}

function normalizeSupportedPoolKey(pool) {
  const normalized = normalizePoolKey(pool);
  const poolKey = {
    w: 'win',
    win: 'win',
    pla: 'place',
    place: 'place',
    qin: 'quinella',
    quinella: 'quinella',
    qpl: 'quinellaPlace',
    quinellaplace: 'quinellaPlace',
    quinellaPlace: 'quinellaPlace',
  }[normalized];
  if (!POOL_ARITY.has(poolKey)) {
    throw new Error('lock.pool must be WIN, PLACE, QUINELLA, or QUINELLA PLACE');
  }
  return poolKey;
}

function canonicalPoolLabel(poolKey, fallback) {
  return {
    win: 'WIN',
    place: 'PLACE',
    quinella: 'QUINELLA',
    quinellaPlace: 'QUINELLA PLACE',
  }[poolKey] ?? String(fallback).toUpperCase();
}

function normalizeScoreBundles(scoreBundles) {
  if (Array.isArray(scoreBundles)) return scoreBundles;
  if (scoreBundles && typeof scoreBundles === 'object') return [scoreBundles];
  throw new Error('scoreBundles must be an array or object');
}

function selectScoreBundle(bundles, modelId) {
  if (modelId != null) {
    const wanted = requiredText(modelId, 'decision.modelId');
    const match = bundles.find((bundle) => bundle.modelId === wanted);
    if (!match) throw new Error(`score bundle not found for modelId ${wanted}`);
    return match;
  }
  if (bundles.length !== 1) {
    throw new Error('decision.modelId is required when scoreBundles does not contain exactly one bundle');
  }
  return bundles[0];
}

function resolveDecisionProbability({ decision, bundle, race, poolKey, combination }) {
  const explicit = decision.rawProbability ?? decision.probability;
  if (explicit != null) return finiteProbability(explicit, 'decision.rawProbability');
  if (poolKey !== 'win' || combination.length !== 1) {
    throw new Error('decision.rawProbability is required for PLACE, QIN, and QPL locks');
  }
  const runner = (race.runners ?? []).find((item) => Number(item.horseNo) === combination[0]);
  if (!runner) throw new Error(`runner ${combination[0]} is missing from race ${race.raceId}`);
  const runnerIds = new Set([
    runner.horseId,
    runner.runnerId,
    runner.id,
    String(combination[0]),
  ].filter(Boolean).map(String));
  const prediction = bundle.predictions.find((item) => runnerIds.has(String(item.runnerId)));
  if (!prediction) {
    throw new Error(`score bundle has no prediction for runner ${combination[0]}`);
  }
  return finiteProbability(prediction.probability, 'score bundle probability');
}

function prospectiveLineage({ decision, bundle, index }) {
  const supplied = decision.lineage ?? {};
  return {
    modelId: requiredText(decision.modelId ?? supplied.modelId ?? bundle.modelId, `decisions[${index}].modelId`),
    artifactId: requiredText(
      decision.artifactId ?? supplied.artifactId ?? bundle.artifactId,
      `decisions[${index}].artifactId`,
    ),
    featurePolicyId: requiredText(
      decision.featurePolicyId ?? supplied.featurePolicyId ?? bundle.featurePolicyId,
      `decisions[${index}].featurePolicyId`,
    ),
    calibrationMethod: requiredText(
      decision.calibrationMethod ?? supplied.calibrationMethod ?? bundle.calibrationMethod,
      `decisions[${index}].calibrationMethod`,
    ),
    trainingCutoff: requiredText(
      decision.trainingCutoff ?? supplied.trainingCutoff ?? bundle.trainingCutoff,
      `decisions[${index}].trainingCutoff`,
    ),
  };
}

function selectMarketSnapshot({
  marketSnapshots,
  raceId,
  poolKey,
  combination,
  marketWindow,
  generatedAt,
  postAt,
}) {
  if (!Array.isArray(marketSnapshots)) throw new Error('marketSnapshots must be an array');
  const window = MARKET_WINDOWS.get(marketWindow);
  const key = combinationKey(combination, poolKey);
  const candidates = marketSnapshots.filter((snapshot) => {
    const snapshotPoolKey = supportedPoolKeyOrNull(snapshot.pool ?? snapshot.poolKey);
    const snapshotCombination = safeCombination(snapshot.combination);
    const minutesToPost = Number(snapshot.minutesToPost);
    const capturedAt = Date.parse(snapshot.capturedAt ?? '');
    return snapshot.raceId === raceId
      && snapshotPoolKey === poolKey
      && combinationKey(snapshotCombination, poolKey) === key
      && Number.isFinite(minutesToPost)
      && minutesToPost >= window.min
      && minutesToPost <= window.max
      && Number.isFinite(capturedAt)
      && capturedAt <= Date.parse(generatedAt)
      && capturedAt < Date.parse(postAt)
      && marketDividendPer10(snapshot) != null;
  });
  candidates.sort((left, right) => (
    Math.abs(Number(left.minutesToPost) - window.target)
      - Math.abs(Number(right.minutesToPost) - window.target)
    || Date.parse(right.capturedAt) - Date.parse(left.capturedAt)
  ));
  if (!candidates[0]) {
    throw new Error(`no valid ${marketWindow} market snapshot for ${canonicalPoolLabel(poolKey)} ${key}`);
  }
  return candidates[0];
}

function addClosingPriceAudit(line, lock, marketSnapshots, race) {
  const closing = selectClosingSnapshot({ marketSnapshots, lock, race });
  if (!closing) return line;
  const lockedDividend = lock.decision.currentDividendPer10;
  const closingDividend = marketDividendPer10(closing);
  return {
    ...line,
    closingDividendPer10: closingDividend,
    closingCapturedAt: closing.capturedAt,
    indicativeClv: round((lockedDividend / closingDividend) - 1, 4),
    priceSlippageToT3: round((closingDividend / lockedDividend) - 1, 4),
    officialDividendChangeFromLock: line.dividendPer10 == null
      ? null
      : round((line.dividendPer10 / lockedDividend) - 1, 4),
  };
}

function selectClosingSnapshot({ marketSnapshots, lock, race }) {
  if (!Array.isArray(marketSnapshots)) return null;
  const key = combinationKey(lock.combination, lock.poolKey);
  const postAt = racePostAt(race);
  return marketSnapshots
    .filter((snapshot) => (
      snapshot.raceId === lock.raceId
      && supportedPoolKeyOrNull(snapshot.pool ?? snapshot.poolKey) === lock.poolKey
      && combinationKey(safeCombination(snapshot.combination), lock.poolKey) === key
      && Number(snapshot.minutesToPost) >= 0
      && Number(snapshot.minutesToPost) <= 5
      && Date.parse(snapshot.capturedAt ?? '') < Date.parse(postAt)
      && !/(STOP|CLOSE|RESULT|SUSPEND)/.test(String(snapshot.sellStatus ?? '').toUpperCase())
      && marketDividendPer10(snapshot) != null
    ))
    .sort((left, right) => (
      Math.abs(Number(left.minutesToPost) - 3) - Math.abs(Number(right.minutesToPost) - 3)
      || Date.parse(right.capturedAt ?? '') - Date.parse(left.capturedAt ?? '')
    ))[0] ?? null;
}

function marketDividendPer10(snapshot) {
  const direct = Number(snapshot?.dividendPer10);
  if (Number.isFinite(direct) && direct > 0) return round(direct, 2);
  const odds = Number(snapshot?.oddsValue);
  return Number.isFinite(odds) && odds > 0 ? round(odds * 10, 2) : null;
}

function marketWindowMaxAge(marketWindow) {
  return {
    'T-30': 45,
    'T-10': 20,
    'T-3': 5,
  }[marketWindow];
}

function assertGeneratedInMarketWindow({ generatedAt, postAt, marketWindow }) {
  const minutesToPost = (Date.parse(postAt) - Date.parse(generatedAt)) / 60_000;
  const window = MARKET_WINDOWS.get(marketWindow);
  if (minutesToPost < window.min || minutesToPost > window.max) {
    throw new Error(`generatedAt is outside the declared ${marketWindow} window`);
  }
}

function normalizeReasonCodes(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => requiredText(item, `${label}[${index}]`));
}

function safeCombination(value) {
  if (!Array.isArray(value)) return [];
  return value.map(Number).filter((number) => Number.isInteger(number) && number > 0);
}

function supportedPoolKeyOrNull(pool) {
  try {
    return normalizeSupportedPoolKey(pool);
  } catch {
    return null;
  }
}

function racePostAt(race) {
  const date = requiredText(race.date, 'race.date');
  const startTime = requiredText(race.startTime, 'race.startTime');
  if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(startTime)) {
    const time = startTime.length === 5 ? `${startTime}:00` : startTime;
    return normalizeTimestamp(`${date}T${time}+08:00`, 'race post time');
  }
  return normalizeTimestamp(startTime, 'race post time');
}

function isVoidedPool(race, poolKey) {
  if (['void', 'abandoned'].includes(String(race.status ?? '').toLowerCase())) return true;
  return (race.voidPools ?? []).some((pool) => supportedPoolKeyOrNull(pool) === poolKey);
}

function sum(items, selector) {
  return items.reduce((total, item) => total + Number(selector(item) ?? 0), 0);
}

function maxDrawdown(lines) {
  let cumulative = 0;
  let peak = 0;
  let largest = 0;
  for (const line of lines) {
    cumulative += Number(line.profit ?? 0);
    peak = Math.max(peak, cumulative);
    largest = Math.max(largest, peak - cumulative);
  }
  return round(largest, 2);
}

function longestLosingRun(lines) {
  let current = 0;
  let longest = 0;
  for (const line of lines) {
    if (line.outcome === 'MISS') {
      current += 1;
      longest = Math.max(longest, current);
    } else if (line.outcome !== 'VOID') {
      current = 0;
    }
  }
  return longest;
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}
