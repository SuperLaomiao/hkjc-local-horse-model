# HK Local Horse Model

A static GitHub Pages dashboard for a Hong Kong local horse-racing paper
simulation model.

Public dashboard:
https://superlaomiao.github.io/hkjc-local-horse-model/

## What It Shows

- HKJC local-race model predictions
- Final betting plan: entry window, odds floor, stake cap, and pass rules
- Large refresh button for pulling the latest published plan before a race
- Mobile-first PWA shell with installable app metadata
- Value-bet filter and paper-bankroll guardrail
- Official-result settlement ledger
- Rolling paper profit / ROI
- Model top-pick win rate
- Browser-local self-test mode for your own paper picks
- Forecast lock records for comparing pre-race snapshots with later results
- Conservative HK$10-100 staking strategy panel
- Adaptive race-by-race route that recalculates later stakes after each
  settled hit, miss, or open race
- Multi-play portfolio optimizer that estimates Win, Place, Quinella Place,
  Quinella, and paper exotic probabilities before allocating a structured
  stake
- Hour/minute race countdown with a T-30 review marker once HKJC race-card
  start times are available
- Betting-products guide for Win / Place / Quinella / Quinella Place,
  Forecast, Trio, Tierce, First 4, Quartet, multi-leg tickets, and
  Jockey/Trainer Challenge slips
- Per-bet-line post-race review for strategy suggestions, including
  `HIT`, `MISS`, `OPEN`, or not-yet-reviewable states
- Model performance panel with odds buckets, probability calibration, and
  staking-strategy backtest diagnostics
- Next Hong Kong local meeting when HKJC race cards are not yet published

## Important

This is a paper simulation and research dashboard. It is not an investment
product, not financial advice, and not a guaranteed betting system.

## Data

The published dashboard uses a static `data/dashboard.json` export generated
from the local model workspace. The current export was refreshed from the HKJC
official fixture/results/race-card flow.

GitHub Actions is configured in `.github/workflows/refresh-hkjc-data.yml` to
refresh baseline data around 09:00 Hong Kong time, plus one post-race refresh
around 23:45 Hong Kong time on common Hong Kong race days. It can also be run
manually from the Actions tab.

To refresh the source workspace:

```bash
npm run hkjc:refresh -- --bankroll 200 --minEdge 0 --minProbability 0.15 --maxStakePct 0.05 --finalEdgeBuffer 0.08
```

Then sync the refreshed raw/race-card files into the local SQLite database and
export the website dashboard from that database:

```bash
npm run hkjc:sync-db
npm run hkjc:dashboard-db -- --bankroll 200 --minEdge 0 --minProbability 0.15 --maxStakePct 0.05 --finalEdgeBuffer 0.08
```

For unattended local operation, use the combined command:

```bash
npm run hkjc:auto-run -- --bankroll 200 --minEdge 0 --minProbability 0.15 --maxStakePct 0.05 --finalEdgeBuffer 0.08
```

It syncs raw/upcoming JSON into SQLite, optionally imports a market snapshot
when `--marketInput path/to/market-snapshot.json` is supplied, regenerates
`data/dashboard.json`, and records the latest recommendation run for later
audit/replay. It also writes the latest settled recommendation review to
`data/latest-recommendation-audit.json` unless `--auditOutput` is supplied.

Codex also has a local recurring automation named `HKJC赛后数据抓取` (`hkjc`)
that runs after likely Hong Kong race days instead of polling frequently. It is
intended to refresh the local SQLite store, rebuild the dashboard, and produce
one post-race recommendation audit without requiring a manual prompt in this
chat.

You can also regenerate only the latest recommendation audit:

```bash
npm run hkjc:recommendation-audit
```

The SQLite database is stored locally at
`hkjc-horse-model/data/hkjc.sqlite`. It is the durable local research store for
official race results, runners, dividends, upcoming race cards, pre-race market
snapshots, pool snapshots, and recommendation-run audit records. The static
website still reads `data/dashboard.json`; SQLite is used to build and replay
the model before exporting that JSON.

## Local model training exports

The mobile dashboard intentionally stays lightweight. Full historical modelling
runs locally from SQLite.

Generate leakage-safe runner rows:

```bash
npm run hkjc:training-dataset -- --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/processed/training-dataset.json
```

Generate the current baseline model leaderboard:

```bash
npm run hkjc:model-leaderboard -- --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/processed/model-leaderboard.json
```

Compare the current model with external GitHub-inspired model views for an
upcoming meeting:

```bash
npm run hkjc:external-model-comparison -- --date 2026-07-08 --venue HV --db hkjc-horse-model/data/hkjc.sqlite --trainingReport hkjc-horse-model/data/processed/model-training-report.json --output hkjc-horse-model/data/processed/external-model-comparison-2026-07-08-HV.json
```

The comparison report includes the current local heuristic, a
catowabisabi-inspired no-odds fundamental/Quinella proxy, a
jerrydaphantom-inspired market-free calibrated proxy, and a market-aware proxy
when live WIN odds have been imported. The external project views are research
proxies unless they are separately validated on our own holdout history.

Train the first offline Python baseline:

```bash
npm run hkjc:train-model -- --input hkjc-horse-model/data/processed/training-dataset.json --output hkjc-horse-model/data/processed/model-training-report.json
```

This produces `logit-runner-v1`, a paper-mode probability baseline. It is used
for comparison and calibration research, not automatic cash betting.

Generate the multi-play staking risk report:

```bash
npm run hkjc:strategy-risk-report -- --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/processed/strategy-risk-report.json
```

This report replays the current HK$10-100 Win / Place / Quinella Place /
Quinella strategy, then exposes per-pool ROI, maximum drawdown, losing streaks,
largest-race concentration, and whether headline profit depends on one or two
outlier races.

The first leaderboard is a baseline for research. It should not be treated as
proof of a betting edge.

## External research source audit

Before importing data or code from another project, generate the source-policy
report:

```bash
npm run hkjc:external-source-audit
```

The report is saved to
`hkjc-horse-model/data/processed/external-source-audit.json`. It records the
canonical URL, source role, license status, permitted uses, provenance
requirements, cache policy, and pre-race/post-race timing classification for
each approved external source.

Raw files from sources without an explicit reusable data license stay under
the ignored `hkjc-horse-model/data/external/raw-local/` boundary or an external
local cache. They are not committed and do not flow directly into the public
dashboard. Only leakage-safe derived aggregates or features allowed by the
source policy may be published. Current-race results, dividends, comments, and
sectionals are always treated as post-race fields for that race.

Market snapshots can be imported once official odds/capital-pool data is
available in normalized JSON:

```bash
npm run hkjc:market-snapshot -- --input hkjc-horse-model/data/market-snapshot.json
```

For current HKJC race-day odds/pool capture, use the live GraphQL snapshot
command. It writes directly to the local SQLite `odds_snapshots` and
`pool_snapshots` tables; add `--dryRun` when you only want to inspect a report:

```bash
npm run hkjc:live-market-snapshot -- --date 2026-07-08 --venue HV --race 1-7 --pools WIN,PLA,QIN,QPL --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/processed/live-market-source-report.json --dryRun
```

To capture only currently due T-30/T-10/T-3 windows, run the planner-backed command. It skips a race/window when SQLite already contains odds or pool rows for that window:

```bash
npm run hkjc:live-market-due-snapshots -- --db hkjc-horse-model/data/hkjc.sqlite --windows T-30,T-10,T-3 --pools WIN,PLA,QIN,QPL --output hkjc-horse-model/data/processed/live-market-source-report.json --dryRun
```

The command uses HKJC's whitelisted GraphQL query shapes and requests odds
types in small batches. `PLA` is normalized to `PLACE`, `QIN` to `QUINELLA`,
and `QPL` to `QUINELLA PLACE` so the existing market-feature code can read the
snapshots consistently.

For local research, historical HKJC WIN/PLACE live odds can also be imported
from the external `eprochasson/horserace_data` GitHub dataset:

```bash
npm run hkjc:external-live-odds -- --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/processed/external-live-odds-import.json
```

This imports only into the local SQLite store and produces a small summary
report. Do not commit or republish the raw external CSV/GZ files unless the
dataset license is clarified. The imported live odds are used as market
features in `training-dataset` exports.

Check whether those snapshots are actually sufficient for T-30/T-10/T-3
research:

```bash
npm run hkjc:market-coverage -- --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/processed/market-snapshot-coverage.json
```

Run an eprochasson-inspired market-window report that tests whether T-30 WIN
market favourites, odds caps, and T-60 → T-30 odds shortening have useful ROI:

```bash
npm run hkjc:market-window-research -- --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/processed/market-window-research.json
```

This report is deliberately a research guardrail: it tests simple market rules
before they are allowed to influence cash recommendations.

If this report says `missing-market-data`, the system should keep treating
live-odds expected ROI as unavailable and continue accumulating normalized
market snapshots.

Expected shape:

```json
{
  "odds": [
    {
      "raceId": "2026-07-08-HV-1",
      "date": "2026-07-08",
      "racecourse": "HV",
      "raceNo": 1,
      "capturedAt": "2026-07-08T10:00:00.000Z",
      "minutesToPost": 30,
      "pool": "PLACE",
      "combination": [2],
      "oddsValue": 2.4,
      "source": "official"
    }
  ],
  "pools": [
    {
      "raceId": "2026-07-08-HV-1",
      "date": "2026-07-08",
      "racecourse": "HV",
      "raceNo": 1,
      "capturedAt": "2026-07-08T10:00:00.000Z",
      "minutesToPost": 30,
      "pool": "PLACE",
      "investment": 98765,
      "sellStatus": "START_SELLING",
      "source": "official"
    }
  ]
}
```

The source dashboard currently has 137 settled HK local races through
2026-07-04 Sha Tin. Race-card forecasts appear only after HKJC publishes local
starters.

The refresh parser validates that an official-results page actually matches the
requested meeting date and race number before writing it into historical data.
If HKJC falls back to a previous meeting before new results are published, the
page is rejected instead of polluting the backtest.

The page-level refresh button reloads the latest published `data/dashboard.json`
without browser cache. GitHub Pages cannot safely store a secret token in the
browser, so this button does not directly trigger the GitHub Actions backend.
The backend workflow is intentionally low-frequency for now: daily baseline plus
post-race refresh. A future Worker/API can make the button trigger an immediate
server-side HKJC refresh once realtime odds/pool capture is added.

## Deployment

The stable public dashboard is served by GitHub Pages from the `main` branch
root:

https://superlaomiao.github.io/hkjc-local-horse-model/

After pushing to `main`, GitHub Pages rebuilds the static site automatically.
The site reads `data/dashboard.json`, so the published view reflects the latest
committed dashboard export rather than the local SQLite database file.

## Self-Test Lab

The dashboard includes a local "我的测试台" mode:

- Click "我选这匹" in a race table to record your own paper pick.
- Click "锁定本场预测" to save the model forecast shown in your browser.
- After official results are refreshed, the page settles your paper pick as
  `WIN`, `MISS`, or `OPEN`.
- These records use browser `localStorage`; they stay on this device/browser
  only. Clearing browser data or switching devices removes them.

The "模型成绩 / Backtest Lab" panel is separate from your local picks. It shows
rolling backtest health, market-favourite comparison, top-pick odds buckets,
probability calibration, and the current HK$10-100 staking strategy replayed
against settled historical races. Treat it as model diagnostics, not proof of a
future edge. The strategy replay can truthfully settle the Win lines because the
local historical data includes official Win odds. Place, Quinella Place, and
Quinella returns are settled where official dividend rows are available; any
missing dividend pools are still shown as unpriced-pool stake and break-even
return gaps.

## Staking Strategy

The "建议投注策略" panel turns the model forecast into a conservative paper
staking plan:

- PASS when the model signal is too weak.
- HK$10-20 for light Place-only tests.
- HK$30 as the standard plan, usually Place plus a small Win line.
- HK$50-80 only when the main pick and support horses are strong enough for
  Quinella Place lines.
- HK$100 is the maximum tier and should be rare.

The first version prioritizes Place, Quinella Place, and small Win stakes. It
does not recommend Tierce, First 4, or Quartet because the current model has not
shown enough ordering accuracy. Final real-money use still requires checking
official live odds, scratchings, going, and jockey changes before the race.

## Adaptive Race Route

The "动态投注路线" panel answers the practical question: after Race 1 wins or
loses, what should happen to Race 2, Race 3, and later races?

- First executed race hit: protect the day. Weak races become PASS; medium or
  stronger races are reduced to a low-stake Place-only line.
- First executed race miss: do not chase. Only strong or very-strong signals
  can continue, and they are capped at low-stake Place-only exposure.
- Two executed misses in a row: stop the rest of the meeting.
- Upcoming/open races do not affect the route until official results are
  refreshed.

This panel is a bankroll-discipline layer on top of the model. It does not
claim that Race 1 is inherently easier than later races; it simply prevents a
good start from turning into over-betting, and prevents an early loss from
turning into chasing.

## Multi-Play Portfolio Optimizer

The "多玩法组合优化" panel upgrades the app from one-horse recommendation to a
structured bet portfolio. For each selected race it builds a probability board
for:

- Cash-eligible pools: Win, Place, Quinella Place, Quinella.
- Paper / high-volatility pools: Forecast, Trio, Tierce, First 4, Quartet.

The optimizer estimates each pool's hit probability with a
Harville/Plackett-Luce ranking model: single-runner probabilities are normalized
into a full finishing-order distribution, then reused consistently for Place,
Quinella Place, Quinella, Forecast, Trio, First 4, and Quartet probabilities.
That keeps all pool estimates on one probability scale instead of relying on
separate hand-tuned multipliers.

It then converts each candidate into a minimum acceptable dividend per HK$10
unit and allocates a conservative HK$10-100 portfolio. Cash lines are EV-first:
when actual market dividends are available, the line must clear the target
expected ROI buffer before it can enter the portfolio, and selected lines are
ranked by expected ROI rather than by pool type. When dividends are not
available yet, the line is marked conditional and must be checked against the
displayed entry price before any real bet.

The performance panel also reports probability-scoring metrics. Brier Score and
Log Loss are included because a betting model needs calibrated probabilities,
not just a high top-pick hit rate; lower values indicate better probability
forecasts.

This is intentionally conservative: exact-order and four-horse exotic pools
stay in paper mode until the model has a separate ordering edge and enough
settled dividend data for real ROI analysis.

## Betting Products Guide

The "其他玩法 / 玩法库" panel explains the common HKJC slips shown in the
paper tickets:

- Basic single-race pools: Win, Place, Quinella, Quinella Place.
- Exact-order and exotic pools: Forecast, Trio, Tierce, First 4, Quartet.
- Multi-race pools: Double, Treble, Six Up, All Up, Double Trio, Triple Trio.
- Full-day fixed-odds pools: Jockey Challenge and Trainer Challenge.

Each guide shows how the bet wins, how the paper ticket is filled, the current
model stance, a conservative recommendation for the selected race, and a
post-race review state once official results are refreshed. High-volatility
ordering pools remain paper-test or pass by default until the model has a
separate ordering/backtest edge.

On non-race days, or after the current race day's results have fully settled,
the final-plan panel shows a no-local-race / race-day-closed state instead of
reusing the last settled race's `NO BET` decision. The refresh button still
checks the latest published data, but it will not generate a bet without a
current HKJC local race card.

The top of the app has a prominent meeting forecast band. It shows the next HKJC
local meeting, race-card status, next timed race, hours/minutes remaining, and
the T-30 review marker. If HKJC has not published race-card start times yet, the
panel deliberately says the time is pending instead of guessing a precise hour.

## Final Betting Plan

The final plan is conditional. It does not force a bet every race.

- Review at T-15 minutes before race start.
- Execute only in the T-10 to T-5 minute window.
- Bet type defaults to WIN.
- A candidate must clear the model probability threshold and the final odds
  floor. The default final odds floor adds an 8% edge buffer over fair odds.
- If live odds fall below the floor, official scratchings change the setup, or
  data is stale, the plan becomes PASS.
