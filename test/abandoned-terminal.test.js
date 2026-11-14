import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCockpitViewModel, buildTerminalRaceNotices } from '../dashboard-cockpit.js';
import { buildBettingAvailability } from '../dashboard-layout.js';
import { isLiveMarketEligible } from '../live-market-browser.js';
import { buildStructuredBetPortfolio } from '../multi-play-portfolio.js';
import { buildPublicPortfolioOptions } from '../public-dashboard-mode.js';
import { buildMeetingCountdown } from '../meeting-countdown.js';
import { abandonedRace } from '../hkjc-horse-model/test/abandoned-fixtures.js';

describe('abandoned race public presentation', () => {
  it('shows an official cancellation/refund notice, with no forecast or private content', () => {
    const notices = buildTerminalRaceNotices({ terminalEntries: [abandonedRace()] });
    assert.equal(notices.length, 1);
    assert.match(notices[0].label, /沙田 R6 · 已取消/);
    assert.match(notices[0].detail, /退款.*HK\$0.*不下注/);
    assert.match(notices[0].sourceUrl, /^https:\/\/racing\.hkjc\.com\//);
  });

  it('fails closed for an abandoned race even with stale playable forecasts and cash lines', () => {
    const entry = { ...abandonedRace(), startTime: '15:25', forecast: { predictions: [{ probability: 0.9, horseId: 'H1', horseNo: 1 }] } };
    const view = buildCockpitViewModel({ entry, availability: { canBetNow: true }, executionPolicy: { allowExecutableRecommendations: true }, portfolio: { cashLines: [{ stake: 100 }] } });
    assert.equal(view.state, 'ABANDONED'); assert.equal(view.canExecute, false);
    assert.equal(view.totalStake, 0); assert.deepEqual(view.lines, []);
    assert.match(view.headline, /已取消.*不下注/);
    assert.equal(buildBettingAvailability({ entry, today: '2026-11-14' }).canBetNow, false);
    assert.equal(isLiveMarketEligible(entry, '2026-11-14'), false);
    const portfolio = buildStructuredBetPortfolio(entry, { probabilityStatus: 'CALIBRATED', maxBudget: 100 });
    assert.equal(portfolio.mode, 'PASS'); assert.equal(portfolio.totalStake, 0);
    assert.deepEqual(portfolio.watchLines, []); assert.deepEqual(portfolio.cashLines, []);
    assert.equal(buildPublicPortfolioOptions({}, entry).maxBudget, 0);
    assert.equal(buildMeetingCountdown({ upcomingEntries: [entry], now: new Date('2026-11-14T06:00:00Z') }).nextRace, null);
  });

  it('does not present older cancellation notices as the newest meeting', () => {
    assert.deepEqual(buildTerminalRaceNotices({ terminalEntries: [abandonedRace()], latestSettlement: { date: '2026-11-18' } }), []);
  });
});
