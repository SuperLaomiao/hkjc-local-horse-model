const WINDOWS = [
  { label: 'T-30', minMinutes: 21, maxMinutes: 45, targetMinutes: 30 },
  { label: 'T-10', minMinutes: 6, maxMinutes: 20, targetMinutes: 10 },
  { label: 'T-3', minMinutes: 0, maxMinutes: 5, targetMinutes: 3 },
];
const POOLS = ['WIN', 'PLA', 'QIN', 'QPL'];
const SELLING_STATUSES = new Set(['SELLING', 'OPEN', 'SALE_OPEN', 'START_SELL', 'START_SELLING']);
const DEFAULT_MINIMUMS = Object.freeze({
  races: 100,
  usableCells: 400,
  locks: 200,
  settledLocks: 150,
  settlementCoverage: 0.75,
  perPoolWindowUsableCells: 20,
  requiredPools: POOLS,
  requiredWindows: WINDOWS.map((window) => window.label),
  requireBackup: true,
  requireBackupChecksum: true,
  backupMaxAgeHours: 48,
});

export function buildProspectiveCoverage({
  races = [],
  snapshots = [],
  locks = [],
  backupManifest = null,
  freeze = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const evaluatedAt = normalizeTimestamp(generatedAt, 'generatedAt');
  const freezeDate = normalizeFreezeDate(freeze);
  const snapshotPayload = normalizeSnapshotPayload(snapshots);
  const raceRows = buildRaceUniverse({ races, events: snapshotPayload.events, freezeDate });
  const snapshotRows = snapshotPayload.rows
    .map((snapshot) => normalizeSnapshot(snapshot, raceRows.byId))
    .filter(Boolean);
  const eventRows = snapshotPayload.events
    .map(normalizeCollectionEvent)
    .filter(Boolean);
  const lockRows = (Array.isArray(locks) ? locks : [])
    .map(normalizeLock)
    .filter((lock) => lock && isOnOrAfterFreeze(lock.date, freezeDate));
  const cells = [];

  for (const race of raceRows.rows) {
    for (const pool of POOLS) {
      for (const window of WINDOWS) {
        cells.push(buildCoverageCell({
          race,
          pool,
          window,
          evaluatedAt,
          snapshots: snapshotRows,
          events: eventRows,
          locks: lockRows,
        }));
      }
    }
  }

  const summary = summarizeCells(cells, raceRows.rows, lockRows, snapshotPayload.retryCount);
  return {
    version: 'prospective-coverage-v1',
    generatedAt: evaluatedAt,
    freezeDate,
    policy: {
      pools: [...POOLS],
      windows: WINDOWS.map((window) => window.label),
      absentLockOutcomePolicy: 'MISSING_NOT_LOSS',
      roiConsumedBeforeGate: false,
    },
    summary,
    byMeeting: groupCoverage(cells, (cell) => cell.meeting, 'meeting', raceRows.rows),
    byPool: groupCoverage(cells, (cell) => cell.pool, 'pool'),
    byWindow: groupCoverage(cells, (cell) => cell.window, 'window'),
    byPoolWindow: groupCoverage(cells, (cell) => `${cell.pool}|${cell.window}`, 'poolWindow')
      .map((row) => {
        const [pool, window] = row.poolWindow.split('|');
        const { poolWindow: _ignored, ...rest } = row;
        return { pool, window, ...rest };
      }),
    freshness: summarizeFreshness(snapshotRows, lockRows, evaluatedAt),
    backup: summarizeBackupManifest(backupManifest, evaluatedAt),
  };
}

export function evaluateProspectiveDataGate({ coverage, minimums = {} } = {}) {
  if (!coverage || typeof coverage !== 'object' || Array.isArray(coverage)) {
    throw new Error('evaluateProspectiveDataGate requires coverage');
  }
  const declaredMinimums = normalizeMinimums(minimums);
  const summary = coverage.summary ?? {};
  const deficits = [];
  addMinimumDeficit(deficits, 'races', summary.races, declaredMinimums.races);
  addMinimumDeficit(deficits, 'usableCells', summary.usableCells, declaredMinimums.usableCells);
  addMinimumDeficit(deficits, 'locks', summary.locks, declaredMinimums.locks);
  addMinimumDeficit(deficits, 'settledLocks', summary.settledLocks, declaredMinimums.settledLocks);
  addMinimumDeficit(
    deficits,
    'settlementCoverage',
    summary.settlementCoverage,
    declaredMinimums.settlementCoverage,
  );

  const poolWindowIndex = new Map((Array.isArray(coverage.byPoolWindow) ? coverage.byPoolWindow : [])
    .map((row) => [`${canonicalPool(row?.pool)}|${canonicalWindow(row?.window)}`, row]));
  for (const pool of declaredMinimums.requiredPools) {
    for (const window of declaredMinimums.requiredWindows) {
      const row = poolWindowIndex.get(`${pool}|${window}`);
      addMinimumDeficit(
        deficits,
        `${pool}.${window}.usableCells`,
        row?.usableCells,
        declaredMinimums.perPoolWindowUsableCells,
      );
    }
  }

  if (declaredMinimums.requireBackup) {
    if (coverage.backup?.status !== 'OK') {
      deficits.push({
        metric: 'backup.status',
        required: 'OK',
        actual: coverage.backup?.status ?? 'MISSING',
      });
    }
    if (declaredMinimums.requireBackupChecksum && coverage.backup?.checksumPresent !== true) {
      deficits.push({
        metric: 'backup.checksumPresent',
        required: true,
        actual: Boolean(coverage.backup?.checksumPresent),
      });
    }
    addMaximumDeficit(
      deficits,
      'backup.ageHours',
      coverage.backup?.ageHours,
      declaredMinimums.backupMaxAgeHours,
    );
  }

  return {
    version: 'prospective-data-gate-v1',
    status: deficits.length === 0 ? 'READY' : 'BLOCKED_DATA',
    cashMode: 'NO_BET',
    declaredMinimums,
    deficits,
    roiRead: false,
  };
}

export function publicProspectiveCoverageProjection(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) return null;
  const summary = report.summary ?? {};
  return {
    version: report.version ?? null,
    generatedAt: report.generatedAt ?? null,
    freezeDate: report.freezeDate ?? null,
    summary: {
      meetings: finiteCount(summary.meetings),
      races: finiteCount(summary.races),
      dueCells: finiteCount(summary.dueCells),
      usableCells: finiteCount(summary.usableCells),
      missingCells: finiteCount(summary.missingCells),
      retryCount: finiteCount(summary.retryCount),
      locks: finiteCount(summary.locks),
      settledLocks: finiteCount(summary.settledLocks),
      lockCoverage: nullableRatio(summary.lockCoverage),
      settlementCoverage: nullableRatio(summary.settlementCoverage),
      reasonCounts: normalizeReasonCounts(summary.reasonCounts),
      absentLockPolicy: 'MISSING_NOT_LOSS',
    },
    byPool: sanitizeAggregateRows(report.byPool, ['pool']),
    byWindow: sanitizeAggregateRows(report.byWindow, ['window']),
    byPoolWindow: sanitizeAggregateRows(report.byPoolWindow, ['pool', 'window']),
    freshness: {
      latestSnapshotAt: report.freshness?.latestSnapshotAt ?? null,
      snapshotAgeHours: nullableNonNegative(report.freshness?.snapshotAgeHours),
      latestLockAt: report.freshness?.latestLockAt ?? null,
      lockAgeHours: nullableNonNegative(report.freshness?.lockAgeHours),
    },
    backup: {
      status: report.backup?.status ?? 'MISSING',
      latestSuccessfulAt: report.backup?.latestSuccessfulAt ?? null,
      ageHours: nullableNonNegative(report.backup?.ageHours),
      checksumPresent: Boolean(report.backup?.checksumPresent),
    },
    gate: sanitizeGate(report.gate),
  };
}

function buildRaceUniverse({ races, events, freezeDate }) {
  const byId = new Map();
  for (const value of Array.isArray(races) ? races : []) {
    const race = normalizeRace(value);
    if (!race || !isOnOrAfterFreeze(race.date, freezeDate)) continue;
    byId.set(race.raceId, race);
  }
  for (const value of events) {
    const event = normalizeCollectionEvent(value);
    if (!event?.raceId || byId.has(event.raceId) || !isOnOrAfterFreeze(event.date, freezeDate)) continue;
    byId.set(event.raceId, {
      raceId: event.raceId,
      date: event.date,
      racecourse: event.racecourse,
      raceNo: event.raceNo,
      meeting: meetingKey(event),
      postAt: null,
      racecardMissing: true,
    });
  }
  const rows = [...byId.values()].sort(compareRace);
  return { rows, byId };
}

function normalizeRace(race) {
  if (!race || typeof race !== 'object' || Array.isArray(race) || !text(race.raceId)) return null;
  const date = text(race.date) ?? inferRaceDate(race.raceId);
  const racecourse = text(race.racecourse)?.toUpperCase() ?? inferRacecourse(race.raceId);
  const raceNo = finiteInteger(race.raceNo);
  const postAt = racePostAt(race);
  const racecardMissing = !postAt || !Array.isArray(race.runners) || race.runners.length === 0;
  return {
    raceId: text(race.raceId),
    date,
    racecourse,
    raceNo,
    meeting: meetingKey({ date, racecourse }),
    postAt,
    racecardMissing,
  };
}

function normalizeSnapshotPayload(snapshots) {
  if (Array.isArray(snapshots)) return { rows: snapshots, events: [], retryCount: 0 };
  if (!snapshots || typeof snapshots !== 'object') return { rows: [], events: [], retryCount: 0 };
  return {
    rows: [
      ...(Array.isArray(snapshots.odds) ? snapshots.odds : []),
      ...(Array.isArray(snapshots.pools) ? snapshots.pools : []),
    ],
    events: Array.isArray(snapshots.events) ? snapshots.events : [],
    retryCount: finiteCount(snapshots.retryCount ?? snapshots.summary?.retries),
  };
}

function normalizeSnapshot(snapshot, raceById) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const raceId = text(snapshot.raceId);
  const pool = canonicalPool(snapshot.pool ?? snapshot.poolKey);
  if (!raceId || !pool) return null;
  const race = raceById.get(raceId);
  const minutesToPost = finiteNumber(snapshot.minutesToPost)
    ?? minutesBetween(snapshot.capturedAt, race?.postAt);
  const window = canonicalWindow(snapshot.marketWindow ?? snapshot.window)
    ?? windowForMinutes(minutesToPost);
  const capturedAt = normalizeOptionalTimestamp(snapshot.capturedAt);
  if (!window || minutesToPost == null || minutesToPost < 0 || !capturedAt) return null;
  if (race?.postAt && Date.parse(capturedAt) >= Date.parse(race.postAt)) return null;
  return {
    raceId,
    pool,
    window,
    capturedAt,
    sellStatus: text(snapshot.sellStatus ?? snapshot.raw?.sellStatus ?? snapshot.raw?.status)?.toUpperCase() ?? null,
  };
}

function normalizeCollectionEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event) || !text(event.raceId)) return null;
  const date = text(event.date) ?? inferRaceDate(event.raceId);
  const racecourse = text(event.racecourse)?.toUpperCase() ?? inferRacecourse(event.raceId);
  return {
    raceId: text(event.raceId),
    date,
    racecourse,
    raceNo: finiteInteger(event.raceNo),
    pool: canonicalPool(event.pool ?? event.poolKey),
    window: canonicalWindow(event.window ?? event.marketWindow),
    reason: canonicalReason(event.reason ?? event.status),
  };
}

function normalizeLock(lock) {
  if (!lock || typeof lock !== 'object' || Array.isArray(lock) || !text(lock.raceId)) return null;
  const pool = canonicalPool(lock.pool ?? lock.poolKey);
  const window = canonicalWindow(lock.marketWindow ?? lock.window);
  if (!pool || !window) return null;
  return {
    lockId: text(lock.lockId),
    raceId: text(lock.raceId),
    date: text(lock.date) ?? inferRaceDate(lock.raceId),
    pool,
    window,
    status: text(lock.status)?.toUpperCase() ?? 'OPEN',
    outcome: text(lock.settlement?.outcome)?.toUpperCase() ?? null,
    generatedAt: normalizeOptionalTimestamp(lock.generatedAt),
  };
}

function buildCoverageCell({ race, pool, window, evaluatedAt, snapshots, events, locks }) {
  const due = race.racecardMissing || Date.parse(evaluatedAt) >= windowDueAt(race.postAt, window.targetMinutes);
  const matchingSnapshots = snapshots.filter((row) => (
    row.raceId === race.raceId && row.pool === pool && row.window === window.label
  ));
  const matchingEvents = events.filter((row) => (
    row.raceId === race.raceId
    && (!row.pool || row.pool === pool)
    && (!row.window || row.window === window.label)
  ));
  const matchingLocks = locks.filter((row) => (
    row.raceId === race.raceId && row.pool === pool && row.window === window.label
  ));
  const sellingSnapshots = matchingSnapshots.filter((row) => SELLING_STATUSES.has(row.sellStatus));
  const reason = cellReason({ race, due, matchingSnapshots, sellingSnapshots, matchingEvents });
  const settledLocks = matchingLocks.filter((lock) => ['SETTLED', 'VOID'].includes(lock.status)).length;

  return {
    meeting: race.meeting,
    raceId: race.raceId,
    pool,
    window: window.label,
    due,
    pending: !due,
    captured: matchingSnapshots.length > 0,
    usable: sellingSnapshots.length > 0,
    missing: due && sellingSnapshots.length === 0,
    reason,
    locks: matchingLocks.length,
    settledLocks,
    openLocks: matchingLocks.filter((lock) => lock.status === 'OPEN').length,
  };
}

function cellReason({ race, due, matchingSnapshots, sellingSnapshots, matchingEvents }) {
  if (!due) return 'pending';
  if (race.racecardMissing) return 'missingRacecard';
  if (sellingSnapshots.length > 0) return 'captured';
  const eventReasons = new Set(matchingEvents.map((event) => event.reason).filter(Boolean));
  for (const reason of ['offline', 'collectorError', 'duplicate', 'notSelling', 'missingRacecard']) {
    if (eventReasons.has(reason)) return reason;
  }
  if (matchingSnapshots.length > 0) return 'notSelling';
  return 'missedWindow';
}

function summarizeCells(cells, races, locks, retryCount) {
  const dueCells = cells.filter((cell) => cell.due);
  const settledLocks = locks.filter((lock) => ['SETTLED', 'VOID'].includes(lock.status));
  const settledNonVoid = locks.filter((lock) => lock.status === 'SETTLED');
  const hits = settledNonVoid.filter((lock) => lock.outcome === 'HIT').length;
  const misses = settledNonVoid.filter((lock) => lock.outcome === 'MISS').length;
  const voids = locks.filter((lock) => lock.status === 'VOID' || lock.outcome === 'VOID').length;
  const usableCells = dueCells.filter((cell) => cell.usable).length;
  const lockedCells = dueCells.filter((cell) => cell.locks > 0).length;
  return {
    meetings: new Set(races.map((race) => race.meeting)).size,
    races: races.length,
    expectedCells: cells.length,
    dueCells: dueCells.length,
    pendingCells: cells.filter((cell) => cell.pending).length,
    capturedCells: dueCells.filter((cell) => cell.captured).length,
    usableCells,
    missingCells: dueCells.filter((cell) => cell.missing).length,
    retryCount: finiteCount(retryCount),
    lockedCells,
    lockCoverage: usableCells > 0 ? round(lockedCells / usableCells, 4) : null,
    locks: locks.length,
    settledLocks: settledLocks.length,
    openLocks: locks.filter((lock) => lock.status === 'OPEN').length,
    voidLocks: voids,
    settlementCoverage: locks.length > 0 ? round(settledLocks.length / locks.length, 4) : null,
    outcomes: { hits, misses, voids },
    reasonCounts: countReasons(dueCells),
    reasonCountUnit: 'POOL_WINDOW_CELL',
    absentLockPolicy: 'MISSING_NOT_LOSS',
  };
}

function groupCoverage(cells, selector, keyName, races = null) {
  const groups = new Map();
  for (const cell of cells) {
    const key = selector(cell);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(cell);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([key, rows]) => {
      const due = rows.filter((row) => row.due);
      const usableCells = due.filter((row) => row.usable).length;
      const lockedCells = due.filter((row) => row.locks > 0).length;
      return {
        [keyName]: key,
        ...(races ? { races: new Set(rows.map((row) => row.raceId)).size } : {}),
        dueCells: due.length,
        capturedCells: due.filter((row) => row.captured).length,
        usableCells,
        missingCells: due.filter((row) => row.missing).length,
        lockedCells,
        lockCoverage: usableCells > 0 ? round(lockedCells / usableCells, 4) : null,
        locks: sum(rows, (row) => row.locks),
        settledLocks: sum(rows, (row) => row.settledLocks),
        reasonCounts: countReasons(due),
      };
    });
}

function summarizeBackupManifest(manifest, generatedAt) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { status: 'MISSING', latestSuccessfulAt: null, ageHours: null, checksumPresent: false };
  }
  const candidates = [];
  if (Array.isArray(manifest.backups)) candidates.push(...manifest.backups);
  if (manifest.latestSuccessfulAt) {
    candidates.push({
      status: 'SUCCESS',
      completedAt: manifest.latestSuccessfulAt,
      sha256: manifest.sha256 ?? manifest.checksum,
    });
  }
  const successful = candidates
    .filter((item) => /^(SUCCESS|OK|COMPLETE|COMPLETED)$/i.test(text(item?.status) ?? ''))
    .map((item) => ({
      completedAt: normalizeOptionalTimestamp(item?.completedAt ?? item?.createdAt ?? item?.timestamp),
      checksumPresent: Boolean(text(item?.sha256 ?? item?.checksum)),
    }))
    .filter((item) => item.completedAt)
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt));
  if (successful.length === 0) {
    return { status: 'NO_SUCCESS', latestSuccessfulAt: null, ageHours: null, checksumPresent: false };
  }
  const latest = successful[0];
  if (Date.parse(latest.completedAt) > Date.parse(generatedAt)) {
    return {
      status: 'FUTURE_TIMESTAMP',
      latestSuccessfulAt: latest.completedAt,
      ageHours: null,
      checksumPresent: latest.checksumPresent,
    };
  }
  return {
    status: 'OK',
    latestSuccessfulAt: latest.completedAt,
    ageHours: round(Math.max(0, Date.parse(generatedAt) - Date.parse(latest.completedAt)) / 3_600_000, 2),
    checksumPresent: latest.checksumPresent,
  };
}

function summarizeFreshness(snapshots, locks, generatedAt) {
  const latestSnapshotAt = latestTimestamp(snapshots.map((row) => row.capturedAt));
  const latestLockAt = latestTimestamp(locks.map((row) => row.generatedAt));
  return {
    latestSnapshotAt,
    snapshotAgeHours: ageHours(latestSnapshotAt, generatedAt),
    latestLockAt,
    lockAgeHours: ageHours(latestLockAt, generatedAt),
  };
}

function normalizeMinimums(minimums) {
  const source = minimums && typeof minimums === 'object' && !Array.isArray(minimums) ? minimums : {};
  return {
    races: nonNegativeNumber(source.races, DEFAULT_MINIMUMS.races, 'minimums.races'),
    usableCells: nonNegativeNumber(source.usableCells, DEFAULT_MINIMUMS.usableCells, 'minimums.usableCells'),
    locks: nonNegativeNumber(source.locks, DEFAULT_MINIMUMS.locks, 'minimums.locks'),
    settledLocks: nonNegativeNumber(source.settledLocks, DEFAULT_MINIMUMS.settledLocks, 'minimums.settledLocks'),
    settlementCoverage: ratio(source.settlementCoverage, DEFAULT_MINIMUMS.settlementCoverage, 'minimums.settlementCoverage'),
    perPoolWindowUsableCells: nonNegativeNumber(
      source.perPoolWindowUsableCells,
      DEFAULT_MINIMUMS.perPoolWindowUsableCells,
      'minimums.perPoolWindowUsableCells',
    ),
    requiredPools: normalizeRequiredValues(source.requiredPools, DEFAULT_MINIMUMS.requiredPools, canonicalPool, 'requiredPools'),
    requiredWindows: normalizeRequiredValues(source.requiredWindows, DEFAULT_MINIMUMS.requiredWindows, canonicalWindow, 'requiredWindows'),
    requireBackup: booleanValue(source.requireBackup, DEFAULT_MINIMUMS.requireBackup),
    requireBackupChecksum: source.requireBackupChecksum == null
      ? DEFAULT_MINIMUMS.requireBackupChecksum
      : booleanValue(source.requireBackupChecksum, DEFAULT_MINIMUMS.requireBackupChecksum),
    backupMaxAgeHours: nonNegativeNumber(
      source.backupMaxAgeHours,
      DEFAULT_MINIMUMS.backupMaxAgeHours,
      'minimums.backupMaxAgeHours',
    ),
  };
}

function addMinimumDeficit(deficits, metric, actualValue, required) {
  const actual = finiteNumber(actualValue);
  if (actual == null || actual < required) deficits.push({ metric, required, actual });
}

function addMaximumDeficit(deficits, metric, actualValue, required) {
  const actual = finiteNumber(actualValue);
  if (actual == null || actual > required) deficits.push({ metric, required, actual });
}

function canonicalPool(value) {
  const compact = String(value ?? '').trim().toUpperCase().replaceAll(/[^A-Z]/g, '');
  if (compact === 'WIN') return 'WIN';
  if (['PLA', 'PLACE'].includes(compact)) return 'PLA';
  if (['QIN', 'QUINELLA'].includes(compact)) return 'QIN';
  if (['QPL', 'QUINELLAPLACE', 'QUINELLAPLA'].includes(compact)) return 'QPL';
  return null;
}

function canonicalWindow(value) {
  const match = String(value ?? '').trim().toUpperCase().match(/^T-?(30|10|3)$/);
  return match ? `T-${match[1]}` : null;
}

function canonicalReason(value) {
  const normalized = String(value ?? '').trim().toLowerCase().replaceAll(/[_\s]+/g, '-');
  if (/missing.*racecard|racecard.*missing/.test(normalized)) return 'missingRacecard';
  if (/offline|network-unavailable/.test(normalized)) return 'offline';
  if (/collector.*error|capture.*error|fetch.*error|failed/.test(normalized)) return 'collectorError';
  if (/duplicate/.test(normalized)) return 'duplicate';
  if (/not.*sell|stop.*sell|closed|suspend/.test(normalized)) return 'notSelling';
  if (/missed.*window/.test(normalized)) return 'missedWindow';
  if (/captured|success/.test(normalized)) return 'captured';
  return null;
}

function countReasons(cells) {
  const counts = normalizeReasonCounts();
  for (const cell of cells) {
    if (Object.hasOwn(counts, cell.reason)) counts[cell.reason] += 1;
  }
  return counts;
}

function normalizeReasonCounts(value = {}) {
  return Object.fromEntries([
    'missingRacecard',
    'offline',
    'collectorError',
    'duplicate',
    'notSelling',
    'missedWindow',
  ].map((key) => [key, finiteCount(value?.[key])]));
}

function sanitizeAggregateRows(rows, labels) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    ...Object.fromEntries(labels.map((label) => [
      label,
      label === 'pool' ? canonicalPool(row?.[label]) : canonicalWindow(row?.[label]),
    ])),
    dueCells: finiteCount(row?.dueCells),
    usableCells: finiteCount(row?.usableCells),
    missingCells: finiteCount(row?.missingCells),
    lockedCells: finiteCount(row?.lockedCells),
    lockCoverage: nullableRatio(row?.lockCoverage),
    reasonCounts: normalizeReasonCounts(row?.reasonCounts),
  }));
}

function sanitizeGate(gate) {
  if (!gate || typeof gate !== 'object' || Array.isArray(gate)) return null;
  return {
    version: gate.version ?? null,
    status: gate.status === 'READY' ? 'READY' : 'BLOCKED_DATA',
    cashMode: 'NO_BET',
    declaredMinimums: sanitizeDeclaredMinimums(gate.declaredMinimums),
    deficits: Array.isArray(gate.deficits)
      ? gate.deficits.map(sanitizeDeficit).filter(Boolean)
      : [],
    roiRead: false,
  };
}

function sanitizeDeclaredMinimums(value = {}) {
  return {
    races: nullableNonNegative(value.races),
    usableCells: nullableNonNegative(value.usableCells),
    locks: nullableNonNegative(value.locks),
    settledLocks: nullableNonNegative(value.settledLocks),
    settlementCoverage: nullableRatio(value.settlementCoverage),
    perPoolWindowUsableCells: nullableNonNegative(value.perPoolWindowUsableCells),
    requiredPools: Array.isArray(value.requiredPools) ? value.requiredPools.map(canonicalPool).filter(Boolean) : [],
    requiredWindows: Array.isArray(value.requiredWindows) ? value.requiredWindows.map(canonicalWindow).filter(Boolean) : [],
    requireBackup: value.requireBackup === true,
    requireBackupChecksum: value.requireBackupChecksum === true,
    backupMaxAgeHours: nullableNonNegative(value.backupMaxAgeHours),
  };
}

function sanitizeDeficit(item) {
  const metric = text(item?.metric);
  if (!metric || !/^[A-Za-z0-9.-]+$/.test(metric)) return null;
  return {
    metric,
    required: safeGateValue(item.required),
    actual: safeGateValue(item.actual),
  };
}

function safeGateValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean' || value == null) return value;
  return ['OK', 'MISSING', 'NO_SUCCESS', 'FUTURE_TIMESTAMP'].includes(value) ? value : null;
}

function racePostAt(race) {
  if (text(race.postAt)) return normalizeOptionalTimestamp(race.postAt);
  if (!text(race.date) || !text(race.startTime)) return null;
  if (/^\d{2}:\d{2}(?::\d{2})?$/.test(race.startTime)) {
    const time = race.startTime.length === 5 ? `${race.startTime}:00` : race.startTime;
    return normalizeOptionalTimestamp(`${race.date}T${time}+08:00`);
  }
  return normalizeOptionalTimestamp(race.startTime);
}

function windowDueAt(postAt, targetMinutes) {
  if (!postAt) return Number.NEGATIVE_INFINITY;
  return Date.parse(postAt) - targetMinutes * 60_000;
}

function windowForMinutes(value) {
  if (value == null) return null;
  return WINDOWS.find((window) => value >= window.minMinutes && value <= window.maxMinutes)?.label ?? null;
}

function minutesBetween(capturedAt, postAt) {
  if (!capturedAt || !postAt) return null;
  const difference = Date.parse(postAt) - Date.parse(capturedAt);
  return Number.isFinite(difference) ? difference / 60_000 : null;
}

function meetingKey(value) {
  const date = text(value?.date) ?? inferRaceDate(value?.raceId);
  const racecourse = text(value?.racecourse)?.toUpperCase() ?? inferRacecourse(value?.raceId);
  return date && racecourse ? `${date}-${racecourse}` : 'UNKNOWN';
}

function inferRaceDate(raceId) {
  return String(raceId ?? '').match(/^(\d{4}-\d{2}-\d{2})-/)?.[1] ?? null;
}

function inferRacecourse(raceId) {
  return String(raceId ?? '').match(/^\d{4}-\d{2}-\d{2}-([A-Za-z]+)-R\d+$/)?.[1]?.toUpperCase() ?? null;
}

function compareRace(left, right) {
  return String(left.date ?? '').localeCompare(String(right.date ?? ''))
    || String(left.racecourse ?? '').localeCompare(String(right.racecourse ?? ''))
    || (left.raceNo ?? 0) - (right.raceNo ?? 0)
    || left.raceId.localeCompare(right.raceId);
}

function normalizeFreezeDate(value) {
  if (value == null || value === '') return null;
  const match = String(value).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match || !Number.isFinite(Date.parse(`${match[1]}T00:00:00Z`))) {
    throw new Error('freeze must be a valid YYYY-MM-DD date');
  }
  return match[1];
}

function isOnOrAfterFreeze(date, freezeDate) {
  return !freezeDate || (date != null && String(date).slice(0, 10) >= freezeDate);
}

function normalizeTimestamp(value, label) {
  const normalized = normalizeOptionalTimestamp(value);
  if (!normalized) throw new Error(`${label} must be a valid timestamp`);
  return normalized;
}

function normalizeOptionalTimestamp(value) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function normalizeRequiredValues(value, fallback, normalizer, label) {
  const source = Array.isArray(value) ? value : fallback;
  const result = [...new Set(source.map(normalizer).filter(Boolean))];
  if (result.length === 0) throw new Error(`minimums.${label} must not be empty`);
  return result;
}

function booleanValue(value, fallback) {
  if (value == null) return fallback;
  if (value === true || String(value).toLowerCase() === 'true') return true;
  if (value === false || String(value).toLowerCase() === 'false') return false;
  throw new Error('boolean minimum must be true or false');
}

function nonNegativeNumber(value, fallback, label) {
  const number = value == null ? fallback : Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} must be non-negative`);
  return number;
}

function ratio(value, fallback, label) {
  const number = value == null ? fallback : Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(`${label} must be between 0 and 1`);
  return number;
}

function nullableRatio(value) {
  const number = finiteNumber(value);
  return number == null || number < 0 || number > 1 ? null : number;
}

function nullableNonNegative(value) {
  const number = finiteNumber(value);
  return number == null || number < 0 ? null : number;
}

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function latestTimestamp(values) {
  return values.filter(Boolean).sort().at(-1) ?? null;
}

function ageHours(value, generatedAt) {
  if (!value) return null;
  const difference = Date.parse(generatedAt) - Date.parse(value);
  return Number.isFinite(difference) && difference >= 0 ? round(difference / 3_600_000, 2) : null;
}

function finiteInteger(value) {
  const number = finiteNumber(value);
  return number == null ? null : Math.trunc(number);
}

function finiteCount(value) {
  const number = finiteNumber(value);
  return number == null || number < 0 ? 0 : Math.trunc(number);
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function round(value, digits) {
  return Number(Number(value).toFixed(digits));
}

function sum(values, selector) {
  return values.reduce((total, value) => total + Number(selector(value) ?? 0), 0);
}
