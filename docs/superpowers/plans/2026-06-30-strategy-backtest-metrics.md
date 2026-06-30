# Strategy Backtest Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Couple the new HK$10-100 staking strategy with historical race results and update dashboard ROI/win-rate data without inventing missing non-Win dividends.

**Architecture:** Extend the existing performance summary pipeline. The bet strategy remains in `bet-strategy.js`; `hkjc-horse-model/src/performance.js` will use it to replay strategy decisions over rolling ledger entries, settle Win lines with official Win odds, and track Place/QP/Quinella structural hit rates separately because their official dividends are not stored yet.

**Tech Stack:** Vanilla ES modules, Node.js `node:test`, existing static dashboard JSON.

---

### Task 1: Add strategy backtest tests

**Files:**
- Modify: `hkjc-horse-model/test/performance.test.js`

- [x] Add fixtures with `forecast.predictions` and `settlement.runnerResults`.
- [x] Assert that strategy replay computes strategy bet count, pass count, total stake, official Win stake/return/ROI, any-hit rate, Place hits, QP hits, and unpriced-pool break-even need.
- [x] Run `node --test hkjc-horse-model/test/performance.test.js` and verify it fails because `buildStakingStrategyPerformance` is missing.

### Task 2: Implement strategy performance

**Files:**
- Modify: `hkjc-horse-model/src/performance.js`
- Modify: `hkjc-horse-model/src/model.js`

- [x] Import `buildStakingStrategy` into `performance.js`.
- [x] Export `buildStakingStrategyPerformance(entries)`.
- [x] Add `runnerResults` to settled ledger entries so strategy bets can be settled against historical placings.
- [x] Include `stakingStrategy` inside `performance` snapshots.
- [x] Run performance tests and full `npm test`.

### Task 3: Show strategy metrics on the webpage

**Files:**
- Modify: `app.js`
- Modify: `README.md`

- [x] Render strategy backtest cards inside the existing model performance panel.
- [x] Label full multi-pool ROI as unavailable until official Place/QP/Quinella dividends are parsed.
- [x] Document the ROI limitation and current metrics.

### Task 4: Regenerate data and verify

**Files:**
- Modify/generated: `hkjc-horse-model/data/processed/dashboard.json`
- Modify/generated: `data/dashboard.json`

- [x] Run dashboard generation and copy `data/dashboard.json`.
- [x] Verify `performance.stakingStrategy` exists.
- [x] Run `npm test`, JS syntax checks, and HTTP smoke.
- [x] Commit locally.
