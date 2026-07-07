# HKJC Local Horse Model

This is a first local-only Hong Kong horse-racing model. It uses official HKJC
local race result pages, builds an online horse rating state, and compares model
picks against the HKJC market favourite implied by official win odds.

It is a research and backtesting tool, not a guaranteed betting system.

## Scope

- Local Hong Kong races only: Sha Tin (`ST`) and Happy Valley (`HV`)
- Official HKJC local result pages only
- No overseas simulcast races
- No Mark Six or unrelated betting products
- Current first target: learn from official weekly results and compare:
  - model top-pick win rate
  - HKJC market favourite win rate
  - model value-bet ROI based on official win odds

## Files

- `src/hkjc-parser.js` parses official HKJC fixtures, race cards, and local result HTML.
- `src/model.js` scores horses, updates ratings, backtests, and calibrates weights.
- `src/cli.js` provides refresh, weekly fetch, backtest, and calibration commands.
- `src/sqlite-store.js` syncs official JSON files into the local SQLite research database.
- `../ranking-probabilities.js` turns runner win probabilities into a
  Harville/Plackett-Luce finishing-order distribution for multi-pool pricing.
- `data/raw/` stores fetched official result JSON.
- `data/upcoming/` stores fetched official race-card JSON before a meeting is settled.
- `data/processed/` stores latest backtest and calibration reports.
- `data/hkjc.sqlite` is the local durable SQLite database generated from raw/upcoming JSON.

## Weekly Flow

Refresh the current window from the HKJC official fixture, race-card, and result
pages. By default this looks 14 days back and 21 days forward:

```bash
npm run hkjc:refresh -- --bankroll 200 --minEdge 0 --minProbability 0.15 --maxStakePct 0.05
```

Fetch a meeting after HKJC publishes official results:

```bash
npm run hkjc:fetch -- --date 2026-01-04 --course ST --races 1-11
```

Run the rolling backtest:

```bash
npm run hkjc:backtest -- --input hkjc-horse-model/data/raw --minEdge 0
```

Calibrate the first-pass model weights:

```bash
npm run hkjc:calibrate -- --input hkjc-horse-model/data/raw --top 5
```

Generate the website dashboard data:

```bash
npm run hkjc:dashboard -- --input hkjc-horse-model/data/raw --bankroll 1000 --minEdge 0 --minProbability 0.15
```

Or use the SQLite-backed flow, which avoids repeatedly scanning/rebuilding from
loose JSON files:

```bash
npm run hkjc:sync-db
npm run hkjc:dashboard-db -- --bankroll 200 --minEdge 0 --minProbability 0.15 --maxStakePct 0.05
```

For scheduled local operation, run the combined command:

```bash
npm run hkjc:auto-run -- --bankroll 200 --minEdge 0 --minProbability 0.15 --maxStakePct 0.05 --finalEdgeBuffer 0.08
```

This syncs `data/raw` and `data/upcoming` into `data/hkjc.sqlite`, optionally
imports normalized market snapshots with `--marketInput`, exports the website
dashboard, records the latest recommendation run, and writes a post-race audit
JSON next to the dashboard output unless `--auditOutput` is supplied.

You can rerun only the recommendation audit after new results settle:

```bash
npm run hkjc:recommendation-audit
```

Pre-race odds and pool snapshots can be imported independently:

```bash
npm run hkjc:market-snapshot -- --input hkjc-horse-model/data/market-snapshot.json
```

The normalized file should contain `odds` and/or `pools` arrays with `raceId`,
`capturedAt`, `minutesToPost`, `pool`, and either `combination + oddsValue` or
`investment + sellStatus`. These snapshots are the bridge toward T-30/T-10/T-3
expected-ROI decisions.

The dashboard performance export includes probability calibration buckets plus
Brier Score and Log Loss. These scoring rules are used to watch whether the
model probability scale is trustworthy enough for EV/Kelly-style staking.

## Training dataset and model leaderboard

`training-dataset` exports one row per runner using only races seen earlier in
chronological order. This protects model training from post-race leakage.

```bash
npm run hkjc:training-dataset -- --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/processed/training-dataset.json
```

`model-leaderboard` scores the current heuristic model by split:

- train: through 2023-12-31
- validation: 2024-01-01 through 2025-12-31
- holdout: 2026-01-01 onward

```bash
npm run hkjc:model-leaderboard -- --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/processed/model-leaderboard.json
```

Promotion to real-money recommendation logic requires calibration, turnover,
drawdown, and market-price gates. Historical ROI alone is not enough.

Train the first offline Python baseline:

```bash
npm run hkjc:train-model -- --input hkjc-horse-model/data/processed/training-dataset.json --output hkjc-horse-model/data/processed/model-training-report.json
```

This produces `logit-runner-v1`, a paper-mode probability baseline. It is used
for comparison and calibration research, not automatic cash betting.

Generate the current multi-play staking risk report:

```bash
npm run hkjc:strategy-risk-report -- --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/processed/strategy-risk-report.json
```

Use this report before promoting any strategy change. It shows whether simulated
ROI comes from broad repeated edge or from concentrated outliers, and separates
Win, Place, Quinella Place, and Quinella contribution.

Open the local dashboard:

```bash
npm start
# then visit http://localhost:3000/public/hkjc.html
```

You can also fetch one official result URL directly:

```bash
npm run hkjc:fetch-url -- 'https://racing.hkjc.com/en-us/local/information/localresults?RaceNo=2&Racecourse=ST&racedate=2026%2F01%2F04'
```

## Model v0.1

The model predicts each race using only races that appeared earlier in
chronological order. Each completed race updates:

- horse rating
- recent form
- distance/surface specialty
- running style summaries
- jockey win/place stats
- trainer win/place stats

For each runner it outputs a probability and fair odds. If official win odds are
available, it computes:

```text
expected return = model probability * official win odds
edge = expected return - 1
```

A runner is a value bet only when `edge >= minEdge`.

## Website View

The dashboard is a first product surface for bettors and analysts:

- pre-race prediction table
- one value recommendation with stake guardrail
- official-result settlement after the race
- rolling profit and ROI
- model-vs-market favourite comparison
- next HKJC local meeting from the official fixture when race cards are not yet published

The site deliberately says "probability" and "edge" instead of "must buy".
Long-term trust should come from the public ledger of predictions versus HKJC
official results.

The default website stance is selective: a runner must clear both the configured
edge threshold and a minimum model win probability before it becomes a value
recommendation.

## Important Limits

- Race-card forecasts appear only after HKJC publishes local race-card starters.
- Latest odds, scratchings, and equipment changes still need a final pre-race
  refresh before any paper recommendation is treated as current.
- Positive historical ROI can be overfit. Treat calibration as a warning light,
  not proof of a permanent edge.
