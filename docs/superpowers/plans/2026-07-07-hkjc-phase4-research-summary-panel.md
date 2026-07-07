# HKJC Phase 4 Research Summary Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the new offline training and strategy-risk outputs in the dashboard without making the mobile front page heavy or visually cluttered.

**Architecture:** Keep `data/dashboard.json` as the primary lightweight app payload. Add lazy, best-effort loading for compact research artifacts from `hkjc-horse-model/data/processed/` when the performance/research view is rendered. If the artifacts are missing, stale, or unavailable on GitHub Pages, the existing dashboard must continue to work.

**Tech Stack:** Vanilla ES modules, existing dashboard state/render loop, built-in `node:test` layout helper tests.

---

## File structure

- Modify `app.js`
  - Add lazy loaders for model leaderboard, Python training report, and strategy risk report.
  - Render a compact "Research Lab" summary inside the existing performance panel.
- Modify `styles.css`
  - Add small-card styles reusing the current performance visual language.
- Modify `sw.js`
  - Add research JSON URLs to cache invalidation/no-store treatment as needed.
- Modify `test/dashboard-layout.test.js` or add a small app helper test if practical
  - Cover rendering helpers through existing pure layout functions where possible.

## Task 1: Add lazy research loading

- [ ] **Step 1: Define research artifact URLs**

Use:

```js
const RESEARCH_REPORT_URLS = {
  leaderboard: "./hkjc-horse-model/data/processed/model-leaderboard.json",
  training: "./hkjc-horse-model/data/processed/model-training-report.json",
  strategyRisk: "./hkjc-horse-model/data/processed/strategy-risk-report.json",
};
```

- [ ] **Step 2: Store research state separately**

Add `state.researchReports = { status, loadedAt, error, leaderboard, training, strategyRisk }`.

- [ ] **Step 3: Lazy load after dashboard load**

Use best-effort `fetch(..., { cache: "no-store" })`. Failures must not break dashboard rendering.

## Task 2: Render compact Research Lab summary

- [ ] **Step 1: Show model comparison**

Render:

- current heuristic holdout top-pick win rate and log loss;
- `logit-runner-v1` holdout top-pick win rate and log loss;
- one plain-language note: logit currently improves top-pick hit rate but not calibration if that is what the metrics show.

- [ ] **Step 2: Show strategy risk**

Render:

- active races / total races;
- known ROI;
- max drawdown;
- longest losing streak;
- pool ROI mini rows for Win / Place / QPL / Quinella;
- warning if known ROI is negative or unpriced pool stake remains.

- [ ] **Step 3: Keep it small**

No full timeline table in the UI. Timeline remains in JSON for research only.

## Task 3: Verify

- [ ] Run `npm test`.
- [ ] Optionally start local preview and inspect performance panel if time allows.

## Acceptance criteria

- Main dashboard still renders if research files are missing.
- Research summary loads lazily and displays compact metrics when artifacts exist.
- Mobile front page does not load the large training dataset.
- Tests pass.
