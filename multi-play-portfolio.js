const DEFAULT_OPTIONS = {
  minUnit: 10,
  maxBudget: 100,
  edgeBuffer: 0.08,
  minTopProbability: 0.12,
  minPlaceProbability: 0.28,
  minWinProbability: 0.15,
  minQplProbability: 0.12,
  minQuinellaProbability: 0.055,
};

const POOL_META = {
  WIN: { label: "独赢", role: "cash", priority: 30, minUnit: 10 },
  PLACE: { label: "位置", role: "cash", priority: 10, minUnit: 10 },
  QUINELLA_PLACE: { label: "位置Q", role: "cash", priority: 20, minUnit: 10 },
  QUINELLA: { label: "连赢", role: "cash", priority: 40, minUnit: 10 },
  FORECAST: { label: "二重彩", role: "paper", priority: 80, minUnit: 1 },
  TRIO: { label: "单T", role: "paper", priority: 90, minUnit: 1 },
  TIERCE: { label: "三重彩", role: "paper", priority: 100, minUnit: 1 },
  FIRST4: { label: "四连环", role: "paper", priority: 110, minUnit: 1 },
  QUARTET: { label: "四重彩", role: "paper", priority: 120, minUnit: 1 },
};

export function buildMultiPlayProbabilityBoard(entry, options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const runners = rankedPredictions(entry);
  const [top, second, third, fourth] = runners;

  if (!top) {
    return {
      raceId: entry?.raceId ?? null,
      candidates: [],
      note: "没有预测数据，不能建立玩法概率。",
    };
  }

  const placeCutoff = estimatedPlaceCutoff(runners.length);
  const placeProbabilities = estimatePlaceProbabilities(runners, placeCutoff);
  const candidates = [
    candidate("PLACE", [top], placeProbabilities.get(top.horseId) ?? 0, {
      marketDividendPer10: marketDividend(top, "PLACE"),
      cashEligible: true,
      rationale: "单马进入位置名次，作为组合里的低波动主线。",
    }),
    candidate("WIN", [top], Number(top.probability), {
      marketDividendPer10: marketDividend(top, "WIN"),
      cashEligible: true,
      rationale: "只在实时独赢赔率高过入场线时小注。",
    }),
  ];

  if (second) {
    candidates.push(candidate("QUINELLA_PLACE", [top, second], estimateQplProbability(top, second, placeProbabilities), {
      marketDividendPer10: positiveNumber(config.qplDividendPer10),
      cashEligible: true,
      rationale: "两匹同时进入位置名次；比连赢更贴近当前概率模型。",
    }));
    candidates.push(candidate("QUINELLA", [top, second], estimateQuinellaProbability(top, second), {
      marketDividendPer10: positiveNumber(config.quinellaDividendPer10),
      cashEligible: true,
      rationale: "两匹包办前二且不限顺序，只在强支撑结构中小注。",
    }));
    candidates.push(candidate("FORECAST", [top, second], estimateForecastProbability(top, second), {
      marketDividendPer10: positiveNumber(config.forecastDividendPer10),
      cashEligible: false,
      rationale: "需要精确冠亚顺序；目前作为顺序能力观察。",
    }));
  }

  if (third) {
    candidates.push(candidate("TRIO", [top, second, third], estimateTrioProbability([top, second, third], placeProbabilities), {
      marketDividendPer10: positiveNumber(config.trioDividendPer10),
      cashEligible: false,
      rationale: "三匹包办前三，不限顺序；先纸上复盘命中率。",
    }));
    candidates.push(candidate("TIERCE", [top, second, third], estimateTierceProbability([top, second, third]), {
      marketDividendPer10: positiveNumber(config.tierceDividendPer10),
      cashEligible: false,
      rationale: "三匹前三顺序完全正确，波动过高，暂不实注。",
    }));
  }

  if (fourth) {
    candidates.push(candidate("FIRST4", [top, second, third, fourth], estimateFirst4Probability([top, second, third, fourth], placeProbabilities), {
      marketDividendPer10: positiveNumber(config.first4DividendPer10),
      cashEligible: false,
      rationale: "四匹包办前四，不限顺序；当前只作纸上统计。",
    }));
    candidates.push(candidate("QUARTET", [top, second, third, fourth], estimateQuartetProbability([top, second, third, fourth]), {
      marketDividendPer10: positiveNumber(config.quartetDividendPer10),
      cashEligible: false,
      rationale: "四匹前四顺序完全正确，需要专门顺序模型，暂不实注。",
    }));
  }

  const enriched = candidates
    .map((item) => enrichCandidate(item, config))
    .sort((a, b) => POOL_META[a.type].priority - POOL_META[b.type].priority);

  return {
    raceId: entry?.raceId ?? null,
    date: entry?.date ?? null,
    racecourse: entry?.racecourse ?? null,
    raceNo: entry?.raceNo ?? null,
    placeCutoff,
    candidates: enriched,
    note: "概率由单马胜率外推为位置/组合/顺序玩法，派彩入场线需临场复核。",
  };
}

export function buildStructuredBetPortfolio(entry, options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const board = buildMultiPlayProbabilityBoard(entry, config);
  const top = board.candidates.find((candidate) => candidate.type === "WIN")?.selections?.[0] ?? null;

  if (!top || Number(top.probability) < config.minTopProbability) {
    return {
      mode: "PASS",
      label: "PASS / 无组合入场",
      totalStake: 0,
      cashLines: [],
      watchLines: [],
      paperLines: board.candidates.filter((candidate) => candidate.role === "paper"),
      board,
      summary: "头号马概率不足，多玩法也不硬凑。",
      disclaimer: "不保证盈利；实注前必须复核官方实时赔率、派彩、退出马和场地变化。",
    };
  }

  const cashCandidates = board.candidates.filter((candidate) => candidate.role === "cash");
  const cashLines = buildCashLines(cashCandidates, config);
  const totalStake = cashLines.reduce((sum, line) => sum + line.stake, 0);
  const watchLines = cashCandidates.filter((candidate) => !cashLines.some((line) => line.type === candidate.type));
  const paperLines = board.candidates.filter((candidate) => candidate.role === "paper");

  return {
    mode: cashLines.length ? "PORTFOLIO" : "WATCH",
    label: cashLines.length ? "多玩法组合 / 条件执行" : "WATCH / 等派彩",
    totalStake,
    cashLines,
    watchLines,
    paperLines,
    board,
    summary: cashLines.length
      ? `多玩法组合：${cashLines.map((line) => line.label).join(" + ")}，总额 ${formatHkd(totalStake)}。`
      : "当前没有通过派彩入场线的现金组合，先观察。",
    disclaimer: "组合优化只控制结构和风险，不保证盈利；没有实时派彩达到入场线就不执行。",
  };
}

function buildCashLines(candidates, config) {
  const lines = [];
  const byType = Object.fromEntries(candidates.map((candidate) => [candidate.type, candidate]));

  maybePush(lines, lineFromCandidate(byType.PLACE, placeStake(byType.PLACE, config), "主线"));
  maybePush(lines, lineFromCandidate(byType.WIN, winStake(byType.WIN, config), "小额"));
  maybePush(lines, lineFromCandidate(byType.QUINELLA_PLACE, qplStake(byType.QUINELLA_PLACE, config), "组合"));
  maybePush(lines, lineFromCandidate(byType.QUINELLA, quinellaStake(byType.QUINELLA, config), "极小"));

  return capLines(lines, config.maxBudget);
}

function placeStake(candidate, config) {
  if (!candidate || candidate.estimatedProbability < config.minPlaceProbability) return 0;
  if (!hasUsableMarket(candidate)) return candidate.estimatedProbability >= 0.36 ? 20 : 10;
  if (candidate.edge == null || candidate.edge < 0) return 0;
  return candidate.estimatedProbability >= 0.45 ? 30 : 20;
}

function winStake(candidate, config) {
  if (!candidate || candidate.estimatedProbability < config.minWinProbability) return 0;
  if (!hasUsableMarket(candidate)) return 0;
  if (candidate.edge == null || candidate.edge < 0) return 0;
  return 10;
}

function qplStake(candidate, config) {
  if (!candidate || candidate.estimatedProbability < config.minQplProbability) return 0;
  if (!hasUsableMarket(candidate)) return 10;
  if (candidate.edge == null || candidate.edge < 0) return 0;
  return 10;
}

function quinellaStake(candidate, config) {
  if (!candidate || candidate.estimatedProbability < config.minQuinellaProbability) return 0;
  if (!hasUsableMarket(candidate)) return 0;
  if (candidate.edge == null || candidate.edge < 0) return 0;
  return 10;
}

function lineFromCandidate(candidate, stake, lane) {
  if (!candidate || stake <= 0) return null;
  return {
    type: candidate.type,
    label: candidate.label,
    lane,
    stake,
    selections: candidate.selections,
    estimatedProbability: candidate.estimatedProbability,
    requiredDividendPer10: candidate.requiredDividendPer10,
    marketDividendPer10: candidate.marketDividendPer10,
    edge: candidate.edge,
    status: candidate.edge == null ? "CONDITIONAL" : candidate.edge >= 0 ? "PLAY" : "PASS",
    rationale: candidate.rationale,
  };
}

function maybePush(lines, line) {
  if (line) lines.push(line);
}

function capLines(lines, maxBudget) {
  const kept = [];
  let total = 0;
  for (const line of lines) {
    if (total + line.stake > maxBudget) continue;
    kept.push(line);
    total += line.stake;
  }
  return kept;
}

function enrichCandidate(candidate, config) {
  const requiredDividendPer10 = requiredDividend(candidate.estimatedProbability, config.edgeBuffer);
  const edge = candidate.marketDividendPer10
    ? (candidate.estimatedProbability * candidate.marketDividendPer10 / 10) - 1
    : null;
  const role = candidate.cashEligible ? "cash" : "paper";
  return {
    ...candidate,
    role,
    label: POOL_META[candidate.type].label,
    requiredDividendPer10,
    edge,
    status: statusFor(candidate.cashEligible, edge, candidate.marketDividendPer10),
  };
}

function statusFor(cashEligible, edge, marketDividendPer10) {
  if (!cashEligible) return "PAPER";
  if (!marketDividendPer10) return "CONDITIONAL";
  return edge >= 0 ? "PLAY" : "WATCH";
}

function candidate(type, selections, estimatedProbability, extra) {
  return {
    type,
    selections: selections.filter(Boolean).map(selection),
    estimatedProbability: clamp(estimatedProbability, 0, 0.95),
    ...extra,
  };
}

function selection(runner) {
  return {
    horseId: runner.horseId ?? null,
    horseNo: runner.horseNo ?? null,
    horseName: runner.horseName ?? null,
    probability: Number.isFinite(Number(runner.probability)) ? Number(runner.probability) : null,
  };
}

function rankedPredictions(entry) {
  return [...(entry?.forecast?.predictions ?? [])]
    .filter((runner) => Number.isFinite(Number(runner.probability)))
    .sort((a, b) => Number(b.probability) - Number(a.probability));
}

function estimatedPlaceCutoff(fieldSize) {
  if (fieldSize >= 21) return 4;
  if (fieldSize >= 7) return 3;
  if (fieldSize >= 4) return 2;
  return Math.min(fieldSize, 1);
}

function estimatePlaceProbabilities(runners, cutoff) {
  const weights = runners.map((runner) => Math.sqrt(Math.max(Number(runner.probability), 0.001)));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const map = new Map();
  runners.forEach((runner, index) => {
    const winProbability = Number(runner.probability);
    const rankBonus = Math.max(0, 1 - index * 0.045);
    const poolShare = (weights[index] / totalWeight) * cutoff * 1.18 * rankBonus;
    const estimated = Math.max(winProbability, Math.min(0.82, poolShare));
    map.set(runner.horseId, estimated);
  });
  return map;
}

function estimateQplProbability(first, second, placeProbabilities) {
  const firstPlace = placeProbabilities.get(first.horseId) ?? 0;
  const secondPlace = placeProbabilities.get(second.horseId) ?? 0;
  return Math.min(firstPlace, secondPlace) * Math.max(0.18, Math.min(0.72, secondPlace * 0.95));
}

function estimateQuinellaProbability(first, second) {
  return Math.max(0, Number(first.probability) * Number(second.probability) * 2.7);
}

function estimateForecastProbability(first, second) {
  return Math.max(0, Number(first.probability) * Number(second.probability) * 1.35);
}

function estimateTrioProbability(runners, placeProbabilities) {
  const [first, second, third] = runners;
  const probs = [first, second, third].map((runner) => placeProbabilities.get(runner.horseId) ?? 0);
  return Math.min(...probs) * probs.reduce((product, value) => product * Math.max(value, 0.01), 1) * 2.2;
}

function estimateTierceProbability(runners) {
  return runners.reduce((product, runner) => product * Math.max(Number(runner.probability), 0), 1) * 1.25;
}

function estimateFirst4Probability(runners, placeProbabilities) {
  const probs = runners.map((runner) => placeProbabilities.get(runner.horseId) ?? 0);
  return Math.min(...probs) * probs.reduce((product, value) => product * Math.max(value, 0.01), 1) * 2.8;
}

function estimateQuartetProbability(runners) {
  return runners.reduce((product, runner) => product * Math.max(Number(runner.probability), 0), 1) * 0.7;
}

function requiredDividend(probability, edgeBuffer) {
  if (!Number.isFinite(probability) || probability <= 0) return null;
  return (10 * (1 + edgeBuffer)) / probability;
}

function marketDividend(runner, type) {
  if (type === "WIN") return positiveNumber(runner.winOdds) ? Number(runner.winOdds) * 10 : null;
  if (type === "PLACE") return positiveNumber(runner.placeOdds) ? Number(runner.placeOdds) * 10 : null;
  return null;
}

function hasUsableMarket(candidate) {
  return positiveNumber(candidate.marketDividendPer10);
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function formatHkd(value) {
  if (!Number.isFinite(Number(value))) return "HK$0";
  return `HK$${Number(value).toFixed(0)}`;
}
