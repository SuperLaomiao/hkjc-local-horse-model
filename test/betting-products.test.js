import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildPoolGuideRecommendation,
  getBetTypeGuide,
  getBetTypeGuides,
  settlePoolGuideRecommendation,
  settleStrategyBetLine,
} from '../betting-products.js';

describe('betting product guide', () => {
  it('covers the photographed HKJC bet-slip families', () => {
    const guides = getBetTypeGuides();
    const types = new Set(guides.map((guide) => guide.type));

    assert(types.has('TIERCE'));
    assert(types.has('QUARTET'));
    assert(types.has('JOCKEY_CHALLENGE'));
    assert(types.has('DOUBLE_TRIO'));
    assert.equal(getBetTypeGuide('PLACE').label, '位置');
    assert.match(getBetTypeGuide('QUINELLA_PLACE').howToWin, /位置/);
  });

  it('recommends a conservative place line and settles it as hit', () => {
    const race = entry([
      runner('A', 10, 'Main Chance', 0.18),
      runner('B', 3, 'Support', 0.12),
      runner('C', 7, 'Third', 0.1),
    ], [
      result('B', 3, 'Support', 1),
      result('A', 10, 'Main Chance', 2),
      result('C', 7, 'Third', 3),
      result('D', 2, 'Other', 4),
      result('E', 5, 'Other 2', 5),
      result('F', 6, 'Other 3', 6),
      result('G', 8, 'Other 4', 7),
    ]);

    const recommendation = buildPoolGuideRecommendation(race, 'PLACE');
    assert.equal(recommendation.status, 'PLAY');
    assert.equal(recommendation.stake, 20);
    assert.match(recommendation.ticketText, /No\.10/);

    const settlement = settlePoolGuideRecommendation(race, recommendation);
    assert.equal(settlement.status, 'HIT');
    assert.match(settlement.detail, /第2/);
  });

  it('keeps exact-order exotic pools as paper or pass until ordering is validated', () => {
    const race = entry([
      runner('A', 1, 'Main Chance', 0.24),
      runner('B', 2, 'Second Chance', 0.16),
      runner('C', 3, 'Third Chance', 0.12),
      runner('D', 4, 'Fourth Chance', 0.09),
    ]);

    const forecast = buildPoolGuideRecommendation(race, 'FORECAST');
    const tierce = buildPoolGuideRecommendation(race, 'TIERCE');
    const quartet = buildPoolGuideRecommendation(race, 'QUARTET');

    assert.equal(forecast.status, 'PAPER');
    assert.equal(tierce.status, 'PASS');
    assert.equal(quartet.status, 'PASS');
    assert.equal(forecast.stake, 0);
  });

  it('settles strategy bet lines across place and quinella place', () => {
    const race = entry([
      runner('A', 1, 'Main Chance', 0.19),
      runner('B', 2, 'Support B', 0.14),
      runner('C', 3, 'Support C', 0.12),
    ], [
      result('C', 3, 'Support C', 1),
      result('A', 1, 'Main Chance', 2),
      result('B', 2, 'Support B', 3),
      result('D', 4, 'Other', 4),
      result('E', 5, 'Other 2', 5),
      result('F', 6, 'Other 3', 6),
      result('G', 7, 'Other 4', 7),
    ]);

    const placeSettlement = settleStrategyBetLine(race, {
      type: 'PLACE',
      label: '位置',
      amount: 20,
      horses: [{ horseId: 'A', horseNo: 1, horseName: 'Main Chance' }],
    });
    const qplSettlement = settleStrategyBetLine(race, {
      type: 'QUINELLA_PLACE',
      label: '位置Q',
      amount: 10,
      horses: [
        { horseId: 'A', horseNo: 1, horseName: 'Main Chance' },
        { horseId: 'B', horseNo: 2, horseName: 'Support B' },
      ],
    });

    assert.equal(placeSettlement.status, 'HIT');
    assert.equal(qplSettlement.status, 'HIT');
  });
});

function entry(predictions, runnerResults = []) {
  return {
    raceId: '2026-07-01-ST-1',
    date: '2026-07-01',
    racecourse: 'ST',
    raceNo: 1,
    forecast: {
      predictions,
      topPick: predictions[0],
      recommendation: { action: 'probability', horseId: predictions[0]?.horseId },
    },
    settlement: runnerResults.length ? { runnerResults } : null,
  };
}

function runner(horseId, horseNo, horseName, probability) {
  return {
    horseId,
    horseNo,
    horseName,
    probability,
    fairOdds: probability > 0 ? 1 / probability : null,
    winOdds: 6,
  };
}

function result(horseId, horseNo, horseName, placing) {
  return {
    horseId,
    horseNo,
    horseName,
    placing,
    winOdds: 6,
  };
}
