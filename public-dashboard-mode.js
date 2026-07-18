export function dashboardExecutionPolicy(snapshot = {}) {
  const publication = snapshot?.publication ?? {};
  const publicSanitized = publication.visibility === 'PUBLIC_SANITIZED'
    || publication.executableRecommendationsPublished === false;

  if (publicSanitized) {
    return {
      mode: 'PUBLIC_RESEARCH_ONLY',
      allowExecutableRecommendations: false,
      allowPersonalStaking: false,
      reason: '公开版只发布模型研究预测；个性化注码、票据和执行建议保留在本地私有数据中。',
    };
  }

  return {
    mode: 'PRIVATE_LOCAL',
    allowExecutableRecommendations: true,
    allowPersonalStaking: true,
    reason: null,
  };
}

export function buildPublicPortfolioOptions(snapshot = {}) {
  const policy = dashboardExecutionPolicy(snapshot);
  if (policy.allowExecutableRecommendations) return {};
  return {
    probabilityStatus: 'RESEARCH_ONLY',
    maxBudget: 0,
    bankroll: 0,
    remainingDailyBudget: 0,
  };
}
