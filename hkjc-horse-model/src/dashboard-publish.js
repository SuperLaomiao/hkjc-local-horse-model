const DEFAULT_EMBEDDED_LEDGER_LIMIT = 240;
const DEFAULT_EMBEDDED_PERFORMANCE_MEETING_LIMIT = 40;
const DEFAULT_HISTORY_URL = 'dashboard-history.json';

export function splitDashboardForPublishing(snapshot, options = {}) {
  const ledger = Array.isArray(snapshot?.ledger) ? snapshot.ledger : [];
  const embeddedLedgerLimit = normalizeLimit(options.embeddedLedgerLimit);
  const embeddedLedger = embeddedLedgerLimit > 0 ? ledger.slice(-embeddedLedgerLimit) : [];
  const fullPerformance = snapshot?.performance;
  const performanceMeetings = Array.isArray(fullPerformance?.byMeeting) ? fullPerformance.byMeeting : [];
  const embeddedPerformanceMeetingLimit = normalizeLimit(
    options.embeddedPerformanceMeetingLimit,
    DEFAULT_EMBEDDED_PERFORMANCE_MEETING_LIMIT,
  );
  const embeddedPerformanceMeetings = embeddedPerformanceMeetingLimit > 0
    ? performanceMeetings.slice(0, embeddedPerformanceMeetingLimit)
    : [];
  const historyUrl = options.historyUrl ?? DEFAULT_HISTORY_URL;

  const history = {
    ...(snapshot.history ?? {}),
    ledgerUrl: historyUrl,
    totalLedgerEntries: ledger.length,
    embeddedLedgerEntries: embeddedLedger.length,
    isLedgerTruncated: embeddedLedger.length < ledger.length,
    totalPerformanceMeetings: performanceMeetings.length,
    embeddedPerformanceMeetings: embeddedPerformanceMeetings.length,
    isPerformanceTruncated: embeddedPerformanceMeetings.length < performanceMeetings.length,
    note: 'Public dashboard embeds only recent ledger rows; full history is stored separately for model training and backtesting.',
  };

  const publicSnapshot = {
    ...snapshot,
    ledger: embeddedLedger,
    performance: trimPerformance(fullPerformance, embeddedPerformanceMeetings),
    history,
  };

  const historySnapshot = {
    generatedAt: snapshot.generatedAt,
    scope: snapshot.scope,
    summary: snapshot.summary,
    dataSource: snapshot.dataSource,
    assumptions: snapshot.assumptions,
    performance: fullPerformance,
    ledger,
  };

  return {
    publicSnapshot,
    historySnapshot,
  };
}

function trimPerformance(performance, embeddedPerformanceMeetings) {
  if (!performance || !Array.isArray(performance.byMeeting)) return performance;
  return {
    ...performance,
    byMeeting: embeddedPerformanceMeetings,
  };
}

function normalizeLimit(value, fallback = DEFAULT_EMBEDDED_LEDGER_LIMIT) {
  if (value == null) return fallback;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(0, Math.floor(numberValue));
}
