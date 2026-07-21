import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

describe('shadow-score CLI', () => {
  it('runs the Python scorer, validates the artifact, and writes a paper-only shadow bundle', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-shadow-score-'));
    const inputPath = path.join(tempDir, 'upcoming.jsonl');
    const outputPath = path.join(tempDir, 'shadow-score.json');
    const fakePythonPath = path.join(tempDir, 'fake-python');

    try {
      await writeFile(
        inputPath,
        `${JSON.stringify({
          raceId: '2026-07-22-HV-R1',
          runnerId: 'H001',
          barrier: 1,
          marketWinOddsT10: 3.2,
          observedAt: '2026-07-22T10:01:00Z',
          postAt: '2026-07-22T10:30:00Z',
        })}\n`,
        'utf8',
      );
      await writeFile(
        fakePythonPath,
        `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output');
if (outputIndex === -1) process.exit(2);
const outputPath = args[outputIndex + 1];
fs.writeFileSync(outputPath, JSON.stringify({
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
  predictions: [{
    raceId: '2026-07-22-HV-R1',
    runnerId: 'H001',
    probability: 0.42,
  }],
}, null, 2));
`,
        'utf8',
      );
      await chmod(fakePythonPath, 0o755);

      const result = spawnSync(process.execPath, [
        'hkjc-horse-model/src/cli.js',
        'shadow-score',
        '--input',
        inputPath,
        '--model',
        path.join(tempDir, 'catboost-market-aware-t10-v1.model.cbm'),
        '--report',
        path.join(tempDir, 'catboost-market-aware-t10-v1.report.json'),
        '--featureManifest',
        path.join(tempDir, 'catboost-market-aware-t10-v1.feature-manifest.json'),
        '--generatedAt',
        '2026-07-22T10:02:00Z',
        '--output',
        outputPath,
      ], {
        cwd: path.resolve(import.meta.dirname, '..', '..'),
        encoding: 'utf8',
        env: {
          ...process.env,
          PYTHON: fakePythonPath,
        },
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /Shadow score bundle: 1 runners/);
      const bundle = JSON.parse(await readFile(outputPath, 'utf8'));
      assert.equal(bundle.researchMode, 'SHADOW');
      assert.equal(bundle.executionStatus, 'PAPER_ONLY');
      assert.equal(bundle.probabilityStatus, 'RESEARCH_ONLY');
      assert.equal(bundle.predictions.length, 1);
      assert.equal(bundle.predictions[0].runnerId, 'H001');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
