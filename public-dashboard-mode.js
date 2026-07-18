export function dashboardExecutionPolicy(snapshot = {}) {
  const publication = snapshot?.publication ?? {};
  const functionalPublic = publication.visibility === 'PUBLIC_FUNCTIONAL_SANITIZED'
    && publication.executableRecommendationsPublished === true
    && publication.personalDataPublished === false
    && publication.rowLevelHistoryPublished === false;

  if (functionalPublic) {
    return {
      mode: 'PUBLIC_FUNCTIONAL',
      allowExecutableRecommendations: true,
      allowPersonalStaking: true,
      allowPrivateResearchReports: false,
      label: '公开功能版',
      reason: '预测、EV 与注码工具公开运行；个人记录只保存在本机浏览器。',
    };
  }

  if (publication.visibility === 'PRIVATE_LOCAL') {
    return {
      mode: 'PRIVATE_LOCAL',
      allowExecutableRecommendations: true,
      allowPersonalStaking: true,
      allowPrivateResearchReports: true,
      label: '本地私有版',
      reason: null,
    };
  }

  return {
    mode: 'PUBLIC_RESEARCH_ONLY',
    allowExecutableRecommendations: false,
    allowPersonalStaking: false,
    allowPrivateResearchReports: false,
    label: '公开研究版 · NO BET',
    reason: '发布契约缺失、旧版或不安全；下注工具已自动关闭。',
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
