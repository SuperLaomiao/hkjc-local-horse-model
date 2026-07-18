import sys
import unittest
from pathlib import Path


PYTHON_DIR = Path(__file__).resolve().parent
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))

from build_market_aware_comparison import build_market_aware_comparison  # noqa: E402


class MarketAwareComparisonTest(unittest.TestCase):
    def test_promotes_prediction_research_champion_but_rejects_unstable_roi(self):
        reports = [
            model_report("lightgbm-no-market-v1", "no-market", "targetWin", 0.27, 0.074, 0.20),
            model_report("catboost-market-aware-t10-v1", "market-aware-t10", "targetWin", 0.24, 0.068, 0.30),
            model_report("lightgbm-no-market-v1", "no-market", "targetPlace", 0.53, 0.175, 0.46),
            model_report("catboost-market-aware-t10-v1", "market-aware-t10", "targetPlace", 0.48, 0.159, 0.57),
        ]
        value_reports = [
            value_report(
                "lightgbm-no-market-v1",
                "WIN",
                validation_roi=0.16,
                holdout_roi=0.26,
                largest_return_share=0.34,
            ),
            value_report(
                "catboost-market-aware-t10-v1",
                "PLACE",
                validation_roi=-0.10,
                holdout_roi=-0.20,
                largest_return_share=0.10,
            ),
        ]

        report = build_market_aware_comparison(
            gate_report=gate_report(),
            model_reports=reports,
            stack_reports={},
            value_reports=value_reports,
        )

        self.assertEqual(
            report["pools"]["WIN"]["researchChampion"]["modelId"],
            "catboost-market-aware-t10-v1",
        )
        self.assertGreater(report["pools"]["WIN"]["marketLift"]["logLossReduction"], 0)
        self.assertEqual(report["valueGate"]["status"], "NO_GO")
        self.assertIn(
            "profit concentration",
            " ".join(report["valueGate"]["candidates"][0]["reasons"]),
        )
        self.assertEqual(report["cashMode"], "NO_BET")
        self.assertEqual(report["prospectivePromotion"]["status"], "BLOCKED_DATA")


def gate_report():
    return {
        "status": "READY_RESEARCH",
        "trainingAllowed": True,
        "cashMode": "NO_BET",
        "decisionWindow": "T-10",
        "cohort": {"races": 1460},
        "splits": {
            "train": {"candidateRaces": 1008},
            "validation": {"candidateRaces": 222},
            "holdout": {"candidateRaces": 230},
        },
        "prospectivePromotion": {
            "status": "BLOCKED_DATA",
            "cashMode": "NO_BET",
            "reason": "requires locked 2026 evidence",
        },
    }


def model_report(model_id, mode, target, log_loss, brier, hit_rate):
    return {
        "modelId": model_id,
        "mode": mode,
        "target": target,
        "lineage": "selection",
        "metrics": {
            "bySplit": {
                "holdout": {
                    "rows": 2747,
                    "races": 230,
                    "logLoss": log_loss,
                    "brierScore": brier,
                    "topPickHitRate": hit_rate,
                    "isOutOfSample": True,
                },
            },
        },
    }


def value_report(model_id, pool, validation_roi, holdout_roi, largest_return_share):
    def metrics(roi):
        return {
            "bets": 150,
            "stake": 1500,
            "return": 1500 * (1 + roi),
            "profit": 1500 * roi,
            "roi": roi,
            "maxDrawdown": 500,
            "largestReturnShare": largest_return_share,
            "byMonth": {
                "2018-01": {"roi": 0.1},
                "2018-02": {"roi": -0.1},
            },
        }

    return {
        "status": "READY_RESEARCH",
        "cashMode": "NO_BET",
        "pool": pool,
        "modelId": model_id,
        "selection": {"selectedOn": "validation", "holdoutUsedForSelection": False},
        "metrics": {
            "validation": metrics(validation_roi),
            "holdout": {**metrics(holdout_roi), "isOutOfSample": True},
        },
    }


if __name__ == "__main__":
    unittest.main()
