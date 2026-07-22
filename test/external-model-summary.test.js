import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildExternalComparisonSummary,
  externalModelBenchmarkCards,
} from '../external-model-summary.js';

describe('external model summary helpers', () => {
  it('summarizes model agreement and top picks for the web dashboard', () => {
    const summary = buildExternalComparisonSummary(reportFixture());

    assert.equal(summary.upcomingRaces, 2);
    assert.equal(summary.marketAwareReadyRaces, 2);
    assert.equal(summary.marketAwareShadowRaces, 1);
    assert.equal(summary.marketBaselineReadyRaces, 1);
    assert.equal(summary.currentVsCatSame, 1);
    assert.equal(summary.currentVsMarketSame, 1);
    assert.equal(summary.currentVsBaselineSame, 2);
    assert.deepEqual(summary.rows.map((row) => row.raceNo), [1, 2]);
    assert.equal(summary.rows[0].currentTopPick.label, '#1 A');
    assert.equal(summary.rows[0].catowabisabi.topQuinellaBoxLabel, '1 + 2');
    assert.equal(summary.rows[1].jerrydaphantomMarketAware.label, '#4 D');
    assert.equal(summary.rows[0].marketBaseline.label, '#1 A');
  });

  it('extracts public benchmark cards without treating them as local validation', () => {
    const cards = externalModelBenchmarkCards(reportFixture());

    assert.equal(cards.length, 2);
    assert.equal(cards[0].modelId, 'catowabisabi-lgb-no-odds-proxy');
    assert.equal(cards[0].primary, '+2.6% OOS ROI');
    assert.equal(cards[1].modelId, 'jerrydaphantom-catboost-market-aware');
    assert.equal(cards[1].primary, '32.7% Top Pick');
    assert.match(cards[1].secondary, /LogLoss 0.2350/);
  });
});

function reportFixture() {
  return {
    generatedAt: '2026-07-08T00:00:00.000Z',
    summary: {
      upcomingRaces: 2,
      marketAwareReadyRaces: 2,
      marketAwareShadowRaces: 1,
    },
    models: [
      {
        modelId: 'catowabisabi-lgb-no-odds-proxy',
        referenceMetrics: {
          headline: '+2.6% OOS ROI',
          detail: '2018 H1 top-2 Quinella box',
        },
      },
      {
        modelId: 'jerrydaphantom-catboost-market-aware',
        referenceMetrics: {
          topPickWinRate: 0.327,
          logLoss: 0.234958,
          brierScore: 0.065478,
        },
      },
    ],
    races: [
      race(1, pick(1, 'A'), pick(1, 'A'), [1, 2], pick(3, 'C'), pick(1, 'A'), 'available'),
      race(2, pick(4, 'D'), pick(6, 'F'), [6, 7], pick(4, 'D'), pick(4, 'D'), 'pending-live-market'),
    ],
  };
}

function race(raceNo, current, cat, quinella, marketAware, marketBaseline, marketBaselineStatus) {
  return {
    raceId: `2026-07-08-HV-${raceNo}`,
    raceNo,
    comparison: {
      currentTopPick: current,
      catowabisabi: {
        topPick: cat,
        topQuinellaBox: quinella,
      },
      jerrydaphantomMarketAware: {
        status: 'available',
        topPick: marketAware,
      },
      marketBaseline: {
        status: marketBaselineStatus,
        topPick: marketBaseline,
      },
      agreementSummary: 'fixture',
    },
  };
}

function pick(horseNo, horseName) {
  return {
    horseNo,
    horseName,
    probability: 0.2,
  };
}
