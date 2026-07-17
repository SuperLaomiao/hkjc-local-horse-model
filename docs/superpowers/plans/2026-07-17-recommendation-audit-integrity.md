# Recommendation Audit Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Count exactly one final executable pre-race recommendation per race and strategy version in ROI and hit-rate reports, while retaining prepare, superseded, and post-race runs as excluded audit evidence.

**Architecture:** Preserve the already-tested due-snapshot collector as a separate commit, then insert a pure recommendation-run selection stage before dividend settlement. The selector derives post time from settled race data, classifies every run, and passes only the latest executable pre-race run in each race/strategy group to existing settlement logic.

**Tech Stack:** Node.js ES modules, built-in node:test, local SQLite, existing CLI/report JSON pipeline.

---

## File structure

- Modify hkjc-horse-model/src/recommendation-audit.js
  - Add pure run classification and final-lock selection.
- Modify hkjc-horse-model/test/recommendation-audit.test.js
  - Cover prepare, superseded, post-race, missing-time, and final-lock behavior.
- Modify hkjc-horse-model/src/cli.js
  - Expose eligible/excluded counts in console output.
- Modify hkjc-horse-model/test/sqlite-store.test.js
  - Verify SQLite and CLI round-trip.
- Modify docs/active-continuation-roadmap.md
  - Record completion and the next external-data slice.

## Task 1: Preserve and integrate the due-snapshot collector

- [ ] **Step 1: Verify the focused tests in the primary checkout**

Run from /Users/shi/Documents/赛马市场预测:

~~~bash
node --test \
  hkjc-horse-model/test/live-market-due-snapshots.test.js \
  hkjc-horse-model/test/live-snapshot-planner.test.js \
  hkjc-horse-model/test/live-market-snapshot.test.js
~~~

Expected: 9 tests pass, 0 fail.

- [ ] **Step 2: Commit only due-snapshot source changes**

~~~bash
git add \
  README.md \
  docs/active-continuation-roadmap.md \
  hkjc-horse-model/src/cli.js \
  hkjc-horse-model/src/sqlite-store.js \
  hkjc-horse-model/src/live-market-due-snapshots.js \
  hkjc-horse-model/test/live-market-due-snapshots.test.js \
  package.json
git diff --cached --check
git commit -m "feat: capture due HKJC market snapshots"
~~~

Do not stage raw race files or generated dashboard/audit JSON.

- [ ] **Step 3: Cherry-pick the new commit into this worktree**

~~~bash
DUE_SHA=$(git -C /Users/shi/Documents/赛马市场预测 rev-parse HEAD)
git cherry-pick "$DUE_SHA"
npm test
~~~

Expected: 104 tests pass, 0 fail.

## Task 2: Specify final pre-race selection

- [ ] **Step 1: Add failing tests**

Add these cases to hkjc-horse-model/test/recommendation-audit.test.js:

~~~js
it('counts only the latest executable pre-race run per strategy', () => {
  const race = { ...settledRace(), date: '2026-07-04', startTime: '16:00' };
  const audit = auditRecommendationRuns({
    races: [race],
    runs: [
      recommendationRun('prepare', '2026-07-04T07:00:00.000Z', 'prepare', 2),
      recommendationRun('early', '2026-07-04T07:20:00.000Z', 'execute', 2),
      recommendationRun('final', '2026-07-04T07:50:00.000Z', 'execute', 1),
      recommendationRun('after', '2026-07-04T08:05:00.000Z', 'execute', 2),
    ],
  });

  assert.equal(audit.summary.recordedRuns, 4);
  assert.equal(audit.summary.eligibleRuns, 1);
  assert.equal(audit.summary.excludedRuns, 3);
  assert.equal(audit.summary.totalStake, 10);
  assert.equal(audit.summary.totalReturn, 10.1);
  assert.equal(audit.runs.find((run) => run.runId === 'final').auditDecision, 'INCLUDED');
  assert.equal(audit.runs.find((run) => run.runId === 'prepare').exclusionReason, 'PREPARE_ONLY');
  assert.equal(audit.runs.find((run) => run.runId === 'early').exclusionReason, 'SUPERSEDED');
  assert.equal(audit.runs.find((run) => run.runId === 'after').exclusionReason, 'POST_RACE');
});

it('fails closed when a settled race has no trustworthy post time', () => {
  const audit = auditRecommendationRuns({
    races: [{ ...settledRace(), date: '2026-07-04', startTime: null }],
    runs: [recommendationRun('unknown-time', '2026-07-04T07:50:00.000Z', 'execute', 2)],
  });

  assert.equal(audit.summary.eligibleRuns, 0);
  assert.equal(audit.summary.totalStake, 0);
  assert.equal(audit.runs[0].exclusionReason, 'MISSING_POST_TIME');
});
~~~

Add the helper:

~~~js
function recommendationRun(runId, generatedAt, mode, horseNo) {
  return {
    runId,
    raceId: '2026-07-04-ST-1',
    generatedAt,
    strategyVersion: 'ev-portfolio-v1',
    summary: { mode },
    recommendations: [{ pool: 'PLACE', combination: [horseNo], stake: 10 }],
  };
}
~~~

- [ ] **Step 2: Verify RED**

~~~bash
node --test hkjc-horse-model/test/recommendation-audit.test.js
~~~

Expected: FAIL because eligibility fields and exclusion reasons do not exist.

## Task 3: Implement classification and final-lock selection

- [ ] **Step 1: Settle only included runs**

Refactor auditRecommendationRuns so it calls selectRecommendationRunsForAudit first, maps excluded items through excludedRun, and computes stake/ROI only from auditDecision === 'INCLUDED'. Its summary must include:

~~~js
{
  runs: includedRuns.length,
  recordedRuns: auditedRuns.length,
  eligibleRuns: includedRuns.length,
  excludedRuns: auditedRuns.length - includedRuns.length,
  exclusionReasons: countExclusionReasons(auditedRuns),
}
~~~

Keep the existing settledRuns, openRuns, stake, return, profit, ROI, and line counts.

- [ ] **Step 2: Add the selector**

Add to hkjc-horse-model/src/recommendation-audit.js:

~~~js
export function selectRecommendationRunsForAudit({ runs = [], raceById = new Map() } = {}) {
  const classified = runs.map((run) => classifyRunTiming(run, raceById.get(run.raceId)));
  const groups = new Map();

  for (const run of classified) {
    if (run.auditDecision === 'EXCLUDED') continue;
    const key = [run.raceId, run.strategyVersion ?? 'unknown'].join('|');
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }

  const finalRunIds = new Set();
  for (const items of groups.values()) {
    items.sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt)
      || String(b.runId).localeCompare(String(a.runId)));
    finalRunIds.add(items[0].runId);
  }

  return classified.map((run) => {
    if (run.auditDecision === 'EXCLUDED') return run;
    return finalRunIds.has(run.runId)
      ? { ...run, auditDecision: 'INCLUDED', exclusionReason: null }
      : { ...run, auditDecision: 'EXCLUDED', exclusionReason: 'SUPERSEDED' };
  });
}
~~~

- [ ] **Step 3: Add timing and exclusion helpers**

~~~js
function classifyRunTiming(run, race) {
  const mode = String(run.summary?.mode ?? run.raw?.summary?.mode ?? '').toLowerCase();
  if (mode === 'prepare') {
    return { ...run, auditDecision: 'EXCLUDED', exclusionReason: 'PREPARE_ONLY' };
  }
  const postTime = racePostTime(race);
  if (!postTime) {
    return { ...run, auditDecision: 'EXCLUDED', exclusionReason: 'MISSING_POST_TIME' };
  }
  const generatedAtMs = Date.parse(run.generatedAt);
  if (!Number.isFinite(generatedAtMs)) {
    return { ...run, auditDecision: 'EXCLUDED', exclusionReason: 'INVALID_GENERATED_AT' };
  }
  if (generatedAtMs >= postTime.getTime()) {
    return { ...run, auditDecision: 'EXCLUDED', exclusionReason: 'POST_RACE' };
  }
  return { ...run, auditDecision: 'CANDIDATE', exclusionReason: null };
}

function racePostTime(race) {
  if (!race?.date || !race?.startTime) return null;
  const raw = String(race.startTime);
  const time = /^\d{1,2}:\d{2}$/.test(raw) ? raw.padStart(5, '0') + ':00' : raw;
  const parsed = new Date(race.date + 'T' + time + '+08:00');
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function excludedRun(run) {
  return {
    ...run,
    status: 'EXCLUDED',
    stake: 0,
    returned: 0,
    profit: 0,
    lines: (run.recommendations ?? []).map((line) => ({
      ...line,
      status: 'EXCLUDED',
      stake: 0,
      returned: 0,
      profit: 0,
    })),
  };
}

function countExclusionReasons(runs) {
  return runs.reduce((counts, run) => {
    if (run.exclusionReason) {
      counts[run.exclusionReason] = (counts[run.exclusionReason] ?? 0) + 1;
    }
    return counts;
  }, {});
}
~~~

- [ ] **Step 4: Verify GREEN and commit**

~~~bash
node --test hkjc-horse-model/test/recommendation-audit.test.js
git add hkjc-horse-model/src/recommendation-audit.js hkjc-horse-model/test/recommendation-audit.test.js
git commit -m "fix: lock recommendation audit before post time"
~~~

Expected: all recommendation-audit tests pass.

## Task 4: Protect SQLite and CLI output

- [ ] **Step 1: Add a failing CLI integration assertion**

Extend the existing recommendation-audit CLI test in hkjc-horse-model/test/sqlite-store.test.js with one pre-race and one post-race run, then assert:

~~~js
assert.equal(report.summary.recordedRuns, 2);
assert.equal(report.summary.eligibleRuns, 1);
assert.equal(report.summary.excludedRuns, 1);
assert.equal(report.summary.exclusionReasons.POST_RACE, 1);
~~~

The settled fixture race must have date 2026-07-04 and startTime 16:00.

- [ ] **Step 2: Verify RED**

~~~bash
node --test hkjc-horse-model/test/sqlite-store.test.js
~~~

Expected: FAIL until the fixture and CLI output preserve the eligibility result.

- [ ] **Step 3: Update recommendationAuditCommand logs**

Use these lines:

~~~js
console.log('Recommendation audit: '
  + report.summary.eligibleRuns + '/' + report.summary.recordedRuns
  + ' final pre-race runs eligible, ' + report.summary.settledRuns
  + ' settled, ' + report.summary.excludedRuns + ' excluded');
console.log('Stake ' + money(report.summary.totalStake)
  + ', return ' + money(report.summary.totalReturn)
  + ', profit ' + formatSigned(report.summary.profit)
  + ', ROI ' + (report.summary.roi == null ? 'n/a' : percent(report.summary.roi)));
~~~

- [ ] **Step 4: Verify and commit**

~~~bash
node --test hkjc-horse-model/test/recommendation-audit.test.js hkjc-horse-model/test/sqlite-store.test.js
npm test
git add hkjc-horse-model/src/cli.js hkjc-horse-model/test/sqlite-store.test.js
git commit -m "test: verify trustworthy recommendation audit output"
~~~

Expected: focused tests and full suite pass.

## Task 5: Replay the real local audit

- [ ] **Step 1: Generate a temporary report from the primary SQLite database**

~~~bash
npm run hkjc:recommendation-audit -- \
  --db /Users/shi/Documents/赛马市场预测/hkjc-horse-model/data/hkjc.sqlite \
  --output /tmp/hkjc-latest-recommendation-audit.json
~~~

Expected: prepare/post-race/superseded runs contribute zero stake and return.

- [ ] **Step 2: Inspect counts**

~~~bash
node -e "const r=require('/tmp/hkjc-latest-recommendation-audit.json'); console.log(r.summary)"
~~~

Expected: recordedRuns equals eligibleRuns plus excludedRuns, and exclusionReasons explains excluded records.

- [ ] **Step 3: Update roadmap and verify**

Mark this slice complete in docs/active-continuation-roadmap.md and set the next exact slice to external source registry/provenance audit.

~~~bash
git diff --check
npm test
git add docs/active-continuation-roadmap.md
git commit -m "docs: advance HKJC data acceleration roadmap"
~~~

Expected: full suite passes and worktree is clean.

## Acceptance criteria

- Prepare-mode runs never affect hit rate or ROI.
- Runs generated at or after post time never affect hit rate or ROI.
- Earlier executable runs remain visible as SUPERSEDED but do not affect totals.
- Exactly one latest executable pre-race run per race/strategy version is settled.
- Missing race post time fails closed.
- The report exposes recorded, eligible, excluded, and reason counts.
- Existing dividend settlement remains unchanged for included runs.
- Full Node test suite passes.

## Follow-on plan sequence

After this slice, create and execute separate plans for:

1. external source registry and local-only Tianxi/SpeedPRO coverage audit;
2. WIN/PLACE/QIN/QPL pool-money features and leakage-safe training export;
3. catowabisabi and jerrydaphantom model reproduction and promotion gates.
