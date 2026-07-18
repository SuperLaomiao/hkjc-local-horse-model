import { createRankingProbabilityModel } from "./ranking-probabilities.js";
import { evaluateValueCandidate, VALUE_RULE_VERSION } from "./hkjc-horse-model/src/value-betting-engine.js";

const DEFAULT_OPTIONS = {
  minUnit: 10,
  maxBudget: 100,
  edgeBuffer: 0.08,
  minTopProbability: 0.12,
  minPlaceProbability: 0.28,
  minWinProbability: 0.15,
  minQplProbability: 0.12,
  minQuinellaProbability: 0.055,
  maxCoreExposureShare: 0.6,
  probabilityHaircut: 0.05,
  probabilityStatus: "RESEARCH_ONLY",
  maxPriceAgeMinutes: 15,
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
  const rankingModel = createRankingProbabilityModel(runners, {
    maxRank: Math.max(4, placeCutoff),
  });
  const placeProbabilities = new Map(runners.map((runner) => [
    runner.horseId,
    Number.isFinite(Number(runner.placeProbability))
      ? Number(runner.placeProbability)
      : rankingModel.placeProbability(runner.horseId, placeCutoff),
  ]));
  const candidates = [top, second, third].filter(Boolean).map((runner, index) => candidate("PLACE", [runner], placeProbabilities.get(runner.horseId) ?? 0, {
    marketDividendPer10: marketDividendForPool({ type: "PLACE", runners: [runner], entry, config }),
    cashEligible: true,
    rationale: index === 0
      ? "单马进入位置名次，作为组合里的低波动主线。"
      : "支撑马进入位置名次，用来降低现金组合对头号马的依赖。",
  }));

  candidates.push(
    candidate("WIN", [top], Number(top.probability), {
      marketDividendPer10: marketDividendForPool({ type: "WIN", runners: [top], entry, config }),
      cashEligible: true,
      rationale: "只在实时独赢赔率高过入场线时小注。",
    }),
  );

  if (second) {
    candidates.push(candidate("QUINELLA_PLACE", [top, second], rankingModel.unorderedTopKProbability(horseIds([top, second]), placeCutoff), {
      marketDividendPer10: marketDividendForPool({ type: "QUINELLA_PLACE", runners: [top, second], entry, config }),
      cashEligible: true,
      rationale: "两匹同时进入位置名次；比连赢更贴近当前概率模型。",
    }));
    candidates.push(candidate("QUINELLA", [top, second], rankingModel.unorderedTopKProbability(horseIds([top, second]), 2), {
      marketDividendPer10: marketDividendForPool({ type: "QUINELLA", runners: [top, second], entry, config }),
      cashEligible: true,
      rationale: "两匹包办前二且不限顺序，只在强支撑结构中小注。",
    }));
    candidates.push(candidate("FORECAST", [top, second], rankingModel.orderedProbability(horseIds([top, second])), {
      marketDividendPer10: marketDividendForPool({ type: "FORECAST", runners: [top, second], entry, config }),
      cashEligible: false,
      rationale: "需要精确冠亚顺序；目前作为顺序能力观察。",
    }));
  }

  if (third) {
    candidates.push(candidate("QUINELLA_PLACE", [top, third], rankingModel.unorderedTopKProbability(horseIds([top, third]), placeCutoff), {
      marketDividendPer10: marketDividendForPool({ type: "QUINELLA_PLACE", runners: [top, third], entry, config }),
      cashEligible: true,
      rationale: "头号马搭第三候选；只有派彩足够时才执行。",
    }));
    if (second) {
      candidates.push(candidate("QUINELLA_PLACE", [second, third], rankingModel.unorderedTopKProbability(horseIds([second, third]), placeCutoff), {
        marketDividendPer10: marketDividendForPool({ type: "QUINELLA_PLACE", runners: [second, third], entry, config }),
        cashEligible: true,
        rationale: "两匹支撑马同时进入位置名次，用来对冲头号马失位风险。",
      }));
    }
    candidates.push(candidate("TRIO", [top, second, third], rankingModel.unorderedTopKProbability(horseIds([top, second, third]), 3), {
      marketDividendPer10: marketDividendForPool({ type: "TRIO", runners: [top, second, third], entry, config }),
      cashEligible: false,
      rationale: "三匹包办前三，不限顺序；先纸上复盘命中率。",
    }));
    candidates.push(candidate("TIERCE", [top, second, third], rankingModel.orderedProbability(horseIds([top, second, third])), {
      marketDividendPer10: marketDividendForPool({ type: "TIERCE", runners: [top, second, third], entry, config }),
      cashEligible: false,
      rationale: "三匹前三顺序完全正确，波动过高，暂不实注。",
    }));
  }

  if (fourth) {
    candidates.push(candidate("FIRST4", [top, second, third, fourth], rankingModel.unorderedTopKProbability(horseIds([top, second, third, fourth]), 4), {
      marketDividendPer10: marketDividendForPool({ type: "FIRST4", runners: [top, second, third, fourth], entry, config }),
      cashEligible: false,
      rationale: "四匹包办前四，不限顺序；当前只作纸上统计。",
    }));
    candidates.push(candidate("QUARTET", [top, second, third, fourth], rankingModel.orderedProbability(horseIds([top, second, third, fourth])), {
      marketDividendPer10: marketDividendForPool({ type: "QUARTET", runners: [top, second, third, fourth], entry, config }),
      cashEligible: false,
      rationale: "四匹前四顺序完全正确，需要专门顺序模型，暂不实注。",
    }));
  }

  const enriched = candidates
    .map((item) => enrichCandidate(item, config, entry))
    .sort((a, b) => POOL_META[a.type].priority - POOL_META[b.type].priority || b.estimatedProbability - a.estimatedProbability);

  return {
    raceId: entry?.raceId ?? null,
    date: entry?.date ?? null,
    racecourse: entry?.racecourse ?? null,
    raceNo: entry?.raceNo ?? null,
    probabilityModel: rankingModel.model,
    placeCutoff,
    candidates: enriched,
    note: "概率由 Harville/Plackett-Luce 排名模型外推为位置/组合/顺序玩法，派彩入场线需临场复核。",
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
  const watchLines = cashCandidates.filter((candidate) => !cashLines.some((line) => line.candidateKey === candidate.key));
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
  const winCandidate = candidates.find((candidate) => candidate.type === "WIN");
  const topHorseId = winCandidate?.selections?.[0]?.horseId ?? candidates[0]?.selections?.[0]?.horseId ?? null;
  const placeCandidates = candidates.filter((candidate) => candidate.type === "PLACE");
  const qplCandidates = candidates.filter((candidate) => candidate.type === "QUINELLA_PLACE");
  const quinellaCandidates = candidates.filter((candidate) => candidate.type === "QUINELLA");

  const topPlace = placeCandidates.find((candidate) => firstHorseId(candidate) === topHorseId);
  const supportPlace = placeCandidates.find((candidate) => firstHorseId(candidate) !== topHorseId && placeStake(candidate, config) > 0);
  const topQpl = qplCandidates.find((candidate) => containsHorse(candidate, topHorseId) && qplStake(candidate, config) > 0);
  const supportQpl = qplCandidates.find((candidate) => !containsHorse(candidate, topHorseId) && qplStake(candidate, config) > 0);
  const quinella = quinellaCandidates.find((candidate) => quinellaStake(candidate, config) > 0);

  maybePush(lines, lineFromCandidate(topPlace, placeStake(topPlace, config), "主线"));
  maybePush(lines, lineFromCandidate(supportPlace, Math.min(placeStake(supportPlace, config), 30), "对冲"));
  maybePush(lines, lineFromCandidate(topQpl, qplStake(topQpl, config), "组合"));
  maybePush(lines, lineFromCandidate(supportQpl, qplStake(supportQpl, config), "对冲"));
  maybePush(lines, lineFromCandidate(winCandidate, winStake(winCandidate, config), "小额"));
  maybePush(lines, lineFromCandidate(quinella, quinellaStake(quinella, config), "极小"));

  const evRankedLines = lines.sort(compareLinesByExpectedRoi);
  return limitCoreExposure(capLines(evRankedLines, config.maxBudget), topHorseId, config.maxCoreExposureShare);
}

function placeStake(candidate, config) {
  if (!candidate || candidate.estimatedProbability < config.minPlaceProbability) return 0;
  if (candidate.decision?.status !== "PLAY") return 0;
  return candidate.estimatedProbability >= 0.45 ? 30 : 20;
}

function winStake(candidate, config) {
  if (!candidate || candidate.estimatedProbability < config.minWinProbability) return 0;
  if (candidate.decision?.status !== "PLAY") return 0;
  return 10;
}

function qplStake(candidate, config) {
  if (!candidate || candidate.estimatedProbability < config.minQplProbability) return 0;
  if (candidate.decision?.status !== "PLAY") return 0;
  return 10;
}

function quinellaStake(candidate, config) {
  if (!candidate || candidate.estimatedProbability < config.minQuinellaProbability) return 0;
  if (candidate.decision?.status !== "PLAY") return 0;
  return 10;
}

function lineFromCandidate(candidate, stake, lane) {
  if (!candidate || stake <= 0) return null;
  return {
    type: candidate.type,
    key: candidate.key,
    candidateKey: candidate.key,
    label: candidate.label,
    lane,
    stake,
    selections: candidate.selections,
    estimatedProbability: candidate.estimatedProbability,
    requiredDividendPer10: candidate.requiredDividendPer10,
    marketDividendPer10: candidate.marketDividendPer10,
    edge: candidate.edge,
    expectedRoi: candidate.expectedRoi,
    conservativeExpectedRoi: candidate.conservativeExpectedRoi,
    targetRoi: candidate.targetRoi,
    meetsEntryPrice: candidate.meetsEntryPrice,
    status: candidate.status,
    decision: candidate.decision,
    probabilityArtifactId: candidate.probabilityArtifactId,
    modelId: candidate.modelId,
    calibrationMethod: candidate.calibrationMethod,
    conservativeProbability: candidate.conservativeProbability,
    fairDividendPer10: candidate.fairDividendPer10,
    marketCapturedAt: candidate.marketCapturedAt,
    marketWindow: candidate.marketWindow,
    marketSellStatus: candidate.marketSellStatus,
    marketSource: candidate.marketSource,
    ruleVersion: candidate.ruleVersion,
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

function enrichCandidate(candidate, config, entry) {
  const conservativeProbability = conservativeProbabilityFor(candidate, config);
  const market = marketContextForCandidate(candidate, entry, config);
  const role = candidate.cashEligible ? "cash" : "paper";
  const probabilityStatus = probabilityStatusFor(candidate, config);
  const decision = candidate.cashEligible
    ? evaluateValueCandidate({
      pool: candidate.type,
      probability: candidate.estimatedProbability,
      conservativeProbability,
      dividendPer10: candidate.marketDividendPer10,
      capturedAt: market.capturedAt,
      evaluatedAt: market.evaluatedAt,
      sellStatus: market.sellStatus,
      safetyBuffer: config.edgeBuffer,
      maxAgeMinutes: config.maxPriceAgeMinutes,
      probabilityStatus,
    })
    : paperDecision(candidate, conservativeProbability, config.edgeBuffer);
  return {
    ...candidate,
    key: candidateKey(candidate),
    role,
    label: POOL_META[candidate.type].label,
    probabilityStatus,
    conservativeProbability,
    fairDividendPer10: decision.fairDividendPer10 ?? requiredDividend(candidate.estimatedProbability, 0),
    requiredDividendPer10: decision.requiredDividendPer10 ?? requiredDividend(conservativeProbability, config.edgeBuffer),
    edge: decision.expectedRoi ?? null,
    expectedRoi: decision.expectedRoi ?? null,
    conservativeExpectedRoi: decision.conservativeExpectedRoi ?? null,
    targetRoi: config.edgeBuffer,
    meetsEntryPrice: decision.status === "PLAY",
    status: decision.status,
    decision,
    probabilityArtifactId: config.probabilityArtifactId ?? entry?.forecast?.probabilityArtifactId ?? null,
    modelId: config.modelId ?? entry?.forecast?.modelId ?? null,
    calibrationMethod: config.calibrationMethod ?? entry?.forecast?.calibrationMethod ?? null,
    marketCapturedAt: market.capturedAt,
    marketWindow: market.window,
    marketSellStatus: market.sellStatus,
    marketSource: market.source,
    ruleVersion: decision.ruleVersion ?? VALUE_RULE_VERSION,
  };
}

function conservativeProbabilityFor(candidate, config) {
  const key = candidateKey(candidate);
  const explicit = Number(config.conservativeProbabilities?.[key] ?? candidate.conservativeProbability);
  if (Number.isFinite(explicit) && explicit > 0 && explicit <= candidate.estimatedProbability) {
    return explicit;
  }
  const haircut = clamp(config.probabilityHaircut, 0, 0.5);
  return Math.max(0.000001, candidate.estimatedProbability * (1 - haircut));
}

function probabilityStatusFor(candidate, config) {
  const explicit = config.poolProbabilityStatus?.[candidate.type];
  if (explicit) return explicit;
  if (["WIN", "PLACE"].includes(candidate.type)) return config.probabilityStatus;
  return "RESEARCH_ONLY";
}

function marketContextForCandidate(candidate, entry, config) {
  const configured = config.marketSnapshots?.[candidate.type]
    ?? entry?.marketSnapshots?.[candidate.type]
    ?? {};
  const first = candidate.selections?.[0] ?? {};
  const typePrefix = candidate.type === "WIN" ? "win" : candidate.type === "PLACE" ? "place" : null;
  return {
    capturedAt: configured.capturedAt
      ?? (typePrefix ? first[`${typePrefix}MarketCapturedAt`] : null)
      ?? first.marketCapturedAt
      ?? config.marketCapturedAt
      ?? entry?.marketCapturedAt
      ?? null,
    evaluatedAt: config.evaluatedAt
      ?? entry?.evaluatedAt
      ?? entry?.forecast?.generatedAt
      ?? null,
    sellStatus: configured.sellStatus
      ?? (typePrefix ? first[`${typePrefix}SellStatus`] : null)
      ?? first.sellStatus
      ?? config.sellStatus
      ?? entry?.sellStatus
      ?? null,
    window: configured.window
      ?? (typePrefix ? first[`${typePrefix}MarketWindow`] : null)
      ?? first.marketWindow
      ?? config.marketWindow
      ?? entry?.marketWindow
      ?? null,
    source: configured.source
      ?? first.marketSource
      ?? config.marketSource
      ?? entry?.marketSource
      ?? null,
  };
}

function paperDecision(candidate, conservativeProbability, edgeBuffer) {
  return {
    ruleVersion: VALUE_RULE_VERSION,
    pool: candidate.type,
    probability: candidate.estimatedProbability,
    conservativeProbability,
    fairDividendPer10: requiredDividend(candidate.estimatedProbability, 0),
    requiredDividendPer10: requiredDividend(conservativeProbability, edgeBuffer),
    expectedRoi: null,
    conservativeExpectedRoi: null,
    status: "PAPER",
    reasonCode: "PROBABILITY_NOT_PROMOTED",
    reasonZh: "该玩法概率尚未通过独立校准和晋级门槛，仅作纸上跟踪。",
  };
}

function candidate(type, selections, estimatedProbability, extra) {
  return {
    type,
    selections: selections.filter(Boolean).map(selection),
    estimatedProbability: clamp(estimatedProbability, 0, 0.95),
    ...extra,
  };
}

function candidateKey(candidate) {
  return `${candidate.type}:${candidate.selections.map((selection) => selection.horseId ?? selection.horseNo ?? selection.horseName ?? "").join("+")}`;
}

function selection(runner) {
  return {
    horseId: runner.horseId ?? null,
    horseNo: runner.horseNo ?? null,
    horseName: runner.horseName ?? null,
    probability: Number.isFinite(Number(runner.probability)) ? Number(runner.probability) : null,
    placeProbability: Number.isFinite(Number(runner.placeProbability)) ? Number(runner.placeProbability) : null,
    marketCapturedAt: runner.marketCapturedAt ?? null,
    marketWindow: runner.marketWindow ?? null,
    marketSource: runner.marketSource ?? null,
    sellStatus: runner.sellStatus ?? null,
    winMarketCapturedAt: runner.winMarketCapturedAt ?? null,
    winMarketWindow: runner.winMarketWindow ?? null,
    winSellStatus: runner.winSellStatus ?? null,
    placeMarketCapturedAt: runner.placeMarketCapturedAt ?? null,
    placeMarketWindow: runner.placeMarketWindow ?? null,
    placeSellStatus: runner.placeSellStatus ?? null,
  };
}

function rankedPredictions(entry) {
  return [...(entry?.forecast?.predictions ?? [])]
    .filter((runner) => Number.isFinite(Number(runner.probability)))
    .sort((a, b) => Number(b.probability) - Number(a.probability));
}

function horseIds(runners) {
  return runners.filter(Boolean).map((runner) => runner.horseId);
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

function marketDividendForPool({ type, runners, entry, config }) {
  const override = optionDividendPer10(type, config);
  if (override) return override;

  if ((type === "WIN" || type === "PLACE") && runners.length === 1) {
    const directMarket = marketDividend(runners[0], type);
    if (directMarket) return directMarket;
  }

  return null;
}

function optionDividendPer10(type, config) {
  const key = {
    QUINELLA_PLACE: "qplDividendPer10",
    QUINELLA: "quinellaDividendPer10",
    FORECAST: "forecastDividendPer10",
    TRIO: "trioDividendPer10",
    TIERCE: "tierceDividendPer10",
    FIRST4: "first4DividendPer10",
    QUARTET: "quartetDividendPer10",
  }[type];
  return key ? positiveNumber(config[key]) : null;
}

function officialDividendPer10(type, runners, dividends) {
  const poolKey = {
    WIN: "win",
    PLACE: "place",
    QUINELLA_PLACE: "quinellaPlace",
    QUINELLA: "quinella",
    FORECAST: "forecast",
    TRIO: "trio",
    TIERCE: "tierce",
    FIRST4: "first4",
    QUARTET: "quartet",
  }[type];
  const pool = poolKey ? dividends?.[poolKey] : null;
  if (!Array.isArray(pool)) return null;

  const wanted = dividendCombinationKey(type, runners.map((runner) => runner.horseNo));
  const match = pool.find((item) => dividendCombinationKey(type, item.combination) === wanted);
  return positiveNumber(match?.dividendPer10);
}

function dividendCombinationKey(type, combination) {
  const numbers = (combination ?? [])
    .map((value) => Number(value))
    .filter(Number.isFinite);
  if (["QUINELLA_PLACE", "QUINELLA", "TRIO", "FIRST4"].includes(type)) {
    numbers.sort((a, b) => a - b);
  }
  return numbers.join(",");
}

function firstHorseId(candidate) {
  return candidate?.selections?.[0]?.horseId ?? null;
}

function containsHorse(candidate, horseId) {
  return Boolean(horseId) && candidate?.selections?.some((selection) => selection.horseId === horseId);
}

function compareLinesByExpectedRoi(a, b) {
  const aRank = lineExpectedRoiRank(a);
  const bRank = lineExpectedRoiRank(b);
  return bRank - aRank || b.estimatedProbability - a.estimatedProbability;
}

function lineExpectedRoiRank(line) {
  if (Number.isFinite(line?.expectedRoi)) return line.expectedRoi;
  return -1 + Number(line?.estimatedProbability ?? 0) / 10;
}

function exposureShare(lines, horseId) {
  const total = lines.reduce((sum, line) => sum + line.stake, 0);
  if (!total || !horseId) return 0;
  const exposed = lines
    .filter((line) => containsHorse(line, horseId))
    .reduce((sum, line) => sum + line.stake, 0);
  return exposed / total;
}

function limitCoreExposure(lines, topHorseId, maxShare) {
  const kept = [...lines];
  const removablePriority = ["WIN", "QUINELLA", "QUINELLA_PLACE"];

  while (exposureShare(kept, topHorseId) > maxShare) {
    const removableIndex = findCoreExposureTrimIndex(kept, topHorseId, removablePriority);
    if (removableIndex === -1) break;
    kept.splice(removableIndex, 1);
  }

  return kept;
}

function findCoreExposureTrimIndex(lines, topHorseId, removablePriority) {
  for (const type of removablePriority) {
    let index = -1;
    let lowestExpectedRoi = Infinity;
    lines.forEach((line, lineIndex) => {
      if (line.type !== type || !containsHorse(line, topHorseId)) return;
      const expectedRoi = Number.isFinite(line.expectedRoi) ? line.expectedRoi : -1;
      if (expectedRoi < lowestExpectedRoi) {
        index = lineIndex;
        lowestExpectedRoi = expectedRoi;
      }
    });
    if (index !== -1) return index;
  }
  return -1;
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
