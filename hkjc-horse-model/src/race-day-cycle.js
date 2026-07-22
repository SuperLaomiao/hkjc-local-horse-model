import { runDueLiveMarketSnapshots } from './live-market-due-snapshots.js';
import { DEFAULT_SNAPSHOT_WINDOWS } from './live-snapshot-planner.js';
import { validateProbabilityArtifact } from './probability-artifact.js';
import { buildProspectiveLocks, recordProspectiveLock } from './prospective-locks.js';
import {
  loadMarketSnapshots,
  loadRacesFromDatabase,
} from './sqlite-store.js';

export async function runRaceDayCycle({
  now = new Date(),
  dbPath,
  windows = DEFAULT_SNAPSHOT_WINDOWS,
  pools = ['WIN', 'PLA', 'QIN', 'QPL'],
  dryRun = false,
  maxRetries = 2,
  dependencies = {},
} = {}) {
  if (!dbPath) throw new Error('runRaceDayCycle requires dbPath');
  const nowDate = new Date(now);
  if (!Number.isFinite(nowDate.getTime())) throw new Error('runRaceDayCycle requires a valid now value');
  const retryLimit = normalizeRetryLimit(maxRetries);
  const configuredWindows = normalizeWindows(windows);
  const collectDue = dependencies.collectDue ?? runDueLiveMarketSnapshots;
  const loadRace = dependencies.loadRace ?? defaultLoadRace;
  const loadMarket = dependencies.loadMarketSnapshots ?? defaultLoadMarketSnapshots;
  const scoreRace = dependencies.scoreRace ?? null;
  const buildDecisions = dependencies.buildDecisions ?? (() => []);
  const writeLocks = dependencies.writeLocks ?? defaultWriteLocks;
  const sleep = dependencies.sleep ?? defaultSleep;

  const collected = await withBoundedRetries(
    () => collectDue({
      dbPath,
      now: nowDate,
      windows: configuredWindows,
      pools,
      dryRun,
    }),
    { maxRetries: retryLimit, sleep },
  );
  const races = [];
  let scored = 0;
  let locksRecorded = 0;
  let postTimeSkipped = 0;
  let scoreSkipped = 0;

  for (const item of collected.value.due ?? []) {
    if (!['captured', 'duplicate-skipped'].includes(item.status)) continue;
    const postAt = normalizePostAt(item.postTime);
    if (!postAt || nowDate.getTime() >= Date.parse(postAt)) {
      postTimeSkipped += 1;
      races.push({ raceId: item.raceId, window: item.window, status: 'post-time-skipped' });
      continue;
    }
    const race = await loadRace({ dbPath, raceId: item.raceId, due: item });
    if (!race) {
      scoreSkipped += 1;
      races.push({ raceId: item.raceId, window: item.window, status: 'racecard-missing' });
      continue;
    }
    if (typeof scoreRace !== 'function') {
      scoreSkipped += 1;
      races.push({ raceId: item.raceId, window: item.window, status: 'score-not-configured' });
      continue;
    }

    const rawBundle = await scoreRace({
      dbPath,
      race,
      due: item,
      generatedAt: collected.value.generatedAt,
    });
    const bundle = validateProbabilityArtifact(rawBundle, {
      raceId: item.raceId,
      postAt,
    });
    scored += 1;
    const decisionRows = await buildDecisions({
      dbPath,
      race,
      due: item,
      bundle,
      generatedAt: collected.value.generatedAt,
    });
    const shadowDecisions = (Array.isArray(decisionRows) ? decisionRows : []).map((decision) => ({
      ...decision,
      modelId: decision.modelId ?? bundle.modelId,
      cashStake: 0,
      paperStake: 0,
      marketWindow: item.window,
    }));
    if (shadowDecisions.length === 0) {
      races.push({ raceId: item.raceId, window: item.window, status: 'no-lock-decisions' });
      continue;
    }
    const marketSnapshots = await loadMarket({ dbPath, raceId: item.raceId, due: item });
    const locks = buildProspectiveLocks({
      race,
      scoreBundles: [bundle],
      marketSnapshots,
      decisions: shadowDecisions,
      generatedAt: collected.value.generatedAt,
    });
    const recorded = await writeLocks({ dbPath, locks, race, due: item });
    const recordedCount = Array.isArray(recorded) ? recorded.length : locks.length;
    locksRecorded += recordedCount;
    races.push({
      raceId: item.raceId,
      window: item.window,
      status: 'locked',
      locksRecorded: recordedCount,
    });
  }

  const report = {
    generatedAt: collected.value.generatedAt ?? nowDate.toISOString(),
    dryRun,
    summary: {
      due: finiteCount(collected.value.summary?.due),
      captured: finiteCount(collected.value.summary?.captured),
      skippedDuplicates: finiteCount(collected.value.summary?.skippedDuplicates),
      oddsSnapshots: finiteCount(collected.value.summary?.oddsSnapshots),
      poolSnapshots: finiteCount(collected.value.summary?.poolSnapshots),
      scored,
      locksRecorded,
      postTimeSkipped,
      scoreSkipped,
      retries: collected.retries,
    },
    races,
    nextDue: collected.value.nextDue ?? null,
  };
  report.summaryZh = formatRaceDayCycleSummaryZh(report);
  return report;
}

export function formatRaceDayCycleSummaryZh(report = {}) {
  const summary = report.summary ?? {};
  const next = report.nextDue
    ? `；下次 ${report.nextDue.window} ${report.nextDue.raceId}（${report.nextDue.dueAt}）`
    : '；当前没有下一窗口';
  return `赛马日周期：应处理 ${finiteCount(summary.due)} 场，捕获 ${finiteCount(summary.captured)} 场，评分 ${finiteCount(summary.scored)} 场，锁定 ${finiteCount(summary.locksRecorded)} 条，赛后拦截 ${finiteCount(summary.postTimeSkipped)} 场，重试 ${finiteCount(summary.retries)} 次${next}`;
}

async function withBoundedRetries(operation, { maxRetries, sleep }) {
  let retries = 0;
  while (true) {
    try {
      return { value: await operation(), retries };
    } catch (error) {
      if (retries >= maxRetries) throw error;
      retries += 1;
      await sleep(Math.min(250 * (2 ** (retries - 1)), 1000));
    }
  }
}

function normalizeRetryLimit(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 3) {
    throw new Error('maxRetries must be an integer between 0 and 3');
  }
  return number;
}

function normalizeWindows(windows) {
  if (!Array.isArray(windows) || windows.length === 0) return DEFAULT_SNAPSHOT_WINDOWS;
  return windows.map((window) => {
    if (window && typeof window === 'object') return window;
    const label = String(window).toUpperCase();
    const match = DEFAULT_SNAPSHOT_WINDOWS.find((candidate) => candidate.label === label);
    if (!match) throw new Error(`unsupported snapshot window: ${window}`);
    return match;
  });
}

function normalizePostAt(value) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function defaultLoadRace({ dbPath, raceId }) {
  return loadRacesFromDatabase({ dbPath, status: 'upcoming' })
    .find((race) => race.raceId === raceId) ?? null;
}

function defaultLoadMarketSnapshots({ dbPath, raceId }) {
  return loadMarketSnapshots({ dbPath, raceId }).odds;
}

function defaultWriteLocks({ dbPath, locks }) {
  return locks.map((lock) => recordProspectiveLock({ dbPath, lock }));
}

function defaultSleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function finiteCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
}
