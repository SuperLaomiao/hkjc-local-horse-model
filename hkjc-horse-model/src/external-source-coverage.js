import { createHash } from 'node:crypto';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const SOURCE_CATEGORY_RULES = {
  'sleepingarhat-tianxi-database': [
    rule('historical-results', /^data\/\d{4}\/results_.*\.csv$/i, 'post-race'),
    rule('historical-dividends', /^data\/\d{4}\/dividends_.*\.csv$/i, 'post-race'),
    rule('historical-sectionals', /^data\/\d{4}\/sectional_times_.*\.csv$/i, 'post-race'),
    rule('historical-commentary', /^data\/\d{4}\/commentary_.*\.csv$/i, 'post-race'),
    rule('historical-video-links', /^data\/\d{4}\/video_links_.*\.csv$/i, 'post-race'),
    rule('speedpro-form', /^speedpro\/data\/.*\.json$/i, 'pre-race-candidate'),
    rule('prior-trials', /^trials\/.*\.(?:csv|json)$/i, 'pre-race-candidate'),
    rule('entries', /^entries\/.*\.(?:txt|csv|json)$/i, 'pre-race-candidate'),
    rule('prior-horse-form', /^horses\/form_records\/.*\.(?:csv|json)$/i, 'pre-race-candidate'),
    rule('prior-trackwork', /^horses\/trackwork\/.*\.(?:csv|json)$/i, 'pre-race-candidate'),
    rule('prior-veterinary-records', /^horses\/injury\/.*\.(?:csv|json)$/i, 'pre-race-candidate'),
    rule('profiles-and-current-rankings', /^(?:horses\/profiles|jockeys|trainers)\/.*\.(?:csv|json)$/i, 'unsafe'),
  ],
  'mag-dot-race-data': [
    rule('formguide', /^data\/formguide\/.*\.json$/i, 'pre-race-candidate'),
    rule('barrier-trials', /^data\/barrier-trials\/.*\.json$/i, 'pre-race-candidate'),
    rule('trackwork', /^data\/trackwork\/.*\.json$/i, 'pre-race-candidate'),
    rule('results', /^data\/results\/.*\.json$/i, 'post-race'),
    rule('current-rankings', /^data\/(?:jockeys|trainers)\/.*\.json$/i, 'unsafe'),
    rule('derived-analysis', /^(?:analysis|scored|reports)\/.*\.(?:json|md|html|pdf)$/i, 'unsafe'),
  ],
};

const MAX_SCHEMA_FIELDS = 40;

export async function buildExternalSourceCoverage({
  sources = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const auditedSources = [];
  for (const source of sources) {
    auditedSources.push(await auditSource(source));
  }
  auditedSources.sort((a, b) => a.sourceId.localeCompare(b.sourceId));

  const available = auditedSources.filter((source) => source.status === 'available');
  const categoryRows = available.flatMap((source) => Object.values(source.categories));

  return {
    reportVersion: 'external-source-coverage-v1',
    generatedAt,
    summary: {
      requestedSources: auditedSources.length,
      availableSources: available.length,
      missingSources: auditedSources.length - available.length,
      totalFiles: sum(available.map((source) => source.summary.files)),
      preRaceCandidateFiles: sum(categoryRows
        .filter((category) => category.timing === 'pre-race-candidate')
        .map((category) => category.files)),
      postRaceFiles: sum(categoryRows
        .filter((category) => category.timing === 'post-race')
        .map((category) => category.files)),
      unsafeFiles: sum(categoryRows
        .filter((category) => category.timing === 'unsafe')
        .map((category) => category.files)),
    },
    sources: auditedSources,
    publicationBoundary: 'Derived coverage metadata only; source roots and raw rows are omitted.',
  };
}

async function auditSource({ sourceId, rootPath }) {
  if (!await canAccess(rootPath)) {
    return {
      sourceId,
      status: 'missing',
      cacheLabel: path.basename(rootPath ?? sourceId),
      checkoutRef: null,
      inventoryChecksum: null,
      summary: { files: 0, earliestDatedFile: null, latestDatedFile: null },
      categories: {},
      schemaSamples: [],
    };
  }

  const files = await listFiles(rootPath);
  const datedFiles = files
    .map((file) => dateFromPath(file.relativePath))
    .filter(Boolean)
    .sort();
  const categories = categorizeFiles(sourceId, files);
  const schemaSamples = await readSchemaSamples(rootPath, files, categories);

  return {
    sourceId,
    status: 'available',
    cacheLabel: path.basename(rootPath),
    checkoutRef: await readGitHead(rootPath),
    inventoryChecksum: inventoryChecksum(files),
    summary: {
      files: files.length,
      byExtension: countBy(files, (file) => file.extension || 'none'),
      earliestDatedFile: datedFiles[0] ?? null,
      latestDatedFile: datedFiles.at(-1) ?? null,
    },
    categories,
    schemaSamples,
  };
}

async function listFiles(rootPath, relativeDir = '') {
  const fullDir = path.join(rootPath, relativeDir);
  const entries = await readdir(fullDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.git') continue;
    const relativePath = path.posix.join(relativeDir.split(path.sep).join('/'), entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(rootPath, relativePath));
      continue;
    }
    if (!entry.isFile()) continue;
    const details = await stat(path.join(rootPath, relativePath));
    files.push({
      relativePath,
      size: details.size,
      extension: path.extname(entry.name).slice(1).toLowerCase(),
    });
  }

  return files;
}

function categorizeFiles(sourceId, files) {
  const rules = SOURCE_CATEGORY_RULES[sourceId] ?? [];
  const categories = {};

  for (const file of files) {
    const matched = rules.find((candidate) => candidate.pattern.test(file.relativePath));
    const category = matched ?? { category: 'other', timing: 'unsafe' };
    const current = categories[category.category] ?? {
      timing: category.timing,
      files: 0,
      examples: [],
    };
    current.files += 1;
    if (current.examples.length < 3) current.examples.push(file.relativePath);
    categories[category.category] = current;
  }

  return Object.fromEntries(Object.entries(categories).sort(([a], [b]) => a.localeCompare(b)));
}

async function readSchemaSamples(rootPath, files, categories) {
  const samples = [];
  for (const [category, details] of Object.entries(categories)) {
    const samplePath = details.examples.find((candidate) => /\.(?:csv|json)$/i.test(candidate));
    if (!samplePath) continue;
    const file = files.find((candidate) => candidate.relativePath === samplePath);
    const raw = await readFile(path.join(rootPath, samplePath), 'utf8');
    const allFields = file.extension === 'csv' ? csvFields(raw) : jsonFields(raw);
    samples.push({
      category,
      path: samplePath,
      format: file.extension,
      fields: allFields.slice(0, MAX_SCHEMA_FIELDS),
      omittedFields: Math.max(0, allFields.length - MAX_SCHEMA_FIELDS),
    });
  }
  return samples.sort((a, b) => a.category.localeCompare(b.category));
}

function csvFields(raw) {
  const header = String(raw).replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
  return header.split(',').map((field) => field.trim().replace(/^"|"$/g, ''));
}

function jsonFields(raw) {
  try {
    const parsed = JSON.parse(raw);
    const sample = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!sample || typeof sample !== 'object' || Array.isArray(sample)) return [];
    return Object.keys(sample).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function inventoryChecksum(files) {
  const hash = createHash('sha256');
  for (const file of files) hash.update(`${file.relativePath}\0${file.size}\n`);
  return `sha256:${hash.digest('hex')}`;
}

async function readGitHead(rootPath) {
  try {
    const head = (await readFile(path.join(rootPath, '.git', 'HEAD'), 'utf8')).trim();
    if (!head.startsWith('ref: ')) return head || null;
    const refPath = head.slice(5);
    try {
      return (await readFile(path.join(rootPath, '.git', refPath), 'utf8')).trim() || null;
    } catch {
      const packedRefs = await readFile(path.join(rootPath, '.git', 'packed-refs'), 'utf8');
      const match = packedRefs.split(/\r?\n/).find((line) => line.endsWith(` ${refPath}`));
      return match?.split(' ')[0] ?? null;
    }
  } catch {
    return null;
  }
}

async function canAccess(value) {
  if (!value) return false;
  try {
    await access(value);
    return true;
  } catch {
    return false;
  }
}

function dateFromPath(value) {
  return String(value).match(/(?:^|[^\d])(20\d{2}-\d{2}-\d{2})(?:[^\d]|$)/)?.[1] ?? null;
}

function countBy(items, keyFor) {
  const counts = {};
  for (const item of items) {
    const key = keyFor(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function sum(values) {
  return values.reduce((total, value) => total + Number(value ?? 0), 0);
}

function rule(category, pattern, timing) {
  return { category, pattern, timing };
}
