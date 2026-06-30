import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createLockedForecast,
  createUserPick,
  settleLockedForecast,
  settleUserPick,
  summarizeUserPicks,
} from '../self-test.js';

const settledEntry = {
  raceId: '2026-06-24-HV-5',
  date: '2026-06-24',
  racecourse: 'HV',
  raceNo: 5,
  forecast: {
    topPick: { horseId: 'H1', horseName: 'MEOWTH', probability: 0.1695, winOdds: 2.7 },
    recommendation: { action: 'probability', horseId: 'H1', horseName: 'MEOWTH' },
    finalBetPlan: { mode: 'prepare', minimumOdds: 6.67 },
    predictions: [
      { horseId: 'H1', horseNo: 1, horseName: 'MEOWTH', probability: 0.1695, winOdds: 2.7, fairOdds: 5.9 },
      { horseId: 'H2', horseNo: 2, horseName: 'OTHER HORSE', probability: 0.14, winOdds: 8.8, fairOdds: 7.14 },
    ],
  },
  settlement: {
    winnerHorseId: 'H1',
    winnerHorseName: 'MEOWTH',
  },
};

const openEntry = {
  ...settledEntry,
  raceId: '2026-07-01-ST-1',
  settlement: null,
};

describe('self-test helpers', () => {
  it('creates a browser-local user paper pick from a selected runner', () => {
    const pick = createUserPick(settledEntry, settledEntry.forecast.predictions[0], {
      stake: 25,
      pickedAt: '2026-06-24T10:00:00.000Z',
    });

    assert.deepEqual(pick, {
      raceId: '2026-06-24-HV-5',
      date: '2026-06-24',
      racecourse: 'HV',
      raceNo: 5,
      horseId: 'H1',
      horseNo: 1,
      horseName: 'MEOWTH',
      modelProbability: 0.1695,
      fairOdds: 5.9,
      winOdds: 2.7,
      stake: 25,
      pickedAt: '2026-06-24T10:00:00.000Z',
    });
  });

  it('settles user picks as WIN, MISS, or OPEN', () => {
    const winningPick = createUserPick(settledEntry, settledEntry.forecast.predictions[0], { stake: 10, pickedAt: 'now' });
    const losingPick = createUserPick(settledEntry, settledEntry.forecast.predictions[1], { stake: 10, pickedAt: 'now' });
    const openPick = createUserPick(openEntry, openEntry.forecast.predictions[0], { stake: 10, pickedAt: 'now' });

    assert.deepEqual(settleUserPick(settledEntry, winningPick), {
      status: 'WIN',
      placing: 1,
      stake: 10,
      returned: 27,
      profit: 17,
      winnerHorseName: 'MEOWTH',
    });
    assert.deepEqual(settleUserPick(settledEntry, losingPick), {
      status: 'MISS',
      placing: null,
      stake: 10,
      returned: 0,
      profit: -10,
      winnerHorseName: 'MEOWTH',
    });
    assert.equal(settleUserPick(openEntry, openPick).status, 'OPEN');
  });

  it('creates and settles immutable forecast locks', () => {
    const locked = createLockedForecast(settledEntry, '2026-06-24T08:00:00.000Z');
    settledEntry.forecast.topPick.horseName = 'MUTATED';

    assert.equal(locked.raceId, '2026-06-24-HV-5');
    assert.equal(locked.topPick.horseName, 'MEOWTH');
    assert.equal(locked.recommendation.horseName, 'MEOWTH');
    assert.equal(settleLockedForecast(settledEntry, locked).topPickStatus, 'WIN');
  });

  it('summarizes local user paper-pick records against available entries', () => {
    const picks = [
      createUserPick(settledEntry, settledEntry.forecast.predictions[0], { stake: 10, pickedAt: 'a' }),
      createUserPick(settledEntry, settledEntry.forecast.predictions[1], { stake: 5, pickedAt: 'b' }),
      createUserPick(openEntry, openEntry.forecast.predictions[0], { stake: 10, pickedAt: 'c' }),
    ];

    const summary = summarizeUserPicks([settledEntry, openEntry], picks);

    assert.deepEqual(summary, {
      picks: 3,
      settled: 2,
      open: 1,
      wins: 1,
      stake: 15,
      returned: 27,
      profit: 12,
      winRate: 0.5,
      roi: 0.8,
    });
  });
});
