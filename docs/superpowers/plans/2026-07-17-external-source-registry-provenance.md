# External Source Registry and Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Follow red-green-refactor for every behavior change.

**Goal:** Make every external data or model donor auditable before import, enforce local-only handling for unknown-license raw data, and produce a compact source-readiness report without publishing third-party raw files.

**Architecture:** Define a versioned source registry as code, validate its license and publication invariants through a pure audit builder, then expose a CLI report. Actual raw clones live in an ignored local cache and are scanned through source adapters that classify fields as pre-race, post-race, or unsafe before any training import.

**Tech Stack:** Node.js ES modules, built-in `node:test`, JSON reports, Git-ignored local cache, existing CLI/package scripts.

---

## File structure

- Add `hkjc-horse-model/src/external-source-registry.js`
  - Versioned source definitions and validation helpers.
- Add `hkjc-horse-model/src/external-source-audit.js`
  - Pure audit/report builder with source and feature-policy summaries.
- Add `hkjc-horse-model/test/external-source-registry.test.js`
  - License/publication invariants and report summary tests.
- Add `hkjc-horse-model/test/external-source-audit-cli.test.js`
  - CLI JSON generation test.
- Modify `hkjc-horse-model/src/cli.js`
  - Add `external-source-audit` command.
- Modify `package.json`
  - Add `hkjc:external-source-audit` script.
- Modify `.gitignore`
  - Ignore `hkjc-horse-model/data/external/raw-local/`.
- Modify `README.md`
  - Document source audit and publication boundaries.
- Modify `docs/active-continuation-roadmap.md`
  - Record completion and next source-coverage work.

## Task 1: Specify registry policy

- [ ] Add failing tests for required source metadata, license categories, and publication invariants.
- [ ] Confirm RED because the registry module does not exist.
- [ ] Add the minimum registry definitions for Tianxi, `mag-dot/race-data`, official HKJC, HKO, eprochasson, catowabisabi, jerrydaphantom, stevw, Tang, Bobosky, and rkwyu.
- [ ] Confirm GREEN.

Each source records canonical URL, source role, license status, allowed uses, raw-publication permission, code-reuse permission, cache policy, provenance requirements, and expected feature groups.

Unknown or restricted licenses must fail validation if raw publication or code reuse is enabled.

## Task 2: Build the pure audit report

- [ ] Add failing tests for summary counts, local-only sources, model/data donors, field-timing coverage, and invalid registry entries.
- [ ] Confirm RED.
- [ ] Implement `buildExternalSourceAudit` and deterministic source ordering.
- [ ] Confirm GREEN.

The report must separate:

- licensed/open-data versus unknown/restricted sources;
- local raw research versus publishable derived aggregates;
- code/model donors versus raw-data donors;
- pre-race-safe, post-race-only, and unclassified feature groups.

## Task 3: Add CLI and compact report output

- [ ] Add a failing CLI integration test that invokes `external-source-audit`.
- [ ] Confirm RED because the command is unknown.
- [ ] Add command dispatch, help text, JSON write, console summary, and package script.
- [ ] Confirm GREEN.

Default output:

`hkjc-horse-model/data/processed/external-source-audit.json`

## Task 4: Enforce local cache boundaries

- [ ] Add the raw-local cache path to `.gitignore`.
- [ ] Document that unknown-license raw files stay local and cannot feed the public dashboard directly.
- [ ] Add tests or assertions that no registry entry can contradict this policy.

## Task 5: Audit Tianxi and SpeedPRO coverage

- [ ] Clone/update Tianxi and `mag-dot/race-data` into an external local cache, not a tracked repository directory.
- [ ] Build a source-coverage scanner for file counts, date coverage, schema samples, and provenance checksums.
- [ ] Classify current-race results/dividends/comments/sectionals as post-race-only.
- [ ] Classify prior form, prior trials, prior trackwork, and dated profiles as candidate pre-race features only when an availability timestamp or conservative date exists.
- [ ] Fail closed on ambiguous fields.
- [ ] Write only compact derived coverage metadata to the tracked report.

## Task 6: Verify and hand off to feature import

- [ ] Run focused tests.
- [ ] Run `npm test`.
- [ ] Run the real source audit and inspect its JSON.
- [ ] Update the continuation roadmap with exact counts and remaining blockers.
- [ ] Commit the registry/audit slice separately from source-specific scanning.

The next implementation plan will cover leakage-safe Tianxi/SpeedPRO normalized feature adapters and training-matrix enrichment.
