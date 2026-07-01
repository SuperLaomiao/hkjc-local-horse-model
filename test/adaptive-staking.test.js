import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildAdaptiveRacePlan } from '../adaptive-staking.js';

describe('adaptive race staking plan', () => {
  it('protects a first-race hit by skipping the next low signal and resizing a later medium signal', () => {
    const plan = buildAdaptiveRacePlan([
      race(1, [
        runner('A', 'Opening Place', 0.162, 6.8, 2),
        runner('B', 'Support', 0.12, 9, 4),
      ]),
      race(2, [
        runner('C', 'Thin Chance', 0.126, 14, 5),
        runner('D', 'Other', 0.11, 8, 1),
      ]),
      race(3, [
        runner('E', 'Later Medium', 0.164, 7.2, 2),
        runner('F', 'Other', 0.12, 9, 6),
      ]),
    ]);

    assert.equal(plan.rows[0].decision.state, 'OPENING');
    assert.equal(plan.rows[0].outcome.status, 'HIT');

    assert.equal(plan.rows[1].decision.state, 'PROTECT');
    assert.equal(plan.rows[1].totalStake, 0);
    assert.match(plan.rows[1].decision.reason, /第一场已经命中|保护/);

    assert.equal(plan.rows[2].decision.state, 'PROTECT');
    assert.equal(plan.rows[2].totalStake, 10);
    assert.deepEqual(plan.rows[2].bets.map((bet) => [bet.type, bet.amount]), [
      ['PLACE', 10],
    ]);
  });

  it('does not chase after an opening miss and only lets strong signals through at low stake', () => {
    const plan = buildAdaptiveRacePlan([
      race(1, [
        runner('A', 'Opening Miss', 0.162, 6.8, 5),
        runner('B', 'Support', 0.12, 9, 2),
      ]),
      race(2, [
        runner('C', 'Strong Cooldown', 0.188, 7.5, 2),
        runner('D', 'Support D', 0.142, 6.2, 4),
        runner('E', 'Support E', 0.118, 11, 3),
      ]),
    ]);

    assert.equal(plan.rows[0].outcome.status, 'MISS');
    assert.equal(plan.rows[1].decision.state, 'COOLDOWN');
    assert.equal(plan.rows[1].totalStake, 10);
    assert.deepEqual(plan.rows[1].bets.map((bet) => [bet.type, bet.amount]), [
      ['PLACE', 10],
    ]);
    assert(plan.rows[1].baseTotalStake > plan.rows[1].totalStake);
  });

  it('stops the rest of the meeting after two executed misses', () => {
    const plan = buildAdaptiveRacePlan([
      race(1, [
        runner('A', 'Opening Miss', 0.162, 6.8, 5),
        runner('B', 'Support', 0.12, 9, 2),
      ]),
      race(2, [
        runner('C', 'Strong Miss', 0.188, 7.5, 7),
        runner('D', 'Support D', 0.142, 6.2, 1),
        runner('E', 'Support E', 0.118, 11, 2),
      ]),
      race(3, [
        runner('F', 'Very Strong Later', 0.245, 5.2, 1),
        runner('G', 'Second', 0.155, 7.8, 2),
        runner('H', 'Third', 0.126, 10.5, 3),
      ]),
    ]);

    assert.equal(plan.rows[0].outcome.status, 'MISS');
    assert.equal(plan.rows[1].outcome.status, 'MISS');
    assert.equal(plan.rows[2].decision.state, 'STOP');
    assert.equal(plan.rows[2].totalStake, 0);
  });

  it('keeps future races open instead of pretending unknown results were wins or losses', () => {
    const plan = buildAdaptiveRacePlan([
      upcomingRace(1, [
        runner('A', 'Future Medium', 0.162, null, null),
        runner('B', 'Support', 0.12, null, null),
      ]),
      upcomingRace(2, [
        runner('C', 'Future Strong', 0.188, null, null),
        runner('D', 'Support D', 0.142, null, null),
        runner('E', 'Support E', 0.118, null, null),
      ]),
    ]);

    assert.equal(plan.rows[0].outcome.status, 'OPEN');
    assert.equal(plan.rows[1].decision.state, 'PRE_RACE');
    assert.equal(plan.summary.openRaces, 2);
  });
});

function race(raceNo, predictions) {
  const runnerResults = predictions.map((prediction) => ({
    horseId: prediction.horseId,
    horseNo: prediction.horseNo,
    horseName: prediction.horseName,
    placing: prediction.placing,
    winOdds: prediction.winOdds,
  }));
  for (let index = runnerResults.length; index < 7; index += 1) {
    runnerResults.push({
      horseId: `FILLER_${raceNo}_${index}`,
      horseNo: 90 + index,
      horseName: `Filler ${index}`,
      placing: 20 + index,
      winOdds: 99,
    });
  }

  return {
    raceId: `2026-07-04-ST-${raceNo}`,
    date: '2026-07-04',
    racecourse: 'ST',
    raceNo,
    forecast: {
      predictions,
      topPick: predictions[0],
      recommendation: { action: 'probability', horseId: predictions[0].horseId },
    },
    settlement: {
      runnerResults,
    },
  };
}

function upcomingRace(raceNo, predictions) {
  const entry = race(raceNo, predictions);
  delete entry.settlement;
  return entry;
}

function runner(horseId, horseName, probability, winOdds, placing) {
  return {
    horseId,
    horseNo: Number(horseId.charCodeAt(0) - 64),
    horseName,
    probability,
    fairOdds: probability > 0 ? 1 / probability : null,
    winOdds,
    placing,
  };
}
