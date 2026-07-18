import sys
import unittest
from pathlib import Path


PYTHON_DIR = Path(__file__).resolve().parent
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))

from build_exotic_pool_promotion import build_exotic_pool_promotion  # noqa: E402


class ExoticPoolPromotionTest(unittest.TestCase):
    def test_retrospective_pass_only_promotes_paper_research_without_prospective_locks(self):
        report = build_exotic_pool_promotion(
            _model_report(research_status="RESEARCH_CHAMPION"),
            _strategy_report(validation_roi=0.02, holdout_roi=0.01),
            prospective={"eligibleLockedLines": 0},
        )

        self.assertEqual(report["researchStatus"], "READY_PAPER")
        self.assertEqual(report["cashMode"], "NO_BET")
        self.assertEqual(report["prospectiveStatus"], "BLOCKED_DATA")
        self.assertIn("prospectiveLockedLines", report["cashFailedGates"])
        self.assertEqual(report["retrospectiveFailedGates"], [])

    def test_probability_or_holdout_roi_failure_keeps_pool_no_go(self):
        report = build_exotic_pool_promotion(
            _model_report(research_status="NO_GO"),
            _strategy_report(validation_roi=0.02, holdout_roi=-0.03),
        )

        self.assertEqual(report["researchStatus"], "NO_GO")
        self.assertIn("probabilityQuality", report["retrospectiveFailedGates"])
        self.assertIn("positiveHoldoutRoi", report["retrospectiveFailedGates"])
        self.assertEqual(report["cashMode"], "NO_BET")

    def test_reused_research_holdout_cannot_promote_even_when_metrics_are_positive(self):
        model = _model_report(research_status="RESEARCH_CHAMPION")
        model["holdoutPolicy"]["promotionEligible"] = False
        model["holdoutPolicy"]["researchIterationStatus"] = "REUSED"

        report = build_exotic_pool_promotion(
            model,
            _strategy_report(validation_roi=0.02, holdout_roi=0.01),
        )

        self.assertEqual(report["researchStatus"], "NO_GO")
        self.assertIn("freshResearchHoldout", report["retrospectiveFailedGates"])


def _model_report(research_status):
    return {
        "version": "exotic-pair-model-v1",
        "pool": "quinellaPlace",
        "promotion": {"researchStatus": research_status, "cashMode": "NO_BET"},
        "holdoutPolicy": {
            "chronologicallyOutOfSample": True,
            "researchIterationStatus": "FRESH",
            "promotionEligible": True,
        },
        "selectedStack": {
            "metrics": {
                "validation": {"races": 220},
                "holdout": {"races": 227, "isOutOfSample": True},
            },
        },
    }


def _strategy_report(validation_roi, holdout_roi):
    metric = {
        "racesEligible": 227,
        "bets": 227,
        "largestReturnShare": 0.08,
        "longestLosingRun": 14,
        "isOutOfSample": True,
    }
    return {
        "version": "exotic-pair-strategy-v1",
        "pool": "quinellaPlace",
        "metricsBySplit": {
            "validation": {"selectedStack": {**metric, "ROI": validation_roi}},
            "holdout": {"selectedStack": {**metric, "ROI": holdout_roi}},
        },
    }


if __name__ == "__main__":
    unittest.main()
