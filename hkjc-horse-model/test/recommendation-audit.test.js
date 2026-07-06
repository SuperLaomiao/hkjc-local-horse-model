import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { auditRecommendationRuns } from '../src/recommendation-audit.js';

describe('recommendation audit', () => {
  it('settles recorded recommendation lines against official dividends', () => {
    const audit = auditRecommendationRuns({
      runs: [{
        runId: 'rec_test',
        raceId: '2026-07-04-ST-1',
        recommendations: [
          { pool: 'PLACE', combination: [2], stake: 10 },
          { pool: 'QUINELLA_PLACE', combination: [1, 2], stake: 10 },
          { pool: 'WIN', combination: [8], stake: 10 },
        ],
      }],
      races: [settledRace()],
    });

    assert.equal(audit.summary.runs, 1);
    assert.equal(audit.summary.settledRuns, 1);
    assert.equal(audit.summary.totalStake, 30);
    assert.equal(audit.summary.totalReturn, 28.5);
    assert.equal(audit.summary.profit, -1.5);
    assert.equal(audit.summary.roi, -0.05);
    assert.equal(audit.summary.hitLines, 2);
    assert.equal(audit.summary.missLines, 1);
    assert.equal(audit.runs[0].status, 'SETTLED');
    assert.deepEqual(audit.runs[0].lines.map((line) => line.status), ['HIT', 'HIT', 'MISS']);
  });

  it('keeps recommendation runs open until the matching race is settled', () => {
    const audit = auditRecommendationRuns({
      runs: [{
        runId: 'rec_open',
        raceId: '2026-07-08-HV-1',
        recommendations: [{ pool: 'PLACE', combination: [2], stake: 10 }],
      }],
      races: [],
    });

    assert.equal(audit.summary.openRuns, 1);
    assert.equal(audit.summary.totalStake, 0);
    assert.equal(audit.runs[0].status, 'OPEN');
    assert.equal(audit.runs[0].lines[0].status, 'OPEN');
  });
});

function settledRace() {
  return {
    raceId: '2026-07-04-ST-1',
    status: 'settled',
    runners: [
      { placing: 1, horseNo: 2, horseId: 'HK_2025_L245', horseName: 'ALMIGHTY WARRIOR', winOdds: 7.8 },
      { placing: 2, horseNo: 1, horseId: 'HK_2025_L441', horseName: 'JEDI SPURS', winOdds: 1.1 },
      { placing: 3, horseNo: 9, horseId: 'HK_2025_L393', horseName: 'QUANTUM WUKONG', winOdds: 15 },
    ],
    dividends: {
      win: [{ pool: 'WIN', combination: [2], dividendPer10: 78 }],
      place: [
        { pool: 'PLACE', combination: [2], dividendPer10: 15 },
        { pool: 'PLACE', combination: [1], dividendPer10: 10.1 },
      ],
      quinellaPlace: [{ pool: 'QUINELLA PLACE', combination: [1, 2], dividendPer10: 13.5 }],
    },
  };
}
