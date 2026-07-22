import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildGuardedStakingSweep,
  buildStrategyRiskReport,
} from '../src/strategy-risk-report.js';

describe('strategy risk report', () => {
  it('summarizes strategy profit, drawdown, pools, pass races, and concentration', () => {
    const report = buildStrategyRiskReport(strategyEntries);

    assert.equal(report.summary.races, 4);
    assert.equal(report.summary.activeRaces, 3);
    assert.equal(report.summary.passRaces, 1);
    assert.equal(report.summary.totalStake, 140);
    assert.equal(report.summary.knownReturn, 318);
    assert.equal(report.summary.knownProfit, 178);
    assert.equal(report.summary.knownRoi, 1.2714);
    assert.equal(report.summary.cumulativeProfit, 178);
    assert.equal(report.summary.maxDrawdown, 10);
    assert.equal(report.summary.longestLosingStreak, 1);
    assert.equal(report.summary.hitRate, 0.6667);

    assert.deepEqual(report.byPool.WIN, {
      stake: 20,
      bets: 2,
      hits: 1,
      return: 50,
      profit: 30,
      roi: 1.5,
    });
    assert.deepEqual(report.byPool.PLACE, {
      stake: 80,
      bets: 5,
      hits: 3,
      return: 108,
      profit: 28,
      roi: 0.35,
    });
    assert.deepEqual(report.byPool.QUINELLA_PLACE, {
      stake: 30,
      bets: 2,
      hits: 1,
      return: 160,
      profit: 130,
      roi: 4.3333,
    });
    assert.deepEqual(report.byPool.QUINELLA, {
      stake: 10,
      bets: 1,
      hits: 0,
      return: 0,
      profit: -10,
      roi: -1,
    });

    assert.equal(report.concentration.largestRaceStakeShare, 0.7143);
    assert.equal(report.concentration.largestPositiveRaceProfit, 118);
    assert.equal(report.concentration.largestPositiveRaceProfitShare, 0.6277);
    assert.equal(report.concentration.topHorseStakeShares[0].horseName, 'Anchor');
    assert.equal(report.concentration.topHorseStakeShares[0].stakeInvolvingHorse, 90);
    assert.equal(report.concentration.topHorseStakeShares[0].shareOfTotalStake, 0.6429);

    assert.equal(report.timeline.length, 3);
    assert.deepEqual(report.timeline.map((row) => row.knownProfit), [70, 118, -10]);
    assert.deepEqual(report.timeline.map((row) => row.cumulativeProfit), [70, 188, 178]);
    assert.deepEqual(report.timeline.map((row) => row.drawdown), [0, 0, 10]);
    assert.equal(report.timeline[1].mainExposure.horseName, 'Support One');
    assert.equal(report.timeline[1].mainExposure.stakeInvolvingHorse, 60);
  });

  it('compares research stakes but keeps every executable stake at zero before manual approval', () => {
    const report = buildGuardedStakingSweep(stakingLines(), {
      promotion: {
        state: 'REVIEW_REQUIRED',
        pool: 'WIN',
        cashMode: 'NO_BET',
      },
      bankroll: 1000,
      maxRaceStakePct: 0.05,
    });

    assert.equal(report.state, 'REVIEW_REQUIRED');
    assert.equal(report.cashMode, 'NO_BET');
    assert.equal(report.executionStatus, 'PAPER_ONLY');
    assert.deepEqual(report.strategies.map((strategy) => strategy.id), [
      'fixed-hk10',
      'fractional-kelly-0.1',
      'fractional-kelly-0.25',
      'fractional-kelly-0.5',
      'conservative-capped',
    ]);
    assert(report.strategies.every((strategy) => strategy.researchStake > 0));
    assert(report.strategies.some((strategy) => strategy.researchRoi > 0));
    assert(report.strategies.every((strategy) => strategy.executableStake === 0));
    assert(report.strategies.every((strategy) => strategy.maxRaceStake <= 50));
  });

  it('does not turn an approved research candidate into cash authorization', () => {
    const report = buildGuardedStakingSweep(stakingLines(), {
      promotion: {
        state: 'APPROVED_CANDIDATE',
        pool: 'WIN',
        cashMode: 'NO_BET',
        manualReview: { reviewedBy: 'owner', reviewedAt: '2026-08-01T10:00:00Z' },
      },
      bankroll: 1000,
    });

    assert.equal(report.state, 'APPROVED_RESEARCH_NO_CASH');
    assert.equal(report.cashMode, 'NO_BET');
    assert(report.strategies.every((strategy) => strategy.executableStake === 0));
    assert.match(report.activationRequired, /outside|另行|separate/i);
  });

  it('does not run staking sweeps before a positive prospective promotion gate', () => {
    const report = buildGuardedStakingSweep(stakingLines(), {
      promotion: { state: 'NO_GO', pool: 'WIN', cashMode: 'NO_BET' },
      bankroll: 1000,
    });

    assert.equal(report.state, 'BLOCKED_PROMOTION');
    assert.deepEqual(report.strategies, []);
    assert.equal(report.cashMode, 'NO_BET');
  });
});

const strategyEntries = [
  strategyEntry({
    raceId: '2026-07-01-ST-1',
    topProbability: 0.16,
    topWinOdds: 5,
    secondProbability: 0.12,
    thirdProbability: 0.1,
    dividends: {
      place: [
        { pool: 'PLACE', combination: [1], dividendPer10: 25 },
      ],
    },
    results: [
      result('A', 1, 'Anchor', 1, 5),
      result('B', 2, 'Support One', 2, 8),
      result('C', 3, 'Support Two', 3, 12),
      result('D', 4, 'Outsider', 4, 30),
      result('E', 5, 'Filler', 5, 45),
      result('F', 6, 'Wide', 6, 55),
      result('G', 7, 'Reserve', 7, 80),
    ],
  }),
  strategyEntry({
    raceId: '2026-07-01-ST-2',
    topProbability: 0.24,
    topWinOdds: 7,
    secondProbability: 0.14,
    thirdProbability: 0.11,
    dividends: {
      place: [
        { pool: 'PLACE', combination: [2], dividendPer10: 18 },
        { pool: 'PLACE', combination: [3], dividendPer10: 22 },
      ],
      quinellaPlace: [
        { pool: 'QUINELLA_PLACE', combination: [2, 3], dividendPer10: 80 },
      ],
    },
    results: [
      result('B', 2, 'Support One', 1, 8),
      result('C', 3, 'Support Two', 2, 12),
      result('D', 4, 'Outsider', 3, 30),
      result('A', 1, 'Anchor', 4, 7),
      result('E', 5, 'Filler', 5, 45),
      result('F', 6, 'Wide', 6, 55),
      result('G', 7, 'Reserve', 7, 80),
    ],
  }),
  strategyEntry({
    raceId: '2026-07-01-ST-3',
    topProbability: 0.13,
    topWinOdds: 6,
    secondProbability: 0.11,
    thirdProbability: 0.1,
    dividends: {
      place: [
        { pool: 'PLACE', combination: [2], dividendPer10: 20 },
        { pool: 'PLACE', combination: [3], dividendPer10: 22 },
        { pool: 'PLACE', combination: [4], dividendPer10: 24 },
      ],
    },
    results: [
      result('B', 2, 'Support One', 1, 8),
      result('C', 3, 'Support Two', 2, 12),
      result('D', 4, 'Outsider', 3, 30),
      result('A', 1, 'Anchor', 4, 6),
      result('E', 5, 'Filler', 5, 45),
      result('F', 6, 'Wide', 6, 55),
      result('G', 7, 'Reserve', 7, 80),
    ],
  }),
  strategyEntry({
    raceId: '2026-07-01-ST-4',
    topProbability: 0.09,
    topWinOdds: 20,
    secondProbability: 0.08,
    thirdProbability: 0.07,
    results: [
      result('B', 2, 'Support One', 1, 8),
      result('C', 3, 'Support Two', 2, 12),
      result('D', 4, 'Outsider', 3, 30),
      result('A', 1, 'Anchor', 4, 20),
      result('E', 5, 'Filler', 5, 45),
      result('F', 6, 'Wide', 6, 55),
      result('G', 7, 'Reserve', 7, 80),
    ],
  }),
];

function stakingLines() {
  return [
    {
      raceId: '2026-07-22-HV-R1',
      pool: 'WIN',
      probability: 0.5,
      decimalOdds: 3,
      outcome: 1,
    },
    {
      raceId: '2026-07-22-HV-R2',
      pool: 'WIN',
      probability: 0.5,
      decimalOdds: 3,
      outcome: 0,
    },
  ];
}

function strategyEntry({ raceId, topProbability, topWinOdds, secondProbability, thirdProbability, dividends, results }) {
  return {
    raceId,
    date: '2026-07-01',
    racecourse: 'ST',
    raceNo: Number(raceId.split('-').at(-1)),
    forecast: {
      raceId,
      date: '2026-07-01',
      racecourse: 'ST',
      raceNo: Number(raceId.split('-').at(-1)),
      predictions: [
        prediction('A', 1, 'Anchor', topProbability, topWinOdds),
        prediction('B', 2, 'Support One', secondProbability, 8),
        prediction('C', 3, 'Support Two', thirdProbability, 12),
        prediction('D', 4, 'Outsider', 0.08, 30),
      ],
    },
    settlement: {
      raceId,
      runnerResults: results,
      dividends: dividends ?? null,
    },
  };
}

function prediction(horseId, horseNo, horseName, probability, winOdds) {
  return {
    horseId,
    horseNo,
    horseName,
    probability,
    fairOdds: 1 / probability,
    winOdds,
  };
}

function result(horseId, horseNo, horseName, placing, winOdds) {
  return {
    horseId,
    horseNo,
    horseName,
    placing,
    winOdds,
  };
}
