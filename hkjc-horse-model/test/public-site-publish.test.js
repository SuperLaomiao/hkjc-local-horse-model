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
import { buildPublicReleaseManifest } from '../src/public-release-manifest.js';

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
        'data/publication-manifest.json',
        'index.html',
      ]);
      const manifest = JSON.parse(await readFile(path.join(output, 'data', 'publication-manifest.json'), 'utf8'));
      assert.equal(manifest.version, 'public-release-manifest-v2');
      assert.match(manifest.dashboardSha256, /^[a-f0-9]{64}$/);
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

  it('blocks a public build that would regress the deployed data contract', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'hkjc-public-regression-'));
    try {
      const source = path.join(root, 'source');
      const output = path.join(root, 'site');
      await mkdir(path.join(source, 'data'), { recursive: true });
      await writeFile(path.join(source, 'index.html'), '<main>safe</main>', 'utf8');
      await writeFile(path.join(source, 'data', 'dashboard.json'), JSON.stringify({
        generatedAt: '2026-09-29T01:00:00Z', ledger: [],
        dataSource: { settledRaces: 9, upcomingRaces: 0 },
        latestSettlement: { date: '2026-09-23' }, upcomingEntries: [],
      }), 'utf8');
      const previousManifest = {
        version: 'public-release-manifest-v1', generatedAt: '2026-09-28T01:00:00Z',
        data: { settledRaces: 10, settledThrough: '2026-09-27', upcomingRaces: 0, upcomingFrom: null },
      };

      await assert.rejects(
        buildPublicSite({ projectRoot: source, outputRoot: output, staticFiles: ['index.html'], previousManifest }),
        /release transition failed.*SETTLED_COUNT_REGRESSION.*SETTLED_DATE_REGRESSION/s,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('migrates v1 through the build CLI with public settlement evidence and no private history', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'hkjc-public-settlement-'));
    try {
      const source = path.join(root, 'source');
      const output = path.join(root, 'site');
      await mkdir(path.join(source, 'data'), { recursive: true });
      await writeFile(path.join(source, 'index.html'), '<main>safe</main>');
      const entries = [1, 2].map((raceNo) => ({
        raceId: `2026-10-01-ST-${raceNo}`, date: '2026-10-01', racecourse: 'ST', raceNo,
        forecast: { predictions: [] }, settlement: null,
      }));
      const before = {
        generatedAt: '2026-10-01T00:00:00Z', dataSource: { settledRaces: 10, upcomingRaces: 2 },
        latestSettlement: { date: '2026-09-27' }, upcomingEntries: entries,
      };
      const previousDashboardText = `${JSON.stringify(before, null, 2)}\n`;
      const previousManifest = buildPublicReleaseManifest({ dashboard: before, dashboardText: previousDashboardText });
      previousManifest.version = 'public-release-manifest-v1';
      delete previousManifest.data.upcomingRaceIds;
      delete previousManifest.data.recentSettledRaceIds;
      const priorDashboardPath = path.join(root, 'previous-dashboard.json');
      const priorManifestPath = path.join(root, 'previous-manifest.json');
      await writeFile(priorDashboardPath, previousDashboardText);
      await writeFile(priorManifestPath, JSON.stringify(previousManifest));

      for (const settledCount of [1, 2]) {
        const recentEntries = entries.slice(0, settledCount).map((entry) => ({
          ...entry,
          settlement: { ...entry, forecast: undefined, settlement: undefined, resultLabel: 'PASS', winnerHorseId: 'HK_2025_L001', stake: 100, ticket: 'PRIVATE_BET_SENTINEL' },
        }));
        const after = {
          generatedAt: '2026-10-01T09:00:00Z', dataSource: { settledRaces: 10 + settledCount, upcomingRaces: 2 - settledCount },
          latestSettlement: recentEntries.at(-1).settlement, upcomingEntries: entries.slice(settledCount), recentEntries,
          ledger: [{ raceId: 'PRIVATE_HISTORY_SENTINEL', stake: 100 }],
        };
        await writeFile(path.join(source, 'data', 'dashboard.json'), JSON.stringify(after));
        const report = await buildPublicSite({ projectRoot: source, outputRoot: output, staticFiles: ['index.html'], previousManifest, previousDashboardText });
        assert.equal(report.status, 'PASS');
        const publicText = await readFile(path.join(output, 'data', 'dashboard.json'), 'utf8');
        const manifestText = await readFile(path.join(output, 'data', 'publication-manifest.json'), 'utf8');
        assert.doesNotMatch(publicText + manifestText, /PRIVATE_.*SENTINEL|"stake"|"ticket"/);
        assert.equal(JSON.parse(manifestText).data.recentSettledRaceIds.length, settledCount);
      }

      // The same migration inputs must be threaded through the real CLI, including raw dashboard bytes.
      const projectRoot = path.resolve(import.meta.dirname, '..', '..');
      const cli = path.join(projectRoot, 'hkjc-horse-model', 'src', 'public-site-cli.js');
      const result = spawnSync(process.execPath, [
        cli, 'build', '--projectRoot', projectRoot, '--dashboard', path.join(source, 'data', 'dashboard.json'),
        '--output', output, '--previousManifest', priorManifestPath, '--previousDashboard', priorDashboardPath,
      ], { cwd: projectRoot, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr || result.stdout);

      await writeFile(priorDashboardPath, '{}');
      const rejected = spawnSync(process.execPath, [
        cli, 'build', '--projectRoot', projectRoot, '--dashboard', path.join(source, 'data', 'dashboard.json'),
        '--output', output, '--previousManifest', priorManifestPath, '--previousDashboard', priorDashboardPath,
      ], { cwd: projectRoot, encoding: 'utf8' });
      assert.notEqual(rejected.status, 0);
      assert.match(rejected.stderr, /PREVIOUS_RELEASE_INVALID/);
      await assert.rejects(readFile(path.join(output, 'data', 'publication-manifest.json')));
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
