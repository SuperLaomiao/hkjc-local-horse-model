import { buildStakingStrategy } from "./bet-strategy.js";
import { settleStrategyBetLine } from "./betting-products.js";

const DEFAULT_OPTIONS = {
  minUnit: 10,
  protectStake: 10,
  cooldownStake: 10,
  stopAfterMisses: 2,
};

const ALLOW_PROTECT_CONFIDENCE = new Set(["medium", "strong", "very-strong"]);
const ALLOW_COOLDOWN_CONFIDENCE = new Set(["strong", "very-strong"]);

export function buildAdaptiveRacePlan(entries, selectedEntry = null, options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const meetingEntries = meetingRaceEntries(entries, selectedEntry);
  const state = initialSessionState();
  const rows = [];

  for (const entry of meetingEntries) {
    const baseStrategy = buildStakingStrategy(entry);
    const decision = decideRaceAction(baseStrategy, state, config);
    const bets = adjustBets(baseStrategy.bets, decision, config);
    const outcome = settleAdaptiveBets(entry, bets);
    const row = {
      raceId: entry.raceId,
      date: entry.date,
      racecourse: entry.racecourse,
      raceNo: entry.raceNo,
      primaryHorse: baseStrategy.primaryHorse,
      baseLabel: baseStrategy.label,
      baseConfidence: baseStrategy.confidence,
      baseTotalStake: baseStrategy.totalStake,
      decision,
      bets,
      totalStake: bets.reduce((sum, bet) => sum + bet.amount, 0),
      outcome,
      stateBefore: { ...state },
    };

    rows.push(row);
    applyOutcomeToState(state, outcome, row.totalStake);
    row.stateAfter = { ...state };
  }

  return {
    date: meetingEntries[0]?.date ?? selectedEntry?.date ?? null,
    racecourse: meetingEntries[0]?.racecourse ?? selectedEntry?.racecourse ?? null,
    rows,
    summary: summarizeRows(rows),
    rules: [
      "首场命中后先保护利润：低信号 PASS，中等信号只留 HK$10 位置。",
      "首场未中后不追损：只有 strong / very-strong 才允许低注继续。",
      `连续 ${config.stopAfterMisses} 场执行后未中，当天后面自动 STOP。`,
      "未知赛果不会当作赢或输；等官方赛果刷新后再滚动调整。",
    ],
    disclaimer: "这是资金纪律和纸上复盘工具，不保证盈利；实注前必须复核官方赔率、退出马和临场变化。",
  };
}

function meetingRaceEntries(entries, selectedEntry) {
  const source = Array.isArray(entries) ? entries : [];
  const date = selectedEntry?.date ?? source[0]?.date ?? null;
  const racecourse = selectedEntry?.racecourse ?? source[0]?.racecourse ?? null;
  return source
    .filter((entry) => {
      if (!date || !racecourse) return true;
      return entry.date === date && entry.racecourse === racecourse;
    })
    .sort((a, b) => Number(a.raceNo) - Number(b.raceNo));
}

function initialSessionState() {
  return {
    executedRaces: 0,
    hitRaces: 0,
    missedRaces: 0,
    missStreak: 0,
    score: 0,
    hasOpenRace: false,
  };
}

function decideRaceAction(baseStrategy, state, config) {
  if (state.missStreak >= config.stopAfterMisses) {
    return decision("STOP", "STOP / 停手", "连续执行未中，后面不再追。");
  }

  if (baseStrategy.mode === "pass" || baseStrategy.totalStake <= 0) {
    return decision("PASS", "PASS / 无入场", baseStrategy.rationale);
  }

  if (state.hasOpenRace) {
    return decision("PRE_RACE", "赛前计划", "前面赛事尚未结算，先按基础策略排队，赛果出来后再滚动调整。");
  }

  if (state.executedRaces === 0) {
    return decision("OPENING", "开局试探", "今日第一场按基础策略，但不要因为后面还有场次而加码。");
  }

  if (state.score > 0) {
    if (!ALLOW_PROTECT_CONFIDENCE.has(baseStrategy.confidence)) {
      return decision("PROTECT", "保护利润 / PASS", "第一场已经命中，低信号不再冒险，把盈利先锁住。");
    }
    return decision("PROTECT", "保护利润 / 轻注", "前面已经命中，后面只保留低波动位置票。");
  }

  if (state.score < 0) {
    if (!ALLOW_COOLDOWN_CONFIDENCE.has(baseStrategy.confidence)) {
      return decision("COOLDOWN", "冷却 / PASS", "前面未中，不追损；这场信号未到强档，跳过。");
    }
    return decision("COOLDOWN", "冷却 / 轻注", "前面未中也不翻倍，只允许强信号低注继续。");
  }

  return decision("NORMAL", "正常执行", "前面没有形成明显盈亏，按基础策略执行。");
}

function decision(state, badge, reason) {
  return { state, badge, reason };
}

function adjustBets(baseBets, decisionInfo, config) {
  if (["STOP", "PASS"].includes(decisionInfo.state)) return [];
  if (decisionInfo.state === "PROTECT" && /PASS/.test(decisionInfo.badge)) return [];
  if (decisionInfo.state === "COOLDOWN" && /PASS/.test(decisionInfo.badge)) return [];

  if (decisionInfo.state === "PROTECT") {
    return conservativePlaceOnly(baseBets, config.protectStake);
  }

  if (decisionInfo.state === "COOLDOWN") {
    return conservativePlaceOnly(baseBets, config.cooldownStake);
  }

  return baseBets.map(copyBet);
}

function conservativePlaceOnly(baseBets, stake) {
  const placeBet = baseBets.find((bet) => bet.type === "PLACE");
  if (!placeBet) return [];
  return [
    {
      ...copyBet(placeBet),
      amount: Math.min(Number(placeBet.amount) || 0, stake),
      rationale: `${placeBet.rationale} 动态策略已降档：只保留低注位置，不做独赢或组合追击。`,
    },
  ].filter((bet) => bet.amount > 0);
}

function copyBet(bet) {
  return {
    ...bet,
    horses: (bet.horses ?? []).map((horse) => ({ ...horse })),
  };
}

function settleAdaptiveBets(entry, bets) {
  if (!bets.length) {
    return {
      status: "SKIP",
      label: "SKIP / 未下注",
      detail: "动态规则建议跳过这场。",
      hitLines: 0,
      missLines: 0,
      openLines: 0,
    };
  }

  const reviews = bets.map((bet) => settleStrategyBetLine(entry, bet));
  const openLines = reviews.filter((review) => review.status === "OPEN").length;
  const hitLines = reviews.filter((review) => review.status === "HIT").length;
  const missLines = reviews.filter((review) => review.status === "MISS").length;

  if (openLines > 0) {
    return {
      status: "OPEN",
      label: "OPEN / 待赛",
      detail: "这场还没有官方赛果，先不影响后续资金状态。",
      hitLines,
      missLines,
      openLines,
      reviews,
    };
  }

  if (hitLines > 0) {
    return {
      status: "HIT",
      label: missLines > 0 ? "HIT / 有命中" : "HIT / 全中",
      detail: missLines > 0 ? `${hitLines} 条命中，${missLines} 条未中；按命中场处理，后面进入保护。` : `${hitLines} 条全部命中，后面进入保护。`,
      hitLines,
      missLines,
      openLines,
      reviews,
    };
  }

  return {
    status: "MISS",
    label: "MISS / 未中",
    detail: `${missLines} 条执行票都未中；后面进入冷却，不追损。`,
    hitLines,
    missLines,
    openLines,
    reviews,
  };
}

function applyOutcomeToState(state, outcome, stake) {
  if (outcome.status === "OPEN") {
    state.hasOpenRace = true;
    return;
  }

  if (outcome.status === "SKIP") return;

  state.executedRaces += 1;

  if (outcome.status === "HIT") {
    state.hitRaces += 1;
    state.missStreak = 0;
    state.score += 1;
    return;
  }

  if (outcome.status === "MISS" && stake > 0) {
    state.missedRaces += 1;
    state.missStreak += 1;
    state.score -= 1;
  }
}

function summarizeRows(rows) {
  const executedRows = rows.filter((row) => ["HIT", "MISS"].includes(row.outcome.status));
  const totalStake = rows.reduce((sum, row) => sum + row.totalStake, 0);
  const hitRows = executedRows.filter((row) => row.outcome.status === "HIT").length;
  const missedRows = executedRows.filter((row) => row.outcome.status === "MISS").length;
  const openRaces = rows.filter((row) => row.outcome.status === "OPEN").length;
  const skippedRaces = rows.filter((row) => row.outcome.status === "SKIP").length;

  return {
    races: rows.length,
    executedRaces: executedRows.length,
    hitRaces: hitRows,
    missedRaces: missedRows,
    skippedRaces,
    openRaces,
    totalStake,
    hitRate: executedRows.length > 0 ? hitRows / executedRows.length : 0,
  };
}
