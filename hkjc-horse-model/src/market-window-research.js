const DEFAULT_ODDS_CAPS = [3, 5, 7.5, 10, 20];
const DEFAULT_STAKE = 10;

export function buildMarketWindowResearchReport({
  races = [],
  featuresByRunner = new Map(),
  oddsCaps = DEFAULT_ODDS_CAPS,
  stake = DEFAULT_STAKE,
  generatedAt = new Date().toISOString(),
} = {}) {
  const records = buildT30FavouriteRecords({ races, featuresByRunner, stake });
  const allFavourite = settleRecords(records, 'T-30 market favourite');
  const byMaxOdds = Object.fromEntries(oddsCaps.map((cap) => [
    String(cap),
    settleRecords(
      records.filter((record) => record.t30Odds <= Number(cap)),
      `T-30 market favourite <= ${cap}`,
    ),
  ]));
  const shortening = settleRecords(
    records.filter((record) => Number(record.oddsPctChangeT60ToT30) < 0),
    'T-30 favourite shortened from T-60',
  );
  const capSevenPointFive = byMaxOdds['7.5'];

  return {
    generatedAt,
    status: records.length > 0 ? 'ready' : 'missing-market-data',
    methodology: {
      inspiration: 'eprochasson A Day At The Races: test market odds windows and odds-cap filtering instead of betting every prediction.',
      window: 'T-30 WIN odds',
      settlement: 'official WIN dividend_per10 when the selected horse wins',
      stake,
    },
    summary: {
      races: races.length,
      racesWithT30WinOdds: records.length,
    },
    strategies: {
      t30MarketFavourite: allFavourite,
      t30FavouriteShortening: shortening,
    },
    byMaxOdds,
    takeaways: buildTakeaways({ allFavourite, capSevenPointFive, shortening }),
  };
}

function buildT30FavouriteRecords({ races, featuresByRunner, stake }) {
  const records = [];

  for (const race of races ?? []) {
    if (!Array.isArray(race.runners) || race.runners.length === 0) continue;
    const winDividend = firstWinDividend(race);
    if (!winDividend) continue;

    const runners = race.runners
      .map((runner) => {
        const features = featuresByRunner.get(`${race.raceId}|${runner.horseNo}`) ?? {};
        return {
          runner,
          t30Odds: numeric(features.marketWinOddsT30),
          oddsPctChangeT60ToT30: numeric(features.marketWinOddsPctChangeT60ToT30),
        };
      })
      .filter((item) => Number.isFinite(item.t30Odds) && item.t30Odds > 0)
      .sort((a, b) => a.t30Odds - b.t30Odds || Number(a.runner.horseNo ?? 0) - Number(b.runner.horseNo ?? 0));

    const favourite = runners[0];
    if (!favourite) continue;
    const selectedHorseNo = Number(favourite.runner.horseNo);
    const isWinner = selectedHorseNo === Number(winDividend.combination?.[0]);
    records.push({
      raceId: race.raceId,
      date: race.date,
      racecourse: race.racecourse,
      raceNo: race.raceNo,
      horseNo: selectedHorseNo,
      horseName: favourite.runner.horseName ?? null,
      t30Odds: favourite.t30Odds,
      oddsPctChangeT60ToT30: favourite.oddsPctChangeT60ToT30,
      stake,
      isWinner,
      return: isWinner ? Number(winDividend.dividendPer10 ?? 0) * (stake / 10) : 0,
    });
  }

  return records;
}

function settleRecords(records, label) {
  const bets = records.length;
  const wins = records.filter((record) => record.isWinner).length;
  const stake = sum(records.map((record) => record.stake));
  const returns = sum(records.map((record) => record.return));
  const averageT30Odds = bets > 0 ? round(sum(records.map((record) => record.t30Odds)) / bets, 4) : null;
  const profit = returns - stake;

  return {
    label,
    bets,
    wins,
    stake: round(stake, 2),
    return: round(returns, 2),
    profit: round(profit, 2),
    roi: stake > 0 ? round(profit / stake, 6) : null,
    hitRate: bets > 0 ? round(wins / bets, 6) : null,
    averageT30Odds,
  };
}

function firstWinDividend(race) {
  const winDividends = race.dividends?.win;
  return Array.isArray(winDividends) ? winDividends[0] : null;
}

function buildTakeaways({ allFavourite, capSevenPointFive, shortening }) {
  const takeaways = [];
  if (capSevenPointFive && Number.isFinite(capSevenPointFive.roi) && Number.isFinite(allFavourite.roi)) {
    const delta = capSevenPointFive.roi - allFavourite.roi;
    takeaways.push(`Odds cap 7.5 changed ROI by ${formatPercent(delta)} versus betting every T-30 favourite.`);
  }
  if (shortening && shortening.bets > 0) {
    takeaways.push(`T-60 to T-30 shortening filter produced ${shortening.bets} bets with ROI ${formatPercent(shortening.roi)}.`);
  }
  if (takeaways.length === 0) {
    takeaways.push('No actionable market-window takeaway yet; import T-30 odds before using this report.');
  }
  return takeaways;
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sum(values) {
  return values.reduce((total, value) => total + Number(value ?? 0), 0);
}

function round(value, digits = 6) {
  const multiplier = 10 ** digits;
  return Math.round(Number(value ?? 0) * multiplier) / multiplier;
}

function formatPercent(value) {
  if (!Number.isFinite(Number(value))) return 'n/a';
  const number = Number(value);
  return `${number >= 0 ? '+' : ''}${(number * 100).toFixed(1)}%`;
}
