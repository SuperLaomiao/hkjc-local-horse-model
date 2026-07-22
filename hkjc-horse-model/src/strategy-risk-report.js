import { settleStrategyEntry } from './performance.js';

const POOLS = ['WIN', 'PLACE', 'QUINELLA_PLACE', 'QUINELLA'];

export function buildStrategyRiskReport(entries, options = {}) {
  const maxTimelineRows = Number.isFinite(Number(options.maxTimelineRows))
    ? Number(options.maxTimelineRows)
    : 200;
  const settled = entries.map((entry) => enrichEntrySettlement(entry));
  const active = settled.filter((row) => row.totalStake > 0);
  const byPool = buildPoolSummary(active);
  const fullTimeline = buildTimeline(active);
  const summary = buildSummary({ entries, active, timeline: fullTimeline });
  const concentration = buildConcentration(active, summary.totalStake);
  const timeline = fullTimeline.slice(-maxTimelineRows);

  return {
    generatedAt: new Date().toISOString(),
    summary,
    byPool,
    concentration,
    timeline,
    warning: 'Paper-simulated strategy risk report. ROI and drawdown can change materially once live odds, withdrawals, and missing pool dividends are captured.',
  };
}

export function buildGuardedStakingSweep(lines, options = {}) {
  const bankroll = positiveNumber(options.bankroll ?? 1000, 'bankroll');
  const maxRaceStakePct = rateNumber(options.maxRaceStakePct ?? 0.02, 'maxRaceStakePct');
  const promotion = normalizePromotion(options.promotion);
  const maxRaceStake = Math.min(100, Math.floor((bankroll * maxRaceStakePct) / 10) * 10);
  const positivePromotionStates = new Set([
    'RESEARCH_CHAMPION',
    'REVIEW_REQUIRED',
    'APPROVED_CANDIDATE',
  ]);
  if (!positivePromotionStates.has(promotion.state)) {
    return {
      version: 'guarded-staking-sweep-v1',
      state: 'BLOCKED_PROMOTION',
      pool: promotion.pool,
      bankroll,
      maxRaceStakePct,
      maxRaceStake,
      cashMode: 'NO_BET',
      executionStatus: 'PAPER_ONLY',
      strategies: [],
      promotion: {
        state: promotion.state,
        manualReviewComplete: promotion.manualReviewComplete,
      },
      activationRequired: 'A positive prospective promotion gate is required before research staking sweeps; this report cannot enable PLAY.',
    };
  }
  const rows = normalizeSweepLines(lines, promotion.pool);
  const strategyPolicies = [
    { id: 'fixed-hk10', type: 'fixed', amount: 10 },
    { id: 'fractional-kelly-0.1', type: 'kelly', fraction: 0.1 },
    { id: 'fractional-kelly-0.25', type: 'kelly', fraction: 0.25 },
    { id: 'fractional-kelly-0.5', type: 'kelly', fraction: 0.5 },
    {
      id: 'conservative-capped',
      type: 'kelly',
      fraction: 0.25,
      strategyCap: Math.min(20, maxRaceStake),
    },
  ];
  const strategies = strategyPolicies.map((policy) => {
    const settlements = rows.map((row) => {
      const stake = researchStakeFor(row, policy, { bankroll, maxRaceStake });
      const returned = row.outcome === 1 ? stake * row.decimalOdds : 0;
      return { stake, returned, profit: returned - stake };
    });
    const researchStake = sum(settlements, (line) => line.stake);
    const researchReturn = sum(settlements, (line) => line.returned);
    const researchProfit = researchReturn - researchStake;
    return {
      id: policy.id,
      researchStake: round(researchStake),
      researchReturn: round(researchReturn),
      researchProfit: round(researchProfit),
      researchRoi: researchStake > 0 ? round(researchProfit / researchStake, 4) : null,
      maxRaceStake: settlements.length
        ? round(Math.max(...settlements.map((line) => line.stake)))
        : 0,
      maxDrawdown: sweepMaxDrawdown(settlements),
      executableStake: 0,
      executionStatus: 'NO_BET',
    };
  });
  const approvedResearch = promotion.state === 'APPROVED_CANDIDATE'
    && promotion.manualReviewComplete;

  return {
    version: 'guarded-staking-sweep-v1',
    state: approvedResearch ? 'APPROVED_RESEARCH_NO_CASH' : promotion.state,
    pool: promotion.pool,
    bankroll,
    maxRaceStakePct,
    maxRaceStake,
    cashMode: 'NO_BET',
    executionStatus: 'PAPER_ONLY',
    strategies,
    promotion: {
      state: promotion.state,
      manualReviewComplete: promotion.manualReviewComplete,
    },
    activationRequired: 'A separate cash authorization outside this research report is required; this sweep cannot enable PLAY.',
  };
}

function normalizePromotion(promotion) {
  if (!promotion || typeof promotion !== 'object' || Array.isArray(promotion)) {
    throw new TypeError('promotion must be an object');
  }
  const state = String(promotion.state ?? '').trim().toUpperCase();
  if (!['BLOCKED_DATA', 'NO_GO', 'RESEARCH_CHAMPION', 'REVIEW_REQUIRED', 'APPROVED_CANDIDATE'].includes(state)) {
    throw new TypeError('promotion.state is not supported');
  }
  const pool = canonicalPool(promotion.pool);
  const reviewedBy = String(promotion.manualReview?.reviewedBy ?? '').trim();
  const reviewedAt = Date.parse(promotion.manualReview?.reviewedAt ?? '');
  return {
    state,
    pool,
    manualReviewComplete: state === 'APPROVED_CANDIDATE'
      && Boolean(reviewedBy)
      && Number.isFinite(reviewedAt),
  };
}

function normalizeSweepLines(lines, pool) {
  if (!Array.isArray(lines)) throw new TypeError('lines must be an array');
  return lines.map((line, index) => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) {
      throw new TypeError(`lines[${index}] must be an object`);
    }
    const linePool = canonicalPool(line.pool);
    if (linePool !== pool) throw new Error(`lines[${index}] pool does not match promotion pool`);
    const probability = probabilityNumber(line.probability, `lines[${index}].probability`);
    const decimalOdds = positiveNumber(line.decimalOdds, `lines[${index}].decimalOdds`);
    const outcome = Number(line.outcome);
    if (![0, 1].includes(outcome)) throw new TypeError(`lines[${index}].outcome must be 0 or 1`);
    return {
      raceId: String(line.raceId ?? `line-${index}`),
      pool: linePool,
      probability,
      decimalOdds,
      outcome,
    };
  });
}

function researchStakeFor(line, policy, { bankroll, maxRaceStake }) {
  if (line.probability * line.decimalOdds <= 1 || maxRaceStake < 10) return 0;
  if (policy.type === 'fixed') return Math.min(policy.amount, maxRaceStake);
  const fullKelly = (line.probability * line.decimalOdds - 1) / (line.decimalOdds - 1);
  const rawStake = bankroll * Math.max(0, fullKelly) * policy.fraction;
  const cap = Math.min(maxRaceStake, policy.strategyCap ?? maxRaceStake);
  return Math.min(cap, Math.floor(rawStake / 10) * 10);
}

function sweepMaxDrawdown(lines) {
  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const line of lines) {
    cumulative += line.profit;
    peak = Math.max(peak, cumulative);
    maxDrawdown = Math.max(maxDrawdown, peak - cumulative);
  }
  return round(maxDrawdown);
}

function canonicalPool(value) {
  const compact = String(value ?? '').trim().toUpperCase().replaceAll(/[^A-Z]/g, '');
  if (compact === 'WIN') return 'WIN';
  if (['PLA', 'PLACE'].includes(compact)) return 'PLACE';
  if (['QIN', 'QUINELLA'].includes(compact)) return 'QUINELLA';
  if (['QPL', 'QUINELLAPLACE'].includes(compact)) return 'QUINELLA_PLACE';
  throw new TypeError('pool must be WIN, PLACE, QIN, or QPL');
}

function positiveNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new TypeError(`${label} must be positive`);
  return number;
}

function probabilityNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new TypeError(`${label} must be between 0 and 1`);
  }
  return number;
}

function rateNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 1) {
    throw new TypeError(`${label} must be greater than 0 and at most 1`);
  }
  return number;
}

function enrichEntrySettlement(entry) {
  const settlement = settleStrategyEntry(entry);
  const totalStake = Number(settlement.strategy.totalStake ?? 0);
  const knownReturn = Number(settlement.knownStrategyReturn ?? 0);
  const knownProfit = round(knownReturn - totalStake);
  const poolStake = stakeByPool(settlement.strategy.bets);
  const horseStake = stakeByHorse(settlement.strategy.bets);

  return {
    entry,
    settlement,
    totalStake: round(totalStake),
    knownReturn: round(knownReturn),
    knownProfit,
    hit: settlement.anyHit,
    poolStake,
    horseStake,
  };
}

function buildPoolSummary(active) {
  const result = Object.fromEntries(POOLS.map((pool) => [pool, {
    stake: 0,
    bets: 0,
    hits: 0,
    return: 0,
    profit: 0,
    roi: 0,
  }]));

  for (const row of active) {
    const settlement = row.settlement;
    result.WIN.stake += row.poolStake.WIN;
    result.WIN.bets += settlement.winBets;
    result.WIN.hits += settlement.winHits;
    result.WIN.return += settlement.officialWinReturn;

    result.PLACE.stake += row.poolStake.PLACE;
    result.PLACE.bets += settlement.placeBets;
    result.PLACE.hits += settlement.placeHits;
    result.PLACE.return += settlement.placeReturn;

    result.QUINELLA_PLACE.stake += row.poolStake.QUINELLA_PLACE;
    result.QUINELLA_PLACE.bets += settlement.quinellaPlaceBets;
    result.QUINELLA_PLACE.hits += settlement.quinellaPlaceHits;
    result.QUINELLA_PLACE.return += settlement.quinellaPlaceReturn;

    result.QUINELLA.stake += row.poolStake.QUINELLA;
    result.QUINELLA.bets += settlement.quinellaBets;
    result.QUINELLA.hits += settlement.quinellaHits;
    result.QUINELLA.return += settlement.quinellaReturn;
  }

  for (const pool of POOLS) {
    const item = result[pool];
    item.stake = round(item.stake);
    item.return = round(item.return);
    item.profit = round(item.return - item.stake);
    item.roi = roi(item.return, item.stake);
  }

  return result;
}

function buildTimeline(active) {
  let cumulativeProfit = 0;
  let peak = 0;

  return active.map((row) => {
    cumulativeProfit = round(cumulativeProfit + row.knownProfit);
    peak = Math.max(peak, cumulativeProfit);
    const drawdown = round(peak - cumulativeProfit);

    return {
      raceId: row.entry.raceId,
      date: row.entry.date ?? row.entry.forecast?.date ?? row.entry.settlement?.date ?? null,
      racecourse: row.entry.racecourse ?? row.entry.forecast?.racecourse ?? row.entry.settlement?.racecourse ?? null,
      raceNo: row.entry.raceNo ?? row.entry.forecast?.raceNo ?? row.entry.settlement?.raceNo ?? null,
      stake: row.totalStake,
      knownReturn: row.knownReturn,
      knownProfit: row.knownProfit,
      cumulativeProfit,
      drawdown,
      hit: row.hit,
      mainExposure: topHorseExposure(row.horseStake),
      poolProfit: Object.fromEntries(POOLS.map((pool) => [pool, round(poolReturn(row.settlement, pool) - row.poolStake[pool])])),
    };
  });
}

function buildSummary({ entries, active, timeline }) {
  const totalStake = sum(active, (row) => row.totalStake);
  const knownReturn = sum(active, (row) => row.knownReturn);
  const knownProfit = round(knownReturn - totalStake);
  const activeTimeline = timeline;
  const longestLosingStreak = maxLosingStreak(activeTimeline);
  const maxDrawdown = activeTimeline.length > 0
    ? Math.max(...activeTimeline.map((row) => Number(row.drawdown ?? 0)))
    : 0;
  const hits = active.filter((row) => row.hit).length;
  const unpricedPoolStake = sum(active, (row) => row.settlement.unpricedPoolStake);
  const unpricedHits = sum(active, (row) => row.settlement.unpricedHits);

  return {
    races: entries.length,
    activeRaces: active.length,
    passRaces: entries.length - active.length,
    totalStake: round(totalStake),
    knownReturn: round(knownReturn),
    knownProfit,
    knownRoi: roi(knownReturn, totalStake),
    cumulativeProfit: activeTimeline.length > 0 ? activeTimeline.at(-1).cumulativeProfit : 0,
    maxDrawdown: round(maxDrawdown),
    longestLosingStreak,
    hits,
    hitRate: ratio(hits, active.length),
    unpricedPoolStake: round(unpricedPoolStake),
    unpricedHits,
  };
}

function buildConcentration(active, totalStake) {
  const raceStakes = active.map((row) => row.totalStake);
  const positiveProfits = active.map((row) => Math.max(0, row.knownProfit));
  const largestRaceStake = raceStakes.length > 0 ? Math.max(...raceStakes) : 0;
  const largestPositiveRaceProfit = positiveProfits.length > 0 ? Math.max(...positiveProfits) : 0;
  const totalPositiveProfit = sum(positiveProfits, (value) => value);
  const horseStakeTotals = new Map();

  for (const row of active) {
    for (const exposure of row.horseStake.values()) {
      const existing = horseStakeTotals.get(exposure.horseId) ?? {
        horseId: exposure.horseId,
        horseNo: exposure.horseNo,
        horseName: exposure.horseName,
        stakeInvolvingHorse: 0,
      };
      existing.stakeInvolvingHorse += exposure.stakeInvolvingHorse;
      horseStakeTotals.set(exposure.horseId, existing);
    }
  }

  const topHorseStakeShares = [...horseStakeTotals.values()]
    .sort((a, b) => b.stakeInvolvingHorse - a.stakeInvolvingHorse)
    .slice(0, 10)
    .map((item) => ({
      ...item,
      stakeInvolvingHorse: round(item.stakeInvolvingHorse),
      shareOfTotalStake: ratio(item.stakeInvolvingHorse, totalStake),
    }));

  return {
    largestRaceStake: round(largestRaceStake),
    largestRaceStakeShare: ratio(largestRaceStake, totalStake),
    largestPositiveRaceProfit: round(largestPositiveRaceProfit),
    largestPositiveRaceProfitShare: ratio(largestPositiveRaceProfit, totalPositiveProfit),
    topHorseStakeShares,
  };
}

function stakeByPool(bets) {
  const stakes = Object.fromEntries(POOLS.map((pool) => [pool, 0]));
  for (const bet of bets ?? []) {
    if (!Object.hasOwn(stakes, bet.type)) continue;
    stakes[bet.type] += Number(bet.amount ?? 0);
  }
  return Object.fromEntries(POOLS.map((pool) => [pool, round(stakes[pool])]));
}

function stakeByHorse(bets) {
  const stakes = new Map();
  for (const bet of bets ?? []) {
    const amount = Number(bet.amount ?? 0);
    for (const horse of bet.horses ?? []) {
      const horseId = horse.horseId ?? `horse-${horse.horseNo ?? horse.horseName ?? 'unknown'}`;
      const existing = stakes.get(horseId) ?? {
        horseId,
        horseNo: horse.horseNo ?? null,
        horseName: horse.horseName ?? null,
        stakeInvolvingHorse: 0,
      };
      existing.stakeInvolvingHorse += amount;
      stakes.set(horseId, existing);
    }
  }
  return stakes;
}

function topHorseExposure(horseStake) {
  const [top] = [...horseStake.values()].sort((a, b) => b.stakeInvolvingHorse - a.stakeInvolvingHorse);
  if (!top) return null;
  return {
    ...top,
    stakeInvolvingHorse: round(top.stakeInvolvingHorse),
  };
}

function poolReturn(settlement, pool) {
  if (pool === 'WIN') return Number(settlement.officialWinReturn ?? 0);
  if (pool === 'PLACE') return Number(settlement.placeReturn ?? 0);
  if (pool === 'QUINELLA_PLACE') return Number(settlement.quinellaPlaceReturn ?? 0);
  if (pool === 'QUINELLA') return Number(settlement.quinellaReturn ?? 0);
  return 0;
}

function maxLosingStreak(timeline) {
  let longest = 0;
  let current = 0;
  for (const row of timeline) {
    if (Number(row.knownProfit ?? 0) < 0) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

function roi(returned, stake) {
  return stake > 0 ? round((returned - stake) / stake, 4) : 0;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? round(numerator / denominator, 4) : 0;
}

function sum(values, selector) {
  return values.reduce((total, value) => total + Number(selector(value) ?? 0), 0);
}

function round(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return 0;
  const multiplier = 10 ** digits;
  return Math.round(Number(value) * multiplier) / multiplier;
}
