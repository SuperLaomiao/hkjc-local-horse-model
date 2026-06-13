const DATA_URL = "./data/dashboard.json";
const appRoot = document.querySelector("#hkjc-app");

const uiState = {
  snapshot: null,
  selectedRaceId: null,
  filter: "all",
};

init();

async function init() {
  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Dashboard data not found: ${response.status}`);
    }

    uiState.snapshot = await response.json();
    uiState.selectedRaceId = uiState.snapshot.latestUpcomingForecast?.raceId
      ?? uiState.snapshot.latestForecast?.raceId
      ?? uiState.snapshot.recentEntries?.at(-1)?.raceId
      ?? null;
    render();
  } catch (error) {
    renderMissingData(error);
  }
}

function render() {
  const snapshot = uiState.snapshot;
  const entries = getAllEntries(snapshot);
  const selectedEntry = entries.find((entry) => entry.raceId === uiState.selectedRaceId) ?? entries[0];

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
        </main>

        <aside class="right-stack">
          ${renderRecommendationPanel(selectedEntry.forecast.recommendation)}
          ${renderSettlementPanel(selectedEntry.settlement)}
          ${renderChartPanel(snapshot.ledger)}
          ${renderNotesPanel(snapshot.assumptions, snapshot)}
        </aside>
      </section>
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
    <button class="race-row ${entry.raceId === selectedRaceId ? "is-active" : ""}" data-race-id="${entry.raceId}">
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
            </tr>
          </thead>
          <tbody>
            ${rows.length
              ? rows.map((runner, index) => renderPredictionRow(runner, index)).join("")
              : '<tr><td colspan="8" class="muted">No runner clears the current value filter.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderPredictionRow(runner, index) {
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

function bindEvents() {
  document.querySelectorAll("[data-race-id]").forEach((button) => {
    button.addEventListener("click", () => {
      uiState.selectedRaceId = button.dataset.raceId;
      render();
    });
  });

  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      uiState.filter = button.dataset.filter;
      render();
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

function formatMeeting(meeting) {
  const raceCount = Number.isFinite(Number(meeting.raceCount)) ? ` · ${meeting.raceCount} races` : "";
  return `${meeting.date} ${meeting.racecourse}${raceCount}`;
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
