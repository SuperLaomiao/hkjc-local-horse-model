export const PRIMARY_PANEL_IDS = [
  'score-strip',
  'final-bet-plan',
  'staking-strategy',
  'prediction-table',
];

export const TOOL_TABS = [
  {
    id: 'multi-play-portfolio',
    label: '组合下注',
    eyebrow: 'ROI 组合',
    description: '独赢、位置、位置Q、连赢只展示当前结构化组合。',
  },
  {
    id: 'pool-guide',
    label: '玩法库',
    eyebrow: '票面说明',
    description: '把不同票种拆成怎么玩、怎么填、什么时候不要碰。',
  },
  {
    id: 'adaptive-route',
    label: '动态路线',
    eyebrow: '连场资金',
    description: '按上一场输赢决定后面几场减仓、停手或保护利润。',
  },
  {
    id: 'review',
    label: '复盘台',
    eyebrow: '赛后对账',
    description: '看本场赛果、我的纸上单和最近预测 vs 结果。',
  },
  {
    id: 'performance',
    label: '成绩',
    eyebrow: 'Backtest',
    description: '集中看 ROI、命中率、派彩回报和资金曲线。',
  },
  {
    id: 'discipline',
    label: '纪律',
    eyebrow: '风险线',
    description: '保留刷新窗口、停止规则和模型假设。',
  },
];

export const TOOL_TAB_IDS = TOOL_TABS.map((tab) => tab.id);

export function getToolTab(toolId) {
  return TOOL_TABS.find((tab) => tab.id === toolId) ?? TOOL_TABS[0];
}

export function getDashboardLayoutSections(options = {}) {
  const activeTool = getToolTab(options.selectedToolId);

  return {
    primaryPanelIds: [...PRIMARY_PANEL_IDS],
    toolTabs: TOOL_TABS.map((tab) => ({ ...tab, isActive: tab.id === activeTool.id })),
    activeTool,
  };
}

export function formatRaceContext(entry = {}) {
  const date = entry.date ?? '-';
  const course = racecourseName(entry.racecourse);
  const raceNo = Number.isFinite(Number(entry.raceNo)) ? `R${Number(entry.raceNo)}` : 'R-';
  return `${date} ${course} ${raceNo}`;
}

export function buildBettingAvailability({ entry = {}, today } = {}) {
  const context = formatRaceContext(entry);
  const raceDate = entry.date ?? null;

  if (!raceDate || !today) {
    return {
      canBetNow: false,
      label: '现在不能押',
      tone: 'closed',
      headline: '现在不能押',
      detail: '还没有确认今日香港本地赛程；等官方赛程和赛马当天再检查。',
    };
  }

  if (entry.settlement) {
    return {
      canBetNow: false,
      label: '现在不能押',
      tone: 'closed',
      headline: `现在不能押 · ${context}`,
      detail: `${context} 已经结算，不能再下注；请看复盘结果。`,
    };
  }

  if (raceDate !== today) {
    return {
      canBetNow: false,
      label: '现在不能押',
      tone: 'closed',
      headline: `现在不能押 · ${context}`,
      detail: `这场不是今天的投注日，只能等赛马当天（${raceDate}）再押。今天可以先看候选和风险，不要去窗口下注。`,
    };
  }

  return {
    canBetNow: true,
    label: '今天现在可以押',
    tone: 'open',
    headline: `今天现在可以押 · ${context}`,
    detail: `${context} 是今天的赛事；仍然按 T-30 复核、T-10~T-5 执行，赔率或临场变化不达标就 PASS。`,
  };
}

function racecourseName(code) {
  if (code === 'ST') return '沙田';
  if (code === 'HV') return '跑马地';
  return code ?? '-';
}
