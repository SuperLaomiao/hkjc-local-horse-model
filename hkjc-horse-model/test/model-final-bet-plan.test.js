import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildFinalBetPlan } from '../src/model.js';

const prediction = {
  horseId: 'H8',
  horseNo: 8,
  horseName: '测试马',
  probability: 0.25,
  fairOdds: 4,
  winOdds: 6,
  value: { edge: 0.5, isValue: true },
};

const recommendation = {
  action: 'value',
  horseId: 'H8',
  horseNo: 8,
  horseName: '测试马',
  modelProbability: 0.25,
  fairOdds: 4,
  winOdds: 6,
  suggestedStake: 10,
};

describe('final bet plan value gate', () => {
  it('fails closed when quoted odds have no verifiable capture time', () => {
    const plan = buildFinalBetPlan({}, [prediction], recommendation, {
      probabilityStatus: 'CALIBRATED',
      evaluatedAt: '2026-07-18T10:05:00.000Z',
      sellStatus: 'SELLING',
    });

    assert.notEqual(plan.mode, 'execute');
    assert.equal(plan.plannedStake, 0);
    assert.equal(plan.decision.status, 'NO_BET');
    assert.equal(plan.decision.reasonCode, 'MISSING_CAPTURE_TIME');
  });

  it('executes only a calibrated probability with a fresh selling price and conservative edge', () => {
    const plan = buildFinalBetPlan({}, [prediction], recommendation, {
      probabilityStatus: 'CALIBRATED',
      probabilityArtifactId: 'runner-probability-stack-v1',
      modelId: 'place-stack-v1',
      calibrationMethod: 'isotonic',
      marketCapturedAt: '2026-07-18T10:00:00.000Z',
      evaluatedAt: '2026-07-18T10:05:00.000Z',
      marketWindow: 'T-10',
      marketSource: 'HKJC',
      sellStatus: 'SELLING',
    });

    assert.equal(plan.mode, 'execute');
    assert.equal(plan.plannedStake, 10);
    assert.equal(plan.decision.status, 'PLAY');
    assert.equal(plan.pool, 'WIN');
    assert.deepEqual(plan.combination, [8]);
    assert.equal(plan.probabilityArtifactId, 'runner-probability-stack-v1');
    assert.equal(plan.marketCapturedAt, '2026-07-18T10:00:00.000Z');
    assert.equal(plan.ruleVersion, 'value-betting-v1');
  });

  it('keeps unpromoted probability artifacts in paper mode with zero cash stake', () => {
    const plan = buildFinalBetPlan({}, [prediction], recommendation, {
      probabilityStatus: 'RESEARCH_ONLY',
      marketCapturedAt: '2026-07-18T10:00:00.000Z',
      evaluatedAt: '2026-07-18T10:05:00.000Z',
      sellStatus: 'SELLING',
    });

    assert.equal(plan.mode, 'paper');
    assert.equal(plan.plannedStake, 0);
    assert.equal(plan.decision.status, 'PAPER');
    assert.equal(plan.decision.reasonCode, 'PROBABILITY_NOT_PROMOTED');
  });
});
