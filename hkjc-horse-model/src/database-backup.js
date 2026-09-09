import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const MANAGED_BACKUP_PATTERN = /^hkjc-\d{8}T\d{9}Z\.sqlite$/;

export async function createDatabaseBackup({
  dbPath,
  backupDirectory,
  manifestPath,
  retain = 7,
  now = new Date(),
  sqliteCommand = 'sqlite3',
} = {}) {
  const source = absolutePath(dbPath, 'dbPath');
  const directory = absolutePath(backupDirectory, 'backupDirectory');
  const manifest = absolutePath(manifestPath, 'manifestPath');
  const retention = positiveInteger(retain, 'retain');
  const completedAt = timestamp(now);
  await stat(source);
  await mkdir(directory, { recursive: true });
  await mkdir(path.dirname(manifest), { recursive: true });

  const backupPath = path.join(directory, `hkjc-${compactTimestamp(completedAt)}.sqlite`);
  const partialPath = `${backupPath}.partial`;
  await rm(partialPath, { force: true });
  try {
    await runSqliteBackup({ sqliteCommand, source, destination: partialPath });
    await rename(partialPath, backupPath);
  } catch (error) {
    await rm(partialPath, { force: true });
    throw error;
  }

  const backupStat = await stat(backupPath);
  const sha256 = await fileSha256(backupPath);
  const current = {
    status: 'SUCCESS',
    completedAt,
    sha256,
    sizeBytes: backupStat.size,
    path: backupPath,
  };
  const previous = await readManifestBackups(manifest);
  const backups = [current, ...previous]
    .filter((item, index, rows) => rows.findIndex((row) => row.path === item.path) === index)
    .sort((left, right) => String(right.completedAt).localeCompare(String(left.completedAt)));
  const retained = backups.slice(0, retention);
  for (const item of backups.slice(retention)) {
    if (isManagedBackup(item.path, directory)) await unlink(item.path).catch(ignoreMissing);
  }

  await writeJsonAtomically(manifest, {
    schemaVersion: 'hkjc-backup-manifest-v1',
    updatedAt: completedAt,
    retention: retention,
    backups: retained,
  });
  return {
    ...current,
    backupPath: current.path,
    retainedBackups: retained.length,
    manifestPath: manifest,
  };
}

async function runSqliteBackup({ sqliteCommand, source, destination }) {
  const escapedDestination = destination.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  await new Promise((resolve, reject) => {
    const child = spawn(sqliteCommand, [source, `.backup "${escapedDestination}"`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`sqlite backup failed with exit ${code}: ${stderr.trim()}`));
    });
  });
}

async function fileSha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function readManifestBackups(manifestPath) {
  try {
    const parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
    return Array.isArray(parsed.backups) ? parsed.backups : [];
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeJsonAtomically(filePath, value) {
  const partialPath = `${filePath}.${process.pid}.partial`;
  try {
    await writeFile(partialPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(partialPath, filePath);
  } finally {
    await rm(partialPath, { force: true });
  }
}

function isManagedBackup(filePath, backupDirectory) {
  if (typeof filePath !== 'string') return false;
  return path.dirname(filePath) === backupDirectory
    && MANAGED_BACKUP_PATTERN.test(path.basename(filePath));
}

function absolutePath(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new Error(`${label} must be absolute`);
  }
  if (/[\0\r\n]/.test(value)) throw new Error(`${label} contains unsafe characters`);
  return path.normalize(value);
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 30) {
    throw new Error(`${label} must be an integer between 1 and 30`);
  }
  return number;
}

function timestamp(value) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error('now must be a valid date');
  return parsed.toISOString();
}

function compactTimestamp(value) {
  return value.replaceAll('-', '').replaceAll(':', '').replaceAll('.', '');
}

function ignoreMissing(error) {
  if (error?.code !== 'ENOENT') throw error;
}
