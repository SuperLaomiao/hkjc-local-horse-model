import { buildStakingStrategy } from '../../bet-strategy.js';

const ODDS_BUCKETS = [
  { label: '<=3', min: 0, max: 3 },
  { label: '3.1-6', min: 3, max: 6 },
  { label: '6.1-10', min: 6, max: 10 },
  { label: '10+', min: 10, max: Infinity },
];

const PROBABILITY_BUCKETS = [
  { label: '<10%', min: 0, max: 0.1 },
  { label: '10-15%', min: 0.1, max: 0.15 },
  { label: '15-20%', min: 0.15, max: 0.2 },
  { label: '20%+', min: 0.2, max: Infinity },
];

export function buildPerformanceSnapshot(entries, options = {}) {
  const recentLimit = Number.isFinite(options.recentLimit) ? options.recentLimit : 30;
  const recentEntries = entries.slice(-recentLimit);

  return {
    overall: summarizeEntries(entries),
    recent: summarizeEntries(recentEntries),
    byMeeting: groupByMeeting(entries),
    topPickOddsBuckets: groupTopPickOddsBuckets(entries),
    probabilityCalibration: buildProbabilityCalibration(entries),
    stakingStrategy: buildStakingStrategyPerformance(entries),
    warning: 'Historical ROI is a paper-simulation signal, not proof of a stable edge or future profit.',
  };
}

export function buildStakingStrategyPerformance(entries) {
  const settlements = entries.map((entry) => settleStrategyEntry(entry));
  const active = settlements.filter((settlement) => settlement.strategy.totalStake > 0);
  const totalStake = sum(active, (settlement) => settlement.strategy.totalStake);
  const officialWinStake = sum(active, (settlement) => settlement.officialWinStake);
  const officialWinReturn = sum(active, (settlement) => settlement.officialWinReturn);
  const officialWinProfit = round(officialWinReturn - officialWinStake);
  const unpricedPoolStake = round(totalStake - officialWinStake);
  const unpricedHits = sum(active, (settlement) => settlement.unpricedHits);
  const breakEvenReturnNeededFromUnpricedPools = round(Math.max(0, totalStake - officialWinReturn));

  return {
    races: entries.length,
    strategyBets: active.length,
    passRaces: entries.length - active.length,
    totalStake: round(totalStake),
    anyHits: active.filter((settlement) => settlement.anyHit).length,
    anyHitRate: ratio(active.filter((settlement) => settlement.anyHit).length, active.length),
    officialWinStake: round(officialWinStake),
    officialWinReturn: round(officialWinReturn),
    officialWinProfit,
    officialWinRoi: roi(officialWinReturn, officialWinStake),
    fullStrategyRoi: null,
    winBets: sum(active, (settlement) => settlement.winBets),
    winHits: sum(active, (settlement) => settlement.winHits),
    placeBets: sum(active, (settlement) => settlement.placeBets),
    placeHits: sum(active, (settlement) => settlement.placeHits),
    quinellaPlaceBets: sum(active, (settlement) => settlement.quinellaPlaceBets),
    quinellaPlaceHits: sum(active, (settlement) => settlement.quinellaPlaceHits),
    quinellaBets: sum(active, (settlement) => settlement.quinellaBets),
    quinellaHits: sum(active, (settlement) => settlement.quinellaHits),
    unpricedPoolStake,
    unpricedHits,
    breakEvenReturnNeededFromUnpricedPools,
    breakEvenReturnPerUnpricedHit: unpricedHits > 0 ? round(breakEvenReturnNeededFromUnpricedPools / unpricedHits) : null,
    roiNote: '全策略 ROI 暂不可计算：历史数据还缺 Place / Quinella Place / Quinella 官方派彩；officialWinRoi 只结算有官方独赢赔率的 Win 下注线。',
  };
}

export function summarizeEntries(entries) {
  const races = entries.length;
  const topPickWins = entries.filter((entry) => entry.settlement?.topPickHit).length;
  const topPickReturn = entries.reduce((sum, entry) => sum + topPickReturnForEntry(entry), 0);
  const valueBetEntries = entries.filter((entry) => Number(entry.settlement?.stake) > 0);
  const valueStake = valueBetEntries.reduce((sum, entry) => sum + Number(entry.settlement?.stake ?? 0), 0);
  const valueReturn = valueBetEntries.reduce((sum, entry) => sum + Number(entry.settlement?.returned ?? 0), 0);
  const valueWins = valueBetEntries.filter((entry) => entry.settlement?.resultLabel === 'WIN').length;
  const favouriteEntries = entries.filter((entry) => entry.settlement?.marketFavourite);
  const marketFavouriteReturn = favouriteEntries.reduce((sum, entry) => (
    sum + (entry.settlement.marketFavourite.placing === 1 ? Number(entry.settlement.marketFavourite.winOdds ?? 0) : 0)
  ), 0);
  const marketFavouriteWins = favouriteEntries.filter((entry) => entry.settlement.marketFavourite.placing === 1).length;

  return {
    races,
    topPickWins,
    topPickWinRate: ratio(topPickWins, races),
    topPickReturn: round(topPickReturn),
    topPickRoi: roi(topPickReturn, races),
    valueBets: valueBetEntries.length,
    valueWins,
    valueWinRate: ratio(valueWins, valueBetEntries.length),
    valueStake: round(valueStake),
    valueReturn: round(valueReturn),
    valueProfit: round(valueReturn - valueStake),
    valueRoi: roi(valueReturn, valueStake),
    marketFavouriteBets: favouriteEntries.length,
    marketFavouriteWins,
    marketFavouriteWinRate: ratio(marketFavouriteWins, favouriteEntries.length),
    marketFavouriteReturn: round(marketFavouriteReturn),
    marketFavouriteRoi: roi(marketFavouriteReturn, favouriteEntries.length),
  };
}

export function groupByMeeting(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const key = `${entry.date}-${entry.racecourse}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(entry);
  }

  return [...grouped.entries()]
    .map(([key, meetingEntries]) => {
      const [date, racecourse] = splitMeetingKey(key);
      return {
        key,
        date,
        racecourse,
        ...summarizeEntries(meetingEntries),
      };
    })
    .sort((a, b) => b.key.localeCompare(a.key));
}

export function groupTopPickOddsBuckets(entries) {
  return ODDS_BUCKETS.map((bucket) => {
    const bucketEntries = entries.filter((entry) => {
      const odds = Number(entry.forecast?.topPick?.winOdds);
      if (!Number.isFinite(odds)) return false;
      return odds > bucket.min && odds <= bucket.max;
    });
    const wins = bucketEntries.filter((entry) => entry.settlement?.topPickHit).length;
    const returned = bucketEntries.reduce((sum, entry) => sum + topPickReturnForEntry(entry), 0);

    return {
      label: bucket.label,
      races: bucketEntries.length,
      wins,
      winRate: ratio(wins, bucketEntries.length),
      returned: round(returned),
      roi: roi(returned, bucketEntries.length),
    };
  });
}

export function buildProbabilityCalibration(entries) {
  return PROBABILITY_BUCKETS.map((bucket) => {
    const bucketEntries = entries.filter((entry) => {
      const probability = Number(entry.forecast?.topPick?.probability);
      if (!Number.isFinite(probability)) return false;
      return probability >= bucket.min && probability < bucket.max;
    });
    const wins = bucketEntries.filter((entry) => entry.settlement?.topPickHit).length;
    const probabilityTotal = bucketEntries.reduce((sum, entry) => sum + Number(entry.forecast?.topPick?.probability ?? 0), 0);

    return {
      label: bucket.label,
      races: bucketEntries.length,
      wins,
      averageProbability: bucketEntries.length > 0 ? round(probabilityTotal / bucketEntries.length, 4) : 0,
      actualWinRate: ratio(wins, bucketEntries.length),
      calibrationGap: bucketEntries.length > 0 ? round(ratio(wins, bucketEntries.length) - probabilityTotal / bucketEntries.length, 4) : 0,
    };
  });
}

function settleStrategyEntry(entry) {
  const strategy = buildStakingStrategy(entry);
  const runnerById = new Map((entry.settlement?.runnerResults ?? []).map((runner) => [runner.horseId, runner]));
  const fieldSize = runnerById.size;
  const placeCutoff = fieldSize > 0 && fieldSize <= 6 ? 2 : 3;
  const result = {
    strategy,
    anyHit: false,
    officialWinStake: 0,
    officialWinReturn: 0,
    winBets: 0,
    winHits: 0,
    placeBets: 0,
    placeHits: 0,
    quinellaPlaceBets: 0,
    quinellaPlaceHits: 0,
    quinellaBets: 0,
    quinellaHits: 0,
    unpricedHits: 0,
  };

  for (const bet of strategy.bets) {
    const runners = bet.horses.map((horse) => runnerById.get(horse.horseId)).filter(Boolean);
    const hit = betHit(bet.type, runners, placeCutoff);
    if (hit) result.anyHit = true;

    if (bet.type === 'WIN') {
      result.winBets += 1;
      result.officialWinStake += bet.amount;
      if (hit) {
        result.winHits += 1;
        result.officialWinReturn += bet.amount * Number(runners[0]?.winOdds ?? bet.horses[0]?.winOdds ?? 0);
      }
    } else if (bet.type === 'PLACE') {
      result.placeBets += 1;
      if (hit) {
        result.placeHits += 1;
        result.unpricedHits += 1;
      }
    } else if (bet.type === 'QUINELLA_PLACE') {
      result.quinellaPlaceBets += 1;
      if (hit) {
        result.quinellaPlaceHits += 1;
        result.unpricedHits += 1;
      }
    } else if (bet.type === 'QUINELLA') {
      result.quinellaBets += 1;
      if (hit) {
        result.quinellaHits += 1;
        result.unpricedHits += 1;
      }
    }
  }

  result.officialWinStake = round(result.officialWinStake);
  result.officialWinReturn = round(result.officialWinReturn);
  return result;
}

function betHit(type, runners, placeCutoff) {
  if (type === 'WIN') return runners.length === 1 && runners[0].placing === 1;
  if (type === 'PLACE') return runners.length === 1 && runners[0].placing <= placeCutoff;
  if (type === 'QUINELLA_PLACE') return runners.length === 2 && runners.every((runner) => runner.placing <= placeCutoff);
  if (type === 'QUINELLA') return runners.length === 2 && runners.every((runner) => runner.placing <= 2);
  return false;
}

function topPickReturnForEntry(entry) {
  if (!entry.settlement?.topPickHit) return 0;
  const odds = Number(entry.forecast?.topPick?.winOdds);
  return Number.isFinite(odds) ? odds : 0;
}

function splitMeetingKey(key) {
  const match = /^(\d{4}-\d{2}-\d{2})-(.+)$/.exec(key);
  if (!match) return [key, ''];
  return [match[1], match[2]];
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function roi(returned, stake) {
  return stake > 0 ? (returned - stake) / stake : 0;
}

function sum(values, selector) {
  return values.reduce((total, value) => total + Number(selector(value) ?? 0), 0);
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}
