# Value Betting Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver calibrated no-market WIN and PLACE probabilities, continuously collect valid pre-race prices, and turn those contracts into an auditable EV/NO-BET engine before adding market-aware models.

**Architecture:** Python owns model training, calibration, blending, chronological evaluation, and runner-probability artifacts. The existing SQLite market pipeline owns timestamped prices and pool states. A new pure JavaScript value engine joins the two contracts, applies freshness and uncertainty gates, and supplies decisions to the portfolio and audit layers. Holdout data is reporting-only and post-race dividends are settlement-only.

**Tech Stack:** Python 3, LightGBM, CatBoost, scikit-learn, pandas, NumPy, Node.js ES modules, SQLite, Node test runner, Python unittest.

---

## File map

- Modify `hkjc-horse-model/python/train_tree_model.py`: target-aware probability policy and versioned prediction artifacts.
- Modify `hkjc-horse-model/python/test_train_tree_model.py`: regression coverage for prediction exports and PLACE metrics.
- Create `hkjc-horse-model/python/benchmark_place_strategy.py`: settle top-pick-to-PLACE predictions against official dividends.
- Create `hkjc-horse-model/python/test_benchmark_place_strategy.py`: deterministic PLACE baseline tests.
- Create `hkjc-horse-model/python/train_catboost_model.py`: leakage-safe no-market CatBoost candidate trainer.
- Create `hkjc-horse-model/python/test_train_catboost_model.py`: split, dependency, and artifact-lineage tests.
- Create `hkjc-horse-model/python/build_probability_stack.py`: validation-only calibration and LightGBM/CatBoost blend selection.
- Create `hkjc-horse-model/python/test_build_probability_stack.py`: calibration, blend, and holdout-isolation tests.
- Modify `hkjc-horse-model/python/requirements-tree-model.txt`: add the pinned CatBoost dependency.
- Create `hkjc-horse-model/src/value-betting-engine.js`: fair-price, conservative-EV, freshness, and NO-BET decisions.
- Create `hkjc-horse-model/test/value-betting-engine.test.js`: pure value-engine tests.
- Modify `multi-play-portfolio.js`: consume value decisions and remove no-market cash fallbacks.
- Modify `test/multi-play-portfolio.test.js`: contract and fail-closed integration tests.
- Modify `hkjc-horse-model/src/live-market-due-snapshots.js`: expose next-window and Chinese collection summary data.
- Modify `hkjc-horse-model/test/live-market-due-snapshots.test.js`: low-frequency report and duplicate tests.
- Modify `hkjc-horse-model/src/recommendation-audit.js`: persist model/price/rule lineage and CLV-ready fields.
- Modify `hkjc-horse-model/test/recommendation-audit.test.js`: executable-lock and value-lineage tests.
- Modify `package.json`: add probability-stack and PLACE-benchmark commands.
- Modify `docs/active-continuation-roadmap.md`: make this P0 sequence the daily continuation source of truth and retain P3/P4 ordering.

### Task 1: Export versioned runner predictions

**Files:**
- Modify: `hkjc-horse-model/python/train_tree_model.py`
- Modify: `hkjc-horse-model/python/test_train_tree_model.py`

- [ ] **Step 1: Write the failing prediction-artifact test**

Add a test that calls `run_training(..., predictions_output_path=...)` and asserts each JSONL row has the stable contract:

```python
prediction = json.loads(prediction_path.read_text(encoding="utf-8").splitlines()[0])
self.assertEqual(
    set(prediction),
    {
        "version", "modelId", "target", "raceId", "date", "split",
        "horseId", "horseNo", "fieldSize", "probability",
        "targetWin", "targetPlace",
    },
)
self.assertEqual(report["predictionArtifact"], str(prediction_path))
```

- [ ] **Step 2: Run the test and verify the missing argument failure**

Run:

```bash
python3 -m unittest -v hkjc-horse-model/python/test_train_tree_model.py
```

Expected: FAIL because `run_training` does not accept `predictions_output_path`.

- [ ] **Step 3: Implement deterministic JSONL export**

Add `predictions_output_path=None` to `run_training`, write rows in matrix order using `_round_or_none(probability)`, include the artifact path in the report, and add CLI option:

```python
parser.add_argument("--predictions-output", help="versioned runner prediction JSONL")
```

The export must include all chronological splits so later evaluators can filter without reconstructing model state. It must never include feature values or post-race dividends.

- [ ] **Step 4: Run focused tests**

Run the same unittest command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add hkjc-horse-model/python/train_tree_model.py hkjc-horse-model/python/test_train_tree_model.py
git commit -m "feat: export versioned tree predictions"
```

### Task 2: Make LightGBM metrics target-aware

**Files:**
- Modify: `hkjc-horse-model/python/train_tree_model.py`
- Modify: `hkjc-horse-model/python/test_train_tree_model.py`

- [ ] **Step 1: Write failing PLACE policy tests**

Add tests proving WIN probabilities sum to one per race, while PLACE probabilities stay bounded and are not forced to sum to one:

```python
place = apply_target_probability_policy(rows, [0.7, 0.5, 0.2], target="targetPlace")
self.assertEqual(place, [0.7, 0.5, 0.2])
self.assertAlmostEqual(sum(place), 1.4)

metrics = compute_split_metrics(rows, place, target="targetPlace")
self.assertEqual(metrics["topPickHits"], 1)
self.assertEqual(metrics["topPickHitRate"], 1.0)
```

- [ ] **Step 2: Verify failure**

Run the tree-model unittest file. Expected: FAIL because PLACE currently uses WIN race normalization and WIN-named metrics.

- [ ] **Step 3: Implement the policy**

Add:

```python
def apply_target_probability_policy(rows, raw_probabilities, target):
    if target == "targetWin":
        return normalize_race_probabilities(rows, raw_probabilities)
    if target == "targetPlace":
        return [max(PROBABILITY_EPSILON, min(1.0 - PROBABILITY_EPSILON, float(value)))
                for value in raw_probabilities]
    raise ValueError(f"Unsupported target: {target}")
```

Return generic `topPickHits`, `topPickHitRate`, `positiveInTop3`, and `positiveInTop3Rate`. Preserve the existing WIN aliases only when `target == "targetWin"` so current dashboard readers do not break.

- [ ] **Step 4: Run tests and train a selection-stage PLACE model**

```bash
python3 -m unittest -v hkjc-horse-model/python/test_train_tree_model.py
python3 -m venv /Users/shi/Library/Caches/hkjc-local-horse-model/python-env
/Users/shi/Library/Caches/hkjc-local-horse-model/python-env/bin/python -m pip install -r hkjc-horse-model/python/requirements-tree-model.txt
PYTHON=/Users/shi/Library/Caches/hkjc-local-horse-model/python-env/bin/python npm run hkjc:train-tree-model -- \
  --input hkjc-horse-model/data/processed/training-matrix.jsonl \
  --output /Users/shi/Library/Caches/hkjc-local-horse-model/models/2026-07-18/lightgbm-place-selection.json \
  --predictions-output /Users/shi/Library/Caches/hkjc-local-horse-model/models/2026-07-18/lightgbm-place-selection.predictions.jsonl \
  --target targetPlace --early-stopping-rounds 50
```

Expected: tests pass; report says `targetPlace`; holdout remains out-of-sample.

- [ ] **Step 5: Commit**

```bash
git add hkjc-horse-model/python/train_tree_model.py hkjc-horse-model/python/test_train_tree_model.py
git commit -m "feat: train target-aware place model"
```

### Task 3: Persist the strict Top-pick-to-PLACE baseline

**Files:**
- Create: `hkjc-horse-model/python/benchmark_place_strategy.py`
- Create: `hkjc-horse-model/python/test_benchmark_place_strategy.py`
- Modify: `package.json`

- [ ] **Step 1: Write failing settlement tests**

Use two races with one hit and one miss:

```python
report = benchmark_top_pick_place(predictions, races, split="holdout", stake_per_bet=10)
self.assertEqual(report["bets"], 2)
self.assertEqual(report["hits"], 1)
self.assertEqual(report["stake"], 20)
self.assertEqual(report["return"], 18.5)
self.assertEqual(report["profit"], -1.5)
self.assertAlmostEqual(report["roi"], -0.075)
```

Also assert missing official dividends fail the report rather than silently becoming zero return.

- [ ] **Step 2: Verify failure**

```bash
python3 -m unittest -v hkjc-horse-model/python/test_benchmark_place_strategy.py
```

Expected: FAIL because the benchmark module does not exist.

- [ ] **Step 3: Implement settlement-only dividend joining**

The module must rank each race by `probability`, select one runner, use `targetPlace` for the hit, and use the matching official PLACE `dividendPer10` only to settle a hit. Output bets, hits, hit rate, stake, return, profit, ROI, average winning dividend, break-even dividend, Wilson hit-rate interval, monthly results, drawdown, and longest losing run.

- [ ] **Step 4: Add the command and reproduce the frozen baseline**

Add:

```json
"hkjc:benchmark-place": "${PYTHON:-python3} hkjc-horse-model/python/benchmark_place_strategy.py"
```

Run it against the final WIN model prediction artifact and raw race directory. Expected strict holdout regression:

```text
bets=564 hits=304 hitRate=0.539007 stake=5640.0
return=4908.4 profit=-731.6 roi=-0.129716
```

- [ ] **Step 5: Commit**

```bash
git add package.json hkjc-horse-model/python/benchmark_place_strategy.py hkjc-horse-model/python/test_benchmark_place_strategy.py
git commit -m "feat: benchmark top pick place strategy"
```

### Task 4: Add no-market CatBoost candidates

**Files:**
- Create: `hkjc-horse-model/python/train_catboost_model.py`
- Create: `hkjc-horse-model/python/test_train_catboost_model.py`
- Modify: `hkjc-horse-model/python/requirements-tree-model.txt`
- Modify: `package.json`

- [ ] **Step 1: Write dependency and split-isolation tests**

Tests must assert a clear installation error when CatBoost is absent, that only `train` is used during selection, and final refit includes `train+validation` but never `holdout`.

```python
self.assertEqual(model.fit_splits, ["train"])
self.assertTrue(report["metrics"]["bySplit"]["holdout"]["isOutOfSample"])
self.assertNotIn("holdout", report["fitSplits"])
```

- [ ] **Step 2: Verify failure**

```bash
python3 -m unittest -v hkjc-horse-model/python/test_train_catboost_model.py
```

Expected: FAIL because the trainer is absent.

- [ ] **Step 3: Implement the CatBoost trainer**

Reuse matrix loading and no-market feature selection from `train_tree_model.py`. Use native categorical columns, deterministic seeds, `Logloss`, and validation-only early stopping. Support `targetWin` and `targetPlace`, and emit the same report, manifest, and runner-prediction contract as LightGBM.

Pin CatBoost in the requirements file and add:

```json
"hkjc:train-catboost-model": "${PYTHON:-python3} hkjc-horse-model/python/train_catboost_model.py"
```

- [ ] **Step 4: Run tests and train WIN/PLACE selection candidates**

Run the CatBoost unittest and train both targets using the existing matrix. Expected: holdout untouched and artifacts stored outside git.

- [ ] **Step 5: Commit**

```bash
git add package.json hkjc-horse-model/python/requirements-tree-model.txt hkjc-horse-model/python/train_catboost_model.py hkjc-horse-model/python/test_train_catboost_model.py
git commit -m "feat: add no-market CatBoost trainer"
```

### Task 5: Calibrate and blend LightGBM with CatBoost

**Files:**
- Create: `hkjc-horse-model/python/build_probability_stack.py`
- Create: `hkjc-horse-model/python/test_build_probability_stack.py`
- Modify: `package.json`

- [ ] **Step 1: Write validation-only selection tests**

Create fixtures with train, validation, and holdout rows. Patch the calibration fit function and assert it receives validation labels only. Assert blend weights are selected from validation and then applied unchanged to holdout.

```python
self.assertEqual(selection["selectedOn"], "validation")
self.assertEqual(selection["holdoutUsedForSelection"], False)
self.assertIn(selection["blendWeight"], [0.0, 0.25, 0.5, 0.75, 1.0])
```

- [ ] **Step 2: Verify failure**

```bash
python3 -m unittest -v hkjc-horse-model/python/test_build_probability_stack.py
```

- [ ] **Step 3: Implement calibration and blend selection**

Compare raw, sigmoid, and isotonic calibration by validation log loss and Brier score. Evaluate fixed LightGBM weights `[0, .25, .5, .75, 1]`, with CatBoost weight `1-w`. Select separately for WIN and PLACE. Race-normalize WIN after calibration; keep PLACE runner probabilities bounded without forcing their sum to one.

Emit:

```json
{
  "version": "runner-probability-stack-v1",
  "selectionSplit": "validation",
  "holdoutUsedForSelection": false,
  "pools": {"WIN": {}, "PLACE": {}},
  "metrics": {"validation": {}, "holdout": {}}
}
```

Also emit JSONL rows with `winProbability`, `placeProbability`, component probabilities, calibration method, and blend weight.

- [ ] **Step 4: Run tests and build the local stack**

Add `hkjc:probability-stack` to `package.json`, run focused tests, then build the stack from LightGBM and CatBoost prediction artifacts. Expected: a local report comparing every candidate; no automatic promotion if holdout regresses.

- [ ] **Step 5: Commit**

```bash
git add package.json hkjc-horse-model/python/build_probability_stack.py hkjc-horse-model/python/test_build_probability_stack.py
git commit -m "feat: calibrate and blend runner probabilities"
```

### Task 6: Finish the low-frequency live-market collection contract

**Files:**
- Modify: `hkjc-horse-model/src/live-market-due-snapshots.js`
- Modify: `hkjc-horse-model/test/live-market-due-snapshots.test.js`
- Modify: `docs/active-continuation-roadmap.md`

- [ ] **Step 1: Write failing next-window and Chinese-summary tests**

Assert the runner returns the closest future due window and a compact summary:

```js
assert.deepEqual(report.nextDue, {
  raceId: '2026-07-18-ST-2',
  window: 'T-10',
  dueAt: '2026-07-18T10:20:00.000Z',
});
assert.match(report.summaryZh, /捕获 1 场/);
assert.match(report.summaryZh, /赔率 12 行/);
```

- [ ] **Step 2: Verify failure**

```bash
node --test hkjc-horse-model/test/live-market-due-snapshots.test.js
```

- [ ] **Step 3: Implement report helpers without polling**

Add pure `nextDueWindow()` and `formatDueSnapshotSummaryZh()` helpers. One command invocation captures only windows currently due; scheduling remains low-frequency and race-day-aware. Keep idempotent duplicate behavior.

- [ ] **Step 4: Run the focused snapshot suite**

```bash
node --test hkjc-horse-model/test/live-market-due-snapshots.test.js hkjc-horse-model/test/live-snapshot-planner.test.js hkjc-horse-model/test/live-market-snapshot.test.js
```

Expected: PASS with no network requirement in tests.

- [ ] **Step 5: Commit**

```bash
git add docs/active-continuation-roadmap.md hkjc-horse-model/src/live-market-due-snapshots.js hkjc-horse-model/test/live-market-due-snapshots.test.js
git commit -m "feat: report due live market windows"
```

### Task 7: Build the core fair-price and EV engine

**Files:**
- Create: `hkjc-horse-model/src/value-betting-engine.js`
- Create: `hkjc-horse-model/test/value-betting-engine.test.js`

- [ ] **Step 1: Write failing value-decision tests**

Cover positive edge, insufficient edge, missing price, stale price, suspended pool, and research-only probability:

```js
const decision = evaluateValueCandidate({
  pool: 'PLACE', probability: 0.55, conservativeProbability: 0.52,
  dividendPer10: 21, capturedAt: '2026-07-18T10:00:00Z',
  evaluatedAt: '2026-07-18T10:05:00Z', sellStatus: 'SELLING',
  safetyBuffer: 0.08, maxAgeMinutes: 15, probabilityStatus: 'CALIBRATED',
});
assert.equal(decision.fairDividendPer10, 18.18);
assert.equal(decision.requiredDividendPer10, 20.77);
assert.equal(decision.status, 'PLAY');
```

Missing or stale prices must return `NO_BET`; uncalibrated probabilities return `PAPER`.

- [ ] **Step 2: Verify failure**

```bash
node --test hkjc-horse-model/test/value-betting-engine.test.js
```

- [ ] **Step 3: Implement the pure engine**

Export `evaluateValueCandidate`, `fairDividendPer10`, `requiredDividendPer10`, and `marketFreshness`. Round only presentation fields; retain full precision for status decisions. Every decision must include a machine-readable `reasonCode` and Chinese `reasonZh`.

- [ ] **Step 4: Run focused tests**

Expected: all value-engine tests pass.

- [ ] **Step 5: Commit**

```bash
git add hkjc-horse-model/src/value-betting-engine.js hkjc-horse-model/test/value-betting-engine.test.js
git commit -m "feat: add fair price and EV engine"
```

### Task 8: Integrate value decisions into recommendations and audit

**Files:**
- Modify: `multi-play-portfolio.js`
- Modify: `test/multi-play-portfolio.test.js`
- Modify: `hkjc-horse-model/src/recommendation-audit.js`
- Modify: `hkjc-horse-model/test/recommendation-audit.test.js`

- [ ] **Step 1: Write failing fail-closed portfolio tests**

Replace expectations that PLACE/QPL can receive cash stakes without market prices. Assert:

```js
assert.equal(portfolio.totalStake, 0);
assert.equal(portfolio.cashLines.length, 0);
assert.equal(portfolio.watchLines[0].decision.status, 'NO_BET');
```

Add an executable fixture with calibrated probability, fresh selling price, and positive conservative EV.

- [ ] **Step 2: Verify failure**

```bash
node --test test/multi-play-portfolio.test.js hkjc-horse-model/test/recommendation-audit.test.js
```

- [ ] **Step 3: Route WIN and PLACE through the value engine**

Remove `placeStake()` and `qplStake()` cash fallbacks when no usable market exists. Attach `probabilityArtifactId`, `modelId`, `calibrationMethod`, `marketCapturedAt`, `marketWindow`, `ruleVersion`, conservative probability, fair price, required price, EV, status, and reason to each recommendation and audit lock.

- [ ] **Step 4: Run focused and full JavaScript tests**

```bash
node --test hkjc-horse-model/test/value-betting-engine.test.js test/multi-play-portfolio.test.js hkjc-horse-model/test/recommendation-audit.test.js
npm test
```

Expected: PASS; no cash line exists without a valid pre-race market snapshot.

- [ ] **Step 5: Commit**

```bash
git add multi-play-portfolio.js test/multi-play-portfolio.test.js hkjc-horse-model/src/recommendation-audit.js hkjc-horse-model/test/recommendation-audit.test.js
git commit -m "feat: gate recommendations on conservative EV"
```

### Task 9: Produce the P0 promotion report

**Files:**
- Create: `hkjc-horse-model/python/build_value_model_report.py`
- Create: `hkjc-horse-model/python/test_build_value_model_report.py`
- Modify: `package.json`
- Modify: `docs/active-continuation-roadmap.md`

- [ ] **Step 1: Write failing promotion-gate tests**

Require separate WIN and PLACE sections and reject reports missing holdout, drawdown, sample count, calibration, or lineage:

```python
self.assertEqual(report["promotion"]["WIN"]["status"], "NO_BET")
self.assertEqual(report["promotion"]["PLACE"]["status"], "NO_BET")
self.assertIn("prospective market sample unavailable", report["promotion"]["PLACE"]["reasons"])
```

- [ ] **Step 2: Verify failure**

Run the new unittest. Expected: FAIL because the report builder is absent.

- [ ] **Step 3: Implement the report builder**

Combine LightGBM, CatBoost, probability-stack, PLACE baseline, and market-coverage reports. A stronger probability model may become the research champion, but WIN/PLACE remain `NO_BET` until prospective pre-race price evidence exists.

- [ ] **Step 4: Run all P0 verification commands**

```bash
python3 -m unittest -v \
  hkjc-horse-model/python/test_train_tree_model.py \
  hkjc-horse-model/python/test_benchmark_place_strategy.py \
  hkjc-horse-model/python/test_train_catboost_model.py \
  hkjc-horse-model/python/test_build_probability_stack.py \
  hkjc-horse-model/python/test_build_value_model_report.py
npm test
git diff --check
```

- [ ] **Step 5: Commit**

```bash
git add package.json docs/active-continuation-roadmap.md hkjc-horse-model/python/build_value_model_report.py hkjc-horse-model/python/test_build_value_model_report.py
git commit -m "feat: report value model promotion gates"
```

### Task 10: Start P1 only after market-coverage gate passes

**Files:**
- Create: `hkjc-horse-model/python/train_market_aware_stack.py`
- Create: `hkjc-horse-model/python/test_train_market_aware_stack.py`
- Create: `hkjc-horse-model/python/forecast_final_dividend.py`
- Create: `hkjc-horse-model/python/test_forecast_final_dividend.py`
- Create: `hkjc-horse-model/src/clv-report.js`
- Create: `hkjc-horse-model/test/clv-report.test.js`

- [ ] **Step 1: Enforce the coverage precondition**

The command must exit without training unless each evaluation fold has timestamped, pre-race WIN/PLA data in its declared decision window and the report states the exact covered races. A zero-coverage holdout must produce `BLOCKED_DATA`, not an empty model.

- [ ] **Step 2: Add market-aware comparison tests**

Fixtures must verify market features are admitted only when `capturedAt < postTime`, and that post-race/final dividends never enter training features.

- [ ] **Step 3: Train market-aware candidates and closing-price forecasts**

Compare no-market and market-aware LightGBM/CatBoost on identical chronological folds. Forecast final dividend from T-30/T-10/T-3 features, report MAE/calibration by pool, and feed only forecast prices into historical decision-time simulations.

- [ ] **Step 4: Add CLV and prospective paper audit**

For each locked recommendation, record locked price, final price, CLV, realized return, and whether the decision would still pass after price movement. Retrospective threshold searches remain research-only.

- [ ] **Step 5: Verify and commit P1 as an independent change set**

Run its Python and JavaScript tests plus `npm test`; update the roadmap only after the coverage gate and tests pass.

## Deferred independent plans

- P2 receives a separate implementation plan for QIN/QPL probability models, exposure caps, and correlated portfolio risk after P0 passes and P1 has usable market coverage.
- P3 receives a separate privacy-split implementation plan after the research contracts stabilize.
- P4 receives a separate brainstorming/design/implementation cycle after P3 so the redesigned UI consumes stable public/private data contracts.
