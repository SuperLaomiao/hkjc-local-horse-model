const RESEARCH_SOURCES = [
  {
    name: 'Ganyan',
    url: 'https://github.com/fatihbozdag/Ganyan',
    type: 'Open-source racetrack system',
    lesson: '把 LightGBM ranker、Bayesian Plackett-Luce、Harville 组合概率和赛后 ledger 放在同一条链路里；同时用 ROI 回撤说明避免被小样本高派彩骗到。',
    borrow: 'Bayes/置信门槛、Harville 组合拆解、trip-wire、真实 ledger 复盘。',
  },
  {
    name: 'HKJC Horse-Racing ML Research Platform',
    url: 'https://github.com/stevw-repo/HKJC-Horse-Racing-ML-Research-Project',
    type: 'HKJC research sandbox',
    lesson: '本地研究平台应把 WIN/PLACE 概率、即时赔率、Kelly variants 和 honest backtest 分开记录。',
    borrow: '实时赔率融合、fractional Kelly sweep、风险上限、多资金规模回测。',
  },
  {
    name: 'Hongkong-Horse-Racing-Prediction',
    url: 'https://github.com/anton-schwarberg/Hongkong-Horse-Racing-Prediction',
    type: 'HKJC historical ML pipeline',
    lesson: '严格时间切分、无未来数据泄漏、概率校准和字段重要性比单纯命中率更能反映模型质量。',
    borrow: '时间切分验证、校准曲线、SHAP/feature importance 思路、官方 rating/实时马表特征。',
  },
  {
    name: 'Keiba AI',
    url: 'https://github.com/tsukasaI/keiba-ai',
    type: 'JRA expected-value system',
    lesson: '下注入口应围绕 expected value：预测概率 × 赔率/派彩，未过阈值就 PASS。',
    borrow: 'EV 阈值、paper-trading loop、组合赔率验证后再实注。',
  },
  {
    name: 'Horse-Racing-Prediction-HKJC',
    url: 'https://github.com/PeterLiuLiuLiu/Horse-Racing-Prediction-HKJC',
    type: 'HKJC + Benter-style prototype',
    lesson: 'Benter 的核心不是神秘规则，而是基本面模型 + 市场赔率修正 + 长期反馈。',
    borrow: 'Benter 路线：基本面概率、市场概率融合、特征数据库长期积累。',
  },
];

const ALGORITHM_BORROWINGS = [
  {
    concept: 'Harville / Plackett-Luce 名次联合概率',
    status: 'active',
    userImpact: '位置、位置Q、连赢不再凭感觉拼组合，而是从同一组胜率推导组合命中率。',
    nextStep: '继续用真实派彩复盘，检查 QPL/连赢是否只是提高命中率但吞掉 ROI。',
  },
  {
    concept: '严格概率评分：Brier Score / Log Loss / 校准桶',
    status: 'active',
    userImpact: '前端成绩页能看到模型是否过度自信，避免只看中不中。',
    nextStep: '按场地、距离、赔率段拆校准，找到模型最容易高估的区间。',
  },
  {
    concept: 'Expected Value 入场线',
    status: 'active',
    userImpact: '推荐会显示期望 ROI、最低派彩，赔率不够就等或 PASS。',
    nextStep: '接入实时赔率/派彩后，把纸上建议转换成 T-30/T-10 的真实入场检查。',
  },
  {
    concept: 'Market odds 市场赔率融合与 favorite-longshot bias 修正',
    status: 'next',
    userImpact: '减少模型单边看好冷门导致整张票被一匹马拖死的风险。',
    nextStep: '抓取独赢、位置、QPL、连赢即时派彩，学习“模型概率 vs 市场概率”的校准权重。',
  },
  {
    concept: 'Fractional Kelly + 资金/单马暴露上限',
    status: 'next',
    userImpact: '把 HK$10-100 的注码从固定规则升级成按 edge、方差和当天亏赢状态自适应。',
    nextStep: '做 Kelly fraction sweep，比较 0.1x、0.25x、0.5x Kelly 在历史回测里的最大回撤。',
  },
  {
    concept: 'Bayesian skip-gate / trip-wire',
    status: 'next',
    userImpact: '模型信心异常或数据质量异常时自动降低建议强度，宁可错过也不硬买。',
    nextStep: '建立最近 90 日信心基线；偏离过大时前端显示“模型状态异常”。',
  },
  {
    concept: 'LightGBM / LambdaRank / 条件 logit 模型族',
    status: 'research-only',
    userImpact: '这是下一代基础胜率模型候选，不会立刻拿来真实下注。',
    nextStep: '等历史数据足够后做时间切分训练和 walk-forward 回测。',
  },
  {
    concept: 'SHAP / feature importance 解释层',
    status: 'research-only',
    userImpact: '以后能解释“为什么看好这匹马”：骑师、档位、路程、近绩还是市场赔率。',
    nextStep: '先补齐官方 rating、马重变化、档位、场地、步速等字段。',
  },
];

const STATUS_LABELS = {
  active: '已进入系统',
  next: '下一步学习',
  'research-only': '研究观察',
};

export function buildResearchUpgradeProgram() {
  return {
    version: 'research-led-v1',
    headline: '研究驱动：先学术与开源验证，再进入下注建议。',
    sources: RESEARCH_SOURCES.map((source) => ({ ...source })),
    algorithmBorrowings: ALGORITHM_BORROWINGS.map((item) => ({
      ...item,
      label: STATUS_LABELS[item.status] ?? item.status,
    })),
    frontendSignals: [
      '研究升级页签',
      '每项机制显示「已进入系统 / 下一步 / 研究观察」',
      '前端解释期望 ROI、概率校准、风险上限，而不只给马号',
      '每日巡检后把模型变化和回测指标一起呈现',
    ],
    guardrail: '只学习公开方法和设计经验，不复制第三方项目代码；所有新机制必须经过本地回测和前端标注后才进入实注建议。',
  };
}

export function summarizeResearchUpgradeProgram(program = buildResearchUpgradeProgram()) {
  const countByStatus = (status) => program.algorithmBorrowings.filter((item) => item.status === status).length;
  const nextItems = program.algorithmBorrowings.filter((item) => item.status === 'next');

  return {
    version: program.version,
    headline: program.headline,
    sourceCount: program.sources.length,
    activeCount: countByStatus('active'),
    nextCount: countByStatus('next'),
    researchOnlyCount: countByStatus('research-only'),
    nextFocus: nextItems.map((item) => item.concept).slice(0, 3).join(' / '),
  };
}
