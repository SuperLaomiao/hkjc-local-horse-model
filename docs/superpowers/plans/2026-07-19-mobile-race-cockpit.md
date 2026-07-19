# Mobile Race-Day Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the crowded three-column dashboard with a fail-closed, mobile-first race-day cockpit that prioritizes betting availability, exact race-level advice, and then model evidence while preserving every existing public tool.

**Architecture:** Add one pure ES module for cockpit navigation and view-state derivation, keep model/EV logic in existing modules, and let `app.js` compose existing detailed renderers behind four destinations. The browser receives only the existing sanitized dashboard; any missing, stale, unsafe, or failed input can reduce a recommendation to HK$0 but can never make it executable.

**Tech Stack:** Framework-free ES modules, Node.js built-in test runner, HTML/CSS, existing GitHub Pages allowlist publisher and privacy scanner.

---

## File map

- Create `dashboard-cockpit.js`: destination constants, hash normalization, cockpit state derivation and small safe HTML primitives.
- Create `test/dashboard-cockpit.test.js`: deterministic unit tests for navigation, state priority, explicit race context and zero-stake failure behavior.
- Modify `dashboard-layout.js`: map all seven legacy tool IDs to the four destinations without deleting IDs.
- Modify `test/dashboard-layout.test.js`: verify complete grouping and stale-ID fallback.
- Modify `app.js`: compose the four destinations, hash navigation, no-meeting state, stale-refresh downgrade and existing tool renderers.
- Modify `test/public-dashboard-app-integration.test.js`: protect navigation, reachability, fail-closed rendering and static asset integration.
- Modify `styles.css`: cockpit tokens, cards, two-column desktop layout, single-column mobile layout, fixed bottom navigation and accessibility states.
- Modify `index.html`: bump static asset versions so existing service workers cannot pin the old shell.
- Modify `sw.js`: cache the new cockpit module and bump the cache name.
- Modify `hkjc-horse-model/src/public-site-publish.js`: add `dashboard-cockpit.js` to the explicit public allowlist.
- Modify `hkjc-horse-model/test/public-site-publish.test.js`: assert the new module is copied and scanned.
- Modify `docs/active-continuation-roadmap.md`: mark P4 delivered only after all checks pass.

### Task 1: Pure cockpit navigation and state model

**Files:**
- Create: `test/dashboard-cockpit.test.js`
- Create: `dashboard-cockpit.js`

- [ ] **Step 1: Write the failing navigation tests**

Create tests that require four stable destinations and safe hash fallback:

```js
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COCKPIT_DESTINATIONS,
  buildCockpitViewModel,
  normalizeCockpitDestination,
} from '../dashboard-cockpit.js';

describe('race-day cockpit', () => {
  it('normalizes linkable destinations and falls back to today', () => {
    assert.deepEqual(COCKPIT_DESTINATIONS.map((item) => item.id), [
      'today',
      'review',
      'research',
      'more',
    ]);
    assert.equal(normalizeCockpitDestination('#research'), 'research');
    assert.equal(normalizeCockpitDestination('more'), 'more');
    assert.equal(normalizeCockpitDestination('#unknown'), 'today');
  });
});
```

- [ ] **Step 2: Run the focused test and verify the module is missing**

Run: `node --test test/dashboard-cockpit.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `dashboard-cockpit.js`.

- [ ] **Step 3: Add failing state-priority tests**

Append fixtures covering no meeting, refresh failure, public research-only mode, WATCH and PLAY:

```js
const entry = {
  raceId: '2026-07-19-ST-R3',
  date: '2026-07-19',
  racecourse: 'ST',
  raceNo: 3,
  forecast: { startTime: '13:25', predictions: [] },
  settlement: null,
};

it('renders no meeting without inventing an executable race', () => {
  const view = buildCockpitViewModel({
    snapshot: { generatedAt: '2026-07-19T04:00:00.000Z', nextLocalMeetings: [] },
    entry: null,
    entries: [],
    refreshStatus: 'ready',
    executionPolicy: { allowExecutableRecommendations: true },
  });

  assert.equal(view.state, 'NO_MEETING');
  assert.equal(view.totalStake, 0);
  assert.equal(view.canExecute, false);
  assert.match(view.headline, /今天不可下注/);
});

it('distinguishes a failed refresh from a verified no-meeting state', () => {
  const view = buildCockpitViewModel({
    snapshot: { generatedAt: '2026-07-19T04:00:00.000Z', nextLocalMeetings: [] },
    entry: null,
    entries: [],
    refreshStatus: 'error',
    executionPolicy: { allowExecutableRecommendations: true },
  });

  assert.equal(view.state, 'BLOCK');
  assert.equal(view.totalStake, 0);
  assert.match(view.reason, /刷新失败/);
});

it('blocks a stale screen even when an old portfolio had cash lines', () => {
  const view = buildCockpitViewModel({
    snapshot: { generatedAt: '2026-07-19T04:00:00.000Z' },
    entry,
    entries: [entry],
    refreshStatus: 'error',
    executionPolicy: { allowExecutableRecommendations: true },
    availability: { canBetNow: true },
    portfolio: { cashLines: [{ label: '位置', type: 'PLACE', selections: ['8'], stake: 10 }], watchLines: [] },
  });

  assert.equal(view.state, 'BLOCK');
  assert.equal(view.totalStake, 0);
  assert.equal(view.lines[0].amount, 0);
  assert.match(view.reason, /刷新失败/);
});

it('shows an exact race-level WATCH line with zero stake', () => {
  const view = buildCockpitViewModel({
    snapshot: { generatedAt: '2026-07-19T04:00:00.000Z' },
    entry,
    entries: [entry],
    refreshStatus: 'ready',
    executionPolicy: { allowExecutableRecommendations: true },
    availability: { canBetNow: true },
    portfolio: { cashLines: [], watchLines: [{ label: '位置Q', type: 'QPL', selections: ['2', '8'], stake: 0, rationale: 'EV 未越线' }] },
  });

  assert.equal(view.state, 'WATCH');
  assert.equal(view.lines[0].context, 'R3 · QPL · 2+8');
  assert.equal(view.lines[0].amount, 0);
});
```

- [ ] **Step 4: Implement the minimal pure module**

Create `dashboard-cockpit.js` with immutable destination metadata and a fail-closed builder:

```js
export const COCKPIT_DESTINATIONS = Object.freeze([
  { id: 'today', label: '今日', symbol: '●' },
  { id: 'review', label: '复盘', symbol: '↺' },
  { id: 'research', label: '研究', symbol: '◇' },
  { id: 'more', label: '更多', symbol: '•••' },
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
  const hardBlock = refreshStatus === 'error' || executionPolicy.allowExecutableRecommendations !== true;
  const sourceLines = cashLines.length ? cashLines : watchLines;
  const state = hardBlock
    ? 'BLOCK'
    : !entry
      ? 'NO_MEETING'
      : entry.settlement
      ? 'SETTLED'
      : availability.canBetNow !== true
          ? 'WAIT'
          : cashLines.length
            ? 'PLAY'
            : watchLines.length
              ? 'WATCH'
              : 'NO_BET';
  const canExecute = state === 'PLAY' && raceContext !== null;
  const lines = sourceLines.map((line) => ({
    context: raceContext
      ? `${raceContext} · ${line.type ?? line.label ?? 'BET'} · ${(line.selections ?? []).join('+') || '-'}`
      : `R- · ${line.type ?? line.label ?? 'BET'} · ${(line.selections ?? []).join('+') || '-'}`,
    amount: canExecute ? Number(line.stake ?? 0) : 0,
    rationale: line.rationale ?? '',
  }));

  return {
    state,
    canExecute,
    totalStake: canExecute ? lines.reduce((sum, line) => sum + line.amount, 0) : 0,
    lines,
    raceContext,
    generatedAt: snapshot.generatedAt ?? null,
    entries: entries.map((item) => ({ raceId: item.raceId, raceNo: item.raceNo, startTime: item.forecast?.startTime ?? null, settled: Boolean(item.settlement) })),
    headline: !entry ? '今天不可下注' : state === 'PLAY' ? '本场可执行建议' : state === 'SETTLED' ? '本场已经结算' : '暂不下注',
    reason: refreshStatus === 'error' ? '刷新失败，旧方案已自动阻断。' : executionPolicy.reason ?? portfolio?.summary ?? '',
  };
}
```

- [ ] **Step 5: Run the focused test and commit**

Run: `node --test test/dashboard-cockpit.test.js`

Expected: PASS.

Commit:

```bash
git add dashboard-cockpit.js test/dashboard-cockpit.test.js
git commit -m "feat: add fail-closed cockpit state model"
```

### Task 2: Preserve all tools under four destinations

**Files:**
- Modify: `dashboard-layout.js`
- Modify: `test/dashboard-layout.test.js`

- [ ] **Step 1: Write the failing grouping tests**

Extend `test/dashboard-layout.test.js`:

```js
import {
  DESTINATION_TOOL_IDS,
  getDestinationForTool,
  getToolsForDestination,
} from '../dashboard-layout.js';

it('maps every legacy tool to exactly one cockpit destination', () => {
  const mapped = Object.values(DESTINATION_TOOL_IDS).flat();
  assert.deepEqual(new Set(mapped), new Set(TOOL_TAB_IDS));
  assert.equal(mapped.length, TOOL_TAB_IDS.length);
  assert.equal(getDestinationForTool('review'), 'review');
  assert.equal(getDestinationForTool('performance'), 'review');
  assert.equal(getDestinationForTool('research-lab'), 'research');
  assert.equal(getDestinationForTool('pool-guide'), 'more');
});

it('returns the configured tools for each destination', () => {
  assert.deepEqual(getToolsForDestination('research').map((item) => item.id), ['research-lab']);
  assert(getToolsForDestination('more').some((item) => item.id === 'discipline'));
  assert.deepEqual(getToolsForDestination('unknown').map((item) => item.id), []);
});
```

- [ ] **Step 2: Verify the focused test fails**

Run: `node --test test/dashboard-layout.test.js`

Expected: FAIL because the three grouping exports do not exist.

- [ ] **Step 3: Add the deterministic mapping**

Add to `dashboard-layout.js` after `TOOL_TAB_IDS`:

```js
export const DESTINATION_TOOL_IDS = Object.freeze({
  today: Object.freeze(['multi-play-portfolio']),
  review: Object.freeze(['review', 'performance']),
  research: Object.freeze(['research-lab']),
  more: Object.freeze(['pool-guide', 'adaptive-route', 'discipline']),
});

export function getDestinationForTool(toolId) {
  return Object.entries(DESTINATION_TOOL_IDS)
    .find(([, ids]) => ids.includes(toolId))?.[0] ?? 'today';
}

export function getToolsForDestination(destinationId) {
  const ids = DESTINATION_TOOL_IDS[destinationId] ?? [];
  return ids.map((id) => getToolTab(id));
}
```

- [ ] **Step 4: Run focused tests and commit**

Run: `node --test test/dashboard-layout.test.js test/dashboard-cockpit.test.js`

Expected: PASS.

Commit:

```bash
git add dashboard-layout.js test/dashboard-layout.test.js
git commit -m "feat: group dashboard tools by destination"
```

### Task 3: Replace the application shell and keep tools reachable

**Files:**
- Modify: `test/public-dashboard-app-integration.test.js`
- Modify: `app.js`
- Modify: `index.html`
- Modify: `sw.js`
- Modify: `hkjc-horse-model/src/public-site-publish.js`
- Modify: `hkjc-horse-model/test/public-site-publish.test.js`

- [ ] **Step 1: Write failing integration assertions**

Add an integration test that checks the new module, four destinations, hash state and no-meeting branch:

```js
it('renders the four-destination cockpit and keeps every legacy tool reachable', async () => {
  const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const serviceWorker = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  const publisher = await readFile(new URL('../hkjc-horse-model/src/public-site-publish.js', import.meta.url), 'utf8');

  assert.match(appSource, /dashboard-cockpit\.js/);
  assert.match(appSource, /selectedDestination/);
  assert.match(appSource, /window\.location\.hash/);
  assert.match(appSource, /renderTodayDestination/);
  assert.match(appSource, /renderReviewDestination/);
  assert.match(appSource, /renderResearchDestination/);
  assert.match(appSource, /renderMoreDestination/);
  assert.match(appSource, /renderNoMeetingCockpit/);
  assert.match(serviceWorker, /dashboard-cockpit\.js/);
  assert.match(publisher, /dashboard-cockpit\.js/);
});
```

Update the public publisher test fixture to include `dashboard-cockpit.js` in `staticFiles` and expect it in the copied file list.

- [ ] **Step 2: Verify the integration tests fail**

Run: `node --test test/public-dashboard-app-integration.test.js hkjc-horse-model/test/public-site-publish.test.js`

Expected: FAIL because the cockpit shell and public asset are absent.

- [ ] **Step 3: Wire destination state into `app.js`**

Import the cockpit module and layout group helpers, then extend `uiState`:

```js
import {
  COCKPIT_DESTINATIONS,
  buildCockpitViewModel,
  normalizeCockpitDestination,
} from './dashboard-cockpit.js?v=20260719-mobile-cockpit';
import {
  buildBettingAvailability,
  formatRaceContext,
  getDashboardLayoutSections,
  getDestinationForTool,
  getToolsForDestination,
} from './dashboard-layout.js?v=20260719-mobile-cockpit';

const uiState = {
  // existing fields remain
  selectedDestination: normalizeCockpitDestination(window.location.hash),
};
```

Register one `hashchange` listener during initialization and one `data-destination-id` handler in `bindEvents`. Navigation sets the hash; `hashchange` updates `uiState.selectedDestination` and calls `render()`.

- [ ] **Step 4: Compose the new shell without rewriting detailed tools**

Replace the old three-column template with:

```js
function render() {
  const snapshot = uiState.snapshot;
  const entries = getAllEntries(snapshot);
  const selectedEntry = entries.find((entry) => entry.raceId === uiState.selectedRaceId) ?? entries[0] ?? null;
  const todayStatus = localRaceDayStatus(snapshot);
  const executionPolicy = dashboardExecutionPolicy(snapshot);
  const availability = selectedEntry
    ? buildBettingAvailability({ entry: selectedEntry, today: todayStatus.today })
    : { canBetNow: false };
  const portfolio = selectedEntry
    ? buildStructuredBetPortfolio(selectedEntry, buildPublicPortfolioOptions(snapshot, selectedEntry))
    : null;
  const cockpit = buildCockpitViewModel({
    snapshot,
    entry: selectedEntry,
    entries,
    availability,
    portfolio,
    executionPolicy,
    refreshStatus: uiState.refreshStatus,
  });

  appRoot.innerHTML = `
    <div class="terminal cockpit-shell">
      ${renderCockpitHeader(snapshot, cockpit, executionPolicy)}
      <main class="cockpit-main" id="main-content">
        ${renderDestination(uiState.selectedDestination, { snapshot, entries, selectedEntry, todayStatus, cockpit })}
      </main>
      ${renderCockpitNavigation(uiState.selectedDestination)}
    </div>
  `;
  bindEvents();
}
```

Implement `renderDestination` as a four-way switch. Today reuses `renderFinalBetPlanPanel`, `renderMultiPlayPortfolioPanel`, a compact score strip and prediction summary; Review reuses review and performance content; Research reuses `renderResearchUpgradePanel`; More renders the full prediction table and the three mapped tool panels.

When `selectedEntry` is null, `renderTodayDestination` calls `renderNoMeetingCockpit(snapshot, cockpit)` and the other destinations render their snapshot-level content without manufacturing a race.

- [ ] **Step 5: Add the public asset and cache version**

Add `'dashboard-cockpit.js'` to `PUBLIC_SITE_STATIC_FILES`, add the versioned module to `APP_SHELL`, change `CACHE_NAME` to `hkjc-model-v14-mobile-cockpit`, and update `index.html` asset query strings to `20260719-mobile-cockpit`.

- [ ] **Step 6: Run focused tests and commit**

Run: `node --test test/dashboard-cockpit.test.js test/dashboard-layout.test.js test/public-dashboard-app-integration.test.js hkjc-horse-model/test/public-site-publish.test.js`

Expected: PASS.

Commit:

```bash
git add app.js index.html sw.js dashboard-cockpit.js dashboard-layout.js test/dashboard-cockpit.test.js test/dashboard-layout.test.js test/public-dashboard-app-integration.test.js hkjc-horse-model/src/public-site-publish.js hkjc-horse-model/test/public-site-publish.test.js
git commit -m "feat: add four-destination race cockpit"
```

### Task 4: Apply the approved responsive visual system

**Files:**
- Modify: `test/public-dashboard-app-integration.test.js`
- Modify: `styles.css`

- [ ] **Step 1: Add failing static style assertions**

Add:

```js
it('ships the approved cockpit tokens and accessible mobile navigation', async () => {
  const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(styles, /--cockpit-green:\s*#0c5c53/i);
  assert.match(styles, /--cockpit-gold:\s*#e6a83e/i);
  assert.match(styles, /\.cockpit-status\.is-block/);
  assert.match(styles, /\.cockpit-bottom-nav/);
  assert.match(styles, /min-height:\s*44px/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});
```

- [ ] **Step 2: Verify the style test fails**

Run: `node --test test/public-dashboard-app-integration.test.js`

Expected: FAIL on the first missing cockpit token.

- [ ] **Step 3: Add the visual tokens and layout primitives**

Extend `:root`:

```css
--cockpit-green: #0c5c53;
--cockpit-gold: #e6a83e;
--cockpit-safe: #dff5e9;
--cockpit-wait: #fff1cf;
--cockpit-block: #fde7e4;
--cockpit-page: #f4f8f6;
```

Add focused styles for `.cockpit-shell`, `.cockpit-header`, `.cockpit-main`, `.cockpit-status`, `.cockpit-race-chips`, `.cockpit-plan`, `.cockpit-evidence`, `.cockpit-page-nav` and `.cockpit-bottom-nav`. PLAY, WATCH and BLOCK each use text plus color. Set `font-variant-numeric: tabular-nums` on countdown and stake values.

- [ ] **Step 4: Replace mobile reordering with the approved layout**

At `max-width: 780px`, use one content column, horizontal race-chip overflow inside its own container, a fixed four-column bottom nav and enough body padding to prevent overlap. Each navigation button and primary action uses `min-height: 44px`. At desktop widths, use at most two columns and no sticky third sidebar.

Add:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

- [ ] **Step 5: Run focused tests and commit**

Run: `node --test test/public-dashboard-app-integration.test.js test/dashboard-cockpit.test.js`

Expected: PASS.

Commit:

```bash
git add styles.css test/public-dashboard-app-integration.test.js
git commit -m "style: simplify race cockpit across screen sizes"
```

### Task 5: Harden refresh failure and explicit recommendation context

**Files:**
- Modify: `test/dashboard-cockpit.test.js`
- Modify: `test/public-dashboard-app-integration.test.js`
- Modify: `dashboard-cockpit.js`
- Modify: `app.js`

- [ ] **Step 1: Add failing tests for unknown context and retry behavior**

Add a view-model test with an entry missing `raceNo`; even with a cash line it must produce `BLOCK`, HK$0 and `R-` context. Add integration assertions for `data-retry-dashboard`, `aria-live="polite"`, and stale-data wording.

```js
it('never executes a cash line whose race context is unknown', () => {
  const view = buildCockpitViewModel({
    entry: { raceId: 'unknown', forecast: {} },
    entries: [],
    availability: { canBetNow: true },
    executionPolicy: { allowExecutableRecommendations: true },
    portfolio: { cashLines: [{ type: 'PLACE', selections: ['8'], stake: 10 }], watchLines: [] },
  });

  assert.equal(view.state, 'BLOCK');
  assert.equal(view.totalStake, 0);
  assert.equal(view.lines[0].context, 'R- · PLACE · 8');
});
```

- [ ] **Step 2: Verify focused failure**

Run: `node --test test/dashboard-cockpit.test.js test/public-dashboard-app-integration.test.js`

Expected: FAIL because an unknown context is still classified PLAY and no retry control exists.

- [ ] **Step 3: Make unknown context and stale refresh fail closed**

Update state priority so `cashLines.length > 0 && raceContext === null` becomes `BLOCK`. Keep source lines visible for explanation but force every amount to zero.

Replace the initial developer-only missing-data page with a public retry panel:

```js
function renderMissingData(error) {
  appRoot.innerHTML = `
    <main class="empty-panel cockpit-load-error" aria-live="polite">
      <span class="cockpit-state-label">BLOCK · NO BET</span>
      <h1>暂时无法载入赛程</h1>
      <p>没有可验证的新数据，系统不会显示下注金额。</p>
      <p class="fine-print">${escapeHtml(error.message)}</p>
      <button class="refresh-plan-button" data-retry-dashboard>重新载入</button>
    </main>
  `;
  document.querySelector('[data-retry-dashboard]')?.addEventListener('click', () => refreshDashboardData({ initial: true }));
}
```

When an existing snapshot refresh fails, pass `refreshStatus: 'error'` into the view model, render its BLOCK message in an `aria-live="polite"` region and preserve the last successful `snapshot.generatedAt`.

- [ ] **Step 4: Run focused tests and commit**

Run: `node --test test/dashboard-cockpit.test.js test/public-dashboard-app-integration.test.js`

Expected: PASS.

Commit:

```bash
git add dashboard-cockpit.js app.js test/dashboard-cockpit.test.js test/public-dashboard-app-integration.test.js
git commit -m "fix: fail cockpit closed on stale or ambiguous data"
```

### Task 6: Release verification, browser QA and roadmap sync

**Files:**
- Modify: `docs/active-continuation-roadmap.md`

- [ ] **Step 1: Run the complete automated checks**

Run:

```bash
TZ=UTC npm test
npm run hkjc:build-public-site
npm run hkjc:privacy-scan
git diff --check
```

Expected: all Node tests pass; the public build and scanner report zero violations; `git diff --check` prints nothing.

- [ ] **Step 2: Serve the allowlisted artifact, not the source tree**

Run `python3 -m http.server 4173 --directory .public-site` only as a read-only local server. Open `http://localhost:4173/` in the in-app browser.

Expected: the page loads from the exact artifact that Pages will deploy.

- [ ] **Step 3: Verify the three viewport stories**

Inspect 390×844, 430×932 and 1280×900:

- no horizontal page overflow;
- availability, next race/T-window and total stake appear before scrolling on phone;
- every visible betting line includes race, pool, selection and amount;
- bottom navigation does not cover content;
- Today, Review, Research and More all open;
- keyboard focus reaches navigation, race chips, refresh and evidence controls;
- a simulated refresh failure cannot leave PLAY or a positive amount visible.

- [ ] **Step 4: Mark delivery in the roadmap**

Change the P4 checkbox to complete and add a Latest continuation note recording the four destinations, no-meeting state, fail-closed refresh behavior, viewport checks, full test count and privacy result. Also reconcile stale roadmap checkboxes whose acceptance criteria are already demonstrably implemented, without changing Research Lab action status.

- [ ] **Step 5: Commit the verified delivery record**

```bash
git add docs/active-continuation-roadmap.md
git commit -m "docs: record mobile cockpit delivery"
```

- [ ] **Step 6: Final branch verification before publication**

Run:

```bash
git status --short --branch
git log --oneline --decorate -6
TZ=UTC npm test
npm run hkjc:build-public-site
npm run hkjc:privacy-scan
```

Expected: only the intended branch commits are ahead of `origin/main`; tests and privacy checks remain green. Then push the branch, create a PR, merge only after the checks pass, wait for the Pages workflow, and verify the deployed public JSON publication contract and all four destinations online.
