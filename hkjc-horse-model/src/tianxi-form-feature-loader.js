import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildTianxiFormFeatures,
  emptyTianxiFormFeatures,
  normalizeTianxiHorseCode,
} from './tianxi-form-features.js';

const SOURCE_ID = 'sleepingarhat-tianxi-database';

export async function loadTianxiFormFeatureIndex({
  rootPath,
  races = [],
  checkoutRef = null,
  availabilityLagDays = 1,
} = {}) {
  if (!rootPath) throw new Error('loadTianxiFormFeatureIndex requires rootPath');

  const runnerRequests = (races ?? []).flatMap((race) => (
    (race.runners ?? []).map((runner) => ({
      race,
      runner,
      horseCode: normalizeTianxiHorseCode(runner.horseId ?? runner.horseCode),
    }))
  ));
  const horseCodes = [...new Set(runnerRequests.map((request) => request.horseCode).filter(Boolean))].sort();
  const rowsByHorseCode = new Map();
  let sourceFilesRead = 0;
  let missingHorseCodes = 0;
  let parsedRows = 0;

  for (const horseCode of horseCodes) {
    const sourcePath = path.join(rootPath, 'horses', 'form_records', `form_${horseCode}.csv`);
    try {
      const rows = parseCsvRows(await readFile(sourcePath, 'utf8'));
      rowsByHorseCode.set(horseCode, rows);
      sourceFilesRead += 1;
      parsedRows += rows.length;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      rowsByHorseCode.set(horseCode, []);
      missingHorseCodes += 1;
    }
  }

  const featuresByRunner = new Map();
  const aggregateAudit = {
    eligibleRows: 0,
    excludedNotAvailableRows: 0,
    invalidDateRows: 0,
    horseMismatchRows: 0,
  };
  let availableFeatureRows = 0;

  for (const request of runnerRequests) {
    const rows = request.horseCode ? rowsByHorseCode.get(request.horseCode) ?? [] : [];
    const result = request.horseCode
      ? buildTianxiFormFeatures({
        horseCode: request.horseCode,
        targetDate: request.race.date,
        targetDistance: request.race.distance,
        rows,
        availabilityLagDays,
      })
      : { features: emptyTianxiFormFeatures(), audit: {} };
    featuresByRunner.set(tianxiRunnerFeatureKey(request.race, request.runner), result.features);
    if (result.features.tianxiFormAvailable === 1) availableFeatureRows += 1;
    for (const key of Object.keys(aggregateAudit)) {
      aggregateAudit[key] += Number(result.audit[key] ?? 0);
    }
  }

  return {
    featuresByRunner,
    summary: {
      sourceId: SOURCE_ID,
      checkoutRef: checkoutRef ?? await readGitHead(rootPath),
      availabilityLagDays,
      requestedRunnerRows: runnerRequests.length,
      uniqueHorseCodes: horseCodes.length,
      sourceFilesRead,
      missingHorseCodes,
      parsedRows,
      ...aggregateAudit,
      availableFeatureRows,
      unavailableFeatureRows: runnerRequests.length - availableFeatureRows,
      publicationBoundary: 'Derived features only; raw source paths and rows omitted.',
    },
  };
}

export function tianxiRunnerFeatureKey(race, runner) {
  const horseCode = normalizeTianxiHorseCode(runner?.horseId ?? runner?.horseCode);
  return `${race?.raceId ?? ''}|${horseCode ?? `horse-no-${runner?.horseNo ?? 'unknown'}`}`;
}

export function parseCsvRows(raw) {
  const records = parseCsvRecords(String(raw ?? '').replace(/^\uFEFF/, ''));
  const headers = records.shift() ?? [];
  return records
    .filter((record) => record.some((value) => String(value).trim() !== ''))
    .map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ''])));
}

function parseCsvRecords(raw) {
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (character === '"') {
      if (quoted && raw[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (character === ',' && !quoted) {
      record.push(field);
      field = '';
      continue;
    }
    if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && raw[index + 1] === '\n') index += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      continue;
    }
    field += character;
  }

  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
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
