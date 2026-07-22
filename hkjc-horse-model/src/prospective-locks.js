import { createHash } from 'node:crypto';

import {
  recordProspectiveLock as storeRecordProspectiveLock,
  settleProspectiveLock as storeSettleProspectiveLock,
} from './sqlite-store.js';

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

export function normalizeProspectiveLock(lock) {
  if (!lock || typeof lock !== 'object' || Array.isArray(lock)) {
    throw new Error('prospective lock must be an object');
  }

  const raceId = requiredText(lock.raceId, 'lock.raceId');
  const marketWindow = requiredText(lock.marketWindow, 'lock.marketWindow');
  const pool = requiredText(lock.pool, 'lock.pool');
  const poolKey = normalizePoolKey(pool);
  const combination = normalizeCombination(lock.combination);
  if (!combination.length) {
    throw new Error('lock.combination must include at least one runner number');
  }

  const modelId = requiredText(lock.modelId ?? lock.lineage?.modelId, 'lock.modelId');
  const artifactId = requiredText(lock.artifactId ?? lock.lineage?.artifactId, 'lock.artifactId');
  const featurePolicyId = requiredText(
    lock.featurePolicyId ?? lock.lineage?.featurePolicyId,
    'lock.featurePolicyId',
  );
  const generatedAt = normalizeTimestamp(lock.generatedAt, 'lock.generatedAt');
  const decision = normalizeDecision(lock.decision);
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
  const marketWindow = requiredText(lock.marketWindow, 'lock.marketWindow');
  const poolKey = normalizePoolKey(requiredText(lock.pool ?? lock.poolKey, 'lock.pool'));
  const combination = normalizeCombination(lock.combination);
  if (!combination.length) {
    throw new Error('lock.combination must include at least one runner number');
  }
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

function normalizeDecision(decision) {
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
  return {
    executionStatus,
    rawProbability: finiteNumber(decision.rawProbability, 'lock.decision.rawProbability'),
    conservativeProbability: finiteNumber(decision.conservativeProbability, 'lock.decision.conservativeProbability'),
    fairDividendPer10: finiteNumber(decision.fairDividendPer10, 'lock.decision.fairDividendPer10'),
    requiredDividendPer10: finiteNumber(decision.requiredDividendPer10, 'lock.decision.requiredDividendPer10'),
    currentDividendPer10: finiteNumber(decision.currentDividendPer10, 'lock.decision.currentDividendPer10'),
    marketCapturedAt: normalizeTimestamp(decision.marketCapturedAt, 'lock.decision.marketCapturedAt'),
    sellStatus: requiredText(decision.sellStatus, 'lock.decision.sellStatus'),
    reasonCodes,
    stake: finiteNumber(decision.stake, 'lock.decision.stake'),
  };
}

function normalizeLineage(lineage, fallback) {
  if (!lineage || typeof lineage !== 'object' || Array.isArray(lineage)) {
    throw new Error('lock.lineage must be an object');
  }
  return {
    modelId: requiredText(lineage.modelId ?? fallback.modelId, 'lock.lineage.modelId'),
    artifactId: requiredText(lineage.artifactId ?? fallback.artifactId, 'lock.lineage.artifactId'),
    featurePolicyId: requiredText(lineage.featurePolicyId ?? fallback.featurePolicyId, 'lock.lineage.featurePolicyId'),
    calibrationMethod: requiredText(lineage.calibrationMethod, 'lock.lineage.calibrationMethod'),
    trainingCutoff: requiredText(lineage.trainingCutoff, 'lock.lineage.trainingCutoff'),
  };
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
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`${label} must be an ISO-8601 timestamp`);
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

function normalizeCombination(value) {
  if (!Array.isArray(value)) {
    throw new Error('lock.combination must be an array');
  }
  return value.map(Number).filter(Number.isFinite);
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
