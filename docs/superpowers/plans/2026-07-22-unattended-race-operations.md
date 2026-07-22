# Unattended Race Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the daily inspection, local race-day collector, Research Lab, GitHub, and GitHub Pages around an unattended public-racecard preflight and fresh prospective-data workflow.

**Architecture:** Reuse the existing `refresh`, `sync-db`, and finite `race-day-cycle` commands. The daily Codex automation performs the low-frequency preflight and writes only approved private local artifacts; the ten-minute LaunchAgent consumes SQLite upcoming races. Public code exposes aggregate operational readiness and data gates without publishing private paths or rows.

**Tech Stack:** Node.js test runner, existing HKJC parser/SQLite CLI, Codex cron automation, macOS LaunchAgent, static GitHub Pages build.

---

### Task 1: Make the race-card preflight the first Research Lab action

**Files:**
- Modify: `test/research-program.test.js`
- Modify: `research-program.js`

- [ ] **Step 1: Write the failing test**

Add assertions that the first follow-up action is `upcoming-racecard-preflight`, is `P0`/`partial`/automation-executable, cites `refresh`, `sync-db`, fixture parsing, and private SQLite sync, and that `race-day-cycle` reports the local scheduler as enabled while cash stays `NO_BET`.

```js
assert.equal(program.followUpActions[0].id, 'upcoming-racecard-preflight');
assert.equal(program.followUpActions[0].status, 'partial');
assert.equal(program.followUpActions[0].automationExecutable, true);
assert(program.followUpActions[0].evidence.some((entry) => /refresh.*sync-db|fixture/i.test(entry)));
assert(program.followUpActions[0].remaining.some((entry) => /upcoming|新赛季|race card/i.test(entry)));
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/research-program.test.js`

Expected: FAIL because `live-snapshot-planner` is still first and the preflight action does not exist.

- [ ] **Step 3: Add the minimal Research Lab action and status correction**

Insert one P0 action before `live-snapshot-planner`. It must describe the existing public fixture/race-card refresh and SQLite sync chain, remain `partial` until a real future card is observed, and contain no absolute path. Update `race-day-cycle` evidence from “default disabled” to “installer implemented; this local deployment enabled after explicit approval”, while retaining `NO_BET` in `remaining`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test test/research-program.test.js`

Expected: all research-program tests pass; summary counts reflect one additional partial action and `nextAction` names the preflight.

- [ ] **Step 5: Commit**

```bash
git add research-program.js test/research-program.test.js
git commit -m "feat: surface unattended race preflight"
```

### Task 2: Align the continuation roadmap and operating guide

**Files:**
- Modify: `docs/active-continuation-roadmap.md`
- Modify: `docs/operations/local-race-day-scheduler.md`

- [ ] **Step 1: Add the operational handoff checklist**

Document the two-job split, mark the LaunchAgent installation as complete, and keep the first real future-card/pre-race cohort unchecked. Make the priority order preflight → collector health → settlement/evaluation → unblocked research.

- [ ] **Step 2: Correct stale disabled-scheduler wording**

Keep the installer disabled-by-default as a product property, but state that this local deployment was enabled only after explicit user approval. Do not publish the user's home path, database path, launchd UID, or private log path.

- [ ] **Step 3: Validate the documentation diff**

Run: `git diff --check && rg -n '/Users/|hkjc\.sqlite|LaunchAgents/com\.' docs/active-continuation-roadmap.md docs/operations/local-race-day-scheduler.md`

Expected: `git diff --check` succeeds and the privacy search returns no newly added absolute paths.

- [ ] **Step 4: Commit**

```bash
git add docs/active-continuation-roadmap.md docs/operations/local-race-day-scheduler.md
git commit -m "docs: align unattended race operations"
```

### Task 3: Update the active daily automation

**Files:**
- Update through Codex automation API: automation `hkjc-2`
- Update local checkpoint: `$CODEX_HOME/automations/hkjc-2/memory.md`

- [ ] **Step 1: Preserve the existing schedule and safety fields**

Keep daily 10:00 HKT, local execution, model `gpt-5.4`, high reasoning, fixed worktree, 105–115 minute budget, no automatic push/merge/deploy, and `NO_BET`.

- [ ] **Step 2: Replace the stale P5→P8 first-action rule**

Make every run begin with a bounded public preflight using the existing refresh/sync chain, allow writes only to ignored worktree data plus the explicitly approved private SQLite/log outputs, then verify the collector and settle fresh locks. If no future card exists, record the deficit and continue safe research rather than stopping.

- [ ] **Step 3: Verify the saved automation**

Use the automation view operation and confirm `status=ACTIVE`, the original schedule/model/environment remain unchanged, and the prompt contains `upcoming`, `race-card`, `sync-db`, `race-day-cycle`, `NO_BET`, and the approved private-write boundary.

- [ ] **Step 4: Append the automation checkpoint**

Record the new priority order, local scheduler health, current off-season `upcoming=0`, and exact next preflight command in automation memory. Do not overwrite earlier history.

### Task 4: Verify, publish, merge, and validate Pages

**Files:**
- Generated locally only: `.public-site/`
- GitHub workflow input: repository branch and public allowlist files only

- [ ] **Step 1: Run full local verification**

Run:

```bash
npm test
npm run hkjc:build-public-site
npm run hkjc:privacy-scan
git diff --check
```

Expected: all Node tests pass, public build succeeds, privacy scan reports zero violations, and no whitespace errors remain.

- [ ] **Step 2: Verify the public UI locally**

Serve `.public-site`, open the Research Lab at mobile and desktop widths, and confirm the preflight is first, scheduler state is no longer “disabled”, the page remains `NO_BET`, and there are no console errors or horizontal overflow.

- [ ] **Step 3: Publish through GitHub**

Confirm `gh auth status`, inspect `git status -sb` and the complete diff, push `codex/daily-hkjc`, create a PR to `main`, merge only after checks pass, and keep the fixed worktree for the next daily run.

- [ ] **Step 4: Verify GitHub Pages**

Wait for the Pages workflow, open `https://superlaomiao.github.io/hkjc-local-horse-model/`, and verify the deployed Research Lab contains the updated unattended-preflight status without private artifacts.
