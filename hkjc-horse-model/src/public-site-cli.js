#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { buildPublicSite, scanPublicSite } from './public-site-publish.js';
import { verifyPublishedSite } from './public-release-manifest.js';

async function main(argv) {
  const [command, ...rest] = argv;
  const args = parseArgs(rest);
  let report;

  if (command === 'build') {
    const projectRoot = path.resolve(args.projectRoot ?? process.cwd());
    report = await buildPublicSite({
      projectRoot,
      outputRoot: path.resolve(args.output ?? path.join(projectRoot, '.public-site')),
      dashboardPath: path.resolve(args.dashboard ?? path.join(projectRoot, 'data', 'dashboard.json')),
      previousManifest: args.previousManifest
        ? JSON.parse(await readFile(path.resolve(args.previousManifest), 'utf8'))
        : null,
    });
  } else if (command === 'scan') {
    report = await scanPublicSite({
      root: path.resolve(args.root ?? path.join(process.cwd(), '.public-site')),
    });
  } else if (command === 'verify-url') {
    const expectedManifest = JSON.parse(await readFile(path.resolve(args.expectedManifest), 'utf8'));
    report = await verifyPublishedSite({
      baseUrl: args.url,
      expectedManifest,
      retries: Number(args.retries ?? 6),
      retryDelayMs: Number(args.retryDelayMs ?? 5000),
    });
  } else {
    throw new Error('usage: public-site-cli.js <build|scan|verify-url> [--projectRoot path] [--dashboard path] [--output path] [--root path] [--report path]');
  }

  if (args.report) {
    const reportPath = path.resolve(args.report);
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  if (command === 'verify-url') {
    console.log(`Public site online verification ${report.status}: ${report.manifest.dashboardSha256}`);
    return;
  }
  console.log(`Public site privacy scan ${report.status}: ${report.files.length} files, ${report.violations.length} violations`);
  if (report.status !== 'PASS') {
    console.error(JSON.stringify(report.violations, null, 2));
    process.exitCode = 1;
  }
}

function parseArgs(values) {
  const args = {};
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  if (error.report) console.error(JSON.stringify(error.report.violations, null, 2));
  process.exitCode = 1;
});
