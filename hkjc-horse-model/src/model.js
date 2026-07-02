import { buildPerformanceSnapshot } from './performance.js';

const DEFAULT_CONFIG = {
  baseRating: 65,
  horseRatingWeight: 0.075,
  recentFormWeight: 0.04,
  distanceSurfaceWeight: 0.035,
  jockeyWeight: 0.22,
  trainerWeight: 0.18,
  weightPenalty: 0.018,
  drawPenalty: 0.012,
  recencyPenalty: 0.004,
  temperature: 1.15,
  ratingLearningRate: 0.18,
  recentLearningRate: 0.45,
  specialtyLearningRate: 0.28,
  minEdge: 0,
};

export function createModelState() {
  return {
    horses: new Map(),
    jockeys: new Map(),
    trainers: new Map(),
    distanceSurface: new Map(),
    completedRaces: 0,
  };
}

export function predictRace(race, state = createModelState(), configOverrides = {}) {
  const config = { ...DEFAULT_CONFIG, ...configOverrides };
  const avgWeight = average(race.runners.map((runner) => runner.actualWeight).filter(Number.isFinite));
  const fieldSize = race.runners.length;

  const scored = race.runners.map((runner) => {
    const horse = state.horses.get(runner.horseId) ?? {};
    const rating = horse.rating ?? config.baseRating;
    const recentForm = horse.recentForm ?? rating;
    const distanceSurface = state.distanceSurface.get(distanceSurfaceKey(runner.horseId, race)) ?? {};
    const specialtyRating = distanceSurface.rating ?? rating;
    const jockey = state.jockeys.get(runner.jockey);
    const trainer = state.trainers.get(runner.trainer);
    const weightDelta = Number.isFinite(avgWeight) && Number.isFinite(runner.actualWeight)
      ? runner.actualWeight - avgWeight
      : 0;
    const drawPenalty = Number.isFinite(runner.draw)
      ? Math.abs(runner.draw - idealDraw(fieldSize, race)) * config.drawPenalty
      : 0;
    const recencyPenalty = horse.lastDate && race.date
      ? Math.min(daysBetween(horse.lastDate, race.date), 120) * config.recencyPenalty
      : 0;

    const score =
      (rating - config.baseRating) * config.horseRatingWeight
      + (recentForm - config.baseRating) * config.recentFormWeight
      + (specialtyRating - config.baseRating) * config.distanceSurfaceWeight
      + entityLift(jockey) * config.jockeyWeight
      + entityLift(trainer) * config.trainerWeight
      - weightDelta * config.weightPenalty
      - drawPenalty
      - recencyPenalty;

    return {
      ...runner,
      score,
    };
  });

  const probabilities = softmax(scored.map((runner) => runner.score), config.temperature);

  return scored
    .map((runner, index) => {
      const probability = probabilities[index];
      const fairOdds = probability > 0 ? 1 / probability : Infinity;
      return {
        ...runner,
        probability,
        fairOdds,
        value: evaluateValue({ probability, winOdds: runner.winOdds }, config),
      };
    })
    .sort((a, b) => b.probability - a.probability);
}

export function evaluateValue({ probability, winOdds }, configOverrides = {}) {
  const config = { ...DEFAULT_CONFIG, ...configOverrides };
  if (!Number.isFinite(probability) || !Number.isFinite(winOdds) || probability <= 0 || winOdds <= 0) {
    return {
      expectedReturn: null,
      edge: null,
      isValue: false,
    };
  }

  const expectedReturn = probability * winOdds;
  const edge = expectedReturn - 1;
  return {
    expectedReturn,
    edge,
    isValue: edge >= config.minEdge,
  };
}

export function updateModelWithRace(race, state = createModelState(), configOverrides = {}) {
  const config = { ...DEFAULT_CONFIG, ...configOverrides };
  const fieldSize = race.runners.length;
  const avgWeight = average(race.runners.map((runner) => runner.actualWeight).filter(Number.isFinite));
  const classStrength = race.raceClass ? Math.max(0, 6 - race.raceClass) * 1.5 : 0;

  for (const runner of race.runners) {
    const horseKey = runner.horseId ?? runner.horseName;
    const previousHorse = state.horses.get(horseKey) ?? {
      rating: config.baseRating,
      recentForm: config.baseRating,
      runs: 0,
      wins: 0,
      places: 0,
      totalLbw: 0,
    };

    const performance = racePerformanceScore(runner, {
      fieldSize,
      avgWeight,
      classStrength,
    });

    const horse = {
      ...previousHorse,
      rating: ema(previousHorse.rating, performance, config.ratingLearningRate),
      recentForm: ema(previousHorse.recentForm, performance, config.recentLearningRate),
      runs: previousHorse.runs + 1,
      wins: previousHorse.wins + (runner.placing === 1 ? 1 : 0),
      places: previousHorse.places + (runner.placing <= 3 ? 1 : 0),
      totalLbw: previousHorse.totalLbw + (runner.lbw ?? 0),
      lastDate: race.date,
      lastRaceId: race.raceId,
      earlyPositionAvg: updateRunningAverage(previousHorse.earlyPositionAvg, firstPosition(runner), previousHorse.runs),
      closerIndexAvg: updateRunningAverage(previousHorse.closerIndexAvg, closerIndex(runner, fieldSize), previousHorse.runs),
    };

    state.horses.set(horseKey, horse);
    updateSpecialtyRating(state, horseKey, race, performance, config);
    updateEntityStats(state.jockeys, runner.jockey, runner);
    updateEntityStats(state.trainers, runner.trainer, runner);
  }

  state.completedRaces += 1;
  return state;
}

export function backtestRaces(races, options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  const orderedRaces = uniqueRaces(races).sort(compareRaces);
  const state = createModelState();
  const report = {
    races: 0,
    modelTopPickBets: 0,
    modelTopPickWins: 0,
    modelTopPickStake: 0,
    modelTopPickReturn: 0,
    modelTopPickWinRate: 0,
    modelTopPickRoi: 0,
    marketFavouriteBets: 0,
    marketFavouriteWins: 0,
    marketFavouriteStake: 0,
    marketFavouriteReturn: 0,
    marketFavouriteWinRate: 0,
    marketFavouriteRoi: 0,
    valueBets: 0,
    valueWins: 0,
    valueStake: 0,
    valueReturn: 0,
    valueWinRate: 0,
    valueRoi: 0,
  };

  for (const race of orderedRaces) {
    if (!race.runners?.length) continue;

    const predictions = predictRace(race, state, config);
    const topPick = predictions[0];
    const marketFavourite = findMarketFavourite(race);
    const valuePick = predictions.find((runner) => runner.value.isValue);

    report.races += 1;
    settleBet(report, 'modelTopPick', topPick);
    settleBet(report, 'marketFavourite', marketFavourite);
    if (valuePick) settleBet(report, 'value', valuePick);

    updateModelWithRace(race, state, config);
  }

  finalizeBetMetrics(report, 'modelTopPick');
  finalizeBetMetrics(report, 'marketFavourite');
  finalizeBetMetrics(report, 'value');
  return report;
}

export function buildRaceForecast(race, state = createModelState(), options = {}) {
  const predictions = predictRace(race, state, options);
  const topPick = predictions[0] ? sanitizePrediction(predictions[0]) : null;
  const recommendation = recommendValueBet(predictions, options);
  const finalBetPlan = buildFinalBetPlan(race, predictions, recommendation, options);

  return {
    raceId: race.raceId,
    date: race.date,
    racecourse: race.racecourse,
    raceNo: race.raceNo,
    raceName: race.raceName,
    startTime: race.startTime,
    status: race.status ?? 'settled',
    raceClass: race.raceClass,
    distance: race.distance,
    surface: race.surface,
    going: race.going,
    trainingRacesBefore: state.completedRaces,
    topPick,
    recommendation,
    finalBetPlan,
    predictions: predictions.map(sanitizePrediction),
  };
}

export function recommendValueBet(predictions, options = {}) {
  const bankroll = Number.isFinite(options.bankroll) ? options.bankroll : 1000;
  const minEdge = Number.isFinite(options.minEdge) ? options.minEdge : DEFAULT_CONFIG.minEdge;
  const minProbability = Number.isFinite(options.minProbability) ? options.minProbability : 0.15;
  const maxStakePct = Number.isFinite(options.maxStakePct) ? options.maxStakePct : 0.0125;
  const kellyFraction = Number.isFinite(options.kellyFraction) ? options.kellyFraction : 0.25;

  const candidate = [...predictions]
    .filter((runner) => {
      const edge = runner.value?.edge;
      return Number.isFinite(edge)
        && edge >= minEdge
        && runner.probability >= minProbability
        && Number.isFinite(runner.winOdds)
        && runner.winOdds > 1;
    })
    .sort((a, b) => {
      const edgeDelta = (b.value.edge ?? -Infinity) - (a.value.edge ?? -Infinity);
      return edgeDelta || b.probability - a.probability;
    })[0];

  if (!candidate) {
    if (options.allowProbabilityOnly) {
      const probabilityPick = [...predictions]
        .filter((runner) => runner.probability >= minProbability)
        .sort((a, b) => b.probability - a.probability)[0];

      if (probabilityPick) {
        const suggestedStake = roundMoney(Math.min(
          Number.isFinite(options.defaultStake) ? options.defaultStake : 10,
          bankroll * maxStakePct,
        ));

        return {
          action: 'probability',
          horseId: probabilityPick.horseId,
          horseName: probabilityPick.horseName,
          horseNo: probabilityPick.horseNo,
          modelProbability: probabilityPick.probability,
          fairOdds: probabilityPick.fairOdds,
          winOdds: null,
          expectedReturn: null,
          edge: null,
          confidence: confidenceTier(probabilityPick),
          suggestedStake,
          stakePct: bankroll > 0 ? suggestedStake / bankroll : 0,
          message: 'Probability-only paper pick; wait for market odds before treating it as a value recommendation.',
        };
      }
    }

    return {
      action: 'pass',
      message: 'No positive-edge win recommendation at current odds.',
      suggestedStake: 0,
    };
  }

  const stakePct = Math.min(maxStakePct, fractionalKellyPct(candidate.probability, candidate.winOdds) * kellyFraction);
  const suggestedStake = roundMoney(Math.max(0, bankroll * stakePct));

  return {
    action: 'value',
    horseId: candidate.horseId,
    horseName: candidate.horseName,
    horseNo: candidate.horseNo,
    modelProbability: candidate.probability,
    fairOdds: candidate.fairOdds,
    winOdds: candidate.winOdds,
    expectedReturn: candidate.value.expectedReturn,
    edge: candidate.value.edge,
    confidence: confidenceTier(candidate),
    suggestedStake,
    stakePct,
    message: 'Positive-edge candidate; use stake cap and review final odds before placing any bet.',
  };
}

export function buildFinalBetPlan(race, predictions, recommendation, options = {}) {
  const bankroll = Number.isFinite(options.bankroll) ? options.bankroll : 1000;
  const minEdge = Number.isFinite(options.minEdge) ? options.minEdge : DEFAULT_CONFIG.minEdge;
  const finalEdgeBuffer = Number.isFinite(options.finalEdgeBuffer) ? options.finalEdgeBuffer : 0.08;
  const targetEdge = Math.max(0, minEdge) + finalEdgeBuffer;
  const maxStakePct = Number.isFinite(options.maxStakePct) ? options.maxStakePct : 0.0125;
  const selected = recommendation.horseId
    ? predictions.find((runner) => runner.horseId === recommendation.horseId)
    : predictions[0];
  const probability = recommendation.modelProbability ?? selected?.probability ?? null;
  const fairOdds = recommendation.fairOdds ?? selected?.fairOdds ?? null;
  const minimumOdds = Number.isFinite(probability) && probability > 0
    ? roundOdds((1 + targetEdge) / probability)
    : null;
  const currentOdds = recommendation.winOdds ?? selected?.winOdds ?? null;
  const hasMarketOdds = Number.isFinite(currentOdds);
  const currentMeetsFinalPrice = hasMarketOdds && Number.isFinite(minimumOdds) && currentOdds >= minimumOdds;
  const plannedStake = recommendation.action === 'pass'
    ? 0
    : roundMoney(Math.min(recommendation.suggestedStake ?? 0, bankroll * maxStakePct));

  if (recommendation.action === 'value') {
    return {
      mode: currentMeetsFinalPrice ? 'execute' : 'conditional',
      label: currentMeetsFinalPrice ? 'FINAL BUY / 可买' : 'WAIT / 等赔率',
      headline: currentMeetsFinalPrice
        ? '只在最终入场窗口执行，不提前追价。'
        : '只列入候选，等临场赔率重新站上最低入场线。',
      betType: 'WIN',
      horseId: recommendation.horseId,
      horseName: recommendation.horseName,
      horseNo: recommendation.horseNo,
      modelProbability: probability,
      fairOdds,
      currentOdds,
      minimumOdds,
      targetEdge,
      plannedStake,
      stakePct: bankroll > 0 ? plannedStake / bankroll : 0,
      entryWindow: '开跑前 10-5 分钟',
      reviewWindow: '开跑前 15 分钟复核',
      cutoffWindow: '开跑前 3 分钟后不新增下注',
      checklist: [
        'T-15 刷新官方马表、退出马、场地状态和实时独赢赔率。',
        '只有实时独赢赔率仍高于最低赔率线，才执行下注。',
        '严格使用计划注码上限；赔率跌穿就不追。',
      ],
      stopRules: [
        '马匹退出、骑师/场地出现重大变化，或赔率跌穿最低线，直接 PASS。',
        '最终 15 分钟内页面没有刷新成功，直接 PASS。',
      ],
    };
  }

  if (recommendation.action === 'probability') {
    return {
      mode: 'prepare',
      label: 'PREP / 预备',
      headline: '暂时没有实时赔率，只做候选准备，最终窗口再决定。',
      betType: 'WIN',
      horseId: recommendation.horseId,
      horseName: recommendation.horseName,
      horseNo: recommendation.horseNo,
      modelProbability: probability,
      fairOdds,
      currentOdds: null,
      minimumOdds,
      targetEdge,
      plannedStake,
      stakePct: bankroll > 0 ? plannedStake / bankroll : 0,
      entryWindow: '开跑前 10-5 分钟',
      reviewWindow: '开跑前 15 分钟复核',
      cutoffWindow: 'T-5 仍无实时赔率就不下注',
      checklist: [
        'T-15 刷新官方马表、退出马、场地状态和实时独赢赔率。',
        '只有实时独赢赔率高于最低赔率线，才从纸上候选转成真实下注。',
        '赔率缺失或跳动太乱时，只保留纸上模拟。',
      ],
      stopRules: [
        '最终赔率低于最低线，直接 PASS。',
        '任何临场官方变化削弱模型条件，直接 PASS。',
      ],
    };
  }

  return {
    mode: 'pass',
    label: 'NO BET / 不买',
    headline: '保留本金；这场没有通过最终下注规则。',
    betType: 'WIN',
    horseId: null,
    horseName: null,
    horseNo: null,
    modelProbability: probability,
    fairOdds,
    currentOdds,
    minimumOdds,
    targetEdge,
    plannedStake: 0,
    stakePct: 0,
    entryWindow: '开跑前 10-5 分钟',
    reviewWindow: '开跑前 15 分钟复核',
    cutoffWindow: '不强行下注',
    checklist: [
      '实时赔率没有正期望值，不下独赢。',
      '这场只用于赛后复盘和模型学习。',
    ],
    stopRules: [
      '没有 edge，就不下注。',
      '不要为了有动作，把 PASS 换成低质量选择。',
    ],
  };
}

export function settleForecast(forecast, actualRace) {
  const recommendation = forecast.recommendation ?? { action: 'pass', suggestedStake: 0 };
  const recommendedRunner = recommendation.horseId
    ? actualRace.runners.find((runner) => runner.horseId === recommendation.horseId)
    : null;
  const topPickRunner = forecast.topPick?.horseId
    ? actualRace.runners.find((runner) => runner.horseId === forecast.topPick.horseId)
    : null;
  const stake = recommendation.action === 'value' ? recommendation.suggestedStake : 0;
  const won = recommendedRunner?.placing === 1;
  const winOdds = recommendation.winOdds ?? recommendedRunner?.winOdds;
  const returned = won && Number.isFinite(winOdds) ? stake * winOdds : 0;
  const profit = roundMoney(returned - stake);
  const marketFavourite = findMarketFavourite(actualRace);

  return {
    raceId: actualRace.raceId,
    date: actualRace.date,
    racecourse: actualRace.racecourse,
    raceNo: actualRace.raceNo,
    recommendedHorseId: recommendation.horseId ?? null,
    recommendedHorseName: recommendation.horseName ?? null,
    recommendedPlacing: recommendedRunner?.placing ?? null,
    topPickHorseName: forecast.topPick?.horseName ?? null,
    topPickPlacing: topPickRunner?.placing ?? null,
    topPickHit: topPickRunner?.placing === 1,
    winnerHorseId: actualRace.runners.find((runner) => runner.placing === 1)?.horseId ?? null,
    winnerHorseName: actualRace.runners.find((runner) => runner.placing === 1)?.horseName ?? null,
    stake,
    returned: roundMoney(returned),
    profit,
    roi: stake > 0 ? profit / stake : 0,
    resultLabel: stake === 0 ? 'PASS' : won ? 'WIN' : 'MISS',
    runnerResults: actualRace.runners.map((runner) => ({
      horseId: runner.horseId ?? null,
      horseNo: runner.horseNo ?? null,
      horseName: runner.horseName ?? null,
      placing: runner.placing ?? null,
      winOdds: runner.winOdds ?? null,
    })),
    dividends: actualRace.dividends ?? null,
    marketFavourite: marketFavourite
      ? {
          horseId: marketFavourite.horseId,
          horseName: marketFavourite.horseName,
          placing: marketFavourite.placing,
          winOdds: marketFavourite.winOdds,
          profit: marketFavourite.placing === 1 ? marketFavourite.winOdds - 1 : -1,
        }
      : null,
  };
}

export function buildRollingPredictionLedger(races, options = {}) {
  const orderedRaces = uniqueRaces(races).sort(compareRaces);
  const state = createModelState();
  const entries = [];
  let totalStake = 0;
  let totalReturn = 0;
  let topPickHits = 0;
  let valueBets = 0;
  let valueWins = 0;
  let marketFavouriteStake = 0;
  let marketFavouriteReturn = 0;

  for (const race of orderedRaces) {
    if (!race.runners?.length) continue;

    const forecast = buildRaceForecast(race, state, options);
    const settlement = settleForecast(forecast, race);
    totalStake += settlement.stake;
    totalReturn += settlement.returned;
    topPickHits += settlement.topPickHit ? 1 : 0;
    valueBets += settlement.stake > 0 ? 1 : 0;
    valueWins += settlement.resultLabel === 'WIN' ? 1 : 0;

    if (settlement.marketFavourite) {
      marketFavouriteStake += 1;
      marketFavouriteReturn += settlement.marketFavourite.placing === 1
        ? settlement.marketFavourite.winOdds
        : 0;
    }

    entries.push({
      raceId: race.raceId,
      date: race.date,
      racecourse: race.racecourse,
      raceNo: race.raceNo,
      forecast,
      settlement,
      cumulativeProfit: roundMoney(totalReturn - totalStake),
      cumulativeRoi: totalStake > 0 ? (totalReturn - totalStake) / totalStake : 0,
    });

    updateModelWithRace(race, state, options);
  }

  const racesSettled = entries.length;
  const profit = roundMoney(totalReturn - totalStake);
  const marketFavouriteProfit = roundMoney(marketFavouriteReturn - marketFavouriteStake);

  return {
    entries,
    summary: {
      racesSettled,
      valueBets,
      valueWins,
      valueWinRate: valueBets > 0 ? valueWins / valueBets : 0,
      totalStake: roundMoney(totalStake),
      totalReturn: roundMoney(totalReturn),
      profit,
      roi: totalStake > 0 ? profit / totalStake : 0,
      topPickHits,
      topPickWinRate: racesSettled > 0 ? topPickHits / racesSettled : 0,
      marketFavouriteProfit,
      marketFavouriteRoi: marketFavouriteStake > 0 ? marketFavouriteProfit / marketFavouriteStake : 0,
      marketFavouriteBets: marketFavouriteStake,
      modelStateRaces: state.completedRaces,
    },
  };
}

export function buildDashboardSnapshot(races, options = {}) {
  const rolling = buildRollingPredictionLedger(races, options);
  const latestEntry = rolling.entries.at(-1) ?? null;
  const trainedState = trainStateFromRaces(races, options);
  const settledRaceIds = new Set(rolling.entries.map((entry) => entry.raceId));
  const upcomingEntries = uniqueRaces(options.upcomingRaces ?? [])
    .filter((race) => !settledRaceIds.has(race.raceId))
    .sort(compareRaces)
    .map((race) => ({
      raceId: race.raceId,
      date: race.date,
      racecourse: race.racecourse,
      raceNo: race.raceNo,
      forecast: buildRaceForecast(race, trainedState, {
        ...options,
        allowProbabilityOnly: options.allowProbabilityOnly ?? true,
      }),
      settlement: null,
      cumulativeProfit: rolling.summary.profit,
      cumulativeRoi: rolling.summary.roi,
    }));
  const raceSummaries = rolling.entries.map((entry) => ({
    raceId: entry.raceId,
    date: entry.date,
    racecourse: entry.racecourse,
    raceNo: entry.raceNo,
    topPick: entry.forecast.topPick?.horseName ?? 'N/A',
    recommendation: entry.forecast.recommendation?.horseName ?? 'PASS',
    result: entry.settlement.resultLabel,
    profit: entry.settlement.profit,
    cumulativeProfit: entry.cumulativeProfit,
    cumulativeRoi: entry.cumulativeRoi,
  }));

  return {
    generatedAt: new Date().toISOString(),
    scope: 'HKJC local races only',
    summary: rolling.summary,
    latestForecast: latestEntry?.forecast ?? null,
    latestSettlement: latestEntry?.settlement ?? null,
    latestUpcomingForecast: upcomingEntries[0]?.forecast ?? null,
    upcomingEntries,
    nextLocalMeetings: options.nextLocalMeetings ?? [],
    fixtureWindow: options.fixtureWindow ?? null,
    performance: buildPerformanceSnapshot(rolling.entries),
    ledger: raceSummaries,
    recentEntries: rolling.entries.slice(-12),
    assumptions: {
      betType: 'WIN',
      settlement: 'decimal win odds in official result data',
      stakePolicy: 'fractional Kelly capped by maxStakePct',
      minProbability: options.minProbability ?? 0.15,
      minEdge: options.minEdge ?? DEFAULT_CONFIG.minEdge,
      finalEdgeBuffer: options.finalEdgeBuffer ?? 0.08,
      allowProbabilityOnly: options.allowProbabilityOnly ?? true,
      responsibleUse: 'probability research, not a guarantee of profit',
    },
  };
}

export function trainStateFromRaces(races, options = {}) {
  const state = createModelState();
  for (const race of uniqueRaces(races).sort(compareRaces)) {
    if (!race.runners?.length || !race.runners.some((runner) => Number.isFinite(runner.placing))) continue;
    updateModelWithRace(race, state, options);
  }
  return state;
}

function uniqueRaces(races) {
  const seen = new Set();
  const unique = [];
  for (const race of races) {
    const key = race.raceId ?? `${race.date}-${race.racecourse}-${race.raceNo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(race);
  }
  return unique;
}

export function defaultConfigGrid() {
  const configs = [];
  for (const horseRatingWeight of [0.055, 0.075, 0.095]) {
    for (const recentFormWeight of [0.025, 0.04, 0.06]) {
      for (const weightPenalty of [0.01, 0.018, 0.026]) {
        configs.push({ horseRatingWeight, recentFormWeight, weightPenalty });
      }
    }
  }
  return configs;
}

export function calibrateConfig(races, candidates = defaultConfigGrid(), metric = 'modelTopPickRoi') {
  const results = candidates.map((candidate) => {
    const report = backtestRaces(races, candidate);
    return {
      config: candidate,
      report,
      score: report[metric],
    };
  });

  return results.sort((a, b) => b.score - a.score);
}

export function serializeState(state) {
  return {
    horses: Object.fromEntries(state.horses),
    jockeys: Object.fromEntries(state.jockeys),
    trainers: Object.fromEntries(state.trainers),
    distanceSurface: Object.fromEntries(state.distanceSurface),
    completedRaces: state.completedRaces,
  };
}

export function deserializeState(raw) {
  return {
    horses: new Map(Object.entries(raw?.horses ?? {})),
    jockeys: new Map(Object.entries(raw?.jockeys ?? {})),
    trainers: new Map(Object.entries(raw?.trainers ?? {})),
    distanceSurface: new Map(Object.entries(raw?.distanceSurface ?? {})),
    completedRaces: raw?.completedRaces ?? 0,
  };
}

function racePerformanceScore(runner, { fieldSize, avgWeight, classStrength }) {
  const rankComponent = fieldSize > 1
    ? (fieldSize - runner.placing) / (fieldSize - 1)
    : 1;
  const marginPenalty = Math.min(runner.lbw ?? 0, 12) * 1.15;
  const weightCredit = Number.isFinite(avgWeight) && Number.isFinite(runner.actualWeight)
    ? (runner.actualWeight - avgWeight) * 0.08
    : 0;

  return clamp(45 + rankComponent * 35 - marginPenalty + classStrength + weightCredit, 20, 100);
}

function updateSpecialtyRating(state, horseKey, race, performance, config) {
  const key = distanceSurfaceKey(horseKey, race);
  const previous = state.distanceSurface.get(key) ?? { rating: config.baseRating, runs: 0 };
  state.distanceSurface.set(key, {
    rating: ema(previous.rating, performance, config.specialtyLearningRate),
    runs: previous.runs + 1,
  });
}

function updateEntityStats(map, key, runner) {
  if (!key) return;
  const previous = map.get(key) ?? { runs: 0, wins: 0, places: 0 };
  map.set(key, {
    runs: previous.runs + 1,
    wins: previous.wins + (runner.placing === 1 ? 1 : 0),
    places: previous.places + (runner.placing <= 3 ? 1 : 0),
  });
}

function settleBet(report, prefix, runner) {
  if (!runner || !Number.isFinite(runner.winOdds)) return;
  const won = runner.placing === 1;
  report[`${prefix}Bets`] += 1;
  report[`${prefix}Stake`] += 1;
  report[`${prefix}Wins`] += won ? 1 : 0;
  report[`${prefix}Return`] += won ? runner.winOdds : 0;
}

function finalizeBetMetrics(report, prefix) {
  const bets = report[`${prefix}Bets`];
  const stake = report[`${prefix}Stake`];
  const returned = report[`${prefix}Return`];
  report[`${prefix}WinRate`] = bets > 0 ? report[`${prefix}Wins`] / bets : 0;
  report[`${prefix}Roi`] = stake > 0 ? (returned - stake) / stake : 0;
}

function findMarketFavourite(race) {
  return race.runners
    .filter((runner) => Number.isFinite(runner.winOdds))
    .sort((a, b) => a.winOdds - b.winOdds)[0] ?? null;
}

function sanitizePrediction(runner) {
  return {
    horseId: runner.horseId,
    horseNo: runner.horseNo,
    horseName: runner.horseName,
    jockey: runner.jockey,
    trainer: runner.trainer,
    actualWeight: runner.actualWeight,
    draw: runner.draw,
    winOdds: runner.winOdds,
    probability: runner.probability,
    fairOdds: runner.fairOdds,
    edge: runner.value?.edge ?? null,
    expectedReturn: runner.value?.expectedReturn ?? null,
    score: runner.score,
  };
}

function fractionalKellyPct(probability, odds) {
  const b = odds - 1;
  if (b <= 0) return 0;
  const q = 1 - probability;
  return Math.max(0, (b * probability - q) / b);
}

function confidenceTier(runner) {
  const edge = runner.value?.edge ?? 0;
  if (runner.probability >= 0.22 && edge >= 0.35) return 'high';
  if (runner.probability >= 0.14 && edge >= 0.15) return 'medium';
  return 'watch';
}

function roundMoney(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function roundOdds(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function distanceSurfaceKey(horseId, race) {
  return `${horseId}:${race.surface ?? 'UNKNOWN'}:${distanceBucket(race.distance)}`;
}

function distanceBucket(distance) {
  if (!Number.isFinite(distance)) return 'unknown';
  return `${Math.round(distance / 200) * 200}m`;
}

function entityLift(entity) {
  if (!entity || entity.runs === 0) return 0;
  const winRate = (entity.wins + 1) / (entity.runs + 8);
  const placeRate = (entity.places + 2) / (entity.runs + 10);
  return Math.log(winRate / 0.12) + Math.log(placeRate / 0.36) * 0.35;
}

function idealDraw(fieldSize, race) {
  if (race.racecourse === 'HV' && race.surface === 'TURF' && race.distance <= 1200) return 3;
  if (race.racecourse === 'ST' && race.surface === 'AWT') return Math.max(3, fieldSize * 0.4);
  return (fieldSize + 1) / 2;
}

function softmax(scores, temperature = 1) {
  const maxScore = Math.max(...scores);
  const exps = scores.map((score) => Math.exp((score - maxScore) / temperature));
  const total = exps.reduce((sum, value) => sum + value, 0);
  return exps.map((value) => value / total);
}

function ema(previous, next, learningRate) {
  if (!Number.isFinite(previous)) return next;
  return previous * (1 - learningRate) + next * learningRate;
}

function average(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function daysBetween(startDate, endDate) {
  const start = Date.parse(startDate);
  const end = Date.parse(endDate);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86400000));
}

function firstPosition(runner) {
  return runner.runningPosition?.[0] ?? null;
}

function closerIndex(runner, fieldSize) {
  if (!runner.runningPosition?.length || !fieldSize) return null;
  const first = runner.runningPosition[0];
  const last = runner.runningPosition[runner.runningPosition.length - 1];
  return (first - last) / fieldSize;
}

function updateRunningAverage(previous, next, priorRuns) {
  if (!Number.isFinite(next)) return previous ?? null;
  if (!Number.isFinite(previous) || priorRuns === 0) return next;
  return (previous * priorRuns + next) / (priorRuns + 1);
}

function compareRaces(a, b) {
  return String(a.date).localeCompare(String(b.date))
    || String(a.racecourse).localeCompare(String(b.racecourse))
    || (a.raceNo ?? 0) - (b.raceNo ?? 0);
}
