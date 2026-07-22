import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  attachProspectiveEvaluation,
  buildModelLeaderboard,
  scoreProbabilityRows,
} from '../src/model-leaderboard.js';

describe('model leaderboard', () => {
  it('scores probability quality by split', () => {
    const scored = scoreProbabilityRows([
      prediction('r1', 'train', 0.8, 1),
      prediction('r1', 'train', 0.2, 0),
      prediction('r2', 'validation', 0.7, 0),
      prediction('r2', 'validation', 0.3, 1),
      prediction('r3', 'holdout', 0.6, 1),
      prediction('r3', 'holdout', 0.4, 0),
    ]);

    assert.equal(scored.overall.rows, 6);
    assert.equal(scored.bySplit.train.rows, 2);
    assert.equal(scored.bySplit.validation.rows, 2);
    assert.equal(scored.bySplit.holdout.rows, 2);
    assert.equal(scored.bySplit.train.topPickWins, 1);
    assert.equal(scored.bySplit.validation.topPickWins, 0);
    assert.equal(scored.bySplit.holdout.topPickWins, 1);
    assert.equal(scored.bySplit.train.brierScore < scored.bySplit.validation.brierScore, true);
  });

  it('builds a leaderboard sorted by holdout then validation log loss', () => {
    const leaderboard = buildModelLeaderboard([
      {
        modelId: 'weak',
        label: 'Weak',
        rows: [
          prediction('r1', 'validation', 0.51, 1),
          prediction('r2', 'holdout', 0.51, 0),
        ],
      },
      {
        modelId: 'strong',
        label: 'Strong',
        rows: [
          prediction('r1', 'validation', 0.8, 1),
          prediction('r2', 'holdout', 0.2, 0),
        ],
      },
    ]);

    assert.equal(leaderboard.models[0].modelId, 'strong');
    assert.equal(leaderboard.models[0].status, 'candidate');
    assert.equal(leaderboard.models[1].status, 'baseline');
  });

  it('attaches common-cohort prospective metrics without promoting cash mode', () => {
    const leaderboard = buildModelLeaderboard([{
      modelId: 'model-a',
      label: 'Model A',
      rows: [prediction('r1', 'holdout', 0.7, 1)],
    }]);
    const result = attachProspectiveEvaluation(leaderboard, {
      cohort: { summary: { races: 20 }, exclusions: { nonCommonLines: 2 } },
      models: [{ modelId: 'model-a', metrics: { roi: 0.04 } }],
    });

    assert.equal(result.models[0].prospective.metrics.roi, 0.04);
    assert.equal(result.prospective.commonCohortRaces, 20);
    assert.equal(result.cashMode, 'NO_BET');
  });
});

function prediction(raceId, split, probability, targetWin) {
  return {
    raceId,
    split,
    horseId: `${raceId}-${probability}`,
    probability,
    targetWin,
  };
}
