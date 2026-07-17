import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildPoolMoneyFeatureIndex } from '../src/pool-money-features.js';

describe('pool money features', () => {
  it('derives normalized WIN shares, money, concentration, and crowding from one coherent pre-race book', () => {
    const race = testRace([1, 2]);
    const capturedAt = '2026-07-18T08:00:00.000Z';
    const result = buildPoolMoneyFeatureIndex({
      races: [race],
      oddsSnapshots: [
        oddsSnapshot(race.raceId, 'WIN', [1], 2, 30, capturedAt),
        oddsSnapshot(race.raceId, 'WIN', [2], 4, 30, capturedAt),
      ],
      poolSnapshots: [
        poolSnapshot(race.raceId, 'WIN', 100000, 30, capturedAt),
      ],
    });

    const horseOne = result.featuresByRunner.get(`${race.raceId}|1`);
    const horseTwo = result.featuresByRunner.get(`${race.raceId}|2`);

    assert.equal(horseOne.poolWinOddsAvailableT30, 1);
    assert.equal(horseOne.poolWinInvestmentAvailableT30, 1);
    assert.equal(horseOne.poolWinAvailableT30, 1);
    assert.equal(horseOne.poolWinInvestmentT30, 100000);
    assert.equal(horseOne.poolWinMarketShareT30, 0.666667);
    assert.equal(horseTwo.poolWinMarketShareT30, 0.333333);
    assert.equal(horseOne.poolWinEstimatedMoneyT30, 66666.6667);
    assert.equal(horseTwo.poolWinEstimatedMoneyT30, 33333.3333);
    assert.equal(horseOne.poolWinConcentrationT30, 0.555556);
    assert.equal(horseOne.poolWinOverroundT30, 0.75);
    assert.equal(horseOne.poolWinCrowdingRatioT30, 1.333333);
    assert.equal(horseTwo.poolWinCrowdingRatioT30, 0.666667);
    assert.equal(horseOne.poolWinImbalanceT30, 0.166667);
    assert.equal(horseOne.poolWinPayoutRateT30, 0.825);
    assert.equal(horseOne.poolWinTakeoutRateT30, 0.175);
    assert.equal(result.summary.racesWithAnyPoolMoney, 1);
  });

  it('derives runner involvement from QIN combination shares', () => {
    const race = testRace([1, 2, 3, 4]);
    const capturedAt = '2026-07-18T08:00:00.000Z';
    const result = buildPoolMoneyFeatureIndex({
      races: [race],
      oddsSnapshots: [
        oddsSnapshot(race.raceId, 'QIN', [1, 2], 4, 30, capturedAt),
        oddsSnapshot(race.raceId, 'QIN', [1, 3], 8, 30, capturedAt),
        oddsSnapshot(race.raceId, 'QIN', [2, 3], 8, 30, capturedAt),
        oddsSnapshot(race.raceId, 'QIN', [4], 1, 30, capturedAt),
      ],
      poolSnapshots: [
        poolSnapshot(race.raceId, 'QIN', 200000, 30, capturedAt),
      ],
    });

    const horseOne = result.featuresByRunner.get(`${race.raceId}|1`);
    assert.equal(horseOne.poolQuinellaOddsAvailableT30, 1);
    assert.equal(horseOne.poolQuinellaAvailableT30, 1);
    assert.equal(horseOne.poolQuinellaInvolvementShareT30, 0.75);
    assert.equal(horseOne.poolQuinellaEstimatedMoneyT30, 150000);
    assert.equal(horseOne.poolQuinellaCrowdingRatioT30, 1.125);
    assert.equal(horseOne.poolQuinellaInvolvementImbalanceT30, 0.083333);
  });

  it('keeps every runner valid with explicit flags when pool data is missing', () => {
    const race = testRace([1, 2, 3]);
    const result = buildPoolMoneyFeatureIndex({ races: [race] });

    assert.equal(result.featuresByRunner.size, 3);
    for (const horseNo of [1, 2, 3]) {
      const features = result.featuresByRunner.get(`${race.raceId}|${horseNo}`);
      assert.equal(features.poolWinAvailableT30, 0);
      assert.equal(features.poolPlaceAvailableT30, 0);
      assert.equal(features.poolQuinellaAvailableT30, 0);
      assert.equal(features.poolQuinellaPlaceAvailableT30, 0);
      assert.equal(features.poolPlaceInvestmentT30, null);
      assert.equal(features.poolQuinellaInvolvementShareT30, null);
    }
    assert.equal(result.summary.racesWithAnyPoolMoney, 0);
  });

  it('excludes negative minutes-to-post snapshots', () => {
    const race = testRace([1, 2]);
    const capturedAt = '2026-07-18T08:40:00.000Z';
    const result = buildPoolMoneyFeatureIndex({
      races: [race],
      oddsSnapshots: [
        oddsSnapshot(race.raceId, 'WIN', [1], 2, -1, capturedAt),
        oddsSnapshot(race.raceId, 'WIN', [2], 4, -1, capturedAt),
      ],
      poolSnapshots: [poolSnapshot(race.raceId, 'WIN', 100000, -1, capturedAt)],
    });

    assert.equal(result.featuresByRunner.get(`${race.raceId}|1`).poolWinOddsAvailableT3, 0);
    assert.equal(result.summary.racesWithAnyPoolMoney, 0);
  });

  it('fails closed for rounded T3 snapshots captured at or after the scheduled post time', () => {
    const race = testRace([1, 2]);
    const afterPost = '2026-07-18T08:00:20.000Z';
    const beforePost = '2026-07-18T07:59:40.000Z';
    const postRace = buildPoolMoneyFeatureIndex({
      races: [race],
      oddsSnapshots: [
        oddsSnapshot(race.raceId, 'WIN', [1], 2, 0, afterPost),
        oddsSnapshot(race.raceId, 'WIN', [2], 4, 0, afterPost),
      ],
      poolSnapshots: [{
        ...poolSnapshot(race.raceId, 'WIN', 100000, 0, afterPost),
        sellStatus: 'STOP_SELLING',
      }],
    });
    const preRace = buildPoolMoneyFeatureIndex({
      races: [race],
      oddsSnapshots: [
        oddsSnapshot(race.raceId, 'WIN', [1], 2, 0, beforePost),
        oddsSnapshot(race.raceId, 'WIN', [2], 4, 0, beforePost),
      ],
      poolSnapshots: [{
        ...poolSnapshot(race.raceId, 'WIN', 100000, 0, beforePost),
        sellStatus: 'START_SELLING',
      }],
    });

    assert.equal(postRace.featuresByRunner.get(`${race.raceId}|1`).poolWinAvailableT3, 0);
    assert.equal(postRace.summary.racesWithAnyPoolMoney, 0);
    assert.equal(preRace.featuresByRunner.get(`${race.raceId}|1`).poolWinAvailableT3, 1);
  });

  it('rejects raw terminal statuses when snapshot sellStatus fields are absent', () => {
    const race = testRace([1, 2]);

    for (const status of ['RESULT', 'STOP', 'CLOSE', 'SUSPEND']) {
      const capturedAt = `2026-07-18T08:00:00.00${status.length}Z`;
      const result = buildPoolMoneyFeatureIndex({
        races: [race],
        oddsSnapshots: [
          {
            ...oddsSnapshot(race.raceId, 'WIN', [1], 2, 30, capturedAt),
            raw: { status },
          },
          {
            ...oddsSnapshot(race.raceId, 'WIN', [2], 4, 30, capturedAt),
            raw: { status },
          },
        ],
        poolSnapshots: [{
          ...poolSnapshot(race.raceId, 'WIN', 100000, 30, capturedAt),
          raw: { status },
        }],
      });

      const horseOne = result.featuresByRunner.get(`${race.raceId}|1`);
      assert.equal(horseOne.poolWinAvailableT30, 0, status);
      assert.equal(result.summary.selectedOddsBooks, 0, status);
      assert.equal(result.summary.selectedPoolSnapshots, 0, status);
    }
  });

  it('selects one timestamped odds book instead of mixing combinations across captures', () => {
    const race = testRace([1, 2]);
    const earlier = '2026-07-18T07:59:00.000Z';
    const nearer = '2026-07-18T08:00:00.000Z';
    const result = buildPoolMoneyFeatureIndex({
      races: [race],
      oddsSnapshots: [
        oddsSnapshot(race.raceId, 'WIN', [1], 2, 31, earlier),
        oddsSnapshot(race.raceId, 'WIN', [2], 2, 31, earlier),
        oddsSnapshot(race.raceId, 'WIN', [1], 1.5, 30, nearer),
      ],
      poolSnapshots: [poolSnapshot(race.raceId, 'WIN', 90000, 30, nearer)],
    });

    const horseOne = result.featuresByRunner.get(`${race.raceId}|1`);
    const horseTwo = result.featuresByRunner.get(`${race.raceId}|2`);
    assert.equal(horseOne.poolWinMarketShareT30, 1);
    assert.equal(horseTwo.poolWinMarketShareT30, null);
  });

  it('attaches pool investment movement to every race runner when both windows exist', () => {
    const race = testRace([1, 2]);
    const result = buildPoolMoneyFeatureIndex({
      races: [race],
      poolSnapshots: [
        poolSnapshot(race.raceId, 'WIN', 100000, 30, '2026-07-18T08:00:00.000Z'),
        poolSnapshot(race.raceId, 'WIN', 150000, 10, '2026-07-18T08:20:00.000Z'),
      ],
    });

    assert.equal(
      result.featuresByRunner.get(`${race.raceId}|1`).poolWinInvestmentPctChangeT30ToT10,
      0.5,
    );
    assert.equal(
      result.featuresByRunner.get(`${race.raceId}|2`).poolWinInvestmentPctChangeT30ToT10,
      0.5,
    );
  });
});

function testRace(horseNumbers) {
  return {
    raceId: '2026-07-18-ST-1',
    date: '2026-07-18',
    racecourse: 'ST',
    raceNo: 1,
    startTime: '16:00',
    runners: horseNumbers.map((horseNo) => ({ horseNo })),
  };
}

function oddsSnapshot(raceId, pool, combination, oddsValue, minutesToPost, capturedAt) {
  return {
    raceId,
    pool,
    combination,
    oddsValue,
    minutesToPost,
    capturedAt,
  };
}

function poolSnapshot(raceId, pool, investment, minutesToPost, capturedAt) {
  return {
    raceId,
    pool,
    investment,
    minutesToPost,
    capturedAt,
  };
}
