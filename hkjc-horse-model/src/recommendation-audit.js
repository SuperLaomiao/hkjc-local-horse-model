export function auditRecommendationRuns({ runs = [], races = [] } = {}) {
  const raceById = new Map(races.map((race) => [race.raceId, race]));
  const classifiedRuns = selectRecommendationRunsForAudit({ runs, raceById });
  const auditedRuns = classifiedRuns.map((run) => (
    run.auditDecision === 'INCLUDED'
      ? auditRun(run, raceById.get(run.raceId))
      : excludedRun(run)
  ));
  const includedRuns = auditedRuns.filter((run) => run.auditDecision === 'INCLUDED');
  const settledRuns = includedRuns.filter((run) => run.status === 'SETTLED');
  const openRuns = includedRuns.filter((run) => run.status === 'OPEN');
  const allSettledLines = settledRuns.flatMap((run) => run.lines);
  const totalStake = round(sum(allSettledLines, (line) => line.stake));
  const totalReturn = round(sum(allSettledLines, (line) => line.returned));
  const profit = round(totalReturn - totalStake);

  return {
    summary: {
      runs: includedRuns.length,
      recordedRuns: auditedRuns.length,
      eligibleRuns: includedRuns.length,
      excludedRuns: auditedRuns.length - includedRuns.length,
      exclusionReasons: countExclusionReasons(auditedRuns),
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

export function selectRecommendationRunsForAudit({ runs = [], raceById = new Map() } = {}) {
  const classified = runs.map((run) => classifyRunTiming(run, raceById.get(run.raceId)));
  const groups = new Map();

  for (const run of classified) {
    if (run.auditDecision === 'EXCLUDED') continue;
    const key = [run.raceId, run.strategyVersion ?? 'unknown'].join('|');
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }

  const finalRunIds = new Set();
  for (const items of groups.values()) {
    items.sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt)
      || String(b.runId).localeCompare(String(a.runId)));
    finalRunIds.add(items[0].runId);
  }

  return classified.map((run) => {
    if (run.auditDecision === 'EXCLUDED') return run;
    return finalRunIds.has(run.runId)
      ? { ...run, auditDecision: 'INCLUDED', exclusionReason: null }
      : { ...run, auditDecision: 'EXCLUDED', exclusionReason: 'SUPERSEDED' };
  });
}

function classifyRunTiming(run, race) {
  const mode = String(run.summary?.mode ?? run.raw?.summary?.mode ?? '').toLowerCase();
  if (mode === 'prepare') {
    return { ...run, auditDecision: 'EXCLUDED', exclusionReason: 'PREPARE_ONLY' };
  }
  if (!race || race.status === 'upcoming') {
    return { ...run, auditDecision: 'CANDIDATE', exclusionReason: null };
  }
  const generatedAtMs = Date.parse(run.generatedAt);
  if (!Number.isFinite(generatedAtMs)) {
    return { ...run, auditDecision: 'EXCLUDED', exclusionReason: 'INVALID_GENERATED_AT' };
  }
  const postTime = racePostTime(race);
  if (!postTime) {
    const generatedDate = hongKongDate(generatedAtMs);
    const exclusionReason = generatedDate > race.date ? 'POST_RACE' : 'MISSING_POST_TIME';
    return { ...run, auditDecision: 'EXCLUDED', exclusionReason };
  }
  if (generatedAtMs >= postTime.getTime()) {
    return { ...run, auditDecision: 'EXCLUDED', exclusionReason: 'POST_RACE' };
  }
  return { ...run, auditDecision: 'CANDIDATE', exclusionReason: null };
}

function hongKongDate(timestampMs) {
  return new Date(timestampMs + (8 * 60 * 60 * 1000)).toISOString().slice(0, 10);
}

function racePostTime(race) {
  if (!race?.date || !race?.startTime) return null;
  const raw = String(race.startTime);
  const time = /^\d{1,2}:\d{2}$/.test(raw) ? `${raw.padStart(5, '0')}:00` : raw;
  const parsed = new Date(`${race.date}T${time}+08:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function excludedRun(run) {
  return {
    ...run,
    status: 'EXCLUDED',
    stake: 0,
    returned: 0,
    profit: 0,
    lines: (run.recommendations ?? []).map((line) => ({
      ...line,
      status: 'EXCLUDED',
      stake: 0,
      returned: 0,
      profit: 0,
    })),
  };
}

function countExclusionReasons(runs) {
  return runs.reduce((counts, run) => {
    if (run.exclusionReason) {
      counts[run.exclusionReason] = (counts[run.exclusionReason] ?? 0) + 1;
    }
    return counts;
  }, {});
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
