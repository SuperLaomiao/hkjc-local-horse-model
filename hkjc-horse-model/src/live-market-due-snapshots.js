import { loadDueSnapshotPlan } from './live-snapshot-planner.js';
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

  return {
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
  };
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
