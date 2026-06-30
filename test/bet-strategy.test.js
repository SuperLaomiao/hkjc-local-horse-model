import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildStakingStrategy } from '../bet-strategy.js';

describe('staking strategy', () => {
  it('passes when the top probability is too weak', () => {
    const strategy = buildStakingStrategy(entry([
      runner('A', 'Weak One', 0.105, 20),
      runner('B', 'Weak Two', 0.095, 8),
    ]));

    assert.equal(strategy.mode, 'pass');
    assert.equal(strategy.budget, 0);
    assert.deepEqual(strategy.bets, []);
  });

  it('builds a normal HK$30 plan from a medium top-pick signal', () => {
    const strategy = buildStakingStrategy(entry([
      runner('A', 'Main Chance', 0.162, 6.8),
      runner('B', 'Support', 0.12, 9),
      runner('C', 'Third', 0.1, 12),
    ]));

    assert.equal(strategy.mode, 'watch');
    assert.equal(strategy.budget, 30);
    assert.equal(strategy.totalStake, 30);
    assert.deepEqual(strategy.bets.map((bet) => [bet.type, bet.amount, bet.horses.map((horse) => horse.horseId)]), [
      ['PLACE', 20, ['A']],
      ['WIN', 10, ['A']],
    ]);
  });

  it('adds quinella place lines for a strong usable support pair', () => {
    const strategy = buildStakingStrategy(entry([
      runner('A', 'Main Chance', 0.188, 7.5),
      runner('B', 'Support B', 0.142, 6.2),
      runner('C', 'Support C', 0.118, 11),
    ]));

    assert.equal(strategy.budget, 50);
    assert.equal(strategy.totalStake, 50);
    assert.deepEqual(strategy.bets.map((bet) => [bet.type, bet.amount, bet.horses.map((horse) => horse.horseId)]), [
      ['PLACE', 20, ['A']],
      ['WIN', 10, ['A']],
      ['QUINELLA_PLACE', 10, ['A', 'B']],
      ['QUINELLA_PLACE', 10, ['A', 'C']],
    ]);
  });

  it('caps a very strong plan at HK$100', () => {
    const strategy = buildStakingStrategy(entry([
      runner('A', 'Standout', 0.245, 5.2),
      runner('B', 'Second', 0.155, 7.8),
      runner('C', 'Third', 0.126, 10.5),
    ]));

    assert.equal(strategy.confidence, 'very-strong');
    assert.equal(strategy.budget, 100);
    assert.equal(strategy.totalStake, 100);
    assert.equal(strategy.bets.at(-1).type, 'QUINELLA');
    assert(strategy.stopRules.some((rule) => /HK\$100/.test(rule)));
  });

  it('stays in prepare mode when market odds are not published yet', () => {
    const strategy = buildStakingStrategy(entry([
      runner('A', 'No Odds Yet', 0.19, null),
      runner('B', 'Support B', 0.13, null),
      runner('C', 'Support C', 0.11, null),
    ]));

    assert.equal(strategy.mode, 'prepare');
    assert.equal(strategy.hasMarketOdds, false);
    assert(strategy.checklist.some((item) => /实时赔率/.test(item)));
  });
});

function entry(predictions) {
  return {
    raceId: '2026-07-01-ST-1',
    date: '2026-07-01',
    racecourse: 'ST',
    raceNo: 1,
    forecast: {
      predictions,
      topPick: predictions[0],
      recommendation: { action: 'probability', horseId: predictions[0].horseId },
    },
  };
}

function runner(horseId, horseName, probability, winOdds) {
  return {
    horseId,
    horseNo: Number(horseId.charCodeAt(0) - 64),
    horseName,
    probability,
    fairOdds: probability > 0 ? 1 / probability : null,
    winOdds,
  };
}
