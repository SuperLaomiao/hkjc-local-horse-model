# HKJC Active Continuation Roadmap

> This is the durable continuation queue for Codex and daily automations. When a session runs out of token/time, the next daily algorithm inspection should resume from the first unchecked item that is not blocked.

## Operating rule for every Codex continuation run

1. Start with `git status --short --branch`; never discard user changes.
2. Read this file and pick the first unchecked task that has no unmet dependency.
3. Use TDD for code changes: failing test first, implement, then run focused tests and `npm test`.
4. Keep generated SQLite/report artifacts local unless the repo already tracks that artifact.
5. If a task is completed, check it off in this file in the same change.
6. If the run stops early, add one short note under "Latest continuation note" with the exact next command or file to inspect.
7. Do not place bets, log in to HKJC, or interact with money. This system only produces research and recommendation support.

## Current strategic target

Reach a tested, leakage-safe recommendation system that combines:

- fundamental horse/race probability models,
- live T-30 / T-10 / T-3 odds and pool snapshots,
- calibrated multi-play probabilities for WIN / PLACE / QIN / QPL,
- EV gates, exposure caps, and post-race audit,
- comparison against stronger public GitHub ideas before upgrading cash-mode recommendations.

## Phase A — Race-day live market snapshot collection

Goal: automatically accumulate the missing 2026 live market data that our ROI model needs.

- [ ] Add a race-day snapshot planner that reads upcoming races from SQLite and returns due snapshot windows for T-30, T-10, and T-3.
  - Suggested files:
    - Create `hkjc-horse-model/src/live-snapshot-planner.js`
    - Create `hkjc-horse-model/test/live-snapshot-planner.test.js`
    - Modify `hkjc-horse-model/src/cli.js`
  - Acceptance:
    - A race at 18:30 returns due windows when current HK time is 18:00, 18:20, and 18:27.
    - A race outside the window is skipped.
    - Scratched/settled races are not captured.

- [ ] Add a CLI command `live-market-due-snapshots`.
  - Suggested command:
    ```bash
    npm run hkjc:live-market-due-snapshots -- --db hkjc-horse-model/data/hkjc.sqlite --windows T-30,T-10,T-3 --pools WIN,PLA,QIN,QPL --output hkjc-horse-model/data/processed/live-market-source-report.json
    ```
  - Acceptance:
    - `--dryRun` reports due races/windows without importing.
    - Without `--dryRun`, it calls the existing `live-market-snapshot` logic and imports snapshots.
    - Duplicate captures for the same race/window are skipped or overwritten idempotently.

- [ ] Add a low-frequency race-day automation prompt or workflow step for due snapshots.
  - Acceptance:
    - It does not poll every few minutes.
    - It only captures when a race is inside a configured T-window.
    - It produces a short Chinese report with due races, imported odds rows, imported pool rows, and next due window.

## Phase B — External benchmark reproduction

Goal: reproduce the strongest public GitHub ideas on our own SQLite history before trusting them.

- [ ] Add a benchmark registry for external ideas.
  - Suggested files:
    - Create `hkjc-horse-model/src/model-benchmark-registry.js`
    - Create `hkjc-horse-model/test/model-benchmark-registry.test.js`
    - Modify `hkjc-horse-model/src/cli.js`
  - Acceptance:
    - Registry includes `catowabisabi-lgb-quinella`, `jerrydaphantom-catboost-calibration`, and `current-baseline`.
    - Each entry records required data, leakage risks, metrics, and promotion gates.

- [ ] Export a leakage-safe Python training matrix for tree models.
  - Suggested files:
    - Modify `hkjc-horse-model/src/training-dataset.js`
    - Modify `hkjc-horse-model/src/cli.js`
    - Create/update tests under `hkjc-horse-model/test/training-dataset.test.js`
  - Acceptance:
    - Output includes chronological split, race id, runner id, label, odds features when available, and no future/post-race fields.
    - Export works as JSONL or CSV without adding large generated files to git.

- [ ] Implement `lightgbm-no-market-v1` or the closest available local tree-model fallback.
  - Suggested files:
    - Create `hkjc-horse-model/python/train_tree_model.py`
    - Create `hkjc-horse-model/python/evaluate_tree_model.py`
    - Modify `package.json` scripts
  - Acceptance:
    - If LightGBM is unavailable, the command exits with a clear installation note and does not break `npm test`.
    - If available, it writes model metrics including log loss, Brier score, top-pick win rate, and split metrics.

- [ ] Reproduce the catowabisabi top-2 Quinella experiment on our data.
  - Suggested files:
    - Create `hkjc-horse-model/src/quinella-benchmark.js`
    - Create `hkjc-horse-model/test/quinella-benchmark.test.js`
  - Acceptance:
    - It evaluates model top-2 QIN and QPL using official dividends.
    - It reports bets, wins, hit rate, ROI, max drawdown, and profit concentration.
    - It separates validation and holdout results.

## Phase C — Portfolio optimizer upgrade

Goal: make recommendations robust instead of over-dependent on one horse.

- [ ] Add EV gates that require live odds/pool data before cash-mode WIN/QIN/QPL recommendations.
  - Acceptance:
    - If no live odds are present, output stays paper/research mode.
    - If odds are below fair odds plus buffer, the line is rejected.
    - Reasons are visible in dashboard data.

- [ ] Add single-horse exposure cap across WIN / PLACE / QPL / QIN.
  - Acceptance:
    - A portfolio cannot lose 100% solely because one top horse misses unless explicitly marked "aggressive research".
    - Conservative mode prefers PLACE/QPL diversification over naked WIN.

- [ ] Add per-pool promotion gates.
  - Acceptance:
    - WIN, PLACE, QIN, and QPL each need their own validation/holdout ROI, drawdown, and sample-size thresholds.
    - Exotic exact-order pools remain paper-only unless separately validated.

## Phase D — Daily continuation and reporting

Goal: make progress visible and resumable.

- [x] Update daily algorithm automation to continue this roadmap after the normal inspection.
  - Acceptance:
    - Automation reads this file.
    - It attempts at least one safe unchecked task per day.
    - It updates "Latest continuation note" even when blocked.

- [ ] Add a dashboard/research panel showing model benchmark progress.
  - Acceptance:
    - Dashboard can display current baseline, latest tree-model candidate, and whether cash mode is allowed.
    - It shows "not ready" when ROI gates are not met.

## Latest continuation note

- 2026-07-07: Daily automation `hkjc-2` updated to resume from this roadmap after inspection. Next executable task is Phase A item 1: implement `live-snapshot-planner` with tests.
