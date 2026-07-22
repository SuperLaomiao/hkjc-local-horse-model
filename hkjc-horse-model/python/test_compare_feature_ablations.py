import sys
import unittest
from pathlib import Path


PYTHON_DIR = Path(__file__).resolve().parent
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))

from compare_feature_ablations import compare_feature_ablations  # noqa: E402


class FeatureAblationComparisonTest(unittest.TestCase):
    def test_compares_only_complete_races_and_selects_on_validation(self):
        report = compare_feature_ablations(
            _validation_rows(),
            _prospective_rows(),
            feature_policy={
                "version": "feature-policy-v1",
                "trainingCutoff": "2026-06-30",
                "target": "targetWin",
            },
            freeze_date="2026-07-01",
        )

        self.assertEqual(report["version"], "feature-ablation-v1")
        self.assertEqual(report["cashMode"], "NO_BET")
        self.assertEqual(report["executionStatus"], "RESEARCH_ONLY")
        self.assertEqual(report["selection"]["selectedPolicy"], "base")
        self.assertEqual(report["selection"]["selectedOn"], "validation.logLoss")
        self.assertEqual(report["cohorts"]["validation"]["commonRaces"], 2)
        self.assertEqual(report["cohorts"]["validation"]["excludedRaces"], 1)
        self.assertEqual(
            report["cohorts"]["validation"]["missingByPolicy"]["combined"],
            1,
        )
        self.assertEqual(report["cohorts"]["prospective"]["commonRaces"], 1)
        self.assertTrue(report["cohorts"]["prospective"]["fresh"])
        self.assertLess(
            report["policies"]["combined"]["prospective"]["logLoss"],
            report["policies"]["base"]["prospective"]["logLoss"],
        )
        self.assertEqual(report["selectedProspective"]["policyId"], "base")
        self.assertEqual(len(report["freeze"]["featurePolicyId"]), 71)
        self.assertEqual(
            report["evaluationPolicy"]["missingData"],
            "EXCLUDE_INCOMPLETE_RACE_FOR_ALL_POLICIES",
        )

    def test_is_deterministic_and_rejects_overlap_or_pre_freeze_rows(self):
        arguments = {
            "validation_rows": _validation_rows(),
            "prospective_rows": _prospective_rows(),
            "feature_policy": {
                "version": "feature-policy-v1",
                "trainingCutoff": "2026-06-30",
                "target": "targetWin",
            },
            "freeze_date": "2026-07-01",
        }
        self.assertEqual(
            compare_feature_ablations(**arguments),
            compare_feature_ablations(**arguments),
        )

        overlap = [dict(_prospective_rows()[0], raceId="V1")]
        with self.assertRaisesRegex(ValueError, "overlap"):
            compare_feature_ablations(
                _validation_rows(),
                overlap,
                feature_policy=arguments["feature_policy"],
                freeze_date="2026-07-01",
            )

        stale = [dict(row, date="2026-06-30") for row in _prospective_rows()]
        with self.assertRaisesRegex(ValueError, "freeze"):
            compare_feature_ablations(
                _validation_rows(),
                stale,
                feature_policy=arguments["feature_policy"],
                freeze_date="2026-07-01",
            )

        leaked_validation = [dict(row, date="2026-07-01") for row in _validation_rows()]
        with self.assertRaisesRegex(ValueError, "validation.*freeze"):
            compare_feature_ablations(
                leaked_validation,
                _prospective_rows(),
                feature_policy=arguments["feature_policy"],
                freeze_date="2026-07-01",
            )

        blocked = compare_feature_ablations(
            _validation_rows(),
            [],
            feature_policy=arguments["feature_policy"],
            freeze_date="2026-07-01",
        )
        self.assertEqual(blocked["state"], "BLOCKED_DATA")
        self.assertFalse(blocked["cohorts"]["prospective"]["fresh"])
        self.assertTrue(any(
            deficit["cohort"] == "prospective"
            for deficit in blocked["deficits"]
        ))


def _validation_rows():
    rows = []
    rows.extend(_race("V1", "2026-06-01", winner="H1", base=(0.8, 0.2), combined=(0.6, 0.4)))
    rows.extend(_race("V2", "2026-06-08", winner="H2", base=(0.2, 0.8), combined=(0.4, 0.6)))
    incomplete = _race("V3", "2026-06-15", winner="H1", base=(0.7, 0.3), combined=(0.7, 0.3))
    incomplete[1]["predictions"].pop("combined")
    rows.extend(incomplete)
    return rows


def _prospective_rows():
    return _race("P1", "2026-07-10", winner="H1", base=(0.4, 0.6), combined=(0.9, 0.1))


def _race(race_id, date, *, winner, base, combined):
    policies = {
        "base": base,
        "speedpro": (0.7, 0.3) if winner == "H1" else (0.3, 0.7),
        "poolMoney": (0.65, 0.35) if winner == "H1" else (0.35, 0.65),
        "oddsMovement": (0.55, 0.45) if winner == "H1" else (0.45, 0.55),
        "combined": combined,
    }
    rows = []
    for index, horse_id in enumerate(("H1", "H2")):
        rows.append({
            "raceId": race_id,
            "runnerId": horse_id,
            "date": date,
            "targetWin": int(horse_id == winner),
            "predictions": {policy: values[index] for policy, values in policies.items()},
        })
    return rows


if __name__ == "__main__":
    unittest.main()
