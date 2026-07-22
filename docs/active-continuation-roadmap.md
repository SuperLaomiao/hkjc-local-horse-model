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

## Approved P0-P4 execution order — 2026-07-18

This sequence overrides the older phase ordering below when the daily continuation run chooses its first unchecked task. Detailed design and implementation steps live in:

- `docs/superpowers/specs/2026-07-18-value-betting-roadmap-design.md`
- `docs/superpowers/plans/2026-07-18-value-betting-engine.md`

### P0 — No-market probability stack, live collection, and core EV engine

- [x] Export versioned runner predictions from the LightGBM trainer.
- [x] Make LightGBM probability policy and metrics target-aware for `targetWin` and `targetPlace`.
- [x] Persist the strict Top-pick-to-PLACE holdout baseline: 564 bets, 304 hits, 53.90% hit rate, HK$4,908.40 return from HK$5,640 stake, -12.97% ROI.
- [x] Train no-market CatBoost WIN and PLACE candidates on the existing chronological matrix.
- [x] Select sigmoid/isotonic calibration and LightGBM/CatBoost blend weights on validation only; report untouched holdout metrics.
- [x] Finish low-frequency T-30/T-10/T-3 WIN/PLA collection reporting and race-day continuation behavior.
- [x] Build the core fair-price/required-price/conservative-EV engine with `PLAY`, `WATCH`, `PAPER`, and `NO_BET` states.
- [x] Route WIN/PLACE recommendations and executable audit locks through the EV engine; missing or stale prices fail closed. Cash recommendations now require a fresh, selling market snapshot, calibrated probability lineage, and a conservative EV decision of `PLAY`; non-executable decisions are forced to zero stake in the audit trail.
- [x] Produce separate WIN and PLACE promotion reports. Stronger prediction metrics may promote a research champion, but executable mode remains blocked until prospective market evidence exists. The report validates untouched holdout metrics, sample counts, calibration, prediction lineage, drawdown, and pool-specific prospective evidence; both pools fail closed to `NO_BET`.

### P1 — Market-aware stack and prospective price validation

- [x] When chronological T-window coverage is sufficient, train market-aware LightGBM/CatBoost candidates against the P0 no-market stack.
- [x] Forecast closing/final dividends from T-30/T-10/T-3 movement and measure forecast error by pool.
- [x] Record CLV, price slippage, settlement, drawdown, and prospective paper ROI for every locked recommendation.

### P2 — Portfolio and exotic-pool expansion

- [x] Add independently calibrated QIN/QPL models and per-pool promotion gates.
- [x] Add single-horse exposure, correlated-loss, and bankroll caps before any multi-play executable portfolio.

### P3 — Privacy separation

- [x] Split public sanitized GitHub Pages artifacts from private/local SQLite, raw data, market snapshots, model artifacts, recommendations, tickets, and personal audits using a publish allowlist and automated privacy scan.
  - Implementation delivered: allowlisted `.public-site/` artifact, fail-closed privacy scan, public dashboard field allowlists, private history/audit defaults, zero-budget public execution policy, and an artifact-only Pages workflow.
  - Pages activation completed on 2026-07-18: production now deploys the scanned Actions artifact instead of legacy `main /`. Remaining decision: keep the source public, make it private under an eligible plan, or split private source from a separate public Pages repository. Existing public Git history is not rewritten automatically.
  - Product decision on 2026-07-18: keep the repository and Pages public on the free tier, expose the complete browser product through `PUBLIC_FUNCTIONAL_SANITIZED`, and continue excluding SQLite, raw snapshots, full ledgers, audits, tickets, and personal records from the Pages artifact. Private hosting and account-level data separation are deferred until product maturity.

### P4 — UI redesign

- [x] Redesign the mobile-first interface after P3 around today's status, race-by-race WIN/PLA value, recommendation evidence/rejection reasons, and research/settlement history.
  - Delivered a four-destination race-day cockpit (`Today`, `Review`, `Research`, `More`) with explicit race/pool/selection context, fail-closed `PLAY/WATCH/BLOCK/NO BET` states, public retry handling, mobile bottom navigation, and verified no-meeting behavior. The redesign changes presentation only; model probabilities, EV gates, and staking calculations remain unchanged.

## Approved P5-P8 prospective execution order — 2026-07-19

This sequence supersedes the older Phase A-D queue below. The older queue remains as research history and dependency evidence; daily continuation must start here and select the first unchecked item whose dependencies are ready. Detailed implementation steps live in:

- `docs/superpowers/plans/2026-07-19-prospective-production-research.md`

### P5 — Shadow production and immutable recommendation lineage

- [x] Connect the validation-selected market-aware CatBoost WIN/PLACE champion to upcoming-race scoring in `SHADOW` mode.
  - Dependency: signed local model report, artifact, feature manifest, calibration metadata, and training cutoff all agree.
  - Acceptance: the same upcoming race exposes heuristic, no-market, market-aware, and market probabilities side by side; output records model/artifact/calibration lineage; stake is always zero and cash remains `NO_BET`.
  - Completed 2026-07-22: the frozen-lineage bridge now flows through `python/score_market_aware_candidate.py`, `src/probability-artifact.js`, `shadow-score`, `src/external-model-comparison.js`, and the Research Lab panel. Matching upcoming races can now display heuristic, no-market proxy, live-market baseline, and the validated shadow market-aware bundle side by side, including artifact/calibration/training-cutoff lineage. All outputs remain `SHADOW` / `PAPER_ONLY` / `RESEARCH_ONLY`; cash stays `NO_BET`.
- [x] Add immutable T-30/T-10/T-3 prospective recommendation locks.
  - Acceptance: a lock records race, pool, combination, raw/conservative probability, fair/required/current price, reason codes, market timestamp/window, model lineage, and paper stake; identical race/window/model inputs are idempotent and an existing lock cannot be silently rewritten.
  - Completed 2026-07-22: `buildProspectiveLocks` and `prospective-lock` now validate frozen score lineage, exact T-30/T-10/T-3 timing, WIN/PLACE/QIN/QPL combination arity, current HKJC selling price and zero cash stake before writing an append-only SHA-256 lock to local SQLite.
- [x] Auto-settle prospective locks from official results/dividends.
  - Acceptance: paper and cash ledgers stay separate; OPEN/SETTLED/VOID states are explicit; CLV, slippage, return, profit, drawdown, and losing run are recomputed from immutable locks only.
  - Completed 2026-07-22: `prospective-settle` reuses official dividend matching for HIT/MISS, handles explicit VOID/refunds, attaches safe pre-post T-3 CLV/slippage, performs one atomic OPEN-to-SETTLED/VOID transition, and feeds separate shadow/paper/cash ledgers into recommendation audit. `auto-run` invokes settlement after SQLite sync; cash remains `NO_BET`.

### P6 — Durable local prospective collection

- [ ] Add a safe local race-day runner for due T-30/T-10/T-3 snapshots and shadow locks.
  - Acceptance: local wake-ups may check the planner, but network capture occurs only inside an uncaptured configured window; retries are bounded; post-time requests fail closed; SQLite writes remain idempotent; the runner prints a short Chinese summary.
- [ ] Add a dry-run-only macOS LaunchAgent installer and operating guide.
  - Acceptance: tests render the plist without installing it; installation is an explicit local command; uninstallation is documented; GitHub Actions and GitHub Pages never receive private SQLite or market snapshots.
- [ ] Add prospective coverage, freshness, and backup-health reporting.
  - Acceptance: report coverage by meeting/window/pool, duplicate/retry counts, latest successful backup, and missing-window reasons; public output is aggregate-only.
- [ ] Pass the declared prospective-data gate for model comparison.
  - Dependency: enough fresh locked races exist after the candidate freeze date.
  - Acceptance: the gate declares its minimum race/line counts before reading ROI and reports `BLOCKED_DATA` without preventing the daily run from advancing another ready task.

### P7 — Fresh forward validation and pool-specific promotion

- [ ] Freeze candidate versions, feature policy, calibration, and EV thresholds before evaluating the new cohort.
- [ ] Compare heuristic, no-market stack, market-aware CatBoost, and market baseline on identical prospective races.
  - Acceptance: report log loss, Brier, calibration error, Top-pick WIN/PLACE, CLV, paper ROI, drawdown, losing run, monthly/meeting stability, and missing-data exclusions.
- [ ] Add meeting-block bootstrap intervals, placebo checks, and profit-concentration tests.
- [ ] Build pool-specific WIN/PLACE/QIN/QPL promotion reports and an explicit state transition.
  - Acceptance: only a fresh, sufficiently large, positive and stable prospective cohort may move a pool from `NO_BET` to a reviewed candidate state; no automation can authorize cash `PLAY` by itself.
- [ ] Surface gate progress and exact failure reasons in Research Lab using aggregate, privacy-safe fields only.

### P8 — Feature and portfolio lift after prospective gates

- [ ] Backfill timestamped historical SpeedPRO-style features and run same-cohort ablations.
- [ ] Measure incremental lift from pool money, crowding, and odds movement after controlling for the market baseline.
- [ ] Re-run QIN/QPL dependence and cold-odds experiments only when verified combination-book coverage exists; exact-order pools stay paper-only.
- [ ] Sweep fixed stake, fractional Kelly, and exposure caps only for pools with positive prospective evidence; retain zero-stake `NO_BET` everywhere else.

### Daily continuation selection rule

1. Complete one TDD-sized slice of the first ready unchecked P5-P8 item; continue to another slice when time allows.
2. If the first item is blocked only by future data, record the measurable gate and continue to the next ready engineering/research item in the same run.
3. Never mark a data-dependent gate complete from historical or reused holdout results.
4. Never log in, place a bet, change cash mode, publish private data, or overwrite local SQLite/raw snapshots.
5. Finish with focused tests, `npm test`, a local commit, and an exact next-step note. Push, merge, deployment, and account actions remain manual review boundaries.

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

- [x] Add a benchmark registry for external ideas. Research Lab action: `benchmark-registry-refresh` / P0.
  - Suggested files:
    - Create `hkjc-horse-model/src/model-benchmark-registry.js`
    - Create `hkjc-horse-model/test/model-benchmark-registry.test.js`
    - Modify `hkjc-horse-model/src/cli.js`
  - Acceptance:
    - Registry includes `catowabisabi-lgb-quinella`, `jerrydaphantom-catboost-calibration`, `neigh-speedpro-features`, `hkjc-pool-tracker-features`, `hkjc-edge-lab-clv`, and `current-baseline`.
    - Each entry records required data, leakage risks, metrics, and promotion gates.

- [x] Add Tier1 Acceleration Lab dashboard registry. Research Lab action: `tier1-external-benchmark-registry` / P0.
  - Suggested files:
    - Modify `research-program.js`
    - Modify `test/research-program.test.js`
    - Modify `app.js`
    - Modify `styles.css`
  - Acceptance:
    - Dashboard shows Tianxi, eprochasson, Bobosky/rkwyu, j-csc, catowabisabi, jerrydaphantom, and anton benchmark/data-leverage cards.
    - Each card states public metric, our gap, leverage path, required local data, promotion gate, access policy, and local adoption status.
    - Summary clearly says the current model is still behind tier1, identifies the next benchmark to reproduce, and separately identifies the next data-leverage action.

- [x] Export a leakage-safe Python training matrix for tree models.
  - Suggested files:
    - Modify `hkjc-horse-model/src/training-dataset.js`
    - Modify `hkjc-horse-model/src/cli.js`
    - Create/update tests under `hkjc-horse-model/test/training-dataset.test.js`
  - Acceptance:
    - Output includes chronological split, race id, runner id, label, odds features when available, and no future/post-race fields.
    - Export works as JSONL or CSV without adding large generated files to git.
  - Delivered by `training-matrix`: accepts generated `training-dataset` JSON, flattens only approved metadata plus nested pre-race features, sorts feature columns, and rejects malformed rows plus explicit result/target/dividend/payout/post-race keys.

- [x] Implement `lightgbm-no-market-v1` local tree-model trainer.
  Research Lab action: `lightgbm-no-market-benchmark` / P1.
  - Suggested files:
    - Create `hkjc-horse-model/python/train_tree_model.py`
    - Create `hkjc-horse-model/python/evaluate_tree_model.py`
    - Modify `package.json` scripts
  - Acceptance:
    - If LightGBM is unavailable, the command exits with a clear installation note and does not break `npm test`.
    - If available, it writes a LightGBM model artifact, feature manifest, and JSON report with log loss, Brier score, race-normalized top-pick win rate, winner-in-top3, and split metrics.
  - Delivered by `hkjc:train-tree-model`: accepts the existing JSONL/CSV matrix, uses only chronological matrix splits, treats categories explicitly in LightGBM, excludes market/odds/pool/money/investment/dividend/payout features, supports validation-only early stopping, and records selection-report lineage for the final train+validation refit.

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
  - Partial delivery: `hkjc:benchmark-exotics` now replays fixed top-2 and top-3-box QIN/QPL lines against official SQLite dividends, skips missing pools, and reports ROI, strike rate, drawdown, and losing runs. The current holdout strategies are negative ROI and remain `NO-BET`; profit-concentration and pre-race cold-odds sensitivity stay queued because validation/holdout currently have no verified T-30 odds coverage.

- [x] Reproduce jerrydaphantom CatBoost/LightGBM market-aware calibration benchmark. Research Lab action: `jerrydaphantom-catboost-market-aware` / P0.
  - Suggested files:
    - Create `hkjc-horse-model/python/train_market_aware_tree.py`
    - Create `hkjc-horse-model/python/calibrate_tree_model.py`
    - Create `hkjc-horse-model/src/model-market-threshold-grid.js`
    - Create `hkjc-horse-model/test/model-market-threshold-grid.test.js`
  - Acceptance:
    - Compares market-free and market-aware versions on log loss, Brier, top-pick win rate, winner-in-top3, and calibration buckets.
    - Separates predictive quality from betting ROI.
    - Evaluates EV threshold and probability-gap threshold grids with sample-count guardrails.
  - Delivered by the T-10 market cohort, `market-aware-t10` LightGBM/CatBoost feature policy, validation-only probability stack, `hkjc:market-value-grid`, and `hkjc:market-aware-comparison`. The untouched 230-race holdout improves materially over the identical-cohort no-market baselines, but every historical value candidate fails at least one ROI, concentration, monthly-stability, sample, or drawdown gate; cash remains `NO_BET`.

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
  - Partial delivery (2026-07-18):
    - Added `speedpro-feature-importer.js` and optional `training-dataset --speedproRoot` integration.
    - Current Tianxi SpeedPRO cache covers 5 meetings from 2026-07-01 through 2026-07-15 and 637/637 requested runner rows.
    - Cash/model promotion remains blocked because this current-season-only cohort cannot train and evaluate the same feature policy across chronological train/validation/holdout splits; historical timestamped snapshots and same-cohort comparison remain required.

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

- [x] Add j-csc HKJC scraper schema and source-coverage audit. Research Lab action: `j-csc-scraper-schema-audit` / P1.
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

- [x] Research-only: design parimutuel stacker and copula-style exotic pricing notes. Research Lab action: `parimutuel-stacker-copula-study` / P2.
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

- [x] Add EV gates that require live odds/pool data before cash-mode WIN/QIN/QPL recommendations. Research Lab action: `no-bet-clv-gate` / P1.
  - Acceptance:
    - If no live odds are present, output stays paper/research mode.
    - If odds are below fair odds plus buffer, the line is rejected.
    - Reasons are visible in dashboard data.

- [x] Add single-horse exposure cap across WIN / PLACE / QPL / QIN.
  - Acceptance:
    - A portfolio cannot lose 100% solely because one top horse misses unless explicitly marked "aggressive research".
    - Conservative mode prefers PLACE/QPL diversification over naked WIN.

- [x] Add Bayesian uncertainty tripwire before staking recommendations. Research Lab action: `bayesian-tripwire` / P1.
  - Acceptance:
    - When calibration drift, live-market gap, or model disagreement is high, recommendations downgrade to paper mode or reduce stake.
    - Dashboard exposes the exact tripwire reason.
    - Tests cover at least high-disagreement, missing-live-market, and normal-pass cases.

- [x] Add per-pool promotion gates.
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

- [x] Add a dashboard/research panel showing model benchmark progress.
  - Acceptance:
    - Dashboard can display current baseline, latest tree-model candidate, and whether cash mode is allowed.
    - It shows "not ready" when ROI gates are not met.

## Research Lab follow-up action queue

This queue is mirrored in `research-program.js` and surfaced in the dashboard Research Lab. The daily continuation automation should treat the Phase checkboxes above as the executable source of truth; this table is the human-readable index.

| Priority | Action id | Phase | Automation status | Purpose |
| --- | --- | --- | --- | --- |
| P0 | `live-snapshot-planner` | Phase A | implemented; race-day capture remains operational | Capture T-30/T-10/T-3 live odds/pool windows. |
| P0 | `pool-money-features` | Phase A/B | implemented, awaiting T-window coverage | Turn pool money and crowding into leakage-safe features. |
| P0 | `benchmark-registry-refresh` | Phase B | implemented | Compare our baseline against stronger public ideas. |
| P0 | `tier1-external-benchmark-registry` | Phase B | implemented and visible in Research Lab | Surface public benchmark metrics, our gap, and promotion gates. |
| P0 | `catowabisabi-lgb-no-odds-quinella` | Phase B | partial, blocked on verified T-30 cold-odds coverage; current replay NO-BET | Reproduce no-odds LightGBM QIN/QPL edge on our SQLite data. |
| P0 | `jerrydaphantom-catboost-market-aware` | Phase B | implemented, historical value gate NO-GO | Reproduce CatBoost/LightGBM market-aware calibration and EV grids. |
| P1 | `speedpro-feature-importer` | Phase B | partial, executable | Current 5-meeting importer is live; backfill timestamped history and run same-cohort holdout comparison. |
| P1 | `lightgbm-no-market-benchmark` | Phase B | implemented, local benchmark trained | Build a non-market tree-model benchmark before live odds are complete. |
| P1 | `tianxi-feature-backfill` | Phase B | implemented audit and optional prior-form enrichment | Audit and design local-only derived feature imports. |
| P1 | `j-csc-scraper-schema-audit` | Phase B | implemented, clean-room metadata only | Audited HKJC page/field coverage and designed veterinary/racecard parser fixtures without copying unlicensed code/data. |
| P1 | `no-bet-clv-gate` | Phase C | partial: fail-closed gate and CLV/slippage audit implemented; bootstrap/placebo and prospective locks remain | Reject lines without live edge and track closing-line value. |
| P1 | `bayesian-tripwire` | Phase C | implemented | Reduce stake or paper-mode when uncertainty is too high. |
| P2 | `parimutuel-stacker-copula-study` | Phase B/C | research design complete; implementation blocked on real T-window combination books | Benchmark simple order models before dependence/copula work; exact-order pools remain NO_BET. |

## Latest continuation note

- 2026-07-22: Completed P5 Task 2 in TDD slices and merged the preceding P5 foundation through PR #16. The local SQLite pipeline now supports validated `prospective-lock` creation and `prospective-settle` official settlement for WIN/PLACE/QIN/QPL, explicit VOID/refund, T-3 CLV/slippage, paper ROI, max drawdown and longest losing run. `recommendation-audit` reports immutable shadow, paper and cash ledgers independently, and `auto-run` settles matching OPEN locks after result sync. Real HKJC `START_SELL` is recognized as an open market; every lock remains `PAPER_ONLY`, and cash remains `NO_BET`. Exact next task: P6 Task 3, `hkjc-horse-model/src/race-day-cycle.js`.
- 2026-07-22: Completed two more TDD slices for P5 Task 2 without changing cash mode. `recommendation-audit.js` now exports a pure official-dividend settlement helper, and `prospective-locks.js` reuses the same pool semantics to settle in-memory prospective lock lines against official race dividends. Focused tests: `node --test hkjc-horse-model/test/recommendation-audit.test.js hkjc-horse-model/test/prospective-locks.test.js`. Exact next command: `sed -n '1,260p' hkjc-horse-model/src/cli.js`
- 2026-07-22: Completed two TDD slices for P5 Task 2 without changing cash mode. New code adds `hkjc-horse-model/src/prospective-locks.js` plus append-only SQLite support for `prospective_locks`: canonical SHA-256 lock ids ignore payload ordering, identical lock replays are idempotent, changed immutable content throws `PROSPECTIVE_LOCK_CONFLICT`, and an `OPEN` lock may transition exactly once to `SETTLED` or `VOID`. Focused tests: `node --test hkjc-horse-model/test/prospective-locks.test.js hkjc-horse-model/test/sqlite-store.test.js`. Exact next command: `sed -n '1,260p' hkjc-horse-model/src/recommendation-audit.js`
- 2026-07-22: Completed four more TDD slices for P5 Task 1 and closed the first P5 checkbox without changing cash mode. `external-model-comparison` now accepts an optional `--marketAwareBundle` shadow artifact, fails closed on bundle/runner mismatch, publishes a live-market baseline, and carries artifact / feature-policy / calibration / training-cutoff lineage into both the processed report and Research Lab UI. Focused tests: `node --test test/external-model-summary.test.js hkjc-horse-model/test/external-model-comparison.test.js`. Exact next command: `sed -n '1,260p' hkjc-horse-model/src/prospective-locks.js`
- 2026-07-21: Completed four TDD slices for P5 Task 1 without changing cash mode. New code adds a frozen CatBoost shadow bridge (`hkjc-horse-model/python/score_market_aware_candidate.py`), a fail-closed Node validator (`hkjc-horse-model/src/probability-artifact.js`), the Python JSONL CLI, and `node hkjc-horse-model/src/cli.js shadow-score`, which re-validates the raw bundle before writing a `SHADOW` / `PAPER_ONLY` / `RESEARCH_ONLY` artifact. Focused tests: `python3 -m unittest hkjc-horse-model/python/test_score_market_aware_candidate.py -v` and `node --test hkjc-horse-model/test/probability-artifact.test.js hkjc-horse-model/test/shadow-score-cli.test.js`. Exact next command: `sed -n '1,260p' hkjc-horse-model/src/external-model-comparison.js`
- 2026-07-19: Completed P4 as a mobile-first race-day cockpit without changing model, EV, or staking outputs. The public interface now has four durable destinations—Today, Review, Research, and More—while keeping every legacy tool reachable. The Today screen prioritizes verified availability, next-race timing, exact race/pool/selection/amount context, and rejection evidence; unknown race context, stale refreshes, unsafe publication policy, and initial load failures all fail closed to zero stake. A verified no-meeting day overrides historical race cards and displays `今天不可下注`. Browser QA passed at 390, 430, and 1280 px with no horizontal overflow, all four destinations working, and zero console warnings/errors. Full suite: 240 tests passed; public artifact privacy scan: 22 files, 0 violations. Remaining unchecked work is data/research dependent: race-day due-snapshot automation, catowabisabi QIN/QPL reproduction, SpeedPRO historical backfill, and the duplicate top-2 Quinella experiment.
- 2026-07-18: Completed the research-only parimutuel stacker/copula design without promoting exotic cash bets. The audit treats `JonzieLo/hkjc-project` +6.63% overall / +35.99% TRI ROI as unverified because the public tree has no dataset, ledger, tests or LICENSE; README monthly-window claims conflict with 6MS code, dependencies are incomplete, a backtester imports a nonexistent simulator class, and the simulated `TRI` sorts the top three into unordered TRIO semantics. The clean-room benchmark ladder is now Harville/Plackett-Luce, independent Henery/Stern order statistics, residual-dependence diagnostics, and only then a shrunk copula/stacker. Official 2026 HKJC pool semantics, T-window data contracts, marginal reconciliation, race-cluster uncertainty, prospective CLV/ROI and joint exposure gates are documented. Exact-order pools remain research-only `NO_BET`; the binding dependency is genuine same-combination T-30/T-10/T-3/STOP_SELL/CLOSED coverage.
- 2026-07-18: Completed the clean-room j-csc scraper schema audit at public commit `063a889`. Only the legacy results collector, horse-profile collector and notebook result schema are code-verifiable; the README-declared racecard, racecard-info, veterinary, penetrometer and roarer modules are absent from the public tree. The new executable manifest classifies every candidate field as pre-race usable, post-race only, unsafe or unavailable, and rejects pre-race fields missing actual `observedAt` plus target post time. Synthetic fixture designs cover declaration amendments, scratches, veterinary rowspans/publication lag, multiple track readings, identity mismatch and post-time rejection. The unknown-license source is now registry-pinned to clean-room schema review with no code/raw-data reuse. Research Lab reports 6 implemented, 2 partial, 0 queued and 1 research-only follow-up actions; no model/ROI or cash gate changed.
- 2026-07-18: Implemented the P1 uncertainty trip-wire across the final WIN plan and multi-play cash portfolio. It computes model-disagreement and calibration-drift signals, consumes a leakage-safe 90-day baseline built only from earlier settled forecasts, fails closed when no fresh selling market exists, halves moderate-risk stakes to valid HKJC units, and converts severe risk to `PAPER` with zero stake. Desktop/mobile UI exposes the exact Chinese reason, while the legacy heuristic budget card is labeled paper-only. Research Lab now reports 5 implemented, 2 partial, 0 queued, and 1 research-only follow-up actions; prospective threshold tuning remains ongoing and does not change current cash promotion gates.
- 2026-07-18: Audited `snookerlivehk-elton/hkjc-analytics` at `2dba875`. It has no published historical database, immutable snapshot archive, fitted model artifact, numeric benchmark, or license, so it is not a data/model donor and does not change cash `NO_BET`. Research Lab now records it only as a clean-room collector/methodology reference. The audit found a local post-time rounding edge: a capture seconds after post could be labeled T-3. The planner and direct GraphQL normalizer now reject exact `observed_at >= post_at`, while coverage treats legacy negative-zero minutes as unknown. Regression tests cover all paths. SpeedPRO remains partial and requires trustworthy pre-race identity/timestamps before historical promotion.
- 2026-07-18: Calibrated Research Lab against code, tests, and artifacts instead of stale queue labels. Follow-up actions now report 4 implemented, 1 partial, 2 queued, and 1 research-only item, each with public-safe delivery evidence and explicit remaining work. The catowabisabi QIN/QPL reproduction is marked partial/blocked-data because our fixed-line replay is negative and lacks verified T-30 cold-odds coverage; the jerrydaphantom market-aware reproduction is marked probability-improving but cash `NO_BET`. The deployed public-functional boundary remains separate from these model promotion decisions.
- 2026-07-18: Approved the public functional Pages mode. The exact `PUBLIC_FUNCTIONAL_SANITIZED` contract enables prediction, EV, staking, pool-guide, adaptive-route, and review tools on phone and desktop while keeping personal state in browser-local storage. Unknown, legacy, or unsafe publication markers fail closed to research-only zero-budget mode. Private processed Research Lab reports remain inaccessible and are no longer fetched merely because recommendation tools are enabled. The artifact allowlist and privacy scan continue to block raw data, SQLite, row-level ledgers, audits, tickets, secrets, and local paths.
- 2026-07-18: Activated the P3 production boundary after merge. GitHub Pages now reports `build_type: workflow`; Actions run `29635062900` completed refresh, allowlist build, privacy scan, artifact upload, and deployment successfully. The deployed dashboard reports `PUBLIC_SANITIZED`, publishes zero ledger rows, and the former full-history, recommendation-audit, and processed-report URLs return 404. The source repository remains public, so prior Git history is still accessible until the repository visibility or split-repository decision is made.
- 2026-07-18: Implemented the P3 privacy boundary without claiming that repository history is already private. The public builder now copies exactly 20 allowlisted runtime files, writes a `PUBLIC_SANITIZED` dashboard, and fails closed on extra paths, symlinks, local paths, secret patterns, forbidden recommendation/stake/ticket/audit fields, or row-level ledgers. Public JSON keeps model predictions and aggregate research metrics but removes executable recommendations, personal staking, detailed settlements, SQLite labels, and full-history links. The UI honors that marker: it shows `公开研究版 / NO BET`, hides personalized staking panels, and forces the multi-play tool to zero executable budget. Full history, recommendation audits, and processed research reports are untracked and ignored locally. The scheduled workflow no longer commits raw/audit changes; it uploads only the scanned Pages artifact. Browser verification loaded the sanitized site with all runtime modules and no current 404s. At implementation time, Pages activation and the source visibility/public-site repository choice were still pending; the next note records the completed Pages activation. Existing public Git history is not rewritten automatically.
- 2026-07-18: Completed P2 implementation without promoting a weak exotic strategy. Leakage-safe unordered pair matrices contain 102,036 QIN pairs from 1,460 races (1,464 positives) and 101,871 QPL pairs from 1,448 races (4,357 positives); races missing a pool label are excluded rather than converted to negatives. Independent CatBoost pair models are calibrated on validation only and compared with T-10 Harville QIN / PLACE-product QPL baselines. A validation-selected Benter-style stack chooses 50% model + 50% market for both pools. The chronological holdout is algorithmically out of sample for fitting, calibration, and stack selection, but it was already viewed during prior P1/P2 research iterations and is therefore explicitly marked `REUSED` and ineligible for promotion. On that reused cohort, QIN stack log loss is 0.066830, Brier 0.014187, Top-pair 12.17%, and blind one-pair ROI -21.93%; QPL stack log loss is 0.157542, Brier 0.039941, Top-pair 27.75%, and blind one-pair ROI -3.22%. Both improve log loss over market and QPL improves Top-pair by 4.41 percentage points, but Brier is slightly worse and ROI is negative; independent pool reports therefore remain `NO_GO / BLOCKED_DATA / NO_BET`. Multi-play allocation now applies the smallest of race budget, bankroll share, and remaining daily budget, then caps every horse, same-pair QIN/QPL correlation, total exotic exposure, and per-pool exposure in conservative-EV order with explicit rejection reasons. P2 code is complete; a fresh later 2026 cohort plus genuine prospective QIN/QPL locks is required before any promotion. Next implementation phase: P3 public/private artifact separation.
- 2026-07-18: Completed the prospective recommendation-audit fields without mixing paper and cash results. Final eligible pre-race lines now attach the safest positive-minute T-3 quote, indicative CLV (`locked quote / T-3 quote - 1`), T-3 price slippage, and outcome-conditioned official-dividend movement. Cash and `PAPER` stake/return/profit/ROI/drawdown are summarized independently; non-`PLAY` decisions still contribute zero cash stake. The CLI loads odds only for races with recorded recommendation runs. Real audit: 21 historical records, 0 eligible pre-race locks, 17 `PREPARE_ONLY`, 4 `POST_RACE`, therefore CLV lines 0 and paper ROI unavailable. This is an honest `BLOCKED_DATA` prospective baseline, not a zero-ROI result. P1 implementation is now complete; the next unblocked model task is P2 independent QIN/QPL calibration, while race-day collection must accumulate genuine 2026 locks before any cash promotion.
- 2026-07-18: Completed `closing-price-forecast-v1` after the separate T-3 gate passed with 1,039 races (723 train / 158 validation / 158 untouched holdout) and 12,585 runner rows at 100% race-level WIN+PLACE coverage. The leakage-safe baseline uses only T-30/T-10 log-odds movement to forecast T-3 and selects its trend coefficient on validation. Both pools select alpha 0, so T-10 persistence beats every tested trend extrapolation: holdout WIN RMSLE 0.136963 / MAPE 10.19%, PLACE RMSLE 0.104715 / MAPE 7.70%. Outcome-conditioned T-3 versus official-dividend MAPE is 19.50% for WIN winners and 16.28% for placed runners, confirming material final-price slippage. A parity bug where the alpha-zero path clamped 1.00 to 1.01 but the persistence baseline did not was reproduced with a regression test and fixed by sharing the same forecast path. Because HKJC odds are pari-mutuel and indicative rather than locked, this remains price-drift research and cash stays `NO_BET`. Next P1 task: persist per-lock T-10/T-3/final price, CLV/slippage, settlement, and drawdown in the prospective recommendation audit.
- 2026-07-18: Completed the identical-cohort P1 T-10 model comparison on 1,460 races / 17,844 runners with 100% runner WIN+PLACE odds coverage. Market-aware CatBoost is the research probability champion for both pools on the untouched 230-race holdout: WIN log loss 0.245335 / Brier 0.068501 / Top-pick win 30.43%, improving the best no-market candidate by 0.017168 log loss and 8.70 percentage points Top-pick; PLACE log loss 0.484970 / Brier 0.159901 / Top-pick PLACE 57.39%, improving by 0.038559 and 11.74 points. Calibration/blending did not beat the strongest single model. Validation-selected T-10 EV/gap grids were settled with official dividends, one bet per race. All eight direct value candidates fail at least one ROI, sample, concentration, monthly stability, or drawdown gate. The superficially positive no-market LightGBM WIN holdout ROI +26.04% is rejected because one return contributes 32.45%, validation concentration is 34.14%, monthly results are unstable, and losing runs reach 99 validation / 54 holdout. `market-aware-comparison-v1` therefore records value `NO_GO`, prospective promotion `BLOCKED_DATA`, and cash `NO_BET`. Next P1 task: forecast T-10-to-final WIN/PLACE dividends and measure price error/CLV without using final prices as prediction features.
- 2026-07-18: Added `market-aware-research-gate-v1` to avoid the impossible requirement that 2016–2018 external odds populate the fixed 2024–2025 validation split. The gate creates a separate date-safe market cohort and requires complete WIN/PLACE coverage in train, validation, and untouched holdout before research training. The real T-10 audit passes research-only mode with 1,460 races: 1,008 train (through 2017-12-27), 222 validation (2018-01-01 to 2018-03-25), and 230 holdout (2018-03-28 to 2018-06-27), all at 100% race-level WIN/PLACE coverage. Cash mode remains `NO_BET`; 2026 prospective locked decisions and settlements remain a separate blocked gate. Next P1 step: build the identical-cohort no-market versus market-aware model matrix and train comparison candidates.
- 2026-07-18: Completed P0 with separate fail-closed WIN/PLACE promotion reports. The report compares LightGBM, CatBoost, and the validation-selected calibrated stack using untouched-holdout log loss/Brier, requires prediction lineage and benchmark sample/drawdown fields, and never conflates a research champion with cash authorization. Current WIN and PLACE statuses remain `NO_BET`: blind Top-pick-to-PLACE ROI is negative, WIN-specific ROI evidence is absent, and there is no prospective locked market/settlement sample. Next phase is P1 only after the prospective T-window coverage gate passes.
- 2026-07-18: Completed pure `value-betting-v1` pricing decisions. It keeps full precision for status gates and returns rounded fair/required dividends, central and conservative EV, price edges, machine reason codes, and Chinese reasons. Missing/stale/future prices and non-selling pools fail closed to `NO_BET`; possible but insufficient edges are `WATCH`; unpromoted probabilities are `PAPER`; only fresh selling prices above the conservative safety-buffer requirement become `PLAY`. Next P0 task: remove no-market cash fallbacks and persist full value/model/market lineage in recommendation audits.
- 2026-07-18: Completed the low-frequency due-snapshot reporting contract without adding a polling loop. Each invocation still captures only currently due, uncaptured T-30/T-10/T-3 windows; the report now includes the closest computable next window plus a compact Chinese summary of due/captured/duplicate races and imported odds/pool rows, and the CLI prints it. Focused snapshot suites pass. The separate app-level scheduling policy remains independent, so GitHub Actions is not made to fabricate local live-market persistence. Next P0 task: build the pure fair-price, required-price, conservative-EV, and NO-BET engine.
- 2026-07-18: Completed `runner-probability-stack-v1`. Sigmoid/isotonic calibration and fixed LightGBM/CatBoost weights are fit/selected on validation only and applied unchanged to untouched holdout; automatic promotion is explicitly disabled. Isotonic ties now use a separately exported uncalibrated blend ranking score, preventing row-order inflation. Selected WIN is isotonic 75% LightGBM / 25% CatBoost with holdout log loss 0.252596 and Brier 0.069303 (log loss slightly worse than CatBoost alone, so no promotion). Selected PLACE is isotonic 25% LightGBM / 75% CatBoost with holdout log loss 0.491670 and Brier 0.161095, improving both best single-model probability metrics; its tie-safe Top-pick PLACE rate is 54.79%, not the artificial 57.62% produced by isotonic row-order ties. Local stack artifacts contain 175,574 runner rows. Next P0 task: finish low-frequency T-30/T-10/T-3 collection reporting.
- 2026-07-18: Completed deterministic no-market CatBoost WIN/PLACE trainers with native categorical handling, train-only selection fit, validation-only early stopping, untouched holdout reporting, and the shared versioned runner-prediction contract. CatBoost 1.2.10 is pinned. WIN stopped at 279 iterations and reports holdout log loss 0.252522 / Brier 0.069325 / Top-pick 23.58%; PLACE stopped at 365 and reports holdout log loss 0.492435 / Brier 0.161261 / Top-pick PLACE 54.79%. Blind CatBoost PLACE staking remains negative at -13.17% ROI, so it is a blend candidate only. Artifacts remain local. Next P0 task: validation-only calibration and LightGBM/CatBoost blend selection.
- 2026-07-18: Completed strict Top-pick-to-PLACE settlement with official PLACE dividends, Wilson interval, monthly results, drawdown, and losing-run reporting; missing hit dividends fail closed. The frozen WIN Top-pick holdout reproduces exactly: 564 bets, 304 hits, HK$5,640 stake, HK$4,908.40 return, -HK$731.60 profit, -12.97% ROI. The first dedicated PLACE selection model improves hits to 311/564 (55.14%) but blind-flat ROI is worse at -13.48%, proving that hit-rate improvement alone does not create value. Reports remain local under `/Users/shi/Library/Caches/hkjc-local-horse-model/models/2026-07-18/`. Next P0 task: add no-market CatBoost WIN/PLACE candidates.
- 2026-07-18: Completed target-aware LightGBM probability and metric contracts. WIN remains race-normalized; PLACE now preserves bounded runner-level probabilities and reports generic hit metrics without misleading WIN aliases. The first PLACE selection model stopped at iteration 136; untouched holdout has log loss 0.493505, Brier 0.161672, and 311/564 Top-pick PLACE hits (55.14%). Artifacts stay local under `/Users/shi/Library/Caches/hkjc-local-horse-model/models/2026-07-18/`. Next P0 task: settle versioned predictions against official PLACE dividends with the strict benchmark.
- 2026-07-18: Completed versioned per-runner prediction export for `lightgbm-no-market-v1`. `--predictions-output path.jsonl` now writes ordered runner rows with model/target lineage, race and horse identifiers, chronological split, probability, and both WIN/PLACE labels; the model report records the artifact path. Focused test: `python -m unittest -v test_train_tree_model.TreeModelFinalRefitTest.test_prediction_export_writes_versioned_runner_jsonl`. Next P0 task: make probability policy and evaluation metrics target-aware for `targetWin` versus `targetPlace`.
- 2026-07-18: Completed the leakage-safe `training-matrix` exporter. `npm run hkjc:training-matrix -- --input ...training-dataset.json --output ...training-matrix.jsonl` writes deterministic JSONL (or CSV via `--format csv`/`.csv`) with approved metadata first and sorted flattened feature columns. It preserves categorical, odds, Tianxi, and pool features, emits null/empty missing values, rejects malformed payloads and explicit leakage keys, and ignores generated matrices. Focused test: `node --test hkjc-horse-model/test/training-matrix.test.js`.
- 2026-07-18: Completed `lightgbm-no-market-v1`: `PYTHON=/path/to/python npm run hkjc:train-tree-model -- --input ...training-matrix.jsonl --output ...tree-model-report.json` accepts JSONL/CSV, excludes market features, preserves train-only category mappings and matrix chronological splits, and writes report/model/manifest artifacts. Run `python3 -m unittest -v hkjc-horse-model/python/test_train_tree_model.py` for the focused test.
- 2026-07-18: Follow-up optimization remains queued: `training-matrix` still reads the monolithic JSON input with `JSON.parse(await readFile(...))`; the observed approximately 230 MB input / 175,574 rows reached approximately 329 MB peak memory. Do not treat this as a blocker for the leakage and prepared-writer safeguards; revisit with a streaming JSON approach later without adding a third-party parser or redesigning SQLite in this round.
- 2026-07-17: Completed the model benchmark registry with the current baseline plus catowabisabi LightGBM/QIN, jerrydaphantom CatBoost calibration, neigh SpeedPRO, HKJC pool-tracker, and HKJC Edge Lab CLV ideas. Every entry now records required data, leakage risks, metrics, local adoption status, and explicit promotion gates; deterministic summary/snapshot helpers are ready for later Research Lab wiring without loading race data. Focused test: `node --test hkjc-horse-model/test/model-benchmark-registry.test.js`. Next Phase B task: connect the registry snapshot to the separate Tier1 Acceleration Lab dashboard registry.
- 2026-07-17: Completed leakage-safe WIN/PLACE/QIN/QPL pool-money features with coherent timestamped books, strict T3 post-time/sell-status guards, valid-arity filtering, book-participant crowding baselines, normalized market/involvement shares, estimated money, HHI, overround, imbalance, availability flags, and pool movement. SQLite now restricts reads to requested races with usable pool investment, indexes snapshots by race/pool, and emits sparse features, avoiding a 6.38M-row materialization and full-history OOM. Real export succeeded for 175,574 runners / 14,250 races; the database has 36 pool snapshots but all are 1,144-1,404 minutes pre-race, so usable T60/T30/T10/T3 coverage is 0 and no model/ROI gain can yet be estimated. Next task: add the low-frequency race-day due-snapshot automation step.
- 2026-07-17: Tianxi prior-form as-of enrichment is implemented and optional in `training-dataset --tianxiRoot`. Real replay enriched 112,603/175,574 runner rows (64.1%) and filtered 2,479,721 not-yet-available row evaluations. On identical splits, holdout log loss improved from 0.267120 to 0.265832, Brier from 0.071932 to 0.071738, and top-pick win rate from 21.45% to 22.16% (121 to 125 wins over 564 races). This is probability evidence only; ROI/drawdown are not yet evaluated and cash mode remains blocked. Next task: build pool-money features, then reproduce a tree-model baseline on the enriched matrix.
- 2026-07-17: Completed `live-market-due-snapshots` with dry-run reporting, planner-backed T-window capture, race/window duplicate skipping, focused SQLite queries, and the `hkjc:live-market-due-snapshots` npm script. Focused tests: `node --test hkjc-horse-model/test/live-market-due-snapshots.test.js hkjc-horse-model/test/live-snapshot-planner.test.js hkjc-horse-model/test/live-market-snapshot.test.js`. Next task: create `hkjc-horse-model/test/pool-money-features.test.js` and add leakage-safe WIN / PLACE / QIN / QPL pool-money feature expectations.
- 2026-07-10: Completed `live-snapshot-planner` with SQLite-backed upcoming-race loading, HK-time T-30/T-10/T-3 planning, and settled/scratched/out-of-window guards. Next command: `node --test hkjc-horse-model/test/live-snapshot-planner.test.js`; next task: add the `live-market-due-snapshots` CLI command with dry-run and idempotent capture behavior.
- 2026-07-10: ChatGPT-suggested reference list reconciled with Research Lab. Added `j-csc/HK-Horse-Racing-Data-Scraper`; kept `neigh` as schema/SDK reference because GitHub API currently cannot resolve it; data-leverage priority is now explicit: Tianxi local-only feature audit, Bobosky/rkwyu live pool capture, j-csc scraper schema audit, then model reproduction.
