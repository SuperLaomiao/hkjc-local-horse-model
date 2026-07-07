import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildBettingAvailability,
  formatRaceContext,
  getDashboardLayoutSections,
  getToolTab,
  TOOL_TAB_IDS,
} from '../dashboard-layout.js';

describe('dashboard layout sections', () => {
  it('keeps the main page focused and moves auxiliary betting tools into a drawer', () => {
    const layout = getDashboardLayoutSections({ selectedToolId: 'pool-guide' });

    assert.deepEqual(layout.primaryPanelIds, [
      'score-strip',
      'final-bet-plan',
      'staking-strategy',
      'prediction-table',
    ]);
    assert.equal(layout.primaryPanelIds.includes('multi-play-portfolio'), false);
    assert.equal(layout.primaryPanelIds.includes('pool-guide'), false);
    assert.equal(layout.activeTool.id, 'pool-guide');
    assert(layout.toolTabs.some((tab) => tab.id === 'multi-play-portfolio'));
    assert(layout.toolTabs.some((tab) => tab.id === 'pool-guide'));
    assert(layout.toolTabs.some((tab) => tab.id === 'review'));
    assert(layout.toolTabs.some((tab) => tab.id === 'research-lab'));
  });

  it('falls back to the portfolio tool when a stale tab id is restored', () => {
    const layout = getDashboardLayoutSections({ selectedToolId: 'old-tab' });

    assert.equal(layout.activeTool.id, 'multi-play-portfolio');
    assert.deepEqual(TOOL_TAB_IDS.slice(0, 3), ['multi-play-portfolio', 'pool-guide', 'adaptive-route']);
    assert.equal(getToolTab('pool-guide').label, '玩法库');
  });

  it('exposes a research lab drawer so algorithm changes are visible on the front end', () => {
    const researchTab = getToolTab('research-lab');

    assert.equal(researchTab.label, '研究升级');
    assert.equal(researchTab.eyebrow, 'Research');
    assert.match(researchTab.description, /GitHub|论文|算法/);
  });

  it('formats betting advice with an explicit race context', () => {
    assert.equal(
      formatRaceContext({ date: '2026-07-04', racecourse: 'ST', raceNo: 1 }),
      '2026-07-04 沙田 R1',
    );
    assert.equal(
      formatRaceContext({ date: '2026-07-08', racecourse: 'HV', raceNo: 6 }),
      '2026-07-08 跑马地 R6',
    );
  });

  it('marks betting closed before race day', () => {
    const status = buildBettingAvailability({
      entry: { date: '2026-07-04', racecourse: 'ST', raceNo: 1 },
      today: '2026-07-02',
    });

    assert.equal(status.canBetNow, false);
    assert.equal(status.label, '现在不能押');
    assert.equal(status.tone, 'closed');
    assert.match(status.detail, /只能等赛马当天/);
    assert.match(status.detail, /2026-07-04/);
  });

  it('marks betting open on the same race day before settlement', () => {
    const status = buildBettingAvailability({
      entry: { date: '2026-07-04', racecourse: 'ST', raceNo: 1, settlement: null },
      today: '2026-07-04',
    });

    assert.equal(status.canBetNow, true);
    assert.equal(status.label, '今天现在可以押');
    assert.equal(status.tone, 'open');
    assert.match(status.detail, /2026-07-04 沙田 R1/);
  });

  it('keeps a settled race closed even on race day', () => {
    const status = buildBettingAvailability({
      entry: { date: '2026-07-04', racecourse: 'ST', raceNo: 1, settlement: { resultLabel: 'MISS' } },
      today: '2026-07-04',
    });

    assert.equal(status.canBetNow, false);
    assert.equal(status.label, '现在不能押');
    assert.match(status.detail, /已经结算/);
  });
});
