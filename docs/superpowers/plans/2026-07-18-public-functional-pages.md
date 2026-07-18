# Public Functional GitHub Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the complete prediction, EV, staking, and review experience on the public GitHub Pages site while continuing to exclude private source data and personal records.

**Architecture:** Replace the research-only publication marker with a versioned sanitized-functional contract. Keep the exact public artifact allowlist and fail-closed scanner, but let the browser enable recommendation tools only when the full functional marker is valid. Separate public product execution from access to private processed Research Lab reports so enabling the product cannot cause private-path fetches.

**Tech Stack:** JavaScript ES modules, Node.js test runner, static GitHub Pages, GitHub Actions, JSON dashboard snapshots, browser localStorage.

---

### Task 1: Version the sanitized functional publication contract

**Files:**
- Modify: `hkjc-horse-model/test/dashboard-publish.test.js`
- Modify: `hkjc-horse-model/test/public-site-publish.test.js`
- Modify: `hkjc-horse-model/src/dashboard-publish.js`
- Modify: `hkjc-horse-model/src/public-site-publish.js`

- [ ] **Step 1: Write failing publisher tests**

Add assertions that the public snapshot is functional but still excludes private data:

```js
assert.equal(publicSnapshot.publication.visibility, 'PUBLIC_FUNCTIONAL_SANITIZED');
assert.equal(publicSnapshot.publication.executableRecommendationsPublished, true);
assert.equal(publicSnapshot.publication.personalDataPublished, false);
assert.equal(publicSnapshot.publication.rowLevelHistoryPublished, false);
```

Add scanner coverage proving the generated dashboard uses the same marker and that a dashboard with `personalDataPublished: true` fails privacy validation.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
node --test hkjc-horse-model/test/dashboard-publish.test.js hkjc-horse-model/test/public-site-publish.test.js
```

Expected: FAIL because the publisher still emits `PUBLIC_SANITIZED` with executable recommendations disabled and the scanner does not validate the functional contract.

- [ ] **Step 3: Implement the minimal publication contract**

Emit this publication object from `splitDashboardForPublishing`:

```js
publication: {
  visibility: 'PUBLIC_FUNCTIONAL_SANITIZED',
  policyVersion: 'public-dashboard-v2',
  executableRecommendationsPublished: true,
  personalDataPublished: false,
  rowLevelHistoryPublished: false,
}
```

Update `scanPublicSite` to require all four functional/privacy fields. Continue scanning the entire dashboard for forbidden fields and require an empty row-level ledger.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Task 1 command again.

Expected: all focused publisher and scanner tests pass.

- [ ] **Step 5: Commit**

```bash
git add hkjc-horse-model/src/dashboard-publish.js hkjc-horse-model/src/public-site-publish.js hkjc-horse-model/test/dashboard-publish.test.js hkjc-horse-model/test/public-site-publish.test.js
git commit -m "feat: publish sanitized functional dashboard contract"
```

### Task 2: Enable public product tools while failing closed on unknown snapshots

**Files:**
- Modify: `test/public-dashboard-mode.test.js`
- Modify: `public-dashboard-mode.js`

- [ ] **Step 1: Write failing execution-policy tests**

Add a functional-public case:

```js
const policy = dashboardExecutionPolicy({
  publication: {
    visibility: 'PUBLIC_FUNCTIONAL_SANITIZED',
    executableRecommendationsPublished: true,
    personalDataPublished: false,
    rowLevelHistoryPublished: false,
  },
});
assert.equal(policy.mode, 'PUBLIC_FUNCTIONAL');
assert.equal(policy.allowExecutableRecommendations, true);
assert.equal(policy.allowPersonalStaking, true);
assert.equal(policy.allowPrivateResearchReports, false);
assert.deepEqual(buildPublicPortfolioOptions({ publication: functionalPublication }), {});
```

Add fail-closed cases for a missing marker and for a functional marker that claims personal data is published. Both must return zero portfolio budget.

- [ ] **Step 2: Run the focused policy test and verify RED**

Run:

```bash
node --test test/public-dashboard-mode.test.js
```

Expected: FAIL because the functional-public mode and private-report permission do not exist and an unmarked snapshot currently defaults to private execution.

- [ ] **Step 3: Implement explicit publication modes**

Make `dashboardExecutionPolicy` return:

```js
{
  mode: 'PUBLIC_FUNCTIONAL',
  allowExecutableRecommendations: true,
  allowPersonalStaking: true,
  allowPrivateResearchReports: false,
  label: '公开功能版',
  reason: '预测、EV 与注码工具公开运行；个人记录只保存在本机浏览器。',
}
```

only for the exact sanitized-functional contract. Keep `PRIVATE_LOCAL` fully enabled. Every missing, legacy, malformed, or research-only public marker must return `PUBLIC_RESEARCH_ONLY` with zero portfolio limits.

- [ ] **Step 4: Run the focused policy test and verify GREEN**

Run the Task 2 command again.

Expected: all policy cases pass.

- [ ] **Step 5: Commit**

```bash
git add public-dashboard-mode.js test/public-dashboard-mode.test.js
git commit -m "feat: enable sanitized public product mode"
```

### Task 3: Integrate functional-public mode into the dashboard UI

**Files:**
- Modify: `test/public-dashboard-mode.test.js`
- Modify: `public-dashboard-mode.js`
- Modify: `app.js`
- Modify: `styles.css`
- Modify: `sw.js`

- [ ] **Step 1: Write failing UI-helper tests**

Export and test `publicationBadge(policy)`:

```js
assert.deepEqual(publicationBadge(functionalPolicy), {
  label: '公开功能版',
  tone: 'functional',
});
assert.deepEqual(publicationBadge(researchOnlyPolicy), {
  label: '公开研究版 · NO BET',
  tone: 'research',
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test test/public-dashboard-mode.test.js
```

Expected: FAIL because `publicationBadge` is not exported.

- [ ] **Step 3: Implement UI integration**

Add `publicationBadge`, import it in `app.js`, and render the badge in the top metadata strip. Change `ensureResearchReports` to check `allowPrivateResearchReports` instead of `allowExecutableRecommendations`. This keeps public aggregate Research Lab content available without fetching removed private processed files.

Retain all existing rendering gates:

```js
${executionPolicy.allowPersonalStaking ? renderStakingStrategyPanel(selectedEntry) : ''}
```

Because the functional contract enables that permission, the final plan, staking strategy, pool guide, adaptive route, and multi-play portfolio become visible again. Existing EV, freshness, calibration, pool-promotion, and exposure gates continue to decide `PLAY`, `WATCH`, `PAPER`, or `NO_BET`.

Add minimal badge styling and bump the service-worker cache name so phones do not retain the old research-only bundle.

- [ ] **Step 4: Run focused UI and strategy tests**

Run:

```bash
node --test test/public-dashboard-mode.test.js test/bet-strategy.test.js test/multi-play-portfolio.test.js hkjc-horse-model/test/model-final-bet-plan.test.js
node --check app.js
```

Expected: all tests pass and `app.js` parses.

- [ ] **Step 5: Commit**

```bash
git add app.js public-dashboard-mode.js styles.css sw.js test/public-dashboard-mode.test.js
git commit -m "feat: restore public mobile strategy tools"
```

### Task 4: Regenerate the public snapshot and update operating documentation

**Files:**
- Modify: `data/dashboard.json`
- Modify: `docs/privacy-publishing.md`
- Modify: `docs/active-continuation-roadmap.md`

- [ ] **Step 1: Write a failing workflow/public-data assertion**

Extend `test/privacy-workflow.test.js` to parse `data/dashboard.json` and require:

```js
assert.equal(dashboard.publication.visibility, 'PUBLIC_FUNCTIONAL_SANITIZED');
assert.equal(dashboard.publication.executableRecommendationsPublished, true);
assert.equal(dashboard.publication.personalDataPublished, false);
assert.deepEqual(dashboard.ledger, []);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test test/privacy-workflow.test.js
```

Expected: FAIL because the tracked public snapshot still carries the legacy research-only marker.

- [ ] **Step 3: Regenerate the sanitized tracked snapshot**

Use `splitDashboardForPublishing` on the tracked dashboard data and replace only `data/dashboard.json` with the returned public snapshot. Do not copy `.public-site`, history, audits, SQLite, raw, upcoming, private, or processed files into Git.

Update documentation to state that Pages is publicly functional while the sensitive-data exclusions remain active. Record that private repository/auth separation is deferred.

- [ ] **Step 4: Run the focused test and privacy build**

Run:

```bash
node --test test/privacy-workflow.test.js
npm run hkjc:build-public-site
npm run hkjc:privacy-scan
```

Expected: focused test passes and the exact artifact reports zero privacy violations.

- [ ] **Step 5: Commit**

```bash
git add data/dashboard.json docs/privacy-publishing.md docs/active-continuation-roadmap.md test/privacy-workflow.test.js
git commit -m "docs: activate public functional Pages policy"
```

### Task 5: Full verification, browser QA, and deployment

**Files:**
- Verify only; modify code only if a failing test or browser defect requires a new red-green cycle.

- [ ] **Step 1: Run the complete automated suites**

Run:

```bash
/Users/shi/Library/Caches/hkjc-local-horse-model/python-env/bin/python -m unittest discover -s hkjc-horse-model/python -p 'test_*.py' -v
npm test
ruby -e "require 'yaml'; YAML.load_file('.github/workflows/refresh-hkjc-data.yml'); puts 'workflow yaml parse PASS'"
npm run hkjc:build-public-site
npm run hkjc:privacy-scan
node --check app.js
```

Expected: Python and Node suites report zero failures, YAML parses, the public artifact builds, and the privacy scan reports zero violations.

- [ ] **Step 2: Verify the generated artifact contents**

Confirm `data/dashboard.json` in `.public-site` has the functional marker, an empty ledger, and no forbidden fields or local paths. Confirm former private artifact paths are absent.

- [ ] **Step 3: Run desktop and mobile browser QA**

Serve `.public-site` locally and verify:

- `公开功能版` is visible;
- final-plan and staking panels are visible;
- each recommendation includes race context;
- no private-report requests return 404;
- current unpromoted/missing-price examples remain `PAPER`, `WATCH`, or `NO_BET` rather than becoming `PLAY`;
- the mobile action bar and race selector remain usable at a phone viewport.

- [ ] **Step 4: Commit any test-driven QA fix**

If QA reveals a defect, reproduce it with a failing automated test, implement the minimum fix, rerun the affected and full suites, then commit the fix. If QA is clean, make no extra commit.

- [ ] **Step 5: Push, open a PR, merge, and monitor Pages**

Push `codex/public-full-functionality`, open a PR against `main`, merge only after all checks pass, then watch the GitHub Actions Pages run to completion. Verify the deployed JSON marker and public UI at `https://superlaomiao.github.io/hkjc-local-horse-model/`.
