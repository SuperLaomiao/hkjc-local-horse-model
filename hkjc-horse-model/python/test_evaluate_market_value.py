import sys
import unittest
from pathlib import Path


PYTHON_DIR = Path(__file__).resolve().parent
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))

from evaluate_market_value import build_market_value_report  # noqa: E402


class MarketValueEvaluationTest(unittest.TestCase):
    def test_selects_threshold_on_validation_and_applies_it_unchanged_to_holdout(self):
        predictions = []
        matrix_rows = []
        dividends = {}
        race_specs = (
            ("V1", "validation", ((1, 0.60, 2.0, 1), (2, 0.40, 2.0, 0))),
            ("V2", "validation", ((1, 0.60, 1.5, 0), (2, 0.40, 4.0, 1))),
            ("H1", "holdout", ((1, 0.55, 3.0, 1), (2, 0.45, 2.0, 0))),
        )
        for race_id, split, runners in race_specs:
            for horse_no, probability, odds, target in runners:
                predictions.append(prediction(race_id, split, horse_no, probability, target))
                matrix_rows.append(matrix_row(race_id, split, horse_no, odds, target))
                if target:
                    dividends[(race_id, "WIN", horse_no)] = odds * 10

        report = build_market_value_report(
            predictions,
            matrix_rows,
            dividends,
            pool="WIN",
            ev_thresholds=(0.0, 0.5),
            probability_gap_thresholds=(0.0,),
            min_validation_bets=1,
        )

        self.assertEqual(report["selection"]["selectedOn"], "validation")
        self.assertFalse(report["selection"]["holdoutUsedForSelection"])
        self.assertEqual(report["selection"]["minimumEv"], 0.5)
        self.assertEqual(report["metrics"]["validation"]["bets"], 1)
        self.assertEqual(report["metrics"]["holdout"]["bets"], 1)
        self.assertEqual(report["metrics"]["holdout"]["hits"], 1)
        self.assertEqual(report["metrics"]["holdout"]["largestReturnShare"], 1.0)
        self.assertEqual(report["metrics"]["holdout"]["maxConsecutiveLosses"], 0)
        self.assertIn("2018-01", report["metrics"]["holdout"]["byMonth"])
        self.assertTrue(report["metrics"]["holdout"]["isOutOfSample"])
        self.assertEqual(report["cashMode"], "NO_BET")

    def test_caps_each_race_at_one_bet_and_fails_closed_on_missing_winner_dividend(self):
        predictions = [
            prediction("V1", "validation", 1, 0.60, 1, target_name="targetPlace"),
            prediction("V1", "validation", 2, 0.55, 0, target_name="targetPlace"),
            prediction("H1", "holdout", 1, 0.60, 1, target_name="targetPlace"),
            prediction("H1", "holdout", 2, 0.55, 0, target_name="targetPlace"),
        ]
        matrix_rows = [
            matrix_row("V1", "validation", 1, 4.0, 1),
            matrix_row("V1", "validation", 2, 3.0, 0),
            matrix_row("H1", "holdout", 1, 4.0, 1),
            matrix_row("H1", "holdout", 2, 3.0, 0),
        ]
        dividends = {("V1", "PLACE", 1): 30.0}

        report = build_market_value_report(
            predictions,
            matrix_rows,
            dividends,
            pool="PLACE",
            ev_thresholds=(0.0,),
            probability_gap_thresholds=(0.0,),
            min_validation_bets=1,
        )

        self.assertEqual(report["metrics"]["validation"]["bets"], 1)
        self.assertEqual(report["metrics"]["holdout"]["bets"], 0)
        self.assertEqual(report["metrics"]["holdout"]["excludedMissingSettlement"], 1)


def prediction(race_id, split, horse_no, probability, target, target_name="targetWin"):
    return {
        "modelId": "candidate-v1",
        "target": target_name,
        "raceId": race_id,
        "date": "2018-01-01",
        "split": split,
        "horseNo": horse_no,
        "probability": probability,
        "targetWin": target,
        "targetPlace": target,
    }


def matrix_row(race_id, split, horse_no, odds, target):
    return {
        "raceId": race_id,
        "split": split,
        "horseNo": horse_no,
        "marketWinOddsT10": odds,
        "marketPlaceOddsT10": odds,
        "targetWin": target,
        "targetPlace": target,
    }


if __name__ == "__main__":
    unittest.main()
