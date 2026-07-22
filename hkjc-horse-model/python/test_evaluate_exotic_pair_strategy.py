import sys
import unittest
from pathlib import Path


PYTHON_DIR = Path(__file__).resolve().parent
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))

from evaluate_exotic_pair_strategy import evaluate_pair_strategies  # noqa: E402


class ExoticPairStrategyTest(unittest.TestCase):
    def test_settles_one_top_pair_per_race_for_model_market_and_selected_stack(self):
        report = evaluate_pair_strategies(
            _prediction_rows(),
            {
                ("V1", "quinella"): {(1, 2): 25.0},
                ("V2", "quinella"): {(2, 3): 30.0},
                ("H1", "quinella"): {(1, 2): 20.0},
            },
            pool="quinella",
            combination_book_coverage=_ready_coverage("quinella"),
        )

        selected_validation = report["metricsBySplit"]["validation"]["selectedStack"]
        selected_holdout = report["metricsBySplit"]["holdout"]["selectedStack"]
        self.assertEqual(selected_validation["racesEligible"], 2)
        self.assertEqual(selected_validation["bets"], 2)
        self.assertEqual(selected_validation["hits"], 1)
        self.assertEqual(selected_validation["stake"], 20.0)
        self.assertEqual(selected_validation["returns"], 25.0)
        self.assertEqual(selected_validation["profit"], 5.0)
        self.assertEqual(selected_validation["ROI"], 0.25)
        self.assertEqual(selected_validation["maxDrawdown"], 10.0)
        self.assertEqual(selected_holdout["hits"], 1)
        self.assertEqual(selected_holdout["ROI"], 1.0)
        self.assertTrue(selected_holdout["isOutOfSample"])
        self.assertEqual(report["cashMode"], "NO_BET")
        self.assertEqual(report["valueStatus"], "RESEARCH_ONLY")
        self.assertEqual(report["combinationBookGate"]["status"], "READY")

    def test_missing_official_pool_is_ineligible_instead_of_a_loss(self):
        rows = _prediction_rows()[:3]
        report = evaluate_pair_strategies(
            rows,
            {},
            pool="quinella",
            combination_book_coverage=_ready_coverage("quinella"),
        )

        metrics = report["metricsBySplit"]["validation"]["selectedStack"]
        self.assertEqual(metrics["racesTotal"], 1)
        self.assertEqual(metrics["racesEligible"], 0)
        self.assertEqual(metrics["bets"], 0)
        self.assertEqual(metrics["stake"], 0.0)
        self.assertIsNone(metrics["ROI"])

    def test_blocks_research_promotion_when_verified_t_window_books_are_missing(self):
        report = evaluate_pair_strategies(
            _prediction_rows(),
            {( "V1", "quinella"): {(1, 2): 25.0}},
            pool="quinella",
            combination_book_coverage=[
                {
                    "poolKey": "quinella",
                    "window": "T-30",
                    "eligibleRaces": 120,
                    "racesWithVerifiedBook": 100,
                    "verified": True,
                },
                {
                    "poolKey": "quinella",
                    "window": "T-10",
                    "eligibleRaces": 120,
                    "racesWithVerifiedBook": 100,
                    "verified": True,
                },
            ],
        )

        self.assertEqual(report["state"], "BLOCKED_DATA")
        self.assertEqual(report["cashMode"], "NO_BET")
        self.assertEqual(report["executionStatus"], "PAPER_ONLY")
        self.assertTrue(any(
            deficit["window"] == "T-3"
            for deficit in report["combinationBookGate"]["deficits"]
        ))
        self.assertEqual(report["combinationBookGate"]["roiReadBeforeGate"], False)

        missing = evaluate_pair_strategies(
            _prediction_rows(),
            {},
            pool="quinella",
        )
        self.assertEqual(missing["state"], "BLOCKED_DATA")
        self.assertEqual(len(missing["combinationBookGate"]["deficits"]), 3)


def _prediction_rows():
    rows = []
    definitions = (
        ("V1", "validation", "2026-01-01", {
            "1-2": (0.8, 0.7, 0.75), "1-3": (0.1, 0.2, 0.15), "2-3": (0.1, 0.1, 0.1),
        }),
        ("V2", "validation", "2026-01-08", {
            "1-2": (0.8, 0.1, 0.7), "1-3": (0.1, 0.2, 0.15), "2-3": (0.1, 0.7, 0.15),
        }),
        ("H1", "holdout", "2026-02-01", {
            "1-2": (0.8, 0.7, 0.75), "1-3": (0.1, 0.2, 0.15), "2-3": (0.1, 0.1, 0.1),
        }),
    )
    for race_id, split, date, pairs in definitions:
        for pair_key, probabilities in pairs.items():
            left, right = pair_key.split("-")
            rows.append({
                "raceId": race_id,
                "date": date,
                "split": split,
                "poolKey": "quinella",
                "pairKey": pair_key,
                "horseNoA": int(left),
                "horseNoB": int(right),
                "targetPair": int(pair_key == "1-2"),
                "modelProbability": probabilities[0],
                "marketBaselineProbability": probabilities[1],
                "selectedProbability": probabilities[2],
            })
    return rows


def _ready_coverage(pool):
    return [
        {
            "poolKey": pool,
            "window": window,
            "eligibleRaces": 120,
            "racesWithVerifiedBook": 100,
            "verified": True,
        }
        for window in ("T-30", "T-10", "T-3")
    ]


if __name__ == "__main__":
    unittest.main()
