import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  EXTERNAL_SOURCE_REGISTRY,
  validateExternalSourceRegistry,
} from '../src/external-source-registry.js';
import { buildExternalSourceAudit } from '../src/external-source-audit.js';

describe('external source registry', () => {
  it('registers every approved data, model, and collector donor with provenance policy', () => {
    const ids = EXTERNAL_SOURCE_REGISTRY.map((source) => source.sourceId);

    assert.equal(ids.length, 12);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(validateExternalSourceRegistry(EXTERNAL_SOURCE_REGISTRY), []);
    assert.equal(ids.includes('sleepingarhat-tianxi-database'), true);
    assert.equal(ids.includes('mag-dot-race-data'), true);
    assert.equal(ids.includes('official-hkjc'), true);
    assert.equal(ids.includes('hko-open-data'), true);
    assert.equal(ids.includes('eprochasson-horserace-data'), true);
    assert.equal(ids.includes('catowabisabi-model-training'), true);
    assert.equal(ids.includes('jerrydaphantom-ml-research'), true);
    assert.equal(ids.includes('stevw-ml-research'), true);
    assert.equal(ids.includes('tang-pool-tracker'), true);
    assert.equal(ids.includes('bobosky-hkjc-api'), true);
    assert.equal(ids.includes('rkwyu-sport-betting-data'), true);
    assert.equal(ids.includes('snookerlivehk-hkjc-analytics'), true);
  });

  it('fails closed for unknown or restricted licenses', () => {
    const unsafe = {
      ...EXTERNAL_SOURCE_REGISTRY[0],
      rawPublicationAllowed: true,
      codeReuseAllowed: true,
    };

    const issues = validateExternalSourceRegistry([unsafe]);

    assert.match(issues.join(' '), /raw publication/i);
    assert.match(issues.join(' '), /code reuse/i);
  });

  it('classifies result fields as post-race and ambiguous fields as unsafe', () => {
    const tianxi = EXTERNAL_SOURCE_REGISTRY.find((source) => (
      source.sourceId === 'sleepingarhat-tianxi-database'
    ));

    assert.equal(tianxi.cachePolicy, 'local-only');
    assert.equal(tianxi.rawPublicationAllowed, false);
    assert.equal(tianxi.featureGroups.find((group) => group.featureGroup === 'current-race-results').timing, 'post-race');
    assert.equal(tianxi.featureGroups.find((group) => group.featureGroup === 'undated-speedpro-fields').timing, 'unsafe');
    assert.equal(tianxi.featureGroups.find((group) => group.featureGroup === 'prior-trials').timing, 'pre-race-candidate');
  });

  it('pins hkjc-analytics to clean-room review with no reuse or publication rights', () => {
    const analytics = EXTERNAL_SOURCE_REGISTRY.find((source) => (
      source.sourceId === 'snookerlivehk-hkjc-analytics'
    ));

    assert.equal(analytics.licenseStatus, 'unknown');
    assert.equal(analytics.codeReuseAllowed, false);
    assert.equal(analytics.rawPublicationAllowed, false);
    assert.equal(analytics.cachePolicy, 'none');
    assert.deepEqual(analytics.featureGroups.map((group) => group.timing), ['unsafe', 'unsafe']);
    assert.equal(analytics.allowedUses.includes('clean-room-methodology-reimplementation'), true);
  });
});

describe('external source audit', () => {
  it('summarizes license, donor, cache, and timing coverage deterministically', () => {
    const report = buildExternalSourceAudit({
      registry: EXTERNAL_SOURCE_REGISTRY,
      generatedAt: '2026-07-17T00:00:00.000Z',
    });

    assert.equal(report.policyVersion, 'external-source-policy-v1');
    assert.equal(report.generatedAt, '2026-07-17T00:00:00.000Z');
    assert.equal(report.summary.sources, 12);
    assert.equal(report.summary.byLicenseStatus.unknown, 6);
    assert.equal(report.summary.byLicenseStatus.restricted, 1);
    assert.equal(report.summary.byLicenseStatus['open-data'], 1);
    assert.equal(report.summary.byLicenseStatus.licensed, 4);
    assert.equal(report.summary.localOnlySources, 3);
    assert.equal(report.summary.modelDonors, 4);
    assert.equal(report.summary.dataDonors, 5);
    assert.equal(report.summary.collectorDonors, 3);
    assert.equal(report.summary.invalidSources, 0);
    assert.ok(report.summary.featureTiming['pre-race-candidate'] > 0);
    assert.ok(report.summary.featureTiming['post-race'] > 0);
    assert.ok(report.summary.featureTiming.unsafe > 0);
    assert.deepEqual(
      report.sources.map((source) => source.sourceId),
      [...report.sources.map((source) => source.sourceId)].sort(),
    );
  });

  it('rejects a registry that would allow unlicensed raw publication', () => {
    assert.throws(() => buildExternalSourceAudit({
      registry: [{
        ...EXTERNAL_SOURCE_REGISTRY[0],
        rawPublicationAllowed: true,
      }],
    }), /invalid external source registry/i);
  });
});
