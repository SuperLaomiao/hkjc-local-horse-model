export const DEFAULT_POOL_FEATURE_WINDOWS = [
  { featureLabel: 'T60', target: 60, min: 46, max: 75 },
  { featureLabel: 'T30', target: 30, min: 21, max: 45 },
  { featureLabel: 'T10', target: 10, min: 6, max: 20 },
  { featureLabel: 'T3', target: 3, min: 0, max: 5 },
];

const DEFAULT_PAYOUT_RATE = 0.825;
const POOL_DEFINITIONS = [
  { key: 'win', label: 'Win', pairPool: false, shareField: 'MarketShare', imbalanceField: 'Imbalance' },
  { key: 'place', label: 'Place', pairPool: false, shareField: 'MarketShare', imbalanceField: 'Imbalance' },
  {
    key: 'quinella',
    label: 'Quinella',
    pairPool: true,
    shareField: 'InvolvementShare',
    imbalanceField: 'InvolvementImbalance',
  },
  {
    key: 'quinellaPlace',
    label: 'QuinellaPlace',
    pairPool: true,
    shareField: 'InvolvementShare',
    imbalanceField: 'InvolvementImbalance',
  },
];

const MOVEMENT_PAIRS = [
  ['T60', 'T30'],
  ['T30', 'T10'],
  ['T10', 'T3'],
];

export function buildPoolMoneyFeatureIndex({
  races = [],
  oddsSnapshots = [],
  poolSnapshots = [],
  windows = DEFAULT_POOL_FEATURE_WINDOWS,
  payoutRate = DEFAULT_PAYOUT_RATE,
} = {}) {
  const featuresByRunner = initializeRunnerFeatures(races, windows);
  const oddsByRacePool = indexSnapshotsByRacePool(oddsSnapshots);
  const poolsByRacePool = indexSnapshotsByRacePool(poolSnapshots);
  const racesWithAnyPoolMoney = new Set();
  const racesByPool = new Map(POOL_DEFINITIONS.map((pool) => [pool.key, new Set()]));
  let selectedOddsBooks = 0;
  let selectedPoolSnapshots = 0;

  for (const race of races) {
    for (const pool of POOL_DEFINITIONS) {
      const investmentsByWindow = new Map();
      const racePoolKey = `${race.raceId}|${pool.key}`;
      const racePoolOdds = oddsByRacePool.get(racePoolKey) ?? [];
      const racePoolInvestments = poolsByRacePool.get(racePoolKey) ?? [];
      for (const window of windows) {
        const book = selectOddsBook({
          snapshots: racePoolOdds,
          race,
          poolKey: pool.key,
          window,
        });
        const investmentSnapshot = selectPoolSnapshot({
          snapshots: racePoolInvestments,
          race,
          poolKey: pool.key,
          window,
          preferredCapturedAt: book?.capturedAt,
        });
        const investment = numericOrNull(investmentSnapshot?.investment);
        if (investment != null) {
          investmentsByWindow.set(window.featureLabel, investment);
          selectedPoolSnapshots += 1;
        }

        const priced = book ? priceBook(book.rows, pool.pairPool ? 2 : 1) : null;
        if (priced) selectedOddsBooks += 1;
        attachWindowFeatures({
          race,
          pool,
          window,
          priced,
          investment,
          payoutRate,
          featuresByRunner,
        });

        if (priced && investment != null) {
          racesWithAnyPoolMoney.add(race.raceId);
          racesByPool.get(pool.key).add(race.raceId);
        }
      }
      attachInvestmentMovement({ race, pool, investmentsByWindow, featuresByRunner });
    }
  }

  return {
    featuresByRunner,
    summary: {
      runnerFeatureRows: featuresByRunner.size,
      races: races.length,
      racesWithAnyPoolMoney: racesWithAnyPoolMoney.size,
      racesByPool: Object.fromEntries(POOL_DEFINITIONS.map((pool) => [
        pool.label.toUpperCase(),
        racesByPool.get(pool.key).size,
      ])),
      selectedOddsBooks,
      selectedPoolSnapshots,
      payoutRate: round(payoutRate, 6),
      takeoutRate: round(1 - payoutRate, 6),
      windows: windows.map((window) => window.featureLabel),
      pools: POOL_DEFINITIONS.map((pool) => pool.label.toUpperCase()),
    },
  };
}

function indexSnapshotsByRacePool(snapshots) {
  const index = new Map();
  for (const snapshot of snapshots) {
    const key = `${snapshot.raceId}|${normalizePoolKey(snapshot)}`;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(snapshot);
  }
  return index;
}

function initializeRunnerFeatures(races, windows) {
  const result = new Map();
  for (const race of races) {
    for (const runner of race.runners ?? []) {
      const features = {};
      for (const pool of POOL_DEFINITIONS) {
        for (const window of windows) initializeWindowFeatures(features, pool, window.featureLabel);
        for (const [from, to] of MOVEMENT_PAIRS) {
          features[featureName(pool, `InvestmentPctChange${from}To${to}`)] = null;
        }
      }
      result.set(`${race.raceId}|${runner.horseNo}`, features);
    }
  }
  return result;
}

function initializeWindowFeatures(features, pool, suffix) {
  features[featureName(pool, 'OddsAvailable', suffix)] = 0;
  features[featureName(pool, 'InvestmentAvailable', suffix)] = 0;
  features[featureName(pool, 'Available', suffix)] = 0;
  features[featureName(pool, 'Investment', suffix)] = null;
  features[featureName(pool, pool.shareField, suffix)] = null;
  features[featureName(pool, 'EstimatedMoney', suffix)] = null;
  features[featureName(pool, 'Concentration', suffix)] = null;
  features[featureName(pool, 'Overround', suffix)] = null;
  features[featureName(pool, 'CrowdingRatio', suffix)] = null;
  features[featureName(pool, pool.imbalanceField, suffix)] = null;
  features[featureName(pool, 'PayoutRate', suffix)] = null;
  features[featureName(pool, 'TakeoutRate', suffix)] = null;
}

function attachWindowFeatures({
  race,
  pool,
  window,
  priced,
  investment,
  payoutRate,
  featuresByRunner,
}) {
  const suffix = window.featureLabel;
  const runnerShares = priced ? sharesByRunner(priced.combinations, pool.pairPool) : new Map();
  const expectedShare = priced?.uniqueRunnerCount > 0
    ? Math.min(1, (pool.pairPool ? 2 : 1) / priced.uniqueRunnerCount)
    : null;

  for (const runner of race.runners ?? []) {
    const features = featuresByRunner.get(`${race.raceId}|${runner.horseNo}`);
    if (!features) continue;
    const runnerShare = runnerShares.get(Number(runner.horseNo));
    const hasOdds = Number.isFinite(runnerShare);
    const hasInvestment = investment != null;

    features[featureName(pool, 'OddsAvailable', suffix)] = hasOdds ? 1 : 0;
    features[featureName(pool, 'InvestmentAvailable', suffix)] = hasInvestment ? 1 : 0;
    features[featureName(pool, 'Available', suffix)] = hasOdds && hasInvestment ? 1 : 0;
    features[featureName(pool, 'Investment', suffix)] = investment;
    features[featureName(pool, pool.shareField, suffix)] = hasOdds ? round(runnerShare, 6) : null;
    features[featureName(pool, 'EstimatedMoney', suffix)] = hasOdds && hasInvestment
      ? round(investment * runnerShare, 4)
      : null;
    features[featureName(pool, 'Concentration', suffix)] = priced
      ? round(priced.concentration, 6)
      : null;
    features[featureName(pool, 'Overround', suffix)] = priced
      ? round(priced.overround, 6)
      : null;
    features[featureName(pool, 'CrowdingRatio', suffix)] = hasOdds && expectedShare
      ? round(runnerShare / expectedShare, 6)
      : null;
    features[featureName(pool, pool.imbalanceField, suffix)] = hasOdds && expectedShare != null
      ? round(runnerShare - expectedShare, 6)
      : null;
    features[featureName(pool, 'PayoutRate', suffix)] = priced || hasInvestment
      ? round(payoutRate, 6)
      : null;
    features[featureName(pool, 'TakeoutRate', suffix)] = priced || hasInvestment
      ? round(1 - payoutRate, 6)
      : null;
  }
}

function sharesByRunner(combinations, pairPool) {
  const shares = new Map();
  for (const item of combinations) {
    if ((!pairPool && item.combination.length !== 1) || (pairPool && item.combination.length !== 2)) continue;
    for (const horseNo of item.combination) {
      shares.set(horseNo, (shares.get(horseNo) ?? 0) + item.share);
    }
  }
  return shares;
}

function attachInvestmentMovement({ race, pool, investmentsByWindow, featuresByRunner }) {
  for (const [from, to] of MOVEMENT_PAIRS) {
    const fromInvestment = investmentsByWindow.get(from);
    const toInvestment = investmentsByWindow.get(to);
    const movement = Number.isFinite(fromInvestment) && fromInvestment > 0 && Number.isFinite(toInvestment)
      ? round((toInvestment - fromInvestment) / fromInvestment, 6)
      : null;
    for (const runner of race.runners ?? []) {
      const features = featuresByRunner.get(`${race.raceId}|${runner.horseNo}`);
      if (features) features[featureName(pool, `InvestmentPctChange${from}To${to}`)] = movement;
    }
  }
}

function selectOddsBook({ snapshots, race, poolKey, window }) {
  const groups = new Map();
  for (const snapshot of snapshots) {
    if (snapshot.raceId !== race.raceId || normalizePoolKey(snapshot) !== poolKey) continue;
    const minutesToPost = numericOrNull(snapshot.minutesToPost);
    const oddsValue = numericOrNull(snapshot.oddsValue);
    if (minutesToPost == null || minutesToPost < window.min || minutesToPost > window.max) continue;
    if (oddsValue == null || oddsValue <= 0) continue;
    if (!isLeakageSafeSnapshot(snapshot, race)) continue;
    const capturedAt = snapshot.capturedAt ?? `minutes:${minutesToPost}`;
    if (!groups.has(capturedAt)) groups.set(capturedAt, []);
    groups.get(capturedAt).push(snapshot);
  }

  return [...groups.entries()]
    .map(([capturedAt, rows]) => ({
      capturedAt,
      rows,
      minutesToPost: numericOrNull(rows[0]?.minutesToPost),
    }))
    .sort((left, right) => (
      Math.abs(left.minutesToPost - window.target) - Math.abs(right.minutesToPost - window.target)
      || String(right.capturedAt).localeCompare(String(left.capturedAt))
    ))[0] ?? null;
}

function selectPoolSnapshot({ snapshots, race, poolKey, window, preferredCapturedAt }) {
  return snapshots
    .filter((snapshot) => {
      const minutesToPost = numericOrNull(snapshot.minutesToPost);
      const investment = numericOrNull(snapshot.investment);
      return snapshot.raceId === race.raceId
        && normalizePoolKey(snapshot) === poolKey
        && minutesToPost != null
        && minutesToPost >= window.min
        && minutesToPost <= window.max
        && investment != null
        && investment >= 0
        && isLeakageSafeSnapshot(snapshot, race);
    })
    .sort((left, right) => (
      Number(right.capturedAt === preferredCapturedAt) - Number(left.capturedAt === preferredCapturedAt)
      || Math.abs(left.minutesToPost - window.target) - Math.abs(right.minutesToPost - window.target)
      || String(right.capturedAt ?? '').localeCompare(String(left.capturedAt ?? ''))
    ))[0] ?? null;
}

function isLeakageSafeSnapshot(snapshot, race) {
  const minutesToPost = numericOrNull(snapshot.minutesToPost);
  if (minutesToPost == null || minutesToPost < 0) return false;
  const sellStatus = String(
    snapshot.sellStatus ?? snapshot.raw?.sellStatus ?? snapshot.raw?.status ?? '',
  ).toUpperCase();
  if (/(STOP|CLOSE|RESULT|SUSPEND)/.test(sellStatus)) return false;
  if (minutesToPost > 0) return true;

  const postTime = scheduledPostTime(race);
  const capturedAt = Date.parse(snapshot.capturedAt ?? '');
  return Number.isFinite(postTime) && Number.isFinite(capturedAt) && capturedAt < postTime;
}

function scheduledPostTime(race) {
  if (!race?.date || !/^\d{1,2}:\d{2}(?::\d{2})?$/.test(String(race.startTime ?? ''))) return NaN;
  const time = String(race.startTime).length === 5 ? `${race.startTime}:00` : race.startTime;
  return Date.parse(`${race.date}T${time}+08:00`);
}

function priceBook(rows, expectedArity) {
  const combinations = rows
    .map((snapshot) => ({
      combination: normalizeCombination(snapshot.combination),
      rawShare: 1 / Number(snapshot.oddsValue),
    }))
    .filter((item) => (
      item.combination.length === expectedArity
      && Number.isFinite(item.rawShare)
      && item.rawShare > 0
    ));
  const overround = combinations.reduce((sum, item) => sum + item.rawShare, 0);
  if (overround <= 0) return null;

  const priced = combinations.map((item) => ({
    combination: item.combination,
    share: item.rawShare / overround,
  }));
  return {
    overround,
    concentration: priced.reduce((sum, item) => sum + item.share ** 2, 0),
    combinations: priced,
    uniqueRunnerCount: new Set(priced.flatMap((item) => item.combination)).size,
  };
}

function featureName(pool, field, suffix = '') {
  return `pool${pool.label}${field}${suffix}`;
}

function normalizePoolKey(snapshot) {
  const value = String(snapshot.poolKey ?? snapshot.pool ?? '').trim().toLowerCase();
  if (['win', '獨贏', '独赢'].includes(value)) return 'win';
  if (['place', 'pla', '位置'].includes(value)) return 'place';
  if (['quinella', 'qin', '連贏', '连赢'].includes(value)) return 'quinella';
  if (['quinellaplace', 'quinella place', 'qpl', '位置q'].includes(value)) return 'quinellaPlace';
  return value;
}

function normalizeCombination(value) {
  const items = Array.isArray(value) ? value : String(value ?? '').split(/[,+\-/]/);
  return items
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0)
    .sort((left, right) => left - right);
}

function numericOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 6) {
  const multiplier = 10 ** digits;
  return Math.round(Number(value) * multiplier) / multiplier;
}
