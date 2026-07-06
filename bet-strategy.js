const DEFAULT_OPTIONS = {
  minUnit: 10,
  maxBudget: 100,
  defaultBudget: 30,
  placeThreshold: 0.12,
  normalThreshold: 0.15,
  strongThreshold: 0.18,
  veryStrongThreshold: 0.23,
  supportThreshold: 0.105,
  strongSupportThreshold: 0.13,
};

export function buildStakingStrategy(entry, options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const predictions = [...(entry?.forecast?.predictions ?? [])].filter((runner) => Number.isFinite(Number(runner.probability)));
  const [top, second, third] = predictions;

  if (!top || Number(top.probability) < config.placeThreshold) {
    return buildPassStrategy(entry, top, config);
  }

  const hasMarketOdds = predictions.some((runner) => isPositiveNumber(runner.winOdds));
  const confidence = confidenceTier(top, second, third, config);
  const budget = budgetForConfidence(confidence, config);
  const bets = buildBetLines({ top, second, third, budget, confidence, config });
  const totalStake = bets.reduce((sum, bet) => sum + bet.amount, 0);

  return {
    mode: hasMarketOdds ? 'watch' : 'prepare',
    label: labelForConfidence(confidence),
    confidence,
    budget,
    totalStake,
    hasMarketOdds,
    primaryHorse: summarizeHorse(top),
    supportHorses: [second, third].filter(Boolean).map(summarizeHorse),
    bets,
    rationale: rationaleFor({ top, second, third, confidence, hasMarketOdds }),
    checklist: buildChecklist(hasMarketOdds),
    stopRules: buildStopRules(budget),
    disclaimer: '纪律化纸上策略，不保证盈利；最终投注前必须复核官方赔率、退出马、场地和临场变化。',
  };
}

function buildPassStrategy(entry, top, config) {
  return {
    mode: 'pass',
    label: 'PASS / 不下注',
    confidence: 'pass',
    budget: 0,
    totalStake: 0,
    hasMarketOdds: Boolean(entry?.forecast?.predictions?.some((runner) => isPositiveNumber(runner.winOdds))),
    primaryHorse: top ? summarizeHorse(top) : null,
    supportHorses: [],
    bets: [],
    rationale: top
      ? `头号马模型胜率 ${formatPercent(top.probability)} 低于 ${formatPercent(config.placeThreshold)} 的最低入场线。`
      : '没有可用预测。赌少一场也是策略。',
    checklist: ['等待下一场更清晰的概率结构。'],
    stopRules: ['没有达到最低模型信号，直接 PASS。'],
    disclaimer: '纪律化纸上策略，不保证盈利。',
  };
}

function confidenceTier(top, second, third, config) {
  const topProbability = Number(top.probability);
  const secondProbability = Number(second?.probability ?? 0);
  const thirdProbability = Number(third?.probability ?? 0);

  if (topProbability >= config.veryStrongThreshold && secondProbability >= config.strongSupportThreshold && thirdProbability >= config.supportThreshold) {
    return 'very-strong';
  }
  if (topProbability >= config.strongThreshold && secondProbability >= config.strongSupportThreshold && thirdProbability >= config.supportThreshold) {
    return 'strong';
  }
  if (topProbability >= config.normalThreshold) {
    return 'medium';
  }
  return 'low';
}

function budgetForConfidence(confidence, config) {
  if (confidence === 'very-strong') return Math.min(config.maxBudget, 100);
  if (confidence === 'strong') return Math.min(config.maxBudget, 50);
  if (confidence === 'medium') return Math.min(config.maxBudget, config.defaultBudget);
  if (confidence === 'low') return Math.min(config.maxBudget, 10);
  return 0;
}

function buildBetLines({ top, second, third, budget, confidence, config }) {
  if (budget <= 0) return [];

  if (budget <= 10) {
    return [placeBet(config.minUnit, top)];
  }

  if (budget <= 20) {
    return [placeBet(20, top)];
  }

  if (budget <= 30 || confidence === 'medium') {
    return [
      placeBet(20, top),
      winBet(10, top),
    ];
  }

  if (confidence === 'strong') {
    const lines = [
      placeBet(20, top),
    ];

    if (isStrongSupport(second, config)) {
      lines.push(supportPlaceBet(10, second));
      lines.push(qpBet(10, top, second));
    } else {
      lines.push(winBet(10, top));
    }

    if (isUsableSupport(second, config) && isUsableSupport(third, config)) {
      lines.push(qpBet(10, second, third, '两匹支撑马同时进前三，用来对冲主马失位风险。'));
    } else if (isUsableSupport(third, config)) {
      lines.push(qpBet(10, top, third));
    }

    return capLinesToBudget(lines, budget);
  }

  const lines = [
    placeBet(20, top),
  ];

  if (isStrongSupport(second, config)) {
    lines.push(supportPlaceBet(20, second));
  }

  if (isUsableSupport(third, config)) {
    lines.push(supportPlaceBet(10, third));
  }

  if (isStrongSupport(second, config)) {
    lines.push(qpBet(10, top, second));
  }

  if (isUsableSupport(second, config) && isUsableSupport(third, config)) {
    lines.push(qpBet(20, second, third, '两匹支撑马同时进前三，用来对冲主马失位风险。'));
  } else if (isUsableSupport(third, config)) {
    lines.push(qpBet(10, top, third));
  }

  lines.push(winBet(10, top));

  if (confidence === 'very-strong' && second) {
    lines.push(quinellaBet(10, top, second));
  }

  return capLinesToBudget(lines, budget);
}

function capLinesToBudget(lines, budget) {
  const capped = [];
  let total = 0;
  for (const line of lines) {
    if (total + line.amount > budget) continue;
    capped.push(line);
    total += line.amount;
  }
  return capped;
}

function placeBet(amount, horse) {
  return betLine('PLACE', '位置', amount, [horse], '主打进前三；比独赢更适合当前模型。');
}

function supportPlaceBet(amount, horse) {
  return betLine('PLACE', '位置', amount, [horse], '支撑马位置对冲；避免所有现金注单都依赖同一匹核心马。');
}

function winBet(amount, horse) {
  return betLine('WIN', '独赢', amount, [horse], '小额保留头马 upside；不要重注硬追头马。');
}

function qpBet(amount, first, second, rationale = '两匹同时进前三即可；优先于连赢。') {
  return betLine('QUINELLA_PLACE', '位置Q', amount, [first, second], rationale);
}

function quinellaBet(amount, first, second) {
  return betLine('QUINELLA', '连赢', amount, [first, second], '只在强信号时小额尝试冠亚组合，不要求顺序。');
}

function betLine(type, label, amount, horses, rationale) {
  return {
    type,
    label,
    amount,
    horses: horses.map(summarizeHorse),
    rationale,
  };
}

function summarizeHorse(runner) {
  return {
    horseId: runner.horseId ?? null,
    horseNo: runner.horseNo ?? null,
    horseName: runner.horseName ?? null,
    probability: Number.isFinite(Number(runner.probability)) ? Number(runner.probability) : null,
    fairOdds: Number.isFinite(Number(runner.fairOdds)) ? Number(runner.fairOdds) : null,
    winOdds: isPositiveNumber(runner.winOdds) ? Number(runner.winOdds) : null,
  };
}

function labelForConfidence(confidence) {
  if (confidence === 'very-strong') return 'HK$100 / 极强策略';
  if (confidence === 'strong') return 'HK$50 / 强策略';
  if (confidence === 'medium') return 'HK$30 / 标准策略';
  if (confidence === 'low') return 'HK$10 / 轻注观察';
  return 'PASS / 不下注';
}

function rationaleFor({ top, second, third, confidence, hasMarketOdds }) {
  const parts = [
    `头号马模型胜率 ${formatPercent(top.probability)}。`,
  ];
  if (second) parts.push(`第二候选 ${second.horseName} ${formatPercent(second.probability)}。`);
  if (third) parts.push(`第三候选 ${third.horseName} ${formatPercent(third.probability)}。`);
  if (!hasMarketOdds) parts.push('当前没有实时赔率，先作为赛前准备方案。');
  if (confidence === 'very-strong') parts.push('只把极强结构提升到 HK$100。');
  return parts.join(' ');
}

function buildChecklist(hasMarketOdds) {
  return [
    '开跑前 15 分钟复核官方马表、退出马、骑师、场地和赔率。',
    hasMarketOdds ? '赔率已存在，仍需临场确认没有大幅跳水。' : '必须手动查看实时赔率；没有实时赔率就只保留纸上测试。',
    '按显示总额下注，不因为临场情绪加码。',
  ];
}

function buildStopRules(budget) {
  return [
    '任何候选马退出、换骑师或场地明显不利，直接 PASS。',
    '最终赔率太低或页面数据过期，直接 PASS。',
    '单一马匹/核心马暴露过高时，宁愿减注或 PASS，不做伪分散。',
    budget >= 100 ? 'HK$100 是最高档；一日最多一场，不得继续加码。' : '不要为了凑满 HK$100 而增加低质量组合。',
  ];
}

function formatPercent(value) {
  if (!Number.isFinite(Number(value))) return '-';
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function isPositiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function isUsableSupport(runner, config) {
  return Number(runner?.probability ?? 0) >= config.supportThreshold;
}

function isStrongSupport(runner, config) {
  return Number(runner?.probability ?? 0) >= config.strongSupportThreshold;
}
