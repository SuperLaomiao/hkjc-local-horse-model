# Prospective Production Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing market-aware model, T-window collector, EV engine, and audit code into an immutable prospective research loop that can earn promotion only from fresh forward evidence.

**Architecture:** Keep raw data, SQLite, fitted artifacts, recommendation locks, and settlement ledgers local. A Python scoring bridge emits versioned probabilities; Node validates lineage, creates zero-stake shadow decisions, captures due market windows, and writes append-only locks. Official post-race data settles those locks, while a separate evaluator compares models on identical races and produces aggregate promotion gates for the public Research Lab.

**Tech Stack:** Node.js ESM, built-in `node:sqlite`, Python CatBoost/LightGBM, Node test runner, macOS LaunchAgent for optional local scheduling, GitHub Pages sanitized aggregate publication.

---

## File map

- `hkjc-horse-model/python/score_market_aware_candidate.py`: load a frozen fitted artifact and emit upcoming-runner probabilities plus lineage.
- `hkjc-horse-model/src/probability-artifact.js`: validate score bundles and fail closed on artifact/report/feature-policy mismatch.
- `hkjc-horse-model/src/prospective-locks.js`: normalize, hash, persist, load, and settle immutable shadow locks.
- `hkjc-horse-model/src/race-day-cycle.js`: run one due-window capture, shadow scoring, and lock cycle without an internal network polling loop.
- `hkjc-horse-model/src/local-scheduler.js`: render/validate an optional LaunchAgent definition without installing it during tests.
- `hkjc-horse-model/src/prospective-evaluation.js`: compare candidates on the same fresh lock cohort and calculate risk/uncertainty diagnostics.
- `hkjc-horse-model/src/prospective-promotion.js`: enforce declared, pool-specific research gates and fail closed.
- `hkjc-horse-model/src/sqlite-store.js`: add append-only prospective lock storage and aggregate queries.
- `hkjc-horse-model/src/cli.js`, `package.json`: expose scoring, cycle, settlement, coverage, evaluation, and scheduler commands.
- `hkjc-horse-model/test/*.test.js`, `hkjc-horse-model/python/test_*.py`: focused contract and leakage tests.
- `research-program.js`, `test/research-program.test.js`: publish aggregate gate progress only.

## Task 1: Market-aware shadow scoring bridge

**Files:**
- Create: `hkjc-horse-model/python/score_market_aware_candidate.py`
- Create: `hkjc-horse-model/python/test_score_market_aware_candidate.py`
- Create: `hkjc-horse-model/src/probability-artifact.js`
- Create: `hkjc-horse-model/test/probability-artifact.test.js`
- Modify: `hkjc-horse-model/src/cli.js`
- Modify: `package.json`

- [x] **Step 1: Write failing Python tests for frozen-lineage scoring**

Use a synthetic two-runner fixture. Assert that output contains exactly:

```python
{
    "raceId": "2026-07-22-HV-R1",
    "runnerId": "H001",
    "probability": 0.42,
    "modelId": "catboost-market-aware-t10-v1",
    "artifactId": "sha256:<digest>",
    "featurePolicyId": "market-aware-t10-v1",
    "calibrationMethod": "none",
    "trainingCutoff": "2018-06-27",
}
```

The test must reject a feature manifest that differs from the fitted report and any input observed at or after post time.

- [x] **Step 2: Run the failing Python test**

Run: `python3 -m unittest hkjc-horse-model/python/test_score_market_aware_candidate.py -v`

Expected: FAIL because the scoring module does not exist.

- [x] **Step 3: Implement the minimal Python scorer**

Expose pure functions with these signatures:

```python
def load_frozen_bundle(*, model_path, report_path, feature_manifest_path): ...
def score_rows(*, bundle, rows): ...
def build_score_bundle(*, bundle, rows, generated_at): ...
```

Hash the artifact bytes, compare model/report target and feature policy, preserve raw probabilities, and never create stake or execution status.

- [x] **Step 4: Write failing Node tests for score-bundle validation**

Assert `validateProbabilityArtifact(bundle, { raceId, postAt })` rejects missing lineage, duplicate runner ids, probabilities outside `[0, 1]`, post-time generation, and a manually supplied `CALIBRATED` execution flag. Assert valid output is normalized to:

```js
{
  researchMode: 'SHADOW',
  executionStatus: 'PAPER_ONLY',
  probabilityStatus: 'RESEARCH_ONLY',
  artifactId: 'sha256:...',
  modelId: 'catboost-market-aware-t10-v1',
  predictions: [],
}
```

- [x] **Step 5: Implement the validator and CLI command**

Add `shadow-score --input <jsonl> --model <artifact> --report <json> --featureManifest <json> --output <json>`. Do not add an option that can switch the output to cash mode.

- [x] **Step 6: Run focused and full tests, then commit**

Run:

```bash
python3 -m unittest hkjc-horse-model/python/test_score_market_aware_candidate.py -v
node --test hkjc-horse-model/test/probability-artifact.test.js
npm test
```

Expected: all pass.

Commit: `feat: add market-aware shadow scoring bridge`

## Task 2: Append-only prospective locks and settlement

**Files:**
- Create: `hkjc-horse-model/src/prospective-locks.js`
- Create: `hkjc-horse-model/test/prospective-locks.test.js`
- Modify: `hkjc-horse-model/src/sqlite-store.js`
- Modify: `hkjc-horse-model/test/sqlite-store.test.js`
- Modify: `hkjc-horse-model/src/recommendation-audit.js`
- Modify: `hkjc-horse-model/test/recommendation-audit.test.js`
- Modify: `hkjc-horse-model/src/cli.js`

- [x] **Step 1: Write failing schema/idempotency tests**

Define the lock identity as SHA-256 over canonical values:

```js
{
  raceId, marketWindow, poolKey, combination,
  modelId, artifactId, featurePolicyId, generatedAt,
}
```

Assert that replaying the exact payload returns the existing lock, while changing content under an existing `lockId` throws `PROSPECTIVE_LOCK_CONFLICT` rather than updating the row.

- [x] **Step 2: Add the append-only table and store functions**

Add a `prospective_locks` table with `lock_id` primary key, identity fields, decision JSON, `created_at`, settlement JSON, and settlement timestamp. Implement:

```js
recordProspectiveLock({ dbPath, lock })
loadProspectiveLocks({ dbPath, raceId = null, status = null })
settleProspectiveLock({ dbPath, lockId, settlement })
```

Only the empty settlement fields may transition once from `OPEN` to `SETTLED` or `VOID`; decision fields are immutable.

- [x] **Step 3: Write failing normalization and settlement tests**

Require each line to carry pool/combination, raw and conservative probability, fair/required/current dividend, market timestamp/window/sell status, model lineage, machine reason codes, and `executionStatus: 'PAPER_ONLY'`. Reject post-time locks and nonzero cash stake. Test WIN, PLACE, QIN, QPL, refund/void, hit, and miss settlements.

- [x] **Step 4: Implement lock creation and official settlement**

Expose:

```js
buildProspectiveLocks({ race, scoreBundles, marketSnapshots, decisions, generatedAt })
settleProspectiveLocks({ locks, race })
summarizeProspectiveLocks(locks)
```

Reuse dividend matching from `recommendation-audit.js` through an exported pure helper instead of duplicating pool semantics.

- [x] **Step 5: Add CLI commands and audit separation**

Add `prospective-lock` and `prospective-settle`. The recommendation audit must report `paper`, `cash`, and `shadow` independently; shadow locks never enter cash totals.

- [x] **Step 6: Run focused and full tests, then commit**

Run:

```bash
node --test hkjc-horse-model/test/prospective-locks.test.js hkjc-horse-model/test/sqlite-store.test.js hkjc-horse-model/test/recommendation-audit.test.js
npm test
```

Commit: `feat: add immutable prospective recommendation locks`

## Task 3: One-cycle race-day collection and optional local scheduler

**Files:**
- Create: `hkjc-horse-model/src/race-day-cycle.js`
- Create: `hkjc-horse-model/test/race-day-cycle.test.js`
- Create: `hkjc-horse-model/src/local-scheduler.js`
- Create: `hkjc-horse-model/test/local-scheduler.test.js`
- Create: `docs/operations/local-race-day-scheduler.md`
- Modify: `hkjc-horse-model/src/cli.js`
- Modify: `package.json`

- [x] **Step 1: Write failing orchestration tests**

Inject planner, collector, scorer, and lock-writer functions. Assert one cycle:

```js
runRaceDayCycle({
  now, dbPath, windows: ['T-30', 'T-10', 'T-3'],
  pools: ['WIN', 'PLA', 'QIN', 'QPL'], dependencies,
})
```

calls the network collector only for due uncaptured windows, creates zero-stake shadow locks, skips post-time races, bounds retries, and returns Chinese counts and the next due window.

- [x] **Step 2: Implement one idempotent cycle**

Compose the existing `runDueLiveMarketSnapshots`, Task 1 score validator, and Task 2 lock writer. Do not add an internal endless loop.

- [x] **Step 3: Write failing LaunchAgent render tests**

Assert `renderLaunchAgent()` creates a plist that invokes `npm run hkjc:race-day-cycle` at a configurable local interval, writes logs under the local private-data directory, contains no secret, and defaults to disabled installation. Assert invalid paths and intervals below the documented safety floor are rejected.

- [x] **Step 4: Implement render/install guidance**

Add `local-scheduler --dryRun --output <plist>`. An explicit `--install` may copy the reviewed plist into `~/Library/LaunchAgents`; tests and daily Codex巡检 must use `--dryRun`. Document load, unload, logs, backup, and sleep/offline limitations.

- [x] **Step 5: Run focused and full tests, then commit**

Run:

```bash
node --test hkjc-horse-model/test/race-day-cycle.test.js hkjc-horse-model/test/local-scheduler.test.js hkjc-horse-model/test/live-market-due-snapshots.test.js
npm test
```

Commit: `feat: add safe local race-day collection cycle`

## Task 4: Prospective coverage and backup-health gate

**Files:**
- Create: `hkjc-horse-model/src/prospective-coverage.js`
- Create: `hkjc-horse-model/test/prospective-coverage.test.js`
- Modify: `hkjc-horse-model/src/sqlite-store.js`
- Modify: `hkjc-horse-model/src/cli.js`
- Modify: `hkjc-horse-model/src/dashboard-publish.js`
- Modify: `hkjc-horse-model/test/dashboard-publish.test.js`

- [x] **Step 1: Write failing coverage tests**

Assert the report groups by meeting, pool, and T-window; distinguishes missing racecard, offline, collector error, duplicate, not selling, and missed window; and calculates lock/settlement coverage without treating an absent line as a losing bet.

- [x] **Step 2: Implement coverage and backup manifest checks**

Expose:

```js
buildProspectiveCoverage({ races, snapshots, locks, backupManifest, freeze })
evaluateProspectiveDataGate({ coverage, minimums })
```

The gate must declare minimums before consuming any ROI field and return `READY` or `BLOCKED_DATA` with exact deficits.

- [x] **Step 3: Add CLI and privacy-safe publication**

Add `prospective-coverage --db ... --freezeDate ... --output ...`. Publish only aggregate counts, ratios, dates, and reason counts; never publish row-level locks, local paths, model artifacts, or SQLite labels.

- [x] **Step 4: Run focused, privacy, and full tests, then commit**

Run:

```bash
node --test hkjc-horse-model/test/prospective-coverage.test.js hkjc-horse-model/test/dashboard-publish.test.js test/privacy-workflow.test.js
npm test
npm run hkjc:build-public-site && npm run hkjc:privacy-scan
```

Commit: `feat: report prospective market coverage gates`

## Task 5: Fresh identical-cohort comparison and promotion state machine

**Files:**
- Create: `hkjc-horse-model/src/prospective-evaluation.js`
- Create: `hkjc-horse-model/test/prospective-evaluation.test.js`
- Create: `hkjc-horse-model/src/prospective-promotion.js`
- Create: `hkjc-horse-model/test/prospective-promotion.test.js`
- Modify: `hkjc-horse-model/src/model-leaderboard.js`
- Modify: `hkjc-horse-model/test/model-leaderboard.test.js`
- Modify: `research-program.js`
- Modify: `test/research-program.test.js`

- [x] **Step 1: Write failing identical-cohort metric tests**

Feed synthetic locks where one model is missing a race. Assert all candidates are evaluated only on the declared common cohort and report exclusions. Calculate log loss, Brier, calibration buckets/error, Top-pick WIN/PLACE, CLV, ROI, max drawdown, longest losing run, meeting/month stability, and return concentration.

- [x] **Step 2: Implement deterministic evaluation**

Expose:

```js
buildIdenticalProspectiveCohort({ locks, modelIds, pools, freeze })
evaluateProspectiveCandidates({ cohort, bootstrapSeed })
```

Use meeting-block bootstrap intervals, a fixed seed, and placebo labels/price permutations. Report uncertainty; never replace missing data with zero return.

- [x] **Step 3: Write failing pool-promotion tests**

Test that `NO_BET` persists when any of sample size, positive lower ROI bound, CLV, calibration, drawdown, stability, concentration, placebo, fresh-cohort, or lineage gates fail. A passing research candidate may transition only to `REVIEW_REQUIRED`, never directly to cash `PLAY`.

- [x] **Step 4: Implement the state machine and Research Lab aggregate**

Allowed transitions:

```text
BLOCKED_DATA -> NO_GO | RESEARCH_CHAMPION
RESEARCH_CHAMPION -> REVIEW_REQUIRED
REVIEW_REQUIRED -> APPROVED_CANDIDATE  (manual review outside automation)
```

There is no automated transition to executable cash mode. Record gate version, frozen thresholds, cohort dates, and model/artifact ids.

- [x] **Step 5: Run focused and full tests, then commit**

Run:

```bash
node --test hkjc-horse-model/test/prospective-evaluation.test.js hkjc-horse-model/test/prospective-promotion.test.js hkjc-horse-model/test/model-leaderboard.test.js test/research-program.test.js
npm test
```

Commit: `feat: gate models on fresh prospective evidence`

## Task 6: Post-gate feature and staking experiments

**Files:**
- Modify: `hkjc-horse-model/src/speedpro-feature-importer.js`
- Modify: `hkjc-horse-model/test/speedpro-feature-importer.test.js`
- Create: `hkjc-horse-model/python/compare_feature_ablations.py`
- Create: `hkjc-horse-model/python/test_compare_feature_ablations.py`
- Modify: `hkjc-horse-model/python/evaluate_exotic_pair_strategy.py`
- Modify: `hkjc-horse-model/src/strategy-risk-report.js`
- Modify: `hkjc-horse-model/test/strategy-risk-report.test.js`

- [x] **Step 1: Add timestamped SpeedPRO identity/availability tests**

Reject feature rows without observed-at, source id, horse identity match, and an observation time before post. Report coverage separately for train, validation, and fresh prospective cohorts.

- [x] **Step 2: Implement same-cohort ablation reports**

Compare base, SpeedPRO, pool-money, odds-movement, and combined policies on exactly the same rows. Selection occurs on validation; the prospective cohort is read once after the feature policy is frozen.

- [x] **Step 3: Re-run QIN/QPL only behind combination-book coverage**

If verified T-window combination odds are below the declared coverage minimum, return `BLOCKED_DATA`. Exact-order pools remain `PAPER_ONLY` regardless of retrospective ROI.

- [x] **Step 4: Add staking sweeps behind positive prospective gates**

Compare fixed HK$10, capped fractional Kelly, and current conservative exposure caps. If the pool promotion state is not manually approved, every executable stake remains zero even when the research curve is positive.

- [x] **Step 5: Run Python, focused Node, and full tests, then commit**

Run:

```bash
python3 -m unittest hkjc-horse-model/python/test_compare_feature_ablations.py -v
node --test hkjc-horse-model/test/speedpro-feature-importer.test.js hkjc-horse-model/test/strategy-risk-report.test.js
npm test
```

Commit: `research: compare feature lift and guarded staking`

## Daily execution contract

- Read `docs/active-continuation-roadmap.md`, then this plan.
- Work from Task 1 forward, one failing-test-to-green slice at a time.
- When a gate is waiting for future races, record its exact deficit and continue with the next ready engineering step; do not stop at a status report.
- Keep local/private artifacts untracked. Never place bets, log in, change cash authorization, publish row-level locks, or copy third-party data without a compatible license.
- End each run with focused tests, `npm test`, a local commit, the roadmap checkbox/note update, and one exact next step.
