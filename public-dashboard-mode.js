import { buildRecentConfidenceBaseline } from './hkjc-horse-model/src/uncertainty-tripwire.js';

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

export function buildPublicPortfolioOptions(snapshot = {}, entry = null) {
  const policy = dashboardExecutionPolicy(snapshot);
  const options = policy.allowExecutableRecommendations
    ? {}
    : {
        probabilityStatus: 'RESEARCH_ONLY',
        maxBudget: 0,
        bankroll: 0,
        remainingDailyBudget: 0,
      };
  const baseline = entry ? buildRecentConfidenceBaseline(snapshot?.recentEntries, {
    currentProbability: entry?.forecast?.topPick?.probability
      ?? entry?.forecast?.predictions?.[0]?.probability,
    asOf: entry?.postTime ?? entry?.scheduledPostTime ?? entry?.date,
    excludeRaceId: entry?.raceId,
  }) : null;
  return baseline
    ? { ...options, uncertaintyContext: { confidenceBaseline: baseline } }
    : options;
}

export function publicationBadge(policy = {}) {
  if (policy.mode === 'PUBLIC_FUNCTIONAL') {
    return { label: '公开功能版', tone: 'functional' };
  }
  if (policy.mode === 'PRIVATE_LOCAL') {
    return { label: '本地私有版', tone: 'private' };
  }
  return { label: '公开研究版 · NO BET', tone: 'research' };
}
