function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function parseTimestamp(value, label) {
  const text = requiredText(value, label);
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${label} must be an ISO-8601 timestamp`);
  }
  return text;
}

function finiteProbability(value) {
  const probability = Number(value);
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error('probability must be a finite number between 0 and 1');
  }
  return probability;
}

function normalizeLineage(lineage) {
  if (!lineage || typeof lineage !== 'object' || Array.isArray(lineage)) {
    throw new Error('lineage must be an object');
  }
  return {
    reportLineage: requiredText(lineage.reportLineage, 'lineage.reportLineage'),
    modelPath: requiredText(lineage.modelPath, 'lineage.modelPath'),
    reportPath: requiredText(lineage.reportPath, 'lineage.reportPath'),
    featureManifestPath: requiredText(lineage.featureManifestPath, 'lineage.featureManifestPath'),
  };
}

function rejectPromotedFlags(bundle) {
  if (bundle.executionStatus != null && bundle.executionStatus !== 'PAPER_ONLY') {
    throw new Error('executionStatus must remain PAPER_ONLY for shadow artifacts');
  }
  if (bundle.probabilityStatus != null && bundle.probabilityStatus !== 'RESEARCH_ONLY') {
    throw new Error('probabilityStatus must remain RESEARCH_ONLY for shadow artifacts');
  }
  if (bundle.researchMode != null && bundle.researchMode !== 'SHADOW') {
    throw new Error('researchMode must remain SHADOW for shadow artifacts');
  }
}

export function validateProbabilityArtifact(bundle, { raceId, postAt }) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    throw new Error('bundle must be an object');
  }
  rejectPromotedFlags(bundle);

  const normalizedRaceId = requiredText(raceId, 'raceId');
  const generatedAt = parseTimestamp(bundle.generatedAt, 'generatedAt');
  const normalizedPostAt = parseTimestamp(postAt, 'postAt');
  if (new Date(generatedAt).getTime() >= new Date(normalizedPostAt).getTime()) {
    throw new Error('generatedAt must be before postAt');
  }

  const artifactId = requiredText(bundle.artifactId, 'artifactId');
  const modelId = requiredText(bundle.modelId, 'modelId');
  const featurePolicyId = requiredText(bundle.featurePolicyId, 'featurePolicyId');
  const calibrationMethod = requiredText(bundle.calibrationMethod, 'calibrationMethod');
  const trainingCutoff = requiredText(bundle.trainingCutoff, 'trainingCutoff');
  const lineage = normalizeLineage(bundle.lineage);
  if (!Array.isArray(bundle.predictions) || bundle.predictions.length === 0) {
    throw new Error('predictions must be a non-empty array');
  }

  const seenRunnerIds = new Set();
  const predictions = bundle.predictions.map((prediction) => {
    if (!prediction || typeof prediction !== 'object' || Array.isArray(prediction)) {
      throw new Error('prediction must be an object');
    }
    const predictionRaceId = requiredText(prediction.raceId, 'prediction.raceId');
    if (predictionRaceId !== normalizedRaceId) {
      throw new Error(`prediction raceId must match ${normalizedRaceId}`);
    }
    const runnerId = requiredText(prediction.runnerId, 'prediction.runnerId');
    if (seenRunnerIds.has(runnerId)) {
      throw new Error(`duplicate runnerId: ${runnerId}`);
    }
    seenRunnerIds.add(runnerId);
    const probability = finiteProbability(prediction.probability);
    return {
      raceId: predictionRaceId,
      runnerId,
      probability,
    };
  });

  return {
    researchMode: 'SHADOW',
    executionStatus: 'PAPER_ONLY',
    probabilityStatus: 'RESEARCH_ONLY',
    generatedAt,
    artifactId,
    modelId,
    featurePolicyId,
    calibrationMethod,
    trainingCutoff,
    lineage,
    predictions,
  };
}
