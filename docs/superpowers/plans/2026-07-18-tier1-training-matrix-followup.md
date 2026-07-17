# Tier 1 Training Matrix Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining training-matrix leakage and prepared-writer validation gaps while explicitly deferring the monolithic CLI JSON memory optimization.

**Architecture:** Keep the existing prepared-row streaming API and make its validation authoritative at the iterator/writer boundary. Reuse the existing row validator for manually constructed prepared matrices, validating both source rows and the declared flattened columns. Tighten normalized leakage aliases while preserving explicit prior/before/historical/as-of/T-window feature names.

**Tech Stack:** Node.js ES modules, built-in `node:test`, npm scripts, atomic file streaming.

---

### Task 1: Add regression tests for leakage aliases and historical exceptions

**Files:**
- Modify: `hkjc-horse-model/test/training-matrix.test.js`

- [ ] **Step 1: Write the failing test** covering `winnerFlag`, `isWinner`, `won`, `raceOutcome`, `entryNo`, `entryNumber` and snake_case aliases as rejected feature keys, while asserting `horseWinsBefore`, `priorRaceResult`, `historicalResult`, `raceResultAsOf`, and `marketWinOddsT30` remain accepted.
- [ ] **Step 2: Run the focused test** with `node --test hkjc-horse-model/test/training-matrix.test.js` and confirm the new alias assertions fail because the current normalized leakage/metadata sets do not cover them and pre-race timing is checked too late.
- [ ] **Step 3: Implement the smallest validator change** in `hkjc-horse-model/src/training-dataset.js`: add the normalized winner/outcome aliases and entry-number aliases, reject post-race names before allowing timing exceptions, then allow explicit prior/before/historical/as-of/T-window names before generic result/outcome checks.
- [ ] **Step 4: Re-run the focused test** and confirm the new assertions pass without changing the allowed historical features.

### Task 2: Add regression test for manually constructed prepared writer input

**Files:**
- Modify: `hkjc-horse-model/test/training-matrix.test.js`
- Modify: `hkjc-horse-model/src/training-dataset.js`

- [ ] **Step 1: Write the failing test** that passes `writeTrainingMatrixAtomically` a hand-built `{ columns, sourceRows }` object whose source row contains a `winnerFlag` feature and a declared non-metadata column; assert the promise rejects with leakage and leaves no output file.
- [ ] **Step 2: Run only that test** and confirm it fails because `validatePreparedTrainingMatrix` currently checks only container shape and column strings.
- [ ] **Step 3: Implement the minimal boundary validation**: validate every prepared source row with the same `validateMatrixRow` rules, collect the actual feature columns, require the prepared columns to equal the approved metadata prefix plus the deterministic sorted feature set, and validate source-row values while flattening.
- [ ] **Step 4: Re-run the focused writer tests** and confirm both valid prepared matrices and malicious hand-built matrices behave correctly.

### Task 3: Verify the deferred memory item without implementing it

**Files:**
- Modify: `docs/active-continuation-roadmap.md`

- [ ] **Step 1: Record the follow-up note** that `training-matrix` still parses its monolithic JSON input with `JSON.parse(await readFile(...))`, with the observed approximately 230 MB input / 175,574 rows / 329 MB peak as a later optimization; do not add a streaming parser dependency or redesign SQLite.
- [ ] **Step 2: Run focused tests** to ensure the note is documentation-only.

### Task 4: Full verification and append-only commit

**Files:**
- No additional implementation files.

- [ ] **Step 1: Run `npm test` from the repository root and inspect the complete result.
- [ ] **Step 2: Run `git diff --check` and inspect the diff for unrelated changes.
- [ ] **Step 3: Create one new append-only commit with the tests, validator/writer boundary fix, and follow-up note.
