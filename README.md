# HK Local Horse Model

A static GitHub Pages dashboard for a Hong Kong local horse-racing paper
simulation model.

## What It Shows

- HKJC local-race model predictions
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
refresh the data twice daily, around 09:00 and 22:00 Hong Kong time. It can also
be run manually from the Actions tab.

To refresh the source workspace:

```bash
npm run hkjc:refresh -- --bankroll 200 --minEdge 0 --minProbability 0.15 --maxStakePct 0.05
```

Then copy the refreshed dashboard JSON into this publishing project:

```bash
cp "hkjc-horse-model/data/processed/dashboard.json" "../hkjc-local-horse-model/data/dashboard.json"
```

The source dashboard currently has 84 settled HK local races and points to the
next HK local meeting as 2026-06-21 Sha Tin. Race-card forecasts appear only
after HKJC publishes local starters.
