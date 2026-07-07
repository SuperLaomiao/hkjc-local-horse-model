# HKJC Phase 3 Strategy Risk Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a strategy-level risk report for the current multi-pool staking strategy so we can optimize expected ROI without hiding concentration risk, drawdown, or one-horse overexposure.

**Architecture:** Reuse the existing rolling prediction ledger and staking settlement logic. Add a small report builder that converts settled strategy entries into per-race profit/loss, cumulative drawdown, losing streaks, pool-level contribution, exposure concentration, and outlier reliance. Expose it through the Node CLI and export a compact JSON artifact for dashboard/research use.

**Tech Stack:** Node.js ES modules, built-in `node:test`, existing SQLite loader, existing staking strategy and official dividend settlement helpers.

---

## File structure

- Modify `hkjc-horse-model/src/performance.js`
  - Export `settleStrategyEntry` for reuse by risk diagnostics.
- Create `hkjc-horse-model/src/strategy-risk-report.js`
  - Build a compact strategy risk report from rolling ledger entries.
- Create `hkjc-horse-model/test/strategy-risk-report.test.js`
  - Unit-test drawdown, losing streak, pool attribution, pass races, and concentration metrics.
- Modify `hkjc-horse-model/src/cli.js`
  - Add `strategy-risk-report` command.
- Modify `package.json`
  - Add `hkjc:strategy-risk-report`.
- Generate `hkjc-horse-model/data/processed/strategy-risk-report.json`
  - Compact report only; no per-runner large history.
- Update README files
  - Document how to refresh the report and how to interpret it.

## Task 1: Build risk report core

**Files:**
- Modify: `hkjc-horse-model/src/performance.js`
- Create: `hkjc-horse-model/src/strategy-risk-report.js`
- Create: `hkjc-horse-model/test/strategy-risk-report.test.js`

- [ ] **Step 1: Export one settlement helper**

Change `settleStrategyEntry(entry)` to an exported function. Existing performance tests should remain unchanged.

- [ ] **Step 2: Add failing tests for the risk report**

The tests should assert:

- active races exclude pass races;
- known profit equals known return minus total stake;
- cumulative profit and max drawdown are computed race by race;
- longest losing streak counts active losing races;
- by-pool attribution separates WIN, PLACE, QUINELLA_PLACE, and QUINELLA;
- largest positive race contribution is reported so a headline ROI cannot be dominated by one lucky race.

- [ ] **Step 3: Implement `buildStrategyRiskReport(entries, options)`**

Return:

- `summary`: races, activeRaces, passRaces, totalStake, knownReturn, knownProfit, knownRoi, cumulativeProfit, maxDrawdown, longestLosingStreak, hitRate, unpricedPoolStake, unpricedHits;
- `byPool`: per pool stake, bets, hits, return, profit, roi;
- `concentration`: largest race stake share, largest positive race profit share, topHorseStakeShares;
- `timeline`: compact per-active-race rows with race id/date, stake, known return, known profit, cumulative profit, drawdown, hit flag, and main exposure.

## Task 2: Add CLI and generated artifact

**Files:**
- Modify: `hkjc-horse-model/src/cli.js`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `hkjc-horse-model/README.md`
- Generate: `hkjc-horse-model/data/processed/strategy-risk-report.json`

- [ ] **Step 1: Add CLI command**

Add `strategy-risk-report`:

```bash
node hkjc-horse-model/src/cli.js strategy-risk-report \
  --db hkjc-horse-model/data/hkjc.sqlite \
  --output hkjc-horse-model/data/processed/strategy-risk-report.json
```

It should load settled races from SQLite, build the rolling prediction ledger with the same options as the dashboard defaults, build the risk report, and write JSON.

- [ ] **Step 2: Add npm script**

Add:

```bash
npm run hkjc:strategy-risk-report
```

- [ ] **Step 3: Refresh artifact and verify**

Run:

```bash
npm run hkjc:strategy-risk-report -- --db /Users/shi/Documents/赛马市场预测/hkjc-horse-model/data/hkjc.sqlite
npm test
```

Expected: both commands pass and produce a compact `strategy-risk-report.json`.

## Acceptance criteria

- `npm test` passes.
- `strategy-risk-report.json` is generated and compact enough to commit.
- The report exposes risk warnings that explain whether strategy ROI is broad-based or concentrated in a few races/pools.
- Existing dashboard and recommendation commands keep working.
