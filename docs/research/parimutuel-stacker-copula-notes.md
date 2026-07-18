# Parimutuel stacker and copula-style exotic pricing study

Study date: 2026-07-18

Status: research design complete; implementation and cash use blocked on prospective pool data.

## Executive decision

Do not port the public `JonzieLo/hkjc-project` implementation and do not adopt its headline ROI. Use only the following research questions:

1. Can a race-level probability stack beat the strongest single fundamental/market model under proper chronological scoring?
2. Does an order-statistics model improve QIN/QPL/TRIO/TIERCE rank calibration over our current Harville/Plackett-Luce baseline?
3. Is there stable residual dependence after conditioning on runner probabilities and pre-race pace context?
4. Does any improvement survive actual T-window prices, late-money slippage, pool takeout, fresh holdout and prospective settlement?

The implementation sequence is deliberately conservative:

`Harville/Plackett-Luce baseline → independent Henery/Stern order statistics → shrunk residual dependence → optional copula → stochastic multi-ticket allocation`

A copula is not the next production feature. It is the last candidate in a benchmark ladder and remains `NO_BET` until every earlier gate passes.

## Public-project audit

Audited repository: [JonzieLo/hkjc-project](https://github.com/JonzieLo/hkjc-project), commit `65c1f646f51e6ad59255e8978e58ace45591a085` (2026-05-15).

The README claims 799 walk-forward bets, +6.63% overall ROI and +35.99% TRI ROI. The public tree cannot independently reproduce those figures:

| Check | Finding | Consequence |
| --- | --- | --- |
| Data and ledger | No raw dataset, trained artifact, prediction file or reported backtest ledger is tracked. | Headline results are author claims, not a benchmark result we can compare against. |
| Validation windows | README says 25 monthly windows; `walk_forward.py` constructs `freq='6MS'` boundaries. | Reported evaluation design and code disagree. |
| Tests | No test suite is tracked. | Pool semantics, leakage, calibration and staking behavior are not regression-protected. |
| License | README/`pyproject.toml` say MIT, but there is no LICENSE file and GitHub reports no license. | Treat as unknown-license; no code reuse. |
| Dependencies | Runtime imports include PyMC/PyTensor and lifelines, but neither dependency family appears in `pyproject.toml` or `requirements.txt`. | A clean install cannot run the described stack unchanged. |
| Exotic backtester | `stern_exotics_backtest.py` imports `SternGammaSimulator`; the simulator module exports `CopulaGammaSimulator`. | That entry point is broken at the audited commit. |
| Simulation | README calls it quasi-Monte Carlo, while the implementation uses unseeded `multivariate_t.rvs`. | Results are stochastic and not QMC-reproducible. |
| TRI semantics | Simulated top-three indices are sorted before producing `TRI`. | It prices an unordered first-three combination, which is TRIO/单 T semantics, not ordered TIERCE/三重彩. |
| PLACE semantics | Simulation always counts top three. | Local 4–6 starter races require only first/second for PLACE; pool rules must be field-size aware. |
| Missing exotic prices | A backtest path synthesizes prices for missing combinations from modelled public probabilities. | Synthetic prices cannot prove executable historical ROI and must never replace missing market quotes. |
| Stacker likelihood | Race-normalized runner probabilities are fitted with row-wise Bernoulli observations. | Our reproduction must use a race-level categorical/proper ranking likelihood and race-cluster validation. |
| Dependence construction | Same pace archetype maps to the diagonal of a 5×5 matrix, creating off-diagonal perfect correlation before a positive-definite repair. | Dependence must be estimated on residuals with shrinkage; archetype identity is not pairwise correlation evidence. |

The unavailable `xSynthesis/Multi_Place_Horse_Racing` reference returns GitHub 404 and no repository matches the name in GitHub search as of the study date. It contributes no evidence until a resolvable source is supplied.

## Correct HKJC pool semantics

The current [HKJC 2026 betting guide](https://racing.hkjc.com/racing/content/PDF/RaceCard/20260531_starter_all.pdf) distinguishes:

- WIN: first horse.
- PLACE: first three in a local race, but only first two when there are 4–6 declared starters.
- QIN/连赢: first two in any order.
- QPL/位置 Q: any two of the first three in any order.
- FORECAST/二重彩: first two in correct order.
- TRIO/单 T: first three in any order.
- TIERCE/三重彩: first three in correct order.
- FIRST 4/四连环: first four in any order.
- QUARTET/四重彩: first four in correct order.

The same guide publishes different payout percentages by pool family. Therefore one generic “exotic probability × odds” threshold is invalid: each pool needs its own contract, combination normalizer, takeout/payout policy, field-size rule and promotion report.

## Probability benchmark ladder

### B0 — Current baseline

Keep our existing race-normalized WIN/PLACE stack and independently calibrated QIN/QPL pair models as the reference. Fixed top-pair replay is currently negative ROI, so cash remains `NO_BET`.

### B1 — Harville / Plackett-Luce

For normalized win probabilities `p`, the ordered top-three probability is:

`P(i,j,k) = p_i × p_j/(1-p_i) × p_k/(1-p_i-p_j)`.

Unordered pools sum only the valid permutations; ordered pools retain sequence. This is the simplest exact, deterministic baseline and must be beaten on rank log loss/Brier/calibration before a more complex model is considered. The statistical foundation is Harville's [multi-entry probability model](https://www.tandfonline.com/doi/abs/10.1080/01621459.1973.10482425) and Henery's [permutation/order-statistics comparison](https://academic.oup.com/jrsssb/article/43/1/86/7028103).

### B2 — Independent order-statistics models

Fit latent normal (Henery-style) and gamma (Stern-style) race-time distributions so simulated/analytical win marginals reproduce the calibrated runner probabilities. Shape/variance parameters must be selected on validation only and frozen for holdout.

Required checks:

- simulated WIN marginals match target probabilities within tolerance;
- probability mass for each pool sums to its legal outcome space;
- deterministic seed/Sobol sequence and convergence diagnostics;
- exact-order and unordered outcomes use different keys;
- dead heats, scratches and field-size PLACE rules are covered.

### B3 — Residual-dependence model

Only proceed if B2 shows systematic conditional residuals by pace/track/field context. Estimate dependence from out-of-fold latent residuals, not raw finish positions or same-archetype labels.

Use hierarchical shrinkage toward independence, positive-definite constraints and train-only fitting. Compare a low-rank Gaussian factor model before a Student-t copula; fit degrees of freedom rather than hard-coding it. Reconcile marginals after applying dependence so the copula does not silently change the calibrated WIN probabilities.

### B4 — Probability stack

Combine the independently generated probability distributions in log space:

`P_stack(outcome) ∝ exp(Σ_m w_m log P_m(outcome))`.

Candidate agents are fundamental tree model, independent order-statistics model, optional dependence model and a point-in-time market prior. Weights and probability calibration are selected on validation only with a race-level categorical/proper score. The untouched holdout is evaluated once; an additional fresh season is required after the current reused holdout.

Market price is not a training shortcut. A T-10 or STOP_SELL quote may be an explicitly timestamped agent; final dividends are settlement labels only.

## Minimum data contract

### Race/order labels

- complete official finishing order, dead-heat rule and disqualification/amendment history;
- declared starters, late scratches, actual field size and local/simulcast designation;
- stable horse identity and race identity;
- race-level pace, surface, rail, distance, going and pre-race runner context available at cutoff.

### Market path

For every pool and combination:

- `race_id`, `pool`, canonical ordered/unordered combination key;
- `observed_at`, `target_post_at`, `minutes_to_post`, `phase`;
- sell status, displayed dividend/odds, total pool investment and source checksum;
- coherent T-30, T-10, T-3 or true STOP_SELL book plus CLOSED/final observation;
- explicit missing-combination reason; never synthesize an executable quote.

Our current database has useful historical WIN/PLACE T-window coverage and calibrated QIN/QPL research models, but not enough 2026 prospective exotic combination books. T-30/T-10/T-3/STOP_SELL/CLOSED coverage remains the binding dependency.

## Validation and promotion gates

Each pool is promoted independently. More complex models must beat the immediately preceding baseline on the same race cohort.

1. Leakage audit: every feature and quote is available before the decision timestamp.
2. Probability quality: race/pool log loss, Brier score, calibration curve and top-combination hit rate.
3. Simulation quality: marginal reconciliation, mass conservation, deterministic convergence and sensitivity to paths/seed.
4. Pool semantics: ordered versus unordered combinations, PLACE field-size rule, scratches, dead heats, refunds and dividends.
5. Value evidence: conservative EV using actual available quotes; final prices never select bets.
6. Stability: race-cluster bootstrap intervals, monthly/venue/field-size slices, profit concentration, losing run and max drawdown.
7. Prospective evidence: immutable predictions and prices locked before post, followed by CLV/slippage and official settlement.
8. Promotion: positive validation and fresh holdout evidence, then a separate prospective sample whose uncertainty interval and drawdown gate pass.

The July 2026 revision of [Hanyu et al., “Are Final Market Prices Sufficient for Information Aggregation?”](https://arxiv.org/abs/2509.14645) uses 2004–2023 JRA interim odds and finds that final-stage odds movements contain outcome information even conditional on final odds. This reinforces our T-window path design: final-price-only backtests cannot validate a decision that must be placed earlier.

## Portfolio and loss control

If a probability model eventually passes, stake optimization must use joint payoff scenarios across all tickets rather than independent Kelly per line:

- start at 0.10×–0.25× fractional Kelly, selected prospectively rather than copied;
- cap race, day, pool, horse and overlapping-combination exposure;
- penalize payout drift and posterior probability uncertainty;
- enforce minimum legal unit/Flexi rules only after the line survives EV gates;
- apply a losing-streak/time-horizon constraint for low-hit exotic pools.

The chance-constrained framing in [Deza, Huang and Metel](https://arxiv.org/abs/1503.06535) is useful because rare exact-order payouts can have median waits measured in many thousands of races. High headline ROI from a handful of wins is not sufficient evidence for a usable strategy.

## Project action order

1. Keep B0 QIN/QPL models and all exact-order pools in paper/`NO_BET`.
2. Continue prospective pool snapshot capture; add canonical ordered combination keys and STOP_SELL/CLOSED phases.
3. Implement B1 as a deterministic pool-semantic benchmark with synthetic unit tests.
4. Implement B2 only when identical-cohort labels and actual market books exist.
5. Run a residual-dependence diagnostic; stop if independence is not rejected stably out of sample.
6. Consider B3/B4 and joint staking only after the simpler baselines pass.

No current prediction, model accuracy, ROI, bankroll recommendation or cash-mode status changes as a result of this study.
