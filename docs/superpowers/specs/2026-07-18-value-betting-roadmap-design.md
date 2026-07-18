# Value Betting Roadmap Design

## Objective

Turn the current horse-ranking system into a leakage-safe value-betting research engine. The engine must estimate separate WIN and PLACE probabilities, compare them with prices available before the race, reject negative or uncertain edges, and keep all unproven strategies in paper mode.

The delivery order is fixed as P0 through P4. Privacy separation is P3 and the UI redesign is P4 so that neither delays model training, live-market collection, or value validation.

## Delivery priorities

### P0 — Probability stack and core value engine

P0 starts immediately and has two parallel tracks.

The probability track will:

- persist the current strict holdout baseline for betting the WIN model's top pick into PLACE: 564 bets, 304 hits, 53.90% hit rate, HK$4,908.40 returned from HK$5,640 staked, and -12.97% ROI;
- train a dedicated PLACE target instead of deriving PLACE probability only from WIN rankings;
- train CatBoost no-market candidates on the existing leakage-safe matrix;
- calibrate LightGBM and CatBoost probabilities with methods selected on validation only;
- compare and, only if validation supports it, blend the calibrated LightGBM and CatBoost outputs;
- preserve the untouched chronological holdout for final comparison.

The live-market track will:

- run the existing due-snapshot collector at T-30, T-10, and T-3 on race days;
- capture WIN and PLA first, with QIN and QPL retained for the explicit P2 research phase;
- record duplicate, missing, suspended, scratched, and closed-pool states;
- produce a short Chinese collection report without high-frequency polling.

The core value engine belongs to P0. Its implementation starts once a stable probability-output contract and market-snapshot contract exist; it does not wait for a large live sample. Before verified live prices are available, it must return PAPER or NO-BET rather than fabricate an executable recommendation.

For each runner and pool it will calculate:

```text
fairDividendPer10 = 10 / calibratedProbability
requiredDividendPer10 = 10 * (1 + safetyBuffer) / conservativeProbability
expectedRoi = conservativeProbability * expectedFinalDividendPer10 / 10 - 1
```

`conservativeProbability` is a calibrated probability after uncertainty adjustment. `expectedFinalDividendPer10` uses the latest valid pre-race price initially and a final-price forecast after P1 supplies one.

The engine will expose the race, horse number, pool, calibrated probability, market price, fair price, required price, expected ROI, market timestamp, confidence state, and one of `PLAY`, `WATCH`, `PAPER`, or `NO_BET`. Missing or stale live prices fail closed.

### P1 — Market-aware modeling and prospective validation

P1 begins as soon as live snapshot coverage is sufficient for honest chronological folds. It will:

- train market-aware LightGBM and CatBoost variants with T-window features;
- measure the incremental value of WIN/PLA odds and pool money against the P0 no-market stack;
- forecast closing/final dividends from T-30/T-10/T-3 movements;
- record closing-line value and price slippage;
- search EV and probability-gap thresholds using validation folds only;
- run prospective paper recommendations and post-race settlement audits.

No retrospectively selected threshold may be labeled production-ready. Promotion requires repeated walk-forward support, sample-count guardrails, acceptable drawdown, and no dependence on a few large payouts.

### P2 — Portfolio and exotic-pool expansion

P2 will add separately calibrated QIN and QPL probability/value models, then upgrade portfolio construction with single-horse exposure caps, correlated-loss controls, and bankroll limits. QIN/QPL remain paper-only until they pass their own validation and holdout gates. Exact-order pools remain research-only.

### P3 — Privacy separation

After the value pipeline is stable, split the project into:

- a public, sanitized GitHub Pages application containing UI code, schemas, synthetic/sample data, public metrics, and documentation;
- a private/local research area containing SQLite history, raw third-party data, market snapshots, model artifacts, detailed recommendations, tickets, and personal audit records.

The separation must use an explicit publish allowlist and an automated secret/private-data scan. No private artifact may be required for the public site to build.

### P4 — UI redesign

After the data contracts and recommendation states stop changing, redesign the interface around four primary views:

1. Today's status and next T-window.
2. Race-by-race WIN/PLA value board.
3. Recommendation detail with probability, price, edge, timestamp, and rejection reason.
4. Research/settlement history and model comparison.

Advanced products and Research Lab details move behind progressive disclosure. The mobile view must show race number, horse number, pool, price, decision, and update time without opening a secondary panel.

## Component boundaries

### Probability layer

Python owns training, calibration, chronological evaluation, and model artifacts. It exports a versioned runner-probability file with separate `winProbability` and `placeProbability`, model lineage, calibration method, and split metadata.

### Market layer

The existing SQLite snapshot pipeline owns timestamped WIN/PLA/QIN/QPL prices and pool money. It never substitutes post-race dividends for a missing pre-race price.

### Value layer

JavaScript owns fair-price calculation, uncertainty haircuts, freshness checks, EV gates, and decision reasons. It consumes probability and market contracts without knowing model internals.

### Audit layer

The audit records the exact probability artifact, snapshot timestamp, price, rule version, decision, stake suggestion, settlement, ROI, drawdown, and CLV. Superseded or post-race-generated recommendations contribute zero executable stake.

### Presentation layer

The current UI consumes a stable recommendation contract during P0-P2. The full visual redesign waits until P4.

## Promotion gates

- Holdout is never used for tuning, calibration selection, blend-weight selection, or EV-threshold selection.
- WIN and PLACE have separate calibration, ROI, drawdown, and sample-count gates.
- A missing, stale, suspended, or post-race market snapshot produces `NO_BET` or `PAPER`.
- Positive hit rate alone cannot promote a strategy.
- Positive retrospective ROI alone cannot promote a strategy.
- Profit concentration, longest losing run, maximum drawdown, calibration drift, and prospective results are reported alongside ROI.
- The public site must not imply guaranteed returns or label research output as a sure win.

## Test strategy

- Python unit tests cover target selection, chronological split isolation, calibration fit boundaries, race normalization, ensemble weights, and artifact lineage.
- JavaScript unit tests cover fair-price math, safety buffers, stale/missing prices, pool-specific gates, status reasons, and single-horse exposure.
- Integration tests replay fixed races through probability, snapshot, EV, audit, and settlement contracts.
- Regression fixtures preserve the 564-race strict holdout baseline and prevent accidental leakage or metric drift.
- Browser verification remains focused on existing functional surfaces until the P4 redesign.

## Completion definition

P0 is complete when calibrated no-market WIN and PLACE candidates are compared on the untouched holdout, race-day T-window collection is active, and the core engine can issue auditable PAPER/NO-BET decisions with fair and required prices.

P1 is complete when market-aware candidates and closing-price forecasts are evaluated prospectively with CLV and settlement audits.

P2 is complete when portfolio and QIN/QPL candidates have independent promotion reports.

P3 and P4 are complete only after their separate implementation plans and acceptance tests pass.
