import {
  DEFAULT_SNAPSHOT_WINDOWS,
  loadDueSnapshotPlan,
} from './live-snapshot-planner.js';
import {
  DEFAULT_LIVE_MARKET_ODDS_TYPES,
  fetchLiveMarketPayload,
  importLiveMarketSnapshotsToDatabase,
  normalizeLiveMarketPayload,
} from './live-market-snapshot.js';
import { loadCapturedSnapshotWindows } from './sqlite-store.js';

export async function runDueLiveMarketSnapshots({
  dbPath,
  now = new Date(),
  windows,
  pools = DEFAULT_LIVE_MARKET_ODDS_TYPES,
  dryRun = false,
  loadPlan = loadDueSnapshotPlan,
  loadCapturedWindows = loadCapturedSnapshotWindows,
  capture = captureDueSnapshot,
} = {}) {
  if (!dbPath) throw new Error('runDueLiveMarketSnapshots requires dbPath');
  const capturedAt = new Date(now).toISOString();
  const duePlan = loadPlan({ dbPath, now, windows });
  const capturedWindows = loadCapturedWindows({
    dbPath,
    windows,
    raceIds: duePlan.map((race) => race.raceId),
  });
  const due = [];
  let captured = 0;
  let skippedDuplicates = 0;
  let oddsSnapshots = 0;
  let poolSnapshots = 0;

  for (const race of duePlan) {
    const key = `${race.raceId}|${race.window}`;
    if (capturedWindows.has(key)) {
      skippedDuplicates += 1;
      due.push({ ...race, status: 'duplicate-skipped' });
      continue;
    }
    if (dryRun) {
      due.push({ ...race, status: 'dry-run' });
      continue;
    }
    const result = await capture({
      dbPath,
      date: race.date,
      venueCode: race.racecourse,
      raceNo: race.raceNo,
      pools,
      capturedAt,
    });
    captured += 1;
    oddsSnapshots += result.oddsSnapshots;
    poolSnapshots += result.poolSnapshots;
    due.push({ ...race, status: 'captured', ...result });
  }

  const report = {
    generatedAt: capturedAt,
    dryRun,
    summary: {
      due: duePlan.length,
      captured,
      skippedDuplicates,
      oddsSnapshots,
      poolSnapshots,
    },
    due,
    nextDue: nextDueWindow({ due: duePlan, now, windows }),
  };
  report.summaryZh = formatDueSnapshotSummaryZh(report);
  return report;
}

export function nextDueWindow({
  due = [],
  now = new Date(),
  windows = DEFAULT_SNAPSHOT_WINDOWS,
} = {}) {
  const nowDate = new Date(now);
  if (!Number.isFinite(nowDate.getTime())) throw new Error('nextDueWindow requires a valid now value');
  const configuredWindows = Array.isArray(windows) && windows.length > 0
    ? windows
    : DEFAULT_SNAPSHOT_WINDOWS;
  const candidates = [];
  for (const race of due) {
    const postTime = new Date(race?.postTime);
    if (!Number.isFinite(postTime.getTime()) || !race?.raceId) continue;
    for (const window of configuredWindows) {
      const minutes = snapshotTargetMinutes(window);
      if (!Number.isFinite(minutes)) continue;
      const dueAt = new Date(postTime.getTime() - minutes * 60_000);
      if (dueAt.getTime() <= nowDate.getTime()) continue;
      candidates.push({
        raceId: race.raceId,
        window: window.label,
        dueAt: dueAt.toISOString(),
      });
    }
  }
  candidates.sort((left, right) => (
    left.dueAt.localeCompare(right.dueAt)
    || left.raceId.localeCompare(right.raceId)
    || left.window.localeCompare(right.window)
  ));
  return candidates[0] ?? null;
}

export function formatDueSnapshotSummaryZh(report = {}) {
  const summary = report.summary ?? {};
  const due = finiteCount(summary.due);
  const captured = finiteCount(summary.captured);
  const skipped = finiteCount(summary.skippedDuplicates);
  const odds = finiteCount(summary.oddsSnapshots);
  const pools = finiteCount(summary.poolSnapshots);
  const mode = report.dryRun ? '演练' : '执行';
  const next = report.nextDue
    ? `；下次 ${report.nextDue.window}：${report.nextDue.raceId}（${report.nextDue.dueAt}）`
    : '；当前没有可计算的下一抓取窗口';
  return `${mode}：应处理 ${due} 场，捕获 ${captured} 场，跳过重复 ${skipped} 场；赔率 ${odds} 行，彩池 ${pools} 行${next}`;
}

function snapshotTargetMinutes(window) {
  const explicit = Number(window?.targetMinutes);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  const match = String(window?.label ?? '').match(/^T-(\d+)$/i);
  return match ? Number(match[1]) : null;
}

function finiteCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
}

async function captureDueSnapshot({ dbPath, date, venueCode, raceNo, pools, capturedAt }) {
  const fetched = await fetchLiveMarketPayload({ date, venueCode, raceNos: [raceNo], oddsTypes: pools });
  const normalized = normalizeLiveMarketPayload({
    payload: fetched.payload,
    capturedAt,
    date,
    venueCode,
    raceNo,
  });
  return importLiveMarketSnapshotsToDatabase({ dbPath, ...normalized });
}
