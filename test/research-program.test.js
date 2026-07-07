import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildResearchUpgradeProgram,
  summarizeResearchUpgradeProgram,
} from '../research-program.js';
import { buildDashboardSnapshot } from '../hkjc-horse-model/src/model.js';

describe('research upgrade program', () => {
  it('turns external research projects into an actionable algorithm roadmap', () => {
    const program = buildResearchUpgradeProgram();

    assert.equal(program.version, 'research-led-v1');
    assert(program.sources.length >= 12);
    assert(program.sources.some((source) => source.name === 'Ganyan'));
    assert(program.sources.some((source) => source.name.includes('HKJC Horse-Racing ML Research')));
    assert(program.sources.some((source) => source.name === 'neigh'));
    assert(program.sources.some((source) => source.name === 'HKJC Pool Money Calculator'));
    assert(program.sources.some((source) => source.name === 'HKJC Edge Lab'));
    assert(program.sources.every((source) => source.url.startsWith('https://github.com/')));

    assert(program.algorithmBorrowings.some((item) => item.status === 'active' && /Harville|Plackett-Luce/.test(item.concept)));
    assert(program.algorithmBorrowings.some((item) => item.status === 'next' && /market|odds/i.test(item.concept)));
    assert(program.frontendSignals.includes('研究升级页签'));
  });

  it('orders research follow-up actions for the daily automation queue', () => {
    const program = buildResearchUpgradeProgram();

    assert(program.followUpActions.length >= 8);
    assert.deepEqual(program.followUpActions.map((item) => item.priority).slice(0, 3), ['P0', 'P0', 'P0']);
    assert.equal(program.followUpActions[0].id, 'live-snapshot-planner');
    assert(program.followUpActions.some((item) => item.id === 'pool-money-features' && item.automationPhase === 'Phase A/B'));
    assert(program.followUpActions.some((item) => item.id === 'speedpro-feature-importer' && item.status === 'queued'));
    assert(program.followUpActions.every((item) => item.automationExecutable === true || item.status === 'research-only'));
  });

  it('summarizes active, next, and research-only items for the dashboard', () => {
    const summary = summarizeResearchUpgradeProgram(buildResearchUpgradeProgram());

    assert.equal(summary.activeCount > 0, true);
    assert.equal(summary.nextCount > 0, true);
    assert.equal(summary.researchOnlyCount > 0, true);
    assert.equal(summary.followUpCount > 0, true);
    assert.equal(summary.automationReadyCount > 0, true);
    assert.match(summary.headline, /研究驱动/);
    assert.match(summary.nextFocus, /市场赔率|校准|Kelly/);
    assert.match(summary.nextAction, /live snapshot|T-30|彩池/i);
  });

  it('attaches the research program to generated dashboard snapshots', () => {
    const snapshot = buildDashboardSnapshot([]);

    assert.equal(snapshot.research.version, 'research-led-v1');
    assert.equal(snapshot.research.summary.sourceCount >= 12, true);
    assert.equal(snapshot.research.summary.activeCount > 0, true);
    assert.equal(snapshot.research.summary.followUpCount > 0, true);
  });
});
