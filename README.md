# HK Local Horse Model

A static GitHub Pages dashboard for a Hong Kong local horse-racing paper
simulation model.

## What It Shows

- HKJC local-race model predictions
- Final betting plan: entry window, odds floor, stake cap, and pass rules
- Large refresh button for pulling the latest published plan before a race
- Mobile-first PWA shell with installable app metadata
- Value-bet filter and paper-bankroll guardrail
- Official-result settlement ledger
- Rolling paper profit / ROI
- Model top-pick win rate
- Next Hong Kong local meeting when HKJC race cards are not yet published

## Important

This is a paper simulation and research dashboard. It is not an investment
product, not financial advice, and not a guaranteed betting system.

## Data

The published dashboard uses a static `data/dashboard.json` export generated
from the local model workspace. The current export was refreshed from the HKJC
official fixture/results/race-card flow.

GitHub Actions is configured in `.github/workflows/refresh-hkjc-data.yml` to
refresh baseline data around 09:00 and 22:00 Hong Kong time. It also refreshes
about every 10 minutes during common Hong Kong race windows: Wednesday night and
weekend/day meetings. It can also be run manually from the Actions tab.

To refresh the source workspace:

```bash
npm run hkjc:refresh -- --bankroll 200 --minEdge 0 --minProbability 0.15 --maxStakePct 0.05 --finalEdgeBuffer 0.08
```

Then copy the refreshed dashboard JSON into this publishing project:

```bash
cp "hkjc-horse-model/data/processed/dashboard.json" "../hkjc-local-horse-model/data/dashboard.json"
```

The source dashboard currently has 84 settled HK local races and points to the
next HK local meeting as 2026-06-21 Sha Tin. Race-card forecasts appear only
after HKJC publishes local starters.

The page-level refresh button reloads the latest published `data/dashboard.json`
without browser cache. GitHub Pages cannot safely store a secret token in the
browser, so this button does not directly trigger the GitHub Actions backend.
During race windows, the backend workflow refreshes about every 10 minutes; a
future Worker/API can make the button trigger an immediate server-side HKJC
refresh.

On non-race days, the final-plan panel shows a no-local-race state instead of
reusing the last settled race's `NO BET` decision. The refresh button still
checks the latest published data, but it will not generate a bet without a
current HKJC local race card.

## Final Betting Plan

The final plan is conditional. It does not force a bet every race.

- Review at T-15 minutes before race start.
- Execute only in the T-10 to T-5 minute window.
- Bet type defaults to WIN.
- A candidate must clear the model probability threshold and the final odds
  floor. The default final odds floor adds an 8% edge buffer over fair odds.
- If live odds fall below the floor, official scratchings change the setup, or
  data is stale, the plan becomes PASS.
