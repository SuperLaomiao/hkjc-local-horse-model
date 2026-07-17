# Pool Money Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build leakage-safe WIN, PLACE, QIN, and QPL pool-money features and include them in the SQLite training export without invalidating rows that lack snapshots.

**Architecture:** A pure feature builder selects coherent pre-race market books and calculates runner-level values. A thin SQLite adapter loads races and snapshots, and the training CLI merges the result with existing odds features. Python consumes a fixed feature list with explicit availability flags.

**Tech Stack:** Node.js ESM, `node:test`, built-in `node:sqlite`, Python/NumPy logistic baseline.

---

### Task 1: Pure WIN pool feature calculations

**Files:**
- Create: `hkjc-horse-model/src/pool-money-features.js`
- Create: `hkjc-horse-model/test/pool-money-features.test.js`

- [x] **Step 1: Write the failing WIN-book test**

Create a settled race with runners 1 and 2, T30 WIN odds of 2.0 and 4.0, and a HK$100,000 pool. Assert normalized shares of 2/3 and 1/3, estimated money of 66,666.6667 and 33,333.3333, HHI of 5/9, crowding ratios of 4/3 and 2/3, availability `1`, payout `0.825`, and takeout `0.175`.

- [x] **Step 2: Run the focused test and verify RED**

Run: `node --test hkjc-horse-model/test/pool-money-features.test.js`

Expected: FAIL because `pool-money-features.js` or `buildPoolMoneyFeatureIndex` does not exist.

- [x] **Step 3: Implement the minimal coherent-book builder**

Export `DEFAULT_POOL_FEATURE_WINDOWS` and `buildPoolMoneyFeatureIndex({ races, oddsSnapshots, poolSnapshots, windows, payoutRate })`. Initialize every race runner, group odds by race/pool/captured time, select the nearest whole book inside each window, normalize `1 / odds`, select pool investment, and attach WIN fields.

- [x] **Step 4: Run the focused test and verify GREEN**

Run: `node --test hkjc-horse-model/test/pool-money-features.test.js`

Expected: PASS.

### Task 2: Exotic involvement, missingness, movement, and leakage tests

**Files:**
- Modify: `hkjc-horse-model/src/pool-money-features.js`
- Modify: `hkjc-horse-model/test/pool-money-features.test.js`

- [x] **Step 1: Add failing QIN involvement test**

Use QIN odds 4.0 for 1-2 and 8.0 for 1-3 and 2-3. Assert runner 1 involvement share `0.75`, expected share `2/3`, crowding `1.125`, and estimated involved money based on the selected QIN pool.

- [x] **Step 2: Run focused tests and verify RED**

Expected: FAIL because pair involvement is not implemented.

- [x] **Step 3: Implement QIN/QPL pair involvement**

Normalize combination arrays, sum market share for pairs containing each runner, derive expected involvement `2 / uniqueRunnerCount`, and attach the same logic to QIN and QPL.

- [x] **Step 4: Add failing tests for missing pools, future snapshots, coherent books, and movement**

Assert all declared runners remain in `featuresByRunner`; missing numeric values are null with availability `0`; negative minutes-to-post records are excluded; one selected book never mixes capture times; and T30-to-T10 pool investment percentage change is calculated only when both snapshots exist.

- [x] **Step 5: Implement missingness, exclusion, selection, and movement**

Add default feature initialization, reject negative minute values, select entire timestamp groups, and attach pool investment percentage changes to every runner.

- [x] **Step 6: Run focused tests and verify GREEN**

Run: `node --test hkjc-horse-model/test/pool-money-features.test.js`

Expected: all pool feature tests PASS.

### Task 3: SQLite and training export integration

**Files:**
- Modify: `hkjc-horse-model/src/sqlite-store.js`
- Modify: `hkjc-horse-model/src/cli.js`
- Modify: `hkjc-horse-model/test/sqlite-store.test.js`
- Modify: `hkjc-horse-model/test/training-dataset.test.js`

- [x] **Step 1: Write a failing SQLite integration test**

Insert race runners, T30 WIN odds, and a WIN pool snapshot. Call `loadPoolMoneyFeatures({ dbPath, races })` and assert that both runners receive pool features and summary counts report one covered race.

- [x] **Step 2: Run the SQLite test and verify RED**

Run: `node --test hkjc-horse-model/test/sqlite-store.test.js`

Expected: FAIL because `loadPoolMoneyFeatures` is missing.

- [x] **Step 3: Implement the SQLite adapter and training merge**

Load market snapshots, invoke the pure builder, and merge each runner's pool features with existing odds features in `trainingDatasetCommand`. Include a sanitized `poolMoneyFeatures` summary in the output payload and console coverage output.

- [x] **Step 4: Prove missing pools keep training rows valid**

Extend the training dataset test so a runner with explicit availability `0` and null pool values remains in the output with its target unchanged.

- [x] **Step 5: Run focused integration tests and verify GREEN**

Run: `node --test hkjc-horse-model/test/sqlite-store.test.js hkjc-horse-model/test/training-dataset.test.js`

Expected: all focused tests PASS.

### Task 4: Model feature list and real coverage smoke check

**Files:**
- Modify: `hkjc-horse-model/python/train_logit_model.py`
- Modify: `docs/active-continuation-roadmap.md`

- [x] **Step 1: Add the tested pool features to Python `FEATURES`**

Include WIN/PLACE market share, money, crowding, concentration, overround, investment, and availability for T30/T10/T3; include QIN/QPL involvement equivalents; include pool movement features. Keep payout/takeout constants out of the model because they do not vary by row.

- [x] **Step 2: Export a real local training smoke file**

Run: `npm run hkjc:training-dataset -- --db hkjc-horse-model/data/hkjc.sqlite --output /tmp/hkjc-training-pool-smoke.json`

Expected: command succeeds even when pool coverage is zero and prints honest coverage counts.

- [x] **Step 3: Train a smoke model only if variable pool coverage exists**

If pool feature coverage is nonzero and spans enough races, train the same baseline and compare probability metrics. Otherwise, record that no effect estimate is possible yet; do not claim ROI improvement.

- [x] **Step 4: Update roadmap state and continuation note**

Check off `pool-money-features` only after integration and verification. Set the next unchecked P0 task to the low-frequency race-day due-snapshot automation.

### Task 5: Full verification and commit

**Files:**
- Modify only files already listed in Tasks 1-4.

- [x] **Step 1: Run the complete suite**

Run: `npm test`

Expected: zero failed tests.

- [x] **Step 2: Inspect generated paths and git diff**

Run: `git status --short && git diff --check && git diff --stat`

Expected: no `/tmp` artifacts, external raw rows, absolute cache paths, or whitespace errors are staged.

- [x] **Step 3: Commit the completed feature**

Run: `git add ... && git commit -m "feat: add leakage-safe pool money features"`

Expected: commit succeeds on `codex/external-data-model-acceleration`.
