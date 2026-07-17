export const MODEL_BENCHMARK_REGISTRY_VERSION = 'model-benchmark-registry-v1';

const ALLOWED_KINDS = new Set([
  'baseline',
  'calibrated-market-aware-model',
  'feature-donor',
  'model-and-pool-strategy',
  'validation-method',
]);

const ALLOWED_LOCAL_ADOPTION_STATUSES = new Set([
  'active-baseline',
  'implemented-awaiting-coverage',
  'reproduce-next',
  'research-backlog',
]);

const DASHBOARD_ENTRY_FIELDS = [
  'id',
  'label',
  'source',
  'sourceUrl',
  'kind',
  'localAdoptionStatus',
  'requiredData',
  'leakageRisks',
  'metrics',
  'promotionGates',
];

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
  if (!Array.isArray(registry)) {
    return ['[registry] registry must be an array'];
  }

  const issues = [];
  const ids = new Set();

  for (const [index, entry] of registry.entries()) {
    if (!isRecord(entry)) {
      issues.push(`[entry:${index}] entry must be an object`);
      continue;
    }

    const prefix = isNonEmptyTrimmedString(entry.id) ? `[${entry.id}]` : `[entry:${index}]`;
    requireTrimmedString(issues, prefix, entry, 'id');
    requireTrimmedString(issues, prefix, entry, 'label');
    requireTrimmedString(issues, prefix, entry, 'source');
    requireTrimmedString(issues, prefix, entry, 'kind');
    requireTrimmedString(issues, prefix, entry, 'localAdoptionStatus');

    if (isNonEmptyTrimmedString(entry.id)) {
      if (ids.has(entry.id)) issues.push(`${prefix} id must be unique`);
      ids.add(entry.id);
    }
    if (isNonEmptyTrimmedString(entry.kind) && !ALLOWED_KINDS.has(entry.kind)) {
      issues.push(`${prefix} kind is invalid`);
    }
    if (
      isNonEmptyTrimmedString(entry.localAdoptionStatus)
      && !ALLOWED_LOCAL_ADOPTION_STATUSES.has(entry.localAdoptionStatus)
    ) {
      issues.push(`${prefix} localAdoptionStatus is invalid`);
    }
    if (entry.sourceUrl !== null && !isPublicHttpsUrl(entry.sourceUrl)) {
      issues.push(`${prefix} sourceUrl must be a public HTTPS URL or null`);
    }

    requireStringList(issues, prefix, entry, 'requiredData');
    requireStringList(issues, prefix, entry, 'leakageRisks');
    requireStringList(issues, prefix, entry, 'metrics');
    validatePromotionGates(issues, prefix, entry.promotionGates);
  }

  return issues;
}

function validatePromotionGates(issues, prefix, promotionGates) {
  if (!Array.isArray(promotionGates) || promotionGates.length === 0) {
    issues.push(`${prefix} promotionGates must be a non-empty array`);
    return;
  }

  const gateIds = new Set();
  for (const promotionGate of promotionGates) {
    if (!isRecord(promotionGate)) {
      issues.push(`${prefix} promotion gate must be an object`);
      continue;
    }

    if (Object.keys(promotionGate).some((field) => !['id', 'requirement'].includes(field))) {
      issues.push(`${prefix} promotion gate fields are invalid`);
    }
    if (!isNonEmptyTrimmedString(promotionGate.id)) {
      issues.push(`${prefix} promotion gate id must be a non-empty trimmed string`);
    } else {
      if (gateIds.has(promotionGate.id)) {
        issues.push(`${prefix} promotion gate id must be unique`);
      }
      gateIds.add(promotionGate.id);
    }
    if (!isNonEmptyTrimmedString(promotionGate.requirement)) {
      issues.push(`${prefix} promotion gate requirement must be a non-empty trimmed string`);
    }
  }
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
      [...statusCounts.entries()].sort(([left], [right]) => compareByCodePoint(left, right)),
    ),
    promotionGateCount,
  };
}

export function buildModelBenchmarkRegistrySnapshot({
  registry = MODEL_BENCHMARK_REGISTRY,
} = {}) {
  const issues = validateModelBenchmarkRegistry(registry);
  if (issues.length > 0) {
    throw new Error(`Model benchmark registry is invalid: ${issues.join('; ')}`);
  }

  const entries = [...registry].sort(compareById);
  return {
    version: MODEL_BENCHMARK_REGISTRY_VERSION,
    summary: summarizeModelBenchmarkRegistry(entries),
    entries: entries.map(projectDashboardEntry),
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

function requireTrimmedString(issues, prefix, entry, field) {
  if (!isNonEmptyTrimmedString(entry[field])) {
    issues.push(`${prefix} ${field} must be a non-empty trimmed string`);
  }
}

function requireStringList(issues, prefix, entry, field) {
  const values = entry[field];
  if (
    !Array.isArray(values)
    || values.length === 0
    || values.some((value) => !isNonEmptyTrimmedString(value))
  ) {
    issues.push(`${prefix} ${field} must contain non-empty trimmed strings`);
  }
}

function compareById(left, right) {
  return compareByCodePoint(String(left.id), String(right.id));
}

function compareByCodePoint(left, right) {
  const leftCodePoints = [...left];
  const rightCodePoints = [...right];
  const length = Math.min(leftCodePoints.length, rightCodePoints.length);

  for (let index = 0; index < length; index += 1) {
    const difference = leftCodePoints[index].codePointAt(0) - rightCodePoints[index].codePointAt(0);
    if (difference !== 0) return difference;
  }

  return leftCodePoints.length - rightCodePoints.length;
}

function projectDashboardEntry(entry) {
  const projected = {};
  for (const field of DASHBOARD_ENTRY_FIELDS) {
    switch (field) {
      case 'requiredData':
      case 'leakageRisks':
      case 'metrics':
        projected[field] = [...entry[field]];
        break;
      case 'promotionGates':
        projected[field] = entry.promotionGates.map(({ id, requirement }) => ({ id, requirement }));
        break;
      default:
        projected[field] = entry[field];
    }
  }
  return projected;
}

function isNonEmptyTrimmedString(value) {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPublicHttpsUrl(value) {
  if (!isNonEmptyTrimmedString(value)) return false;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || !parsed.hostname) return false;
    return !isLocalHostname(parsed.hostname);
  } catch {
    return false;
  }
}

function isLocalHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true;
  if (normalized === '::1' || normalized === '0.0.0.0') return true;
  if (/^(fc|fd|fe8|fe9|fea|feb)/.test(normalized)) return true;

  const ipv4MappedIpv6 = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (ipv4MappedIpv6) {
    const highWord = Number.parseInt(ipv4MappedIpv6[1], 16);
    const lowWord = Number.parseInt(ipv4MappedIpv6[2], 16);
    return isLocalIpv4([
      highWord >> 8,
      highWord & 0xff,
      lowWord >> 8,
      lowWord & 0xff,
    ]);
  }

  const parts = normalized.split('.').map(Number);
  return isLocalIpv4(parts);
}

function isLocalIpv4(parts) {
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  return (
    parts[0] === 0
    || parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
  );
}
