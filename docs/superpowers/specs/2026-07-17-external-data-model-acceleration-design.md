# External Data and Model Acceleration Design

## Goal

Use trustworthy external HKJC data and open-source research to improve the local model faster, while preserving chronological integrity, license boundaries, and honest out-of-sample evaluation.

The target is not a higher headline hit rate by itself. A candidate is useful only if it improves calibrated probability quality and produces a better holdout ROI/drawdown trade-off after HKJC takeout, with enough bets to make the result credible.

## Current position

The project already has a strong local foundation:

- SQLite stores settled races, runners, dividends, recommendation runs, historical odds snapshots, and pool snapshots.
- The dashboard and GitHub Pages site are generated from local derived data rather than loading the full history on mobile.
- A due-window collector exists for T-30, T-10, and T-3 market snapshots.
- Historical odds coverage is concentrated in 2016-2018, while current T-window pool coverage remains sparse.
- Current model ROI is still negative, so no model or pool should be promoted from research mode based on hit rate alone.

Two correctness gaps must be fixed before new model scores are trusted:

1. Recommendation evaluation must count one final pre-race lock per race and exclude post-settlement recommendations.
2. All imported features must carry an `as_of` time so post-race results, dividends, comments, or revised records cannot leak into training rows.

## Considered approaches

### A. Import every public dataset directly

This is the fastest way to increase row and feature counts, but it risks incompatible schemas, duplicated races, data leakage, and republishing data whose repository has no explicit license. It also makes model gains difficult to attribute.

### B. Ignore external data and build every collector and model locally

This gives maximum control but repeats years of scraper, feature, and benchmark work that already exists. It delays the highest-value work: current market snapshots, calibrated pricing, and honest strategy validation.

### C. Hybrid acceleration layer — selected

Reuse licensed code with attribution, keep unlicensed third-party raw data local-only, collect official data incrementally, and convert every source through a common provenance-aware feature layer. Reproduce strong public model claims on our own chronological splits before adoption.

This approach maximizes speed without treating external headline ROI as local proof.

## Source adoption matrix

| Source | Useful content | Adoption | Publication rule | Priority |
| --- | --- | --- | --- | --- |
| `sleepingarhat/tianxi-database` | 2016-2026 results, dividends, sectionals, comments, profiles, trials, trackwork, current SpeedPRO artefacts | Local source audit and optional feature backfill | No raw redistribution unless an explicit license is verified | P0 data audit |
| `mag-dot/race-data` | Current SpeedPRO form, energy, sectionals, comments, results, jockey/trainer ranks | Local optional feature importer | No raw redistribution unless an explicit license is verified | P0/P1 feature gap |
| Official HKJC public pages | Racecards, results, sectionals, trials, trackwork, veterinary records, current odds/pools | Polite incremental collectors with cache and retry | Store local raw captures; publish only permitted derived aggregates | P0 ongoing |
| HKO / data.gov.hk | Sha Tin and Happy Valley weather | Direct open-data enrichment with source timestamp | Derived features may be published with attribution | P1 |
| `eprochasson/horserace_data` | 2008-2018 results, dividends, sectionals, 2016-2018 live odds | Continue using existing local import | Respect upstream terms; avoid republishing bulk raw files | Existing baseline |
| `catowabisabi/horse-racing-model-training` | MIT LightGBM/XGBoost, Benter blend, Kelly, QIN/QPL backtests, processed benchmark files | Reproduce locally and adapt code with attribution | Code and derived local reports only | P0 model benchmark |
| `jerrydaphantom/hkjc-ml-research` | MIT market-aware CatBoost/LightGBM, calibration and threshold experiments | Reproduce methodology on our matrix | Do not claim its private/raw dataset as ours | P0 model benchmark |
| `stevw-repo/HKJC-Horse-Racing-ML-Research-Project` | MIT data lake, model zoo, calibration, live logger, Kelly sweeps, honest negative findings | Reuse engineering patterns and tests | Adapt licensed code with attribution | P1 platform donor |
| `Tang6133/hkjc-pool-tracker` | MIT pool/takeout and money-flow formulas | Adapt into pool feature builder | Code attribution required | P0 pool features |
| `Bobosky2005/hkjc-api` and `rkwyu/sport-betting-data` | Current odds/pool collection patterns | Adapt licensed collector ideas after endpoint verification | No account credentials; public endpoints only | P0 live capture |

No HKJC member login or app authorization is required for this phase. The system must not store betting credentials or place bets.

## Architecture

### 1. Source registry and provenance

Add a machine-readable registry for every external source:

- source id and canonical URL;
- license status: `licensed`, `open-data`, `unknown`, or `restricted`;
- allowed use: code reuse, local raw research, derived feature publication;
- observed coverage and last successful sync;
- field-level timing classification: pre-race, post-race, or unsafe;
- checksum/import run id for reproducibility.

Unknown-license sources remain outside tracked public data directories.

### 2. Local raw and normalized layers

Use three layers:

1. `external/raw-local/<source>/` — ignored by Git; immutable downloaded/source captures.
2. SQLite source tables — normalized identifiers, timestamps, coverage, and feature values.
3. Training exports — leakage-safe rows generated for a specific cutoff and experiment id.

External data must never overwrite authoritative settled HKJC results. Identity matching uses race date, venue, race number, horse code, and explicit conflict reports rather than horse name alone.

### 3. As-of feature contract

Every feature exposed to a model must provide:

- `race_id`, `runner_id`, and `source_id`;
- `observed_at` or a conservative availability date;
- `available_at_cutoff` for T-30/T-10/T-3 or morning prediction;
- a missingness flag;
- a leakage classification.

If availability cannot be established, the field is excluded from predictive training until manually classified.

### 4. Recommendation audit contract

Model improvements will be evaluated only on recommendations that satisfy all of the following:

- generated before race start;
- final eligible run for the configured lock window;
- one deduplicated recommendation portfolio per race and strategy version;
- settled against official results and dividends;
- retains the quoted odds/pool snapshot actually available at recommendation time.

Prepare runs and post-race regenerations remain visible for debugging but do not count toward success rate or ROI.

### 5. Pool-money features

For WIN, PLACE, QIN, and QPL, derive only pre-race features:

- pool size and change velocity;
- implied public probability and overround/takeout-adjusted share;
- crowding/concentration ratio;
- odds-to-pool inconsistency;
- T-30 to T-10 to T-3 movement and availability flags.

Missing pool data keeps a row valid but prevents cash-mode promotion for strategies that require those features.

### 6. Model reproduction ladder

Run candidates in this order:

1. Current heuristic/logistic baseline on corrected audit rows.
2. `catowabisabi` no-market LightGBM and top-two QIN/QPL experiment.
3. `jerrydaphantom` market-aware CatBoost/LightGBM plus calibration.
4. Benter-style blend of fundamental and market probabilities.
5. Portfolio optimization with per-horse and per-pool exposure limits.

All models share the same race-based chronological splits and report:

- log loss, Brier score, top-pick win rate, winner-in-top-3, and calibration buckets;
- bets, hit rate, turnover, ROI, max drawdown, longest losing run, and profit concentration;
- separate validation and untouched holdout results;
- coverage with and without SpeedPRO, pool, and live-odds enrichment.

## Promotion gates

A model or strategy may replace the current recommendation logic only when it:

1. beats the current baseline on the untouched holdout for probability quality;
2. has non-negative holdout ROI after official dividends and takeout, or materially reduces loss/drawdown while remaining research-only;
3. has at least 300 eligible bets for a single-race pool, with no single meeting contributing more than 10% of total profit;
4. keeps maximum drawdown within the configured bankroll risk limit;
5. passes leakage, duplicate, and as-of audits;
6. is reproducible from a versioned experiment manifest.

Until all gates pass, the dashboard labels the candidate `research`, `paper`, or `no-bet`; it does not present it as a proven profitable strategy.

## Delivery sequence

### Phase 0 — Integration hygiene

- Preserve the current live-snapshot work and generated data.
- Reconcile the local branch with scheduled GitHub refresh commits without destructive reset.
- Regenerate dashboard artefacts after code/data reconciliation instead of manually merging generated JSON.

### Phase 1 — Trustworthy evaluation

- Fix recommendation locking, deduplication, and post-settlement exclusion using failing tests first.
- Rebuild the audit and establish the corrected baseline.

### Phase 2 — Data acceleration

- Add source registry, coverage audit, local-only storage policy, and conflict reports.
- Audit Tianxi and `mag-dot` fields; import only pre-race-safe features.
- Add official trials, SpeedPRO/trackwork, and HKO weather incrementally.
- Continue T-30/T-10/T-3 capture for future meetings.

### Phase 3 — Pool and model acceleration

- Build pool-money features.
- Export one leakage-safe training matrix.
- Reproduce `catowabisabi`, then `jerrydaphantom`, using identical splits and metrics.

### Phase 4 — Portfolio and dashboard

- Add cross-pool and single-horse exposure caps.
- Publish side-by-side baseline/candidate evidence and promotion-gate status.
- Keep full raw history local; publish compact metrics and current predictions only.

## Error handling

- Network and parser failures are recorded per source and date; a partial import cannot mark a source as complete.
- Schema drift fails closed and writes a field-diff report.
- Duplicate or conflicting source rows are quarantined instead of silently overwriting settled data.
- A missing live snapshot downgrades the affected strategy to paper/no-bet rather than substituting a post-close odd.
- Source access failure does not block the existing dashboard; features remain optional with explicit availability flags.

## Testing

Implementation follows red-green-refactor:

- unit tests for source classification, identifiers, timing, pool formulas, and recommendation locks;
- fixture tests for Tianxi, `mag-dot`, official HKJC, and market snapshot schemas;
- leakage tests proving post-race fields cannot enter a pre-race export;
- deterministic replay tests for model experiments and dividends;
- integration tests that rebuild the dashboard from SQLite;
- full `npm test` before each commit and model-specific Python tests for benchmark code.

## Success criteria

- The corrected recommendation audit contains only final pre-race decisions.
- External-source coverage is visible by date, field, and license status.
- At least one current-season source enriches SpeedPRO/sectional/trial features without raw-data publication.
- New meetings accumulate valid T-30/T-10/T-3 odds and pool snapshots.
- The two strongest public model approaches are reproduced on our own splits.
- The dashboard clearly separates predictive metrics, betting ROI, and promotion status.
- No model is described as profitable unless it passes the holdout and risk gates above.

## Non-goals

- No automatic bet placement or HKJC credential storage.
- No publication of third-party bulk raw data without explicit permission.
- No claim of guaranteed profit or “必胜” performance.
- No promotion based only on top-3 hit rate, one meeting, or a small profitable filter.
