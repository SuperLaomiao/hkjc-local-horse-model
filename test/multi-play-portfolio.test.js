import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildMultiPlayProbabilityBoard,
  buildStructuredBetPortfolio,
} from '../multi-play-portfolio.js';

describe('multi-play portfolio optimizer', () => {
  it('estimates probabilities and required dividends for the main HKJC pools', () => {
    const board = buildMultiPlayProbabilityBoard(entry([
      runner('A', 'Standout', 0.24, 6.2, 2.4),
      runner('B', 'Second', 0.15, 8.5, 2.8),
      runner('C', 'Third', 0.12, 11, 3.3),
      runner('D', 'Fourth', 0.1, 14, 4.2),
    ]));

    const byType = Object.fromEntries(board.candidates.map((candidate) => [candidate.type, candidate]));

    assert(byType.WIN);
    assert(byType.PLACE);
    assert(byType.QUINELLA_PLACE);
    assert(byType.QUINELLA);
    assert(byType.FORECAST);
    assert(byType.TRIO);

    assert(byType.PLACE.estimatedProbability > byType.WIN.estimatedProbability);
    assert(byType.QUINELLA_PLACE.estimatedProbability > byType.QUINELLA.estimatedProbability);
    assert(byType.PLACE.requiredDividendPer10 > 10);
    assert.equal(byType.FORECAST.cashEligible, false);
    assert.equal(byType.TRIO.role, 'paper');
  });

  it('builds a structured cash portfolio that prefers place and supported combinations', () => {
    const portfolio = buildStructuredBetPortfolio(entry([
      runner('A', 'Standout', 0.24, 7.2, 2.6),
      runner('B', 'Second', 0.15, 8.5, 2.8),
      runner('C', 'Third', 0.12, 11, 3.3),
      runner('D', 'Fourth', 0.1, 14, 4.2),
    ]), {
      qplDividendPer10: 58,
      quinellaDividendPer10: 130,
      maxBudget: 100,
    });

    assert(portfolio.totalStake <= 100);
    assert(portfolio.cashLines.length >= 3);
    assert.deepEqual(portfolio.cashLines.map((line) => line.type), [
      'PLACE',
      'WIN',
      'QUINELLA_PLACE',
      'QUINELLA',
    ]);
    assert.equal(portfolio.paperLines.some((line) => line.type === 'TIERCE'), true);
    assert.match(portfolio.summary, /多玩法组合/);
  });

  it('does not force a cash bet when the race has no usable signal', () => {
    const portfolio = buildStructuredBetPortfolio(entry([
      runner('A', 'Thin Top', 0.105, 10, 2.8),
      runner('B', 'Flat Second', 0.095, 11, 3.1),
      runner('C', 'Flat Third', 0.09, 12, 3.5),
    ]));

    assert.equal(portfolio.mode, 'PASS');
    assert.equal(portfolio.totalStake, 0);
    assert.deepEqual(portfolio.cashLines, []);
  });

  it('uses market odds to reject an underpriced win line and keep the safer place line', () => {
    const portfolio = buildStructuredBetPortfolio(entry([
      runner('A', 'Underpriced Favourite', 0.2, 4.0, 2.4),
      runner('B', 'Second', 0.14, 9, 3.1),
      runner('C', 'Third', 0.11, 13, 3.8),
    ]));

    assert.equal(portfolio.cashLines.some((line) => line.type === 'WIN'), false);
    assert.equal(portfolio.cashLines.some((line) => line.type === 'PLACE'), true);
    assert(portfolio.watchLines.some((line) => line.type === 'WIN'));
  });
});

function entry(predictions) {
  return {
    raceId: '2026-07-04-ST-1',
    date: '2026-07-04',
    racecourse: 'ST',
    raceNo: 1,
    forecast: {
      predictions,
      topPick: predictions[0],
      recommendation: { action: 'probability', horseId: predictions[0].horseId },
    },
  };
}

function runner(horseId, horseName, probability, winOdds, placeOdds) {
  return {
    horseId,
    horseNo: Number(horseId.charCodeAt(0) - 64),
    horseName,
    probability,
    fairOdds: probability > 0 ? 1 / probability : null,
    winOdds,
    placeOdds,
  };
}
