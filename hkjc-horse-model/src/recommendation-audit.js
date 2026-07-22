export function auditRecommendationRuns({
  runs = [],
  races = [],
  marketSnapshots = [],
  prospectiveLedgers = null,
} = {}) {
  const raceById = new Map(races.map((race) => [race.raceId, race]));
  const t3MarketByLine = buildT3MarketIndex(marketSnapshots);
  const classifiedRuns = selectRecommendationRunsForAudit({ runs, raceById });
  const auditedRuns = classifiedRuns.map((run) => (
    run.auditDecision === 'INCLUDED'
      ? auditRun(run, raceById.get(run.raceId), t3MarketByLine)
      : excludedRun(run)
  ));
  const includedRuns = auditedRuns.filter((run) => run.auditDecision === 'INCLUDED');
  const settledRuns = includedRuns.filter((run) => run.status === 'SETTLED');
  const openRuns = includedRuns.filter((run) => run.status === 'OPEN');
  const chronologicalSettledRuns = [...settledRuns].sort(compareRunsChronologically);
  const allSettledLines = chronologicalSettledRuns.flatMap((run) => run.lines);
  const paperLines = allSettledLines.map((line) => line.paper).filter(Boolean);
  const clvLines = allSettledLines.filter((line) => Number.isFinite(line.indicativeClv));
  const totalStake = round(sum(allSettledLines, (line) => line.stake));
  const totalReturn = round(sum(allSettledLines, (line) => line.returned));
  const profit = round(totalReturn - totalStake);
  const paperStake = round(sum(paperLines, (line) => line.stake));
  const paperReturn = round(sum(paperLines, (line) => line.returned));
  const paperProfit = round(paperReturn - paperStake);

  const cashLedger = {
    lines: allSettledLines.length,
    stake: totalStake,
    returned: totalReturn,
    profit,
    roi: totalStake > 0 ? round(profit / totalStake, 4) : null,
    maxDrawdown: maxDrawdown(allSettledLines),
    longestLosingRun: longestLosingRun(allSettledLines),
    hits: allSettledLines.filter((line) => line.status === 'HIT').length,
    misses: allSettledLines.filter((line) => line.status === 'MISS').length,
    executionStatus: totalStake > 0 ? 'RECORDED' : 'NO_BET',
    source: 'FINAL_EXECUTABLE_RECOMMENDATION_RUNS',
  };
  const legacyPaperLedger = {
    lines: paperLines.length,
    stake: paperStake,
    returned: paperReturn,
    profit: paperProfit,
    roi: paperStake > 0 ? round(paperProfit / paperStake, 4) : null,
    maxDrawdown: maxDrawdown(paperLines),
    longestLosingRun: longestLosingRun(paperLines),
    hits: paperLines.filter((line) => line.status === 'HIT').length,
    misses: paperLines.filter((line) => line.status === 'MISS').length,
    executionStatus: 'PAPER_ONLY',
    source: 'LEGACY_RECOMMENDATION_RUN_PAPER_LINES',
  };
  const hasProspectiveLocks = Number(prospectiveLedgers?.shadow?.locks ?? 0) > 0;

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
      maxDrawdown: maxDrawdown(allSettledLines),
      hitLines: allSettledLines.filter((line) => line.status === 'HIT').length,
      missLines: allSettledLines.filter((line) => line.status === 'MISS').length,
      passLines: allSettledLines.filter((line) => line.status === 'PASS').length,
      clvLines: clvLines.length,
      averageIndicativeClv: clvLines.length > 0
        ? round(sum(clvLines, (line) => line.indicativeClv) / clvLines.length, 4)
        : null,
      averagePriceSlippageToT3: clvLines.length > 0
        ? round(sum(clvLines, (line) => line.priceSlippageToT3) / clvLines.length, 4)
        : null,
      paperStake,
      paperReturn,
      paperProfit,
      paperRoi: paperStake > 0 ? round(paperProfit / paperStake, 4) : null,
      paperMaxDrawdown: maxDrawdown(paperLines),
      paperHitLines: paperLines.filter((line) => line.status === 'HIT').length,
      paperMissLines: paperLines.filter((line) => line.status === 'MISS').length,
    },
    ledgers: {
      cash: cashLedger,
      paper: hasProspectiveLocks
        ? { ...prospectiveLedgers.paper, source: 'IMMUTABLE_PROSPECTIVE_LOCKS' }
        : legacyPaperLedger,
      shadow: hasProspectiveLocks
        ? { ...prospectiveLedgers.shadow, source: 'IMMUTABLE_PROSPECTIVE_LOCKS' }
        : {
          locks: 0,
          open: 0,
          settled: 0,
          hits: 0,
          misses: 0,
          voids: 0,
          hitRate: null,
          clvLines: 0,
          averageIndicativeClv: null,
          executionStatus: 'SHADOW',
          source: 'IMMUTABLE_PROSPECTIVE_LOCKS',
        },
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

function auditRun(run, race, t3MarketByLine) {
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
        stake: executableLineStake(line),
        returned: 0,
        profit: 0,
        ...(isExplicitlyNonExecutable(line) ? { auditReason: 'NON_EXECUTABLE_DECISION' } : {}),
      })),
    };
  }

  const lines = recommendations.map((line) => auditLine(line, race, t3MarketByLine));
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

function auditLine(line, race, t3MarketByLine) {
  const stake = executableLineStake(line);
  const plannedStake = lineStake(line);
  const poolKey = poolKeyForLine(line);
  const combination = combinationForLine(line);
  const settlement = settleLineFromOfficialDividends({
    pool: line.pool ?? line.poolKey,
    combination,
    stake,
    dividends: race.dividends,
  });
  const dividendPer10 = settlement.dividendPer10;
  if (stake <= 0) {
    const paper = decisionStatus(line) === 'PAPER' && plannedStake > 0
      ? paperSettlement({ stake: plannedStake, dividendPer10 })
      : null;
    return addPriceAudit({
      ...line,
      status: 'PASS',
      stake: 0,
      returned: 0,
      profit: 0,
      ...(paper ? { paper } : {}),
      ...(isExplicitlyNonExecutable(line) ? { auditReason: 'NON_EXECUTABLE_DECISION' } : {}),
    }, { line, poolKey, combination, dividendPer10, t3MarketByLine, raceId: race.raceId });
  }

  return addPriceAudit({
    ...line,
    status: settlement.status,
    poolKey,
    combination,
    stake,
    dividendPer10,
    returned: settlement.returned,
    profit: settlement.profit,
  }, { line, poolKey, combination, dividendPer10, t3MarketByLine, raceId: race.raceId });
}

function addPriceAudit(output, {
  line, poolKey, combination, dividendPer10, t3MarketByLine, raceId,
}) {
  const t3Market = t3MarketByLine.get(marketLineKey(raceId, poolKey, combination));
  const lockedDividendPer10 = positiveNumber(
    line.marketDividendPer10
      ?? line.decision?.marketDividendPer10
      ?? line.decision?.market?.dividendPer10
      ?? line.market?.dividendPer10,
  );
  if (!t3Market) return output;
  const enriched = { ...output, t3Market };
  if (lockedDividendPer10 == null) return enriched;
  enriched.lockedMarketDividendPer10 = lockedDividendPer10;
  enriched.indicativeClv = round((lockedDividendPer10 / t3Market.dividendPer10) - 1, 4);
  enriched.priceSlippageToT3 = round((t3Market.dividendPer10 / lockedDividendPer10) - 1, 4);
  if (positiveNumber(dividendPer10) != null) {
    enriched.officialDividendChangeFromLock = round((dividendPer10 / lockedDividendPer10) - 1, 4);
  }
  return enriched;
}

function paperSettlement({ stake, dividendPer10 }) {
  const returned = dividendPer10 == null ? 0 : round((stake / 10) * dividendPer10);
  return {
    status: returned > 0 ? 'HIT' : 'MISS',
    stake,
    dividendPer10,
    returned,
    profit: round(returned - stake),
  };
}

export function settleLineFromOfficialDividends({ pool, combination, stake, dividends }) {
  const poolKey = poolKeyForLine({ pool });
  const normalizedCombination = normalizeCombinationForPool(combinationForLine({ combination }), poolKey);
  const normalizedStake = lineStake({ stake });
  const dividendPer10 = findDividendPer10({
    poolKey,
    combination: normalizedCombination,
    dividends,
  });
  const returned = dividendPer10 == null ? 0 : round((normalizedStake / 10) * dividendPer10);
  return {
    poolKey,
    combination: normalizedCombination,
    dividendPer10,
    returned,
    profit: round(returned - normalizedStake),
    status: returned > 0 ? 'HIT' : 'MISS',
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
  return normalizeCombinationForPool(combination, poolKey).join(',');
}

function normalizeCombinationForPool(combination, poolKey) {
  const numbers = [...(combination ?? [])].map(Number).filter(Number.isFinite);
  if (['quinella', 'quinellaPlace', 'trio', 'first4', 'quartet'].includes(poolKey)) {
    numbers.sort((a, b) => a - b);
  }
  return numbers;
}

function lineStake(line) {
  const stake = Number(line.stake ?? line.amount ?? line.plannedStake ?? 0);
  return Number.isFinite(stake) ? stake : 0;
}

function executableLineStake(line) {
  return isExplicitlyNonExecutable(line) ? 0 : lineStake(line);
}

function isExplicitlyNonExecutable(line) {
  const status = line?.decision?.status;
  return status != null && String(status).toUpperCase() !== 'PLAY';
}

function decisionStatus(line) {
  return String(line?.decision?.status ?? '').toUpperCase();
}

function buildT3MarketIndex(marketSnapshots) {
  const snapshots = Array.isArray(marketSnapshots)
    ? marketSnapshots
    : Array.isArray(marketSnapshots?.odds) ? marketSnapshots.odds : [];
  const index = new Map();
  for (const snapshot of snapshots) {
    const minutesToPost = Number(snapshot.minutesToPost);
    const oddsValue = positiveNumber(snapshot.oddsValue);
    const sellStatus = String(snapshot.sellStatus ?? '').toUpperCase();
    if (!Number.isFinite(minutesToPost) || minutesToPost < 1 || minutesToPost > 5) continue;
    if (oddsValue == null || /(STOP|CLOSE|RESULT|SUSPEND)/.test(sellStatus)) continue;
    const poolKey = poolKeyForLine({ pool: snapshot.poolKey ?? snapshot.pool });
    const combination = combinationForLine(snapshot);
    const key = marketLineKey(snapshot.raceId, poolKey, combination);
    const candidate = {
      dividendPer10: round(oddsValue * 10),
      capturedAt: snapshot.capturedAt ?? null,
      minutesToPost,
      source: snapshot.source ?? null,
    };
    const current = index.get(key);
    if (!current || compareT3Snapshots(candidate, current) < 0) index.set(key, candidate);
  }
  return index;
}

function compareT3Snapshots(left, right) {
  return left.minutesToPost - right.minutesToPost
    || Date.parse(right.capturedAt ?? '') - Date.parse(left.capturedAt ?? '');
}

function marketLineKey(raceId, poolKey, combination) {
  return [raceId, poolKey, combinationKey(combination, poolKey)].join('|');
}

function compareRunsChronologically(left, right) {
  return String(left.date ?? left.raceId ?? '').localeCompare(String(right.date ?? right.raceId ?? ''))
    || Number(left.raceNo ?? 0) - Number(right.raceNo ?? 0)
    || Date.parse(left.generatedAt ?? '') - Date.parse(right.generatedAt ?? '');
}

function maxDrawdown(lines) {
  let cumulative = 0;
  let peak = 0;
  let drawdown = 0;
  for (const line of lines) {
    cumulative += Number(line.profit ?? 0);
    peak = Math.max(peak, cumulative);
    drawdown = Math.max(drawdown, peak - cumulative);
  }
  return round(drawdown);
}

function longestLosingRun(lines) {
  let current = 0;
  let longest = 0;
  for (const line of lines) {
    if (String(line.status ?? '').toUpperCase() === 'MISS' && Number(line.stake ?? 0) > 0) {
      current += 1;
      longest = Math.max(longest, current);
    } else if (String(line.status ?? '').toUpperCase() !== 'VOID') {
      current = 0;
    }
  }
  return longest;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function sum(items, selector) {
  return items.reduce((total, item) => total + Number(selector(item) ?? 0), 0);
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}
