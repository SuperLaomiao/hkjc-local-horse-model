import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  auditRecommendationRuns,
  settleLineFromOfficialDividends,
} from '../src/recommendation-audit.js';

describe('recommendation audit', () => {
  it('settles recorded recommendation lines against official dividends', () => {
    const audit = auditRecommendationRuns({
      runs: [{
        runId: 'rec_test',
        raceId: '2026-07-04-ST-1',
        generatedAt: '2026-07-04T07:50:00.000Z',
        summary: { mode: 'execute' },
        recommendations: [
          { pool: 'PLACE', combination: [2], stake: 10 },
          { pool: 'QUINELLA_PLACE', combination: [1, 2], stake: 10 },
          { pool: 'WIN', combination: [8], stake: 10 },
        ],
      }],
      races: [settledRace()],
    });

    assert.equal(audit.summary.runs, 1);
    assert.equal(audit.summary.settledRuns, 1);
    assert.equal(audit.summary.totalStake, 30);
    assert.equal(audit.summary.totalReturn, 28.5);
    assert.equal(audit.summary.profit, -1.5);
    assert.equal(audit.summary.roi, -0.05);
    assert.equal(audit.summary.hitLines, 2);
    assert.equal(audit.summary.missLines, 1);
    assert.equal(audit.runs[0].status, 'SETTLED');
    assert.deepEqual(audit.runs[0].lines.map((line) => line.status), ['HIT', 'HIT', 'MISS']);
  });

  it('keeps recommendation runs open until the matching race is settled', () => {
    const audit = auditRecommendationRuns({
      runs: [{
        runId: 'rec_open',
        raceId: '2026-07-08-HV-1',
        generatedAt: '2026-07-08T09:00:00.000Z',
        summary: { mode: 'execute' },
        recommendations: [{ pool: 'PLACE', combination: [2], stake: 10 }],
      }],
      races: [],
    });

    assert.equal(audit.summary.openRuns, 1);
    assert.equal(audit.summary.totalStake, 0);
    assert.equal(audit.runs[0].status, 'OPEN');
    assert.equal(audit.runs[0].lines[0].status, 'OPEN');
  });

  it('counts only the latest executable pre-race run per strategy', () => {
    const race = { ...settledRace(), date: '2026-07-04', startTime: '16:00' };
    const audit = auditRecommendationRuns({
      races: [race],
      runs: [
        recommendationRun('prepare', '2026-07-04T07:00:00.000Z', 'prepare', 2),
        recommendationRun('early', '2026-07-04T07:20:00.000Z', 'execute', 2),
        recommendationRun('final', '2026-07-04T07:50:00.000Z', 'execute', 1),
        recommendationRun('after', '2026-07-04T08:05:00.000Z', 'execute', 2),
      ],
    });

    assert.equal(audit.summary.recordedRuns, 4);
    assert.equal(audit.summary.eligibleRuns, 1);
    assert.equal(audit.summary.excludedRuns, 3);
    assert.equal(audit.summary.totalStake, 10);
    assert.equal(audit.summary.totalReturn, 10.1);
    assert.equal(audit.runs.find((run) => run.runId === 'final').auditDecision, 'INCLUDED');
    assert.equal(audit.runs.find((run) => run.runId === 'prepare').exclusionReason, 'PREPARE_ONLY');
    assert.equal(audit.runs.find((run) => run.runId === 'early').exclusionReason, 'SUPERSEDED');
    assert.equal(audit.runs.find((run) => run.runId === 'after').exclusionReason, 'POST_RACE');
  });

  it('fails closed when a settled race has no trustworthy post time', () => {
    const audit = auditRecommendationRuns({
      races: [{ ...settledRace(), date: '2026-07-04', startTime: null }],
      runs: [recommendationRun('unknown-time', '2026-07-04T07:50:00.000Z', 'execute', 2)],
    });

    assert.equal(audit.summary.eligibleRuns, 0);
    assert.equal(audit.summary.totalStake, 0);
    assert.equal(audit.runs[0].exclusionReason, 'MISSING_POST_TIME');
  });

  it('classifies a later Hong Kong date as post-race even when post time is missing', () => {
    const audit = auditRecommendationRuns({
      races: [{ ...settledRace(), date: '2026-07-04', startTime: null }],
      runs: [recommendationRun('next-day', '2026-07-06T03:56:44.952Z', 'execute', 2)],
    });

    assert.equal(audit.summary.eligibleRuns, 0);
    assert.equal(audit.runs[0].exclusionReason, 'POST_RACE');
  });

  it('zeros non-play stakes and preserves executable value lineage', () => {
    const audit = auditRecommendationRuns({
      races: [settledRace()],
      runs: [{
        runId: 'rec_value_lineage',
        raceId: '2026-07-04-ST-1',
        generatedAt: '2026-07-04T07:50:00.000Z',
        strategyVersion: 'value-betting-v1',
        summary: { mode: 'execute' },
        recommendations: [
          {
            pool: 'PLACE', combination: [2], stake: 10,
            decision: { status: 'NO_BET', reasonCode: 'MISSING_PRICE' },
          },
          {
            pool: 'PLACE', combination: [1], stake: 10,
            decision: { status: 'PLAY', reasonCode: 'EDGE_CLEARS_BUFFER' },
            probabilityArtifactId: 'runner-probability-stack-v1',
            modelId: 'runner-probability-stack-v1',
            calibrationMethod: 'isotonic',
            marketCapturedAt: '2026-07-04T07:45:00.000Z',
            marketWindow: 'T-10',
            ruleVersion: 'value-betting-v1',
            conservativeProbability: 0.52,
            fairDividendPer10: 18.18,
            requiredDividendPer10: 20.77,
            conservativeExpectedRoi: 0.092,
          },
        ],
      }],
    });

    assert.equal(audit.summary.totalStake, 10);
    assert.equal(audit.runs[0].lines[0].status, 'PASS');
    assert.equal(audit.runs[0].lines[0].stake, 0);
    assert.equal(audit.runs[0].lines[0].auditReason, 'NON_EXECUTABLE_DECISION');
    assert.equal(audit.runs[0].lines[1].probabilityArtifactId, 'runner-probability-stack-v1');
    assert.equal(audit.runs[0].lines[1].marketCapturedAt, '2026-07-04T07:45:00.000Z');
    assert.equal(audit.runs[0].lines[1].ruleVersion, 'value-betting-v1');
  });

  it('records T-3 indicative CLV, official slippage, cash drawdown, and paper ROI separately', () => {
    const audit = auditRecommendationRuns({
      races: [settledRace()],
      marketSnapshots: [
        {
          raceId: '2026-07-04-ST-1', poolKey: 'place', combination: [1],
          oddsValue: 1.8, minutesToPost: 3,
          capturedAt: '2026-07-04T07:57:00.000Z', sellStatus: 'SELLING',
        },
      ],
      runs: [{
        runId: 'rec_clv_paper',
        raceId: '2026-07-04-ST-1',
        generatedAt: '2026-07-04T07:50:00.000Z',
        summary: { mode: 'execute' },
        recommendations: [
          {
            pool: 'PLACE', combination: [1], stake: 10,
            marketDividendPer10: 20,
            marketCapturedAt: '2026-07-04T07:50:00.000Z',
            marketWindow: 'T-10',
            decision: { status: 'PLAY', reasonCode: 'EDGE_CLEARS_BUFFER' },
          },
          {
            pool: 'PLACE', combination: [2], stake: 10,
            decision: { status: 'PAPER', reasonCode: 'MODEL_NOT_PROMOTED' },
          },
        ],
      }],
    });

    const [cashLine, paperLine] = audit.runs[0].lines;
    assert.equal(cashLine.t3Market.dividendPer10, 18);
    assert.equal(cashLine.t3Market.minutesToPost, 3);
    assert.equal(cashLine.indicativeClv, 0.1111);
    assert.equal(cashLine.priceSlippageToT3, -0.1);
    assert.equal(cashLine.officialDividendChangeFromLock, -0.495);
    assert.equal(paperLine.status, 'PASS');
    assert.deepEqual(paperLine.paper, {
      status: 'HIT', stake: 10, dividendPer10: 15, returned: 15, profit: 5,
    });
    assert.equal(audit.summary.clvLines, 1);
    assert.equal(audit.summary.averageIndicativeClv, 0.1111);
    assert.equal(audit.summary.paperStake, 10);
    assert.equal(audit.summary.paperReturn, 15);
    assert.equal(audit.summary.paperRoi, 0.5);
    assert.equal(audit.summary.maxDrawdown, 0);
    assert.equal(audit.summary.paperMaxDrawdown, 0);
  });

  it('exports a pure official-dividend settlement helper for shared prospective use', () => {
    const hit = settleLineFromOfficialDividends({
      pool: 'QUINELLA PLACE',
      combination: [2, 1],
      stake: 10,
      dividends: settledRace().dividends,
    });
    const miss = settleLineFromOfficialDividends({
      pool: 'WIN',
      combination: [8],
      stake: 10,
      dividends: settledRace().dividends,
    });

    assert.deepEqual(hit, {
      poolKey: 'quinellaPlace',
      combination: [1, 2],
      dividendPer10: 13.5,
      returned: 13.5,
      profit: 3.5,
      status: 'HIT',
    });
    assert.deepEqual(miss, {
      poolKey: 'win',
      combination: [8],
      dividendPer10: null,
      returned: 0,
      profit: -10,
      status: 'MISS',
    });
  });
});

function settledRace() {
  return {
    raceId: '2026-07-04-ST-1',
    date: '2026-07-04',
    startTime: '16:00',
    status: 'settled',
    runners: [
      { placing: 1, horseNo: 2, horseId: 'HK_2025_L245', horseName: 'ALMIGHTY WARRIOR', winOdds: 7.8 },
      { placing: 2, horseNo: 1, horseId: 'HK_2025_L441', horseName: 'JEDI SPURS', winOdds: 1.1 },
      { placing: 3, horseNo: 9, horseId: 'HK_2025_L393', horseName: 'QUANTUM WUKONG', winOdds: 15 },
    ],
    dividends: {
      win: [{ pool: 'WIN', combination: [2], dividendPer10: 78 }],
      place: [
        { pool: 'PLACE', combination: [2], dividendPer10: 15 },
        { pool: 'PLACE', combination: [1], dividendPer10: 10.1 },
      ],
      quinellaPlace: [{ pool: 'QUINELLA PLACE', combination: [1, 2], dividendPer10: 13.5 }],
    },
  };
}

function recommendationRun(runId, generatedAt, mode, horseNo) {
  return {
    runId,
    raceId: '2026-07-04-ST-1',
    generatedAt,
    strategyVersion: 'ev-portfolio-v1',
    summary: { mode },
    recommendations: [{ pool: 'PLACE', combination: [horseNo], stake: 10 }],
  };
}
