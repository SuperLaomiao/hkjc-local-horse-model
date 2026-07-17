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
});
