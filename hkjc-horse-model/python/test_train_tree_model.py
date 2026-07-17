import json
import math
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


PYTHON_DIR = Path(__file__).resolve().parent
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))

from train_tree_model import (  # noqa: E402
    compute_split_metrics,
    fit_feature_encoder,
    normalize_race_probabilities,
    run_training,
    select_feature_columns,
    transform_feature_rows,
    _validate_rows,
)


class _RecordingBooster:
    def save_model(self, path):
        Path(path).write_text("fake model\n", encoding="utf-8")


class _RecordingClassifier:
    last_instance = None

    def __init__(self, **parameters):
        self.parameters = parameters
        self.best_iteration_ = 4
        self.n_estimators_ = 4
        self.booster_ = _RecordingBooster()
        self.fit_kwargs = None
        _RecordingClassifier.last_instance = self

    def fit(self, x_train, y_train, **kwargs):
        self.fit_kwargs = kwargs
        self.train_frame = x_train
        self.train_rows = len(x_train)
        self.train_labels = list(y_train)
        return self

    def predict_proba(self, frame):
        import numpy

        self.prediction_frame = frame
        probability = numpy.full(len(frame), 0.25, dtype=float)
        return numpy.column_stack((1.0 - probability, probability))


class _FakeLightGBM:
    LGBMClassifier = _RecordingClassifier

    @staticmethod
    def early_stopping(rounds, verbose=False):
        return {"rounds": rounds, "verbose": verbose}


class TreeModelHelpersTest(unittest.TestCase):
    def test_no_market_mode_excludes_market_money_and_label_metadata_features(self):
        columns = [
            "raceId", "date", "split", "horseId", "horseNo", "racecourse",
            "raceNo", "fieldSize", "targetWin", "targetPlace",
            "distance", "surface", "marketWinOddsT30", "poolWinInvestmentT30",
            "moneyShare", "investmentAvailable", "dividendAmount", "payoutValue",
            "runner_id",
        ]

        selected, excluded = select_feature_columns(columns, mode="no-market", target="targetWin")

        self.assertEqual(selected, ["distance", "surface"])
        self.assertEqual(
            excluded,
            [
                "marketWinOddsT30", "poolWinInvestmentT30", "moneyShare",
                "investmentAvailable", "dividendAmount", "payoutValue",
            ],
        )

    def test_category_mapping_is_fit_on_train_and_unseen_values_become_minus_one(self):
        rows = [
            {"split": "train", "surface": "TURF", "going": "GOOD", "draw": 1},
            {"split": "train", "surface": "TURF", "going": "YIELDING", "draw": None},
            {"split": "validation", "surface": "SAND", "going": "GOOD", "draw": 3},
        ]

        encoder = fit_feature_encoder(rows, ["surface", "going", "draw"])
        transformed = transform_feature_rows(rows, encoder)

        self.assertEqual(encoder["categoricalMappings"]["surface"], {"TURF": 0})
        self.assertEqual(encoder["categoricalMappings"]["going"], {"GOOD": 0, "YIELDING": 1})
        self.assertEqual(transformed[2][0], -1.0)
        self.assertEqual(transformed[2][1], 0.0)
        self.assertTrue(math.isnan(transformed[1][2]))

    def test_numeric_zero_is_not_treated_as_missing(self):
        rows = [{"split": "train", "draw": 0}]

        encoder = fit_feature_encoder(rows, ["draw"])

        self.assertEqual(transform_feature_rows(rows, encoder)[0][0], 0.0)

    def test_validate_rows_rejects_race_spanning_multiple_splits_but_allows_runners_in_one_split(self):
        base = {
            "raceId": "R1",
            "date": "2026-01-01",
            "horseId": "H1",
            "horseNo": 1,
            "racecourse": "ST",
            "raceNo": 1,
            "fieldSize": 2,
            "targetWin": 1,
            "targetPlace": 1,
        }
        same_split = [dict(base, split="train"), dict(base, split="train", horseId="H2", horseNo=2, targetWin=0, targetPlace=0)]
        _validate_rows(same_split, "targetWin")

        cross_split = [dict(base, split="train"), dict(base, split="validation", horseId="H2", horseNo=2, targetWin=0, targetPlace=0)]
        with self.assertRaisesRegex(ValueError, "raceId 'R1' appears in multiple splits: train, validation"):
            _validate_rows(cross_split, "targetWin")

    def test_probabilities_are_normalized_within_each_race(self):
        rows = [
            {"raceId": "R1"}, {"raceId": "R1"}, {"raceId": "R1"},
            {"raceId": "R2"},
        ]

        probabilities = normalize_race_probabilities(rows, [0.8, 0.4, 0.4, 0.0])

        self.assertAlmostEqual(sum(probabilities[:3]), 1.0)
        self.assertAlmostEqual(probabilities[0], 0.5)
        self.assertAlmostEqual(sum(probabilities[3:]), 1.0)
        self.assertGreaterEqual(min(probabilities), 0.0)
        self.assertLessEqual(max(probabilities), 1.0)

    def test_metrics_include_runner_and_race_quality_measures(self):
        rows = [
            {"raceId": "R1", "targetWin": 1},
            {"raceId": "R1", "targetWin": 0},
            {"raceId": "R2", "targetWin": 0},
            {"raceId": "R2", "targetWin": 1},
        ]

        metrics = compute_split_metrics(rows, [0.7, 0.3, 0.6, 0.4], target="targetWin")

        self.assertEqual(metrics["rows"], 4)
        self.assertEqual(metrics["races"], 2)
        self.assertAlmostEqual(metrics["topPickWinRate"], 0.5)
        self.assertAlmostEqual(metrics["winnerInTop3Rate"], 1.0)
        self.assertGreater(metrics["logLoss"], 0.0)
        self.assertGreater(metrics["brierScore"], 0.0)


class TreeModelEarlyStoppingTest(unittest.TestCase):
    @staticmethod
    def _rows(validation_labels=(1, 0), include_validation=True):
        rows = []
        split_labels = [("train", (1, 0)), ("holdout", (1, 0))]
        if include_validation:
            split_labels.insert(1, ("validation", validation_labels))
        for race_number, (split, labels) in enumerate(split_labels, start=1):
            for horse_number, label in enumerate(labels, start=1):
                rows.append({
                    "raceId": f"R{race_number}",
                    "date": f"202{race_number}-01-01",
                    "split": split,
                    "horseId": f"H{race_number}-{horse_number}",
                    "horseNo": horse_number,
                    "racecourse": "ST",
                    "raceNo": race_number,
                    "fieldSize": 2,
                    "targetWin": label,
                    "targetPlace": label,
                    "distance": 1200 + horse_number,
                    "surface": {
                        "train": "TRAIN_SURFACE",
                        "validation": "VALIDATION_SURFACE",
                        "holdout": "HOLDOUT_SURFACE",
                    }[split],
                })
        return rows

    @staticmethod
    def _run(rows, parameters, fit_splits=("train",), selection_report_path=None):
        import numpy
        import pandas

        with tempfile.TemporaryDirectory() as directory:
            input_path = Path(directory) / "matrix.jsonl"
            output_path = Path(directory) / "tree-model-report.json"
            input_path.write_text(
                "\n".join(json.dumps(row) for row in rows) + "\n",
                encoding="utf-8",
            )
            with patch(
                "train_tree_model._require_training_dependencies",
                return_value=(pandas, numpy, SimpleNamespace(), _FakeLightGBM),
            ):
                report = run_training(
                    input_path,
                    output_path,
                    fit_splits=fit_splits,
                    parameters=parameters,
                    selection_report_path=selection_report_path,
                )
            return report, _RecordingClassifier.last_instance

    def test_early_stopping_passes_validation_only_as_eval_set(self):
        report, model = self._run(
            self._rows(),
            {
                "n_estimators": 20,
                "early_stopping_rounds": 3,
                "subsample": 0.8,
                "colsample_bytree": 0.7,
                "reg_alpha": 0.2,
            },
        )

        self.assertEqual(model.train_rows, 2)
        self.assertEqual(len(model.fit_kwargs["eval_set"]), 1)
        self.assertEqual(len(model.fit_kwargs["eval_set"][0][0]), 2)
        self.assertEqual(model.fit_kwargs["eval_names"], ["validation"])
        self.assertEqual(model.fit_kwargs["callbacks"][0]["rounds"], 3)
        self.assertAlmostEqual(model.parameters["subsample"], 0.8)
        self.assertAlmostEqual(model.parameters["colsample_bytree"], 0.7)
        self.assertAlmostEqual(model.parameters["reg_alpha"], 0.2)
        self.assertEqual(model.fit_kwargs["categorical_feature"], ["surface"])
        self.assertEqual(str(model.train_frame["surface"].dtype), "int32")
        self.assertEqual(model.train_frame["surface"].tolist(), [0, 0])
        self.assertEqual(model.prediction_frame["surface"].iloc[2], -1)
        self.assertEqual(str(model.prediction_frame["surface"].dtype), "int32")
        self.assertEqual(report["bestIteration"], 4)
        self.assertEqual(report["effectiveIterations"], 4)
        self.assertFalse(report["metrics"]["bySplit"]["validation"]["isOutOfSample"])
        self.assertTrue(report["metrics"]["bySplit"]["validation"]["isModelSelectionSample"])
        self.assertFalse(report["metrics"]["bySplit"]["train"]["isModelSelectionSample"])

    def test_zero_early_stopping_does_not_pass_eval_set(self):
        report, model = self._run(
            self._rows(),
            {"n_estimators": 7, "early_stopping_rounds": 0},
        )

        self.assertEqual(model.fit_kwargs, {"categorical_feature": ["surface"]})
        self.assertIsNone(report["bestIteration"])
        self.assertEqual(report["effectiveIterations"], 7)
        self.assertTrue(report["metrics"]["bySplit"]["validation"]["isOutOfSample"])
        self.assertFalse(report["metrics"]["bySplit"]["validation"]["isModelSelectionSample"])

    def test_early_stopping_requires_validation_split(self):
        with self.assertRaisesRegex(ValueError, "Validation split is required"):
            self._run(
                self._rows(include_validation=False),
                {"early_stopping_rounds": 1},
            )

    def test_early_stopping_requires_two_validation_classes(self):
        with self.assertRaisesRegex(ValueError, "Validation split target targetWin must contain both 0 and 1"):
            self._run(
                self._rows(validation_labels=(1, 1)),
                {"early_stopping_rounds": 1},
            )


class TreeModelFinalRefitTest(unittest.TestCase):
    def test_final_refit_fits_train_and_validation_but_not_holdout(self):
        rows = TreeModelEarlyStoppingTest._rows()
        report, model = TreeModelEarlyStoppingTest._run(
            rows,
            {"n_estimators": 7},
            fit_splits=("train", "validation"),
        )

        self.assertEqual(model.train_rows, 4)
        self.assertEqual(report["fitSplits"], ["train", "validation"])
        self.assertTrue(report["validationIsInSample"])
        self.assertEqual(report["effectiveIterations"], 7)
        self.assertIsNone(report["bestIteration"])
        self.assertFalse(report["metrics"]["bySplit"]["validation"]["isOutOfSample"])
        self.assertFalse(report["metrics"]["bySplit"]["validation"]["isModelSelectionSample"])
        self.assertTrue(report["metrics"]["bySplit"]["holdout"]["isOutOfSample"])
        self.assertFalse(report["metrics"]["bySplit"]["holdout"]["isModelSelectionSample"])
        self.assertEqual(report["lineage"], "manual")

    def test_final_refit_encoder_uses_fit_splits_only(self):
        rows = TreeModelEarlyStoppingTest._rows()

        encoder = fit_feature_encoder(
            rows,
            ["surface"],
            fit_splits=("train", "validation"),
        )

        self.assertEqual(
            encoder["categoricalMappings"]["surface"],
            {"TRAIN_SURFACE": 0, "VALIDATION_SURFACE": 1},
        )
        transformed = transform_feature_rows(rows, encoder)
        self.assertEqual(transformed[-1][0], -1.0)
        self.assertEqual(encoder["fitSplits"], ["train", "validation"])

    def test_final_refit_rejects_early_stopping(self):
        with self.assertRaisesRegex(ValueError, "Cannot enable early stopping when validation is included in fit_splits"):
            TreeModelEarlyStoppingTest._run(
                TreeModelEarlyStoppingTest._rows(),
                {
                    "early_stopping_rounds": 1,
                },
                fit_splits=("train", "validation"),
            )

    def test_fit_splits_rejects_holdout(self):
        with self.assertRaisesRegex(ValueError, "holdout must never be included in fit_splits"):
            TreeModelEarlyStoppingTest._run(
                TreeModelEarlyStoppingTest._rows(),
                {},
                fit_splits=("train", "holdout"),
            )

    def test_fit_splits_must_include_train_and_existing_validation(self):
        with self.assertRaisesRegex(ValueError, "fit_splits must include train"):
            TreeModelEarlyStoppingTest._run(
                TreeModelEarlyStoppingTest._rows(), {}, fit_splits=("validation",)
            )
        with self.assertRaisesRegex(ValueError, "validation is included in fit_splits but has no rows"):
            TreeModelEarlyStoppingTest._run(
                TreeModelEarlyStoppingTest._rows(include_validation=False), {},
                fit_splits=("train", "validation"),
            )

    def test_parameter_boundaries_are_rejected(self):
        invalid_parameters = (
            ({"n_estimators": 0}, "n_estimators must be > 0"),
            ({"learning_rate": 0}, "learning_rate must be > 0"),
            ({"num_leaves": 1}, "num_leaves must be > 1"),
            ({"min_child_samples": 0}, "min_child_samples must be > 0"),
            ({"reg_alpha": -0.1}, "reg_alpha must be >= 0"),
            ({"reg_lambda": -0.1}, "reg_lambda must be >= 0"),
            ({"subsample": 0}, "subsample must be > 0 and <= 1"),
            ({"subsample": 1.1}, "subsample must be > 0 and <= 1"),
            ({"colsample_bytree": 0}, "colsample_bytree must be > 0 and <= 1"),
            ({"colsample_bytree": 1.1}, "colsample_bytree must be > 0 and <= 1"),
        )
        for parameters, message in invalid_parameters:
            with self.subTest(parameters=parameters):
                with self.assertRaisesRegex(ValueError, message):
                    TreeModelEarlyStoppingTest._run(
                        TreeModelEarlyStoppingTest._rows(), parameters,
                    )

    def test_selection_report_drives_final_refit_and_records_lineage(self):
        rows = TreeModelEarlyStoppingTest._rows()
        with tempfile.TemporaryDirectory() as directory:
            selection_path = Path(directory) / "selection-report.json"
            selection_path.write_text(json.dumps({
                "fitSplits": ["train"],
                "bestIteration": 5,
                "parameters": {
                    "learning_rate": 0.03,
                    "num_leaves": 17,
                    "max_depth": 6,
                    "min_child_samples": 40,
                    "reg_lambda": 1.2,
                    "reg_alpha": 0.2,
                    "subsample": 0.8,
                    "colsample_bytree": 0.7,
                },
                "metrics": {"bySplit": {"holdout": {"isOutOfSample": True}}},
            }), encoding="utf-8")
            report, model = TreeModelEarlyStoppingTest._run(
                rows,
                {"n_estimators": 99, "early_stopping_rounds": 7},
                fit_splits=("train", "validation"),
                selection_report_path=selection_path,
            )

        self.assertEqual(model.train_rows, 4)
        self.assertEqual(report["parameters"]["n_estimators"], 5)
        self.assertEqual(report["parameters"]["early_stopping_rounds"], 0)
        self.assertAlmostEqual(report["parameters"]["learning_rate"], 0.03)
        self.assertEqual(report["parameters"]["num_leaves"], 17)
        self.assertEqual(report["effectiveIterations"], 5)
        self.assertEqual(report["lineage"], "selection-report")
        self.assertEqual(report["selectionReport"]["basename"], "selection-report.json")
        self.assertEqual(report["selectionReport"]["selectedBestIteration"], 5)
        self.assertEqual(report["selectionReport"]["selectedParameters"]["subsample"], 0.8)

    def test_selection_report_must_not_contain_holdout_fit(self):
        rows = TreeModelEarlyStoppingTest._rows()
        with tempfile.TemporaryDirectory() as directory:
            selection_path = Path(directory) / "bad-selection.json"
            selection_path.write_text(json.dumps({
                "fitSplits": ["train", "holdout"],
                "bestIteration": 5,
                "parameters": {},
            }), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "selection report must not fit holdout"):
                TreeModelEarlyStoppingTest._run(
                    rows, {}, fit_splits=("train", "validation"),
                    selection_report_path=selection_path,
                )

    def test_selection_report_requires_explicit_holdout_oos_evidence(self):
        rows = TreeModelEarlyStoppingTest._rows()
        with tempfile.TemporaryDirectory() as directory:
            selection_path = Path(directory) / "ambiguous-selection.json"
            selection_path.write_text(json.dumps({
                "fitSplits": ["train"],
                "bestIteration": 5,
                "parameters": {
                    "learning_rate": 0.03,
                    "num_leaves": 17,
                    "max_depth": 6,
                    "min_child_samples": 40,
                    "reg_lambda": 1.2,
                    "reg_alpha": 0.2,
                    "subsample": 0.8,
                    "colsample_bytree": 0.7,
                },
                "metrics": {"bySplit": {"holdout": {}}},
            }), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "selection report must not fit holdout"):
                TreeModelEarlyStoppingTest._run(
                    rows, {}, fit_splits=("train", "validation"),
                    selection_report_path=selection_path,
                )


class TreeModelSmokeTest(unittest.TestCase):
    def test_lightgbm_cli_writes_report_model_and_manifest(self):
        try:
            import lightgbm  # noqa: F401
            import pandas  # noqa: F401
            import sklearn  # noqa: F401
        except ImportError as error:
            self.skipTest(f"LightGBM smoke dependencies unavailable: {error}")

        rows = []
        for race_number, split in [(1, "train"), (2, "train"), (3, "validation"), (4, "holdout")]:
            for horse_number in (1, 2, 3):
                rows.append({
                    "raceId": f"R{race_number}",
                    "date": f"202{race_number}-01-01",
                    "split": split,
                    "horseId": f"H{race_number}-{horse_number}",
                    "horseNo": horse_number,
                    "racecourse": "ST" if race_number % 2 else "HV",
                    "raceNo": race_number,
                    "fieldSize": 3,
                    "targetWin": int(horse_number == 1),
                    "targetPlace": int(horse_number <= 2),
                    "distance": 1200 + race_number * 100,
                    "surface": "TURF" if race_number != 2 else "SAND",
                    "marketWinOddsT30": 2.0,
                })

        with tempfile.TemporaryDirectory() as directory:
            input_path = Path(directory) / "matrix.jsonl"
            output_path = Path(directory) / "tree-model-report.json"
            input_path.write_text("\n".join(json.dumps(row) for row in rows) + "\n", encoding="utf-8")

            result = subprocess.run(
                [
                    sys.executable,
                    str(PYTHON_DIR / "train_tree_model.py"),
                    "--input", str(input_path),
                    "--output", str(output_path),
                    "--n-estimators", "8",
                    "--num-leaves", "7",
                    "--early-stopping-rounds", "2",
                    "--subsample", "0.8",
                    "--colsample-bytree", "0.7",
                    "--reg-alpha", "0.2",
                ],
                check=False,
                capture_output=True,
                text=True,
                env={**os.environ, "PYTHONWARNINGS": "error"},
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(report["modelId"], "lightgbm-no-market-v1")
            self.assertNotIn("marketWinOddsT30", report["features"])
            self.assertIn("marketWinOddsT30", report["excludedFeatures"])
            self.assertEqual(set(report["metrics"]["bySplit"]), {"train", "validation", "holdout"})
            self.assertEqual(report["parameters"]["early_stopping_rounds"], 2)
            self.assertAlmostEqual(report["parameters"]["subsample"], 0.8)
            self.assertAlmostEqual(report["parameters"]["colsample_bytree"], 0.7)
            self.assertAlmostEqual(report["parameters"]["reg_alpha"], 0.2)
            self.assertIn("bestIteration", report)
            self.assertIn("effectiveIterations", report)
            self.assertTrue(Path(report["modelArtifact"]).exists())
            self.assertTrue(Path(report["featureManifest"]).exists())
            model_text = Path(report["modelArtifact"]).read_text(encoding="utf-8")
            self.assertIn("categorical_feature: 1", model_text)

    def test_lightgbm_cli_final_refit_reports_validation_as_in_sample(self):
        try:
            import lightgbm  # noqa: F401
            import pandas  # noqa: F401
            import sklearn  # noqa: F401
        except ImportError as error:
            self.skipTest(f"LightGBM smoke dependencies unavailable: {error}")

        rows = []
        for race_number, split in [(1, "train"), (2, "train"), (3, "validation"), (4, "holdout")]:
            for horse_number in (1, 2, 3):
                rows.append({
                    "raceId": f"R{race_number}",
                    "date": f"202{race_number}-01-01",
                    "split": split,
                    "horseId": f"H{race_number}-{horse_number}",
                    "horseNo": horse_number,
                    "racecourse": "ST",
                    "raceNo": race_number,
                    "fieldSize": 3,
                    "targetWin": int(horse_number == 1),
                    "targetPlace": int(horse_number <= 2),
                    "distance": 1200 + race_number * 100,
                    "surface": "TURF" if race_number != 2 else "SAND",
                })

        with tempfile.TemporaryDirectory() as directory:
            input_path = Path(directory) / "matrix.jsonl"
            output_path = Path(directory) / "final-refit-report.json"
            input_path.write_text(
                "\n".join(json.dumps(row) for row in rows) + "\n",
                encoding="utf-8",
            )

            result = subprocess.run(
                [
                    sys.executable,
                    str(PYTHON_DIR / "train_tree_model.py"),
                    "--input", str(input_path),
                    "--output", str(output_path),
                    "--n-estimators", "8",
                    "--include-validation-in-fit",
                ],
                check=False,
                capture_output=True,
                text=True,
                env={**os.environ, "PYTHONWARNINGS": "error"},
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(report["fitSplits"], ["train", "validation"])
            self.assertTrue(report["validationIsInSample"])
            self.assertFalse(report["metrics"]["bySplit"]["validation"]["isOutOfSample"])
            self.assertTrue(report["metrics"]["bySplit"]["holdout"]["isOutOfSample"])
            self.assertIsNone(report["bestIteration"])
            self.assertEqual(report["effectiveIterations"], 8)

    def test_cli_selection_report_requires_final_refit_flag(self):
        from train_tree_model import main

        with self.assertRaisesRegex(SystemExit, "--selection-report requires --include-validation-in-fit"):
            main(["--input", "matrix.jsonl", "--output", "report.json", "--selection-report", "selection.json"])


if __name__ == "__main__":
    unittest.main()
