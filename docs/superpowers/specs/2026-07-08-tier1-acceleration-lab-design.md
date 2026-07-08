# Tier1 Acceleration Lab Design

## Goal

Turn Research Lab from a passive list of interesting repositories into a measurable acceleration system that helps this project leverage the best public HKJC projects quickly without copying unverified betting claims into cash recommendations.

## Current gap

Our current local baseline is useful as a product/data foundation, but not tier1 as a model:

- current heuristic top-pick win rate is about 20.5%;
- current logistic runner holdout top-pick win rate is about 21.1%;
- strategy ROI remains materially negative after HKJC takeout;
- live market coverage is partial and pool snapshot coverage is still missing.

The strongest public projects give us three practical shortcuts:

- `catowabisabi/horse-racing-model-training`: LightGBM no-odds quinella top-2 experiment, processed parquet, reports, trained artifacts, and MIT-licensed code.
- `jerrydaphantom/hkjc-ml-research`: CatBoost/LightGBM market-aware + calibration protocol and public benchmark result tables.
- `anton-schwarberg/Hongkong-Horse-Racing-Prediction`: no-odds feature engineering, top-3/placed metrics, rating/feature-persistence guidance.

## Architecture

Add an `externalBenchmarkRegistry` section to `research-program.js`. It is a compact, dashboard-safe registry of external benchmark candidates, their public metrics, the local gap they address, required local data, licensing/access notes, and promotion gates. The registry is not a model runner yet; it is the control panel that tells daily automation which external idea to reproduce next and what evidence is required before adoption.

Add summary helpers that compute:

- tier1 target count and current readiness status;
- best public top-pick benchmark versus our current known baseline;
- reproduction-ready candidates versus blocked candidates;
- next candidate to reproduce locally.

Render this registry in the existing Research Lab UI so the user can see whether we are still behind, which outside project we are leveraging next, and what has to pass before the recommendation engine can learn from it.

## Data and licensing rules

- MIT-licensed code may be studied and adapted with attribution.
- Raw external datasets are not republished unless the source license explicitly allows it.
- Repos without machine-readable GitHub license metadata are treated as research leads until local license files or explicit terms are verified.
- External headline ROI is never treated as local proof; it must survive our SQLite replay, chronological split, drawdown audit, and sample-size gate.

## First implementation slice

The first slice will:

1. Add registry data for catowabisabi, jerrydaphantom, anton, eprochasson, Bobosky/rkwyu live-market capture, and Tianxi.
2. Add summary fields to `summarizeResearchUpgradeProgram()`.
3. Add tests proving the registry exposes tier1 gaps, reproduction order, promotion gates, and dashboard snapshot attachment.
4. Render the registry in the Research Lab panel.
5. Mirror the new action sequence in `docs/active-continuation-roadmap.md`.
6. Regenerate `data/dashboard.json`.

## Non-goals for this slice

- Do not train CatBoost or LightGBM yet.
- Do not import external raw data into the public repo.
- Do not promote any external strategy to cash-mode recommendations.
- Do not login to HKJC, place bets, or touch funds.

## Success criteria

- Research Lab shows our model is currently behind stronger public benchmarks.
- Research Lab shows exactly which external method/data source is next and why.
- The daily automation roadmap contains executable tasks for reproducing the top external methods.
- Tests pass and dashboard data contains the new registry.

