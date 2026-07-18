import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildPublicPortfolioOptions,
  dashboardExecutionPolicy,
  publicationBadge,
} from '../public-dashboard-mode.js';

describe('public dashboard execution boundary', () => {
  it('enables product tools for the exact sanitized functional contract', () => {
    const snapshot = {
      publication: {
        visibility: 'PUBLIC_FUNCTIONAL_SANITIZED',
        executableRecommendationsPublished: true,
        personalDataPublished: false,
        rowLevelHistoryPublished: false,
      },
    };

    const policy = dashboardExecutionPolicy(snapshot);

    assert.equal(policy.mode, 'PUBLIC_FUNCTIONAL');
    assert.equal(policy.allowExecutableRecommendations, true);
    assert.equal(policy.allowPersonalStaking, true);
    assert.equal(policy.allowPrivateResearchReports, false);
    assert.deepEqual(buildPublicPortfolioOptions(snapshot), {});
  });

  it('forces sanitized snapshots into research-only mode with zero executable budget', () => {
    const snapshot = {
      publication: {
        visibility: 'PUBLIC_SANITIZED',
        executableRecommendationsPublished: false,
      },
    };

    const policy = dashboardExecutionPolicy(snapshot);
    const portfolio = buildPublicPortfolioOptions(snapshot);

    assert.equal(policy.mode, 'PUBLIC_RESEARCH_ONLY');
    assert.equal(policy.allowExecutableRecommendations, false);
    assert.equal(policy.allowPersonalStaking, false);
    assert.equal(policy.allowPrivateResearchReports, false);
    assert.equal(portfolio.probabilityStatus, 'RESEARCH_ONLY');
    assert.equal(portfolio.maxBudget, 0);
    assert.equal(portfolio.bankroll, 0);
    assert.equal(portfolio.remainingDailyBudget, 0);
  });

  it('keeps local/private snapshots eligible for the existing execution checks', () => {
    const policy = dashboardExecutionPolicy({ publication: { visibility: 'PRIVATE_LOCAL' } });

    assert.equal(policy.mode, 'PRIVATE_LOCAL');
    assert.equal(policy.allowExecutableRecommendations, true);
    assert.equal(policy.allowPersonalStaking, true);
    assert.equal(policy.allowPrivateResearchReports, true);
  });

  it('adds a leakage-safe recent confidence baseline when an entry is provided', () => {
    const snapshot = {
      publication: {
        visibility: 'PUBLIC_FUNCTIONAL_SANITIZED',
        executableRecommendationsPublished: true,
        personalDataPublished: false,
        rowLevelHistoryPublished: false,
      },
      recentEntries: [
        settledConfidenceEntry('past-1', '2026-07-01T10:00:00.000Z', 0.28),
        settledConfidenceEntry('past-2', '2026-07-10T10:00:00.000Z', 0.32),
      ],
    };
    const current = {
      raceId: 'current',
      postTime: '2026-07-18T10:00:00.000Z',
      forecast: { predictions: [{ probability: 0.31 }] },
    };

    const options = buildPublicPortfolioOptions(snapshot, current);

    assert.equal(options.uncertaintyContext.confidenceBaseline.sampleSize, 2);
    assert.equal(options.uncertaintyContext.confidenceBaseline.mean, 0.3);
    assert.equal(options.uncertaintyContext.confidenceBaseline.recent, 0.31);
  });

  it('fails closed for missing or unsafe publication contracts', () => {
    const unsafeSnapshot = {
      publication: {
        visibility: 'PUBLIC_FUNCTIONAL_SANITIZED',
        executableRecommendationsPublished: true,
        personalDataPublished: true,
        rowLevelHistoryPublished: false,
      },
    };

    for (const snapshot of [{}, unsafeSnapshot]) {
      const policy = dashboardExecutionPolicy(snapshot);
      const portfolio = buildPublicPortfolioOptions(snapshot);

      assert.equal(policy.mode, 'PUBLIC_RESEARCH_ONLY');
      assert.equal(policy.allowExecutableRecommendations, false);
      assert.equal(policy.allowPersonalStaking, false);
      assert.equal(policy.allowPrivateResearchReports, false);
      assert.equal(portfolio.maxBudget, 0);
      assert.equal(portfolio.bankroll, 0);
      assert.equal(portfolio.remainingDailyBudget, 0);
    }
  });

  it('describes functional and research-only publication modes for the UI', () => {
    assert.deepEqual(publicationBadge({ mode: 'PUBLIC_FUNCTIONAL' }), {
      label: '公开功能版',
      tone: 'functional',
    });
    assert.deepEqual(publicationBadge({ mode: 'PUBLIC_RESEARCH_ONLY' }), {
      label: '公开研究版 · NO BET',
      tone: 'research',
    });
  });
});

function settledConfidenceEntry(raceId, generatedAt, probability) {
  return {
    raceId,
    settlement: { status: 'SETTLED' },
    forecast: {
      generatedAt,
      topPick: { probability },
      predictions: [{ probability }],
    },
  };
}
