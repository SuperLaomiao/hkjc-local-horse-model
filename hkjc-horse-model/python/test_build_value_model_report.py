import sys
import unittest
from pathlib import Path


PYTHON_DIR = Path(__file__).resolve().parent
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))

from build_value_model_report import build_value_model_report  # noqa: E402


class ValueModelPromotionReportTest(unittest.TestCase):
    def test_keeps_win_and_place_non_executable_without_prospective_market_evidence(self):
        report = build_value_model_report(**fixtures())

        self.assertEqual(report["promotion"]["WIN"]["status"], "NO_BET")
        self.assertEqual(report["promotion"]["PLACE"]["status"], "NO_BET")
        self.assertEqual(
            report["promotion"]["WIN"]["researchChampion"]["source"],
            "LightGBM",
        )
        self.assertEqual(
            report["promotion"]["PLACE"]["researchChampion"]["source"],
            "STACK",
        )
        self.assertIn(
            "prospective market sample unavailable",
            report["promotion"]["PLACE"]["reasons"],
        )
        self.assertFalse(report["promotion"]["PLACE"]["gates"]["prospectiveMarket"]["passed"])
        self.assertEqual(report["promotion"]["PLACE"]["strategyBaseline"]["bets"], 564)
        self.assertEqual(report["promotion"]["PLACE"]["strategyBaseline"]["maxDrawdown"], 774.8)

    def test_rejects_missing_holdout_drawdown_sample_calibration_or_lineage(self):
        mutations = (
            ("holdout", lambda data: data["stack_report"]["pools"]["PLACE"]["metrics"].pop("holdout")),
            ("maxDrawdown", lambda data: data["place_benchmarks"]["PLACE"].pop("maxDrawdown")),
            ("bets", lambda data: data["place_benchmarks"]["PLACE"].pop("bets")),
            ("calibration", lambda data: data["stack_report"]["pools"]["PLACE"]["selection"].pop("lightgbmCalibration")),
            ("lineage", lambda data: data["lightgbm_reports"]["WIN"].pop("lineage")),
        )

        for expected, mutate in mutations:
            with self.subTest(expected=expected):
                data = fixtures()
                mutate(data)
                with self.assertRaisesRegex(ValueError, expected):
                    build_value_model_report(**data)


def fixtures():
    return {
        "lightgbm_reports": {
            "WIN": model_report("lgb-win", "targetWin", 0.2520, 0.0691, 0.239),
            "PLACE": model_report("lgb-place", "targetPlace", 0.4935, 0.1617, 0.551),
        },
        "catboost_reports": {
            "WIN": model_report("cat-win", "targetWin", 0.2525, 0.0693, 0.236),
            "PLACE": model_report("cat-place", "targetPlace", 0.4924, 0.1613, 0.548),
        },
        "stack_report": {
            "version": "runner-probability-stack-v1",
            "selectionSplit": "validation",
            "holdoutUsedForSelection": False,
            "pools": {
                "WIN": stack_pool("targetWin", 0.2526, 0.0693, 0.230),
                "PLACE": stack_pool("targetPlace", 0.4917, 0.1611, 0.548),
            },
        },
        "place_benchmarks": {
            "WIN": benchmark(304, -0.1297, 780.7),
            "PLACE": benchmark(311, -0.1348, 774.8),
        },
        "market_coverage": {
            "summary": {"readiness": "partial-market-data"},
            "byWindow": {"T-30": {"racesWithOdds": 20}, "T-10": {"racesWithOdds": 10}},
            "byPool": {"WIN": {"racesWithOdds": 20}, "PLACE": {"racesWithOdds": 20}},
        },
    }


def model_report(model_id, target, log_loss, brier, hit_rate):
    return {
        "modelId": model_id,
        "target": target,
        "lineage": "selection-report",
        "probabilityPolicy": {"normalization": "target-aware"},
        "predictionArtifact": f"{model_id}.predictions.jsonl",
        "metrics": {
            "bySplit": {
                "holdout": metrics(log_loss, brier, hit_rate),
            },
        },
    }


def stack_pool(target, log_loss, brier, hit_rate):
    return {
        "target": target,
        "selection": {
            "selectedOn": "validation",
            "holdoutUsedForSelection": False,
            "lightgbmCalibration": "isotonic",
            "catboostCalibration": "isotonic",
            "blendWeightLightgbm": 0.25,
            "blendWeightCatboost": 0.75,
        },
        "metrics": {"holdout": metrics(log_loss, brier, hit_rate)},
    }


def metrics(log_loss, brier, hit_rate):
    return {
        "rows": 7014,
        "races": 564,
        "logLoss": log_loss,
        "brierScore": brier,
        "topPickHits": round(hit_rate * 564),
        "topPickHitRate": hit_rate,
        "isOutOfSample": True,
    }


def benchmark(hits, roi, drawdown):
    return {
        "strategy": "TOP_PICK_PLACE",
        "split": "holdout",
        "bets": 564,
        "hits": hits,
        "hitRate": hits / 564,
        "stake": 5640,
        "return": 5640 * (1 + roi),
        "profit": 5640 * roi,
        "roi": roi,
        "maxDrawdown": drawdown,
        "longestLosingRun": 7,
    }


if __name__ == "__main__":
    unittest.main()
