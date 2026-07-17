import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

describe('external source coverage CLI', () => {
  it('scans configured local caches and writes derived metadata only', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-source-coverage-cli-'));
    const outputPath = path.join(tempDir, 'coverage.json');
    const tianxiDir = path.join(tempDir, 'tianxi-database', 'speedpro', 'data');
    const magDir = path.join(tempDir, 'mag-dot-race-data', 'data', 'formguide');

    try {
      await mkdir(tianxiDir, { recursive: true });
      await mkdir(magDir, { recursive: true });
      await writeFile(path.join(tianxiDir, '2026-07-15_HV.json'), JSON.stringify({ races: [] }));
      await writeFile(path.join(magDir, '2026-04-01.json'), JSON.stringify([{ raceNo: 1 }]));

      const result = spawnSync(process.execPath, [
        'hkjc-horse-model/src/cli.js',
        'external-source-coverage',
        '--cacheRoot',
        tempDir,
        '--output',
        outputPath,
        '--generatedAt',
        '2026-07-17T02:00:00.000Z',
      ], {
        cwd: path.resolve(import.meta.dirname, '..', '..'),
        encoding: 'utf8',
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /External source coverage: 2\/2 sources available/);
      const report = JSON.parse(await readFile(outputPath, 'utf8'));
      assert.equal(report.summary.totalFiles, 2);
      assert.equal(JSON.stringify(report).includes(tempDir), false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
