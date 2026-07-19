import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import { splitDashboardForPublishing } from './dashboard-publish.js';

export const PUBLIC_SITE_STATIC_FILES = Object.freeze([
  '.nojekyll',
  'adaptive-staking.js',
  'app.js',
  'bet-strategy.js',
  'betting-products.js',
  'dashboard-cockpit.js',
  'dashboard-layout.js',
  'external-model-summary.js',
  'hkjc-horse-model/src/uncertainty-tripwire.js',
  'hkjc-horse-model/src/value-betting-engine.js',
  'icons/app-icon.svg',
  'index.html',
  'manifest.webmanifest',
  'meeting-countdown.js',
  'multi-play-portfolio.js',
  'public-dashboard-mode.js',
  'ranking-probabilities.js',
  'research-program.js',
  'self-test.js',
  'styles.css',
  'sw.js',
]);

const PUBLIC_DASHBOARD_PATH = 'data/dashboard.json';
const PUBLICATION_POLICY = Object.freeze({
  visibility: 'PUBLIC_FUNCTIONAL_SANITIZED',
  executableRecommendationsPublished: true,
  personalDataPublished: false,
  rowLevelHistoryPublished: false,
});
const FORBIDDEN_DASHBOARD_KEYS = new Set([
  'audit',
  'database',
  'finalBetPlan',
  'ledgerUrl',
  'plannedStake',
  'recommendation',
  'recommendationRuns',
  'stakePct',
  'suggestedStake',
  'ticket',
  'tickets',
]);

const CONTENT_PATTERNS = [
  ['LOCAL_PATH', /(?:\/Users\/[^\s"']+|\/home\/[^\s"']+|[A-Za-z]:\\Users\\[^\s"']+)/g],
  ['SECRET_PATTERN', /(?:github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----)/g],
];

export async function buildPublicSite({
  projectRoot,
  outputRoot,
  dashboardPath = path.join(projectRoot, PUBLIC_DASHBOARD_PATH),
  staticFiles = PUBLIC_SITE_STATIC_FILES,
}) {
  const sourceRoot = path.resolve(projectRoot);
  const destinationRoot = path.resolve(outputRoot);
  const allowedFiles = [...new Set([...staticFiles, PUBLIC_DASHBOARD_PATH])]
    .map(normalizeRelativePath)
    .sort(compareText);

  await rm(destinationRoot, { recursive: true, force: true });
  for (const relativePath of staticFiles) {
    const normalized = normalizeRelativePath(relativePath);
    const sourcePath = path.join(sourceRoot, normalized);
    const destinationPath = path.join(destinationRoot, normalized);
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await copyFile(sourcePath, destinationPath);
  }

  const sourceDashboard = JSON.parse(await readFile(path.resolve(dashboardPath), 'utf8'));
  const { publicSnapshot } = splitDashboardForPublishing(sourceDashboard);
  const publicDashboardPath = path.join(destinationRoot, PUBLIC_DASHBOARD_PATH);
  await mkdir(path.dirname(publicDashboardPath), { recursive: true });
  await writeFile(
    publicDashboardPath,
    `${JSON.stringify(publicSnapshot, null, 2)}\n`,
    'utf8',
  );

  const report = await scanPublicSite({ root: destinationRoot, allowedFiles });
  if (report.status !== 'PASS') {
    const error = new Error(`public site privacy scan failed with ${report.violations.length} violation(s)`);
    error.report = report;
    throw error;
  }
  return report;
}

export async function scanPublicSite({
  root,
  allowedFiles = [...PUBLIC_SITE_STATIC_FILES, PUBLIC_DASHBOARD_PATH],
}) {
  const absoluteRoot = path.resolve(root);
  const allowed = new Set(allowedFiles.map(normalizeRelativePath));
  const entries = await collectEntries(absoluteRoot);
  const files = entries
    .filter((entry) => entry.type === 'file')
    .map((entry) => entry.path)
    .sort(compareText);
  const violations = [];

  for (const entry of entries) {
    if (entry.type === 'symlink') {
      violations.push(violation('SYMLINK_NOT_ALLOWED', entry.path, 'Public artifacts must not contain symlinks.'));
    }
    if (!allowed.has(entry.path)) {
      violations.push(violation('PATH_NOT_ALLOWLISTED', entry.path, 'File is outside the public publish allowlist.'));
    }
  }
  for (const requiredPath of [...allowed].sort(compareText)) {
    if (!files.includes(requiredPath)) {
      violations.push(violation('REQUIRED_FILE_MISSING', requiredPath, 'Allowlisted public file is missing.'));
    }
  }

  for (const entry of entries.filter((item) => item.type === 'file')) {
    const content = await readFile(path.join(absoluteRoot, entry.path), 'utf8');
    for (const [code, pattern] of CONTENT_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(content)) {
        violations.push(violation(code, entry.path, 'Content matched a private-path or secret pattern.'));
      }
    }
  }

  if (files.includes(PUBLIC_DASHBOARD_PATH)) {
    try {
      const dashboard = JSON.parse(await readFile(path.join(absoluteRoot, PUBLIC_DASHBOARD_PATH), 'utf8'));
      scanDashboardValue(dashboard, '', violations);
      if (!Array.isArray(dashboard.ledger) || dashboard.ledger.length !== 0) {
        violations.push(violation(
          'ROW_LEVEL_HISTORY',
          PUBLIC_DASHBOARD_PATH,
          'Public dashboard ledger must be present and empty.',
        ));
      }
      if (!matchesPublicationPolicy(dashboard?.publication)) {
        violations.push(violation(
          'PUBLICATION_POLICY_MISMATCH',
          PUBLIC_DASHBOARD_PATH,
          'Public dashboard must carry the exact sanitized functional publication policy.',
        ));
      }
    } catch (error) {
      violations.push(violation('INVALID_DASHBOARD_JSON', PUBLIC_DASHBOARD_PATH, error.message));
    }
  }

  return {
    version: 'public-site-privacy-scan-v1',
    status: violations.length ? 'FAIL' : 'PASS',
    root: path.basename(absoluteRoot),
    files,
    violations,
  };
}

function matchesPublicationPolicy(publication) {
  if (!publication || typeof publication !== 'object') return false;
  return Object.entries(PUBLICATION_POLICY)
    .every(([key, expected]) => publication[key] === expected);
}

async function collectEntries(root, relativeDirectory = '') {
  const absoluteDirectory = path.join(root, relativeDirectory);
  const directoryEntries = await readdir(absoluteDirectory, { withFileTypes: true });
  const collected = [];
  for (const directoryEntry of directoryEntries.sort((left, right) => compareText(left.name, right.name))) {
    const relativePath = normalizeRelativePath(path.join(relativeDirectory, directoryEntry.name));
    const absolutePath = path.join(root, relativePath);
    const stats = await lstat(absolutePath);
    if (stats.isSymbolicLink()) {
      collected.push({ path: relativePath, type: 'symlink' });
    } else if (stats.isDirectory()) {
      collected.push(...await collectEntries(root, relativePath));
    } else if (stats.isFile()) {
      collected.push({ path: relativePath, type: 'file' });
    }
  }
  return collected;
}

function scanDashboardValue(value, keyPath, violations) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanDashboardValue(item, `${keyPath}[${index}]`, violations));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = keyPath ? `${keyPath}.${key}` : key;
    if (FORBIDDEN_DASHBOARD_KEYS.has(key)) {
      violations.push(violation(
        'FORBIDDEN_DASHBOARD_FIELD',
        `${PUBLIC_DASHBOARD_PATH}#${childPath}`,
        `Field ${key} is private and cannot be published.`,
      ));
    }
    scanDashboardValue(child, childPath, violations);
  }
}

function normalizeRelativePath(value) {
  const normalized = String(value).replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`invalid public relative path: ${value}`);
  }
  return normalized;
}

function violation(code, filePath, message) {
  return { code, path: filePath, message };
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
