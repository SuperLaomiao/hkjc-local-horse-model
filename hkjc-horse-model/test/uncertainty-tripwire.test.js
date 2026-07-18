import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyUncertaintyToStake,
  buildRecentConfidenceBaseline,
  evaluateUncertaintyTripwire,
} from '../src/uncertainty-tripwire.js';

describe('uncertainty tripwire', () => {
  it('downgrades to paper mode when model disagreement is high', () => {
    const result = evaluateUncertaintyTripwire({
      marketAvailable: true,
      probabilityStatus: 'CALIBRATED',
      modelProbabilities: [0.42, 0.18, 0.37],
      calibrationDrift: 0.01,
    });

    assert.equal(result.status, 'PAPER');
    assert.equal(result.stakeMultiplier, 0);
    assert(result.reasonCodes.includes('HIGH_MODEL_DISAGREEMENT'));
    assert.match(result.summaryZh, /模型分歧/);
  });

  it('fails closed when no verifiable live market is available', () => {
    const result = evaluateUncertaintyTripwire({
      marketAvailable: false,
      probabilityStatus: 'CALIBRATED',
      modelProbabilities: [0.31, 0.30, 0.29],
      calibrationDrift: 0.01,
    });

    assert.equal(result.status, 'PAPER');
    assert.equal(result.stakeMultiplier, 0);
    assert.equal(result.uncertaintyScore, 1);
    assert(result.reasonCodes.includes('MISSING_LIVE_MARKET'));
    assert.equal(applyUncertaintyToStake(30, result, 10), 0);
  });

  it('passes normal calibrated agreement without reducing stake', () => {
    const result = evaluateUncertaintyTripwire({
      marketAvailable: true,
      probabilityStatus: 'CALIBRATED',
      modelProbabilities: [0.31, 0.30, 0.29],
      calibrationDrift: 0.01,
      confidenceBaseline: {
        recent: 0.31,
        mean: 0.30,
        standardDeviation: 0.03,
        sampleSize: 90,
      },
    });

    assert.equal(result.status, 'PASS');
    assert.equal(result.stakeMultiplier, 1);
    assert.deepEqual(result.reasonCodes, []);
    assert.equal(applyUncertaintyToStake(30, result, 10), 30);
    assert(result.uncertaintyScore < 0.5);
  });

  it('reduces stake for moderate calibration drift and keeps valid HKJC units', () => {
    const result = evaluateUncertaintyTripwire({
      marketAvailable: true,
      probabilityStatus: 'CALIBRATED',
      modelProbabilities: [0.33, 0.28, 0.30],
      calibrationDrift: 0.035,
    });

    assert.equal(result.status, 'REDUCE');
    assert.equal(result.stakeMultiplier, 0.5);
    assert(result.reasonCodes.includes('CALIBRATION_DRIFT'));
    assert.equal(applyUncertaintyToStake(30, result, 10), 10);
    assert.equal(applyUncertaintyToStake(10, result, 10), 0);
  });

  it('builds the 90-day baseline only from earlier settled forecasts', () => {
    const baseline = buildRecentConfidenceBaseline([
      confidenceEntry('past-1', '2026-07-01T10:00:00.000Z', 0.28, true),
      confidenceEntry('past-2', '2026-07-10T10:00:00.000Z', 0.32, true),
      confidenceEntry('unsettled', '2026-07-12T10:00:00.000Z', 0.9, false),
      confidenceEntry('future', '2026-07-19T10:00:00.000Z', 0.8, true),
      confidenceEntry('too-old', '2026-03-01T10:00:00.000Z', 0.7, true),
    ], {
      currentProbability: 0.31,
      asOf: '2026-07-18T10:00:00.000Z',
      excludeRaceId: 'current',
    });

    assert.equal(baseline.sampleSize, 2);
    assert.equal(baseline.recent, 0.31);
    assert.equal(baseline.mean, 0.3);
    assert.equal(baseline.standardDeviation, 0.02);
    assert.equal(baseline.lookbackDays, 90);
  });

  it('does not silently skip a confidence anomaly when baseline variance is zero', () => {
    const result = evaluateUncertaintyTripwire({
      marketAvailable: true,
      probabilityStatus: 'CALIBRATED',
      confidenceBaseline: {
        recent: 0.36,
        mean: 0.30,
        standardDeviation: 0,
        sampleSize: 30,
      },
    });

    assert.equal(result.status, 'REDUCE');
    assert(result.reasonCodes.includes('ABNORMALLY_HIGH_CONFIDENCE'));
  });
});

function confidenceEntry(raceId, generatedAt, probability, settled) {
  return {
    raceId,
    settlement: settled ? { status: 'SETTLED' } : null,
    forecast: {
      generatedAt,
      topPick: { probability },
      predictions: [{ probability }],
    },
  };
}
