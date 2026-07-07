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
    assert(program.sources.length >= 5);
    assert(program.sources.some((source) => source.name === 'Ganyan'));
    assert(program.sources.some((source) => source.name.includes('HKJC Horse-Racing ML Research')));
    assert(program.sources.every((source) => source.url.startsWith('https://github.com/')));

    assert(program.algorithmBorrowings.some((item) => item.status === 'active' && /Harville|Plackett-Luce/.test(item.concept)));
    assert(program.algorithmBorrowings.some((item) => item.status === 'next' && /market|odds/i.test(item.concept)));
    assert(program.frontendSignals.includes('研究升级页签'));
  });

  it('summarizes active, next, and research-only items for the dashboard', () => {
    const summary = summarizeResearchUpgradeProgram(buildResearchUpgradeProgram());

    assert.equal(summary.activeCount > 0, true);
    assert.equal(summary.nextCount > 0, true);
    assert.equal(summary.researchOnlyCount > 0, true);
    assert.match(summary.headline, /研究驱动/);
    assert.match(summary.nextFocus, /市场赔率|校准|Kelly/);
  });

  it('attaches the research program to generated dashboard snapshots', () => {
    const snapshot = buildDashboardSnapshot([]);

    assert.equal(snapshot.research.version, 'research-led-v1');
    assert.equal(snapshot.research.summary.sourceCount >= 5, true);
    assert.equal(snapshot.research.summary.activeCount > 0, true);
  });
});
