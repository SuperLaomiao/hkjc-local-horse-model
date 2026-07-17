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
- Research Lab follow-up action queue, mirrored from `research-program.js`, so dashboard research items and daily continuation tasks stay aligned.

## Phase A — Race-day live market snapshot collection

Goal: automatically accumulate the missing 2026 live market data that our ROI model needs.

- [x] Add a race-day snapshot planner that reads upcoming races from SQLite and returns due snapshot windows for T-30, T-10, and T-3. Research Lab action: `live-snapshot-planner` / P0.
  - Suggested files:
    - Create `hkjc-horse-model/src/live-snapshot-planner.js`
    - Create `hkjc-horse-model/test/live-snapshot-planner.test.js`
    - Modify `hkjc-horse-model/src/cli.js`
  - Reference projects:
    - `Bobosky2005/hkjc-api` odds and pool endpoint shape
    - `stevwong/hkjc-punter` race-day logger and dashboard pattern
  - Acceptance:
    - A race at 18:30 returns due windows when current HK time is 18:00, 18:20, and 18:27.
    - A race outside the window is skipped.
    - Scratched/settled races are not captured.

- [x] Add a CLI command `live-market-due-snapshots`.
  - Suggested command:
    ```bash
    npm run hkjc:live-market-due-snapshots -- --db hkjc-horse-model/data/hkjc.sqlite --windows T-30,T-10,T-3 --pools WIN,PLA,QIN,QPL --output hkjc-horse-model/data/processed/live-market-source-report.json
    ```
  - Acceptance:
    - `--dryRun` reports due races/windows without importing.
    - Without `--dryRun`, it calls the existing `live-market-snapshot` logic and imports snapshots.
    - Duplicate captures for the same race/window are skipped or overwritten idempotently.

- [x] Add pool-money feature builder for WIN / PLACE / QIN / QPL. Research Lab action: `pool-money-features` / P0.
  - Suggested files:
    - Create `hkjc-horse-model/src/pool-money-features.js`
    - Create `hkjc-horse-model/test/pool-money-features.test.js`
    - Modify `hkjc-horse-model/src/training-dataset.js`
  - Reference projects:
    - `Tang6133/hkjc-pool-tracker`
    - `Bobosky2005/hkjc-api`
  - Acceptance:
    - Features include pool size, implied takeout, crowding ratio, pool imbalance, and odds/pool availability flags.
    - Missing pool snapshots keep the row valid but mark feature availability as false.
    - No post-race dividends or results leak into pre-race features.

- [ ] Add a low-frequency race-day automation prompt or workflow step for due snapshots.
  - Acceptance:
    - It does not poll every few minutes.
    - It only captures when a race is inside a configured T-window.
    - It produces a short Chinese report with due races, imported odds rows, imported pool rows, and next due window.

## Phase B — External benchmark reproduction

Goal: reproduce the strongest public GitHub ideas on our own SQLite history before trusting them.

- [ ] Add a benchmark registry for external ideas. Research Lab action: `benchmark-registry-refresh` / P0.
  - Suggested files:
    - Create `hkjc-horse-model/src/model-benchmark-registry.js`
    - Create `hkjc-horse-model/test/model-benchmark-registry.test.js`
    - Modify `hkjc-horse-model/src/cli.js`
  - Acceptance:
    - Registry includes `catowabisabi-lgb-quinella`, `jerrydaphantom-catboost-calibration`, `neigh-speedpro-features`, `hkjc-pool-tracker-features`, `hkjc-edge-lab-clv`, and `current-baseline`.
    - Each entry records required data, leakage risks, metrics, and promotion gates.

- [ ] Add Tier1 Acceleration Lab dashboard registry. Research Lab action: `tier1-external-benchmark-registry` / P0.
  - Suggested files:
    - Modify `research-program.js`
    - Modify `test/research-program.test.js`
    - Modify `app.js`
    - Modify `styles.css`
  - Acceptance:
    - Dashboard shows Tianxi, eprochasson, Bobosky/rkwyu, j-csc, catowabisabi, jerrydaphantom, and anton benchmark/data-leverage cards.
    - Each card states public metric, our gap, leverage path, required local data, promotion gate, access policy, and local adoption status.
    - Summary clearly says the current model is still behind tier1, identifies the next benchmark to reproduce, and separately identifies the next data-leverage action.

- [ ] Export a leakage-safe Python training matrix for tree models.
  - Suggested files:
    - Modify `hkjc-horse-model/src/training-dataset.js`
    - Modify `hkjc-horse-model/src/cli.js`
    - Create/update tests under `hkjc-horse-model/test/training-dataset.test.js`
  - Acceptance:
    - Output includes chronological split, race id, runner id, label, odds features when available, and no future/post-race fields.
    - Export works as JSONL or CSV without adding large generated files to git.

- [ ] Implement `lightgbm-no-market-v1` or the closest available local tree-model fallback.
  Research Lab action: `lightgbm-no-market-benchmark` / P1.
  - Suggested files:
    - Create `hkjc-horse-model/python/train_tree_model.py`
    - Create `hkjc-horse-model/python/evaluate_tree_model.py`
    - Modify `package.json` scripts
  - Acceptance:
    - If LightGBM is unavailable, the command exits with a clear installation note and does not break `npm test`.
    - If available, it writes model metrics including log loss, Brier score, top-pick win rate, and split metrics.

- [ ] Reproduce catowabisabi LightGBM no-odds Quinella/QPL benchmark. Research Lab action: `catowabisabi-lgb-no-odds-quinella` / P0.
  - Suggested files:
    - Create `hkjc-horse-model/python/train_lgb_no_market.py`
    - Create `hkjc-horse-model/src/quinella-benchmark.js`
    - Create `hkjc-horse-model/test/quinella-benchmark.test.js`
    - Modify `package.json` scripts
  - Acceptance:
    - Replays model top-2 QIN and QPL on validation and holdout using official dividends.
    - Reports bets, wins, strike rate, ROI, max drawdown, profit concentration, and cold-quinella filter sensitivity.
    - Does not promote the strategy unless validation and holdout both beat current baseline with acceptable drawdown.

- [ ] Reproduce jerrydaphantom CatBoost/LightGBM market-aware calibration benchmark. Research Lab action: `jerrydaphantom-catboost-market-aware` / P0.
  - Suggested files:
    - Create `hkjc-horse-model/python/train_market_aware_tree.py`
    - Create `hkjc-horse-model/python/calibrate_tree_model.py`
    - Create `hkjc-horse-model/src/model-market-threshold-grid.js`
    - Create `hkjc-horse-model/test/model-market-threshold-grid.test.js`
  - Acceptance:
    - Compares market-free and market-aware versions on log loss, Brier, top-pick win rate, winner-in-top3, and calibration buckets.
    - Separates predictive quality from betting ROI.
    - Evaluates EV threshold and probability-gap threshold grids with sample-count guardrails.

- [ ] Add SpeedPRO-style feature importer and mapper. Research Lab action: `speedpro-feature-importer` / P1.
  - Suggested files:
    - Create `hkjc-horse-model/src/speedpro-feature-importer.js`
    - Create `hkjc-horse-model/test/speedpro-feature-importer.test.js`
    - Modify `hkjc-horse-model/src/training-dataset.js`
  - Reference projects:
    - `larrysammii/neigh` for SpeedPRO schema and API ideas; webpage is readable, but 2026-07-08 `git ls-remote` returned repository-not-found, so confirm clone/package access before depending on it.
    - `mag-dot/race-data`
  - Acceptance:
    - Maps sectional/pace/fitness/comment fields into normalized pre-race features when locally available.
    - Keeps these features optional and leakage-safe.
    - Records source coverage by race date so model reports can separate rows with/without SpeedPRO enrichment.

- [ ] Reproduce the catowabisabi top-2 Quinella experiment on our data.
  - Suggested files:
    - Create `hkjc-horse-model/src/quinella-benchmark.js`
    - Create `hkjc-horse-model/test/quinella-benchmark.test.js`
  - Acceptance:
    - It evaluates model top-2 QIN and QPL using official dividends.
    - It reports bets, wins, hit rate, ROI, max drawdown, and profit concentration.
    - It separates validation and holdout results.

- [x] Add Tianxi local-only feature backfill audit. Research Lab action: `tianxi-feature-backfill` / P1.
  - Suggested files:
    - Create `hkjc-horse-model/src/external-feature-source-audit.js`
    - Create `hkjc-horse-model/test/external-feature-source-audit.test.js`
    - Create `docs/research/tianxi-local-only-import-plan.md`
  - Acceptance:
    - Audits available Tianxi-like fields without committing raw third-party rows.
    - Classifies sectionals, trials, commentary, profiles, entries, and audits as pre-race, post-race, or unsafe.
    - Defines derived feature candidates and leakage lags before any importer is implemented.

- [ ] Add j-csc HKJC scraper schema and source-coverage audit. Research Lab action: `j-csc-scraper-schema-audit` / P1.
  - Suggested files:
    - Create `docs/research/j-csc-scraper-schema-audit.md`
    - Create `hkjc-horse-model/src/source-coverage-audit.js`
    - Create `hkjc-horse-model/test/source-coverage-audit.test.js`
  - Reference projects:
    - `j-csc/HK-Horse-Racing-Data-Scraper`
  - Acceptance:
    - Lists which HKJC pages/fields it covers, especially horse, racecard, draw/order, venue, and veterinary/incident records.
    - Marks each candidate field as pre-race usable, post-race only, unsafe, or unavailable.
    - Produces parser fixture/test ideas without copying third-party code or committing raw scraped data.

- [ ] Research-only: design parimutuel stacker and copula-style exotic pricing notes. Research Lab action: `parimutuel-stacker-copula-study` / P2.
  - Suggested files:
    - Create `docs/research/parimutuel-stacker-copula-notes.md`
  - Reference projects:
    - `JonzieLo/hkjc-project`
    - `xSynthesis/Multi_Place_Horse_Racing`
  - Acceptance:
    - Documents what data is missing before implementation.
    - Does not promote any exact-order exotic pool into cash-mode recommendations.

## Phase C — Portfolio optimizer upgrade

Goal: make recommendations robust instead of over-dependent on one horse.

- [ ] Add EV gates that require live odds/pool data before cash-mode WIN/QIN/QPL recommendations. Research Lab action: `no-bet-clv-gate` / P1.
  - Acceptance:
    - If no live odds are present, output stays paper/research mode.
    - If odds are below fair odds plus buffer, the line is rejected.
    - Reasons are visible in dashboard data.

- [ ] Add single-horse exposure cap across WIN / PLACE / QPL / QIN.
  - Acceptance:
    - A portfolio cannot lose 100% solely because one top horse misses unless explicitly marked "aggressive research".
    - Conservative mode prefers PLACE/QPL diversification over naked WIN.

- [ ] Add Bayesian uncertainty tripwire before staking recommendations. Research Lab action: `bayesian-tripwire` / P1.
  - Acceptance:
    - When calibration drift, live-market gap, or model disagreement is high, recommendations downgrade to paper mode or reduce stake.
    - Dashboard exposes the exact tripwire reason.
    - Tests cover at least high-disagreement, missing-live-market, and normal-pass cases.

- [ ] Add per-pool promotion gates.
  - Acceptance:
    - WIN, PLACE, QIN, and QPL each need their own validation/holdout ROI, drawdown, and sample-size thresholds.
    - Exotic exact-order pools remain paper-only unless separately validated.

## Phase D — Daily continuation and reporting

Goal: make progress visible and resumable.

- [x] Count only final executable pre-race recommendation locks in audit ROI.
  - Acceptance:
    - Prepare, superseded, and post-race generated runs remain visible but contribute zero stake and return.
    - Missing post times fail closed; a later Hong Kong calendar date is still classified as post-race.
    - Audit output reports recorded, eligible, excluded, and exclusion-reason counts.

- [x] Update daily algorithm automation to continue this roadmap after the normal inspection.
  - Acceptance:
    - Automation reads this file.
    - It attempts at least one safe unchecked task per day.
    - It updates "Latest continuation note" even when blocked.

- [ ] Add a dashboard/research panel showing model benchmark progress.
  - Acceptance:
    - Dashboard can display current baseline, latest tree-model candidate, and whether cash mode is allowed.
    - It shows "not ready" when ROI gates are not met.

## Research Lab follow-up action queue

This queue is mirrored in `research-program.js` and surfaced in the dashboard Research Lab. The daily continuation automation should treat the Phase checkboxes above as the executable source of truth; this table is the human-readable index.

| Priority | Action id | Phase | Automation status | Purpose |
| --- | --- | --- | --- | --- |
| P0 | `live-snapshot-planner` | Phase A | queued, executable | Capture T-30/T-10/T-3 live odds/pool windows. |
| P0 | `pool-money-features` | Phase A/B | implemented, awaiting T-window coverage | Turn pool money and crowding into leakage-safe features. |
| P0 | `benchmark-registry-refresh` | Phase B | queued, executable | Compare our baseline against stronger public ideas. |
| P0 | `tier1-external-benchmark-registry` | Phase B | queued, executable | Surface public benchmark metrics, our gap, and promotion gates. |
| P0 | `catowabisabi-lgb-no-odds-quinella` | Phase B | queued, executable | Reproduce no-odds LightGBM QIN/QPL edge on our SQLite data. |
| P0 | `jerrydaphantom-catboost-market-aware` | Phase B | queued, executable | Reproduce CatBoost/LightGBM market-aware calibration and EV grids. |
| P1 | `speedpro-feature-importer` | Phase B | queued, executable | Add sectional/pace/fitness enrichment when available. |
| P1 | `lightgbm-no-market-benchmark` | Phase B | queued, executable | Build a non-market tree-model benchmark before live odds are complete. |
| P1 | `tianxi-feature-backfill` | Phase B | queued, executable | Audit and design local-only derived feature imports. |
| P1 | `j-csc-scraper-schema-audit` | Phase B | queued, executable | Audit HKJC scraper field coverage, veterinary/racecard pages, and parser fixtures. |
| P1 | `no-bet-clv-gate` | Phase C | queued, executable | Reject lines without live edge and track closing-line value. |
| P1 | `bayesian-tripwire` | Phase C | queued, executable | Reduce stake or paper-mode when uncertainty is too high. |
| P2 | `parimutuel-stacker-copula-study` | Phase B/C | research-only | Document exotic-pool modeling before any implementation. |

## Latest continuation note

- 2026-07-17: Completed leakage-safe WIN/PLACE/QIN/QPL pool-money features with coherent timestamped books, strict T3 post-time/sell-status guards, valid-arity filtering, book-participant crowding baselines, normalized market/involvement shares, estimated money, HHI, overround, imbalance, availability flags, and pool movement. SQLite now restricts reads to requested races with usable pool investment, indexes snapshots by race/pool, and emits sparse features, avoiding a 6.38M-row materialization and full-history OOM. Real export succeeded for 175,574 runners / 14,250 races; the database has 36 pool snapshots but all are 1,144-1,404 minutes pre-race, so usable T60/T30/T10/T3 coverage is 0 and no model/ROI gain can yet be estimated. Next task: add the low-frequency race-day due-snapshot automation step.
- 2026-07-17: Tianxi prior-form as-of enrichment is implemented and optional in `training-dataset --tianxiRoot`. Real replay enriched 112,603/175,574 runner rows (64.1%) and filtered 2,479,721 not-yet-available row evaluations. On identical splits, holdout log loss improved from 0.267120 to 0.265832, Brier from 0.071932 to 0.071738, and top-pick win rate from 21.45% to 22.16% (121 to 125 wins over 564 races). This is probability evidence only; ROI/drawdown are not yet evaluated and cash mode remains blocked. Next task: build pool-money features, then reproduce a tree-model baseline on the enriched matrix.
- 2026-07-17: Completed `live-market-due-snapshots` with dry-run reporting, planner-backed T-window capture, race/window duplicate skipping, focused SQLite queries, and the `hkjc:live-market-due-snapshots` npm script. Focused tests: `node --test hkjc-horse-model/test/live-market-due-snapshots.test.js hkjc-horse-model/test/live-snapshot-planner.test.js hkjc-horse-model/test/live-market-snapshot.test.js`. Next task: create `hkjc-horse-model/test/pool-money-features.test.js` and add leakage-safe WIN / PLACE / QIN / QPL pool-money feature expectations.
- 2026-07-10: Completed `live-snapshot-planner` with SQLite-backed upcoming-race loading, HK-time T-30/T-10/T-3 planning, and settled/scratched/out-of-window guards. Next command: `node --test hkjc-horse-model/test/live-snapshot-planner.test.js`; next task: add the `live-market-due-snapshots` CLI command with dry-run and idempotent capture behavior.
- 2026-07-10: ChatGPT-suggested reference list reconciled with Research Lab. Added `j-csc/HK-Horse-Racing-Data-Scraper`; kept `neigh` as schema/SDK reference because GitHub API currently cannot resolve it; data-leverage priority is now explicit: Tianxi local-only feature audit, Bobosky/rkwyu live pool capture, j-csc scraper schema audit, then model reproduction.
