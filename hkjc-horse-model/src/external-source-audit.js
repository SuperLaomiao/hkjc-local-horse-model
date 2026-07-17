import {
  EXTERNAL_SOURCE_POLICY_VERSION,
  EXTERNAL_SOURCE_REGISTRY,
  validateExternalSourceRegistry,
} from './external-source-registry.js';

export function buildExternalSourceAudit({
  registry = EXTERNAL_SOURCE_REGISTRY,
  generatedAt = new Date().toISOString(),
} = {}) {
  const issues = validateExternalSourceRegistry(registry);
  if (issues.length > 0) {
    throw new Error(`Invalid external source registry: ${issues.join('; ')}`);
  }

  const sources = registry
    .map((source) => ({
      ...source,
      publicationBoundary: publicationBoundary(source),
      predictiveFeatureGroups: source.featureGroups.filter((group) => group.timing === 'pre-race-candidate').length,
      blockedFeatureGroups: source.featureGroups.filter((group) => group.timing !== 'pre-race-candidate').length,
    }))
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId));

  return {
    policyVersion: EXTERNAL_SOURCE_POLICY_VERSION,
    generatedAt,
    summary: {
      sources: sources.length,
      byLicenseStatus: countBy(sources, (source) => source.licenseStatus),
      localOnlySources: sources.filter((source) => source.cachePolicy === 'local-only').length,
      modelDonors: sources.filter((source) => source.role === 'model').length,
      dataDonors: sources.filter((source) => source.role === 'data').length,
      collectorDonors: sources.filter((source) => source.role === 'collector').length,
      rawPublicationAllowedSources: sources.filter((source) => source.rawPublicationAllowed).length,
      codeReuseAllowedSources: sources.filter((source) => source.codeReuseAllowed).length,
      featureTiming: countBy(sources.flatMap((source) => source.featureGroups), (group) => group.timing),
      invalidSources: 0,
    },
    sources,
    safeguards: [
      'Unknown-license and restricted raw data stays outside tracked public directories.',
      'Only fields available before the prediction cutoff may enter training rows.',
      'Current-race results, dividends, comments, and sectionals are labels or post-race evidence only.',
      'Every import must retain source URL, retrieval time, and checksum.',
    ],
  };
}

function publicationBoundary(source) {
  if (source.rawPublicationAllowed) return 'raw-and-derived';
  if (source.allowedUses.includes('derived-feature-publication')) return 'derived-features-only';
  if (source.allowedUses.includes('derived-aggregate-publication')) return 'derived-aggregates-only';
  return 'no-data-publication';
}

function countBy(items, keyFor) {
  const counts = {};
  for (const item of items) {
    const key = keyFor(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}
