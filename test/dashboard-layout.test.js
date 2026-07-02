import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
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
  });

  it('falls back to the portfolio tool when a stale tab id is restored', () => {
    const layout = getDashboardLayoutSections({ selectedToolId: 'old-tab' });

    assert.equal(layout.activeTool.id, 'multi-play-portfolio');
    assert.deepEqual(TOOL_TAB_IDS.slice(0, 3), ['multi-play-portfolio', 'pool-guide', 'adaptive-route']);
    assert.equal(getToolTab('pool-guide').label, '玩法库');
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
});
