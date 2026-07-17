import { isIP } from 'node:net';

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
    } else if (!isPrivacySafeText(promotionGate.id)) {
      issues.push(`${prefix} promotion gate id must be privacy-safe text`);
    } else {
      if (gateIds.has(promotionGate.id)) {
        issues.push(`${prefix} promotion gate id must be unique`);
      }
      gateIds.add(promotionGate.id);
    }
    if (!isNonEmptyTrimmedString(promotionGate.requirement)) {
      issues.push(`${prefix} promotion gate requirement must be a non-empty trimmed string`);
    } else if (!isPrivacySafeText(promotionGate.requirement)) {
      issues.push(`${prefix} promotion gate requirement must be privacy-safe text`);
    }
  }
}

export function summarizeModelBenchmarkRegistry(registry = MODEL_BENCHMARK_REGISTRY) {
  assertValidRegistry(registry);
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

export function buildModelBenchmarkRegistrySnapshot(options = {}) {
  if (!isRecord(options)) {
    assertValidRegistry(null);
  }

  const { registry = MODEL_BENCHMARK_REGISTRY } = options;
  assertValidRegistry(registry);

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
  } else if (!isPrivacySafeText(entry[field])) {
    issues.push(`${prefix} ${field} must be privacy-safe text`);
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
  } else if (values.some((value) => !isPrivacySafeText(value))) {
    issues.push(`${prefix} ${field} must contain privacy-safe text`);
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

function isPrivacySafeText(value) {
  return !/(?:file:\/\/|\/Users\/)/i.test(value);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPublicHttpsUrl(value) {
  if (!isNonEmptyTrimmedString(value)) return false;
  if (!isPrivacySafeText(value)) return false;

  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== 'https:'
      || !parsed.hostname
      || parsed.username
      || parsed.password
    ) {
      return false;
    }
    return !isNonPublicHostname(parsed.hostname);
  } catch {
    return false;
  }
}

function isNonPublicHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (
    normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized.endsWith('.local')
  ) {
    return true;
  }

  const ipVersion = isIP(normalized);
  if (ipVersion === 4) return isNonPublicIpv4(normalized);
  if (ipVersion === 6) return isNonPublicIpv6(normalized);
  return false;
}

function isNonPublicIpv4(value) {
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [first, second, third] = parts;
  return (
    first === 0
    || first === 10
    || (first === 100 && second >= 64 && second <= 127)
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0 && third === 0)
    || (first === 192 && second === 0 && third === 2)
    || (first === 192 && second === 88 && third === 99)
    || (first === 192 && second === 168)
    || (first === 198 && second >= 18 && second <= 19)
    || (first === 198 && second === 51 && third === 100)
    || (first === 203 && second === 0 && third === 113)
    || first >= 224
  );
}

function isNonPublicIpv6(value) {
  const words = parseIpv6(value);
  if (!words) return true;

  const address = wordsToBigInt(words);
  const mappedIpv4 = address >> 32n;
  if (mappedIpv4 === 0xffffn) {
    return isNonPublicIpv4(bigIntToIpv4(address & 0xffffffffn));
  }

  return (
    address === 0n
    || address === 1n
    || isIpv6InRange(address, 'fc000000000000000000000000000000', 7)
    || isIpv6InRange(address, 'fe800000000000000000000000000000', 10)
    || isIpv6InRange(address, 'ff000000000000000000000000000000', 8)
    || isIpv6InRange(address, '01000000000000000000000000000000', 64)
    || isIpv6InRange(address, '00000000000000000000000000000000', 96)
    || isIpv6InRange(address, '0064ff9b000000000000000000000000', 96)
    || isIpv6InRange(address, '20010db8000000000000000000000000', 32)
    || isIpv6InRange(address, '20010000000000000000000000000000', 32)
    || isIpv6InRange(address, '20010020000000000000000000000000', 28)
    || isIpv6InRange(address, '20010002000000000000000000000000', 48)
    || isIpv6InRange(address, '3fff0000000000000000000000000000', 20)
  );
}

function parseIpv6(value) {
  const sections = value.split('::');
  if (sections.length > 2) return null;

  const left = sections[0] ? sections[0].split(':') : [];
  const right = sections.length === 2 && sections[1] ? sections[1].split(':') : [];
  const expandedLeft = expandIpv6Parts(left);
  const expandedRight = expandIpv6Parts(right);
  if (!expandedLeft || !expandedRight) return null;

  const missing = sections.length === 2
    ? 8 - expandedLeft.length - expandedRight.length
    : 0;
  if (missing < 0 || (sections.length === 1 && expandedLeft.length !== 8)) return null;

  const parts = [
    ...expandedLeft,
    ...Array.from({ length: missing }, () => '0'),
    ...expandedRight,
  ];
  if (parts.length !== 8) return null;

  return parts.map((part) => {
    if (!/^[0-9a-f]{1,4}$/i.test(part)) return null;
    return Number.parseInt(part, 16);
  });
}

function expandIpv6Parts(parts) {
  const expanded = [];
  for (const part of parts) {
    if (!part.includes('.')) {
      expanded.push(part);
      continue;
    }

    const ipv4Parts = part.split('.').map(Number);
    if (
      ipv4Parts.length !== 4
      || ipv4Parts.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
    ) {
      return null;
    }
    expanded.push(
      ((ipv4Parts[0] << 8) | ipv4Parts[1]).toString(16),
      ((ipv4Parts[2] << 8) | ipv4Parts[3]).toString(16),
    );
  }
  return expanded;
}

function wordsToBigInt(words) {
  return words.reduce((value, word) => (value << 16n) | BigInt(word), 0n);
}

function isIpv6InRange(address, prefixHex, prefixLength) {
  const prefix = BigInt(`0x${prefixHex}`);
  const shift = 128n - BigInt(prefixLength);
  return (address >> shift) === (prefix >> shift);
}

function bigIntToIpv4(value) {
  return [
    Number((value >> 24n) & 0xffn),
    Number((value >> 16n) & 0xffn),
    Number((value >> 8n) & 0xffn),
    Number(value & 0xffn),
  ].join('.');
}

function assertValidRegistry(registry) {
  const issues = validateModelBenchmarkRegistry(registry);
  if (issues.length > 0) {
    throw new Error(`Model benchmark registry is invalid: ${issues.join('; ')}`);
  }
}
