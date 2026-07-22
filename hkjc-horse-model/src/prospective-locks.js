import { createHash } from 'node:crypto';

import { settleLineFromOfficialDividends } from './recommendation-audit.js';
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

export function settleProspectiveLocks({ locks, race }) {
  const normalizedLocks = Array.isArray(locks) ? locks : [];
  if (!race || typeof race !== 'object' || Array.isArray(race)) {
    throw new Error('race must be an object');
  }
  if (String(race.status ?? '').toLowerCase() !== 'settled') {
    throw new Error('race must be settled before prospective locks can be settled');
  }

  const lines = normalizedLocks.map((lock) => {
    const normalized = normalizeProspectiveLock(lock);
    if (normalized.raceId !== race.raceId) {
      throw new Error(`lock raceId does not match official raceId: ${normalized.raceId}`);
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
    return {
      lockId: normalized.lockId,
      raceId: normalized.raceId,
      poolKey: settlement.poolKey,
      combination: settlement.combination,
      stake: normalized.decision.stake,
      dividendPer10: settlement.dividendPer10,
      returned: settlement.returned,
      profit: settlement.profit,
      status: settlement.status,
    };
  });

  return {
    status: 'SETTLED',
    lines,
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
  return {
    executionStatus,
    rawProbability,
    conservativeProbability,
    fairDividendPer10,
    requiredDividendPer10,
    currentDividendPer10: positiveNumber(decision.currentDividendPer10, 'lock.decision.currentDividendPer10'),
    marketCapturedAt,
    sellStatus: requiredText(decision.sellStatus, 'lock.decision.sellStatus'),
    reasonCodes,
    stake: nonNegativeNumber(decision.stake, 'lock.decision.stake'),
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
  return {
    status,
    settledAt: normalizeTimestamp(settlement.settledAt, 'settlement.settledAt'),
    dividendPer10: finiteNumber(settlement.dividendPer10, 'settlement.dividendPer10'),
    returned: finiteNumber(settlement.returned, 'settlement.returned'),
    profit: finiteNumber(settlement.profit, 'settlement.profit'),
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
  if (number < 0 || number > 1) {
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
