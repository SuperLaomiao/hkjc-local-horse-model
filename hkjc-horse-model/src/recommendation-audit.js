export function auditRecommendationRuns({ runs = [], races = [] } = {}) {
  const raceById = new Map(races.map((race) => [race.raceId, race]));
  const auditedRuns = runs.map((run) => auditRun(run, raceById.get(run.raceId)));
  const settledRuns = auditedRuns.filter((run) => run.status === 'SETTLED');
  const openRuns = auditedRuns.filter((run) => run.status === 'OPEN');
  const allSettledLines = settledRuns.flatMap((run) => run.lines);
  const totalStake = round(sum(allSettledLines, (line) => line.stake));
  const totalReturn = round(sum(allSettledLines, (line) => line.returned));
  const profit = round(totalReturn - totalStake);

  return {
    summary: {
      runs: auditedRuns.length,
      settledRuns: settledRuns.length,
      openRuns: openRuns.length,
      totalStake,
      totalReturn,
      profit,
      roi: totalStake > 0 ? round(profit / totalStake, 4) : null,
      hitLines: allSettledLines.filter((line) => line.status === 'HIT').length,
      missLines: allSettledLines.filter((line) => line.status === 'MISS').length,
      passLines: allSettledLines.filter((line) => line.status === 'PASS').length,
    },
    runs: auditedRuns,
  };
}

function auditRun(run, race) {
  const recommendations = Array.isArray(run.recommendations) ? run.recommendations : [];
  if (!race || race.status === 'upcoming') {
    return {
      ...run,
      status: 'OPEN',
      stake: 0,
      returned: 0,
      profit: 0,
      lines: recommendations.map((line) => ({
        ...line,
        status: 'OPEN',
        stake: lineStake(line),
        returned: 0,
        profit: 0,
      })),
    };
  }

  const lines = recommendations.map((line) => auditLine(line, race));
  const stake = round(sum(lines, (line) => line.stake));
  const returned = round(sum(lines, (line) => line.returned));

  return {
    ...run,
    status: 'SETTLED',
    stake,
    returned,
    profit: round(returned - stake),
    lines,
  };
}

function auditLine(line, race) {
  const stake = lineStake(line);
  if (stake <= 0) {
    return {
      ...line,
      status: 'PASS',
      stake: 0,
      returned: 0,
      profit: 0,
    };
  }

  const poolKey = poolKeyForLine(line);
  const combination = combinationForLine(line);
  const dividendPer10 = findDividendPer10({
    poolKey,
    combination,
    dividends: race.dividends,
  });
  const returned = dividendPer10 == null ? 0 : round((stake / 10) * dividendPer10);

  return {
    ...line,
    status: returned > 0 ? 'HIT' : 'MISS',
    poolKey,
    combination,
    stake,
    dividendPer10,
    returned,
    profit: round(returned - stake),
  };
}

function findDividendPer10({ poolKey, combination, dividends }) {
  const pool = dividends?.[poolKey];
  if (!Array.isArray(pool)) return null;

  const wanted = combinationKey(combination, poolKey);
  const match = pool.find((item) => combinationKey(item.combination, poolKey) === wanted);
  const dividendPer10 = Number(match?.dividendPer10);
  return Number.isFinite(dividendPer10) ? dividendPer10 : null;
}

function poolKeyForLine(line) {
  const rawType = String(line.pool ?? line.type ?? line.betType ?? '').toUpperCase().replaceAll(/[^A-Z0-9]+/g, '_');
  return {
    WIN: 'win',
    W: 'win',
    PLACE: 'place',
    PLA: 'place',
    QUINELLA: 'quinella',
    QIN: 'quinella',
    QUINELLA_PLACE: 'quinellaPlace',
    QPL: 'quinellaPlace',
    FORECAST: 'forecast',
    FCT: 'forecast',
    TRIO: 'trio',
    TRI: 'trio',
    TIERCE: 'tierce',
    TCE: 'tierce',
    FIRST4: 'first4',
    FIRST_4: 'first4',
    FF: 'first4',
    QUARTET: 'quartet',
    QTT: 'quartet',
  }[rawType] ?? rawType.toLowerCase();
}

function combinationForLine(line) {
  if (Array.isArray(line.combination)) return line.combination.map(Number).filter(Number.isFinite);
  if (Array.isArray(line.horses)) return line.horses.map((horse) => Number(horse.horseNo ?? horse)).filter(Number.isFinite);
  if (Array.isArray(line.selections)) return line.selections.map((horse) => Number(horse.horseNo ?? horse)).filter(Number.isFinite);
  if (line.horseNo != null) return [Number(line.horseNo)].filter(Number.isFinite);
  return [];
}

function combinationKey(combination, poolKey) {
  const numbers = [...(combination ?? [])].map(Number).filter(Number.isFinite);
  if (['quinella', 'quinellaPlace', 'trio', 'first4', 'quartet'].includes(poolKey)) {
    numbers.sort((a, b) => a - b);
  }
  return numbers.join(',');
}

function lineStake(line) {
  const stake = Number(line.stake ?? line.amount ?? line.plannedStake ?? 0);
  return Number.isFinite(stake) ? stake : 0;
}

function sum(items, selector) {
  return items.reduce((total, item) => total + Number(selector(item) ?? 0), 0);
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}
