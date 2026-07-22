#!/usr/bin/env node
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { backtestRaces, buildDashboardSnapshot, buildRollingPredictionLedger, calibrateConfig } from './model.js';
import { splitDashboardForPublishing } from './dashboard-publish.js';
import { auditRecommendationRuns } from './recommendation-audit.js';
import {
  buildAsOfTrainingRows,
  prepareTrainingMatrix,
  summarizeTrainingRows,
  trainingMatrixFormatFor,
} from './training-dataset.js';
import { writeTrainingMatrixAtomically } from './training-matrix-writer.js';
import {
  buildModelLeaderboard,
  predictionRowsFromLedger,
} from './model-leaderboard.js';
import { buildExternalModelComparison } from './external-model-comparison.js';
import { buildExternalSourceAudit } from './external-source-audit.js';
import { buildExternalSourceCoverage } from './external-source-coverage.js';
import { buildStrategyRiskReport } from './strategy-risk-report.js';
import { buildMarketSnapshotCoverageReport } from './market-snapshot-coverage.js';
import { buildMarketWindowResearchReport } from './market-window-research.js';
import { validateProbabilityArtifact } from './probability-artifact.js';
import {
  buildProspectiveLocks,
  recordProspectiveLock,
  settleProspectiveLocks,
  settleProspectiveLock,
  summarizeProspectiveLocks,
} from './prospective-locks.js';
import {
  DEFAULT_EPROCHASSON_LIVE_ODDS_URL,
  DEFAULT_EPROCHASSON_RACES_URL,
  importExternalLiveOddsToDatabase,
} from './external-live-odds-import.js';
import {
  DEFAULT_LIVE_MARKET_ODDS_TYPES,
  buildLiveMarketSnapshotReport,
  fetchLiveMarketPayload,
  importLiveMarketSnapshotsToDatabase,
  normalizeLiveMarketPayload,
} from './live-market-snapshot.js';
import { runDueLiveMarketSnapshots } from './live-market-due-snapshots.js';
import { DEFAULT_SNAPSHOT_WINDOWS } from './live-snapshot-planner.js';
import { runRaceDayCycle } from './race-day-cycle.js';
import { LOCAL_SCHEDULER_LABEL, renderLaunchAgent } from './local-scheduler.js';
import {
  loadTianxiFormFeatureIndex,
  tianxiRunnerFeatureKey,
} from './tianxi-form-feature-loader.js';
import {
  loadSpeedproFeatureIndex,
  speedproRunnerFeatureKey,
} from './speedpro-feature-importer.js';
import {
  fetchFixtureMeetings,
  fetchMeetingRaceCards,
  fetchMeetingResults,
  normalizeRaceDate,
  parseRaceUrl,
} from './hkjc-parser.js';
import {
  getDatabaseStats,
  loadMarketSnapshotCoverageSummary,
  loadRacesFromDatabase,
  loadLatestMarketSnapshots,
  loadMarketSnapshots,
  loadPoolMoneyFeatures,
  loadProspectiveLocks,
  loadRunnerMarketFeatures,
  loadRecommendationRuns,
  recordOddsSnapshot,
  recordPoolSnapshot,
  recordRecommendationRun,
  syncRaceFilesToDatabase,
} from './sqlite-store.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(dirname, '..');
const rawDataDir = path.join(projectRoot, 'data', 'raw');
const upcomingDataDir = path.join(projectRoot, 'data', 'upcoming');
const processedDataDir = path.join(projectRoot, 'data', 'processed');
const privateDataDir = path.join(projectRoot, 'data', 'private');
const sqliteDbPath = path.join(projectRoot, 'data', 'hkjc.sqlite');

async function main(argv) {
  const [command, ...rest] = argv;
  const args = parseArgs(rest);

  if (!command || command === 'help' || args.help) {
    printHelp();
    return;
  }

  if (command === 'fetch') {
    await fetchCommand(args);
    return;
  }

  if (command === 'fetch-url') {
    await fetchUrlCommand(rest);
    return;
  }

  if (command === 'fetch-racecard') {
    await fetchRaceCardCommand(args);
    return;
  }

  if (command === 'refresh') {
    await refreshCommand(args);
    return;
  }

  if (command === 'auto-run') {
    await autoRunCommand(args);
    return;
  }

  if (command === 'sync-db') {
    await syncDbCommand(args);
    return;
  }

  if (command === 'dashboard-db') {
    await dashboardDbCommand(args);
    return;
  }

  if (command === 'training-dataset') {
    await trainingDatasetCommand(args);
    return;
  }

  if (command === 'training-matrix') {
    await trainingMatrixCommand(args);
    return;
  }

  if (command === 'model-leaderboard') {
    await modelLeaderboardCommand(args);
    return;
  }

  if (command === 'external-model-comparison') {
    await externalModelComparisonCommand(args);
    return;
  }

  if (command === 'external-source-audit') {
    await externalSourceAuditCommand(args);
    return;
  }

  if (command === 'external-source-coverage') {
    await externalSourceCoverageCommand(args);
    return;
  }

  if (command === 'train-model') {
    await trainModelCommand(args);
    return;
  }

  if (command === 'strategy-risk-report') {
    await strategyRiskReportCommand(args);
    return;
  }

  if (command === 'market-snapshot') {
    await marketSnapshotCommand(args);
    return;
  }

  if (command === 'external-live-odds') {
    await externalLiveOddsCommand(args);
    return;
  }

  if (command === 'live-market-snapshot') {
    await liveMarketSnapshotCommand(args);
    return;
  }

  if (command === 'live-market-due-snapshots') {
    await liveMarketDueSnapshotsCommand(args);
    return;
  }

  if (command === 'race-day-cycle') {
    await raceDayCycleCommand(args);
    return;
  }

  if (command === 'local-scheduler') {
    await localSchedulerCommand(args);
    return;
  }

  if (command === 'market-coverage-report') {
    await marketCoverageReportCommand(args);
    return;
  }

  if (command === 'market-window-research') {
    await marketWindowResearchCommand(args);
    return;
  }

  if (command === 'shadow-score') {
    await shadowScoreCommand(args);
    return;
  }

  if (command === 'prospective-lock') {
    await prospectiveLockCommand(args);
    return;
  }

  if (command === 'prospective-settle') {
    await prospectiveSettleCommand(args);
    return;
  }

  if (command === 'recommendation-audit') {
    await recommendationAuditCommand(args);
    return;
  }

  if (command === 'backtest') {
    await backtestCommand(args);
    return;
  }

  if (command === 'calibrate') {
    await calibrateCommand(args);
    return;
  }

  if (command === 'dashboard') {
    await dashboardCommand(args);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

async function syncDbCommand(args) {
  const dbPath = path.resolve(args.db ?? sqliteDbPath);
  const inputPath = path.resolve(args.input ?? rawDataDir);
  const upcomingPath = path.resolve(args.upcoming ?? upcomingDataDir);

  let upcomingSummary = null;
  if (!args.skipUpcoming && existsSync(upcomingPath)) {
    upcomingSummary = syncRaceFilesToDatabase({
      dbPath,
      inputPath: upcomingPath,
      sourceKind: 'upcoming',
    });
  }

  const rawSummary = syncRaceFilesToDatabase({
    dbPath,
    inputPath,
    sourceKind: 'raw',
  });

  const stats = getDatabaseStats(dbPath);
  console.log(`SQLite database synced: ${dbPath}`);
  console.log(`Raw files ${rawSummary.filesSeen}, races ${rawSummary.racesSeen}, runners ${rawSummary.runnersSeen}, dividends ${rawSummary.dividendsSeen}`);
  if (upcomingSummary) {
    console.log(`Upcoming files ${upcomingSummary.filesSeen}, races ${upcomingSummary.racesSeen}, runners ${upcomingSummary.runnersSeen}`);
  }
  console.log(`Database totals: ${stats.races} races (${stats.settledRaces} settled, ${stats.upcomingRaces} upcoming), ${stats.runners} runners, ${stats.dividends} dividends`);
}

async function autoRunCommand(args) {
  await syncDbCommand(args);
  const dashboardOutput = args.output ?? path.join(process.cwd(), 'data', 'dashboard.json');

  if (args.marketInput) {
    const marketInputPath = path.resolve(args.marketInput);
    if (existsSync(marketInputPath)) {
      await marketSnapshotCommand({
        ...args,
        input: marketInputPath,
      });
    } else {
      console.log(`Market snapshot skipped: ${marketInputPath} does not exist`);
    }
  }

  await dashboardDbCommand({
    ...args,
    output: dashboardOutput,
  });

  await prospectiveSettleCommand({
    ...args,
    input: args.prospectiveSettlementInput,
    output: args.prospectiveOutput ?? path.join(privateDataDir, 'latest-prospective-audit.json'),
    allowNoLocks: true,
  });

  await recommendationAuditCommand({
    ...args,
    output: args.auditOutput ?? path.join(privateDataDir, 'latest-recommendation-audit.json'),
  });

  console.log('Auto run complete');
}

async function dashboardDbCommand(args) {
  const dbPath = path.resolve(args.db ?? sqliteDbPath);
  const settledRaces = loadRacesFromDatabase({ dbPath, status: 'settled' });
  const upcomingRaces = loadRacesFromDatabase({ dbPath, status: 'upcoming' });
  const snapshot = buildDashboardSnapshot(settledRaces, {
    minEdge: args.minEdge == null ? 0 : Number(args.minEdge),
    minProbability: args.minProbability == null ? 0.15 : Number(args.minProbability),
    bankroll: args.bankroll == null ? 1000 : Number(args.bankroll),
    maxStakePct: args.maxStakePct == null ? 0.0125 : Number(args.maxStakePct),
    finalEdgeBuffer: args.finalEdgeBuffer == null ? 0.08 : Number(args.finalEdgeBuffer),
    allowProbabilityOnly: args.allowProbabilityOnly !== 'false',
    upcomingRaces,
  });

  snapshot.dataSource = {
    source: 'sqlite',
    database: publicDatabaseLabel(dbPath),
    settledRaces: settledRaces.length,
    upcomingRaces: upcomingRaces.length,
  };

  recordDashboardRecommendationRun({
    dbPath,
    snapshot,
    args,
  });

  const outputPath = path.resolve(args.output ?? path.join(processedDataDir, 'dashboard.json'));
  const historyOutputPath = path.resolve(
    args.privateHistoryOutput ?? args.historyOutput ?? path.join(privateDataDir, 'dashboard-history.json'),
  );
  const { publicSnapshot, historySnapshot } = splitDashboardForPublishing(snapshot, {
    embeddedPerformanceMeetingLimit: args.embeddedPerformanceMeetingLimit,
  });

  await mkdir(path.dirname(outputPath), { recursive: true });
  await mkdir(path.dirname(historyOutputPath), { recursive: true });
  await writeJson(outputPath, publicSnapshot);
  await writeJson(historyOutputPath, historySnapshot);

  console.log(`Dashboard snapshot from SQLite: ${snapshot.summary.racesSettled} settled races`);
  console.log(`Upcoming forecasts: ${snapshot.upcomingEntries.length}`);
  console.log(`Saved dashboard data to ${outputPath}`);
  console.log(`Saved dashboard history to ${historyOutputPath}`);
}

async function trainingDatasetCommand(args) {
  const dbPath = path.resolve(args.db ?? sqliteDbPath);
  const settledRaces = loadRacesFromDatabase({ dbPath, status: 'settled' });
  const marketFeatures = loadRunnerMarketFeatures({ dbPath });
  const poolMoneyFeatures = loadPoolMoneyFeatures({ dbPath, races: settledRaces });
  const tianxiFeatures = args.tianxiRoot
    ? await loadTianxiFormFeatureIndex({
      rootPath: path.resolve(args.tianxiRoot),
      races: settledRaces,
      availabilityLagDays: args.tianxiLagDays == null ? 1 : Number(args.tianxiLagDays),
    })
    : null;
  const speedproFeatures = args.speedproRoot
    ? await loadSpeedproFeatureIndex({
      rootPath: path.resolve(args.speedproRoot),
      races: settledRaces,
    })
    : null;
  const rows = buildAsOfTrainingRows(settledRaces, {
    marketFeaturesForRunner: ({ race, runner }) => (
      {
        ...(marketFeatures.featuresByRunner.get(`${race.raceId}|${runner.horseNo}`) ?? {}),
        ...(poolMoneyFeatures.featuresByRunner.get(`${race.raceId}|${runner.horseNo}`) ?? {}),
      }
    ),
    externalFeaturesForRunner: tianxiFeatures || speedproFeatures
      ? ({ race, runner }) => ({
        ...(tianxiFeatures?.featuresByRunner.get(tianxiRunnerFeatureKey(race, runner)) ?? {}),
        ...(speedproFeatures?.featuresByRunner.get(speedproRunnerFeatureKey(race, runner)) ?? {}),
      })
      : undefined,
  });
  const summary = summarizeTrainingRows(rows);
  const outputPath = path.resolve(args.output ?? path.join(processedDataDir, 'training-dataset.json'));

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeJson(outputPath, {
    generatedAt: summary.generatedAt,
    dataSource: {
      source: 'sqlite',
      database: publicDatabaseLabel(dbPath),
      settledRaces: settledRaces.length,
    },
    marketFeatures: marketFeatures.summary,
    poolMoneyFeatures: poolMoneyFeatures.summary,
    ...(tianxiFeatures || speedproFeatures ? {
      externalFeatures: {
        ...(tianxiFeatures ? { tianxi: tianxiFeatures.summary } : {}),
        ...(speedproFeatures ? { speedpro: speedproFeatures.summary } : {}),
      },
    } : {}),
    summary,
    rows,
  });

  console.log(`Training dataset from SQLite: ${summary.rows} runner rows, ${summary.races} races`);
  console.log(`Pool money coverage: ${poolMoneyFeatures.summary.racesWithAnyPoolMoney}/${poolMoneyFeatures.summary.races} races`);
  if (tianxiFeatures) {
    console.log(`Tianxi form coverage: ${tianxiFeatures.summary.availableFeatureRows}/${tianxiFeatures.summary.requestedRunnerRows} runner rows`);
  }
  if (speedproFeatures) {
    console.log(`SpeedPRO coverage: ${speedproFeatures.summary.availableFeatureRows}/${speedproFeatures.summary.requestedRunnerRows} runner rows`);
  }
  console.log(`Saved training dataset to ${outputPath}`);
}

async function trainingMatrixCommand(args) {
  const inputPath = path.resolve(args.input ?? path.join(processedDataDir, 'training-dataset.json'));
  const outputPath = path.resolve(args.output ?? path.join(processedDataDir, 'training-matrix.jsonl'));
  const format = trainingMatrixFormatFor({ format: args.format, output: outputPath });
  const payload = JSON.parse(await readFile(inputPath, 'utf8'));
  const matrix = prepareTrainingMatrix(payload);

  await writeTrainingMatrixAtomically({ outputPath, format, matrix });

  console.log(`Training matrix: ${matrix.sourceRows.length} runner rows, ${matrix.columns.length} columns (${format})`);
  console.log(`Saved training matrix to ${outputPath}`);
}

async function modelLeaderboardCommand(args) {
  const dbPath = path.resolve(args.db ?? sqliteDbPath);
  const settledRaces = loadRacesFromDatabase({ dbPath, status: 'settled' });
  const ledger = buildRollingPredictionLedger(settledRaces, {
    minEdge: args.minEdge == null ? 0 : Number(args.minEdge),
    minProbability: args.minProbability == null ? 0.15 : Number(args.minProbability),
  });
  const predictionRows = predictionRowsFromLedger(ledger.entries);
  const leaderboard = buildModelLeaderboard([
    {
      modelId: 'heuristic-current',
      label: 'Current heuristic rolling model',
      rows: predictionRows,
    },
  ]);
  const outputPath = path.resolve(args.output ?? path.join(processedDataDir, 'model-leaderboard.json'));

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeJson(outputPath, {
    ...leaderboard,
    dataSource: {
      source: 'sqlite',
      database: publicDatabaseLabel(dbPath),
      settledRaces: settledRaces.length,
    },
  });

  console.log(`Model leaderboard from SQLite: ${settledRaces.length} settled races`);
  console.log(`Saved model leaderboard to ${outputPath}`);
}

async function externalModelComparisonCommand(args) {
  const dbPath = path.resolve(args.db ?? sqliteDbPath);
  const settledRaces = loadRacesFromDatabase({ dbPath, status: 'settled' });
  let upcomingRaces = loadRacesFromDatabase({ dbPath, status: 'upcoming' });
  if (args.date) {
    const date = normalizeRaceDate(args.date);
    upcomingRaces = upcomingRaces.filter((race) => race.date === date);
  }
  if (args.venue ?? args.course ?? args.racecourse) {
    const venue = String(args.venue ?? args.course ?? args.racecourse).toUpperCase();
    upcomingRaces = upcomingRaces.filter((race) => String(race.racecourse).toUpperCase() === venue);
  }
  if (args.race ?? args.races ?? args.raceNo) {
    const raceNos = new Set(parseRaceRange(args.race ?? args.races ?? args.raceNo));
    upcomingRaces = upcomingRaces.filter((race) => raceNos.has(Number(race.raceNo)));
  }

  const trainingReportPath = path.resolve(
    args.trainingReport
    ?? args.modelReport
    ?? path.join(processedDataDir, 'model-training-report.json'),
  );
  let trainingReport = null;
  if (existsSync(trainingReportPath)) {
    trainingReport = JSON.parse(await readFile(trainingReportPath, 'utf8'));
  }
  const marketOddsByRunner = loadLatestWinOddsByRunner({ dbPath, races: upcomingRaces });
  const marketAwareBundlesByRace = await loadShadowBundlesByRace(args);

  const report = buildExternalModelComparison({
    settledRaces,
    upcomingRaces,
    trainingReport,
    marketOddsByRunner,
    marketAwareBundlesByRace,
    options: {
      minEdge: args.minEdge == null ? 0 : Number(args.minEdge),
      minProbability: args.minProbability == null ? 0.15 : Number(args.minProbability),
      bankroll: args.bankroll == null ? 200 : Number(args.bankroll),
      maxStakePct: args.maxStakePct == null ? 0.05 : Number(args.maxStakePct),
      finalEdgeBuffer: args.finalEdgeBuffer == null ? 0.08 : Number(args.finalEdgeBuffer),
    },
  });
  const outputPath = path.resolve(args.output ?? path.join(processedDataDir, 'external-model-comparison.json'));

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeJson(outputPath, {
    ...report,
    dataSource: {
      source: 'sqlite',
      database: publicDatabaseLabel(dbPath),
      settledRaces: settledRaces.length,
      upcomingRaces: upcomingRaces.length,
      trainingReport: existsSync(trainingReportPath) ? publicInputLabel(trainingReportPath) : null,
    },
  });

  console.log(`External model comparison: ${report.summary.upcomingRaces} upcoming races, ${report.summary.modelCount} model views`);
  console.log(`Market-aware ready races: ${report.summary.marketAwareReadyRaces}/${report.summary.upcomingRaces}`);
  console.log(`Saved external model comparison to ${outputPath}`);
}

async function loadShadowBundlesByRace(args) {
  const bundlePathArg = args.marketAwareBundle ?? args.shadowBundle;
  if (!bundlePathArg) {
    return new Map();
  }

  const bundlePath = path.resolve(bundlePathArg);
  const bundle = JSON.parse(await readFile(bundlePath, 'utf8'));
  const raceIds = [...new Set((bundle.predictions ?? []).map((prediction) => prediction?.raceId).filter(Boolean))];
  if (raceIds.length !== 1) {
    throw new Error('marketAwareBundle must contain predictions for exactly one raceId');
  }
  return new Map([[raceIds[0], bundle]]);
}

function loadLatestWinOddsByRunner({ dbPath, races }) {
  const byRunner = new Map();
  for (const race of races) {
    const latest = loadLatestMarketSnapshots({ dbPath, raceId: race.raceId });
    for (const snapshot of latest.odds ?? []) {
      if (snapshot.poolKey !== 'win') continue;
      const horseNo = Number(snapshot.combination?.[0]);
      const winOdds = Number(snapshot.oddsValue);
      if (!Number.isInteger(horseNo) || !Number.isFinite(winOdds) || winOdds <= 1) continue;
      byRunner.set(`${race.raceId}|${horseNo}`, {
        winOdds,
        capturedAt: snapshot.capturedAt,
        minutesToPost: snapshot.minutesToPost,
        source: snapshot.source,
      });
    }
  }
  return byRunner;
}

async function trainModelCommand(args) {
  const inputPath = path.resolve(args.input ?? path.join(processedDataDir, 'training-dataset.json'));
  const outputPath = path.resolve(args.output ?? path.join(processedDataDir, 'model-training-report.json'));
  const scriptPath = path.join(projectRoot, 'python', 'train_logit_model.py');
  const python = process.env.PYTHON ?? 'python3';
  const result = spawnSync(python, [
    scriptPath,
    '--input',
    inputPath,
    '--output',
    outputPath,
    '--iterations',
    String(args.iterations ?? 160),
    '--learningRate',
    String(args.learningRate ?? 0.05),
    '--l2',
    String(args.l2 ?? 0.001),
  ], {
    encoding: 'utf8',
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`train-model failed with exit code ${result.status}`);
  }
}

async function strategyRiskReportCommand(args) {
  const dbPath = path.resolve(args.db ?? sqliteDbPath);
  const settledRaces = loadRacesFromDatabase({ dbPath, status: 'settled' });
  const ledger = buildRollingPredictionLedger(settledRaces, {
    minEdge: args.minEdge == null ? 0 : Number(args.minEdge),
    minProbability: args.minProbability == null ? 0.15 : Number(args.minProbability),
    bankroll: args.bankroll == null ? 1000 : Number(args.bankroll),
    maxStakePct: args.maxStakePct == null ? 0.0125 : Number(args.maxStakePct),
    finalEdgeBuffer: args.finalEdgeBuffer == null ? 0.08 : Number(args.finalEdgeBuffer),
    allowProbabilityOnly: args.allowProbabilityOnly !== 'false',
  });
  const report = buildStrategyRiskReport(ledger.entries, {
    maxTimelineRows: args.maxTimelineRows == null ? 200 : Number(args.maxTimelineRows),
  });
  const outputPath = path.resolve(args.output ?? path.join(processedDataDir, 'strategy-risk-report.json'));

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeJson(outputPath, {
    ...report,
    dataSource: {
      source: 'sqlite',
      database: publicDatabaseLabel(dbPath),
      settledRaces: settledRaces.length,
    },
    modelOptions: {
      minEdge: args.minEdge == null ? 0 : Number(args.minEdge),
      minProbability: args.minProbability == null ? 0.15 : Number(args.minProbability),
      bankroll: args.bankroll == null ? 1000 : Number(args.bankroll),
      maxStakePct: args.maxStakePct == null ? 0.0125 : Number(args.maxStakePct),
      finalEdgeBuffer: args.finalEdgeBuffer == null ? 0.08 : Number(args.finalEdgeBuffer),
      allowProbabilityOnly: args.allowProbabilityOnly !== 'false',
    },
  });

  console.log(`Strategy risk report from SQLite: ${report.summary.activeRaces}/${report.summary.races} active races`);
  console.log(`Known strategy profit ${formatSigned(report.summary.knownProfit)}, ROI ${percent(report.summary.knownRoi)}, max drawdown ${money(report.summary.maxDrawdown)}`);
  console.log(`Saved strategy risk report to ${outputPath}`);
}

async function shadowScoreCommand(args) {
  const inputPath = path.resolve(requiredArg(args.input, 'input'));
  const modelPath = path.resolve(requiredArg(args.model, 'model'));
  const reportPath = path.resolve(requiredArg(args.report, 'report'));
  const featureManifestPath = path.resolve(
    requiredArg(args.featureManifest ?? args['feature-manifest'], 'featureManifest'),
  );
  const generatedAt = requiredArg(args.generatedAt ?? args['generated-at'], 'generatedAt');
  const outputPath = path.resolve(args.output ?? path.join(processedDataDir, 'shadow-score.json'));
  const inputRows = await loadShadowScoreRows(inputPath);
  const raceIds = [...new Set(inputRows.map((row) => row.raceId))];
  if (raceIds.length !== 1) {
    throw new Error('shadow-score input must contain exactly one raceId');
  }
  const postTimes = [...new Set(inputRows.map((row) => row.postAt))];
  if (postTimes.length !== 1) {
    throw new Error('shadow-score input must contain exactly one postAt');
  }

  const python = process.env.PYTHON ?? 'python3';
  const scriptPath = path.join(projectRoot, 'python', 'score_market_aware_candidate.py');
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-shadow-score-'));
  const rawOutputPath = path.join(tempDir, 'raw-shadow-score.json');

  try {
    const result = spawnSync(python, [
      scriptPath,
      '--input',
      inputPath,
      '--model',
      modelPath,
      '--report',
      reportPath,
      '--feature-manifest',
      featureManifestPath,
      '--generated-at',
      generatedAt,
      '--output',
      rawOutputPath,
    ], {
      encoding: 'utf8',
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`shadow-score failed with exit code ${result.status}`);
    }

    const rawBundle = JSON.parse(await readFile(rawOutputPath, 'utf8'));
    const bundle = validateProbabilityArtifact(rawBundle, {
      raceId: raceIds[0],
      postAt: postTimes[0],
    });
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeJson(outputPath, bundle);
    console.log(`Shadow score bundle: ${bundle.predictions.length} runners`);
    console.log(`Saved shadow score bundle to ${outputPath}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function prospectiveLockCommand(args) {
  const inputPath = path.resolve(requiredArg(args.input, 'input'));
  const dbPath = path.resolve(args.db ?? sqliteDbPath);
  const outputPath = path.resolve(
    args.output ?? path.join(privateDataDir, 'latest-prospective-lock.json'),
  );
  const payload = JSON.parse(await readFile(inputPath, 'utf8'));
  const locks = buildProspectiveLocks({
    race: payload.race,
    scoreBundles: payload.scoreBundles ?? payload.scoreBundle,
    marketSnapshots: payload.marketSnapshots,
    decisions: payload.decisions,
    generatedAt: args.generatedAt ?? payload.generatedAt,
  });
  const recorded = locks.map((lock) => recordProspectiveLock({ dbPath, lock }));
  const ledgers = summarizeProspectiveLocks(loadProspectiveLocks({ dbPath }));
  const report = {
    generatedAt: new Date().toISOString(),
    executionStatus: 'PAPER_ONLY',
    database: publicDatabaseLabel(dbPath),
    input: publicInputLabel(inputPath),
    recorded: recorded.length,
    locks: recorded,
    ledgers,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeJson(outputPath, report);
  console.log(`Prospective locks recorded: ${recorded.length}`);
  console.log(`Saved prospective lock report to ${outputPath}`);
}

async function prospectiveSettleCommand(args) {
  const dbPath = path.resolve(args.db ?? sqliteDbPath);
  const outputPath = path.resolve(
    args.output ?? path.join(privateDataDir, 'latest-prospective-audit.json'),
  );
  const raceId = args.raceId ?? args.race ?? null;
  const openLocks = loadProspectiveLocks({ dbPath, raceId, status: 'OPEN' });
  const races = args.input
    ? normalizeRacePayload(JSON.parse(await readFile(path.resolve(args.input), 'utf8')))
    : loadRacesFromDatabase({ dbPath, status: 'settled' });
  const raceById = new Map(races.map((race) => [race.raceId, race]));
  const settledAt = args.settledAt ?? new Date().toISOString();
  let settledCount = 0;
  let voidCount = 0;
  const unresolvedRaceIds = new Set();

  for (const [lockRaceId, raceLocks] of groupBy(openLocks, (lock) => lock.raceId)) {
    const race = raceById.get(lockRaceId);
    if (!race) {
      unresolvedRaceIds.add(lockRaceId);
      continue;
    }
    const marketSnapshots = loadMarketSnapshots({ dbPath, raceId: lockRaceId }).odds;
    const settlement = settleProspectiveLocks({ locks: raceLocks, race, marketSnapshots });
    for (const line of settlement.lines) {
      const state = line.status === 'VOID' ? 'VOID' : 'SETTLED';
      settleProspectiveLock({
        dbPath,
        lockId: line.lockId,
        settlement: {
          status: state,
          outcome: line.status,
          settledAt,
          stake: line.stake,
          dividendPer10: line.dividendPer10,
          returned: line.returned,
          profit: line.profit,
          closingDividendPer10: line.closingDividendPer10 ?? null,
          indicativeClv: line.indicativeClv ?? null,
          priceSlippageToT3: line.priceSlippageToT3 ?? null,
          officialDividendChangeFromLock: line.officialDividendChangeFromLock ?? null,
        },
      });
      if (state === 'VOID') voidCount += 1;
      else settledCount += 1;
    }
  }

  const locks = loadProspectiveLocks({ dbPath, raceId });
  const report = {
    generatedAt: new Date().toISOString(),
    executionStatus: 'NO_BET',
    database: publicDatabaseLabel(dbPath),
    summary: {
      openBefore: openLocks.length,
      settled: settledCount,
      void: voidCount,
      unresolvedRaceIds: [...unresolvedRaceIds].sort(),
    },
    ledgers: summarizeProspectiveLocks(locks),
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeJson(outputPath, report);
  console.log(`Prospective locks settled: ${settledCount}, void: ${voidCount}, still open: ${report.ledgers.shadow.open}`);
  console.log(`Saved prospective audit to ${outputPath}`);
}

function recordDashboardRecommendationRun({ dbPath, snapshot, args }) {
  const forecast = snapshot.latestUpcomingForecast?.raceId
    ? snapshot.latestUpcomingForecast
    : snapshot.latestForecast;
  if (!forecast?.raceId) return null;

  return recordRecommendationRun({
    dbPath,
    run: {
      raceId: forecast.raceId,
      raceNo: forecast.raceNo,
      date: forecast.date,
      racecourse: forecast.racecourse,
      generatedAt: snapshot.generatedAt,
      modelVersion: 'hkjc-local-horse-model',
      strategyVersion: forecast.finalBetPlan?.strategyVersion ?? 'ev-portfolio-v1',
      bankroll: args.bankroll == null ? 1000 : Number(args.bankroll),
      finalEdgeBuffer: args.finalEdgeBuffer == null ? 0.08 : Number(args.finalEdgeBuffer),
      recommendations: extractRecommendationLines(forecast),
      summary: {
        status: forecast.status,
        mode: forecast.finalBetPlan?.mode ?? forecast.recommendation?.action ?? 'unknown',
        topPickHorseNo: forecast.topPick?.horseNo ?? null,
        topPickHorseName: forecast.topPick?.horseName ?? null,
        upcomingEntries: snapshot.upcomingEntries?.length ?? 0,
      },
    },
  });
}

function extractRecommendationLines(forecast) {
  if (Array.isArray(forecast.finalBetPlan?.cashLines)) return forecast.finalBetPlan.cashLines;
  if (forecast.finalBetPlan) return [forecast.finalBetPlan];
  if (forecast.recommendation) return [forecast.recommendation];
  return [];
}

async function marketSnapshotCommand(args) {
  const dbPath = path.resolve(args.db ?? sqliteDbPath);
  const inputPath = path.resolve(args.input ?? path.join(projectRoot, 'data', 'market-snapshot.json'));
  const payload = JSON.parse(await readFile(inputPath, 'utf8'));
  const oddsSnapshots = normalizeMarketSnapshotItems(payload, ['odds', 'oddsSnapshots']);
  const poolSnapshots = normalizeMarketSnapshotItems(payload, ['pools', 'poolSnapshots']);

  for (const snapshot of oddsSnapshots) {
    recordOddsSnapshot({ dbPath, snapshot });
  }
  for (const snapshot of poolSnapshots) {
    recordPoolSnapshot({ dbPath, snapshot });
  }

  const stats = getDatabaseStats(dbPath);
  console.log(`Market snapshots imported: ${oddsSnapshots.length} odds, ${poolSnapshots.length} pools`);
  console.log(`Database market totals: ${stats.oddsSnapshots} odds snapshots, ${stats.poolSnapshots} pool snapshots`);
}

async function externalLiveOddsCommand(args) {
  const dbPath = path.resolve(args.db ?? sqliteDbPath);
  const racesPath = args.races ?? args.racesPath ?? DEFAULT_EPROCHASSON_RACES_URL;
  const liveOddsPath = args.liveOdds ?? args.liveOddsPath ?? DEFAULT_EPROCHASSON_LIVE_ODDS_URL;
  const source = args.source ?? 'eprochasson/horserace_data';

  const result = await importExternalLiveOddsToDatabase({
    dbPath,
    racesPath,
    liveOddsPath,
    source,
    limit: args.limit,
  });
  const stats = getDatabaseStats(dbPath);

  if (args.output) {
    const outputPath = path.resolve(args.output);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeJson(outputPath, {
      generatedAt: new Date().toISOString(),
      dataSource: {
        source,
        races: publicInputLabel(racesPath),
        liveOdds: publicInputLabel(liveOddsPath),
        database: publicDatabaseLabel(dbPath),
      },
      summary: result.summary,
      databaseTotals: {
        oddsSnapshots: stats.oddsSnapshots,
        poolSnapshots: stats.poolSnapshots,
      },
      notes: [
        'External eprochasson capture_time is treated as UTC; Hong Kong race_time is converted to UTC for minutes_to_post.',
        'Raw external CSV files are for local research only and should not be committed unless licensing is clarified.',
      ],
    });
  }

  console.log(`External live odds imported: ${result.summary.oddsSnapshots} odds snapshots`);
  console.log(`Rows: ${result.summary.rowsMatched}/${result.summary.rowsSeen} matched, ${result.summary.rowsSkippedNoRace} no race time, ${result.summary.rowsSkippedBadData} bad/no odds`);
  console.log(`Pools: ${Object.entries(result.summary.pools).map(([pool, count]) => `${pool} ${count}`).join(', ') || 'none'}`);
  console.log(`Database market totals: ${stats.oddsSnapshots} odds snapshots, ${stats.poolSnapshots} pool snapshots`);
}

async function liveMarketSnapshotCommand(args) {
  const dbPath = path.resolve(args.db ?? sqliteDbPath);
  const date = normalizeRaceDate(args.date);
  const venueCode = String(args.venue ?? args.course ?? args.venueCode ?? '').toUpperCase();
  const raceNos = parseRaceRange(args.race ?? args.races ?? args.raceNo ?? '1');
  const oddsTypes = parseStringList(args.pools ?? args.oddsTypes ?? DEFAULT_LIVE_MARKET_ODDS_TYPES.join(','));
  const source = args.source ?? 'hkjc-live-graphql';
  const capturedAt = args.capturedAt ?? new Date().toISOString();
  let payload;
  let sourceResults = [];

  if (args.input) {
    const inputPath = path.resolve(args.input);
    payload = JSON.parse(await readFile(inputPath, 'utf8'));
    sourceResults.push({
      label: 'input',
      ok: true,
      input: publicInputLabel(inputPath),
    });
  } else {
    if (!date || !venueCode) {
      throw new Error('live-market-snapshot requires --date and --venue when --input is not provided');
    }
    const fetched = await fetchLiveMarketPayload({
      date,
      venueCode,
      raceNos,
      oddsTypes,
      endpoint: args.endpoint,
      requestTimeoutMs: args.requestTimeoutMs ?? 15000,
    });
    payload = fetched.payload;
    sourceResults = fetched.sourceResults;
  }

  const normalized = normalizeLiveMarketPayload({
    payload,
    source,
    capturedAt,
    date,
    venueCode,
    raceNo: raceNos.join(','),
  });

  if (!args.dryRun) {
    importLiveMarketSnapshotsToDatabase({
      dbPath,
      oddsSnapshots: normalized.oddsSnapshots,
      poolSnapshots: normalized.poolSnapshots,
    });
  }

  const report = buildLiveMarketSnapshotReport({
    ...normalized,
    sourceResults,
    dryRun: Boolean(args.dryRun),
    database: publicDatabaseLabel(dbPath),
  });
  const stats = args.dryRun ? null : getDatabaseStats(dbPath);

  if (args.output) {
    const outputPath = path.resolve(args.output);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeJson(outputPath, {
      ...report,
      databaseTotals: stats ? {
        oddsSnapshots: stats.oddsSnapshots,
        poolSnapshots: stats.poolSnapshots,
      } : null,
      notes: [
        'HKJC GraphQL calls must use whitelisted query shapes; arbitrary combined queries may return WHITELIST_ERROR.',
        'Odds types are requested in small batches so live odds and pool investment calls stay stable.',
      ],
    });
  }

  const verb = args.dryRun ? 'normalized' : 'imported';
  console.log(`Live market snapshots ${verb}: ${normalized.oddsSnapshots.length} odds, ${normalized.poolSnapshots.length} pools`);
  console.log(`Races: ${normalized.summary.races.join(', ') || 'none'}`);
  console.log(`Pools: ${Object.entries(normalized.summary.pools).map(([pool, count]) => `${pool} ${count}`).join(', ') || 'none'}`);
  if (stats) {
    console.log(`Database market totals: ${stats.oddsSnapshots} odds snapshots, ${stats.poolSnapshots} pool snapshots`);
  }
}

async function liveMarketDueSnapshotsCommand(args) {
  const dbPath = path.resolve(args.db ?? sqliteDbPath);
  const requestedLabels = new Set(parseStringList(args.windows ?? 'T-30,T-10,T-3'));
  const windows = DEFAULT_SNAPSHOT_WINDOWS.filter((window) => requestedLabels.has(window.label));
  if (windows.length === 0) throw new Error('live-market-due-snapshots requires at least one valid --windows label');
  const pools = parseStringList(args.pools ?? DEFAULT_LIVE_MARKET_ODDS_TYPES.join(','));
  const report = await runDueLiveMarketSnapshots({
    dbPath,
    windows,
    pools,
    dryRun: Boolean(args.dryRun),
    now: args.now ?? new Date(),
  });
  const outputPath = path.resolve(args.output ?? path.join(processedDataDir, 'live-market-source-report.json'));
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeJson(outputPath, {
    ...report,
    dataSource: { source: 'sqlite', database: publicDatabaseLabel(dbPath) },
    windows: windows.map((window) => window.label),
    pools,
  });
  console.log(`Due live market snapshots: ${report.summary.due} due, ${report.summary.captured} captured, ${report.summary.skippedDuplicates} duplicate windows skipped`);
  console.log(`Imported: ${report.summary.oddsSnapshots} odds, ${report.summary.poolSnapshots} pools`);
  console.log(report.summaryZh);
  console.log(`Saved due snapshot report to ${outputPath}`);
}

async function raceDayCycleCommand(args) {
  const dbPath = path.resolve(args.db ?? sqliteDbPath);
  const requestedLabels = new Set(parseStringList(args.windows ?? 'T-30,T-10,T-3'));
  const windows = DEFAULT_SNAPSHOT_WINDOWS.filter((window) => requestedLabels.has(window.label));
  if (windows.length === 0) throw new Error('race-day-cycle requires at least one valid --windows label');
  const pools = parseStringList(args.pools ?? DEFAULT_LIVE_MARKET_ODDS_TYPES.join(','));
  const report = await runRaceDayCycle({
    dbPath,
    windows,
    pools,
    dryRun: Boolean(args.dryRun),
    maxRetries: args.maxRetries == null ? 2 : Number(args.maxRetries),
    now: args.now ?? new Date(),
  });
  const outputPath = path.resolve(
    args.output ?? path.join(privateDataDir, 'latest-race-day-cycle.json'),
  );
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeJson(outputPath, {
    ...report,
    dataSource: { source: 'sqlite', database: publicDatabaseLabel(dbPath) },
    windows: windows.map((window) => window.label),
    pools,
  });
  console.log(report.summaryZh);
  console.log(`Saved race-day cycle report to ${outputPath}`);
}

async function localSchedulerCommand(args) {
  if (args.install && args.dryRun) {
    throw new Error('local-scheduler accepts either --dryRun or --install, not both');
  }
  const projectPath = path.resolve(args.projectPath ?? process.cwd());
  const dbPath = path.resolve(args.db ?? sqliteDbPath);
  const logDirectory = path.resolve(
    args.logDirectory ?? path.join(privateDataDir, 'logs'),
  );
  const outputPath = path.resolve(
    args.output ?? path.join(privateDataDir, `${LOCAL_SCHEDULER_LABEL}.plist`),
  );
  const plist = renderLaunchAgent({
    projectPath,
    dbPath,
    logDirectory,
    intervalMinutes: args.intervalMinutes == null ? 10 : Number(args.intervalMinutes),
    label: args.label ?? LOCAL_SCHEDULER_LABEL,
  });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await mkdir(logDirectory, { recursive: true });
  await writeFile(outputPath, plist, 'utf8');

  if (!args.install) {
    console.log(`LaunchAgent review file saved: ${outputPath}`);
    console.log('状态：未安装、未启用；请先检查 plist，需要时再显式执行 --install。');
    return;
  }

  const launchAgentsDirectory = path.join(os.homedir(), 'Library', 'LaunchAgents');
  const installPath = path.join(launchAgentsDirectory, `${args.label ?? LOCAL_SCHEDULER_LABEL}.plist`);
  await mkdir(launchAgentsDirectory, { recursive: true });
  if (outputPath !== installPath) await copyFile(outputPath, installPath);
  console.log(`LaunchAgent installed but remains disabled: ${installPath}`);
  console.log('安装文件仍为禁用状态；启用、卸载和日志操作请按运维文档人工执行。');
}

async function marketCoverageReportCommand(args) {
  const dbPath = path.resolve(args.db ?? sqliteDbPath);
  const report = loadMarketSnapshotCoverageSummary({ dbPath });
  const outputPath = path.resolve(args.output ?? path.join(processedDataDir, 'market-snapshot-coverage.json'));

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeJson(outputPath, {
    ...report,
    dataSource: {
      source: 'sqlite',
      database: publicDatabaseLabel(dbPath),
      races: report.summary.races,
    },
  });

  console.log(`Market coverage report: ${report.summary.readiness}`);
  console.log(`Odds coverage ${percent(report.summary.oddsRaceCoverage)}, pool coverage ${percent(report.summary.poolRaceCoverage)}`);
  console.log(`Saved market snapshot coverage to ${outputPath}`);
}

async function externalSourceAuditCommand(args) {
  const outputPath = path.resolve(args.output ?? path.join(processedDataDir, 'external-source-audit.json'));
  const report = buildExternalSourceAudit({ generatedAt: args.generatedAt ?? new Date().toISOString() });

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeJson(outputPath, report);

  console.log(`External source audit: ${report.summary.sources} sources, ${report.summary.localOnlySources} local-only`);
  console.log(`License status: ${Object.entries(report.summary.byLicenseStatus).map(([key, value]) => `${key}=${value}`).join(', ')}`);
  console.log(`Saved external source audit to ${outputPath}`);
}

async function externalSourceCoverageCommand(args) {
  const cacheRoot = path.resolve(args.cacheRoot
    ?? process.env.HKJC_EXTERNAL_SOURCE_CACHE
    ?? path.join(projectRoot, 'data', 'external', 'raw-local'));
  const outputPath = path.resolve(args.output ?? path.join(processedDataDir, 'external-source-coverage.json'));
  const report = await buildExternalSourceCoverage({
    sources: [
      {
        sourceId: 'sleepingarhat-tianxi-database',
        rootPath: path.join(cacheRoot, 'tianxi-database'),
      },
      {
        sourceId: 'mag-dot-race-data',
        rootPath: path.join(cacheRoot, 'mag-dot-race-data'),
      },
    ],
    generatedAt: args.generatedAt ?? new Date().toISOString(),
  });

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeJson(outputPath, report);

  console.log(`External source coverage: ${report.summary.availableSources}/${report.summary.requestedSources} sources available`);
  console.log(`Files: ${report.summary.totalFiles} total, ${report.summary.preRaceCandidateFiles} pre-race candidates, ${report.summary.postRaceFiles} post-race only`);
  console.log(`Saved external source coverage to ${outputPath}`);
}

async function marketWindowResearchCommand(args) {
  const dbPath = path.resolve(args.db ?? sqliteDbPath);
  const races = loadRacesFromDatabase({ dbPath, status: 'settled' });
  const marketFeatures = loadRunnerMarketFeatures({ dbPath });
  const oddsCaps = parseNumberList(args.oddsCaps ?? '3,5,7.5,10,20');
  const report = buildMarketWindowResearchReport({
    races,
    featuresByRunner: marketFeatures.featuresByRunner,
    oddsCaps,
    stake: args.stake == null ? 10 : Number(args.stake),
  });
  const outputPath = path.resolve(args.output ?? path.join(processedDataDir, 'market-window-research.json'));

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeJson(outputPath, {
    ...report,
    dataSource: {
      source: 'sqlite',
      database: publicDatabaseLabel(dbPath),
      settledRaces: races.length,
      marketFeatureRows: marketFeatures.summary.runnerFeatureRows,
    },
  });

  console.log(`Market window research: ${report.summary.racesWithT30WinOdds}/${report.summary.races} races with T-30 WIN odds`);
  console.log(`T-30 favourite ROI ${percent(report.strategies.t30MarketFavourite.roi ?? 0)}, odds<=7.5 ROI ${percent(report.byMaxOdds['7.5']?.roi ?? 0)}`);
  console.log(`Saved market window research to ${outputPath}`);
}

async function recommendationAuditCommand(args) {
  const dbPath = path.resolve(args.db ?? sqliteDbPath);
  const races = loadRacesFromDatabase({ dbPath, status: 'settled' });
  const runs = loadRecommendationRuns({ dbPath });
  const recommendationRaceIds = [...new Set(runs.map((run) => run.raceId).filter(Boolean))];
  const marketSnapshots = recommendationRaceIds.flatMap((raceId) => (
    loadMarketSnapshots({ dbPath, raceId }).odds
  ));
  const prospectiveLedgers = summarizeProspectiveLocks(loadProspectiveLocks({ dbPath }));
  const report = auditRecommendationRuns({
    runs,
    races,
    marketSnapshots,
    prospectiveLedgers,
  });
  const outputPath = path.resolve(args.output ?? path.join(processedDataDir, 'latest-recommendation-audit.json'));

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeJson(outputPath, report);

  console.log(`Saved recommendation audit to ${outputPath}`);
  console.log(`Recommendation audit: ${report.summary.eligibleRuns}/${report.summary.recordedRuns} final pre-race runs eligible, ${report.summary.settledRuns} settled, ${report.summary.excludedRuns} excluded`);
  console.log(`Stake ${money(report.summary.totalStake)}, return ${money(report.summary.totalReturn)}, profit ${formatSigned(report.summary.profit)}, ROI ${report.summary.roi == null ? 'n/a' : percent(report.summary.roi)}`);
  console.log(`Indicative CLV lines ${report.summary.clvLines}, average ${report.summary.averageIndicativeClv == null ? 'n/a' : percent(report.summary.averageIndicativeClv)}; paper ROI ${report.summary.paperRoi == null ? 'n/a' : percent(report.summary.paperRoi)}`);
  console.log(`Immutable shadow locks ${report.ledgers.shadow.settled}/${report.ledgers.shadow.locks} settled; paper ROI ${report.ledgers.paper.roi == null ? 'n/a' : percent(report.ledgers.paper.roi)}; cash ${report.ledgers.cash.executionStatus}`);
  console.log(`Lines: ${report.summary.hitLines} hit, ${report.summary.missLines} miss, ${report.summary.passLines} pass`);
}

async function fetchCommand(args) {
  const date = normalizeRaceDate(args.date);
  const racecourse = String(args.course ?? args.racecourse ?? '').toUpperCase();
  const races = parseRaceRange(args.races ?? args.race ?? '1-11');

  if (!date || !racecourse || races.length === 0) {
    throw new Error('fetch requires --date, --course, and --races');
  }

  const result = await fetchMeetingResults({
    date,
    racecourse,
    races,
    continueOnError: args.strict !== 'true',
  });

  await mkdir(rawDataDir, { recursive: true });
  const outputPath = path.join(rawDataDir, `${date}-${racecourse}.json`);
  await writeJson(outputPath, result.races);

  console.log(`Saved ${result.races.length} HKJC local races to ${outputPath}`);
  if (result.errors.length > 0) {
    console.log(`Skipped ${result.errors.length} races without parsable official results`);
    for (const error of result.errors) {
      console.log(`- race ${error.raceNo}: ${error.message}`);
    }
  }
}

async function fetchUrlCommand(rest) {
  const url = rest.find((item) => item.startsWith('http'));
  if (!url) throw new Error('fetch-url requires an HKJC local result URL');

  const { date, racecourse, raceNo } = parseRaceUrl(url);
  if (!date || !racecourse || !raceNo) {
    throw new Error(`Could not parse date, racecourse, and race number from ${url}`);
  }

  const result = await fetchMeetingResults({
    date,
    racecourse,
    races: [raceNo],
    continueOnError: false,
  });

  await mkdir(rawDataDir, { recursive: true });
  const outputPath = path.join(rawDataDir, `${date}-${racecourse}-R${raceNo}.json`);
  await writeJson(outputPath, result.races);
  console.log(`Saved ${result.races.length} HKJC local race to ${outputPath}`);
}

async function fetchRaceCardCommand(args) {
  const date = normalizeRaceDate(args.date);
  const racecourse = String(args.course ?? args.racecourse ?? '').toUpperCase();
  const races = parseRaceRange(args.races ?? args.race ?? '1-11');

  if (!date || !racecourse || races.length === 0) {
    throw new Error('fetch-racecard requires --date, --course, and --races');
  }

  const result = await fetchMeetingRaceCards({
    date,
    racecourse,
    races,
    continueOnError: args.strict !== 'true',
  });

  await mkdir(upcomingDataDir, { recursive: true });
  const outputPath = path.join(upcomingDataDir, `${date}-${racecourse}.json`);
  await writeJson(outputPath, result.races);

  console.log(`Saved ${result.races.length} HKJC local race cards to ${outputPath}`);
  if (result.errors.length > 0) {
    console.log(`Skipped ${result.errors.length} race cards without parsable starters`);
    for (const error of result.errors) {
      console.log(`- race ${error.raceNo}: ${error.message}`);
    }
  }
}

async function refreshCommand(args) {
  const today = normalizeRaceDate(args.today) ?? hongKongToday();
  const from = normalizeRaceDate(args.from) ?? addDays(today, -Number(args.historyDays ?? 14));
  const to = normalizeRaceDate(args.to) ?? addDays(today, Number(args.futureDays ?? 21));
  const courseFilter = args.course ? String(args.course).toUpperCase() : null;
  const meetings = await loadFixtureWindow(from, to);
  const selectedMeetings = meetings.filter((meeting) => {
    if (courseFilter && meeting.racecourse !== courseFilter) return false;
    return meeting.date >= from && meeting.date <= to;
  });
  let resultRaces = 0;
  let raceCardRaces = 0;

  console.log(`Refreshing HKJC local meetings ${from} to ${to} (today ${today})`);
  for (const meeting of selectedMeetings) {
    const races = parseRaceRange(args.races ?? `1-${meeting.raceCount ?? 11}`);

    if (meeting.date <= today) {
      const result = await fetchMeetingResults({
        date: meeting.date,
        racecourse: meeting.racecourse,
        races,
        continueOnError: true,
      });

      if (result.races.length > 0) {
        await mkdir(rawDataDir, { recursive: true });
        const outputPath = path.join(rawDataDir, `${meeting.date}-${meeting.racecourse}.json`);
        await writeJson(outputPath, result.races);
        resultRaces += result.races.length;
        console.log(`Results ${meeting.date} ${meeting.racecourse}: saved ${result.races.length}/${races.length}`);
      } else {
        console.log(`Results ${meeting.date} ${meeting.racecourse}: no official result rows yet`);
      }
    }

    if (meeting.date >= today) {
      const raceCards = await fetchMeetingRaceCards({
        date: meeting.date,
        racecourse: meeting.racecourse,
        races,
        continueOnError: true,
      });

      if (raceCards.races.length > 0) {
        await mkdir(upcomingDataDir, { recursive: true });
        const outputPath = path.join(upcomingDataDir, `${meeting.date}-${meeting.racecourse}.json`);
        await writeJson(outputPath, raceCards.races);
        raceCardRaces += raceCards.races.length;
        console.log(`Race cards ${meeting.date} ${meeting.racecourse}: saved ${raceCards.races.length}/${races.length}`);
      } else {
        console.log(`Race cards ${meeting.date} ${meeting.racecourse}: not published or not parsable yet`);
      }
    }
  }

  if (selectedMeetings.length === 0) {
    console.log('No HKJC local meetings found in the selected window.');
  }

  console.log(`Refresh fetched ${resultRaces} settled races and ${raceCardRaces} race-card races`);
  const nextLocalMeetings = selectedMeetings
    .filter((meeting) => meeting.date > today)
    .slice(0, 5);
  await dashboardCommand({
    ...args,
    input: args.input ?? rawDataDir,
    upcoming: args.upcoming ?? upcomingDataDir,
    nextLocalMeetings,
    fixtureWindow: {
      from,
      to,
      today,
      source: 'HKJC local fixture',
    },
  });
}

async function backtestCommand(args) {
  const races = await loadRaces(args.input ?? rawDataDir);
  const report = backtestRaces(races, {
    minEdge: args.minEdge == null ? 0 : Number(args.minEdge),
  });

  await mkdir(processedDataDir, { recursive: true });
  const outputPath = path.join(processedDataDir, 'latest-backtest.json');
  await writeJson(outputPath, report);

  printBacktestReport(report);
  console.log(`Saved report to ${outputPath}`);
}

async function calibrateCommand(args) {
  const races = await loadRaces(args.input ?? rawDataDir);
  const top = calibrateConfig(races).slice(0, Number(args.top ?? 5));

  await mkdir(processedDataDir, { recursive: true });
  const outputPath = path.join(processedDataDir, 'latest-calibration.json');
  await writeJson(outputPath, top);

  console.log('Top configs by model top-pick ROI:');
  for (const [index, item] of top.entries()) {
    console.log(`${index + 1}. ROI ${percent(item.report.modelTopPickRoi)} | win ${percent(item.report.modelTopPickWinRate)} | ${JSON.stringify(item.config)}`);
  }
  console.log(`Saved calibration to ${outputPath}`);
}

async function dashboardCommand(args) {
  const races = await loadRaces(args.input ?? rawDataDir);
  const upcomingRaces = await loadRacesIfExists(args.upcoming ?? upcomingDataDir);
  const snapshot = buildDashboardSnapshot(races, {
    minEdge: args.minEdge == null ? 0 : Number(args.minEdge),
    minProbability: args.minProbability == null ? 0.15 : Number(args.minProbability),
    bankroll: args.bankroll == null ? 1000 : Number(args.bankroll),
    maxStakePct: args.maxStakePct == null ? 0.0125 : Number(args.maxStakePct),
    finalEdgeBuffer: args.finalEdgeBuffer == null ? 0.08 : Number(args.finalEdgeBuffer),
    allowProbabilityOnly: args.allowProbabilityOnly !== 'false',
    upcomingRaces,
    nextLocalMeetings: args.nextLocalMeetings ?? [],
    fixtureWindow: args.fixtureWindow ?? null,
  });

  await mkdir(processedDataDir, { recursive: true });
  const outputPath = path.join(processedDataDir, 'dashboard.json');
  await writeJson(outputPath, snapshot);

  console.log(`Dashboard snapshot: ${snapshot.summary.racesSettled} settled races`);
  console.log(`Upcoming forecasts: ${snapshot.upcomingEntries.length}`);
  console.log(`Value bets: ${snapshot.summary.valueWins}/${snapshot.summary.valueBets} ROI ${percent(snapshot.summary.roi)}`);
  console.log(`Saved dashboard data to ${outputPath}`);
}

async function loadRaces(inputPath) {
  const absolutePath = path.resolve(inputPath);
  const statEntries = await collectJsonFiles(absolutePath);
  const races = [];

  for (const file of statEntries) {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    if (Array.isArray(parsed)) races.push(...parsed);
    else if (Array.isArray(parsed.races)) races.push(...parsed.races);
    else races.push(parsed);
  }

  return races.filter((race) => race?.runners?.length);
}

async function loadRacesIfExists(inputPath) {
  try {
    return await loadRaces(inputPath);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function collectJsonFiles(inputPath) {
  if (inputPath.endsWith('.json')) return [inputPath];
  const entries = await readdir(inputPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(inputPath, entry.name));
}

function normalizeMarketSnapshotItems(payload, keys) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
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

function parseRaceRange(value) {
  const text = String(value).trim();
  const range = text.match(/^(\d+)-(\d+)$/);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }
  return text.split(',').map((item) => Number(item.trim())).filter(Number.isFinite);
}

function parseNumberList(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => Number(item.trim()))
    .filter(Number.isFinite);
}

function parseStringList(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function requiredArg(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`--${name} is required`);
  }
  return value.trim();
}

async function loadShadowScoreRows(inputPath) {
  const content = await readFile(inputPath, 'utf8');
  const rows = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`shadow-score input line ${index + 1} is not valid JSON`);
      }
    });
  if (rows.length === 0) {
    throw new Error('shadow-score input must not be empty');
  }
  return rows.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`shadow-score input line ${index + 1} must be a JSON object`);
    }
    if (typeof row.raceId !== 'string' || row.raceId.trim() === '') {
      throw new Error(`shadow-score input line ${index + 1} is missing raceId`);
    }
    if (typeof row.postAt !== 'string' || row.postAt.trim() === '') {
      throw new Error(`shadow-score input line ${index + 1} is missing postAt`);
    }
    return {
      ...row,
      raceId: row.raceId.trim(),
      postAt: row.postAt.trim(),
    };
  });
}

function normalizeRacePayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.races)) return payload.races;
  if (payload && typeof payload === 'object') return [payload];
  throw new Error('prospective-settle input must contain a race object or races array');
}

function groupBy(items, selector) {
  const groups = new Map();
  for (const item of items) {
    const key = selector(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

async function loadFixtureWindow(from, to) {
  const meetings = [];
  for (const { year, month } of monthsBetween(from, to)) {
    meetings.push(...await fetchFixtureMeetings({ year, month }));
  }
  return meetings.sort((a, b) => a.date.localeCompare(b.date) || a.racecourse.localeCompare(b.racecourse));
}

function monthsBetween(from, to) {
  const start = parseDateParts(from);
  const end = parseDateParts(to);
  const months = [];
  let year = start.year;
  let month = start.month;

  while (year < end.year || (year === end.year && month <= end.month)) {
    months.push({ year, month });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return months;
}

function addDays(dateText, days) {
  const { year, month, day } = parseDateParts(dateText);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function parseDateParts(dateText) {
  const normalized = normalizeRaceDate(dateText);
  const [year, month, day] = normalized.split('-').map(Number);
  return { year, month, day };
}

function hongKongToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

async function writeJson(outputPath, value) {
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function printBacktestReport(report) {
  console.log(`Races: ${report.races}`);
  console.log(`Model top pick: ${report.modelTopPickWins}/${report.modelTopPickBets} win ${percent(report.modelTopPickWinRate)} ROI ${percent(report.modelTopPickRoi)}`);
  console.log(`HKJC market favourite: ${report.marketFavouriteWins}/${report.marketFavouriteBets} win ${percent(report.marketFavouriteWinRate)} ROI ${percent(report.marketFavouriteRoi)}`);
  console.log(`Value bets: ${report.valueWins}/${report.valueBets} win ${percent(report.valueWinRate)} ROI ${percent(report.valueRoi)}`);
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function money(value) {
  return Number(value ?? 0).toFixed(2);
}

function formatSigned(value) {
  const number = Number(value ?? 0);
  return `${number >= 0 ? '+' : ''}${number.toFixed(2)}`;
}

function printHelp() {
  console.log(`
HKJC local horse model

Commands:
  fetch      --date 2026-01-04 --course ST --races 1-11
  fetch-racecard --date 2026-06-13 --course ST --races 1-11
  refresh    --historyDays 14 --futureDays 21 --bankroll 200 --minEdge 0 --minProbability 0.15
  auto-run   --input hkjc-horse-model/data/raw --db hkjc-horse-model/data/hkjc.sqlite --output data/dashboard.json --auditOutput hkjc-horse-model/data/private/latest-recommendation-audit.json
  sync-db    --input hkjc-horse-model/data/raw --upcoming hkjc-horse-model/data/upcoming --db hkjc-horse-model/data/hkjc.sqlite
  dashboard-db --db hkjc-horse-model/data/hkjc.sqlite --output data/dashboard.json --privateHistoryOutput hkjc-horse-model/data/private/dashboard-history.json
  training-dataset --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/processed/training-dataset.json --tianxiRoot /path/to/tianxi-database --speedproRoot /path/to/tianxi-database
  training-matrix --input hkjc-horse-model/data/processed/training-dataset.json --output hkjc-horse-model/data/processed/training-matrix.jsonl [--format jsonl|csv]
  model-leaderboard --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/processed/model-leaderboard.json
  external-model-comparison --date 2026-07-08 --venue HV --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/processed/external-model-comparison-2026-07-08-HV.json
  external-source-audit --output hkjc-horse-model/data/processed/external-source-audit.json
  external-source-coverage --cacheRoot /path/to/external-sources --output hkjc-horse-model/data/processed/external-source-coverage.json
  train-model --input hkjc-horse-model/data/processed/training-dataset.json --output hkjc-horse-model/data/processed/model-training-report.json
  strategy-risk-report --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/processed/strategy-risk-report.json
  market-snapshot --input hkjc-horse-model/data/market-snapshot.json --db hkjc-horse-model/data/hkjc.sqlite
  external-live-odds --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/processed/external-live-odds-import.json
  live-market-snapshot --date 2026-07-08 --venue HV --race 1 --pools WIN,PLA,QIN,QPL --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/processed/live-market-source-report.json
  live-market-due-snapshots --db hkjc-horse-model/data/hkjc.sqlite --windows T-30,T-10,T-3 --pools WIN,PLA,QIN,QPL --output hkjc-horse-model/data/processed/live-market-source-report.json --dryRun
  race-day-cycle --db hkjc-horse-model/data/hkjc.sqlite --windows T-30,T-10,T-3 --pools WIN,PLA,QIN,QPL --output hkjc-horse-model/data/private/latest-race-day-cycle.json --dryRun
  local-scheduler --projectPath /absolute/path/to/project --intervalMinutes 10 --output hkjc-horse-model/data/private/com.superlaomiao.hkjc-race-day-cycle.plist --dryRun
  market-coverage-report --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/processed/market-snapshot-coverage.json
  market-window-research --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/processed/market-window-research.json
  shadow-score --input upcoming.jsonl --model model.cbm --report report.json --featureManifest manifest.json --generatedAt 2026-07-22T10:20:00Z --output hkjc-horse-model/data/processed/shadow-score.json
  prospective-lock --input prospective-lock-input.json --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/private/latest-prospective-lock.json
  prospective-settle --db hkjc-horse-model/data/hkjc.sqlite [--input settled-race.json] [--raceId 2026-07-22-HV-R1] --output hkjc-horse-model/data/private/latest-prospective-audit.json
  recommendation-audit --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/processed/latest-recommendation-audit.json
  fetch-url  https://racing.hkjc.com/en-us/local/information/localresults?RaceNo=2&Racecourse=ST&racedate=2026%2F01%2F04
  backtest   --input hkjc-horse-model/data/raw --minEdge 0
  calibrate  --input hkjc-horse-model/data/raw --top 5
  dashboard  --input hkjc-horse-model/data/raw --bankroll 1000 --minEdge 0 --minProbability 0.15

Notes:
  - Only local Hong Kong races are fetched from official HKJC result pages.
  - Race cards are unsettled pre-race inputs, stored separately under data/upcoming.
  - ST = Sha Tin, HV = Happy Valley.
  - Backtest predicts each race using only races seen earlier in chronological order.
`);
}

function publicDatabaseLabel(dbPath) {
  const relative = path.relative(process.cwd(), dbPath);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return relative;
  return path.basename(dbPath);
}

function publicInputLabel(value) {
  const text = String(value ?? '');
  if (/^https?:\/\//i.test(text)) return text;
  const relative = path.relative(process.cwd(), text);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return relative;
  return path.basename(text);
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
