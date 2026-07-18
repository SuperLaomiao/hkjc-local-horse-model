import json
import math
import sys
import tempfile
import unittest
from pathlib import Path


PYTHON_DIR = Path(__file__).resolve().parent
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))

from train_exotic_pair_model import (  # noqa: E402
    baseline_pair_probabilities,
    calibrate_pair_predictions,
    compare_pair_model,
    run_training,
    select_pair_stack,
    select_pair_feature_columns,
)


class ExoticPairProbabilityTest(unittest.TestCase):
    def test_qin_calibration_is_selected_on_validation_and_normalized_per_race(self):
        rows = _pair_rows("quinella")
        raw = [0.8, 0.1, 0.1, 0.7, 0.2, 0.1]

        result = calibrate_pair_predictions(
            rows,
            raw,
            pool="quinella",
            calibration_fitter=_constant_half_calibrator,
        )

        self.assertEqual(result["selection"]["selectedOn"], "validation")
        self.assertFalse(result["selection"]["holdoutUsedForSelection"])
        self.assertEqual(result["selection"]["calibration"], "raw")
        for race_id in ("V1", "H1"):
            total = sum(
                probability
                for row, probability in zip(rows, result["probabilities"])
                if row["raceId"] == race_id
            )
            self.assertTrue(math.isclose(total, 1.0, abs_tol=1e-9))
        self.assertEqual(result["metrics"]["holdout"]["races"], 1)
        self.assertTrue(result["metrics"]["holdout"]["isOutOfSample"])
        self.assertEqual(result["metrics"]["holdout"]["topPairHits"], 1)

    def test_qpl_probabilities_remain_pair_marginals_instead_of_race_normalization(self):
        rows = _pair_rows("quinellaPlace")
        rows[0]["targetPair"] = 1
        rows[1]["targetPair"] = 1
        rows[3]["targetPair"] = 1
        rows[4]["targetPair"] = 1
        raw = [0.8, 0.7, 0.1, 0.75, 0.65, 0.1]

        result = calibrate_pair_predictions(
            rows,
            raw,
            pool="quinellaPlace",
            calibration_methods=("raw",),
        )

        self.assertEqual(result["probabilities"], raw)
        self.assertGreater(sum(result["probabilities"][:3]), 1.0)
        self.assertEqual(result["metrics"]["holdout"]["winningPairsInTop3"], 2)
        self.assertEqual(result["metrics"]["holdout"]["positivePairs"], 2)

    def test_market_baselines_are_harville_for_qin_and_pair_product_for_qpl(self):
        rows = _pair_rows("quinella")

        qin = baseline_pair_probabilities(rows, pool="quinella")
        qpl = baseline_pair_probabilities(rows, pool="quinellaPlace")

        self.assertTrue(math.isclose(sum(qin[:3]), 1.0, abs_tol=1e-9))
        self.assertTrue(math.isclose(sum(qin[3:]), 1.0, abs_tol=1e-9))
        self.assertEqual(qpl[:3], [0.18, 0.06, 0.03])

    def test_rejects_pair_race_that_crosses_splits(self):
        rows = _pair_rows("quinella")
        rows[3]["raceId"] = "V1"

        with self.assertRaisesRegex(ValueError, "V1.*multiple splits"):
            calibrate_pair_predictions(
                rows,
                [0.8, 0.1, 0.1, 0.7, 0.2, 0.1],
                pool="quinella",
                calibration_methods=("raw",),
            )

    def test_feature_policy_excludes_identity_targets_payouts_and_future_market(self):
        selected, excluded = select_pair_feature_columns([
            "raceId", "date", "split", "poolKey", "pairKey",
            "horseNoA", "horseNoB", "targetPair", "dividendPer10",
            "officialFinalOdds", "marketWinOddsT3Low", "marketWinOddsT10Low",
            "marketWinOddsT30High", "speedLow", "speedAbsDiff",
        ])

        self.assertEqual(selected, [
            "marketWinOddsT10Low", "marketWinOddsT30High",
            "speedLow", "speedAbsDiff",
        ])
        self.assertIn("marketWinOddsT3Low", excluded)
        self.assertIn("officialFinalOdds", excluded)
        self.assertIn("dividendPer10", excluded)

    def test_comparison_keeps_research_and_cash_promotion_separate(self):
        rows = _pair_rows("quinella")
        raw = [0.95, 0.03, 0.02, 0.95, 0.03, 0.02]

        comparison = compare_pair_model(
            rows,
            raw,
            pool="quinella",
            calibration_methods=("raw",),
        )

        self.assertGreater(
            comparison["improvementVsMarketBaseline"]["holdoutLogLossReduction"],
            0,
        )
        self.assertEqual(comparison["promotion"]["researchStatus"], "NO_GO")
        self.assertIn("minimumHoldoutRaces", comparison["promotion"]["failedGates"])
        self.assertEqual(comparison["promotion"]["cashMode"], "NO_BET")
        self.assertEqual(comparison["promotion"]["prospectiveStatus"], "BLOCKED_DATA")

    def test_run_training_writes_compact_report_and_predictions_with_injected_predictor(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            matrix = root / "pairs.jsonl"
            report_path = root / "pair-model.json"
            predictions_path = root / "pair-model.predictions.jsonl"
            validation_and_holdout = _pair_rows("quinella")
            train = [
                {**row, "raceId": "T1", "split": "train", "date": "2025-12-01"}
                for row in validation_and_holdout[:3]
            ]
            rows = train + validation_and_holdout
            for row in rows:
                row["signal"] = 0.95 if row["targetPair"] else 0.03
                row["marketWinOddsT3Low"] = 1.2
            matrix.write_text(
                "\n".join(json.dumps(row) for row in rows) + "\n",
                encoding="utf-8",
            )

            def predictor(frame, feature_names, fit_indexes, validation_indexes, parameters):
                self.assertIn("signal", feature_names)
                self.assertNotIn("marketWinOddsT3Low", feature_names)
                self.assertEqual(len(fit_indexes), 3)
                self.assertEqual(len(validation_indexes), 3)
                self.assertEqual(parameters["loss_function"], "Logloss")
                return frame["signal"].tolist(), {
                    "engine": "fixture",
                    "bestIteration": None,
                    "effectiveIterations": 0,
                }

            report = run_training(
                matrix,
                report_path,
                pool="quinella",
                predictions_output_path=predictions_path,
                calibration_methods=("raw",),
                predictor=predictor,
            )

            persisted = json.loads(report_path.read_text(encoding="utf-8"))
            predictions = [
                json.loads(line)
                for line in predictions_path.read_text(encoding="utf-8").splitlines()
            ]
            self.assertEqual(report["modelId"], "catboost-quinella-pair-t10-v1")
            self.assertEqual(persisted["training"]["engine"], "fixture")
            self.assertEqual(persisted["input"]["rows"], 9)
            self.assertTrue(persisted["holdoutPolicy"]["chronologicallyOutOfSample"])
            self.assertFalse(persisted["holdoutPolicy"]["promotionEligible"])
            self.assertEqual(persisted["holdoutPolicy"]["researchIterationStatus"], "REUSED")
            self.assertIn("signal", persisted["features"])
            self.assertNotIn("marketWinOddsT3Low", persisted["features"])
            self.assertEqual(len(predictions), 9)
            self.assertIn("modelProbability", predictions[0])
            self.assertIn("marketBaselineProbability", predictions[0])
            self.assertIn("selectedProbability", predictions[0])
            self.assertEqual(persisted["promotion"]["cashMode"], "NO_BET")

    def test_pair_stack_selects_weight_on_validation_without_peeking_at_holdout(self):
        rows = _pair_rows("quinella")
        model = [0.95, 0.03, 0.02, 0.05, 0.05, 0.9]
        baseline = baseline_pair_probabilities(rows, pool="quinella")

        stack = select_pair_stack(
            rows,
            model,
            baseline,
            pool="quinella",
            model_weights=(0.0, 0.5, 1.0),
        )

        self.assertEqual(stack["selection"]["selectedOn"], "validation")
        self.assertFalse(stack["selection"]["holdoutUsedForSelection"])
        self.assertEqual(stack["selection"]["modelWeight"], 1.0)
        self.assertEqual(stack["probabilities"][:3], model[:3])
        self.assertLess(
            stack["metrics"]["holdout"]["topPairHitRate"],
            1.0,
        )


def _pair_rows(pool):
    rows = []
    for race_id, split in (("V1", "validation"), ("H1", "holdout")):
        for pair_key, left, right, target in (
            ("1-2", 0.6, 0.3, 1),
            ("1-3", 0.6, 0.1, 0),
            ("2-3", 0.3, 0.1, 0),
        ):
            rows.append({
                "raceId": race_id,
                "date": "2026-01-01" if split == "validation" else "2026-02-01",
                "split": split,
                "poolKey": pool,
                "pairKey": pair_key,
                "horseNoA": int(pair_key[0]),
                "horseNoB": int(pair_key[2]),
                "targetPair": target,
                "marketWinImpliedProbT10Low": min(left, right),
                "marketWinImpliedProbT10High": max(left, right),
                "marketPlaceImpliedProbT10Product": left * right,
            })
    return rows


def _constant_half_calibrator(method, probabilities, labels):
    del method, probabilities, labels
    return lambda values: [0.5 for _value in values]


if __name__ == "__main__":
    unittest.main()
