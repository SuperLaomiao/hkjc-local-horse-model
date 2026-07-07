# HKJC Phase 5 Market Snapshot Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a market-snapshot coverage report so the system can tell whether live odds/pool snapshots are actually available before using them for T-30 expected-ROI decisions.

**Architecture:** Keep snapshot capture/import separate from betting recommendations. Reuse the existing SQLite `odds_snapshots` and `pool_snapshots` tables, add a loader for all stored snapshots, and build a compact coverage report grouped by race, pool, and minutes-to-post windows. This creates the bridge from "we can store snapshots" to "we know whether there is enough live market data to train or gate strategies."

**Tech Stack:** Node.js ES modules, built-in `node:test`, local SQLite store.

---

## File structure

- Modify `hkjc-horse-model/src/sqlite-store.js`
  - Export `loadMarketSnapshots({ dbPath, raceId })`.
- Create `hkjc-horse-model/src/market-snapshot-coverage.js`
  - Pure coverage and completeness report builder.
- Create `hkjc-horse-model/test/market-snapshot-coverage.test.js`
  - Cover T-30/T-10/T-3 windows, pool grouping, and zero-snapshot guidance.
- Modify `hkjc-horse-model/src/cli.js`
  - Add `market-coverage-report` command.
- Modify `package.json`
  - Add `hkjc:market-coverage`.
- Generate `hkjc-horse-model/data/processed/market-snapshot-coverage.json`
  - Compact artifact, safe to commit.
- Update README files
  - Document how this differs from importing market snapshots.

## Task 1: Add coverage report core

- [ ] **Step 1: Add SQLite loader**

Add `loadMarketSnapshots({ dbPath, raceId = null })` returning:

```js
{ odds: [...], pools: [...] }
```

When `raceId` is omitted, load all rows ordered by race/time/pool.

- [ ] **Step 2: Build pure coverage report**

`buildMarketSnapshotCoverageReport({ races, odds, pools })` should return:

- `summary`: races, racesWithOdds, racesWithPools, oddsSnapshots, poolSnapshots, oddsRaceCoverage, poolRaceCoverage, latestCapturedAt, readiness;
- `byWindow`: `T-60`, `T-30`, `T-10`, `T-3`, `unknown`;
- `byPool`: snapshot counts and race coverage per pool;
- `gaps`: human-readable missing-data guidance.

- [ ] **Step 3: Tests**

Tests should verify:

- races with snapshots are counted once even with many odds rows;
- minutes-to-post windows classify correctly;
- empty snapshot input returns readiness `missing-market-data`.

## Task 2: Add CLI and artifact

- [ ] **Step 1: Add command**

```bash
npm run hkjc:market-coverage -- --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/processed/market-snapshot-coverage.json
```

- [ ] **Step 2: Generate report**

Expected in current local DB: likely zero or near-zero snapshot coverage unless normalized market inputs have been imported.

- [ ] **Step 3: Verify**

Run:

```bash
npm test
```

## Acceptance criteria

- The report clearly says when market snapshots are missing instead of implying live-odds support exists.
- The command is safe to run after every post-race auto-run.
- Tests pass.
