import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildIdenticalProspectiveCohort,
  evaluateProspectiveCandidates,
} from '../src/prospective-evaluation.js';

describe('fresh identical prospective cohort evaluation', () => {
  it('uses only common settled race-pool cells and reports every exclusion', () => {
    const locks = syntheticLocks();
    const cohort = buildIdenticalProspectiveCohort({
      locks,
      modelIds: ['model-a', 'model-b'],
      pools: ['WIN', 'PLA'],
      freeze: '2026-07-20',
    });

    assert.equal(cohort.version, 'identical-prospective-cohort-v1');
    assert.equal(cohort.summary.races, 3);
    assert.equal(cohort.summary.racePoolCells, 6);
    assert.equal(cohort.summary.models, 2);
    assert.equal(cohort.lines.every((line) => line.raceId !== '2026-07-25-ST-R2'), true);
    assert.equal(cohort.exclusions.nonCommonLines, 2);
    assert.equal(cohort.exclusions.nonSettledLines, 1);
    assert.equal(cohort.exclusions.missingByModel['model-b'], 2);
  });

  it('reports deterministic probability, value, risk, stability, bootstrap, and placebo metrics', () => {
    const cohort = buildIdenticalProspectiveCohort({
      locks: syntheticLocks(),
      modelIds: ['model-a', 'model-b'],
      pools: ['WIN', 'PLA'],
      freeze: '2026-07-20',
    });
    const first = evaluateProspectiveCandidates({ cohort, bootstrapSeed: 1701, bootstrapIterations: 200 });
    const second = evaluateProspectiveCandidates({ cohort, bootstrapSeed: 1701, bootstrapIterations: 200 });

    assert.deepEqual(first, second);
    assert.equal(first.version, 'prospective-evaluation-v1');
    assert.equal(first.evaluationPolicy.population, 'LOCKED_RECOMMENDATION_LINES');
    assert.equal(
      first.evaluationPolicy.topPickScope,
      'HIGHEST_PROBABILITY_LOCKED_LINE_PER_RACE_POOL',
    );
    assert.equal(first.models.length, 2);
    const model = first.models.find((item) => item.modelId === 'model-a');
    assert.deepEqual(model.artifactIds, ['sha256:model-a']);
    assert.deepEqual(model.featurePolicyIds, ['frozen-policy-v1']);
    assert.deepEqual(model.calibrationMethods, ['sigmoid-v1']);
    assert.deepEqual(model.trainingCutoffs, ['2026-06-30']);
    assert.equal(model.metrics.races, 3);
    assert.equal(model.metrics.lines, 6);
    assert.equal(Number.isFinite(model.metrics.logLoss), true);
    assert.equal(Number.isFinite(model.metrics.brierScore), true);
    assert.equal(Number.isFinite(model.metrics.calibrationError), true);
    assert.equal(model.metrics.calibrationBuckets.length > 0, true);
    assert.equal(model.metrics.topPickByPool.WIN.races, 3);
    assert.equal(model.metrics.topPickByPool.PLA.races, 3);
    assert.equal(Number.isFinite(model.metrics.averageClv), true);
    assert.equal(Number.isFinite(model.metrics.roi), true);
    assert.equal(Number.isFinite(model.metrics.risk.maxDrawdown), true);
    assert.equal(Number.isFinite(model.metrics.risk.maxDrawdownPct), true);
    assert.equal(Number.isInteger(model.metrics.risk.longestLosingRun), true);
    assert.equal(model.metrics.stability.byMeeting.length, 2);
    assert.equal(model.metrics.stability.byMonth.length, 1);
    assert.equal(Number.isFinite(model.metrics.returnConcentration), true);
    assert.equal(Number.isFinite(model.metrics.bootstrap.roi.lower), true);
    assert.equal(Number.isFinite(model.metrics.bootstrap.roi.upper), true);
    assert.equal(typeof model.metrics.placebo.labelPermutation.pass, 'boolean');
    assert.equal(typeof model.metrics.placebo.pricePermutation.pass, 'boolean');
    assert.equal(first.cohort.exclusions.nonCommonLines, 2);
  });
});

function syntheticLocks() {
  const races = [
    { raceId: '2026-07-22-HV-R1', hit: true, dividend: 22 },
    { raceId: '2026-07-22-HV-R2', hit: false, dividend: 0 },
    { raceId: '2026-07-25-ST-R1', hit: true, dividend: 18 },
  ];
  const locks = [];
  for (const modelId of ['model-a', 'model-b']) {
    for (const race of races) {
      for (const pool of ['WIN', 'PLA']) {
        const probability = modelId === 'model-a' ? (race.hit ? 0.62 : 0.45) : 0.5;
        locks.push(lock({
          modelId,
          raceId: race.raceId,
          pool,
          probability,
          hit: race.hit,
          dividend: race.dividend,
        }));
      }
    }
  }
  for (const pool of ['WIN', 'PLA']) {
    locks.push(lock({
      modelId: 'model-a',
      raceId: '2026-07-25-ST-R2',
      pool,
      probability: 0.7,
      hit: true,
      dividend: 20,
    }));
  }
  locks.push({
    ...lock({
      modelId: 'model-a',
      raceId: '2026-07-25-ST-R3',
      pool: 'WIN',
      probability: 0.5,
      hit: false,
      dividend: 0,
    }),
    lockId: 'open-lock',
    status: 'OPEN',
    settlement: null,
  });
  return locks;
}

function lock({ modelId, raceId, pool, probability, hit, dividend }) {
  const stake = 10;
  const returned = hit ? dividend : 0;
  return {
    lockId: `${modelId}-${raceId}-${pool}`,
    raceId,
    marketWindow: 'T-10',
    pool,
    combination: [1],
    modelId,
    artifactId: `sha256:${modelId}`,
    featurePolicyId: 'frozen-policy-v1',
    calibrationMethod: 'sigmoid-v1',
    trainingCutoff: '2026-06-30',
    generatedAt: `${raceId.slice(0, 10)}T08:00:00Z`,
    decision: {
      rawProbability: probability,
      conservativeProbability: probability - 0.03,
      currentDividendPer10: 18,
      stake,
    },
    status: 'SETTLED',
    settlement: {
      outcome: hit ? 'HIT' : 'MISS',
      stake,
      returned,
      profit: returned - stake,
      indicativeClv: hit ? 0.04 : 0.01,
    },
  };
}
