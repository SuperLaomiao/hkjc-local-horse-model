import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  advanceProspectivePromotion,
  evaluatePoolPromotion,
} from '../src/prospective-promotion.js';

describe('prospective pool promotion state machine', () => {
  it('keeps NO_BET for every failed evidence gate', () => {
    const cases = [
      ['sample-size', (value) => { value.models[0].byPool.WIN.races = 20; }],
      ['roi-lower-bound', (value) => { value.models[0].byPool.WIN.bootstrap.roi.lower = -0.01; }],
      ['clv', (value) => { value.models[0].byPool.WIN.averageClv = -0.01; }],
      ['calibration', (value) => { value.models[0].byPool.WIN.calibrationError = 0.2; }],
      ['calibration', (value) => { value.models[0].byPool.WIN.calibrationError = null; }],
      ['drawdown', (value) => { value.models[0].byPool.WIN.risk.maxDrawdownPct = 0.5; }],
      ['drawdown', (value) => { value.models[0].byPool.WIN.risk.maxDrawdownPct = null; }],
      ['stability', (value) => { value.models[0].byPool.WIN.stability.positiveMeetingRate = 0.3; }],
      ['concentration', (value) => { value.models[0].byPool.WIN.returnConcentration = 0.7; }],
      ['concentration', (value) => { value.models[0].byPool.WIN.returnConcentration = null; }],
      ['placebo', (value) => { value.models[0].byPool.WIN.placebo.labelPermutation.pass = false; }],
      ['fresh-cohort', (value) => { value.cohort.fresh = false; }],
      ['lineage', (value) => { value.models[0].artifactIds = []; }],
      ['lineage', (value) => { value.models[0].artifactIds.push('sha256:mixed-version'); }],
      ['lineage', (value) => { value.models[0].calibrationMethods = []; }],
    ];

    for (const [gateId, mutate] of cases) {
      const evaluation = passingEvaluation();
      mutate(evaluation);
      const result = evaluatePoolPromotion({
        evaluation,
        coverageGate: { status: 'READY' },
        modelId: 'model-a',
        pool: 'WIN',
      });
      assert.equal(result.state, 'NO_GO', gateId);
      assert.equal(result.cashMode, 'NO_BET', gateId);
      assert(result.failedGates.some((gate) => gate.id === gateId), gateId);
    }
  });

  it('blocks on missing coverage and sends a passing candidate only to manual review', () => {
    const blocked = evaluatePoolPromotion({
      evaluation: passingEvaluation(),
      coverageGate: { status: 'BLOCKED_DATA', deficits: [{ metric: 'races' }] },
      modelId: 'model-a',
      pool: 'WIN',
    });
    assert.equal(blocked.state, 'BLOCKED_DATA');
    assert.equal(blocked.cashMode, 'NO_BET');
    assert.deepEqual(blocked.lineage.artifactIds, ['sha256:model-a']);

    const passing = evaluatePoolPromotion({
      evaluation: passingEvaluation(),
      coverageGate: { status: 'READY' },
      modelId: 'model-a',
      pool: 'WIN',
    });
    assert.equal(passing.state, 'REVIEW_REQUIRED');
    assert.deepEqual(passing.transitions, [
      'BLOCKED_DATA->RESEARCH_CHAMPION',
      'RESEARCH_CHAMPION->REVIEW_REQUIRED',
    ]);
    assert.equal(passing.cashMode, 'NO_BET');
    assert.equal(passing.executionStatus, 'PAPER_ONLY');
    assert.equal(passing.gateVersion, 'prospective-promotion-v1');
    assert.equal(passing.lineage.modelId, 'model-a');
    assert.deepEqual(passing.lineage.artifactIds, ['sha256:model-a']);
    assert.deepEqual(passing.lineage.calibrationMethods, ['sigmoid-v1']);
    assert.deepEqual(passing.lineage.trainingCutoffs, ['2026-06-30']);

    const approved = advanceProspectivePromotion({
      promotion: passing,
      to: 'APPROVED_CANDIDATE',
      manualReview: { reviewedBy: 'owner', reviewedAt: '2026-08-01T10:00:00Z' },
    });
    assert.equal(approved.state, 'APPROVED_CANDIDATE');
    assert.equal(approved.cashMode, 'NO_BET');
    assert.throws(
      () => advanceProspectivePromotion({ promotion: approved, to: 'PLAY' }),
      /transition is not allowed/,
    );
  });

  it('normalizes PLACE to PLA and rejects unsupported pools', () => {
    const evaluation = passingEvaluation();
    evaluation.models[0].byPool.PLA = structuredClone(evaluation.models[0].byPool.WIN);
    const result = evaluatePoolPromotion({
      evaluation,
      coverageGate: { status: 'READY' },
      modelId: 'model-a',
      pool: 'PLACE',
    });

    assert.equal(result.pool, 'PLA');
    assert.equal(result.state, 'REVIEW_REQUIRED');
    assert.throws(
      () => evaluatePoolPromotion({
        evaluation,
        coverageGate: { status: 'READY' },
        modelId: 'model-a',
        pool: 'TRIO',
      }),
      /supported pool/,
    );
  });
});

function passingEvaluation() {
  return {
    cohort: {
      freezeDate: '2026-07-20',
      dateRange: { from: '2026-07-22', to: '2026-09-30' },
      fresh: true,
    },
    models: [{
      modelId: 'model-a',
      artifactIds: ['sha256:model-a'],
      featurePolicyIds: ['frozen-policy-v1'],
      calibrationMethods: ['sigmoid-v1'],
      trainingCutoffs: ['2026-06-30'],
      byPool: {
        WIN: {
          races: 120,
          lines: 150,
          roi: 0.08,
          averageClv: 0.03,
          calibrationError: 0.03,
          bootstrap: { roi: { lower: 0.02, upper: 0.14 } },
          risk: { maxDrawdownPct: 0.15 },
          stability: { positiveMeetingRate: 0.65 },
          returnConcentration: 0.18,
          placebo: {
            labelPermutation: { pass: true },
            pricePermutation: { pass: true },
          },
        },
      },
    }],
  };
}
