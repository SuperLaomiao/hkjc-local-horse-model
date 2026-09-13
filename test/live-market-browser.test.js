import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  fetchLiveRaceOdds,
  HKJC_BROWSER_ODDS_QUERY,
  quoteForSelection,
  withLiveOdds,
} from '../live-market-browser.js';
import { HKJC_HORSE_ODDS_QUERY } from '../hkjc-horse-model/src/live-market-snapshot.js';

const NOW = new Date('2026-09-13T02:46:00.000Z');
const updatedAt = '2026-09-13T10:45:00+08:00';

function payload({ lastUpdateTime = updatedAt, sellStatus = 'START_SELL', raceNo = 2 } = {}) {
  return { data: { raceMeetings: [{ pmPools: [
    { oddsType: 'WIN', leg: { races: [raceNo] }, lastUpdateTime, sellStatus, oddsNodes: [
      { combString: '08', oddsValue: '4.8' },
    ] },
    { oddsType: 'PLA', leg: { races: [raceNo] }, lastUpdateTime, sellStatus, oddsNodes: [
      { combString: '8', oddsValue: '1.7' },
    ] },
    { oddsType: 'QPL', leg: { races: [raceNo] }, lastUpdateTime, sellStatus, oddsNodes: [
      { combString: '8,2', oddsValue: '3.5' },
    ] },
  ] }] } };
}

describe('browser live HKJC odds', () => {
  it('keeps the browser query identical to the collector-approved HKJC query', () => {
    assert.equal(HKJC_BROWSER_ODDS_QUERY.trim(), HKJC_HORSE_ODDS_QUERY.trim());
  });

  it('fetches only the selected race using the official read-only query', async () => {
    let request;
    const market = await fetchLiveRaceOdds({
      date: '2026-09-13', venueCode: 'ST', raceNo: 2, now: NOW,
      fetchImpl: async (url, options) => {
        request = { url, options };
        return { ok: true, json: async () => payload() };
      },
    });
    assert.equal(request.url, 'https://info.cld.hkjc.com/graphql/base/');
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.credentials, 'omit');
    assert.equal(request.options.cache, 'no-store');
    assert.deepEqual(JSON.parse(request.options.body).variables, {
      date: '2026-09-13', venueCode: 'ST', oddsTypes: ['WIN', 'PLA', 'QIN', 'QPL'], raceNo: 2,
    });
    assert.equal(market.raceId, '2026-09-13-ST-2');
    assert.equal(quoteForSelection(market, 'WIN', [{ horseNo: 8 }], NOW)?.oddsValue, 4.8);
    assert.equal(quoteForSelection(market, 'PLACE', [{ horseNo: 8 }], NOW)?.oddsValue, 1.7);
    assert.equal(quoteForSelection(market, 'QUINELLA_PLACE', [{ horseNo: 2 }, { horseNo: 8 }], NOW)?.oddsValue, 3.5);
  });

  it('rejects wrong-race, stale, future, and non-selling quotes', async () => {
    const wrong = await fetchLiveRaceOdds({
      date: '2026-09-13', venueCode: 'ST', raceNo: 2, now: NOW,
      fetchImpl: async () => ({ ok: true, json: async () => payload({ raceNo: 3 }) }),
    });
    assert.equal(quoteForSelection(wrong, 'WIN', [8], NOW), null);
    const stale = await fetchLiveRaceOdds({
      date: '2026-09-13', venueCode: 'ST', raceNo: 2, now: NOW,
      fetchImpl: async () => ({ ok: true, json: async () => payload({ lastUpdateTime: '2026-09-13T10:20:00+08:00' }) }),
    });
    assert.equal(quoteForSelection(stale, 'WIN', [8], NOW)?.status, 'STALE');
    const closed = await fetchLiveRaceOdds({
      date: '2026-09-13', venueCode: 'ST', raceNo: 2, now: NOW,
      fetchImpl: async () => ({ ok: true, json: async () => payload({ sellStatus: 'STOP_SELL' }) }),
    });
    assert.equal(quoteForSelection(closed, 'WIN', [8], NOW)?.status, 'CLOSED');
    const future = await fetchLiveRaceOdds({
      date: '2026-09-13', venueCode: 'ST', raceNo: 2, now: NOW,
      fetchImpl: async () => ({ ok: true, json: async () => payload({ lastUpdateTime: '2026-09-13T10:50:00+08:00' }) }),
    });
    assert.equal(quoteForSelection(future, 'WIN', [8], NOW)?.status, 'FUTURE');
  });

  it('copies fresh WIN/PLACE prices into the selected forecast without retaining old prices', async () => {
    const entry = {
      raceId: '2026-09-13-ST-2', forecast: { predictions: [{ horseNo: 8, winOdds: 99 }, { horseNo: 5, winOdds: 77 }] },
    };
    const market = await fetchLiveRaceOdds({
      date: '2026-09-13', venueCode: 'ST', raceNo: 2, now: NOW,
      fetchImpl: async () => ({ ok: true, json: async () => payload() }),
    });
    const live = withLiveOdds(entry, market, NOW);
    assert.equal(live.evaluatedAt, NOW.toISOString());
    assert.equal(live.forecast.predictions[0].winOdds, 4.8);
    assert.equal(live.forecast.predictions[0].placeOdds, 1.7);
    assert.equal(live.forecast.predictions[1].winOdds, null);
    assert.equal(entry.forecast.predictions[0].winOdds, 99);
    assert.equal(withLiveOdds(entry, null, NOW).forecast.predictions[0].winOdds, null);
  });
});
