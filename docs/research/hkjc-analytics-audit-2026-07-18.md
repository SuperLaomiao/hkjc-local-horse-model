# `hkjc-analytics` clean-room audit — 2026-07-18

Source: [snookerlivehk-elton/hkjc-analytics](https://github.com/snookerlivehk-elton/hkjc-analytics), audited at commit `2dba8758f2d53bf5586c87390f47e6a16ee9ea26`.

## Decision

Do not treat this repository as a data donor, trained-model donor, or empirical benchmark.

- It ships no historical database, immutable raw snapshots, fitted model artifact, or numeric benchmark output.
- Production ranking is mainly a hand-weighted heuristic score. The fitted helpers are evaluated in-sample or depend on a private database.
- No repository license was found. Code, weights, and thresholds must not be copied; only independently reimplemented ideas may be tested.
- Cash mode remains `NO_BET`. Nothing in this repository supplies evidence for a model or strategy promotion.

It is registered only as a collector/methodology reference. Its own odds and SpeedPRO labels are marked `unsafe` in our external-source registry.

## Important risks found

1. **Odds milestone leakage.** A late poll can be written under several pre-race labels, and the collection range can extend beyond post time. See [`cron_odds_milestones.py`](https://github.com/snookerlivehk-elton/hkjc-analytics/blob/2dba8758f2d53bf5586c87390f47e6a16ee9ea26/scripts/cron_odds_milestones.py#L306-L371).
2. **Ambiguous SpeedPRO identity.** `/current/` responses are assigned to the requested target without a reliable meeting-date, venue, and runner-set proof. See [`cron_speedpro_fetch.py`](https://github.com/snookerlivehk-elton/hkjc-analytics/blob/2dba8758f2d53bf5586c87390f47e6a16ee9ea26/scripts/cron_speedpro_fetch.py#L392-L437).
3. **Mutable source and prediction snapshots.** Latest rows overwrite earlier source/prediction state, so historical as-of reconstruction is not reliable. See [`raw_snapshots.py`](https://github.com/snookerlivehk-elton/hkjc-analytics/blob/2dba8758f2d53bf5586c87390f47e6a16ee9ea26/scoring_engine/raw_snapshots.py#L1-L48) and [`prediction_snapshots.py`](https://github.com/snookerlivehk-elton/hkjc-analytics/blob/2dba8758f2d53bf5586c87390f47e6a16ee9ea26/scoring_engine/prediction_snapshots.py#L161-L224).
4. **In-sample evaluation.** Logistic weight suggestions and temperature calibration are not supported by a race-grouped chronological holdout. Track profiles can also include future races when rescoring history. See [`weight_tuning.py`](https://github.com/snookerlivehk-elton/hkjc-analytics/blob/2dba8758f2d53bf5586c87390f47e6a16ee9ea26/scoring_engine/weight_tuning.py#L320-L362) and [`calibration.py`](https://github.com/snookerlivehk-elton/hkjc-analytics/blob/2dba8758f2d53bf5586c87390f47e6a16ee9ea26/scoring_engine/calibration.py#L36-L91).
5. **Score-scale inconsistency.** Some factors are stored on 0–100 but divided by ten only in one ranking path, so identical-looking weights can have different meanings across paths.

## Ideas worth clean-room reimplementation

- Append-only source observations with request URL/parameters, HTTP status/time, `observed_at_utc`, source update time, parser/schema version, payload hash, expected race identity, and validation result.
- Derive T-30/T-10/T-3 from immutable observations using the nearest observation at or before the target; never relabel a post-time or very late observation.
- Store immutable prediction revisions with feature cutoff, input hashes, model/config version, and run ID.
- Use sample-size shrinkage, recency decay, explicit missingness, deterministic tie-breaking, and factor-contribution diagnostics.
- Treat pace as a model feature family, but learn/calibrate it with race-grouped walk-forward splits and report ordinal MAE/confusion/calibration rather than reuse its fixed thresholds.

## Immediate local change

The audit exposed a boundary bug in our own planner: an observation taken a few seconds after post could round to zero minutes and be labeled `T-3`. `live-snapshot-planner.js` now checks exact milliseconds-to-post before window classification. The direct GraphQL normalizer also rejects every `observed_at >= post_at` value before storage, and coverage treats legacy negative-zero minutes as unknown. Regression tests lock all three paths.

Our SpeedPRO importer already fails closed on meeting date, venue, source timestamp, race cutoff, and runner code. Historical SpeedPRO remains blocked until a source supplies trustworthy pre-race capture times; the five current Tianxi meetings remain research features only.

## Research Lab placement

- External source: collector/methodology reference; unknown license; no code reuse; no raw publication.
- External benchmark: deliberately not added because there is no reproducible public metric.
- Follow-up actions: referenced by `live-snapshot-planner` and `speedpro-feature-importer` as a negative-control audit, not as performance evidence.
