const WINDOWS = [
  { label: 'T-60', min: 46, max: 75 },
  { label: 'T-30', min: 21, max: 45 },
  { label: 'T-10', min: 6, max: 20 },
  { label: 'T-3', min: 0, max: 5 },
];

export function buildMarketSnapshotCoverageReport({ races = [], odds = [], pools = [] } = {}) {
  const raceIds = new Set(races.map((race) => race.raceId).filter(Boolean));
  const denominator = raceIds.size > 0
    ? raceIds.size
    : new Set([...odds, ...pools].map((snapshot) => snapshot.raceId).filter(Boolean)).size;
  const oddsRaceIds = new Set(odds.map((snapshot) => snapshot.raceId).filter(Boolean));
  const poolRaceIds = new Set(pools.map((snapshot) => snapshot.raceId).filter(Boolean));
  const allCapturedAt = [...odds, ...pools]
    .map((snapshot) => snapshot.capturedAt)
    .filter(Boolean)
    .sort();
  const summary = {
    races: denominator,
    racesWithOdds: oddsRaceIds.size,
    racesWithPools: poolRaceIds.size,
    oddsSnapshots: odds.length,
    poolSnapshots: pools.length,
    oddsRaceCoverage: ratio(oddsRaceIds.size, denominator),
    poolRaceCoverage: ratio(poolRaceIds.size, denominator),
    earliestCapturedAt: allCapturedAt[0] ?? null,
    latestCapturedAt: allCapturedAt.at(-1) ?? null,
    readiness: readiness({ odds, pools, oddsRaceIds, poolRaceIds, denominator }),
  };

  return {
    generatedAt: new Date().toISOString(),
    summary,
    byWindow: buildWindowCoverage({ odds, pools }),
    byPool: buildPoolCoverage({ odds, pools, denominator }),
    gaps: buildGaps(summary),
    note: 'Coverage only says whether live market data exists; it does not prove the model has a betting edge.',
  };
}

function buildWindowCoverage({ odds, pools }) {
  const buckets = Object.fromEntries([...WINDOWS.map((window) => window.label), 'unknown'].map((label) => [label, emptyCoverageBucket()]));

  for (const snapshot of odds) {
    addSnapshotToBucket(buckets[windowLabel(snapshot.minutesToPost)], snapshot, 'odds');
  }
  for (const snapshot of pools) {
    addSnapshotToBucket(buckets[windowLabel(snapshot.minutesToPost)], snapshot, 'pools');
  }

  return serializeCoverageBuckets(buckets);
}

function buildPoolCoverage({ odds, pools, denominator }) {
  const poolKeys = new Set([...odds, ...pools].map((snapshot) => poolKey(snapshot)).filter(Boolean));
  const result = {};

  for (const key of [...poolKeys].sort()) {
    const poolOdds = odds.filter((snapshot) => poolKey(snapshot) === key);
    const poolPools = pools.filter((snapshot) => poolKey(snapshot) === key);
    const oddsRaceIds = new Set(poolOdds.map((snapshot) => snapshot.raceId).filter(Boolean));
    const poolRaceIds = new Set(poolPools.map((snapshot) => snapshot.raceId).filter(Boolean));
    const capturedAt = [...poolOdds, ...poolPools].map((snapshot) => snapshot.capturedAt).filter(Boolean).sort();

    result[key] = {
      oddsSnapshots: poolOdds.length,
      poolSnapshots: poolPools.length,
      racesWithOdds: oddsRaceIds.size,
      racesWithPools: poolRaceIds.size,
      oddsRaceCoverage: ratio(oddsRaceIds.size, denominator),
      poolRaceCoverage: ratio(poolRaceIds.size, denominator),
      latestCapturedAt: capturedAt.at(-1) ?? null,
    };
  }

  return result;
}

function addSnapshotToBucket(bucket, snapshot, kind) {
  if (kind === 'odds') {
    bucket.oddsSnapshots += 1;
    if (snapshot.raceId) bucket.oddsRaceIds.add(snapshot.raceId);
  } else {
    bucket.poolSnapshots += 1;
    if (snapshot.raceId) bucket.poolRaceIds.add(snapshot.raceId);
  }
}

function serializeCoverageBuckets(buckets) {
  return Object.fromEntries(Object.entries(buckets).map(([label, bucket]) => [label, {
    oddsSnapshots: bucket.oddsSnapshots,
    poolSnapshots: bucket.poolSnapshots,
    racesWithOdds: bucket.oddsRaceIds.size,
    racesWithPools: bucket.poolRaceIds.size,
  }]));
}

function emptyCoverageBucket() {
  return {
    oddsSnapshots: 0,
    poolSnapshots: 0,
    oddsRaceIds: new Set(),
    poolRaceIds: new Set(),
  };
}

function windowLabel(minutesToPost) {
  const minutes = Number(minutesToPost);
  if (!Number.isFinite(minutes)) return 'unknown';
  const window = WINDOWS.find((item) => minutes >= item.min && minutes <= item.max);
  return window?.label ?? 'unknown';
}

function poolKey(snapshot) {
  return String(snapshot.poolKey ?? snapshot.pool ?? '').trim().toUpperCase();
}

function readiness({ odds, pools, oddsRaceIds, poolRaceIds, denominator }) {
  if (odds.length === 0 && pools.length === 0) return 'missing-market-data';
  if (denominator > 0 && oddsRaceIds.size >= denominator && poolRaceIds.size >= denominator) {
    return 'ready-for-live-market-research';
  }
  return 'partial-market-data';
}

function buildGaps(summary) {
  const gaps = [];
  if (summary.readiness === 'missing-market-data') {
    gaps.push('No market snapshots recorded yet. Import normalized T-30/T-10/T-3 odds and pool snapshots before training live expected-ROI gates.');
    return gaps;
  }
  if (summary.oddsRaceCoverage < 1) {
    gaps.push(`Odds snapshots cover ${(summary.oddsRaceCoverage * 100).toFixed(1)}% of races in scope.`);
  }
  if (summary.poolRaceCoverage < 1) {
    gaps.push(`Pool snapshots cover ${(summary.poolRaceCoverage * 100).toFixed(1)}% of races in scope.`);
  }
  if (gaps.length === 0) {
    gaps.push('Market snapshot coverage is complete for races in scope; next step is model-side feature engineering and EV gate backtesting.');
  }
  return gaps;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? round(numerator / denominator, 4) : 0;
}

function round(value, digits = 4) {
  if (!Number.isFinite(Number(value))) return 0;
  const multiplier = 10 ** digits;
  return Math.round(Number(value) * multiplier) / multiplier;
}
