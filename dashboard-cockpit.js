export const COCKPIT_DESTINATIONS = Object.freeze([
  Object.freeze({ id: 'today', label: '今日', symbol: '●' }),
  Object.freeze({ id: 'review', label: '复盘', symbol: '↺' }),
  Object.freeze({ id: 'research', label: '研究', symbol: '◇' }),
  Object.freeze({ id: 'more', label: '更多', symbol: '•••' }),
]);

const DESTINATION_IDS = new Set(COCKPIT_DESTINATIONS.map((item) => item.id));

export function normalizeCockpitDestination(value = '') {
  const id = String(value).trim().replace(/^#/, '');
  return DESTINATION_IDS.has(id) ? id : 'today';
}

export function buildCockpitViewModel(options = {}) {
  const {
    snapshot = {},
    entry = null,
    entries = [],
    availability = {},
    portfolio = null,
    executionPolicy = {},
    refreshStatus = 'ready',
  } = options;
  const raceContext = entry && Number.isFinite(Number(entry.raceNo))
    ? `R${Number(entry.raceNo)}`
    : null;
  const cashLines = Array.isArray(portfolio?.cashLines) ? portfolio.cashLines : [];
  const watchLines = Array.isArray(portfolio?.watchLines) ? portfolio.watchLines : [];
  const hardBlock = refreshStatus === 'error'
    || executionPolicy.allowExecutableRecommendations !== true;
  const sourceLines = cashLines.length ? cashLines : watchLines;

  let state;
  if (hardBlock) state = 'BLOCK';
  else if (!entry) state = 'NO_MEETING';
  else if (entry.settlement) state = 'SETTLED';
  else if (availability.canBetNow !== true) state = 'WAIT';
  else if (cashLines.length) state = raceContext ? 'PLAY' : 'BLOCK';
  else if (watchLines.length) state = 'WATCH';
  else state = 'NO_BET';

  const canExecute = state === 'PLAY' && raceContext !== null;
  const lines = sourceLines.map((line) => ({
    context: `${raceContext ?? 'R-'} · ${line.type ?? line.label ?? 'BET'} · ${formatSelections(line.selections)}`,
    type: line.type ?? null,
    selections: line.selections ?? [],
    amount: canExecute ? finiteAmount(line.stake) : 0,
    rationale: line.rationale ?? '',
  }));

  return {
    state,
    canExecute,
    totalStake: canExecute ? lines.reduce((sum, line) => sum + line.amount, 0) : 0,
    lines,
    raceContext,
    generatedAt: snapshot.generatedAt ?? null,
    entries: entries.map((item) => ({
      raceId: item.raceId,
      raceNo: item.raceNo,
      startTime: item.forecast?.startTime ?? null,
      settled: Boolean(item.settlement),
    })),
    headline: state === 'BLOCK' && entry && !raceContext
      ? '场次信息不完整'
      : headlineForState(state),
    reason: reasonForState({
      state,
      entry,
      availability,
      portfolio,
      executionPolicy,
      refreshStatus,
      raceContext,
    }),
  };
}

function finiteAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function formatSelections(selections) {
  if (!Array.isArray(selections) || !selections.length) return '-';
  return selections.map((selection) => {
    if (selection && typeof selection === 'object') {
      return String(selection.horseNo ?? selection.horseName ?? selection.horseId ?? '?');
    }
    return String(selection);
  }).join('+');
}

function headlineForState(state) {
  if (state === 'NO_MEETING') return '今天不可下注';
  if (state === 'PLAY') return '本场可执行建议';
  if (state === 'SETTLED') return '本场已经结算';
  if (state === 'WATCH') return '观察赔率，暂不下注';
  if (state === 'BLOCK') return '数据或风险闸阻断';
  return '暂不下注';
}

function reasonForState({
  state,
  entry,
  availability,
  portfolio,
  executionPolicy,
  refreshStatus,
  raceContext,
}) {
  if (refreshStatus === 'error') return '刷新失败，旧方案已自动阻断。';
  if (executionPolicy.allowExecutableRecommendations !== true) {
    return executionPolicy.reason ?? '发布边界不允许执行下注。';
  }
  if (!entry) return '还没有确认今日香港本地赛程。';
  if (state === 'BLOCK' && !raceContext) return '场次信息不完整，不能生成可执行建议。';
  if (state === 'SETTLED') return '赛事已经结算，请进入复盘。';
  if (availability.canBetNow !== true) {
    return availability.detail ?? '当前不在可检查的赛马日。';
  }
  return portfolio?.summary ?? '没有通过全部执行门槛的组合。';
}

export function buildProspectiveCoverageView(report) {
  const s = report?.summary;
  const count = value => Number.isInteger(value) && value >= 0;
  if (report?.version !== 'prospective-coverage-v1' || !s
    || !Number.isFinite(Date.parse(report.generatedAt))
    || ![s.races, s.dueRaces, s.usableRaces].every(count)
    || s.usableRaces > s.dueRaces || s.dueRaces > s.races) {
    return { available: false, cashMode: 'NO_BET' };
  }
  const required = report.gate?.declaredMinimums?.races;
  return {
    available: true,
    generatedAt: report.generatedAt,
    cashMode: 'NO_BET',
    loadedRaces: s.races,
    usableRaces: s.usableRaces,
    futureRaces: s.races - s.dueRaces,
    missingCells: count(s.missingCells) ? s.missingCells : null,
    settledLocks: count(s.settledLocks) ? s.settledLocks : null,
    racesNeeded: count(required) ? Math.max(0, required - s.usableRaces) : null,
    requiredRaces: count(required) ? required : null,
    gateStatus: ['READY', 'BLOCKED_DATA'].includes(report.gate?.status) ? report.gate.status : 'UNKNOWN',
    cells: (Array.isArray(report.byPoolWindow) ? report.byPoolWindow : []).map(row => ({
      pool: String(row.pool ?? ''),
      window: String(row.window ?? ''),
      usable: count(row.usableCells) ? row.usableCells : null,
      due: count(row.dueCells) ? row.dueCells : null,
      missing: count(row.missingCells) ? row.missingCells : null,
    })),
  };
}
