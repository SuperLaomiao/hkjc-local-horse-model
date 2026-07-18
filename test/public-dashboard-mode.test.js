import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildPublicPortfolioOptions,
  dashboardExecutionPolicy,
} from '../public-dashboard-mode.js';

describe('public dashboard execution boundary', () => {
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
    assert.deepEqual(buildPublicPortfolioOptions({}), {});
  });
});
