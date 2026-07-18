import sys
import unittest
from pathlib import Path


PYTHON_DIR = Path(__file__).resolve().parent
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))

from forecast_closing_price import build_closing_price_forecast  # noqa: E402


class ClosingPriceForecastTest(unittest.TestCase):
    def test_zero_trend_is_exactly_the_persistence_baseline_at_even_money(self):
        rows = [
            row("V1", "validation", 1, 1.2, 1.0, 1.0, 1),
            row("H1", "holdout", 1, 1.2, 1.0, 1.0, 1),
        ]
        dividends = {
            ("V1", "WIN", 1): 10.0,
            ("H1", "WIN", 1): 10.0,
        }

        report = build_closing_price_forecast(
            rows,
            dividends,
            pool="WIN",
            trend_alphas=(0.0,),
        )

        self.assertEqual(
            report["metrics"]["holdout"]["rmsle"],
            report["persistenceBaseline"]["holdout"]["rmsle"],
        )
        self.assertEqual(report["improvementVsPersistence"]["holdoutRmsleReduction"], 0.0)

    def test_selects_log_trend_on_validation_and_keeps_holdout_out_of_sample(self):
        rows = [
            row("V1", "validation", 1, 4.0, 3.0, 2.5, 1),
            row("V2", "validation", 1, 2.0, 3.0, 3.7, 1),
            row("H1", "holdout", 1, 4.0, 3.0, 2.6, 1),
        ]
        dividends = {
            ("V1", "WIN", 1): 25.0,
            ("V2", "WIN", 1): 37.0,
            ("H1", "WIN", 1): 26.0,
        }

        report = build_closing_price_forecast(
            rows,
            dividends,
            pool="WIN",
            trend_alphas=(0.0, 0.5),
        )

        self.assertEqual(report["selection"]["selectedOn"], "validation")
        self.assertFalse(report["selection"]["holdoutUsedForSelection"])
        self.assertEqual(report["selection"]["trendAlpha"], 0.5)
        self.assertTrue(report["metrics"]["holdout"]["isOutOfSample"])
        self.assertLess(
            report["metrics"]["holdout"]["rmsle"],
            report["persistenceBaseline"]["holdout"]["rmsle"],
        )
        self.assertEqual(report["officialDividendAudit"]["holdout"]["samples"], 1)
        self.assertEqual(report["cashMode"], "NO_BET")


def row(race_id, split, horse_no, t30, t10, t3, target):
    return {
        "raceId": race_id,
        "date": "2018-01-01",
        "split": split,
        "horseNo": horse_no,
        "marketWinOddsT30": t30,
        "marketWinOddsT10": t10,
        "marketWinOddsT3": t3,
        "marketPlaceOddsT30": t30,
        "marketPlaceOddsT10": t10,
        "marketPlaceOddsT3": t3,
        "targetWin": target,
        "targetPlace": target,
    }


if __name__ == "__main__":
    unittest.main()
