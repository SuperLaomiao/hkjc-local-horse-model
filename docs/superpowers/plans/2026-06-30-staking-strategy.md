# Staking Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an HK$10-100 conservative staking strategy panel to the static HK racing dashboard.

**Architecture:** Create a pure `bet-strategy.js` module with tested budget and bet-line generation, then import it into `app.js` for rendering. Keep the strategy client-side because it uses the already-published forecast and does not require backend state.

**Tech Stack:** Vanilla ES modules, Node.js `node:test`, static GitHub Pages app.

---

### Task 1: Strategy engine

**Files:**
- Create: `bet-strategy.js`
- Create: `test/bet-strategy.test.js`

- [ ] Write failing tests for PASS, HK$30 normal strategy, HK$50 combo strategy, HK$100 cap, and no-odds prepare mode.
- [ ] Implement `buildStakingStrategy(entry, options = {})`.
- [ ] Run `node --test test/bet-strategy.test.js` and verify PASS.

### Task 2: Web UI

**Files:**
- Modify: `app.js`
- Modify: `styles.css`
- Modify: `sw.js`
- Modify: `README.md`

- [ ] Import `buildStakingStrategy`.
- [ ] Add `renderStakingStrategyPanel(entry)` to the right stack.
- [ ] Add CSS for strategy cards and bet lines.
- [ ] Bump service-worker cache name and cache `bet-strategy.js`.
- [ ] Document the strategy in README.

### Task 3: Verify and commit

**Files:**
- Git state only.

- [ ] Run `npm test`.
- [ ] Run JS syntax checks.
- [ ] Run local HTTP smoke for `/` and `/bet-strategy.js`.
- [ ] Run Chrome smoke if available.
- [ ] Commit locally with `feat: add staking strategy panel`.

