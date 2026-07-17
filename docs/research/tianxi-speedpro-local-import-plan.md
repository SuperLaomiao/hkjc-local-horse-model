# Tianxi and SpeedPRO Local-Only Import Plan

## Decision

Use Tianxi and `mag-dot/race-data` as local research inputs, but do not commit or republish their raw files because neither repository currently exposes an explicit reusable data license. Import only normalized, provenance-tagged features that can be shown to have existed before the target prediction cutoff.

This is an acceleration source, not a new authority. Official settled HKJC results and dividends remain authoritative.

## Audited snapshot

Audit time: 2026-07-17 06:40 UTC.

| Source | Checkout | Files | Date signal | Local policy |
| --- | --- | ---: | --- | --- |
| `sleepingarhat/tianxi-database` | `a64456e671f1b019cbef6d7c0a31d332f31748ce` | 13,867 | 2016-01-01 to 2026-07-17 | Raw local-only |
| `mag-dot/race-data` | `1cae0922f0e84a241d06a6dd7cb77dc0f1e464fa` | 222 | 2025-09-07 to 2026-04-22 | Raw local-only |

The structural scan found 14,089 files: 9,018 pre-race candidates, 4,684 post-race-only files, and 387 unsafe/unclassified files. A candidate count is not an import count; every row still needs an as-of check.

## Candidate feature contracts

| Category | Candidate derived features | Conservative availability rule | Same-race use |
| --- | --- | --- | --- |
| Prior horse form | Starts, wins/places, rating trend, distance/surface form, layoff, prior odds, prior sectionals | Source race date plus one Hong Kong calendar day | No; current target-race row is excluded |
| Trackwork | Days since last work, work count in 7/14/30 days, timed-work aggregates, work-type mix | Observation date plus 24 hours unless an earlier `observed_at` capture exists | Only observations strictly before cutoff |
| Barrier trials | Days since trial, latest trial rank/time, trial count, trial-distance similarity | Trial date plus one Hong Kong calendar day | Only prior trials |
| Veterinary/injury | Active issue flag, days since notice, days since cleared, issue count | Notice/clearance date plus 24 hours; ambiguous dates are excluded | Only records known before cutoff |
| SpeedPRO form | Energy gap, fitness rating, prior-run energy trend, prior sectional pace, distance suitability | Require source `scraped_at` or `lastupdatetime` strictly before cutoff | Yes only when the snapshot predates post time |
| Race entries | Declared runner/draw/weight/gear state | Require an observed capture time; retain later amendments separately | Yes when captured before cutoff |
| Weather | Temperature, rain, humidity, wind, recent rainfall | Official observation timestamp no later than cutoff | Yes |

All normalized features must carry `source_id`, `source_checkout`, `observed_at` or conservative `available_at`, `target_race_id`, `runner_id`, `missing_reason`, and `leakage_classification`.

## Post-race and blocked fields

The following can be labels or inputs for later races, but never predictors for the same race:

- current-race placing, finish time, beaten margin, running positions, and final win odds;
- current-race dividends and winning combinations;
- current-race commentary and sectional times;
- reports, scored outputs, and human/model analyses produced after the race.

Current cumulative horse profiles and current jockey/trainer rankings are blocked for historical replay unless a dated snapshot can be reconstructed. Using today's aggregate profile for a 2018 race would leak years of later information.

## Identity and conflict policy

- Join runners by HKJC horse code plus race date/venue/race number; never by horse name alone.
- Quarantine source rows with conflicting race identity or impossible dates.
- Do not overwrite official settled results, dividends, or scratches.
- Record unmatched and duplicate rows in a compact conflict report.
- Keep raw paths outside public metadata; publish only source id, checkout, counts, checksum, and derived experiment metrics.

## Import order

1. Build a streaming parser for Tianxi per-horse form CSV files.
2. Produce as-of aggregates for a small fixture and prove that current/future rows are excluded.
3. Add trials, trackwork, and veterinary aggregates behind separate availability flags.
4. Add SpeedPRO JSON features only for snapshots with trustworthy pre-race timestamps.
5. Join optional features into the existing training matrix and compare coverage and probability metrics with the baseline.
6. Keep every candidate in research mode until chronological validation and untouched holdout gates pass.

## Promotion rule

More rows or a higher top-3 hit rate is not enough. The enriched model must improve holdout log loss/Brier score, survive leakage checks, and show a better ROI/drawdown trade-off using only prices available at recommendation time. Otherwise the feature group remains research-only or is removed.
