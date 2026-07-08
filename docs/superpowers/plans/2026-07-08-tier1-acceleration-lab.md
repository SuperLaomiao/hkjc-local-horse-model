# Tier1 Acceleration Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an External Benchmark Harness registry to Research Lab so the project can rapidly leverage stronger open-source HKJC projects and track the path to tier1 performance.

**Architecture:** Keep the first slice inside `research-program.js` and the existing dashboard renderer. The registry is dashboard-safe metadata plus summary helpers; later phases can attach real runners and training outputs to the same ids.

**Tech Stack:** Vanilla ES modules, Node.js `node:test`, static GitHub Pages dashboard, existing SQLite dashboard export.

---

### Task 1: Add failing registry tests

**Files:**
- Modify: `test/research-program.test.js`

- [ ] **Step 1: Write tests for the external benchmark registry**

Add assertions that `buildResearchUpgradeProgram()` returns an `externalBenchmarkRegistry` array with tier1 candidates for catowabisabi, jerrydaphantom, anton, live market capture, and Tianxi.

- [ ] **Step 2: Write tests for summary gap fields**

Add assertions that `summarizeResearchUpgradeProgram()` reports `externalBenchmarkCount`, `reproductionReadyCount`, `blockedBenchmarkCount`, `tier1GapLabel`, and `nextBenchmarkAction`.

- [ ] **Step 3: Verify red**

Run:

```bash
node --test test/research-program.test.js
```

Expected: fail because `externalBenchmarkRegistry` and summary fields are not implemented.

### Task 2: Implement registry and summary

**Files:**
- Modify: `research-program.js`

- [ ] **Step 1: Add `EXTERNAL_BENCHMARK_REGISTRY`**

Include:

- `catowabisabi-lgb-no-odds-quinella`
- `jerrydaphantom-catboost-market-aware`
- `anton-no-odds-feature-stack`
- `eprochasson-live-odds-archive`
- `bobosky-rkwyu-live-pool-capture`
- `tianxi-feature-backfill`

- [ ] **Step 2: Add registry to `buildResearchUpgradeProgram()`**

Return cloned registry items alongside sources, borrowings, and follow-up actions.

- [ ] **Step 3: Add summary fields**

Compute reproduction-ready and blocked counts. Set the next benchmark action to the first P0/P1 item with `status: "reproduce-next"`.

- [ ] **Step 4: Verify green**

Run:

```bash
node --test test/research-program.test.js
```

Expected: all Research Lab tests pass.

### Task 3: Render benchmark registry on the Research Lab dashboard

**Files:**
- Modify: `app.js`
- Modify: `styles.css`

- [ ] **Step 1: Render benchmark cards**

Add a `Tier1 外部 benchmark` section after the follow-up action queue. Each card shows status, priority, public metric, local gap, leverage path, promotion gate, and license/access note.

- [ ] **Step 2: Style compact cards**

Reuse existing Research Lab visual language. Keep cards readable on mobile.

- [ ] **Step 3: Syntax check**

Run:

```bash
node --check app.js && node --check research-program.js
```

Expected: exit code 0.

### Task 4: Mirror actions in roadmap and regenerate dashboard

**Files:**
- Modify: `docs/active-continuation-roadmap.md`
- Modify generated: `data/dashboard.json`
- Modify generated: `data/dashboard-history.json`

- [ ] **Step 1: Add Tier1 benchmark reproduction tasks**

Add Phase B tasks for catowabisabi-style LightGBM no-odds quinella and jerrydaphantom-style CatBoost market-aware calibration. Add data tasks for Tianxi and live pool capture.

- [ ] **Step 2: Regenerate dashboard**

Run:

```bash
npm run hkjc:dashboard-db
```

Expected: dashboard JSON includes `research.externalBenchmarkRegistry`.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm test && node --check app.js && node --check research-program.js
```

Expected: all tests pass and syntax checks pass.

### Task 5: Commit and push branch

**Files:**
- All changed files from Tasks 1-4

- [ ] **Step 1: Check git status**

Run:

```bash
git status --short --branch
```

- [ ] **Step 2: Commit**

Run:

```bash
git add app.js styles.css research-program.js test/research-program.test.js docs/active-continuation-roadmap.md docs/superpowers/specs/2026-07-08-tier1-acceleration-lab-design.md docs/superpowers/plans/2026-07-08-tier1-acceleration-lab.md data/dashboard.json data/dashboard-history.json
git commit -m "Add tier1 research benchmark registry"
```

- [ ] **Step 3: Push**

Run:

```bash
git push -u origin codex/tier1-acceleration-lab
```

Expected: branch pushed. Merge to `main` only after verification and user approval or explicit instruction.

