# Tianxi As-Of Feature Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and red-green-refactor for each task.

**Goal:** Convert Tianxi per-horse form history into optional, leakage-safe features for the local training matrix without importing or publishing third-party raw rows.

**Architecture:** Parse only the form files needed by locally known HKJC horse codes. For each target runner, filter source rows through a conservative availability date before aggregation. Return a compact in-memory map keyed by target race and runner; the existing training builder consumes it through an optional callback.

**Tech Stack:** Node.js ES modules, built-in `node:test`, streaming/local CSV reads, current JSON training export.

---

## Task 1: Specify horse identity and as-of aggregation

- [ ] Add failing tests for HKJC ids such as `HK_2023_K390`, direct `K390`, and missing ids.
- [ ] Add failing tests proving same-race and future rows are excluded.
- [ ] Add failing tests for the one-day conservative availability lag.
- [ ] Implement normalization, date parsing, filtering, and compact form aggregates.

Initial features:

- source availability flag;
- prior starts, wins, places, and rates;
- days since last source run;
- latest rating and short rating trend;
- recent average beaten margin and win odds;
- same-distance starts and win rate.

## Task 2: Load only needed local files

- [ ] Add a fixture directory test with two known horses and one missing horse.
- [ ] Confirm only matched `horses/form_records/form_<CODE>.csv` files are read.
- [ ] Return coverage, parsed-row, eligible-row, missing-horse, and invalid-date counts.
- [ ] Retain only source id, checkout ref, and aggregate counts in exported metadata.

## Task 3: Join optional features into training rows

- [ ] Add a failing training-dataset test for `externalFeaturesForRunner`.
- [ ] Merge external features after core/market features while keeping all rows valid when missing.
- [ ] Add availability and missingness flags to every row when Tianxi enrichment is enabled.

## Task 4: Expose local CLI enrichment

- [ ] Add a failing CLI test for `training-dataset --tianxiRoot`.
- [ ] Load the local adapter only when explicitly configured.
- [ ] Keep the default SQLite-only export unchanged.
- [ ] Write compact source coverage metadata beside the training summary.

## Task 5: Real-data smoke test and verification

- [ ] Run the adapter against the external Tianxi cache and local SQLite races.
- [ ] Verify non-zero matched coverage and zero same/future-row eligibility.
- [ ] Do not commit the generated full training matrix.
- [ ] Run focused tests and full `npm test`.
- [ ] Update the roadmap with coverage and the next pool/model task.
