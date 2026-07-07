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
    name: 'neigh',
    url: 'https://github.com/larrysammii/neigh',
    type: 'HKJC typed data SDK',
    lesson: 'SpeedPRO current meeting JSON 比普通 racecard 更丰富，包含 sectional times、pace、fitness、comments、incidents 和 health notes。',
    borrow: 'SpeedPRO 特征导入、runner prior-run 展平、公共 unauthenticated 数据边界。',
    accessNote: '网页可读；2026-07-08 git ls-remote 暂时返回 repository not found，导入前需再次确认 clone/包管理器访问。',
  },
  {
    name: 'hkjc-api',
    url: 'https://github.com/Bobosky2005/hkjc-api',
    type: 'HKJC GraphQL odds/pool API',
    lesson: 'HKJC GraphQL 返回的 pmPools 不保证跟请求 oddsTypes 顺序一致，必须按 oddsType 匹配，避免 WIN/PLA/QIN/QPL 错位。',
    borrow: 'live odds/pool 抓取、防错归一化、GraphQL pool investment 字段。',
  },
  {
    name: 'HKJC Pool Money Calculator',
    url: 'https://github.com/Tang6133/hkjc-pool-tracker',
    type: 'Pari-mutuel pool-share methodology',
    lesson: '赔率不是全部；从 total investment、takeout 和 odds 反推每匹马/组合的资金份额，可以识别热门拥挤和冷门噪音。',
    borrow: 'WIN/PLA/QIN/QPL takeout、pool-share 估算、彩池结构特征。',
  },
  {
    name: 'HKJC Edge Lab',
    url: 'https://github.com/justinsuo/hkjc-edge-lab',
    type: 'NO-BET-by-default validation lab',
    lesson: '系统必须能诚实地得出 NO-GO：walk-forward、closing-line value、bootstrap CI 和 placebo 检验比单场命中更重要。',
    borrow: 'NO-BET 默认、CLV 复盘、bootstrap 置信区间、过拟合防线。',
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
    name: 'HKJC Benter Engine',
    url: 'https://github.com/JonzieLo/hkjc-project',
    type: 'Parimutuel pricing and stacker research',
    lesson: 'XGBoost/Cox/Bayesian stacking、copula exotic pricing 和 drift-aware Kelly 很强，但 final dividend 回测容易被 late-money drift 夸大。',
    borrow: 'log-linear/stacking、exotic pool 联合概率、drift-aware EV、simultaneous stake caps。',
  },
  {
    name: 'HKHorseRacing-Predictor',
    url: 'https://github.com/Tang6133/hkhorseracing-predictor',
    type: 'Public prediction archive',
    lesson: '即使模型私有，也可以公开 race-day prediction CSV、calibrated place probability 和产品化解释，方便长期复盘。',
    borrow: '预测归档、place ranking 展示、race-day intelligence UI。',
  },
  {
    name: 'tianxi-database',
    url: 'https://github.com/sleepingarhat/tianxi-database',
    type: 'HKJC data platform',
    lesson: '长期自动更新的数据平台可以作为覆盖率参照，帮助我们发现本地 SQLite 是否缺字段或缺赛季。',
    borrow: '2016-2026 覆盖率对账、每日数据健康检查、Elo-style 特征候选。',
  },
  {
    name: 'hk-racing-quant',
    url: 'https://github.com/kokacheuk-del/hk-racing-quant',
    type: '+EV dashboard prototype',
    lesson: 'P_true vs P_market、+EV 卡片和 1/3 Kelly 展示方式很直观，但启发式权重要先经过我们本地回测。',
    borrow: '+EV UI、市场概率反推、Kelly stake explainability。',
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
    concept: 'Pool money / takeout / crowding features',
    status: 'next',
    userImpact: '不只看赔率高低，还看某匹马或组合是否被资金过度拥挤，减少追热门和错买低价值组合。',
    nextStep: '把 WIN/PLA/QIN/QPL total investment 和 pool-share 估算写入 SQLite market features。',
  },
  {
    concept: 'SpeedPRO sectional / pace / fitness 特征',
    status: 'next',
    userImpact: '模型能解释步速、末段、健康记录和事件评论，而不是只靠历史名次和骑练统计。',
    nextStep: '用 neigh/SpeedPRO JSON 设计无泄漏的 runner prior-run 特征导入器。',
  },
  {
    concept: 'NO-BET default + Closing Line Value 守门',
    status: 'next',
    userImpact: '模型没证明能赢 closing line 时，前端主动显示“不下注/只纸上观察”，防止为了下注而下注。',
    nextStep: '把推荐审计从赛果 ROI 扩展到 CLV、bootstrap CI 和 placebo 检查。',
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
  {
    concept: 'Parimutuel stacker / copula exotic pricing',
    status: 'research-only',
    userImpact: '未来可研究三重彩等高赔率玩法，但必须先证明 final-dividend 回测没有 late-money 偏差。',
    nextStep: '只在 benchmark registry 里登记，不进入现金推荐；先做模拟和误差边界。',
  },
];

const FOLLOW_UP_ACTIONS = [
  {
    id: 'live-snapshot-planner',
    priority: 'P0',
    status: 'queued',
    automationPhase: 'Phase A',
    title: '实现 T-30/T-10/T-3 live snapshot planner',
    sourceRefs: ['hkjc-api', 'HKJC Horse-Racing ML Research Platform'],
    action: '读取 SQLite upcoming races，判断当前 HKT 是否进入 due window，并触发 WIN/PLA/QIN/QPL 抓取。',
    expectedOutcome: '每天巡检能自动积累 2026 临场 odds/pool 数据，先 dry-run 后导入。',
    automationExecutable: true,
  },
  {
    id: 'pool-money-features',
    priority: 'P0',
    status: 'queued',
    automationPhase: 'Phase A/B',
    title: '把 pool money / takeout / crowding 写成市场特征',
    sourceRefs: ['HKJC Pool Money Calculator', 'hkjc-api'],
    action: '从 odds + total investment 估算单马和组合资金份额，进入 odds_snapshots/pool_snapshots 派生特征。',
    expectedOutcome: 'EV 过滤不只依赖赔率，也能识别 crowding 和低价值组合。',
    automationExecutable: true,
  },
  {
    id: 'benchmark-registry-refresh',
    priority: 'P0',
    status: 'queued',
    automationPhase: 'Phase B',
    title: '更新 external benchmark registry',
    sourceRefs: ['catowabisabi', 'jerrydaphantom', 'HKJC Edge Lab', 'HKJC Benter Engine'],
    action: '登记每个外部思路的数据需求、泄漏风险、指标、promotion gate 和现金模式限制。',
    expectedOutcome: 'Research Lab 能显示哪些外部方法已复现、哪些仍不能用于下注。',
    automationExecutable: true,
  },
  {
    id: 'speedpro-feature-importer',
    priority: 'P1',
    status: 'queued',
    automationPhase: 'Phase B',
    title: '设计 SpeedPRO sectional/pace/fitness 特征导入',
    sourceRefs: ['neigh'],
    action: '先做 schema 和无泄漏规则，再导入当前 meeting SpeedPRO，历史回补另列任务。',
    expectedOutcome: '基础模型能学习步速、末段、fitness、incident/comments 的滞后信号。',
    automationExecutable: true,
  },
  {
    id: 'no-bet-clv-gate',
    priority: 'P1',
    status: 'queued',
    automationPhase: 'Phase C',
    title: '加入 NO-BET default 与 CLV 守门',
    sourceRefs: ['HKJC Edge Lab', 'Ganyan'],
    action: '推荐审计增加 closing-line value、bootstrap CI、placebo；未过门槛时现金推荐降级为 paper-only。',
    expectedOutcome: '系统可以诚实地输出 NO BET，而不是每场硬给下注。',
    automationExecutable: true,
  },
  {
    id: 'bayesian-tripwire',
    priority: 'P1',
    status: 'queued',
    automationPhase: 'Phase C',
    title: '建立 Bayesian skip-gate / confidence trip-wire',
    sourceRefs: ['Ganyan'],
    action: '用最近 90 日信心分布作为 baseline，异常过低时暂停建议，异常过高时提示过拟合/数据漂移风险。',
    expectedOutcome: '前端能显示模型状态异常，避免坏数据日继续下注。',
    automationExecutable: true,
  },
  {
    id: 'lightgbm-no-market-benchmark',
    priority: 'P1',
    status: 'queued',
    automationPhase: 'Phase B',
    title: '复现 no-market LightGBM / LambdaRank benchmark',
    sourceRefs: ['Hongkong-Horse-Racing-Prediction', 'catowabisabi'],
    action: '导出 leakage-safe matrix，训练 no-market tree baseline，评估 log loss、Brier、Top-pick 入前三、QIN/QPL ROI。',
    expectedOutcome: '知道我们的基本面模型是否真的比当前 heuristic 强。',
    automationExecutable: true,
  },
  {
    id: 'parimutuel-stacker-copula-study',
    priority: 'P2',
    status: 'research-only',
    automationPhase: 'Phase B/C',
    title: '研究 parimutuel stacker 与 copula exotic pricing',
    sourceRefs: ['HKJC Benter Engine'],
    action: '只做方法笔记和小样本模拟，不进入现金推荐；重点检查 late-money drift 和 final dividend bias。',
    expectedOutcome: '给未来三重彩/四重彩研究保留方向，但不污染当前保守组合。',
    automationExecutable: false,
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
    followUpActions: FOLLOW_UP_ACTIONS.map((item) => ({ ...item })),
    frontendSignals: [
      '研究升级页签',
      '每项机制显示「已进入系统 / 下一步 / 研究观察」',
      'Research Lab 显示可由每日巡检续跑的 follow-up action 队列',
      '前端解释期望 ROI、概率校准、风险上限，而不只给马号',
      '每日巡检后把模型变化和回测指标一起呈现',
    ],
    guardrail: '只学习公开方法和设计经验，不复制第三方项目代码；所有新机制必须经过本地回测和前端标注后才进入实注建议。',
  };
}

export function summarizeResearchUpgradeProgram(program = buildResearchUpgradeProgram()) {
  const countByStatus = (status) => program.algorithmBorrowings.filter((item) => item.status === status).length;
  const nextItems = program.algorithmBorrowings.filter((item) => item.status === 'next');
  const followUpActions = Array.isArray(program.followUpActions) ? program.followUpActions : [];
  const automationReadyActions = followUpActions.filter((item) => item.automationExecutable && item.status === 'queued');
  const firstAction = automationReadyActions[0] ?? followUpActions[0];

  return {
    version: program.version,
    headline: program.headline,
    sourceCount: program.sources.length,
    activeCount: countByStatus('active'),
    nextCount: countByStatus('next'),
    researchOnlyCount: countByStatus('research-only'),
    followUpCount: followUpActions.length,
    automationReadyCount: automationReadyActions.length,
    nextFocus: nextItems.map((item) => item.concept).slice(0, 3).join(' / '),
    nextAction: firstAction ? `${firstAction.priority} ${firstAction.title}` : '暂无排队 action',
  };
}
