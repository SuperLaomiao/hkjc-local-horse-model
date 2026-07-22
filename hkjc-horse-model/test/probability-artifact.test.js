import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validateProbabilityArtifact } from '../src/probability-artifact.js';

function validBundle(overrides = {}) {
  return {
    generatedAt: '2026-07-22T10:02:00Z',
    modelId: 'catboost-market-aware-t10-v1',
    artifactId: 'sha256:abc123',
    featurePolicyId: 'market-aware-t10-v1',
    calibrationMethod: 'none',
    trainingCutoff: '2018-06-27',
    lineage: {
      reportLineage: 'selection-report',
      modelPath: 'catboost-market-aware-t10-v1.model.cbm',
      reportPath: 'catboost-market-aware-t10-v1.report.json',
      featureManifestPath: 'catboost-market-aware-t10-v1.feature-manifest.json',
    },
    predictions: [
      {
        raceId: '2026-07-22-HV-R1',
        runnerId: 'H001',
        probability: 0.42,
        modelId: 'catboost-market-aware-t10-v1',
        artifactId: 'sha256:abc123',
        featurePolicyId: 'market-aware-t10-v1',
        calibrationMethod: 'none',
        trainingCutoff: '2018-06-27',
      },
      {
        raceId: '2026-07-22-HV-R1',
        runnerId: 'H002',
        probability: 0.58,
        modelId: 'catboost-market-aware-t10-v1',
        artifactId: 'sha256:abc123',
        featurePolicyId: 'market-aware-t10-v1',
        calibrationMethod: 'none',
        trainingCutoff: '2018-06-27',
      },
    ],
    ...overrides,
  };
}

describe('validateProbabilityArtifact', () => {
  it('normalizes a lineage-bound score bundle to paper-only shadow mode', () => {
    const result = validateProbabilityArtifact(validBundle(), {
      raceId: '2026-07-22-HV-R1',
      postAt: '2026-07-22T10:30:00Z',
    });

    assert.deepEqual(result, {
      researchMode: 'SHADOW',
      executionStatus: 'PAPER_ONLY',
      probabilityStatus: 'RESEARCH_ONLY',
      generatedAt: '2026-07-22T10:02:00Z',
      artifactId: 'sha256:abc123',
      modelId: 'catboost-market-aware-t10-v1',
      featurePolicyId: 'market-aware-t10-v1',
      calibrationMethod: 'none',
      trainingCutoff: '2018-06-27',
      lineage: {
        reportLineage: 'selection-report',
        modelPath: 'catboost-market-aware-t10-v1.model.cbm',
        reportPath: 'catboost-market-aware-t10-v1.report.json',
        featureManifestPath: 'catboost-market-aware-t10-v1.feature-manifest.json',
      },
      predictions: [
        { raceId: '2026-07-22-HV-R1', runnerId: 'H001', probability: 0.42 },
        { raceId: '2026-07-22-HV-R1', runnerId: 'H002', probability: 0.58 },
      ],
    });
  });

  it('rejects missing lineage, duplicate runners, invalid probabilities, post-time generation, and promoted flags', () => {
    assert.throws(
      () => validateProbabilityArtifact(
        validBundle({ lineage: null }),
        { raceId: '2026-07-22-HV-R1', postAt: '2026-07-22T10:30:00Z' },
      ),
      /lineage/,
    );

    assert.throws(
      () => validateProbabilityArtifact(
        validBundle({
          predictions: [
            validBundle().predictions[0],
            { ...validBundle().predictions[0] },
          ],
        }),
        { raceId: '2026-07-22-HV-R1', postAt: '2026-07-22T10:30:00Z' },
      ),
      /duplicate runnerId/,
    );

    assert.throws(
      () => validateProbabilityArtifact(
        validBundle({
          predictions: [{ ...validBundle().predictions[0], probability: 1.2 }],
        }),
        { raceId: '2026-07-22-HV-R1', postAt: '2026-07-22T10:30:00Z' },
      ),
      /probability/,
    );

    assert.throws(
      () => validateProbabilityArtifact(
        validBundle({ generatedAt: '2026-07-22T10:30:00Z' }),
        { raceId: '2026-07-22-HV-R1', postAt: '2026-07-22T10:30:00Z' },
      ),
      /generatedAt must be before postAt/,
    );

    assert.throws(
      () => validateProbabilityArtifact(
        validBundle({ executionStatus: 'CALIBRATED' }),
        { raceId: '2026-07-22-HV-R1', postAt: '2026-07-22T10:30:00Z' },
      ),
      /executionStatus/,
    );
  });
});
