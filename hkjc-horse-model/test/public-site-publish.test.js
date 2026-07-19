import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

import {
  buildPublicSite,
  scanPublicSite,
} from '../src/public-site-publish.js';

describe('public site publishing boundary', () => {
  it('copies only allowlisted assets and writes a sanitized dashboard', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'hkjc-public-site-'));
    try {
      const source = path.join(root, 'source');
      const output = path.join(root, 'site');
      await mkdir(path.join(source, 'data', 'raw'), { recursive: true });
      await writeFile(path.join(source, 'index.html'), '<main>safe</main>', 'utf8');
      await writeFile(path.join(source, 'app.js'), 'console.log("safe")', 'utf8');
      await writeFile(path.join(source, 'dashboard-cockpit.js'), 'export const safe = true;', 'utf8');
      await writeFile(path.join(source, 'data', 'raw', 'private.json'), '{"raw":true}', 'utf8');
      await writeFile(path.join(source, 'data', 'dashboard.json'), JSON.stringify({
        generatedAt: '2026-07-18T00:00:00.000Z',
        ledger: [{ raceId: 'private-row' }],
        recentEntries: [{
          raceId: 'race-1',
          forecast: {
            topPick: { horseName: 'Public Top Pick' },
            recommendation: { suggestedStake: 50 },
          },
        }],
      }), 'utf8');

      const report = await buildPublicSite({
        projectRoot: source,
        outputRoot: output,
        staticFiles: ['index.html', 'app.js', 'dashboard-cockpit.js'],
      });
      const dashboard = JSON.parse(await readFile(path.join(output, 'data', 'dashboard.json'), 'utf8'));

      assert.equal(report.status, 'PASS');
      assert.deepEqual(report.files, [
        'app.js',
        'dashboard-cockpit.js',
        'data/dashboard.json',
        'index.html',
      ]);
      assert.deepEqual(dashboard.ledger, []);
      assert.equal(dashboard.recentEntries[0].forecast.topPick.horseName, 'Public Top Pick');
      assert.equal(dashboard.recentEntries[0].forecast.recommendation, undefined);
      assert.equal(dashboard.publication.visibility, 'PUBLIC_FUNCTIONAL_SANITIZED');
      assert.equal(dashboard.publication.executableRecommendationsPublished, true);
      assert.equal(dashboard.publication.personalDataPublished, false);
      assert.equal(dashboard.publication.rowLevelHistoryPublished, false);
      await assert.rejects(readFile(path.join(output, 'data', 'raw', 'private.json'), 'utf8'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a public dashboard that claims personal data is published', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'hkjc-functional-policy-'));
    try {
      await mkdir(path.join(root, 'data'), { recursive: true });
      await writeFile(path.join(root, 'index.html'), '<main>safe</main>', 'utf8');
      await writeFile(path.join(root, 'data', 'dashboard.json'), JSON.stringify({
        ledger: [],
        publication: {
          visibility: 'PUBLIC_FUNCTIONAL_SANITIZED',
          executableRecommendationsPublished: true,
          personalDataPublished: true,
          rowLevelHistoryPublished: false,
        },
      }), 'utf8');

      const report = await scanPublicSite({
        root,
        allowedFiles: ['index.html', 'data/dashboard.json'],
      });

      assert.equal(report.status, 'FAIL');
      assert.equal(
        report.violations.some((item) => item.code === 'PUBLICATION_POLICY_MISMATCH'),
        true,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails closed for unexpected files, local paths, secrets, and symlinks', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'hkjc-privacy-scan-'));
    try {
      await mkdir(path.join(root, 'data'), { recursive: true });
      await writeFile(path.join(root, 'index.html'), '<main>/Users/example/private</main>', 'utf8');
      await writeFile(path.join(root, 'data', 'dashboard.json'), JSON.stringify({
        ledger: [],
        token: 'github_pat_123456789012345678901234567890',
      }), 'utf8');
      await writeFile(path.join(root, 'data', 'latest-recommendation-audit.json'), '{}', 'utf8');
      await symlink(path.join(root, 'data', 'dashboard.json'), path.join(root, 'linked-dashboard.json'));

      const report = await scanPublicSite({
        root,
        allowedFiles: ['index.html', 'data/dashboard.json'],
      });

      assert.equal(report.status, 'FAIL');
      assert.equal(report.violations.some((item) => item.code === 'PATH_NOT_ALLOWLISTED'), true);
      assert.equal(report.violations.some((item) => item.code === 'LOCAL_PATH'), true);
      assert.equal(report.violations.some((item) => item.code === 'SECRET_PATTERN'), true);
      assert.equal(report.violations.some((item) => item.code === 'SYMLINK_NOT_ALLOWED'), true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('exposes build and scan CLI commands for the deployment workflow', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'hkjc-public-cli-'));
    try {
      const projectRoot = path.resolve(import.meta.dirname, '..', '..');
      const output = path.join(root, 'site');
      const build = spawnSync(process.execPath, [
        'hkjc-horse-model/src/public-site-cli.js',
        'build',
        '--projectRoot',
        projectRoot,
        '--dashboard',
        path.join(projectRoot, 'data', 'dashboard.json'),
        '--output',
        output,
      ], { cwd: projectRoot, encoding: 'utf8' });

      assert.equal(build.status, 0, build.stderr || build.stdout);
      assert.match(build.stdout, /privacy scan PASS/i);
      assert.match(
        await readFile(path.join(output, 'hkjc-horse-model', 'src', 'value-betting-engine.js'), 'utf8'),
        /evaluateValueCandidate/,
      );
      assert.match(
        await readFile(path.join(output, 'hkjc-horse-model', 'src', 'uncertainty-tripwire.js'), 'utf8'),
        /evaluateUncertaintyTripwire/,
      );

      const scan = spawnSync(process.execPath, [
        'hkjc-horse-model/src/public-site-cli.js',
        'scan',
        '--root',
        output,
      ], { cwd: projectRoot, encoding: 'utf8' });

      assert.equal(scan.status, 0, scan.stderr || scan.stdout);
      assert.match(scan.stdout, /privacy scan PASS/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
