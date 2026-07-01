import { buildStakingStrategy } from "./bet-strategy.js";

const DEFAULT_RECOMMENDATION_OPTIONS = {
  placeThreshold: 0.12,
  winThreshold: 0.15,
  supportThreshold: 0.105,
  strongSupportThreshold: 0.13,
};

const BET_TYPE_GUIDES = [
  {
    type: "WIN",
    label: "獨贏",
    englishName: "Win",
    shortLabel: "独赢 WIN",
    category: "单场基础",
    ticketColor: "蓝色票 / 绿色票",
    minUnit: "HK$10",
    risk: "中",
    difficulty: 2,
    payoutPool: "82.5%",
    howToWin: "选中的马必须跑第 1。",
    howToFill: "选 Race No.，勾 WIN，再勾马号和注码。",
    modelUse: "只适合模型头号马胜率清楚、且临场赔率高过最低赔率线时小注。",
    caution: "不要因为名字顺眼硬买头马；头马波动最大。",
  },
  {
    type: "PLACE",
    label: "位置",
    englishName: "Place",
    shortLabel: "位置 PLA",
    category: "单场基础",
    ticketColor: "蓝色票 / 绿色票",
    minUnit: "HK$10",
    risk: "低-中",
    difficulty: 1,
    payoutPool: "82.5%",
    howToWin: "通常 7 匹或以上跑入前 3；4-6 匹跑入前 2。",
    howToFill: "选 Race No.，勾 PLA，再勾马号和注码。你今天三张就是这个。",
    modelUse: "当前模型最适合先用它做低波动测试。",
    caution: "命中率更高，但派彩通常比独赢低。",
  },
  {
    type: "QUINELLA",
    label: "連贏",
    englishName: "Quinella",
    shortLabel: "连赢 QIN",
    category: "单场组合",
    ticketColor: "蓝色票 / 绿色票",
    minUnit: "HK$10",
    risk: "中-高",
    difficulty: 3,
    payoutPool: "82.5%",
    howToWin: "选 2 匹马包办第 1 和第 2，次序不限。",
    howToFill: "选 QIN，勾两匹马；有胆马时可勾 Banker。",
    modelUse: "只在头号和第二候选都很强时小注。",
    caution: "比位置Q难很多，不要每场都打。",
  },
  {
    type: "QUINELLA_PLACE",
    label: "位置Q",
    englishName: "Quinella Place",
    shortLabel: "位置Q QPL",
    category: "单场组合",
    ticketColor: "蓝色票 / 绿色票",
    minUnit: "HK$10",
    risk: "中",
    difficulty: 2,
    payoutPool: "82.5%",
    howToWin: "选 2 匹马，两匹都进入位置名次即可。",
    howToFill: "选 QPL，勾两匹马；也可用 Banker 胆拖。",
    modelUse: "比连赢更适合我们的概率模型；有 2-3 匹强候选时才考虑。",
    caution: "仍然是组合票，别用它替代每场位置。",
  },
  {
    type: "FORECAST",
    label: "二重彩",
    englishName: "Forecast",
    shortLabel: "二重彩 FCT",
    category: "顺序彩池",
    ticketColor: "绿色票",
    minUnit: "HK$1",
    risk: "高",
    difficulty: 4,
    payoutPool: "80.5%",
    howToWin: "选中第 1、第 2 名，并且次序要完全正确。",
    howToFill: "选 FCT/二重彩，在第一名栏和第二名栏分别勾马号。",
    modelUse: "目前只建议纸上测试；模型还没有充分验证名次顺序能力。",
    caution: "比连赢多了顺序要求，错一位就不中。",
  },
  {
    type: "TRIO",
    label: "單T",
    englishName: "Trio",
    shortLabel: "单T TRIO",
    category: "单场组合",
    ticketColor: "红色票 / 绿色票",
    minUnit: "HK$1",
    risk: "高",
    difficulty: 4,
    payoutPool: "77%",
    howToWin: "选 3 匹马包办前三名，次序不限。",
    howToFill: "选 TRI/单T，勾三匹；可用 Banker 胆拖。",
    modelUse: "只适合纸上测试头三候选结构，不作为常规实注。",
    caution: "表面不用顺序，但三匹都要进前三，很吃稳定性。",
  },
  {
    type: "TIERCE",
    label: "三重彩",
    englishName: "Tierce",
    shortLabel: "三重彩 TCE",
    category: "顺序彩池",
    ticketColor: "橙色票",
    minUnit: "HK$1",
    risk: "很高",
    difficulty: 5,
    payoutPool: "75%",
    howToWin: "选中第 1、第 2、第 3 名，次序完全正确。",
    howToFill: "在 1st / 2nd / 3rd Horse 栏分别勾马号，可用 Multiple/Banker。",
    modelUse: "当前不建议实注；只记录纸上候选，等历史复盘够了再说。",
    caution: "赔率诱人，但命中难度非常高。",
  },
  {
    type: "FIRST4",
    label: "四連環",
    englishName: "First 4",
    shortLabel: "四连环 F-F",
    category: "单场组合",
    ticketColor: "红色票",
    minUnit: "HK$1",
    risk: "很高",
    difficulty: 5,
    payoutPool: "75%",
    howToWin: "选 4 匹马包办前四名，次序不限。",
    howToFill: "选 First 4 / 四连环，勾四匹或用 Banker。",
    modelUse: "只适合做娱乐/纸上统计，不进主策略。",
    caution: "四匹都要跑进前四，容错很小。",
  },
  {
    type: "QUARTET",
    label: "四重彩",
    englishName: "Quartet",
    shortLabel: "四重彩 QTT",
    category: "顺序彩池",
    ticketColor: "棕色票",
    minUnit: "HK$1",
    risk: "极高",
    difficulty: 5,
    payoutPool: "75%",
    howToWin: "选中第 1 至第 4 名，且次序完全正确。",
    howToFill: "在 1st / 2nd / 3rd / 4th 栏分别勾马号。",
    modelUse: "当前直接 PASS；没有顺序模型前不拿它当赚钱策略。",
    caution: "这是高方差玩法，别被高派彩牵着走。",
  },
  {
    type: "DOUBLE",
    label: "孖寶",
    englishName: "Double",
    shortLabel: "孖宝 DBL",
    category: "多场过关",
    ticketColor: "绿色票",
    minUnit: "HK$10",
    risk: "高",
    difficulty: 4,
    payoutPool: "82.5%",
    howToWin: "连续两关都选中头马；通常有安慰奖规则，以官方公布为准。",
    howToFill: "选首关 Race No.，分别在两关勾马号和注码。",
    modelUse: "需要同时有两场强信号；当前先不实注。",
    caution: "跨场相关风险大，一关错就大多归零。",
  },
  {
    type: "TREBLE",
    label: "三寶",
    englishName: "Treble",
    shortLabel: "三宝 TBL",
    category: "多场过关",
    ticketColor: "绿色票",
    minUnit: "HK$1 / HK$10",
    risk: "很高",
    difficulty: 5,
    payoutPool: "75%",
    howToWin: "连续三关都选中头马；通常有安慰奖规则，以官方公布为准。",
    howToFill: "选首关 Race No.，三关各勾马号。",
    modelUse: "不进主策略；等多场组合回测后再开放。",
    caution: "容易把小错误放大成全输。",
  },
  {
    type: "SIX_UP",
    label: "六環彩",
    englishName: "Six Up",
    shortLabel: "六环彩 SIX UP",
    category: "多场过关",
    ticketColor: "绿色票",
    minUnit: "HK$2",
    risk: "极高",
    difficulty: 5,
    payoutPool: "75%",
    howToWin: "指定 6 关，每关选中第 1 或第 2；全中或部分命中奖项按官方规则。",
    howToFill: "选首关 Race No.，六关各勾选择和注码。",
    modelUse: "当前不建议实注，只能做纸上长期统计。",
    caution: "看起来每关前二，实际六关连中非常难。",
  },
  {
    type: "ALL_UP",
    label: "過關",
    englishName: "All Up",
    shortLabel: "过关 ALL UP",
    category: "多场过关",
    ticketColor: "蓝色票 / 绿色票",
    minUnit: "HK$1 / HK$10",
    risk: "高",
    difficulty: 4,
    payoutPool: "视彩池而定",
    howToWin: "把两场或以上的独赢/位置/连赢/位置Q等串起来，每关都要中。",
    howToFill: "选 All Up/过关，填公式 2x1、3x1、3x3 等，再勾每关选择。",
    modelUse: "只在每一关都有独立强信号时纸上模拟。",
    caution: "不要为了提高派彩把弱场硬塞进去。",
  },
  {
    type: "DOUBLE_TRIO",
    label: "孖T",
    englishName: "Double Trio",
    shortLabel: "孖T D-T",
    category: "多场组合",
    ticketColor: "红色票",
    minUnit: "HK$1 / HK$10",
    risk: "极高",
    difficulty: 5,
    payoutPool: "75%",
    howToWin: "连续两关都选中单T：每关 3 匹包办前三，次序不限。",
    howToFill: "选 D-T/孖T，填首关 Race No.，两关分别勾三匹。",
    modelUse: "当前 PASS；需要稳定前三组合模型。",
    caution: "两个单T串起来，波动极大。",
  },
  {
    type: "TRIPLE_TRIO",
    label: "三T",
    englishName: "Triple Trio",
    shortLabel: "三T T-T",
    category: "多场组合",
    ticketColor: "红色票",
    minUnit: "HK$2",
    risk: "极高",
    difficulty: 5,
    payoutPool: "75%",
    howToWin: "连续三关都选中单T。",
    howToFill: "选 T-T/三T，三关分别勾三匹或胆拖。",
    modelUse: "不进当前策略。",
    caution: "娱乐性强，策略性弱。",
  },
  {
    type: "JOCKEY_CHALLENGE",
    label: "騎師王",
    englishName: "Jockey Challenge",
    shortLabel: "骑师王 JKC",
    category: "全日挑战",
    ticketColor: "黑色票",
    minUnit: "HK$10",
    risk: "中-高",
    difficulty: 4,
    payoutPool: "固定赔率",
    howToWin: "选一名骑师，按全日指定赛事积分最高者胜出。",
    howToFill: "在 JKC 项目编号下勾骑师编号和注码。",
    modelUse: "当前模型按单场马匹预测，还未做骑师全日积分模型，所以先 PASS。",
    caution: "要看每位骑师全日坐骑质量，不是单看名气。",
  },
  {
    type: "TRAINER_CHALLENGE",
    label: "練馬師王",
    englishName: "Trainer Challenge",
    shortLabel: "练马师王 TNC",
    category: "全日挑战",
    ticketColor: "黑色票",
    minUnit: "HK$10",
    risk: "中-高",
    difficulty: 4,
    payoutPool: "固定赔率",
    howToWin: "选一名练马师，按全日指定赛事积分最高者胜出。",
    howToFill: "在 TNC 项目编号下勾练马师编号和注码。",
    modelUse: "当前还没有练马师全日积分模型，所以先 PASS。",
    caution: "要整天赛程一起算，不能只看一匹热门马。",
  },
];

const GUIDE_BY_TYPE = new Map(BET_TYPE_GUIDES.map((guide) => [guide.type, guide]));

export function getBetTypeGuides() {
  return BET_TYPE_GUIDES.map((guide) => ({ ...guide }));
}

export function getBetTypeGuide(type) {
  return { ...(GUIDE_BY_TYPE.get(type) ?? GUIDE_BY_TYPE.get("PLACE")) };
}

export function buildPoolGuideRecommendation(entry, type, options = {}) {
  const config = { ...DEFAULT_RECOMMENDATION_OPTIONS, ...options };
  const guide = getBetTypeGuide(type);
  const predictions = rankedPredictions(entry);
  const [top, second, third, fourth] = predictions;
  const strategy = buildStakingStrategy(entry);
  const strategyBet = strategy.bets.find((bet) => bet.type === guide.type);
  const noPrediction = !top;

  if (noPrediction) {
    return recommendation({
      guide,
      status: "PASS",
      badge: "PASS / 无数据",
      stake: 0,
      selections: [],
      ticketText: "没有可用预测，直接不买。",
      rationale: "本场没有模型预测数据，不能硬凑玩法。",
      reviewType: guide.type,
    });
  }

  if (guide.type === "PLACE") {
    const stake = strategyBet?.amount ?? (Number(top.probability) >= config.placeThreshold ? 10 : 0);
    return recommendation({
      guide,
      status: stake > 0 ? "PLAY" : "PASS",
      badge: stake > 0 ? "可低注 / 主策略" : "PASS / 信号不足",
      stake,
      selections: [selection(top)],
      ticketText: stake > 0 ? `PLA 位置：No.${top.horseNo} ${top.horseName}，${formatHkd(stake)}。` : "头号马概率未到位置入场线。",
      rationale: stake > 0
        ? `头号马模型胜率 ${formatPercent(top.probability)}；位置比独赢更适合先控制波动。`
        : `头号马模型胜率 ${formatPercent(top.probability)}，低于位置入场线 ${formatPercent(config.placeThreshold)}。`,
      reviewType: "PLACE",
    });
  }

  if (guide.type === "WIN") {
    const stake = strategyBet?.amount ?? (Number(top.probability) >= config.winThreshold ? 10 : 0);
    return recommendation({
      guide,
      status: stake > 0 ? "SMALL" : "PASS",
      badge: stake > 0 ? "小注 / 看赔率" : "PASS / 不追头马",
      stake,
      selections: [selection(top)],
      ticketText: stake > 0 ? `WIN 独赢：No.${top.horseNo} ${top.horseName}，最多 ${formatHkd(stake)}。` : "不买独赢，等更清晰赔率。",
      rationale: stake > 0
        ? `独赢只保留小额 upside；开跑前仍要确认实时赔率高过最低赔率线。`
        : `当前头号马胜率 ${formatPercent(top.probability)} 不够让独赢成为主策略。`,
      reviewType: "WIN",
    });
  }

  if (guide.type === "QUINELLA_PLACE") {
    const pair = [top, second].filter(Boolean);
    const pairIsUsable = pair.length === 2 && Number(second.probability) >= config.supportThreshold;
    const stake = strategyBet?.amount ?? (pairIsUsable ? 10 : 0);
    return recommendation({
      guide,
      status: stake > 0 ? "SMALL" : "PAPER",
      badge: stake > 0 ? "可小注 / 组合" : "纸上 / 等支持马",
      stake,
      selections: pair.map(selection),
      ticketText: stake > 0
        ? `QPL 位置Q：No.${top.horseNo} + No.${second.horseNo}，${formatHkd(stake)}。`
        : "只做纸上：等第二候选概率更稳再买位置Q。",
      rationale: stake > 0
        ? `两匹同时进位置即可，比连赢更贴近当前模型能力。`
        : `第二候选胜率 ${formatPercent(second?.probability)} 还不够稳。`,
      reviewType: "QUINELLA_PLACE",
    });
  }

  if (guide.type === "QUINELLA") {
    const pair = [top, second].filter(Boolean);
    const stake = strategyBet?.amount ?? 0;
    return recommendation({
      guide,
      status: stake > 0 ? "SMALL" : "PAPER",
      badge: stake > 0 ? "极小注 / 强信号" : "纸上 / 不实注",
      stake,
      selections: pair.map(selection),
      ticketText: stake > 0
        ? `QIN 连赢：No.${top.horseNo} + No.${second.horseNo}，${formatHkd(stake)}。`
        : `纸上连赢：No.${top.horseNo} + ${second ? `No.${second.horseNo}` : "第二候选"}；暂不实注。`,
      rationale: stake > 0
        ? "只有极强结构才把连赢放入策略，且只保留 HK$10。"
        : "连赢必须包办冠亚，难度明显高过位置Q。",
      reviewType: "QUINELLA",
    });
  }

  if (guide.type === "FORECAST") {
    return recommendation({
      guide,
      status: "PAPER",
      badge: "纸上 / 顺序未验证",
      stake: 0,
      selections: [top, second].filter(Boolean).map(selection),
      ticketText: second ? `纸上 FCT：No.${top.horseNo} → No.${second.horseNo}。` : "缺第二候选，不玩。",
      rationale: "二重彩要精确冠亚顺序，当前模型只先做概率排序，顺序彩池暂不实注。",
      reviewType: "FORECAST",
    });
  }

  if (guide.type === "TRIO") {
    const trio = [top, second, third].filter(Boolean);
    return recommendation({
      guide,
      status: trio.length === 3 ? "PAPER" : "PASS",
      badge: trio.length === 3 ? "纸上 / 观察前三" : "PASS / 候选不足",
      stake: 0,
      selections: trio.map(selection),
      ticketText: trio.length === 3 ? `纸上 TRI：${trio.map((runner) => `No.${runner.horseNo}`).join(" + ")}。` : "候选不足，不玩。",
      rationale: "单T不用顺序，但要三匹全进前三；先用历史复盘证明再考虑小注。",
      reviewType: "TRIO",
    });
  }

  if (guide.type === "TIERCE") {
    const tierce = [top, second, third].filter(Boolean);
    return recommendation({
      guide,
      status: "PASS",
      badge: "PASS / 太高波动",
      stake: 0,
      selections: tierce.map(selection),
      ticketText: tierce.length === 3 ? `若纸上看：No.${top.horseNo} → No.${second.horseNo} → No.${third.horseNo}。` : "候选不足，不玩。",
      rationale: "三重彩必须前三顺序完全正确；现在不要把它当赚钱主线。",
      reviewType: "TIERCE",
    });
  }

  if (guide.type === "FIRST4") {
    const first4 = [top, second, third, fourth].filter(Boolean);
    return recommendation({
      guide,
      status: first4.length === 4 ? "PAPER" : "PASS",
      badge: first4.length === 4 ? "纸上 / 四匹观察" : "PASS / 候选不足",
      stake: 0,
      selections: first4.map(selection),
      ticketText: first4.length === 4 ? `纸上四连环：${first4.map((runner) => `No.${runner.horseNo}`).join(" + ")}。` : "候选不足，不玩。",
      rationale: "四连环不用顺序，但四匹要包办前四；当前只做学习复盘。",
      reviewType: "FIRST4",
    });
  }

  if (guide.type === "QUARTET") {
    const quartet = [top, second, third, fourth].filter(Boolean);
    return recommendation({
      guide,
      status: "PASS",
      badge: "PASS / 顺序极难",
      stake: 0,
      selections: quartet.map(selection),
      ticketText: quartet.length === 4 ? `若纸上看：${quartet.map((runner) => `No.${runner.horseNo}`).join(" → ")}。` : "候选不足，不玩。",
      rationale: "四重彩要前四顺序完全正确，当前模型没有足够顺序优势。",
      reviewType: "QUARTET",
    });
  }

  if (["DOUBLE", "TREBLE", "SIX_UP", "ALL_UP", "DOUBLE_TRIO", "TRIPLE_TRIO"].includes(guide.type)) {
    return recommendation({
      guide,
      status: "PAPER",
      badge: "纸上 / 多场未接入",
      stake: 0,
      selections: [selection(top)],
      ticketText: `本场只记录核心候选 No.${top.horseNo}；多场串关暂不实注。`,
      rationale: "多场玩法需要把几场的候选一起优化和复盘；当前页面先按单场给建议。",
      reviewType: guide.type,
      reviewable: false,
    });
  }

  if (["JOCKEY_CHALLENGE", "TRAINER_CHALLENGE"].includes(guide.type)) {
    return recommendation({
      guide,
      status: "PASS",
      badge: "PASS / 模型未覆盖",
      stake: 0,
      selections: [],
      ticketText: "当前不买。以后可单独做骑师王/练马师王积分模型。",
      rationale: "它不是选某匹马，而是算全日骑师/练马师积分；当前马匹模型不能直接替代。",
      reviewType: guide.type,
      reviewable: false,
    });
  }

  return recommendation({
    guide,
    status: "PASS",
    badge: "PASS",
    stake: 0,
    selections: [],
    ticketText: "暂不支持这个玩法。",
    rationale: "先保守处理。",
    reviewType: guide.type,
    reviewable: false,
  });
}

export function settlePoolGuideRecommendation(entry, recommendation) {
  if (!recommendation?.reviewable) {
    return {
      status: "NOT_REVIEWED",
      label: "暂不复盘",
      detail: "这个玩法需要多场/全日数据，当前只展示规则和建议。",
    };
  }

  return settleSelection(entry, recommendation.reviewType, recommendation.selections ?? []);
}

export function settleStrategyBetLine(entry, bet) {
  const settlement = settleSelection(entry, bet.type, bet.horses ?? []);
  return {
    ...settlement,
    amount: bet.amount,
    label: bet.label,
  };
}

function settleSelection(entry, type, selections) {
  const runnerResults = entry?.settlement?.runnerResults ?? [];
  if (!entry?.settlement || runnerResults.length === 0) {
    return {
      status: "OPEN",
      label: "OPEN / 待赛",
      detail: "官方赛果未进入数据，稍后刷新后自动复盘。",
    };
  }

  const runners = selections
    .map((item) => findRunnerResult(runnerResults, item))
    .filter(Boolean);
  const placeCutoff = placeCutoffFor(runnerResults.length);
  const hit = betHit(type, runners, placeCutoff);

  if (runners.length < requiredSelections(type)) {
    return {
      status: "MISS",
      label: "MISS / 未中",
      detail: "复盘候选不足，按未中处理。",
    };
  }

  return {
    status: hit ? "HIT" : "MISS",
    label: hit ? "HIT / 命中" : "MISS / 未中",
    detail: buildSettlementDetail(type, runners, placeCutoff, hit),
    runners: runners.map((runner) => ({
      horseNo: runner.horseNo,
      horseName: runner.horseName,
      placing: runner.placing,
    })),
  };
}

function betHit(type, runners, placeCutoff) {
  if (type === "WIN") return runners.length >= 1 && runners[0].placing === 1;
  if (type === "PLACE") return runners.length >= 1 && runners[0].placing <= placeCutoff;
  if (type === "QUINELLA") return runners.length >= 2 && runners.slice(0, 2).every((runner) => runner.placing <= 2);
  if (type === "QUINELLA_PLACE") return runners.length >= 2 && runners.slice(0, 2).every((runner) => runner.placing <= placeCutoff);
  if (type === "FORECAST") return runners.length >= 2 && runners[0].placing === 1 && runners[1].placing === 2;
  if (type === "TRIO") return runners.length >= 3 && runners.slice(0, 3).every((runner) => runner.placing <= 3);
  if (type === "TIERCE") return runners.length >= 3 && runners[0].placing === 1 && runners[1].placing === 2 && runners[2].placing === 3;
  if (type === "FIRST4") return runners.length >= 4 && runners.slice(0, 4).every((runner) => runner.placing <= 4);
  if (type === "QUARTET") {
    return runners.length >= 4
      && runners[0].placing === 1
      && runners[1].placing === 2
      && runners[2].placing === 3
      && runners[3].placing === 4;
  }
  return false;
}

function requiredSelections(type) {
  if (["WIN", "PLACE"].includes(type)) return 1;
  if (["QUINELLA", "QUINELLA_PLACE", "FORECAST"].includes(type)) return 2;
  if (["TRIO", "TIERCE"].includes(type)) return 3;
  if (["FIRST4", "QUARTET"].includes(type)) return 4;
  return Infinity;
}

function buildSettlementDetail(type, runners, placeCutoff, hit) {
  const resultText = runners
    .map((runner) => `No.${runner.horseNo} ${runner.horseName} 第${runner.placing}`)
    .join("；");
  const placeText = type === "PLACE" || type === "QUINELLA_PLACE" ? `位置线为前 ${placeCutoff}。` : "";
  return `${resultText}。${placeText}${hit ? "这条复盘命中。" : "这条复盘未中。"}`;
}

function findRunnerResult(runnerResults, selectionItem) {
  return runnerResults.find((runner) => {
    if (selectionItem.horseId && runner.horseId === selectionItem.horseId) return true;
    if (selectionItem.horseNo != null && Number(runner.horseNo) === Number(selectionItem.horseNo)) return true;
    return false;
  }) ?? null;
}

function placeCutoffFor(fieldSize) {
  if (fieldSize >= 21) return 4;
  if (fieldSize >= 7) return 3;
  if (fieldSize >= 4) return 2;
  return 0;
}

function rankedPredictions(entry) {
  return [...(entry?.forecast?.predictions ?? [])]
    .filter((runner) => Number.isFinite(Number(runner.probability)))
    .sort((a, b) => Number(b.probability) - Number(a.probability));
}

function selection(runner) {
  return {
    horseId: runner.horseId ?? null,
    horseNo: runner.horseNo ?? null,
    horseName: runner.horseName ?? null,
    probability: Number.isFinite(Number(runner.probability)) ? Number(runner.probability) : null,
  };
}

function recommendation({
  guide,
  status,
  badge,
  stake,
  selections,
  ticketText,
  rationale,
  reviewType,
  reviewable = true,
}) {
  return {
    type: guide.type,
    label: guide.label,
    englishName: guide.englishName,
    status,
    badge,
    stake,
    selections,
    ticketText,
    rationale,
    reviewType,
    reviewable,
    risk: guide.risk,
    minUnit: guide.minUnit,
  };
}

function formatPercent(value) {
  if (!Number.isFinite(Number(value))) return "-";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function formatHkd(value) {
  if (!Number.isFinite(Number(value))) return "HK$0";
  return `HK$${Number(value).toFixed(0)}`;
}
