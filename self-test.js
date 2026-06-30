export function createUserPick(entry, runner, options = {}) {
  const stake = Number.isFinite(Number(options.stake)) ? Number(options.stake) : 10;
  return {
    raceId: entry.raceId,
    date: entry.date,
    racecourse: entry.racecourse,
    raceNo: entry.raceNo,
    horseId: runner.horseId ?? null,
    horseNo: runner.horseNo ?? null,
    horseName: runner.horseName ?? null,
    modelProbability: numberOrNull(runner.probability),
    fairOdds: numberOrNull(runner.fairOdds),
    winOdds: numberOrNull(runner.winOdds),
    stake,
    pickedAt: options.pickedAt ?? new Date().toISOString(),
  };
}

export function settleUserPick(entry, pick) {
  if (!entry?.settlement) {
    return {
      status: 'OPEN',
      placing: null,
      stake: Number(pick?.stake ?? 0),
      returned: 0,
      profit: 0,
      winnerHorseName: null,
    };
  }

  const won = pick?.horseId && pick.horseId === entry.settlement.winnerHorseId;
  const stake = Number(pick?.stake ?? 0);
  const odds = Number(pick?.winOdds);
  const returned = won && Number.isFinite(odds) ? roundMoney(stake * odds) : 0;

  return {
    status: won ? 'WIN' : 'MISS',
    placing: won ? 1 : null,
    stake,
    returned,
    profit: roundMoney(returned - stake),
    winnerHorseName: entry.settlement.winnerHorseName ?? null,
  };
}

export function summarizeUserPicks(entries, picks) {
  const entryByRaceId = new Map(entries.map((entry) => [entry.raceId, entry]));
  const settlements = picks.map((pick) => ({
    pick,
    settlement: settleUserPick(entryByRaceId.get(pick.raceId), pick),
  }));
  const settled = settlements.filter((item) => item.settlement.status !== 'OPEN');
  const wins = settled.filter((item) => item.settlement.status === 'WIN');
  const stake = settled.reduce((sum, item) => sum + item.settlement.stake, 0);
  const returned = settled.reduce((sum, item) => sum + item.settlement.returned, 0);
  const profit = roundMoney(returned - stake);

  return {
    picks: picks.length,
    settled: settled.length,
    open: settlements.length - settled.length,
    wins: wins.length,
    stake: roundMoney(stake),
    returned: roundMoney(returned),
    profit,
    winRate: settled.length > 0 ? wins.length / settled.length : 0,
    roi: stake > 0 ? profit / stake : 0,
  };
}

export function createLockedForecast(entry, generatedAt = new Date().toISOString()) {
  const forecast = entry.forecast ?? {};
  return {
    raceId: entry.raceId,
    date: entry.date,
    racecourse: entry.racecourse,
    raceNo: entry.raceNo,
    lockedAt: generatedAt,
    topPick: cloneForecastPart(forecast.topPick),
    recommendation: cloneForecastPart(forecast.recommendation),
    finalBetPlan: cloneForecastPart(forecast.finalBetPlan),
    predictions: (forecast.predictions ?? []).map(cloneForecastPart),
  };
}

export function settleLockedForecast(entry, lockedForecast) {
  if (!entry?.settlement) {
    return {
      status: 'OPEN',
      topPickStatus: 'OPEN',
      recommendationStatus: 'OPEN',
      winnerHorseName: null,
    };
  }

  return {
    status: 'SETTLED',
    topPickStatus: horseStatus(entry, lockedForecast?.topPick?.horseId),
    recommendationStatus: horseStatus(entry, lockedForecast?.recommendation?.horseId),
    winnerHorseName: entry.settlement.winnerHorseName ?? null,
  };
}

function horseStatus(entry, horseId) {
  if (!horseId) return 'PASS';
  return horseId === entry.settlement?.winnerHorseId ? 'WIN' : 'MISS';
}

function cloneForecastPart(value) {
  return value == null ? null : JSON.parse(JSON.stringify(value));
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundMoney(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}
