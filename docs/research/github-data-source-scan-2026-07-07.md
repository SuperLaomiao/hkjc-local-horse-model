# GitHub HKJC data-source scan — 2026-07-07

Purpose: identify public GitHub projects that can improve this project's local
SQLite research store, especially data we do not yet have enough of: current
market odds, pool investments, race-day artefacts, trackwork, trials, injuries,
entries, and model/strategy ideas.

## Short answer

There are three useful lanes:

1. **Operational live market capture** — use API/scraper projects to collect our
   own T-30/T-10/T-3 snapshots going forward. This is the highest ROI for the
   system because our current external live-odds data is mostly 2016-2018.
2. **Feature backfill** — use public CSV stores such as Tianxi to add trials,
   sectionals, commentary, entries, profiles, trackwork, and injury context.
3. **Algorithm borrowing** — reproduce selected LightGBM / quinella research,
   but only through our own leakage-safe train/validation/holdout evaluation.

No scanned project should be treated as a guaranteed betting edge. Most repos
are missing an explicit data license or have small out-of-sample samples.

## Priority candidates

| Priority | Repo | What it gives us | Direct data? | License note | Suggested action |
| --- | --- | --- | --- | --- | --- |
| P0 | [rkwyu/sport-betting-data](https://github.com/rkwyu/sport-betting-data) | HKJC `getJSON.aspx` odds and pool fetchers for WIN/PLA/QIN/QPL/FCT/TCE/TRI/FF/QTT/DBL/JKC/TNC plus pool investments | No historical archive; scraper code | MIT license file present | Port endpoint coverage into our `market-snapshot` normalizer and capture T-30/T-10/T-3 going forward |
| P0 | [Bobosky2005/hkjc-api](https://github.com/Bobosky2005/hkjc-api) | HKJC GraphQL wrapper for active meetings, runners, race odds, pool investments; football historical result helpers too | No historical archive; API client | MIT license file present | Use as reference for a cleaner GraphQL-based live snapshot path; fan out odds types to avoid upstream limits |
| P1 | [sleepingarhat/tianxi-database](https://github.com/sleepingarhat/tianxi-database) | 2016-2026 CSV artefacts: results, dividends, sectionals, commentary, video links, horse profiles, form records, jockeys, trainers, trials, entries, fixtures, daily audits | Yes, raw CSV in repo | No explicit license detected | Build a local-only importer for non-duplicative features; avoid republishing raw rows unless license is clarified |
| P1 | [mag-dot/race-data](https://github.com/mag-dot/race-data) | Recent scraper and JSON examples for SpeedPRO form guide, barrier trials, draw stats, race cards, jockey/trainer rankings | Some 2025-2026 JSON samples | No explicit license detected | Borrow schema ideas and optionally ingest recent JSON samples as local research-only data |
| P2 | [catowabisabi/horse-racing-model-training](https://github.com/catowabisabi/horse-racing-model-training) | LightGBM/XGBoost, Kelly, Benter blend, quinella/exotic simulations, processed parquet and reports | Yes, processed parquet and reports | MIT license file present | Reproduce the LightGBM no-odds quinella experiment inside our pipeline; do not trust headline ROI until rerun |
| P2 | [acmayuen/HK-Horse-Racing](https://github.com/acmayuen/HK-Horse-Racing) | Older 2008-2009 Excel dataset and R examples; feature-engineering ideas | Yes, Excel | No explicit license detected | Low priority: use for idea comparison only because our local history is already broader |
| P2 | [penguinnnnn/HKJCData](https://github.com/penguinnnnn/HKJCData) | Raw race info CSVs, weather, odds text; crawling scripts | Yes, raw CSV/txt | MIT license file present | Compare fields with our own importer; likely lower priority than Tianxi/eprochasson |
| Research-only | [jerrydaphantom/hkjc-ml-research](https://github.com/jerrydaphantom/hkjc-ml-research) | Chronological ML, calibration, model-vs-market threshold summaries | Mostly public results/research; private raw-data stack | MIT license file present | Read for methodology alignment; not a data source |

## Most useful findings

### 1. We should capture richer live market snapshots ourselves

`rkwyu/sport-betting-data` exposes HKJC horse-racing `getJSON.aspx` calls for:

- pre-sell WIN/PLACE, QIN, QPL, DBL
- current WIN, WIN/PLACE, QIN, QPL
- Forecast, Tierce, Trio, First Four, Quartet
- Tierce/Trio/First Four/Quartet top/banker/all variants
- Jockey Challenge and Trainer Challenge odds
- total pool investment and per-pool investment

This matches our biggest current gap: our SQLite has `odds_snapshots` and
`pool_snapshots`, but long-term near-race coverage must be accumulated by our
own T-30/T-10/T-3 snapshots.

### 2. Tianxi can backfill useful non-market features

`sleepingarhat/tianxi-database` has raw CSV artefacts under stable paths. Sample
schemas inspected:

- `data/<year>/results_YYYY-MM-DD.csv`: placings, horse number/name, jockey,
  trainer, weight, draw, lbw, running position, finish time, final win odds.
- `data/<year>/dividends_YYYY-MM-DD.csv`: pool, winning combination, dividend.
- `data/<year>/sectional_times_YYYY-MM-DD.csv`: per-runner sectional position,
  margin, and time.
- `data/<year>/commentary_YYYY-MM-DD.csv`: running commentary and gear.
- `horses/profiles/horse_profiles.csv`: horse profile, pedigree, owner,
  rating, import info, status.
- `trials/trial_results.csv`: barrier-trial date, group, distance, going,
  horse, jockey, trainer, draw, gear, finish time, commentary.
- `entries/today_entries.txt`: current/recent meeting entry snapshot.

This can help features like:

- recent trial performance before race day,
- trackwork and injury freshness,
- pedigree/import category,
- official commentary text flags,
- sectionals/pace-position patterns,
- entries and fixture completeness checks.

Because no explicit license was detected, ingest into local SQLite for private
research first, and avoid committing raw Tianxi data into our repo.

### 3. Catowabisabi is algorithmically useful, not a primary data source

The useful idea is not “copy the result”; it is the experimental design:

- compare market-free vs market-aware models,
- keep chronological splits,
- test Win, Place, QPL, Quinella and exact-order pools separately,
- inspect whether public odds improve probability but reduce payout value,
- run cold-quinella filters where the model likes a pair but the market does not.

Their headline positive result is LightGBM no-odds top-2 quinella, but the 2018
H1 out-of-sample window is still small. We should reproduce the idea on our own
local SQLite data before changing cash recommendations.

## Recommended next implementation order

1. **Live snapshot capture adapter**
   - Add an internal normalizer for HKJC `getJSON.aspx` outputs.
   - Capture WIN/PLA/QIN/QPL first, then FCT/TRI/TCE/FF/QTT.
   - Store snapshots in our existing `odds_snapshots` / `pool_snapshots` tables.
   - Schedule only race-day T-30/T-10/T-3 captures, not frequent polling.

2. **Tianxi local-only feature importer**
   - Add external-source metadata table or source label.
   - Import only derived/normalized features first: trials, sectionals,
     commentary flags, horse profile attributes.
   - Keep raw CSV cache ignored by git.
   - Compare Tianxi results/dividends against our existing official parser to
     detect mismatches before trusting it.

3. **LightGBM / quinella experiment**
   - Export our training dataset to parquet/CSV for Python tree models.
   - Train `lgb_no_market_v1` and `lgb_market_v1`.
   - Replay top-2 Quinella and QPL using official dividends.
   - Require positive validation and holdout ROI after costs and drawdown gates
     before recommendations change.

## External model/data benchmark protocol

Use this protocol for every external project that claims better data coverage,
winner hit rate, or positive expected ROI. The goal is not to copy the external
project, but to reproduce its strongest idea, stress-test it against our local
SQLite history, and only then decide whether our model should learn from it.

### Step 1. Data coverage audit

For each source, record:

- date range, number of race days, races, runner rows, and bet/result rows;
- which fields are genuinely pre-race versus final/post-race;
- which pools are covered: WIN, PLA, QIN, QPL, FCT, TRI, TCE, FF, QTT, JKC,
  TNC, multi-leg pools, and pool-investment snapshots;
- whether odds are final dividends, morning odds, T-30/T-10/T-3 snapshots, or
  post-close prices;
- schema stability and source license.

If the external data is broader than ours, first classify whether it adds:

- **market data**: live odds, pool investments, odds movement;
- **fundamental data**: race cards, sectionals, trials, trackwork, injuries,
  horse profile, pedigree, jockey/trainer histories;
- **settlement data**: dividends and winning combinations for more betting
  pools.

### Step 2. Leakage audit

Any external result is rejected until we verify that the model did not use:

- final odds as if they were pre-race odds;
- post-race dividends, placings, finish times, or commentary in pre-race
  features;
- future races inside rolling horse/jockey/trainer features;
- random train/test splits that mix future data into training.

The default standard is chronological train/validation/holdout only.

### Step 3. Reproduction before adoption

For each promising external model:

1. Rebuild its closest equivalent on our SQLite-backed training rows.
2. Run our existing baseline beside it.
3. Evaluate predictive quality and betting performance separately.
4. Keep market-free and market-aware versions distinct.
5. Save the full strategy matrix, not only the best-looking cell.

This means a repo with a high headline ROI does not influence cash
recommendations until the effect survives our own replay.

### Step 4. Metrics that decide whether we learn from it

Predictive metrics:

- log loss, Brier score, calibration by probability bucket;
- top-1 win rate, top-3 hit rate, rank correlation;
- market-free versus market-aware incremental lift.

Betting metrics:

- expected ROI and realized ROI by pool;
- turnover, number of bets, hit rate, average odds/dividend;
- max drawdown, longest losing streak, profit concentration;
- venue/distance/class stability;
- sensitivity to stake sizing and odds filters.

### Step 5. Promotion gates

An external idea can move from research to our recommendation engine only if:

- it beats our current baseline on validation and holdout, not just training;
- sample size is large enough for the target pool;
- no single race or tiny outlier group explains most profit;
- drawdown is acceptable under HK$10-100 staking limits;
- features are available before the betting cut-off, ideally by T-30;
- it improves the portfolio as a whole, not only one isolated pool.

### Step 6. How we turn better projects into our improvement

Adopt in this order:

1. **Data**: import or collect the missing fields locally.
2. **Features**: reproduce the external feature family with leakage controls.
3. **Model family**: test the algorithm under our split and metrics.
4. **Strategy filter**: test only after the probability model is calibrated.
5. **Shadow mode**: show recommendations as paper/research before cash mode.

Our target is to learn the useful part of each stronger project, then combine
it with our own multi-play portfolio, risk gates, T-30 execution workflow, and
post-race audit loop. The bar is not “match their ROI claim”; the bar is
“produce a more stable, better-calibrated, lower-drawdown recommendation system
than any one external project alone.”

## Watch-outs

- Public GitHub data projects may disappear or change schema.
- Many repos lack explicit data licenses even when code is public.
- HKJC endpoint behavior can change; live capture must be fault tolerant.
- Any model using final odds or post-race data must be banned from pre-race cash
  recommendations.
- Positive ROI claims from small windows are research leads, not proof.
