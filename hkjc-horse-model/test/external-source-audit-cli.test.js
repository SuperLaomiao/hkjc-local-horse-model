import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

describe('external source audit CLI', () => {
  it('writes a compact, policy-validated source report', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-source-audit-'));
    const outputPath = path.join(tempDir, 'external-source-audit.json');

    try {
      const result = spawnSync(process.execPath, [
        'hkjc-horse-model/src/cli.js',
        'external-source-audit',
        '--output',
        outputPath,
        '--generatedAt',
        '2026-07-17T00:00:00.000Z',
      ], {
        cwd: path.resolve(import.meta.dirname, '..', '..'),
        encoding: 'utf8',
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /External source audit: 14 sources/);
      assert.match(result.stdout, /3 local-only/);
      const report = JSON.parse(await readFile(outputPath, 'utf8'));
      assert.equal(report.policyVersion, 'external-source-policy-v1');
      assert.equal(report.generatedAt, '2026-07-17T00:00:00.000Z');
      assert.equal(report.summary.invalidSources, 0);
      assert.equal(report.summary.rawPublicationAllowedSources, 0);
      assert.equal(report.sources.some((source) => source.sourceId === 'official-hkjc'), true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
