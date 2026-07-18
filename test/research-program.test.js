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

    assert.equal(program.version, 'research-led-v2');
    assert(program.sources.length >= 15);
    assert(program.sources.some((source) => source.name === 'Ganyan'));
    assert(program.sources.some((source) => source.name.includes('HKJC Horse-Racing ML Research')));
    assert(program.sources.some((source) => source.name === 'neigh'));
    assert(program.sources.some((source) => source.name === 'HKJC Pool Money Calculator'));
    assert(program.sources.some((source) => source.name === 'HKJC Edge Lab'));
    assert(program.sources.some((source) => source.name === 'HK-Horse-Racing-Data-Scraper'));
    assert(program.sources.some((source) => (
      source.name === 'hkjc-analytics'
      && /method|方法|heuristic|启发式/i.test(`${source.lesson} ${source.borrow}`)
    )));
    assert(program.sources.every((source) => source.url.startsWith('https://github.com/')));

    assert(program.algorithmBorrowings.some((item) => item.status === 'active' && /Harville|Plackett-Luce/.test(item.concept)));
    assert(program.algorithmBorrowings.some((item) => item.status === 'active' && /market|odds/i.test(item.concept)));
    assert(program.algorithmBorrowings.some((item) => item.status === 'next' && /Kelly|Bayesian|SpeedPRO/i.test(item.concept)));
    assert(program.frontendSignals.includes('研究升级页签'));
  });

  it('tracks tier1 external benchmark candidates to leverage stronger projects', () => {
    const program = buildResearchUpgradeProgram();

    assert(program.externalBenchmarkRegistry.length >= 7);
    assert(program.externalBenchmarkRegistry.some((item) => (
      item.id === 'catowabisabi-lgb-no-odds-quinella'
      && item.status === 'partial-blocked-data'
      && /Quinella|连赢/i.test(item.publicMetric)
      && /negative|负|NO-BET/i.test(item.ourGap)
      && item.promotionGate.includes('holdout')
    )));
    assert(program.externalBenchmarkRegistry.some((item) => (
      item.id === 'jerrydaphantom-catboost-market-aware'
      && item.status === 'reproduced-no-go'
      && /0\.234958|32\.7/.test(item.publicMetric)
      && item.requiredLocalData.some((data) => /T-30|market/i.test(data))
    )));
    assert(program.externalBenchmarkRegistry.some((item) => (
      item.id === 'tianxi-feature-backfill'
      && item.status === 'data-leverage'
      && item.accessPolicy.includes('local-only')
    )));
    assert(program.externalBenchmarkRegistry.some((item) => (
      item.id === 'j-csc-scraper-schema-audit'
      && item.status === 'data-leverage'
      && /兽医|veterinary|排位|racecard/i.test(item.leveragePath)
    )));
    assert(program.externalBenchmarkRegistry.every((item) => item.localAdoption !== 'cash-ready'));
    assert.equal(program.externalBenchmarkRegistry.some((item) => (
      /hkjc-analytics/i.test(`${item.id} ${item.sourceName} ${item.sourceUrl}`)
    )), false);
  });

  it('orders research follow-up actions for the daily automation queue', () => {
    const program = buildResearchUpgradeProgram();

    assert(program.followUpActions.length >= 8);
    assert.deepEqual(program.followUpActions.map((item) => item.priority).slice(0, 3), ['P0', 'P0', 'P0']);
    assert.equal(program.followUpActions[0].id, 'live-snapshot-planner');
    assert(program.followUpActions.some((item) => (
      item.id === 'live-snapshot-planner'
      && item.status === 'implemented'
      && item.sourceRefs.includes('hkjc-analytics')
      && item.evidence.some((entry) => /live-snapshot-planner\.js/.test(entry))
      && item.evidence.some((entry) => /post-time|赛后|开赛后/i.test(entry))
    )));
    assert(program.followUpActions.some((item) => (
      item.id === 'pool-money-features'
      && item.status === 'implemented'
      && item.automationPhase === 'Phase A/B'
    )));
    assert(program.followUpActions.some((item) => (
      item.id === 'benchmark-registry-refresh'
      && item.status === 'implemented'
    )));
    assert(program.followUpActions.some((item) => (
      item.id === 'speedpro-feature-importer'
      && item.status === 'partial'
      && item.sourceRefs.includes('tianxi-database')
      && item.sourceRefs.includes('hkjc-analytics')
      && item.evidence.some((entry) => /speedpro-feature-importer\.js/.test(entry))
      && item.remaining.some((entry) => /historical|历史|cohort|回补/i.test(entry))
    )));
    assert(program.followUpActions.some((item) => (
      item.id === 'no-bet-clv-gate'
      && item.status === 'partial'
      && item.remaining.some((entry) => /bootstrap|placebo|prospective/i.test(entry))
    )));
    assert(program.followUpActions.some((item) => (
      item.id === 'bayesian-tripwire'
      && item.status === 'implemented'
      && item.evidence.some((entry) => /uncertainty-tripwire\.js/.test(entry))
      && item.evidence.some((entry) => /high-disagreement|missing-market|normal-pass/i.test(entry))
    )));
    assert(program.followUpActions.some((item) => (
      item.id === 'lightgbm-no-market-benchmark'
      && item.status === 'implemented'
      && item.automationExecutable === false
    )));
    assert(program.followUpActions.every((item) => (
      Array.isArray(item.evidence)
      && item.evidence.length > 0
      && Array.isArray(item.remaining)
    )));
    assert(program.followUpActions.every((item) => (
      item.automationExecutable === true
      || ['research-only', 'implemented'].includes(item.status)
    )));
  });

  it('summarizes active, next, and research-only items for the dashboard', () => {
    const summary = summarizeResearchUpgradeProgram(buildResearchUpgradeProgram());

    assert.equal(summary.activeCount > 0, true);
    assert.equal(summary.nextCount > 0, true);
    assert.equal(summary.researchOnlyCount > 0, true);
    assert.equal(summary.followUpCount > 0, true);
    assert.equal(summary.implementedActionCount, 5);
    assert.equal(summary.partialActionCount, 2);
    assert.equal(summary.queuedActionCount, 0);
    assert.equal(summary.researchOnlyActionCount, 1);
    assert.equal(summary.automationReadyCount > 0, true);
    assert.equal(summary.externalBenchmarkCount >= 7, true);
    assert.equal(summary.reproducedBenchmarkCount, 2);
    assert.equal(summary.reproductionReadyCount >= 1, true);
    assert.equal(summary.dataLeverageCount >= 3, true);
    assert.equal(summary.blockedBenchmarkCount >= 1, true);
    assert.match(summary.tier1GapLabel, /落后|behind|tier1/i);
    assert.match(summary.nextBenchmarkAction, /catowabisabi|LightGBM|连赢/i);
    assert.match(summary.nextDataLeverageAction, /Tianxi|tianxi|数据|feature/i);
    assert.match(summary.headline, /研究驱动/);
    assert.match(summary.nextFocus, /市场赔率|校准|Kelly/);
    assert.match(summary.nextAction, /SpeedPRO|CLV|Bayesian/i);
  });

  it('attaches the research program to generated dashboard snapshots', () => {
    const snapshot = buildDashboardSnapshot([]);

    assert.equal(snapshot.research.version, 'research-led-v2');
    assert.equal(snapshot.research.summary.sourceCount >= 14, true);
    assert.equal(snapshot.research.summary.activeCount > 0, true);
    assert.equal(snapshot.research.summary.followUpCount > 0, true);
    assert.equal(snapshot.research.summary.externalBenchmarkCount >= 7, true);
  });
});
