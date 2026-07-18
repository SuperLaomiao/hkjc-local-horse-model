import sys
import unittest
from pathlib import Path


PYTHON_DIR = Path(__file__).resolve().parent
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))

from benchmark_place_strategy import benchmark_top_pick_place  # noqa: E402


class TopPickPlaceBenchmarkTest(unittest.TestCase):
    @staticmethod
    def _predictions():
        return [
            {
                "raceId": "2026-01-01-ST-1", "date": "2026-01-01",
                "split": "holdout", "horseNo": 1, "probability": 0.7,
                "targetPlace": 1,
            },
            {
                "raceId": "2026-01-01-ST-1", "date": "2026-01-01",
                "split": "holdout", "horseNo": 2, "probability": 0.3,
                "targetPlace": 0,
            },
            {
                "raceId": "2026-02-01-ST-2", "date": "2026-02-01",
                "split": "holdout", "horseNo": 3, "probability": 0.8,
                "targetPlace": 0,
            },
            {
                "raceId": "2026-02-01-ST-2", "date": "2026-02-01",
                "split": "holdout", "horseNo": 4, "probability": 0.2,
                "targetPlace": 1,
            },
        ]

    @staticmethod
    def _races():
        return [
            {
                "raceId": "2026-01-01-ST-1",
                "date": "2026-01-01",
                "dividends": {
                    "place": [
                        {"pool": "PLACE", "combination": [1], "dividendPer10": 18.5},
                        {"pool": "PLACE", "combination": [2], "dividendPer10": 12.0},
                    ],
                },
            },
            {
                "raceId": "2026-02-01-ST-2",
                "date": "2026-02-01",
                "dividends": {
                    "place": [
                        {"pool": "PLACE", "combination": [4], "dividendPer10": 20.0},
                    ],
                },
            },
        ]

    def test_settles_one_hit_and_one_miss_with_strict_place_dividend(self):
        report = benchmark_top_pick_place(
            self._predictions(),
            self._races(),
            split="holdout",
            stake_per_bet=10,
        )

        self.assertEqual(report["bets"], 2)
        self.assertEqual(report["hits"], 1)
        self.assertEqual(report["stake"], 20)
        self.assertEqual(report["return"], 18.5)
        self.assertEqual(report["profit"], -1.5)
        self.assertAlmostEqual(report["roi"], -0.075)
        self.assertEqual(report["averageWinningDividendPer10"], 18.5)
        self.assertEqual(report["breakEvenDividendPer10"], 20.0)
        self.assertEqual(report["maxDrawdown"], 10.0)
        self.assertEqual(report["longestLosingRun"], 1)
        self.assertEqual([row["month"] for row in report["monthly"]], ["2026-01", "2026-02"])

    def test_missing_official_dividend_for_hit_fails_closed(self):
        races = self._races()
        races[0]["dividends"]["place"] = []

        with self.assertRaisesRegex(ValueError, "missing official PLACE dividend"):
            benchmark_top_pick_place(
                self._predictions(),
                races,
                split="holdout",
                stake_per_bet=10,
            )


if __name__ == "__main__":
    unittest.main()
