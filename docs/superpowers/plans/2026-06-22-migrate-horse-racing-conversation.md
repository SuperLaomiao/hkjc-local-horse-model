# Horse Racing Conversation Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the “寻找赛马必胜模式” conversation’s code, Git history, and durable project context into `/Users/shi/Documents/赛马市场预测`.

**Architecture:** Import the product history from `/Users/shi/Documents/New project/hkjc-local-horse-model`, then fast-forward to the latest GitHub `origin/main` so scheduled data-refresh commits are also preserved. Add project-local archive and handoff documents that record the source conversation, current product behavior, deployment, and operational constraints.

**Tech Stack:** Git, static HTML/CSS/JavaScript, Node.js scripts, GitHub Actions, GitHub Pages.

---

### Task 1: Preserve project context

**Files:**
- Create: `docs/conversation-handoff.md`
- Create: `docs/superpowers/plans/2026-06-22-migrate-horse-racing-conversation.md`

- [x] Record the source thread title and identifier.
- [x] Record the source repository, deployment URL, product behavior, model boundaries, and next-step guidance.
- [x] Verify both documents are readable from the target repository.

### Task 2: Import the source repository

**Files:**
- Import: all tracked files from `/Users/shi/Documents/New project/hkjc-local-horse-model`
- Preserve: source Git history for branch `main`

- [x] Fetch the source repository’s `main` branch into the empty target repository.
- [x] Point the target `main` branch at the fetched source commit and populate the working tree.
- [x] Configure the existing GitHub repository as `origin` in the target.
- [x] Fast-forward to the latest `origin/main` automatic data refresh.
- [x] Restore the migration documents after populating the source tree.

### Task 3: Verify the migration

**Files:**
- Verify: `package.json`, `index.html`, `app.js`, `styles.css`, `data/dashboard.json`, `.github/workflows/refresh-hkjc-data.yml`

- [x] Compare tracked source files with the target, excluding migration-only documents.
- [x] Run syntax checks and the CLI's supported read-only help command; `package.json` has no test script.
- [x] Confirm target `main` contains the source history and remote URL.
- [x] Confirm the working tree only contains the intentional migration documents.

### Task 4: Retire the old conversation entry

- [x] Archive the old “寻找赛马必胜模式” thread after the import and verification succeed.
- [x] Keep the source checkout intact as a recovery copy; the active project becomes `/Users/shi/Documents/赛马市场预测`.
