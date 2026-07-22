import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

import { renderLaunchAgent } from '../src/local-scheduler.js';

describe('local race-day scheduler', () => {
  it('renders a disabled, secret-free LaunchAgent for the local cycle', () => {
    const plist = renderLaunchAgent({
      projectPath: '/Users/test/HKJC Model',
      dbPath: '/Users/test/HKJC Model/hkjc-horse-model/data/hkjc.sqlite',
      logDirectory: '/Users/test/HKJC Model/hkjc-horse-model/data/private/logs',
      intervalMinutes: 10,
    });

    assert.match(plist, /com\.superlaomiao\.hkjc-race-day-cycle/);
    assert.match(plist, /npm run hkjc:race-day-cycle/);
    assert.match(plist, /<integer>600<\/integer>/);
    assert.match(plist, /<key>Disabled<\/key>\s*<true\/>/);
    assert.match(plist, /data\/private\/logs\/race-day-cycle\.log/);
    assert.doesNotMatch(plist, /token|password|secret|api[_-]?key/i);
  });

  it('rejects relative paths, unsafe XML characters, and intervals below five minutes', () => {
    assert.throws(
      () => renderLaunchAgent({ projectPath: 'relative/project', intervalMinutes: 10 }),
      /projectPath must be absolute/,
    );
    assert.throws(
      () => renderLaunchAgent({ projectPath: '/tmp/project\nmalicious', intervalMinutes: 10 }),
      /projectPath contains unsafe characters/,
    );
    assert.throws(
      () => renderLaunchAgent({ projectPath: '/tmp/project', intervalMinutes: 4 }),
      /intervalMinutes must be at least 5/,
    );
  });

  it('renders a reviewed plist through the CLI without installing it', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-local-scheduler-'));
    const outputPath = path.join(tempDir, 'review', 'hkjc.plist');
    const launchAgentPath = path.join(tempDir, 'Library', 'LaunchAgents', 'com.superlaomiao.hkjc-race-day-cycle.plist');

    try {
      const result = spawnSync(process.execPath, [
        'hkjc-horse-model/src/cli.js',
        'local-scheduler',
        '--projectPath',
        tempDir,
        '--intervalMinutes',
        '10',
        '--output',
        outputPath,
        '--dryRun',
      ], {
        cwd: path.resolve(import.meta.dirname, '..', '..'),
        encoding: 'utf8',
        env: { ...process.env, HOME: tempDir },
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /未安装/);
      assert.match(await readFile(outputPath, 'utf8'), /<key>Disabled<\/key>\s*<true\/>/);
      await assert.rejects(access(launchAgentPath));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
