import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildTianxiFormFeatures,
  normalizeTianxiHorseCode,
} from '../src/tianxi-form-features.js';

describe('Tianxi as-of form features', () => {
  it('normalizes direct and HKJC-prefixed horse ids', () => {
    assert.equal(normalizeTianxiHorseCode('K390'), 'K390');
    assert.equal(normalizeTianxiHorseCode('HK_2023_K390'), 'K390');
    assert.equal(normalizeTianxiHorseCode('hk_2002_c015'), 'C015');
    assert.equal(normalizeTianxiHorseCode(null), null);
    assert.equal(normalizeTianxiHorseCode('Horse name only'), null);
  });

  it('excludes target-race and future rows using a conservative one-day lag', () => {
    const result = buildTianxiFormFeatures({
      horseCode: 'K390',
      targetDate: '2026-07-15',
      targetDistance: 1200,
      availabilityLagDays: 1,
      rows: [
        formRow('15/07/26', 1, 51, 1200, 2.1, 0),
        formRow('16/07/26', 2, 52, 1200, 3.2, 1),
        formRow('14/07/26', 1, 50, 1200, 4, 0),
        formRow('01/07/26', 4, 48, 1400, 8, 3),
        formRow('15/06/26', 2, 45, 1200, 5, 1),
        { ...formRow('not-a-date', 1, 99, 1200, 1.1, 0) },
      ],
    });

    assert.equal(result.audit.inputRows, 6);
    assert.equal(result.audit.eligibleRows, 3);
    assert.equal(result.audit.excludedNotAvailableRows, 2);
    assert.equal(result.audit.invalidDateRows, 1);
    assert.equal(result.features.tianxiFormAvailable, 1);
    assert.equal(result.features.tianxiPriorStarts, 3);
    assert.equal(result.features.tianxiPriorWins, 1);
    assert.equal(result.features.tianxiPriorPlaces, 2);
    assert.equal(result.features.tianxiPriorWinRate, 0.3333);
    assert.equal(result.features.tianxiPriorPlaceRate, 0.6667);
    assert.equal(result.features.tianxiDaysSinceLastRun, 1);
    assert.equal(result.features.tianxiLatestRating, 50);
    assert.equal(result.features.tianxiRatingTrend3, 5);
    assert.equal(result.features.tianxiRecentAverageLbw3, 1.3333);
    assert.equal(result.features.tianxiRecentAverageWinOdds5, 5.6667);
    assert.equal(result.features.tianxiSameDistanceStarts, 2);
    assert.equal(result.features.tianxiSameDistanceWinRate, 0.5);
  });

  it('returns explicit missingness features when no source rows are eligible', () => {
    const result = buildTianxiFormFeatures({
      horseCode: 'K390',
      targetDate: '2026-07-15',
      targetDistance: 1200,
      rows: [formRow('15/07/26', 1, 51, 1200, 2.1, 0)],
    });

    assert.equal(result.features.tianxiFormAvailable, 0);
    assert.equal(result.features.tianxiPriorStarts, 0);
    assert.equal(result.features.tianxiPriorWinRate, 0);
    assert.equal(result.features.tianxiLatestRating, null);
    assert.equal(result.features.tianxiDaysSinceLastRun, null);
  });
});

function formRow(date, place, rating, distance, winOdds, lbw) {
  return {
    horse_no: 'K390',
    date,
    place: String(place),
    rating: String(rating),
    distance_m: String(distance),
    win_odds: String(winOdds),
    lbw: String(lbw),
  };
}
