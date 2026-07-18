import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildJcscSourceCoverageAudit,
  validateSourceCoverageManifest,
} from '../src/source-coverage-audit.js';

describe('j-csc source coverage audit', () => {
  it('separates verified code from README-only claims and classifies every candidate field', () => {
    const report = buildJcscSourceCoverageAudit({
      generatedAt: '2026-07-18T12:00:00.000Z',
    });

    assert.equal(report.reportVersion, 'source-coverage-audit-v1');
    assert.equal(report.generatedAt, '2026-07-18T12:00:00.000Z');
    assert.equal(report.source.sourceId, 'j-csc-hk-horse-racing-data-scraper');
    assert.equal(report.source.auditedCommit, '063a889ebfc60621a81df3f14b5def6b9c8edd89');
    assert.equal(report.source.licenseStatus, 'unknown');
    assert.equal(report.source.codeReuseAllowed, false);
    assert.equal(report.source.rawPublicationAllowed, false);
    assert.deepEqual(validateSourceCoverageManifest(report), []);

    assert(report.summary.pageGroups >= 7);
    assert(report.summary.evidence['code-verified'] >= 2);
    assert(report.summary.evidence['readme-only'] >= 4);
    assert(report.summary.classifications['pre-race-usable'] > 0);
    assert(report.summary.classifications['post-race-only'] > 0);
    assert(report.summary.classifications.unsafe > 0);
    assert(report.summary.classifications.unavailable > 0);

    const resultPage = report.pageGroups.find((group) => group.id === 'legacy-race-results');
    assert.equal(resultPage.evidenceLevel, 'code-verified');
    assert.equal(field(resultPage, 'placing').classification, 'post-race-only');
    assert.equal(field(resultPage, 'finishTime').classification, 'post-race-only');
    assert.equal(field(resultPage, 'publicOdds').classification, 'post-race-only');

    const horsePage = report.pageGroups.find((group) => group.id === 'horse-profile');
    assert.equal(horsePage.evidenceLevel, 'code-verified');
    assert.equal(field(horsePage, 'horseIdentity').classification, 'pre-race-usable');
    assert.equal(field(horsePage, 'currentRating').classification, 'unsafe');

    const racecard = report.pageGroups.find((group) => group.id === 'racecard');
    assert.equal(racecard.evidenceLevel, 'readme-only');
    assert.equal(racecard.repositoryImplementation, 'missing-from-public-tree');
    for (const name of ['draw', 'declaredWeight', 'trainerPreferenceOrder', 'gear']) {
      const candidate = field(racecard, name);
      assert.equal(candidate.classification, 'pre-race-usable');
      assert(candidate.requiredProvenance.includes('observedAt'));
      assert(candidate.requiredProvenance.includes('targetRacePostAt'));
    }

    const veterinary = report.pageGroups.find((group) => group.id === 'veterinary-records');
    assert.equal(veterinary.evidenceLevel, 'readme-only');
    assert.equal(field(veterinary, 'veterinaryDetails').classification, 'unsafe');
    assert.equal(field(veterinary, 'priorVeterinaryEventCount').classification, 'pre-race-usable');
    assert(field(veterinary, 'priorVeterinaryEventCount').requiredProvenance.includes('publishedOrObservedAt'));

    const racecardInfo = report.pageGroups.find((group) => group.id === 'racecard-info');
    assert.equal(field(racecardInfo, 'implementationAndSchema').classification, 'unavailable');

    assert(report.parserFixtureIdeas.some((fixture) => fixture.id === 'racecard-amendment-before-cutoff'));
    assert(report.parserFixtureIdeas.some((fixture) => fixture.id === 'veterinary-rowspan-and-blank-horse-id'));
    assert(report.parserFixtureIdeas.some((fixture) => fixture.id === 'post-time-capture-rejected'));
    assert.match(report.publicationBoundary, /metadata only/i);
    assert.equal(JSON.stringify(report).includes('/Users/'), false);
    assert.equal(JSON.stringify(report).includes('find_element_by_xpath'), false);
  });

  it('fails closed when a pre-race field lacks actual availability provenance', () => {
    const report = buildJcscSourceCoverageAudit();
    const unsafeCopy = structuredClone(report);
    const draw = field(unsafeCopy.pageGroups.find((group) => group.id === 'racecard'), 'draw');
    draw.requiredProvenance = draw.requiredProvenance.filter((value) => value !== 'observedAt');

    assert.match(validateSourceCoverageManifest(unsafeCopy).join(' '), /observedAt/);
  });
});

function field(group, fieldName) {
  const candidate = group.fields.find((entry) => entry.field === fieldName);
  assert(candidate, `missing ${group.id}.${fieldName}`);
  return candidate;
}
