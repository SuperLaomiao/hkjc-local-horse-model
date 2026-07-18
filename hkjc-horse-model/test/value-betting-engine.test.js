import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evaluateValueCandidate,
  fairDividendPer10,
  marketFreshness,
  requiredDividendPer10,
} from '../src/value-betting-engine.js';

const base = {
  pool: 'PLACE',
  probability: 0.55,
  conservativeProbability: 0.52,
  dividendPer10: 21,
  capturedAt: '2026-07-18T10:00:00Z',
  evaluatedAt: '2026-07-18T10:05:00Z',
  sellStatus: 'SELLING',
  safetyBuffer: 0.08,
  maxAgeMinutes: 15,
  probabilityStatus: 'CALIBRATED',
};

describe('value betting engine', () => {
  it('plays only when the conservative price clears the safety buffer', () => {
    const decision = evaluateValueCandidate(base);

    assert.equal(decision.fairDividendPer10, 18.18);
    assert.equal(decision.requiredDividendPer10, 20.77);
    assert.equal(decision.status, 'PLAY');
    assert.equal(decision.reasonCode, 'EDGE_CLEARS_BUFFER');
    assert.equal(decision.market.ageMinutes, 5);
    assert.ok(decision.conservativeExpectedRoi > 0);
  });

  it('watches a possible edge that does not clear the conservative buffer', () => {
    const decision = evaluateValueCandidate({ ...base, dividendPer10: 19 });

    assert.equal(decision.status, 'WATCH');
    assert.equal(decision.reasonCode, 'EDGE_BELOW_BUFFER');
  });

  it('rejects an underpriced line with negative central expected value', () => {
    const decision = evaluateValueCandidate({ ...base, dividendPer10: 17 });

    assert.equal(decision.status, 'NO_BET');
    assert.equal(decision.reasonCode, 'NEGATIVE_EDGE');
  });

  it('fails closed for missing, stale, future, or suspended market prices', () => {
    assert.equal(
      evaluateValueCandidate({ ...base, dividendPer10: null }).reasonCode,
      'MISSING_PRICE',
    );
    assert.equal(
      evaluateValueCandidate({ ...base, capturedAt: '2026-07-18T09:00:00Z' }).reasonCode,
      'STALE_PRICE',
    );
    assert.equal(
      evaluateValueCandidate({ ...base, capturedAt: '2026-07-18T10:06:00Z' }).reasonCode,
      'FUTURE_PRICE',
    );
    assert.equal(
      evaluateValueCandidate({ ...base, sellStatus: 'SUSPENDED' }).reasonCode,
      'POOL_NOT_SELLING',
    );
  });

  it('keeps research-only probabilities in paper mode', () => {
    const decision = evaluateValueCandidate({ ...base, probabilityStatus: 'RESEARCH_ONLY' });

    assert.equal(decision.status, 'PAPER');
    assert.equal(decision.reasonCode, 'PROBABILITY_NOT_PROMOTED');
  });

  it('exposes full precision pricing and deterministic freshness helpers', () => {
    assert.equal(fairDividendPer10(0.55), 10 / 0.55);
    assert.equal(requiredDividendPer10(0.52, 0.08), 10 * 1.08 / 0.52);
    assert.deepEqual(marketFreshness({
      capturedAt: '2026-07-18T10:00:00Z',
      evaluatedAt: '2026-07-18T10:05:00Z',
      maxAgeMinutes: 15,
    }), {
      status: 'FRESH',
      ageMinutes: 5,
      maxAgeMinutes: 15,
    });
  });
});
