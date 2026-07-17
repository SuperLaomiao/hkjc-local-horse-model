export const MODEL_BENCHMARK_REGISTRY_VERSION = 'model-benchmark-registry-v1';

export const MODEL_BENCHMARK_REGISTRY = Object.freeze([
  benchmark({
    id: 'catowabisabi-lgb-quinella',
    label: 'catowabisabi LightGBM no-odds Quinella',
    source: 'catowabisabi/horse-racing-model-training',
    sourceUrl: 'https://github.com/catowabisabi/horse-racing-model-training',
    kind: 'model-and-pool-strategy',
    localAdoptionStatus: 'reproduce-next',
    requiredData: [
      'leakage-safe no-market runner matrix',
      'chronological validation and untouched holdout races',
      'official QIN and QPL dividends',
      'settled-race runner results',
    ],
    leakageRisks: [
      'same-race results or dividends entering runner features',
      'random row splits placing runners from one race in multiple splits',
      'late market or final-dividend information entering no-odds features',
      'single high-dividend meeting dominating reported profit',
    ],
    metrics: [
      'validation and holdout log loss',
      'validation and holdout Brier score',
      'top-pick win rate',
      'QIN and QPL bets, turnover, ROI, and max drawdown',
      'profit concentration by meeting',
    ],
    promotionGates: [
      gate(
        'probability-quality',
        'Beat current-baseline on validation and untouched holdout probability quality using identical race splits.',
      ),
      gate('pool-roi', 'Produce non-negative untouched-holdout QIN or QPL ROI after official dividends and takeout.'),
      gate('sample-size', 'Evaluate at least 300 eligible bets for any pool proposed for promotion.'),
      gate('profit-concentration', 'No single meeting may contribute more than 10% of total holdout profit.'),
      gate('risk-and-leakage', 'Pass as-of, duplicate, leakage, and configured max-drawdown checks from a versioned experiment.'),
    ],
  }),
  benchmark({
    id: 'jerrydaphantom-catboost-calibration',
    label: 'jerrydaphantom CatBoost market-aware calibration',
    source: 'jerrydaphantom/hkjc-ml-research',
    sourceUrl: 'https://github.com/jerrydaphantom/hkjc-ml-research',
    kind: 'calibrated-market-aware-model',
    localAdoptionStatus: 'reproduce-next',
    requiredData: [
      'leakage-safe runner matrix',
      'chronological validation and untouched holdout races',
      'timestamped T-30, T-10, and T-3 WIN odds',
      'separate current-odds features and final-dividend labels',
    ],
    leakageRisks: [
      'final odds or dividends used as pre-race market features',
      'post-time snapshots included in training or evaluation',
      'calibration fitted on the untouched holdout',
      'runner-level random splits leaking race context',
    ],
    metrics: [
      'validation and holdout log loss',
      'validation and holdout Brier score',
      'calibration error and calibration buckets',
      'top-pick win rate and winner-in-top-3 rate',
      'EV-gated bets, ROI, and max drawdown',
    ],
    promotionGates: [
      gate('market-coverage', 'Reach representative timestamped pre-race odds coverage before comparing the market-aware model.'),
      gate(
        'probability-quality',
        'Improve validation and untouched-holdout log loss, Brier score, and calibration versus current-baseline.',
      ),
      gate('ev-holdout', 'Show non-negative untouched-holdout ROI with enough EV-gated bets; top-pick-all results do not qualify.'),
      gate('as-of-audit', 'Pass snapshot-time, split, duplicate, and calibration-fit leakage audits.'),
    ],
  }),
  benchmark({
    id: 'neigh-speedpro-features',
    label: 'neigh SpeedPRO sectional, pace, and fitness features',
    source: 'larrysammii/neigh',
    sourceUrl: 'https://github.com/larrysammii/neigh',
    kind: 'feature-donor',
    localAdoptionStatus: 'research-backlog',
    requiredData: [
      'versioned SpeedPRO schema fixtures',
      'dated prior-run sectionals and pace observations',
      'dated fitness, incident, comment, and health observations',
      'runner identity reconciliation',
    ],
    leakageRisks: [
      'current-race results or comments exposed as prior form',
      'undated SpeedPRO fields treated as known before post time',
      'revised health or incident records backfilled before publication',
      'runner identity collisions across seasons',
    ],
    metrics: [
      'runner and race feature coverage',
      'validation and holdout log loss delta',
      'validation and holdout Brier score delta',
      'top-pick and winner-in-top-3 lift',
      'ablation stability by season and venue',
    ],
    promotionGates: [
      gate('availability', 'Every imported feature must have a conservative observed-at or source-date cutoff before the target race.'),
      gate('coverage', 'Report matched, missing, ambiguous, and rejected runner coverage on validation and holdout.'),
      gate(
        'ablation',
        'Feature lift must survive chronological holdout and source-group ablation without material calibration regression.',
      ),
      gate(
        'access-policy',
        'Use only fields whose access and local-research policy have been verified; do not publish unlicensed raw rows.',
      ),
    ],
  }),
  benchmark({
    id: 'hkjc-pool-tracker-features',
    label: 'HKJC pool tracker money-flow features',
    source: 'Tang6133/hkjc-pool-tracker',
    sourceUrl: 'https://github.com/Tang6133/hkjc-pool-tracker',
    kind: 'feature-donor',
    localAdoptionStatus: 'implemented-awaiting-coverage',
    requiredData: [
      'timestamped WIN, PLACE, QIN, and QPL odds books',
      'timestamped pool investment totals',
      'pool-specific takeout assumptions',
      'race post times and sell status',
    ],
    leakageRisks: [
      'post-time or stopped-selling books entering pre-race features',
      'odds types matched by response order instead of pool key',
      'final pool totals backfilled into earlier snapshots',
      'invalid combination arity distorting pool concentration',
    ],
    metrics: [
      'race and runner T-window coverage',
      'pool investment and odds-book coherence rate',
      'feature availability by pool and window',
      'validation and holdout probability-quality delta',
      'EV-gated ROI and max drawdown by pool',
    ],
    promotionGates: [
      gate('live-coverage', 'Collect representative T-30, T-10, and T-3 books before evaluating feature lift.'),
      gate('snapshot-integrity', 'Pass post-time, sell-status, pool-key, combination-arity, and duplicate-book audits.'),
      gate(
        'model-lift',
        'Pool features must improve untouched-holdout calibration or probability quality without unstable missingness dependence.',
      ),
      gate('cash-mode', 'Cash-mode EV gates require current-race pool coverage plus non-negative holdout ROI and acceptable drawdown.'),
    ],
  }),
  benchmark({
    id: 'hkjc-edge-lab-clv',
    label: 'HKJC Edge Lab no-bet and CLV validation',
    source: 'justinsuo/hkjc-edge-lab',
    sourceUrl: 'https://github.com/justinsuo/hkjc-edge-lab',
    kind: 'validation-method',
    localAdoptionStatus: 'research-backlog',
    requiredData: [
      'timestamped recommendation decisions',
      'decision-time odds and closing odds',
      'official settlement dividends',
      'walk-forward experiment ledger',
    ],
    leakageRisks: [
      'closing odds used to create the original recommendation',
      'post-race filtering of losing recommendations',
      'bootstrap units sampled by bet instead of meeting or race',
      'strategy thresholds tuned on the untouched holdout',
    ],
    metrics: [
      'closing-line value by pool',
      'walk-forward ROI and max drawdown',
      'meeting-block bootstrap confidence interval',
      'placebo-test result',
      'eligible recommendations and no-bet rate',
    ],
    promotionGates: [
      gate('clv', 'Show positive out-of-sample CLV with decision-time and closing prices kept separate.'),
      gate('uncertainty', 'A meeting-block bootstrap confidence interval and placebo checks must reject a fragile or spurious edge.'),
      gate('walk-forward', 'All thresholds must be frozen before each walk-forward evaluation segment.'),
      gate('no-bet-default', 'Remain paper-only or NO BET whenever CLV, sample-size, ROI, or drawdown gates fail.'),
    ],
  }),
  benchmark({
    id: 'current-baseline',
    label: 'Current local heuristic and logistic baseline',
    source: 'local HKJC horse model',
    sourceUrl: null,
    kind: 'baseline',
    localAdoptionStatus: 'active-baseline',
    requiredData: [
      'settled races with runner results',
      'as-of historical runner, jockey, and trainer features',
      'chronological train, validation, and holdout splits',
      'official dividends for strategy evaluation',
    ],
    leakageRisks: [
      'same-race results or dividends entering prediction rows',
      'latest-state aggregates evaluated on earlier races',
      'duplicate races crossing chronological splits',
      'probability metrics and betting ROI conflated',
    ],
    metrics: [
      'validation and holdout log loss',
      'validation and holdout Brier score',
      'top-pick win rate',
      'calibration buckets',
      'bets, ROI, max drawdown, and profit concentration',
    ],
    promotionGates: [
      gate('comparator', 'Keep this entry as the fixed comparator on identical race splits for every candidate.'),
      gate(
        'replacement-quality',
        'A replacement must improve untouched-holdout probability quality without worsening calibration materially.',
      ),
      gate(
        'replacement-risk',
        'A recommendation replacement must also pass ROI, sample-size, drawdown, profit-concentration, and leakage gates.',
      ),
    ],
  }),
]);

export function validateModelBenchmarkRegistry(registry = MODEL_BENCHMARK_REGISTRY) {
  const issues = [];
  const ids = new Set();

  for (const entry of registry ?? []) {
    const prefix = entry?.id ? `[${entry.id}]` : '[missing-id]';
    if (!entry?.id) issues.push(`${prefix} id is required`);
    if (ids.has(entry?.id)) issues.push(`${prefix} id must be unique`);
    ids.add(entry?.id);
    if (!entry?.label) issues.push(`${prefix} label is required`);
    if (!entry?.source) issues.push(`${prefix} source is required`);
    if (!entry?.localAdoptionStatus) issues.push(`${prefix} localAdoptionStatus is required`);
    requireNonEmptyArray(issues, prefix, entry, 'requiredData');
    requireNonEmptyArray(issues, prefix, entry, 'leakageRisks');
    requireNonEmptyArray(issues, prefix, entry, 'metrics');
    requireNonEmptyArray(issues, prefix, entry, 'promotionGates');

    for (const promotionGate of entry?.promotionGates ?? []) {
      if (!promotionGate?.id || !promotionGate?.requirement) {
        issues.push(`${prefix} each promotion gate requires id and requirement`);
      }
    }
  }

  return issues;
}

export function summarizeModelBenchmarkRegistry(registry = MODEL_BENCHMARK_REGISTRY) {
  const entries = [...(registry ?? [])].sort(compareById);
  const statusCounts = new Map();
  let promotionGateCount = 0;

  for (const entry of entries) {
    const status = String(entry.localAdoptionStatus ?? 'unknown');
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
    promotionGateCount += entry.promotionGates?.length ?? 0;
  }

  return {
    totalEntries: entries.length,
    externalIdeas: entries.filter((entry) => entry.id !== 'current-baseline').length,
    ids: entries.map((entry) => entry.id),
    byLocalAdoptionStatus: Object.fromEntries(
      [...statusCounts.entries()].sort(([left], [right]) => left.localeCompare(right)),
    ),
    promotionGateCount,
  };
}

export function buildModelBenchmarkRegistrySnapshot({
  registry = MODEL_BENCHMARK_REGISTRY,
} = {}) {
  const entries = [...registry].sort(compareById);
  return {
    version: MODEL_BENCHMARK_REGISTRY_VERSION,
    summary: summarizeModelBenchmarkRegistry(entries),
    entries: entries.map((entry) => ({
      ...entry,
      requiredData: [...entry.requiredData],
      leakageRisks: [...entry.leakageRisks],
      metrics: [...entry.metrics],
      promotionGates: entry.promotionGates.map((item) => ({ ...item })),
    })),
  };
}

function benchmark(values) {
  return Object.freeze({
    ...values,
    requiredData: Object.freeze([...values.requiredData]),
    leakageRisks: Object.freeze([...values.leakageRisks]),
    metrics: Object.freeze([...values.metrics]),
    promotionGates: Object.freeze(
      values.promotionGates.map((promotionGate) => Object.freeze({ ...promotionGate })),
    ),
  });
}

function gate(id, requirement) {
  return { id, requirement };
}

function requireNonEmptyArray(issues, prefix, entry, field) {
  if (!Array.isArray(entry?.[field]) || entry[field].length === 0) {
    issues.push(`${prefix} ${field} must be a non-empty array`);
  }
}

function compareById(left, right) {
  return String(left.id).localeCompare(String(right.id));
}
