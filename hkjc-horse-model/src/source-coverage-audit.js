const CLASSIFICATIONS = new Set([
  'pre-race-usable',
  'post-race-only',
  'unsafe',
  'unavailable',
]);

const EVIDENCE_LEVELS = new Set(['code-verified', 'readme-only']);

const PRE_RACE_PROVENANCE = Object.freeze([
  'sourceUrl',
  'retrievedAt',
  'checksum',
  'observedAt',
  'targetRacePostAt',
]);

const J_CSC_SOURCE = Object.freeze({
  sourceId: 'j-csc-hk-horse-racing-data-scraper',
  label: 'j-csc HK Horse Racing Data Scraper',
  canonicalUrl: 'https://github.com/j-csc/HK-Horse-Racing-Data-Scraper',
  auditedCommit: '063a889ebfc60621a81df3f14b5def6b9c8edd89',
  auditedCommitAt: '2020-08-09T18:01:57Z',
  licenseStatus: 'unknown',
  codeReuseAllowed: false,
  rawPublicationAllowed: false,
  reviewMode: 'clean-room-schema-only',
});

const PAGE_GROUPS = Object.freeze([
  pageGroup({
    id: 'legacy-race-results',
    label: 'Legacy HKJC local results page',
    evidenceLevel: 'code-verified',
    repositoryImplementation: 'present-in-public-tree',
    repositoryEvidence: ['old/scraper.py', 'notebooks/DataPrep.ipynb'],
    fields: [
      postRace('raceNumber', 'The legacy collector reads this from the results page after the race.'),
      postRace('going', 'Same-race going copied from a results page is settlement context, not a captured forecast input.'),
      postRace('raceTypeAndDistance', 'Result-page context may be used only as a label or for later races.'),
      postRace('placing', 'Outcome label.'),
      postRace('horseNumberAndIdentity', 'The row is sourced from a post-race result artifact.'),
      postRace('jockeyAndTrainer', 'The row is sourced from a post-race result artifact.'),
      postRace('actualAndDeclaredWeight', 'The row is sourced from a post-race result artifact.'),
      postRace('draw', 'Do not relabel a result-page row as a pre-race observation.'),
      postRace('lengthsBehind', 'Outcome label.'),
      postRace('runningPosition', 'Same-race outcome/sectional evidence.'),
      postRace('finishTime', 'Outcome label.'),
      postRace('publicOdds', 'The legacy field has no snapshot time and must not be treated as a T-window price.'),
    ],
  }),
  pageGroup({
    id: 'horse-profile',
    label: 'Horse profile / rating page',
    evidenceLevel: 'code-verified',
    repositoryImplementation: 'present-in-public-tree',
    repositoryEvidence: ['old/horse_scraper.py'],
    fields: [
      preRace('horseIdentity', 'Stable identity is usable when captured before the target race.'),
      preRace('countryAge', 'Normalize country and age as separate fields.'),
      preRace('colourSex', 'Normalize colour and sex as separate fields.'),
      preRace('importType', 'Static profile candidate.'),
      preRace('trainer', 'Current trainer requires a dated capture because stable changes occur.'),
      preRace('owner', 'Current owner requires a dated capture.'),
      preRace('pedigree', 'Sire, dam and dam sire are static profile candidates.'),
      unsafe('currentRating', 'The legacy collector stores no observed_at or historical version; a current value would leak into old races.'),
      unsafe('startOfSeasonRating', 'Season identity and capture time are absent in the legacy output.'),
      unsafe('seasonAndTotalStakes', 'Cumulative values change after each race and need an as-of snapshot.'),
      unsafe('placingAndStartCounts', 'Cumulative counts need an as-of snapshot and strict lag.'),
    ],
  }),
  pageGroup({
    id: 'racecard',
    label: 'Racecard / declaration page',
    evidenceLevel: 'readme-only',
    repositoryImplementation: 'missing-from-public-tree',
    repositoryEvidence: ['README.md completed list', 'main.py imports a missing scrapers/scraper_racecard module'],
    fields: [
      preRace('raceDateTime', 'Bind the page to a meeting, race number and scheduled post time.'),
      preRace('venue', 'Normalize Sha Tin, Happy Valley and any overseas meeting separately.'),
      preRace('surfaceCourseDistance', 'Keep surface, rail/course and distance as separate fields.'),
      preRace('going', 'Use only the value actually displayed before the target race cutoff.'),
      preRace('classRatingBandPrizeMoney', 'Race conditions known on the captured declaration.'),
      preRace('horseNumberAndIdentity', 'Require brand number where available to prevent name collisions.'),
      preRace('lastSixRuns', 'Use only form displayed on the captured pre-race card.'),
      preRace('handicapWeight', 'Declared/current carried weight from the captured card.'),
      preRace('jockey', 'Retain allowance and late replacement amendments.'),
      preRace('draw', 'Retain amended draw and declaration version.'),
      preRace('trainer', 'Retain the captured stable assignment.'),
      preRace('ratingAndChange', 'Retain both rating and displayed change.'),
      preRace('declaredWeight', 'Declaration horse weight is explicitly dated relative to race day.'),
      preRace('trainerPreferenceOrder', 'Priority/order must remain distinct from horse number and draw.'),
      preRace('gear', 'Parse first-use, replacement and removal suffixes without discarding them.'),
    ],
  }),
  pageGroup({
    id: 'racecard-info',
    label: 'Racecard information companion page',
    evidenceLevel: 'readme-only',
    repositoryImplementation: 'missing-from-public-tree',
    repositoryEvidence: ['README.md completed list', 'main.py imports a missing scrapers/scraper_racecard_info module'],
    fields: [
      unavailable('implementationAndSchema', 'No public module, fixture or output schema exists at the audited commit.'),
    ],
  }),
  pageGroup({
    id: 'veterinary-records',
    label: 'Veterinary records for declared starters / database',
    evidenceLevel: 'readme-only',
    repositoryImplementation: 'missing-from-public-tree',
    repositoryEvidence: ['README.md completed list', 'main.py imports a missing scrapers/scraper_horse_veterinary_records module'],
    fields: [
      unsafe('brandNumberAndHorseName', 'Identity is parseable, but the missing collector provides no capture-time contract.'),
      unsafe('recordDate', 'An event date is not proof of when the notice became available to bettors.'),
      unsafe('veterinaryDetails', 'Free text may describe post-race findings; publication availability must be established before feature derivation.'),
      unsafe('passedOn', 'Clearance dates are time-varying and require a page observation before the target race.'),
      preRace('priorVeterinaryEventCount', 'Derived only from records already published or observed before the cutoff.', ['publishedOrObservedAt']),
      preRace('daysSinceLastPublishedVeterinaryEvent', 'Use the last safely observed prior event; never the current-race post-race finding.', ['publishedOrObservedAt']),
      preRace('unresolvedVeterinaryFlag', 'Derive from safely observed event and clearance state as of the cutoff.', ['publishedOrObservedAt']),
    ],
  }),
  pageGroup({
    id: 'penetrometer',
    label: 'Going / penetrometer and Clegg readings',
    evidenceLevel: 'readme-only',
    repositoryImplementation: 'missing-from-public-tree',
    repositoryEvidence: ['README.md completed list', 'main.py imports a missing scrapers/scraper_penetrometer module'],
    fields: [
      preRace('venueAndSurface', 'Bind each reading to venue and turf/AWT surface.'),
      preRace('readingValue', 'Use only a reading observed before the target race post time.'),
      preRace('readingAsOf', 'Keep the displayed as-of time and the actual collection observed_at.'),
      preRace('displayedGoing', 'Treat later revisions as new observations, never overwrite history.'),
      unsafe('undatedHistoricalReading', 'A value without an as-of and observed_at cannot enter a prediction row.'),
    ],
  }),
  pageGroup({
    id: 'roarers',
    label: 'Roarers database',
    evidenceLevel: 'readme-only',
    repositoryImplementation: 'missing-from-public-tree',
    repositoryEvidence: ['README.md completed list', 'main.py imports a missing scrapers/scraper_horse_roarers module'],
    fields: [
      unsafe('diagnosisDateAndSurgery', 'The missing collector has no publication/capture timestamp contract.'),
      preRace('knownRoarerBeforeCutoff', 'Derive only from a diagnosis already observed before the target race.', ['publishedOrObservedAt']),
    ],
  }),
]);

const PARSER_FIXTURE_IDEAS = Object.freeze([
  fixture('racecard-amendment-before-cutoff', 'Two pre-race captures change jockey, draw, weight or gear; preserve both versions and select the latest one before cutoff.'),
  fixture('racecard-scratched-and-standby-runner', 'Scratch a declared starter and include a stand-by runner without shifting horse-number identity.'),
  fixture('racecard-bilingual-and-missing-optionals', 'Exercise English/Chinese labels, blank rating change, missing gear and jockey allowance.'),
  fixture('veterinary-rowspan-and-blank-horse-id', 'Continuation rows omit repeated horse identity; carry identity only within the same table group.'),
  fixture('veterinary-publication-lag', 'Event date precedes observed_at; availability uses observed_at, not the event date.'),
  fixture('penetrometer-multiple-as-of-readings', 'Morning and afternoon readings coexist; do not overwrite the morning observation.'),
  fixture('meeting-identity-mismatch-rejected', 'Page meeting date, venue or race number differs from the requested identity and must fail closed.'),
  fixture('post-time-capture-rejected', 'Any observed_at at or after targetRacePostAt is rejected as a same-race pre-race feature.'),
]);

export function buildJcscSourceCoverageAudit({
  generatedAt = new Date().toISOString(),
} = {}) {
  const pageGroups = PAGE_GROUPS.map(clonePageGroup);
  const fields = pageGroups.flatMap((group) => group.fields);
  const report = {
    reportVersion: 'source-coverage-audit-v1',
    generatedAt,
    source: { ...J_CSC_SOURCE },
    summary: {
      pageGroups: pageGroups.length,
      fields: fields.length,
      evidence: countBy(pageGroups, (group) => group.evidenceLevel),
      classifications: countBy(fields, (candidate) => candidate.classification),
      publicImplementationsPresent: pageGroups.filter((group) => group.repositoryImplementation === 'present-in-public-tree').length,
      publicImplementationsMissing: pageGroups.filter((group) => group.repositoryImplementation === 'missing-from-public-tree').length,
    },
    pageGroups,
    parserFixtureIdeas: PARSER_FIXTURE_IDEAS.map((entry) => ({ ...entry })),
    safeguards: [
      'Repository facts and official public-page schemas were reviewed independently; no third-party implementation was copied.',
      'A race/event date is not an availability timestamp. Pre-race use requires an actual observedAt before targetRacePostAt.',
      'README-only modules are not treated as working collectors because their public source and output fixtures are absent.',
      'Current-race results, running positions, finish times and undated odds remain post-race labels or blocked evidence.',
    ],
    publicationBoundary: 'Derived field-level metadata only; no third-party source code, raw scraped rows, HTML fixtures, or local paths.',
  };

  const issues = validateSourceCoverageManifest(report);
  if (issues.length > 0) throw new Error(`Invalid source coverage manifest: ${issues.join('; ')}`);
  return report;
}

export function validateSourceCoverageManifest(report) {
  const issues = [];
  const groupIds = new Set();

  if (report?.source?.licenseStatus === 'unknown') {
    if (report.source.codeReuseAllowed) issues.push('unknown-license source must not allow code reuse');
    if (report.source.rawPublicationAllowed) issues.push('unknown-license source must not allow raw publication');
  }

  for (const group of report?.pageGroups ?? []) {
    const prefix = group?.id ? `[${group.id}]` : '[missing-group-id]';
    if (!group?.id) issues.push(`${prefix} id is required`);
    if (groupIds.has(group?.id)) issues.push(`${prefix} id must be unique`);
    groupIds.add(group?.id);
    if (!EVIDENCE_LEVELS.has(group?.evidenceLevel)) issues.push(`${prefix} evidenceLevel is invalid`);
    if (!Array.isArray(group?.repositoryEvidence) || group.repositoryEvidence.length === 0) {
      issues.push(`${prefix} repositoryEvidence is required`);
    }
    for (const candidate of group?.fields ?? []) {
      const fieldPrefix = `${prefix}.${candidate?.field ?? 'missing-field'}`;
      if (!candidate?.field) issues.push(`${fieldPrefix} field is required`);
      if (!CLASSIFICATIONS.has(candidate?.classification)) issues.push(`${fieldPrefix} classification is invalid`);
      if (!candidate?.policy) issues.push(`${fieldPrefix} policy is required`);
      if (candidate?.classification === 'pre-race-usable') {
        if (!candidate.requiredProvenance?.includes('observedAt')) {
          issues.push(`${fieldPrefix} observedAt is required for pre-race use`);
        }
        if (!candidate.requiredProvenance?.includes('targetRacePostAt')) {
          issues.push(`${fieldPrefix} targetRacePostAt is required for pre-race use`);
        }
      }
    }
  }

  return issues;
}

function pageGroup(values) {
  return Object.freeze({
    ...values,
    repositoryEvidence: Object.freeze([...values.repositoryEvidence]),
    fields: Object.freeze(values.fields.map((entry) => Object.freeze({
      ...entry,
      requiredProvenance: Object.freeze([...entry.requiredProvenance]),
    }))),
  });
}

function clonePageGroup(group) {
  return {
    ...group,
    repositoryEvidence: [...group.repositoryEvidence],
    fields: group.fields.map((candidate) => ({
      ...candidate,
      requiredProvenance: [...candidate.requiredProvenance],
    })),
  };
}

function preRace(field, policy, extraProvenance = []) {
  return candidate(field, 'pre-race-usable', policy, [...PRE_RACE_PROVENANCE, ...extraProvenance]);
}

function postRace(field, policy) {
  return candidate(field, 'post-race-only', policy, ['sourceUrl', 'retrievedAt', 'checksum', 'settledAt']);
}

function unsafe(field, policy) {
  return candidate(field, 'unsafe', policy, ['sourceUrl', 'retrievedAt', 'checksum']);
}

function unavailable(field, policy) {
  return candidate(field, 'unavailable', policy, []);
}

function candidate(field, classification, policy, requiredProvenance) {
  return { field, classification, policy, requiredProvenance };
}

function fixture(id, purpose) {
  return Object.freeze({ id, purpose, storagePolicy: 'synthetic-minimal-fixture-only' });
}

function countBy(items, keyFor) {
  const counts = {};
  for (const item of items) {
    const key = keyFor(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}
