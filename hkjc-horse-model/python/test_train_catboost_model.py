import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


PYTHON_DIR = Path(__file__).resolve().parent
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))

from train_catboost_model import (  # noqa: E402
    MissingDependencyError,
    _require_catboost_dependencies,
    run_training,
)


class _RecordingCatBoostClassifier:
    last_instance = None

    def __init__(self, **parameters):
        self.parameters = parameters
        self.best_iteration_ = 4
        self.fit_kwargs = None
        _RecordingCatBoostClassifier.last_instance = self

    def fit(self, frame, labels, **kwargs):
        self.train_rows = len(frame)
        self.train_labels = list(labels)
        self.fit_kwargs = kwargs
        return self

    def predict_proba(self, frame):
        import numpy

        probability = numpy.full(len(frame), 0.25, dtype=float)
        return numpy.column_stack((1.0 - probability, probability))

    def save_model(self, path):
        Path(path).write_text("fake catboost model\n", encoding="utf-8")

    def get_best_iteration(self):
        return self.best_iteration_


class _FakeCatBoost:
    CatBoostClassifier = _RecordingCatBoostClassifier


class CatBoostTrainerTest(unittest.TestCase):
    @staticmethod
    def _rows():
        rows = []
        for race_number, split in ((1, "train"), (2, "validation"), (3, "holdout")):
            for horse_number, label in ((1, 1), (2, 0)):
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
                    "surface": {"train": "TURF", "validation": "AWT", "holdout": "DIRT"}[split],
                })
        return rows

    def _run(self, *, fit_splits=("train",), target="targetWin"):
        import numpy
        import pandas

        with tempfile.TemporaryDirectory() as directory:
            input_path = Path(directory) / "matrix.jsonl"
            output_path = Path(directory) / "catboost-report.json"
            predictions_path = Path(directory) / "predictions.jsonl"
            input_path.write_text(
                "\n".join(json.dumps(row) for row in self._rows()) + "\n",
                encoding="utf-8",
            )
            with patch(
                "train_catboost_model._require_catboost_dependencies",
                return_value=(pandas, numpy, SimpleNamespace(), _FakeCatBoost),
            ):
                report = run_training(
                    input_path,
                    output_path,
                    target=target,
                    fit_splits=fit_splits,
                    predictions_output_path=predictions_path,
                    parameters={
                        "iterations": 8,
                        "early_stopping_rounds": 0 if "validation" in fit_splits else 2,
                    },
                )
            prediction_rows = [
                json.loads(line)
                for line in predictions_path.read_text(encoding="utf-8").splitlines()
            ]
        return report, _RecordingCatBoostClassifier.last_instance, prediction_rows

    def test_missing_catboost_dependency_has_clear_installation_message(self):
        with patch("train_catboost_model.importlib.import_module", side_effect=ImportError("missing")):
            with self.assertRaisesRegex(MissingDependencyError, "catboost"):
                _require_catboost_dependencies()

    def test_selection_fits_train_only_and_uses_validation_only_for_early_stopping(self):
        report, model, predictions = self._run()

        self.assertEqual(model.train_rows, 2)
        self.assertEqual(len(model.fit_kwargs["eval_set"][0]), 2)
        self.assertEqual(report["fitSplits"], ["train"])
        self.assertTrue(report["metrics"]["bySplit"]["holdout"]["isOutOfSample"])
        self.assertNotIn("holdout", report["fitSplits"])
        self.assertEqual(report["target"], "targetWin")
        self.assertEqual(predictions[0]["modelId"], "catboost-no-market-v1")

    def test_final_refit_includes_validation_but_never_holdout(self):
        report, model, _predictions = self._run(fit_splits=("train", "validation"), target="targetPlace")

        self.assertEqual(model.train_rows, 4)
        self.assertNotIn("eval_set", model.fit_kwargs)
        self.assertEqual(report["fitSplits"], ["train", "validation"])
        self.assertTrue(report["metrics"]["bySplit"]["holdout"]["isOutOfSample"])
        self.assertEqual(report["target"], "targetPlace")
        self.assertNotIn("topPickWins", report["metrics"]["bySplit"]["holdout"])


if __name__ == "__main__":
    unittest.main()
