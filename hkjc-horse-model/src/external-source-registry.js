export const EXTERNAL_SOURCE_POLICY_VERSION = 'external-source-policy-v1';

const COMMON_PROVENANCE = ['sourceUrl', 'retrievedAt', 'checksum'];

export const EXTERNAL_SOURCE_REGISTRY = Object.freeze([
  source({
    sourceId: 'sleepingarhat-tianxi-database',
    label: 'Tianxi HKJC database',
    canonicalUrl: 'https://github.com/sleepingarhat/tianxi-database',
    role: 'data',
    licenseStatus: 'unknown',
    license: null,
    allowedUses: ['local-raw-research', 'derived-aggregate-publication'],
    cachePolicy: 'local-only',
    featureGroups: [
      feature('prior-form-and-sectionals', 'pre-race-candidate', 'Require race-date ordering and an as-of cutoff.'),
      feature('prior-trials', 'pre-race-candidate', 'Use only trials published before the target race cutoff.'),
      feature('prior-trackwork', 'pre-race-candidate', 'Require a dated observation before the target race.'),
      feature('prior-veterinary-records', 'pre-race-candidate', 'Use only dated notices known before the target race cutoff.'),
      feature('current-race-results', 'post-race', 'Never expose to a prediction row for the same race.'),
      feature('current-race-dividends', 'post-race', 'Settlement only.'),
      feature('current-race-comments-and-sectionals', 'post-race', 'Available only after the race.'),
      feature('undated-speedpro-fields', 'unsafe', 'Exclude until availability can be established.'),
    ],
  }),
  source({
    sourceId: 'mag-dot-race-data',
    label: 'SpeedPRO race-data mirror',
    canonicalUrl: 'https://github.com/mag-dot/race-data',
    role: 'data',
    licenseStatus: 'unknown',
    license: null,
    allowedUses: ['local-raw-research', 'derived-aggregate-publication'],
    cachePolicy: 'local-only',
    featureGroups: [
      feature('prior-speedpro-form', 'pre-race-candidate', 'Require a source date before the target race cutoff.'),
      feature('prior-energy-and-sectionals', 'pre-race-candidate', 'Use only completed earlier races.'),
      feature('current-race-results-and-comments', 'post-race', 'Settlement or later-race features only.'),
      feature('undated-speedpro-fields', 'unsafe', 'Exclude until observed_at can be derived conservatively.'),
    ],
  }),
  source({
    sourceId: 'official-hkjc',
    label: 'Official HKJC public racing pages',
    canonicalUrl: 'https://racing.hkjc.com/',
    role: 'data',
    licenseStatus: 'restricted',
    license: 'HKJC website terms',
    allowedUses: ['local-raw-research', 'derived-aggregate-publication'],
    cachePolicy: 'local-capture',
    provenanceRequirements: [...COMMON_PROVENANCE, 'observedAt'],
    featureGroups: [
      feature('racecards-and-declarations', 'pre-race-candidate', 'Capture observed_at and retain amendments.'),
      feature('live-odds-and-pools', 'pre-race-candidate', 'Require an actual pre-post capture timestamp.'),
      feature('prior-trials-trackwork-veterinary', 'pre-race-candidate', 'Use only publications observed before cutoff.'),
      feature('results-dividends-current-sectionals', 'post-race', 'Authoritative settlement only.'),
    ],
  }),
  source({
    sourceId: 'hko-open-data',
    label: 'Hong Kong Observatory open data',
    canonicalUrl: 'https://data.weather.gov.hk/weatherAPI/doc/HKO_Open_Data_API_Documentation.pdf',
    role: 'data',
    licenseStatus: 'open-data',
    license: 'HKO open data terms',
    allowedUses: ['local-raw-research', 'derived-feature-publication'],
    cachePolicy: 'tracked-derived-only',
    provenanceRequirements: [...COMMON_PROVENANCE, 'observedAt'],
    featureGroups: [
      feature('observed-weather', 'pre-race-candidate', 'Join only observations available at prediction cutoff.'),
      feature('revised-historical-weather', 'unsafe', 'Exclude revisions lacking original availability time.'),
    ],
  }),
  source({
    sourceId: 'eprochasson-horserace-data',
    label: 'eprochasson historical HKJC data',
    canonicalUrl: 'https://github.com/eprochasson/horserace_data',
    role: 'data',
    licenseStatus: 'unknown',
    license: null,
    allowedUses: ['local-raw-research', 'derived-aggregate-publication'],
    cachePolicy: 'local-only',
    featureGroups: [
      feature('historical-live-odds', 'pre-race-candidate', 'Require snapshot timestamp and minutes-to-post.'),
      feature('historical-results-dividends-sectionals', 'post-race', 'Use only as labels or for later races.'),
    ],
  }),
  source({
    sourceId: 'catowabisabi-model-training',
    label: 'catowabisabi horse-racing model training',
    canonicalUrl: 'https://github.com/catowabisabi/horse-racing-model-training',
    role: 'model',
    licenseStatus: 'licensed',
    license: 'MIT',
    allowedUses: ['code-reuse-with-attribution', 'methodology-reproduction'],
    codeReuseAllowed: true,
  }),
  source({
    sourceId: 'jerrydaphantom-ml-research',
    label: 'jerrydaphantom HKJC ML research',
    canonicalUrl: 'https://github.com/jerrydaphantom/hkjc-ml-research',
    role: 'model',
    licenseStatus: 'licensed',
    license: 'MIT',
    allowedUses: ['code-reuse-with-attribution', 'methodology-reproduction'],
    codeReuseAllowed: true,
  }),
  source({
    sourceId: 'stevw-ml-research',
    label: 'stevw HKJC ML research project',
    canonicalUrl: 'https://github.com/stevw-repo/HKJC-Horse-Racing-ML-Research-Project',
    role: 'model',
    licenseStatus: 'licensed',
    license: 'MIT',
    allowedUses: ['code-reuse-with-attribution', 'methodology-reproduction'],
    codeReuseAllowed: true,
  }),
  source({
    sourceId: 'tang-pool-tracker',
    label: 'Tang HKJC pool tracker',
    canonicalUrl: 'https://github.com/Tang6133/hkjc-pool-tracker',
    role: 'model',
    licenseStatus: 'licensed',
    license: 'MIT',
    allowedUses: ['code-reuse-with-attribution', 'methodology-reproduction'],
    codeReuseAllowed: true,
  }),
  source({
    sourceId: 'bobosky-hkjc-api',
    label: 'Bobosky HKJC API collector reference',
    canonicalUrl: 'https://github.com/Bobosky2005/hkjc-api',
    role: 'collector',
    licenseStatus: 'unknown',
    license: null,
    allowedUses: ['collector-pattern-review'],
    cachePolicy: 'none',
  }),
  source({
    sourceId: 'rkwyu-sport-betting-data',
    label: 'rkwyu sport betting data collector reference',
    canonicalUrl: 'https://github.com/rkwyu/sport-betting-data',
    role: 'collector',
    licenseStatus: 'unknown',
    license: null,
    allowedUses: ['collector-pattern-review'],
    cachePolicy: 'none',
  }),
]);

export function validateExternalSourceRegistry(registry = EXTERNAL_SOURCE_REGISTRY) {
  const issues = [];
  const sourceIds = new Set();
  const allowedLicenseStatuses = new Set(['licensed', 'open-data', 'unknown', 'restricted']);
  const allowedRoles = new Set(['data', 'model', 'collector']);
  const allowedTimings = new Set(['pre-race-candidate', 'post-race', 'unsafe']);

  for (const sourceEntry of registry) {
    const prefix = sourceEntry?.sourceId ? `[${sourceEntry.sourceId}]` : '[missing-source-id]';
    if (!sourceEntry?.sourceId) issues.push(`${prefix} sourceId is required`);
    if (sourceIds.has(sourceEntry?.sourceId)) issues.push(`${prefix} sourceId must be unique`);
    sourceIds.add(sourceEntry?.sourceId);
    if (!sourceEntry?.canonicalUrl) issues.push(`${prefix} canonicalUrl is required`);
    if (!allowedRoles.has(sourceEntry?.role)) issues.push(`${prefix} role is invalid`);
    if (!allowedLicenseStatuses.has(sourceEntry?.licenseStatus)) issues.push(`${prefix} licenseStatus is invalid`);
    if (!Array.isArray(sourceEntry?.allowedUses)) issues.push(`${prefix} allowedUses must be an array`);
    if (!Array.isArray(sourceEntry?.provenanceRequirements) || sourceEntry.provenanceRequirements.length === 0) {
      issues.push(`${prefix} provenanceRequirements are required`);
    }
    if (['unknown', 'restricted'].includes(sourceEntry?.licenseStatus) && sourceEntry?.rawPublicationAllowed) {
      issues.push(`${prefix} raw publication is forbidden without an explicit reusable data license`);
    }
    if (['unknown', 'restricted'].includes(sourceEntry?.licenseStatus) && sourceEntry?.codeReuseAllowed) {
      issues.push(`${prefix} code reuse is forbidden without an explicit code license`);
    }
    for (const group of sourceEntry?.featureGroups ?? []) {
      if (!group.featureGroup) issues.push(`${prefix} featureGroup is required`);
      if (!allowedTimings.has(group.timing)) issues.push(`${prefix} feature timing is invalid`);
      if (!group.policy) issues.push(`${prefix} feature policy is required`);
    }
  }

  return issues;
}

function source({
  rawPublicationAllowed = false,
  codeReuseAllowed = false,
  cachePolicy = 'none',
  provenanceRequirements = COMMON_PROVENANCE,
  featureGroups = [],
  ...values
}) {
  return Object.freeze({
    ...values,
    rawPublicationAllowed,
    codeReuseAllowed,
    cachePolicy,
    provenanceRequirements: Object.freeze([...provenanceRequirements]),
    featureGroups: Object.freeze(featureGroups.map((group) => Object.freeze({ ...group }))),
  });
}

function feature(featureGroup, timing, policy) {
  return { featureGroup, timing, policy };
}
