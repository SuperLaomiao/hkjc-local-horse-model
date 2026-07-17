import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MODEL_BENCHMARK_REGISTRY,
  MODEL_BENCHMARK_REGISTRY_VERSION,
  buildModelBenchmarkRegistrySnapshot,
  summarizeModelBenchmarkRegistry,
  validateModelBenchmarkRegistry,
} from '../src/model-benchmark-registry.js';

const EXPECTED_IDS = [
  'catowabisabi-lgb-quinella',
  'current-baseline',
  'hkjc-edge-lab-clv',
  'hkjc-pool-tracker-features',
  'jerrydaphantom-catboost-calibration',
  'neigh-speedpro-features',
];

describe('model benchmark registry', () => {
  it('registers the approved baseline and external ideas', () => {
    const ids = MODEL_BENCHMARK_REGISTRY.map((entry) => entry.id).sort();

    assert.deepEqual(ids, EXPECTED_IDS);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(validateModelBenchmarkRegistry(), []);
  });

  it('records actionable evidence and promotion gates for every entry', () => {
    for (const entry of MODEL_BENCHMARK_REGISTRY) {
      assert.ok(entry.label, `${entry.id} must have a label`);
      assert.ok(entry.source, `${entry.id} must have a source`);
      assert.ok(entry.localAdoptionStatus, `${entry.id} must have a local adoption status`);
      assert.ok(entry.requiredData.length > 0, `${entry.id} must record required data`);
      assert.ok(entry.leakageRisks.length > 0, `${entry.id} must record leakage risks`);
      assert.ok(entry.metrics.length > 0, `${entry.id} must record metrics`);
      assert.ok(entry.promotionGates.length > 0, `${entry.id} must record promotion gates`);

      for (const gate of entry.promotionGates) {
        assert.ok(gate.id, `${entry.id} promotion gate must have an id`);
        assert.ok(gate.requirement, `${entry.id} promotion gate must be explicit`);
      }
    }
  });

  it('builds deterministic summaries independent of registry order', () => {
    const summary = summarizeModelBenchmarkRegistry(MODEL_BENCHMARK_REGISTRY);
    const reversedSummary = summarizeModelBenchmarkRegistry(
      [...MODEL_BENCHMARK_REGISTRY].reverse(),
    );

    assert.deepEqual(summary, reversedSummary);
    assert.equal(summary.totalEntries, 6);
    assert.equal(summary.externalIdeas, 5);
    assert.deepEqual(summary.ids, EXPECTED_IDS);
    assert.deepEqual(Object.keys(summary.byLocalAdoptionStatus), [
      'active-baseline',
      'implemented-awaiting-coverage',
      'reproduce-next',
      'research-backlog',
    ]);
    assert.equal(summary.byLocalAdoptionStatus['reproduce-next'], 2);
    assert.equal(summary.promotionGateCount > summary.totalEntries, true);
  });

  it('builds a dashboard-safe snapshot in stable id order', () => {
    const snapshot = buildModelBenchmarkRegistrySnapshot({
      registry: [...MODEL_BENCHMARK_REGISTRY].reverse(),
    });

    assert.equal(snapshot.version, MODEL_BENCHMARK_REGISTRY_VERSION);
    assert.deepEqual(snapshot.summary.ids, EXPECTED_IDS);
    assert.deepEqual(snapshot.entries.map((entry) => entry.id), EXPECTED_IDS);
    assert.equal(JSON.stringify(snapshot).includes('/Users/'), false);
  });

  it('fails closed instead of publishing an invalid registry', () => {
    assert.throws(
      () => buildModelBenchmarkRegistrySnapshot({
        registry: [validEntry({ sourceUrl: 'file:///Users/example/private-repo' })],
      }),
      /model benchmark registry is invalid/i,
    );
  });

  it('projects only dashboard-safe entry and promotion gate fields', () => {
    const snapshot = buildModelBenchmarkRegistrySnapshot({
      registry: [validEntry({
        debugPath: '/Users/example/private-repo',
        diagnostics: { localFile: 'file:///private/data.json' },
        promotionGates: [{
          id: 'safe-gate',
          requirement: 'Keep this explicit.',
        }],
      })],
    });

    assert.deepEqual(Object.keys(snapshot.entries[0]).sort(), [
      'id',
      'kind',
      'label',
      'leakageRisks',
      'localAdoptionStatus',
      'metrics',
      'promotionGates',
      'requiredData',
      'source',
      'sourceUrl',
    ]);
    assert.deepEqual(Object.keys(snapshot.entries[0].promotionGates[0]).sort(), ['id', 'requirement']);
    assert.equal(JSON.stringify(snapshot).includes('/Users/'), false);
    assert.equal(JSON.stringify(snapshot).includes('file:'), false);
  });

  it('orders summaries and snapshots by Unicode code point, not locale', () => {
    const registry = [
      validEntry({ id: 'a' }),
      validEntry({ id: 'A', promotionGates: [{ id: 'upper', requirement: 'Uppercase id.' }] }),
      validEntry({ id: '\u{10000}', promotionGates: [{ id: 'astral', requirement: 'Astral id.' }] }),
      validEntry({ id: '\uffff', promotionGates: [{ id: 'bmp', requirement: 'BMP id.' }] }),
    ];

    const expectedIds = ['A', 'a', '\uffff', '\u{10000}'];
    assert.deepEqual(summarizeModelBenchmarkRegistry(registry).ids, expectedIds);
    assert.deepEqual(buildModelBenchmarkRegistrySnapshot({ registry }).entries.map((entry) => entry.id), expectedIds);
  });

  it('reports malformed entries without throwing', () => {
    const issues = validateModelBenchmarkRegistry([{
      id: 'broken',
      label: 'Broken',
      source: 'test',
      requiredData: [],
      leakageRisks: [],
      metrics: [],
      localAdoptionStatus: '',
      promotionGates: [{ id: '', requirement: '' }],
    }]);

    assert.match(issues.join(' '), /requiredData/);
    assert.match(issues.join(' '), /leakageRisks/);
    assert.match(issues.join(' '), /metrics/);
    assert.match(issues.join(' '), /localAdoptionStatus/);
    assert.match(issues.join(' '), /promotion gate/);
  });

  it('requires the registry to be an array of entry objects', () => {
    assert.match(validateModelBenchmarkRegistry(null).join(' '), /registry must be an array/);
    assert.doesNotThrow(() => validateModelBenchmarkRegistry({}));
    assert.match(validateModelBenchmarkRegistry({}).join(' '), /registry must be an array/);
    assert.match(validateModelBenchmarkRegistry([null]).join(' '), /entry must be an object/);
    assert.match(validateModelBenchmarkRegistry([[]]).join(' '), /entry must be an object/);
  });

  it('fails closed for null registries across validation, summary, and snapshot', () => {
    assert.match(validateModelBenchmarkRegistry(null).join(' '), /registry must be an array/);
    assert.throws(
      () => summarizeModelBenchmarkRegistry(null),
      /registry must be an array/,
    );
    assert.throws(
      () => buildModelBenchmarkRegistrySnapshot({ registry: null }),
      /registry must be an array/,
    );
    assert.throws(
      () => buildModelBenchmarkRegistrySnapshot(null),
      /registry must be an array/,
    );
  });

  it('requires trimmed scalar fields, allowed enums, and public HTTPS source URLs', () => {
    const invalidValues = [
      ['id', ' benchmark'],
      ['label', ' '],
      ['source', 'source '],
      ['kind', 'unknown-kind'],
      ['localAdoptionStatus', 'unknown-status'],
      ['sourceUrl', 'file:///Users/example/private-repo'],
      ['sourceUrl', 'https://localhost/private-repo'],
      ['sourceUrl', 'https://[::]/x'],
      ['sourceUrl', 'https://100.64.0.1/x'],
      ['sourceUrl', 'https://host.local/x'],
      ['sourceUrl', 'https://user:secret@example.com/x'],
      ['sourceUrl', 'https://127.0.0.1/private-repo'],
      ['sourceUrl', 'https://[::ffff:127.0.0.1]/private-repo'],
      ['sourceUrl', '/Users/example/private-repo'],
    ];

    for (const [field, value] of invalidValues) {
      const issues = validateModelBenchmarkRegistry([validEntry({ [field]: value })]);
      assert.match(issues.join(' '), new RegExp(field), `${field} should be rejected`);
    }
  });

  it('rejects private paths from every projected string field', () => {
    const cases = [
      ['id', (entry, value) => ({ ...entry, id: value })],
      ['label', (entry, value) => ({ ...entry, label: value })],
      ['source', (entry, value) => ({ ...entry, source: value })],
      ['kind', (entry, value) => ({ ...entry, kind: value })],
      ['localAdoptionStatus', (entry, value) => ({ ...entry, localAdoptionStatus: value })],
      ['requiredData', (entry, value) => ({ ...entry, requiredData: [value] })],
      ['leakageRisks', (entry, value) => ({ ...entry, leakageRisks: [value] })],
      ['metrics', (entry, value) => ({ ...entry, metrics: [value] })],
      ['promotion gate id', (entry, value) => ({
        ...entry,
        promotionGates: [{ id: value, requirement: 'Safe requirement.' }],
      })],
      ['promotion gate requirement', (entry, value) => ({
        ...entry,
        promotionGates: [{ id: 'safe-gate', requirement: value }],
      })],
    ];

    for (const privateText of ['/Users/alice/private', 'file:///Users/alice/private']) {
      for (const [field, makeEntry] of cases) {
        const issues = validateModelBenchmarkRegistry([
          makeEntry(validEntry(), privateText),
        ]);

        assert.match(issues.join(' '), /privacy-safe|private path|local path/i, `${field} should be rejected`);
        assert.throws(
          () => buildModelBenchmarkRegistrySnapshot({
            registry: [makeEntry(validEntry(), privateText)],
          }),
          /model benchmark registry is invalid/i,
          `${field} should not be projected`,
        );
      }
    }
  });

  it('requires list fields to contain only non-empty trimmed strings', () => {
    for (const field of ['requiredData', 'leakageRisks', 'metrics']) {
      const blankIssues = validateModelBenchmarkRegistry([
        validEntry({ [field]: ['valid', '  '] }),
      ]);
      const nonStringIssues = validateModelBenchmarkRegistry([
        validEntry({ [field]: ['valid', 42] }),
      ]);

      assert.match(blankIssues.join(' '), new RegExp(field));
      assert.match(nonStringIssues.join(' '), new RegExp(field));
    }
  });

  it('requires unique trimmed promotion gate ids and only valid gate fields', () => {
    const issues = validateModelBenchmarkRegistry([
      validEntry({
        promotionGates: [
          { id: 'same', requirement: 'First requirement.' },
          { id: 'same', requirement: 'Second requirement.' },
          { id: ' padded', requirement: ' ' },
          { id: 'extra', requirement: 'Valid requirement.', debugPath: '/Users/example' },
          null,
        ],
      }),
    ]);
    const message = issues.join(' ');

    assert.match(message, /promotion gate id must be unique/);
    assert.match(message, /promotion gate id must be a non-empty trimmed string/);
    assert.match(message, /promotion gate requirement must be a non-empty trimmed string/);
    assert.match(message, /promotion gate fields are invalid/);
    assert.match(message, /promotion gate must be an object/);
  });
});

function validEntry(overrides = {}) {
  const entry = MODEL_BENCHMARK_REGISTRY[0];
  return {
    ...entry,
    requiredData: [...entry.requiredData],
    leakageRisks: [...entry.leakageRisks],
    metrics: [...entry.metrics],
    promotionGates: entry.promotionGates.map((gate) => ({ ...gate })),
    ...overrides,
  };
}
