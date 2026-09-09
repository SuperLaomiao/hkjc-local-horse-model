import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

import { createDatabaseBackup } from '../src/database-backup.js';

describe('private SQLite backup', () => {
  it('creates a queryable snapshot and atomic checksum manifest', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-db-backup-'));
    const dbPath = path.join(tempDir, 'source.sqlite');
    const backupDirectory = path.join(tempDir, 'backups');
    const manifestPath = path.join(tempDir, 'private', 'backup-manifest.json');

    try {
      runSqlite(dbPath, 'create table races(id text primary key); insert into races values (\'r1\');');
      const report = await createDatabaseBackup({
        dbPath,
        backupDirectory,
        manifestPath,
        retain: 7,
        now: new Date('2026-09-09T00:00:00.000Z'),
      });

      assert.equal(report.status, 'SUCCESS');
      assert.equal(report.completedAt, '2026-09-09T00:00:00.000Z');
      assert.match(report.backupPath, /hkjc-20260909T000000000Z\.sqlite$/);
      assert.equal(runSqlite(report.backupPath, 'select count(*) from races;'), '1');
      assert.equal(report.sha256, sha256(await readFile(report.backupPath)));
      assert.ok((await stat(report.backupPath)).size > 0);

      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      assert.equal(manifest.schemaVersion, 'hkjc-backup-manifest-v1');
      assert.equal(manifest.backups.length, 1);
      assert.equal(manifest.backups[0].sha256, report.sha256);
      assert.equal(manifest.backups[0].status, 'SUCCESS');
      assert.deepEqual(
        (await readdir(path.dirname(manifestPath))).filter((name) => name.includes('.partial')),
        [],
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('retains only the newest managed backups and preserves unrelated files', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-db-retention-'));
    const dbPath = path.join(tempDir, 'source.sqlite');
    const backupDirectory = path.join(tempDir, 'backups');
    const manifestPath = path.join(tempDir, 'private', 'backup-manifest.json');

    try {
      runSqlite(dbPath, 'create table races(id text primary key); insert into races values (\'r1\');');
      await createDatabaseBackup({
        dbPath,
        backupDirectory,
        manifestPath,
        retain: 2,
        now: new Date('2026-09-07T00:00:00.000Z'),
      });
      await writeFile(path.join(backupDirectory, 'keep-me.txt'), 'private note');
      await createDatabaseBackup({
        dbPath,
        backupDirectory,
        manifestPath,
        retain: 2,
        now: new Date('2026-09-08T00:00:00.000Z'),
      });
      await createDatabaseBackup({
        dbPath,
        backupDirectory,
        manifestPath,
        retain: 2,
        now: new Date('2026-09-09T00:00:00.000Z'),
      });

      const files = await readdir(backupDirectory);
      assert.deepEqual(files.sort(), [
        'hkjc-20260908T000000000Z.sqlite',
        'hkjc-20260909T000000000Z.sqlite',
        'keep-me.txt',
      ]);
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      assert.deepEqual(
        manifest.backups.map((item) => path.basename(item.path)),
        ['hkjc-20260909T000000000Z.sqlite', 'hkjc-20260908T000000000Z.sqlite'],
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('runs through the backup-db CLI with explicit private paths', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-db-backup-cli-'));
    const dbPath = path.join(tempDir, 'source.sqlite');
    const backupDirectory = path.join(tempDir, 'backups');
    const manifestPath = path.join(tempDir, 'private', 'backup-manifest.json');

    try {
      runSqlite(dbPath, 'create table races(id text primary key); insert into races values (\'r1\');');
      const result = spawnSync(process.execPath, [
        'hkjc-horse-model/src/cli.js',
        'backup-db',
        '--db', dbPath,
        '--backupDirectory', backupDirectory,
        '--manifest', manifestPath,
        '--retain', '2',
        '--now', '2026-09-09T00:00:00.000Z',
      ], {
        cwd: path.resolve(import.meta.dirname, '..', '..'),
        encoding: 'utf8',
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /SQLite backup complete/);
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      assert.equal(manifest.retention, 2);
      assert.equal(runSqlite(manifest.backups[0].path, 'select count(*) from races;'), '1');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

function runSqlite(dbPath, sql) {
  const result = spawnSync('sqlite3', [dbPath, sql], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}
