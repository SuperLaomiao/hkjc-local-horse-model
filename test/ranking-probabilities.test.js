import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createRankingProbabilityModel,
} from '../ranking-probabilities.js';

describe('ranking probability model', () => {
  it('normalizes win probabilities and conserves top-k probability mass', () => {
    const model = createRankingProbabilityModel([
      runner('A', 0.4),
      runner('B', 0.3),
      runner('C', 0.2),
      runner('D', 0.1),
    ]);

    const winTotal = model.runners.reduce((sum, item) => sum + item.winProbability, 0);
    const placeTotal = model.runners.reduce((sum, item) => sum + model.placeProbability(item.horseId, 3), 0);
    const exactaTotal = model.runners.reduce((sum, first) => (
      sum + model.runners.reduce((inner, second) => (
        first.horseId === second.horseId
          ? inner
          : inner + model.orderedProbability([first.horseId, second.horseId])
      ), 0)
    ), 0);

    assert.equal(round(winTotal), 1);
    assert.equal(round(placeTotal), 3);
    assert.equal(round(exactaTotal), 1);
  });

  it('prices unordered exotic pools from the same ranking model', () => {
    const model = createRankingProbabilityModel([
      runner('A', 0.4),
      runner('B', 0.3),
      runner('C', 0.2),
      runner('D', 0.1),
    ]);

    const aPlace = model.placeProbability('A', 3);
    const bPlace = model.placeProbability('B', 3);
    const abQpl = model.unorderedTopKProbability(['A', 'B'], 3);
    const abQuinella = model.unorderedTopKProbability(['A', 'B'], 2);
    const abForecast = model.orderedProbability(['A', 'B']);
    const abcTrio = model.unorderedTopKProbability(['A', 'B', 'C'], 3);

    assert(aPlace > bPlace);
    assert(aPlace > 0.4);
    assert(abQpl > abQuinella);
    assert(abQuinella > abForecast);
    assert(abcTrio > 0);
    assert(abcTrio < abQpl);
  });
});

function runner(horseId, probability) {
  return {
    horseId,
    horseNo: horseId.charCodeAt(0) - 64,
    horseName: horseId,
    probability,
  };
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
