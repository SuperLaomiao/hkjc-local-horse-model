import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildMultiPlayProbabilityBoard,
  buildStructuredBetPortfolio,
} from '../multi-play-portfolio.js';
import { createRankingProbabilityModel } from '../ranking-probabilities.js';

describe('multi-play portfolio optimizer', () => {
  it('estimates probabilities and required dividends for the main HKJC pools', () => {
    const board = buildMultiPlayProbabilityBoard(entry([
      runner('A', 'Standout', 0.24, 6.2, 2.4),
      runner('B', 'Second', 0.15, 8.5, 2.8),
      runner('C', 'Third', 0.12, 11, 3.3),
      runner('D', 'Fourth', 0.1, 14, 4.2),
      runner('E', 'Fifth', 0.09, 16, 4.6),
      runner('F', 'Sixth', 0.08, 18, 5.1),
      runner('G', 'Seventh', 0.07, 22, 5.8),
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

  it('uses one Harville ranking model for place and exotic probabilities', () => {
    const race = entry([
      runner('A', 'Standout', 0.4, 6.2, 2.4),
      runner('B', 'Second', 0.3, 8.5, 2.8),
      runner('C', 'Third', 0.2, 11, 3.3),
      runner('D', 'Fourth', 0.1, 14, 4.2),
    ]);
    const board = buildMultiPlayProbabilityBoard(race);
    const model = createRankingProbabilityModel(race.forecast.predictions);

    const topPlace = board.candidates.find((candidate) => (
      candidate.type === 'PLACE' && candidate.selections[0].horseId === 'A'
    ));
    const topQpl = board.candidates.find((candidate) => (
      candidate.type === 'QUINELLA_PLACE'
      && candidate.selections.map((selection) => selection.horseId).join('+') === 'A+B'
    ));
    const topForecast = board.candidates.find((candidate) => (
      candidate.type === 'FORECAST'
      && candidate.selections.map((selection) => selection.horseId).join('+') === 'A+B'
    ));

    assert.equal(board.probabilityModel, 'harville-plackett-luce');
    assert.equal(round(topPlace.estimatedProbability), round(model.placeProbability('A', board.placeCutoff)));
    assert.equal(round(topQpl.estimatedProbability), round(model.unorderedTopKProbability(['A', 'B'], board.placeCutoff)));
    assert.equal(round(topForecast.estimatedProbability), round(model.orderedProbability(['A', 'B'])));
  });

  it('builds a structured cash portfolio that prefers place and supported combinations', () => {
    const portfolio = buildStructuredBetPortfolio(entry([
      runner('A', 'Standout', 0.24, 7.2, 2.6),
      runner('B', 'Second', 0.15, 8.5, 2.8),
      runner('C', 'Third', 0.12, 11, 3.3),
      runner('D', 'Fourth', 0.1, 14, 4.2),
      runner('E', 'Fifth', 0.09, 16, 4.6),
      runner('F', 'Sixth', 0.08, 18, 5.1),
      runner('G', 'Seventh', 0.07, 22, 5.8),
    ]), {
      qplDividendPer10: 58,
      quinellaDividendPer10: 130,
      maxBudget: 100,
    });

    assert(portfolio.totalStake <= 100);
    assert(portfolio.cashLines.length >= 3);
    assert(portfolio.cashLines.some((line) => line.type === 'PLACE' && line.selections[0].horseId === 'A'));
    assert(portfolio.cashLines.some((line) => line.type === 'PLACE' && line.selections[0].horseId === 'B'));
    assert(portfolio.cashLines.some((line) => line.type === 'QUINELLA_PLACE'));
    assert(portfolio.cashLines.some((line) => line.type === 'QUINELLA'));
    assert.equal(portfolio.paperLines.some((line) => line.type === 'TIERCE'), true);
    assert.match(portfolio.summary, /多玩法组合/);
  });

  it('keeps the cash portfolio from being fully dependent on the top horse', () => {
    const portfolio = buildStructuredBetPortfolio(entry([
      runner('A', 'Top Risk', 0.19, 7.2, 2.6),
      runner('B', 'Support One', 0.16, 8.5, 2.8),
      runner('C', 'Support Two', 0.15, 11, 3.3),
      runner('D', 'Fourth', 0.1, 14, 4.2),
    ]), {
      qplDividendPer10: 72,
      maxBudget: 100,
    });

    const totalTopExposure = portfolio.cashLines
      .filter((line) => line.selections.some((horse) => horse.horseId === 'A'))
      .reduce((sum, line) => sum + line.stake, 0);

    assert(portfolio.cashLines.some((line) => line.type === 'PLACE' && line.selections[0].horseId === 'B'));
    assert(portfolio.cashLines.some((line) => line.type === 'QUINELLA_PLACE' && line.selections.every((horse) => ['B', 'C'].includes(horse.horseId))));
    assert(totalTopExposure / portfolio.totalStake <= 0.6);
  });

  it('requires live market dividends to clear the target expected ROI before cash allocation', () => {
    const portfolio = buildStructuredBetPortfolio(entry([
      runner('A', 'Under Target Top Place', 0.24, 7.2, 1.5),
      runner('B', 'Positive EV Support', 0.15, 8.5, 2.8),
      runner('C', 'Third', 0.12, 11, 3.3),
      runner('D', 'Fourth', 0.1, 14, 4.2),
    ]), {
      edgeBuffer: 0.5,
      qplDividendPer10: 50,
      maxBudget: 100,
    });

    const underTargetPlace = portfolio.watchLines.find((line) => (
      line.type === 'PLACE' && line.selections[0].horseId === 'A'
    ));

    assert(underTargetPlace);
    assert(underTargetPlace.expectedRoi > 0);
    assert(underTargetPlace.expectedRoi < 0.5);
    assert.equal(underTargetPlace.status, 'WATCH');
    assert.equal(portfolio.cashLines.some((line) => line.candidateKey === underTargetPlace.key), false);
    assert(portfolio.cashLines.every((line) => line.expectedRoi == null || line.expectedRoi >= 0.5));
  });

  it('orders cash lines by expected ROI when live market dividends are available', () => {
    const portfolio = buildStructuredBetPortfolio(entry([
      runner('A', 'Standout', 0.24, 7.2, 2.6),
      runner('B', 'Second', 0.15, 8.5, 2.8),
      runner('C', 'Third', 0.12, 11, 3.3),
      runner('D', 'Fourth', 0.1, 14, 4.2),
    ]), {
      qplDividendPer10: 72,
      quinellaDividendPer10: 220,
      maxBudget: 100,
    });

    const expectedRois = portfolio.cashLines
      .map((line) => line.expectedRoi)
      .filter(Number.isFinite);

    assert(expectedRois.length >= 3);
    assert.deepEqual(expectedRois, [...expectedRois].sort((a, b) => b - a));
  });

  it('uses official dividends from settled entries as market prices for EV replay', () => {
    const portfolio = buildStructuredBetPortfolio(entry([
      runner('A', 'Standout', 0.24, 7.2, null),
      runner('B', 'Second', 0.15, 8.5, null),
      runner('C', 'Third', 0.12, 11, null),
      runner('D', 'Fourth', 0.1, 14, null),
    ], {
      settlement: {
        dividends: {
          place: [
            { pool: 'PLACE', combination: [1], dividendPer10: 31 },
            { pool: 'PLACE', combination: [2], dividendPer10: 19 },
          ],
          quinellaPlace: [
            { pool: 'QUINELLA PLACE', combination: [1, 2], dividendPer10: 86 },
          ],
          quinella: [
            { pool: 'QUINELLA', combination: [1, 2], dividendPer10: 220 },
          ],
        },
      },
    }));

    const topPlace = portfolio.board.candidates.find((candidate) => (
      candidate.type === 'PLACE' && candidate.selections[0].horseId === 'A'
    ));
    const topQpl = portfolio.board.candidates.find((candidate) => (
      candidate.type === 'QUINELLA_PLACE'
      && candidate.selections.map((horse) => horse.horseId).join('+') === 'A+B'
    ));

    assert.equal(topPlace.marketDividendPer10, 31);
    assert.equal(topQpl.marketDividendPer10, 86);
    assert(Number.isFinite(topPlace.expectedRoi));
    assert(Number.isFinite(topQpl.expectedRoi));
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
      runner('D', 'Fourth', 0.1, 15, 4.2),
    ]));

    assert.equal(portfolio.cashLines.some((line) => line.type === 'WIN'), false);
    assert.equal(portfolio.cashLines.some((line) => line.type === 'PLACE'), true);
    assert(portfolio.watchLines.some((line) => line.type === 'WIN'));
  });
});

function entry(predictions, overrides = {}) {
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
    ...overrides,
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

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
