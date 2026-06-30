import {
  createLockedForecast,
  createUserPick,
  settleLockedForecast,
  settleUserPick,
  summarizeUserPicks,
} from "./self-test.js";

const DATA_URL = "./data/dashboard.json";
const appRoot = document.querySelector("#hkjc-app");
const STORAGE_KEYS = {
  userPicks: "hkjc.selfTest.userPicks.v1",
  lockedForecasts: "hkjc.selfTest.lockedForecasts.v1",
};

const uiState = {
  snapshot: null,
  selectedRaceId: null,
  filter: "all",
  isRefreshing: false,
  refreshStatus: "ready",
  refreshedAt: null,
  userPicks: [],
  lockedForecasts: [],
};

init();

async function init() {
  loadLocalRecords();
  await refreshDashboardData({ initial: true });
  registerServiceWorker();
}

function loadLocalRecords() {
  uiState.userPicks = readLocalArray(STORAGE_KEYS.userPicks);
  uiState.lockedForecasts = readLocalArray(STORAGE_KEYS.lockedForecasts);
}

function saveLocalRecords() {
  writeLocalArray(STORAGE_KEYS.userPicks, uiState.userPicks);
  writeLocalArray(STORAGE_KEYS.lockedForecasts, uiState.lockedForecasts);
}

function readLocalArray(key) {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalArray(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Browser storage may be disabled; the page still works without persistence.
  }
}

async function refreshDashboardData({ initial = false } = {}) {
  if (uiState.isRefreshing) return;
  uiState.isRefreshing = true;
  uiState.refreshStatus = initial ? "loading-initial" : "loading";
  if (!initial && uiState.snapshot) render();

  try {
    const response = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Dashboard data not found: ${response.status}`);
    }

    const nextSnapshot = await response.json();
    uiState.snapshot = nextSnapshot;
    uiState.selectedRaceId = resolveSelectedRaceId(nextSnapshot, uiState.selectedRaceId);
    uiState.refreshedAt = new Date().toISOString();
    uiState.refreshStatus = initial ? "ready" : "success";
    render();
  } catch (error) {
    uiState.refreshStatus = "error";
    if (initial || !uiState.snapshot) {
      renderMissingData(error);
    } else {
      render();
    }
  } finally {
    uiState.isRefreshing = false;
    if (uiState.snapshot) render();
  }
}

function resolveSelectedRaceId(snapshot, preferredRaceId) {
  const entries = getAllEntries(snapshot);
  if (preferredRaceId && entries.some((entry) => entry.raceId === preferredRaceId)) return preferredRaceId;
  return snapshot.latestUpcomingForecast?.raceId
    ?? snapshot.latestForecast?.raceId
    ?? snapshot.recentEntries?.at(-1)?.raceId
    ?? entries[0]?.raceId
    ?? null;
}

function render() {
  const snapshot = uiState.snapshot;
  const entries = getAllEntries(snapshot);
  const selectedEntry = entries.find((entry) => entry.raceId === uiState.selectedRaceId) ?? entries[0];
  const todayStatus = localRaceDayStatus(snapshot);

  if (!selectedEntry) {
    renderMissingData(new Error("No HKJC local races or race-card forecasts found in dashboard data."));
    return;
  }

  appRoot.innerHTML = `
    <div class="terminal">
      <header class="topbar">
        <div class="brand">
          <h1>HK Local Horse Model</h1>
          <p>香港本地赛马 · 赛前预测 · 赛后复盘 · Rolling ROI</p>
        </div>
        <div class="meta-strip" aria-label="dashboard metadata">
          <span>${escapeHtml(snapshot.scope)}</span>
          <span>${formatDateTime(snapshot.generatedAt)}</span>
          <span>${snapshot.summary.racesSettled} settled races</span>
          <span>${snapshot.upcomingEntries?.length ?? 0} upcoming forecasts</span>
          <span>${escapeHtml(nextMeetingLabel(snapshot))}</span>
        </div>
      </header>

      ${renderMeetingForecastPanel(snapshot, todayStatus)}

      <section class="dashboard">
        <aside class="panel side-panel">
          <div class="panel-header">
            <div>
              <h2>每周结果 Ledger</h2>
              <p>选择一场，查看赛前预测、待赛或官方赛果。</p>
            </div>
          </div>
          <div class="race-list">
            ${entries.map((entry) => renderRaceButton(entry, selectedEntry.raceId)).join("")}
          </div>
        </aside>

        <main class="main-stack">
          ${renderScoreStrip(snapshot.summary)}
          ${renderPredictionPanel(selectedEntry)}
          ${renderComparisonPanel(snapshot.ledger)}
          ${renderPerformancePanel(snapshot)}
        </main>

        <aside class="right-stack">
          ${renderFinalBetPlanPanel(selectedEntry, snapshot, todayStatus)}
          ${renderSelfTestPanel(selectedEntry, entries)}
          ${renderRecommendationPanel(selectedEntry.forecast.recommendation)}
          ${renderSettlementPanel(selectedEntry.settlement)}
          ${renderChartPanel(snapshot.ledger)}
          ${renderNotesPanel(snapshot.assumptions, snapshot)}
        </aside>
      </section>
      ${renderMobileActionBar(selectedEntry, todayStatus)}
    </div>
  `;

  bindEvents();
}

function renderRaceButton(entry, selectedRaceId) {
  const label = `${entry.date} ${entry.racecourse} R${entry.raceNo}`;
  const pick = entry.forecast.recommendation?.horseName ?? "PASS";
  const resultLabel = entry.settlement?.resultLabel ?? "UPCOMING";
  const profit = entry.settlement?.profit ?? 0;
  return `
    <button class="race-row ${entry.raceId === selectedRaceId ? "is-active" : ""}" data-race-select-id="${entry.raceId}">
      <span>
        <strong>${escapeHtml(label)}</strong>
        <span>${escapeHtml(pick)} · ${escapeHtml(resultLabel)}</span>
      </span>
        <span class="race-profit ${profitClass(profit)}">${entry.settlement ? formatSignedMoney(profit) : "待赛"}</span>
    </button>
  `;
}

function renderScoreStrip(summary) {
  return `
    <section class="score-strip" aria-label="model summary">
      <div class="score-cell">
        <span>模型 Value ROI</span>
        <strong class="${profitClass(summary.roi)}">${formatPercent(summary.roi)}</strong>
      </div>
      <div class="score-cell">
        <span>累计盈利</span>
        <strong class="${profitClass(summary.profit)}">${formatSignedMoney(summary.profit)}</strong>
      </div>
      <div class="score-cell">
        <span>Value 命中</span>
        <strong>${summary.valueWins}/${summary.valueBets}</strong>
      </div>
      <div class="score-cell">
        <span>Top Pick 胜率</span>
        <strong>${formatPercent(summary.topPickWinRate)}</strong>
      </div>
    </section>
  `;
}

function renderPredictionPanel(entry) {
  const forecast = entry.forecast;
  const userPick = selectedEntryUserPick(entry);
  const rows = (forecast.predictions ?? [])
    .filter((runner) => uiState.filter === "all" || passesValueFilter(runner))
    .slice(0, uiState.filter === "all" ? 14 : 8);

  return `
    <section class="panel prediction-panel">
      <div class="race-toolbar">
        <div class="race-title">
          <strong>赛前预测 · ${escapeHtml(forecast.date)} ${escapeHtml(forecast.racecourse)} Race ${forecast.raceNo}</strong>
          <span>${forecast.startTime ? `${escapeHtml(forecast.startTime)} · ` : ""}${forecast.distance ?? "-"}m · ${escapeHtml(forecast.surface ?? "-")} · ${escapeHtml(forecast.going ?? "-")} · trained on ${forecast.trainingRacesBefore} prior races</span>
        </div>
        <div class="segmented" role="group" aria-label="prediction filter">
          <button class="${uiState.filter === "all" ? "is-active" : ""}" data-filter="all">All runners</button>
          <button class="${uiState.filter === "value" ? "is-active" : ""}" data-filter="value">Shortlist</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Horse</th>
              <th>Model Win%</th>
              <th>Fair Odds</th>
              <th>Market Odds</th>
              <th>Value Edge</th>
              <th>Draw</th>
              <th>Jockey / Trainer</th>
              <th>我的测试</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length
              ? rows.map((runner, index) => renderPredictionRow(runner, index, entry, userPick)).join("")
              : '<tr><td colspan="9" class="muted">No runner clears the current value filter.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderPredictionRow(runner, index, entry, userPick) {
  const isPicked = userPick?.horseId === runner.horseId;
  return `
    <tr>
      <td><span class="rank-mark">${index + 1}</span></td>
      <td>
        <span class="horse-name">${escapeHtml(runner.horseName)}</span>
        <span class="subline">No. ${runner.horseNo ?? "-"} · ${escapeHtml(runner.horseId ?? "-")}</span>
      </td>
      <td>${formatPercent(runner.probability)}</td>
      <td>${formatOdds(runner.fairOdds)}</td>
      <td>${formatOdds(runner.winOdds)}</td>
      <td class="${Number(runner.edge) >= 0 ? "edge-positive" : "edge-negative"}">${formatPercent(runner.edge)}</td>
      <td>${runner.draw ?? "-"}</td>
      <td>
        ${escapeHtml(runner.jockey ?? "-")}
        <span class="subline">${escapeHtml(runner.trainer ?? "-")}</span>
      </td>
      <td class="runner-action">
        <button class="pick-runner-button ${isPicked ? "is-picked" : ""}" data-user-pick-horse-id="${escapeHtml(runner.horseId)}" data-race-id="${escapeHtml(entry.raceId)}">
          ${isPicked ? "已选" : "我选这匹"}
        </button>
      </td>
    </tr>
  `;
}

function passesValueFilter(runner) {
  const minProbability = Number(uiState.snapshot?.assumptions?.minProbability ?? 0.15);
  const minEdge = Number(uiState.snapshot?.assumptions?.minEdge ?? 0);
  if (!Number.isFinite(Number(runner.edge))) {
    return Number(runner.probability) >= minProbability;
  }
  return Number(runner.edge) >= minEdge && Number(runner.probability) >= minProbability;
}

function renderFinalBetPlanPanel(entry, snapshot, todayStatus) {
  if (todayStatus.noLocalRaceToday) {
    return renderNoLocalRacePlanPanel(snapshot, todayStatus);
  }

  const plan = entry.forecast.finalBetPlan;
  const recommendation = entry.forecast.recommendation;
  const resolvedPlan = plan ?? fallbackBetPlan(recommendation);
  const isPass = resolvedPlan.mode === "pass";
  const isPrepare = resolvedPlan.mode === "prepare" || resolvedPlan.mode === "conditional";
  const badgeClass = isPass ? "is-pass" : isPrepare ? "is-prepare" : "is-execute";
  const horseLabel = resolvedPlan.horseName
    ? `${resolvedPlan.horseNo ? `No. ${resolvedPlan.horseNo} · ` : ""}${resolvedPlan.horseName}`
    : "不下注";

  return `
    <section class="panel bet-plan-panel">
      <div class="panel-header">
        <div>
          <h3>最终下注方案</h3>
          <p>赛前 15 分钟复核，10-5 分钟才执行。</p>
        </div>
        <div class="panel-actions">
          ${renderLockForecastButton(entry)}
          ${renderRefreshButton("刷新最新赔率/方案", "panel")}
        </div>
      </div>
      <div class="bet-plan-body">
        <span class="plan-badge ${badgeClass}">${escapeHtml(resolvedPlan.label)}</span>
        <h2 class="plan-title">${escapeHtml(horseLabel)}</h2>
        <p class="plan-headline">${escapeHtml(resolvedPlan.headline)}</p>
        <div class="plan-grid">
          <div>
            <span>入场窗口</span>
            <strong>${escapeHtml(resolvedPlan.entryWindow)}</strong>
          </div>
          <div>
            <span>当前赔率</span>
            <strong>${formatOdds(resolvedPlan.currentOdds)}</strong>
          </div>
          <div>
            <span>最低赔率线</span>
            <strong>${formatOdds(resolvedPlan.minimumOdds)}</strong>
          </div>
          <div>
            <span>计划注码</span>
            <strong>${formatMoney(resolvedPlan.plannedStake)}</strong>
          </div>
          <div>
            <span>Bet Type</span>
            <strong>${escapeHtml(resolvedPlan.betType ?? "WIN")}</strong>
          </div>
          <div>
            <span>赔率来源</span>
            <strong>${escapeHtml(oddsSourceLabel(resolvedPlan))}</strong>
          </div>
        </div>
        <div class="refresh-status ${uiState.refreshStatus === "error" ? "is-error" : ""}">
          ${escapeHtml(refreshStatusText(snapshot))}
        </div>
        <div class="plan-timeline">
          ${renderPlanStep("T-15", resolvedPlan.reviewWindow)}
          ${renderPlanStep("T-10 至 T-5", resolvedPlan.entryWindow)}
          ${renderPlanStep("停止线", resolvedPlan.cutoffWindow)}
        </div>
        <div class="plan-rules">
          <strong>执行条件</strong>
          <ul>
            ${(resolvedPlan.checklist ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
          </ul>
          <strong>放弃条件</strong>
          <ul>
            ${(resolvedPlan.stopRules ?? []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
          </ul>
        </div>
      </div>
    </section>
  `;
}

function renderNoLocalRacePlanPanel(snapshot, todayStatus) {
  const nextMeeting = todayStatus.nextMeeting ? formatMeeting(todayStatus.nextMeeting) : "待官方赛程更新";
  const latestRace = todayStatus.latestRaceDate ? `${todayStatus.latestRaceDate} ${todayStatus.latestRacecourse ?? ""}`.trim() : "-";

  return `
    <section class="panel bet-plan-panel">
      <div class="panel-header">
        <div>
          <h3>最终下注方案</h3>
          <p>今天没有香港本地赛马卡，刷新不会生成下注。</p>
        </div>
        ${renderRefreshButton("刷新最新赛程/方案", "panel")}
      </div>
      <div class="bet-plan-body">
        <span class="plan-badge is-idle">NO LOCAL RACE / 今日无本地赛</span>
        <h2 class="plan-title">今天不下注</h2>
        <p class="plan-headline">刷新成功，但 ${escapeHtml(todayStatus.today)} 没有可执行的香港本地赛马。下一场本地赛事：${escapeHtml(nextMeeting)}。</p>
        <div class="plan-grid">
          <div>
            <span>今日日期</span>
            <strong>${escapeHtml(todayStatus.today)}</strong>
          </div>
          <div>
            <span>下一场本地赛事</span>
            <strong>${escapeHtml(nextMeeting)}</strong>
          </div>
          <div>
            <span>最新已结算</span>
            <strong>${escapeHtml(latestRace)}</strong>
          </div>
          <div>
            <span>赛前卡状态</span>
            <strong>${snapshot.upcomingEntries?.length ?? 0} 场待赛</strong>
          </div>
          <div>
            <span>计划注码</span>
            <strong>$0</strong>
          </div>
          <div>
            <span>刷新作用</span>
            <strong>确认官方最新数据</strong>
          </div>
        </div>
        <div class="refresh-status ${uiState.refreshStatus === "error" ? "is-error" : ""}">
          ${escapeHtml(refreshStatusText(snapshot))}
        </div>
        <div class="plan-timeline">
          ${renderPlanStep("赛前卡", "等 HKJC 发布本地 Race Card 后才生成预测")}
          ${renderPlanStep("T-15", "有比赛日才复核马表、退出马、场地和实时赔率")}
          ${renderPlanStep("停止线", "没有本地赛事或没有实时赔率，不下注")}
        </div>
        <div class="plan-rules">
          <strong>执行条件</strong>
          <ul>
            <li>必须有今日香港本地赛事和官方赛前马表。</li>
            <li>必须在开跑前 10-5 分钟，实时赔率仍高于最低赔率线。</li>
          </ul>
          <strong>放弃条件</strong>
          <ul>
            <li>今天无本地赛，直接 PASS。</li>
            <li>不要把昨日赛果或海外转播赛事当作本地下注方案。</li>
          </ul>
        </div>
      </div>
    </section>
  `;
}

function renderRefreshButton(label, variant = "") {
  const text = uiState.isRefreshing ? "刷新中..." : label;
  return `
    <button class="refresh-plan-button ${variant ? `is-${variant}` : ""}" data-refresh-plan ${uiState.isRefreshing ? "disabled" : ""}>
      <span>${escapeHtml(text)}</span>
    </button>
  `;
}

function renderLockForecastButton(entry) {
  const locked = selectedEntryLockedForecast(entry);
  return `
    <button class="lock-forecast-button ${locked ? "is-locked" : ""}" data-lock-forecast data-race-id="${escapeHtml(entry.raceId)}">
      ${locked ? "已锁定" : "锁定本场预测"}
    </button>
  `;
}

function renderMobileActionBar(entry, todayStatus) {
  if (todayStatus.noLocalRaceToday) {
    const nextMeeting = todayStatus.nextMeeting ? formatMeeting(todayStatus.nextMeeting) : "待官方更新";
    return `
      <div class="mobile-action-bar" aria-label="mobile final action">
        <div>
          <span>今日无本地赛</span>
          <strong>下一场 ${escapeHtml(nextMeeting)}</strong>
        </div>
        ${renderRefreshButton("刷新", "mobile")}
      </div>
    `;
  }

  const plan = entry.forecast.finalBetPlan ?? fallbackBetPlan(entry.forecast.recommendation);
  return `
    <div class="mobile-action-bar" aria-label="mobile final action">
      <div>
        <span>${escapeHtml(plan.label ?? "方案")}</span>
        <strong>${escapeHtml(plan.horseName ? `${plan.horseNo ? `No. ${plan.horseNo} · ` : ""}${plan.horseName}` : "不下注")}</strong>
      </div>
      ${renderRefreshButton("刷新", "mobile")}
    </div>
  `;
}

function localRaceDayStatus(snapshot) {
  const today = hkDateString();
  const nextMeetings = snapshot.nextLocalMeetings ?? [];
  const meetingToday = nextMeetings.find((meeting) => meeting.date === today) ?? null;
  const nextMeeting = nextMeetings.find((meeting) => meeting.date >= today) ?? nextMeetings[0] ?? null;
  const latestForecast = snapshot.latestForecast ?? snapshot.recentEntries?.at(-1)?.forecast ?? null;
  const latestEntry = snapshot.recentEntries?.at(-1) ?? null;
  const latestRaceDate = latestForecast?.date ?? latestEntry?.date ?? null;
  const latestRacecourse = latestForecast?.racecourse ?? latestEntry?.racecourse ?? null;
  const upcomingCount = snapshot.upcomingEntries?.length ?? 0;
  const noLocalRaceToday = upcomingCount === 0 && !meetingToday && Boolean(latestRaceDate) && latestRaceDate < today;

  return {
    today,
    meetingToday,
    nextMeeting,
    latestRaceDate,
    latestRacecourse,
    noLocalRaceToday,
  };
}

function hkDateString(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function renderMeetingForecastPanel(snapshot, todayStatus) {
  const upcoming = snapshot.upcomingEntries ?? [];
  const firstUpcoming = upcoming[0] ?? null;
  const fixtureMeeting = todayStatus.meetingToday ?? todayStatus.nextMeeting;
  const meeting = firstUpcoming
    ? {
        date: firstUpcoming.date,
        racecourse: firstUpcoming.racecourse,
        raceCount: upcoming.filter((entry) => entry.date === firstUpcoming.date && entry.racecourse === firstUpcoming.racecourse).length,
      }
    : fixtureMeeting;

  if (!meeting) {
    return `
      <section class="meeting-forecast" aria-label="赛事预报">
        <div class="forecast-main">
          <span class="forecast-label">赛事预报</span>
          <h2>暂时没有未来香港本地赛程</h2>
          <p>刷新已检查官方 fixture；等 HKJC 更新后，这里会直接显示下一场。</p>
        </div>
        <div class="forecast-actions">
          ${renderRefreshButton("刷新赛程", "panel")}
        </div>
      </section>
    `;
  }

  const raceCardReady = upcoming.length > 0;
  const daysText = formatDaysUntil(meeting.date, todayStatus.today);
  const raceCount = Number.isFinite(Number(meeting.raceCount)) ? `${Number(meeting.raceCount)} 场` : "场次待公布";
  const advice = buildMeetingAdvice(meeting, raceCardReady, upcoming.length);
  const followingMeetings = (snapshot.nextLocalMeetings ?? [])
    .filter((item) => item.date !== meeting.date || item.racecourse !== meeting.racecourse)
    .slice(0, 3);

  return `
    <section class="meeting-forecast" aria-label="赛事预报">
      <div class="forecast-main">
        <span class="forecast-label">赛事预报</span>
        <p class="forecast-next-line">下一场香港本地赛马</p>
        <h2>${escapeHtml(formatForecastDate(meeting.date, true))} · ${escapeHtml(racecourseLabel(meeting.racecourse))}</h2>
        <div class="forecast-meta-grid">
          <div>
            <span>距离现在</span>
            <strong>${escapeHtml(daysText)}</strong>
          </div>
          <div>
            <span>预计场次</span>
            <strong>${escapeHtml(raceCount)}</strong>
          </div>
          <div>
            <span>Race Card</span>
            <strong>${raceCardReady ? "已发布" : "未发布"}</strong>
          </div>
        </div>
      </div>
      <div class="forecast-actions">
        ${renderRefreshButton("刷新最新赛程", "panel")}
        <p>${escapeHtml(raceCardReady ? `${upcoming.length} 场赛前预测已准备，先看候选；最终仍等临场赔率。` : "目前没有今日赛事；等官方 Race Card 发布后才会生成赛前预测。")}</p>
      </div>
      <div class="forecast-advice" aria-label="建议查看时间">
        ${advice.map((item) => `
          <div class="forecast-advice-step">
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.time)}</strong>
            <p>${escapeHtml(item.detail)}</p>
          </div>
        `).join("")}
      </div>
      ${followingMeetings.length ? `
        <div class="forecast-next-list">
          <span>后面几场</span>
          <strong>${followingMeetings.map((item) => `${formatForecastDate(item.date)} ${racecourseLabel(item.racecourse)}`).map(escapeHtml).join(" · ")}</strong>
        </div>
      ` : ""}
    </section>
  `;
}

function buildMeetingAdvice(meeting, raceCardReady, upcomingCount) {
  if (raceCardReady) {
    return [
      {
        label: "现在可看",
        time: `${upcomingCount} 场预测已出`,
        detail: "先看概率候选和风险，不要当作最终下注。",
      },
      {
        label: "比赛日复核",
        time: `${formatForecastDate(meeting.date)} 中午后`,
        detail: "刷新退出马、场地和赔率变化。",
      },
      {
        label: "最终方案",
        time: "每场 T-15 / T-10~T-5",
        detail: "T-15 复核，T-10 到 T-5 才看是否执行。",
      },
    ];
  }

  return [
    {
      label: "开始留意",
      time: `${formatForecastDate(addDays(meeting.date, -2))} 晚上起`,
      detail: "刷 Race Card；没有马表就没有赛前预测。",
    },
    {
      label: "重点查看",
      time: `${formatForecastDate(meeting.date)} 中午后`,
      detail: "看初版候选、场地和赔率，不提前追价。",
    },
    {
      label: "最终方案",
      time: "每场 T-15 / T-10~T-5",
      detail: "临场刷新后，只按最低赔率线决定买或不买。",
    },
  ];
}

function formatDaysUntil(dateString, todayString = hkDateString()) {
  const diff = dayNumber(dateString) - dayNumber(todayString);
  if (!Number.isFinite(diff)) return "待确认";
  if (diff < 0) return "已结束";
  if (diff === 0) return "今天";
  if (diff === 1) return "明天";
  return `还有 ${diff} 天`;
}

function formatForecastDate(dateString, includeYear = false) {
  const parts = parseDateString(dateString);
  if (!parts) return dateString ?? "-";
  const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()];
  const shortDate = `${parts.month}月${parts.day}日 ${weekday}`;
  return includeYear ? `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")} ${weekday}` : shortDate;
}

function racecourseLabel(code) {
  if (code === "ST") return "沙田 ST";
  if (code === "HV") return "跑马地 HV";
  return code ?? "-";
}

function addDays(dateString, offset) {
  const parts = parseDateString(dateString);
  if (!parts) return dateString;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + offset));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function dayNumber(dateString) {
  const parts = parseDateString(dateString);
  if (!parts) return Number.NaN;
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86400000);
}

function parseDateString(dateString) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString ?? ""));
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function renderPlanStep(label, value) {
  return `
    <div class="plan-step">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value ?? "-")}</strong>
    </div>
  `;
}

function oddsSourceLabel(plan) {
  if (!Number.isFinite(Number(plan.currentOdds))) return "待实时赔率";
  return plan.mode === "pass" && plan.plannedStake === 0 ? "官方/最新数据" : "最新数据";
}

function fallbackBetPlan(recommendation = {}) {
  return {
    mode: recommendation.action === "value" ? "conditional" : "pass",
    label: recommendation.action === "value" ? "WAIT / 等赔率" : "NO BET / 不买",
    headline: recommendation.message ?? "No final betting plan is available for this race.",
    betType: "WIN",
    horseName: recommendation.horseName ?? null,
    horseNo: recommendation.horseNo ?? null,
    minimumOdds: recommendation.fairOdds ?? null,
    plannedStake: recommendation.action === "value" ? recommendation.suggestedStake : 0,
    entryWindow: "开跑前 10-5 分钟",
    reviewWindow: "开跑前 15 分钟复核",
    cutoffWindow: "不强行下注",
    checklist: ["下注前必须刷新实时赔率和官方临场变化。"],
    stopRules: ["最终 value edge 不清楚就 PASS。"],
  };
}

function renderRecommendationPanel(recommendation) {
  const isPass = recommendation.action === "pass";
  const isProbability = recommendation.action === "probability";
  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>本场建议</h3>
          <p>${isProbability ? "暂未接入实时赔率，先给概率版纸上推荐。" : "只在模型概率高于市场赔率时给出 Value。"}</p>
        </div>
      </div>
      <div class="recommendation-body">
        <span class="recommendation-mode ${isPass ? "is-pass" : ""}">${isPass ? "PASS / 观望" : isProbability ? "PROB / 概率版" : "VALUE / 可考虑"}</span>
        <h2 class="recommendation-name">${escapeHtml(recommendation.horseName ?? "No bet")}</h2>
        <div class="metrics-grid">
          <div class="metric">
            <span>模型胜率</span>
            <strong>${formatPercent(recommendation.modelProbability)}</strong>
          </div>
          <div class="metric">
            <span>Value Edge</span>
            <strong class="${profitClass(recommendation.edge)}">${formatPercent(recommendation.edge)}</strong>
          </div>
          <div class="metric">
            <span>公允赔率</span>
            <strong>${formatOdds(recommendation.fairOdds)}</strong>
          </div>
          <div class="metric">
            <span>建议上限</span>
            <strong>${formatMoney(recommendation.suggestedStake)}</strong>
          </div>
        </div>
        <p class="guardrail">${escapeHtml(recommendation.message ?? "No positive-edge recommendation at current odds.")}</p>
      </div>
    </section>
  `;
}

function renderSettlementPanel(settlement) {
  if (!settlement) {
    return `
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3>赛后复盘</h3>
            <p>这场还没有官方结果。</p>
          </div>
        </div>
        <div class="settlement-body">
          ${renderSettlementLine("状态", "UPCOMING / 待赛")}
          ${renderSettlementLine("结算", "官方赛果发布后更新")}
          ${renderSettlementLine("本场盈亏", "$0")}
        </div>
      </section>
    `;
  }

  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>赛后复盘</h3>
          <p>官方结果出来后自动对账。</p>
        </div>
      </div>
      <div class="settlement-body">
        ${renderSettlementLine("推荐马", settlement.recommendedHorseName ?? "PASS")}
        ${renderSettlementLine("官方名次", settlement.recommendedPlacing == null ? "-" : `第 ${settlement.recommendedPlacing}`)}
        ${renderSettlementLine("头马", settlement.winnerHorseName ?? "-")}
        ${renderSettlementLine("结果", `<span class="result-token ${settlement.resultLabel.toLowerCase()}">${settlement.resultLabel}</span>`, true)}
        ${renderSettlementLine("本场盈亏", `<strong class="${profitClass(settlement.profit)}">${formatSignedMoney(settlement.profit)}</strong>`, true)}
      </div>
    </section>
  `;
}

function getAllEntries(snapshot) {
  return [
    ...(snapshot.upcomingEntries ?? []),
    ...(snapshot.recentEntries ?? []).slice().reverse(),
  ];
}

function renderSettlementLine(label, value, raw = false) {
  return `
    <div class="settlement-line">
      <span>${escapeHtml(label)}</span>
      <strong>${raw ? value : escapeHtml(value)}</strong>
    </div>
  `;
}

function renderChartPanel(ledger) {
  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>Rolling Profit</h3>
          <p>每场 Value 单结算后的累计盈亏。</p>
        </div>
      </div>
      <div class="chart-body">
        ${renderProfitChart(ledger)}
      </div>
    </section>
  `;
}

function renderComparisonPanel(ledger) {
  const rows = ledger.slice(-8).reverse();
  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>赛前预测 vs 官方结果</h3>
          <p>网站保留每场预测快照，赛后只做结算，不改预测。</p>
        </div>
      </div>
      <div class="table-wrap">
        <table class="comparison-table">
          <thead>
            <tr>
              <th>Race</th>
              <th>Top Pick</th>
              <th>Value 推荐</th>
              <th>结果</th>
              <th>本场盈亏</th>
              <th>累计 ROI</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td>${escapeHtml(row.date)} ${escapeHtml(row.racecourse)} R${row.raceNo}</td>
                <td>${escapeHtml(row.topPick)}</td>
                <td>${escapeHtml(row.recommendation)}</td>
                <td>${escapeHtml(row.result)}</td>
                <td class="${profitClass(row.profit)}">${formatSignedMoney(row.profit)}</td>
                <td class="${profitClass(row.cumulativeRoi)}">${formatPercent(row.cumulativeRoi)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderPerformancePanel(snapshot) {
  const performance = snapshot.performance;
  if (!performance) {
    return `
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3>模型成绩</h3>
            <p>下次刷新 dashboard 后会显示完整成绩分解。</p>
          </div>
        </div>
      </section>
    `;
  }

  const overall = performance.overall;
  const recent = performance.recent;
  const meetings = performance.byMeeting.slice(0, 5);
  return `
    <section class="panel performance-panel">
      <div class="panel-header">
        <div>
          <h3>模型成绩 / Backtest Lab</h3>
          <p>把滚动回测、赔率段和概率校准分开看，避免一个高赔率中奖把判断带偏。</p>
        </div>
      </div>
      <div class="performance-grid">
        ${renderPerformanceMetric("全量 Top Pick", `${overall.topPickWins}/${overall.races}`, formatPercent(overall.topPickWinRate), overall.topPickRoi)}
        ${renderPerformanceMetric("全量 Value", `${overall.valueWins}/${overall.valueBets}`, formatPercent(overall.valueRoi), overall.valueRoi)}
        ${renderPerformanceMetric("市场热门", `${overall.marketFavouriteWins}/${overall.marketFavouriteBets}`, formatPercent(overall.marketFavouriteRoi), overall.marketFavouriteRoi)}
        ${renderPerformanceMetric("近 30 场 Top Pick", `${recent.topPickWins}/${recent.races}`, formatPercent(recent.topPickWinRate), recent.topPickRoi)}
      </div>
      <div class="mini-record-grid">
        <div>
          <h4>头号马赔率段</h4>
          <div class="mini-record-list">
            ${performance.topPickOddsBuckets.map((bucket) => renderMiniRecordLine(
              bucket.label,
              `${bucket.wins}/${bucket.races}`,
              formatPercent(bucket.roi),
              bucket.roi,
            )).join("")}
          </div>
        </div>
        <div>
          <h4>概率校准</h4>
          <div class="calibration-bars">
            ${performance.probabilityCalibration.map(renderCalibrationBar).join("")}
          </div>
        </div>
      </div>
      <div class="mini-record-list meeting-records">
        ${meetings.map((meeting) => renderMiniRecordLine(
          `${meeting.date} ${meeting.racecourse}`,
          `Top ${meeting.topPickWins}/${meeting.races}`,
          `Value ${formatPercent(meeting.valueRoi)}`,
          meeting.valueRoi,
        )).join("")}
      </div>
      <p class="fine-print">${escapeHtml(performance.warning)}</p>
    </section>
  `;
}

function renderSelfTestPanel(entry, entries) {
  const pick = selectedEntryUserPick(entry);
  const locked = selectedEntryLockedForecast(entry);
  const pickSettlement = pick ? settleUserPick(entry, pick) : null;
  const lockSettlement = locked ? settleLockedForecast(entry, locked) : null;
  const summary = summarizeUserPicks(entries, uiState.userPicks);

  return `
    <section class="panel self-test-panel">
      <div class="panel-header">
        <div>
          <h3>我的测试台</h3>
          <p>你自己的纸上选择存在这个浏览器里，不会影响模型。</p>
        </div>
        ${uiState.userPicks.length ? '<button class="text-button" data-clear-user-picks>清空</button>' : ""}
      </div>
      <div class="self-test-current">
        <span>本场我的选择</span>
        <strong>${pick ? escapeHtml(pick.horseName) : "还没选"}</strong>
        <p>${pick ? userPickSettlementText(pickSettlement) : "在左边预测表点“我选这匹”，就会记录一张纸上单。"}</p>
      </div>
      <div class="self-test-current">
        <span>赛前锁单</span>
        <strong>${locked ? "已锁定" : "未锁定"}</strong>
        <p>${locked ? lockedForecastText(locked, lockSettlement) : "锁单会保存当时的头号马和最终方案，方便赛后核对。"}</p>
      </div>
      <div class="performance-grid is-compact">
        ${renderPerformanceMetric("我的纸上单", `${summary.wins}/${summary.settled}`, `${summary.open} 待赛`, summary.roi)}
        ${renderPerformanceMetric("我的 ROI", formatSignedMoney(summary.profit), formatPercent(summary.roi), summary.roi)}
      </div>
      <p class="fine-print">本地记录只存在你的浏览器。换电脑或清缓存会消失；以后可以再加导出/导入。</p>
    </section>
  `;
}

function renderPerformanceMetric(label, primary, secondary, toneValue = 0) {
  return `
    <div class="performance-card">
      <span>${escapeHtml(label)}</span>
      <strong class="${profitClass(toneValue)}">${escapeHtml(primary)}</strong>
      <small>${escapeHtml(secondary)}</small>
    </div>
  `;
}

function renderMiniRecordLine(label, primary, secondary, toneValue = 0) {
  return `
    <div class="mini-record-line">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(primary)}</strong>
      <em class="${profitClass(toneValue)}">${escapeHtml(secondary)}</em>
    </div>
  `;
}

function renderCalibrationBar(bucket) {
  const expectedWidth = Math.min(100, Math.max(2, bucket.averageProbability * 100));
  const actualWidth = Math.min(100, Math.max(2, bucket.actualWinRate * 100));
  return `
    <div class="calibration-row">
      <div class="calibration-label">
        <strong>${escapeHtml(bucket.label)}</strong>
        <span>${bucket.wins}/${bucket.races}</span>
      </div>
      <div class="calibration-track" aria-label="probability calibration">
        <span class="expected" style="width:${expectedWidth}%"></span>
        <span class="actual" style="width:${actualWidth}%"></span>
      </div>
      <small>预估 ${formatPercent(bucket.averageProbability)} · 实际 ${formatPercent(bucket.actualWinRate)}</small>
    </div>
  `;
}

function userPickSettlementText(settlement) {
  if (!settlement || settlement.status === "OPEN") return "等待官方赛果；这张纸上单暂未结算。";
  if (settlement.status === "WIN") return `命中，回报 ${formatMoney(settlement.returned)}，盈利 ${formatSignedMoney(settlement.profit)}。`;
  return `未中，头马是 ${settlement.winnerHorseName ?? "-"}，盈亏 ${formatSignedMoney(settlement.profit)}。`;
}

function lockedForecastText(locked, settlement) {
  const topPick = locked.topPick?.horseName ?? "-";
  if (!settlement || settlement.status === "OPEN") return `锁定头号马：${topPick}；等待赛果。`;
  return `锁定头号马：${topPick}，结果 ${settlement.topPickStatus}；头马 ${settlement.winnerHorseName ?? "-"}。`;
}

function renderNotesPanel(assumptions, snapshot) {
  const nextMeetings = snapshot.nextLocalMeetings ?? [];
  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h3>模型纪律</h3>
          <p>赚钱目标靠长期复盘，不靠口头保证。</p>
        </div>
      </div>
      <div class="notes-body">
        <p class="fine-print">Bet type: ${escapeHtml(assumptions.betType)}. Stake policy: ${escapeHtml(assumptions.stakePolicy)}.</p>
        <p class="fine-print">${escapeHtml(fixtureWindowLabel(snapshot))}</p>
        ${nextMeetings.length ? `
          <p class="fine-print">Next local meetings: ${nextMeetings.map(formatMeeting).map(escapeHtml).join(" · ")}</p>
        ` : '<p class="fine-print">No future Hong Kong local meetings found in the refreshed fixture window.</p>'}
        <p class="fine-print">所有建议都是概率和赔率比较，不是保证命中。最终投注前必须检查临场赔率、退出马和官方变更。</p>
      </div>
    </section>
  `;
}

function renderProfitChart(ledger) {
  const values = ledger.map((item) => Number(item.cumulativeProfit) || 0);
  if (values.length === 0) {
    return '<p class="fine-print">No ledger data yet.</p>';
  }

  const width = 320;
  const height = 150;
  const padding = 14;
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const step = values.length > 1 ? (width - padding * 2) / (values.length - 1) : 0;
  const points = values.map((value, index) => {
    const x = padding + step * index;
    const y = height - padding - ((value - min) / span) * (height - padding * 2);
    return [x, y];
  });
  const path = points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const fillPath = `${path} L ${points.at(-1)[0].toFixed(1)} ${height - padding} L ${points[0][0].toFixed(1)} ${height - padding} Z`;
  const zeroY = height - padding - ((0 - min) / span) * (height - padding * 2);

  return `
    <svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="rolling profit chart">
      <path class="chart-fill" d="${fillPath}"></path>
      <line class="chart-axis" x1="${padding}" x2="${width - padding}" y1="${zeroY}" y2="${zeroY}"></line>
      <path class="chart-line" d="${path}"></path>
      ${points.map(([x, y]) => `<circle class="chart-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3"></circle>`).join("")}
    </svg>
  `;
}

function selectedEntryUserPick(entry) {
  return uiState.userPicks.find((pick) => pick.raceId === entry.raceId) ?? null;
}

function selectedEntryLockedForecast(entry) {
  return uiState.lockedForecasts.find((locked) => locked.raceId === entry.raceId) ?? null;
}

function recordUserPick(entry, horseId) {
  const runner = entry.forecast?.predictions?.find((item) => item.horseId === horseId);
  if (!runner) return;
  const pick = createUserPick(entry, runner, { stake: 10 });
  uiState.userPicks = [
    ...uiState.userPicks.filter((item) => item.raceId !== entry.raceId),
    pick,
  ];
  saveLocalRecords();
  render();
}

function lockForecast(entry) {
  const locked = createLockedForecast(entry, uiState.snapshot?.generatedAt ?? new Date().toISOString());
  uiState.lockedForecasts = [
    ...uiState.lockedForecasts.filter((item) => item.raceId !== entry.raceId),
    locked,
  ];
  saveLocalRecords();
  render();
}

function clearUserRecords() {
  uiState.userPicks = [];
  uiState.lockedForecasts = [];
  saveLocalRecords();
  render();
}

function bindEvents() {
  document.querySelectorAll("[data-race-select-id]").forEach((button) => {
    button.addEventListener("click", () => {
      uiState.selectedRaceId = button.dataset.raceSelectId;
      render();
    });
  });

  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      uiState.filter = button.dataset.filter;
      render();
    });
  });

  document.querySelectorAll("[data-refresh-plan]").forEach((button) => {
    button.addEventListener("click", () => {
      refreshDashboardData();
    });
  });

  document.querySelectorAll("[data-user-pick-horse-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const entry = getAllEntries(uiState.snapshot).find((item) => item.raceId === button.dataset.raceId);
      if (entry) recordUserPick(entry, button.dataset.userPickHorseId);
    });
  });

  document.querySelectorAll("[data-lock-forecast]").forEach((button) => {
    button.addEventListener("click", () => {
      const entry = getAllEntries(uiState.snapshot).find((item) => item.raceId === button.dataset.raceId);
      if (entry) lockForecast(entry);
    });
  });

  document.querySelectorAll("[data-clear-user-picks]").forEach((button) => {
    button.addEventListener("click", () => {
      clearUserRecords();
    });
  });
}

function renderMissingData(error) {
  appRoot.innerHTML = `
    <main class="empty-panel">
      <h1>HK Local Horse Model</h1>
      <p>Dashboard data is not ready yet.</p>
      <p class="fine-print">${escapeHtml(error.message)}</p>
      <p class="fine-print">Run: <code>npm run hkjc:refresh -- --bankroll 200 --minEdge 0 --minProbability 0.15</code></p>
    </main>
  `;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function formatOdds(value) {
  if (!Number.isFinite(value)) return "-";
  return value.toFixed(value >= 10 ? 1 : 2);
}

function formatMoney(value) {
  if (!Number.isFinite(value)) return "-";
  return `$${value.toFixed(0)}`;
}

function formatSignedMoney(value) {
  if (!Number.isFinite(value)) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}$${value.toFixed(0)}`;
}

function formatDateTime(value) {
  if (!value) return "not generated";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-HK", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function refreshStatusText(snapshot) {
  if (uiState.refreshStatus === "loading" || uiState.refreshStatus === "loading-initial") {
    return "正在刷新线上最新数据...";
  }
  if (uiState.refreshStatus === "error") {
    return "刷新失败，请稍后再试；当前仍显示上一次方案。";
  }
  const dataTime = snapshot?.generatedAt ? `数据生成：${formatDateTime(snapshot.generatedAt)}` : "数据生成：-";
  const clickTime = uiState.refreshedAt ? `页面刷新：${formatDateTime(uiState.refreshedAt)}` : "页面刷新：-";
  return `${dataTime} · ${clickTime} · 赛马窗口后台约每 10 分钟更新`;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

function formatMeeting(meeting) {
  const raceCount = Number.isFinite(Number(meeting.raceCount)) ? ` · ${meeting.raceCount} 场` : "";
  return `${meeting.date} ${racecourseLabel(meeting.racecourse)}${raceCount}`;
}

function nextMeetingLabel(snapshot) {
  const upcomingForecasts = snapshot.upcomingEntries?.length ?? 0;
  if (upcomingForecasts > 0) return `${upcomingForecasts} race-card forecasts ready`;
  const nextMeeting = snapshot.nextLocalMeetings?.[0];
  if (nextMeeting) return `next local ${nextMeeting.date} ${nextMeeting.racecourse}`;
  return "no future local meeting in window";
}

function fixtureWindowLabel(snapshot) {
  const window = snapshot.fixtureWindow;
  if (!window) return "Fixture refresh window: manual dashboard build.";
  return `Fixture refresh window: ${window.from} to ${window.to}; today ${window.today}.`;
}

function profitClass(value) {
  if (!Number.isFinite(value) || value === 0) return "";
  return value > 0 ? "profit-positive" : "profit-negative";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
