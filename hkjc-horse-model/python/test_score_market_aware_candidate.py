import hashlib
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

from score_market_aware_candidate import (  # noqa: E402
    build_score_bundle,
    load_frozen_bundle,
    main,
)


class _FakeFrame:
    def __init__(self, columns):
        self.columns = columns

    def __len__(self):
        return len(next(iter(self.columns.values()), []))


class _FakePandas:
    @staticmethod
    def DataFrame(columns):
        return _FakeFrame(columns)


class _FakeNumpy:
    @staticmethod
    def column_stack(columns):
        return [list(values) for values in zip(*columns)]


class _RecordingCatBoostClassifier:
    def __init__(self):
        self.loaded_path = None

    def load_model(self, path):
        self.loaded_path = path

    def predict_proba(self, frame):
        probabilities = [0.42, 0.58][:len(frame)]
        return _FakeNumpy.column_stack(
            ([1.0 - probability for probability in probabilities], probabilities)
        )


class _ArrayLikeProbabilityRow:
    """Mimic a one-dimensional NumPy row without inheriting from list/tuple."""

    def __init__(self, values):
        self._values = values

    def __len__(self):
        return len(self._values)

    def __getitem__(self, index):
        return self._values[index]


class _NumpyLikeCatBoostClassifier(_RecordingCatBoostClassifier):
    def predict_proba(self, frame):
        probabilities = [0.42, 0.58][:len(frame)]
        return [
            _ArrayLikeProbabilityRow([1.0 - probability, probability])
            for probability in probabilities
        ]


class ScoreMarketAwareCandidateTest(unittest.TestCase):
    def _write_fixture_bundle(self, directory, *, manifest_features=None):
        model_path = Path(directory) / "catboost-market-aware-t10-v1.model.cbm"
        report_path = Path(directory) / "catboost-market-aware-t10-v1.report.json"
        manifest_path = Path(directory) / "catboost-market-aware-t10-v1.feature-manifest.json"

        model_bytes = b"fake catboost model\n"
        model_path.write_bytes(model_bytes)

        manifest = {
            "version": "catboost-market-aware-t10-v1",
            "modelId": "catboost-market-aware-t10-v1",
            "mode": "market-aware-t10",
            "target": "targetWin",
            "featurePolicyId": "market-aware-t10-v1",
            "features": manifest_features or ["barrier", "marketWinOddsT10"],
            "featureTypes": {
                "barrier": "numeric",
                "marketWinOddsT10": "numeric",
            },
        }
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

        report = {
            "modelId": "catboost-market-aware-t10-v1",
            "mode": "market-aware-t10",
            "target": "targetWin",
            "lineage": "selection-report",
            "featureManifest": str(manifest_path),
            "modelArtifact": str(model_path),
            "features": ["barrier", "marketWinOddsT10"],
            "featurePolicyId": "market-aware-t10-v1",
            "trainingCutoff": "2018-06-27",
            "probabilityPolicy": {
                "calibrationMethod": "none",
            },
        }
        report_path.write_text(json.dumps(report), encoding="utf-8")
        return model_path, report_path, manifest_path, model_bytes

    def test_build_score_bundle_emits_lineage_bound_predictions(self):
        with tempfile.TemporaryDirectory() as directory:
            model_path, report_path, manifest_path, model_bytes = self._write_fixture_bundle(
                directory,
            )
            rows = [
                {
                    "raceId": "2026-07-22-HV-R1",
                    "runnerId": "H001",
                    "barrier": 1,
                    "marketWinOddsT10": 3.2,
                    "observedAt": "2026-07-22T10:01:00Z",
                    "postAt": "2026-07-22T10:30:00Z",
                },
                {
                    "raceId": "2026-07-22-HV-R1",
                    "runnerId": "H002",
                    "barrier": 8,
                    "marketWinOddsT10": 7.4,
                    "observedAt": "2026-07-22T10:01:00Z",
                    "postAt": "2026-07-22T10:30:00Z",
                },
            ]
            fake_catboost = SimpleNamespace(CatBoostClassifier=_RecordingCatBoostClassifier)
            with patch(
                "score_market_aware_candidate._require_scoring_dependencies",
                return_value=(_FakePandas, _FakeNumpy, fake_catboost),
            ):
                bundle = load_frozen_bundle(
                    model_path=model_path,
                    report_path=report_path,
                    feature_manifest_path=manifest_path,
                )
                score_bundle = build_score_bundle(
                    bundle=bundle,
                    rows=rows,
                    generated_at="2026-07-22T10:02:00Z",
                )

        expected_artifact_id = f"sha256:{hashlib.sha256(model_bytes).hexdigest()}"
        self.assertEqual(score_bundle["generatedAt"], "2026-07-22T10:02:00Z")
        self.assertEqual(score_bundle["predictions"][0], {
            "raceId": "2026-07-22-HV-R1",
            "runnerId": "H001",
            "probability": 0.42,
            "modelId": "catboost-market-aware-t10-v1",
            "artifactId": expected_artifact_id,
            "featurePolicyId": "market-aware-t10-v1",
            "calibrationMethod": "none",
            "trainingCutoff": "2018-06-27",
        })

    def test_load_frozen_bundle_rejects_feature_manifest_mismatch(self):
        with tempfile.TemporaryDirectory() as directory:
            model_path, report_path, manifest_path, _model_bytes = self._write_fixture_bundle(
                directory,
                manifest_features=["barrier", "marketPlaceOddsT10"],
            )

            with self.assertRaisesRegex(ValueError, "feature manifest does not match report features"):
                load_frozen_bundle(
                    model_path=model_path,
                    report_path=report_path,
                    feature_manifest_path=manifest_path,
                )

    def test_score_bundle_accepts_numpy_like_probability_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            model_path, report_path, manifest_path, _model_bytes = self._write_fixture_bundle(
                directory,
            )
            fake_catboost = SimpleNamespace(CatBoostClassifier=_NumpyLikeCatBoostClassifier)
            with patch(
                "score_market_aware_candidate._require_scoring_dependencies",
                return_value=(_FakePandas, _FakeNumpy, fake_catboost),
            ):
                bundle = load_frozen_bundle(
                    model_path=model_path,
                    report_path=report_path,
                    feature_manifest_path=manifest_path,
                )
                score_bundle = build_score_bundle(
                    bundle=bundle,
                    rows=[{
                        "raceId": "2026-07-22-HV-R1",
                        "runnerId": "H001",
                        "barrier": 1,
                        "marketWinOddsT10": 3.2,
                        "observedAt": "2026-07-22T10:01:00Z",
                        "postAt": "2026-07-22T10:30:00Z",
                    }],
                    generated_at="2026-07-22T10:02:00Z",
                )

        self.assertEqual(score_bundle["predictions"][0]["probability"], 0.42)

    def test_build_score_bundle_rejects_rows_observed_at_or_after_post_time(self):
        with tempfile.TemporaryDirectory() as directory:
            model_path, report_path, manifest_path, _model_bytes = self._write_fixture_bundle(
                directory,
            )
            fake_catboost = SimpleNamespace(CatBoostClassifier=_RecordingCatBoostClassifier)
            with patch(
                "score_market_aware_candidate._require_scoring_dependencies",
                return_value=(_FakePandas, _FakeNumpy, fake_catboost),
            ):
                bundle = load_frozen_bundle(
                    model_path=model_path,
                    report_path=report_path,
                    feature_manifest_path=manifest_path,
                )
                with self.assertRaisesRegex(ValueError, "observedAt must be before postAt"):
                    build_score_bundle(
                        bundle=bundle,
                        rows=[{
                            "raceId": "2026-07-22-HV-R1",
                            "runnerId": "H001",
                            "barrier": 1,
                            "marketWinOddsT10": 3.2,
                            "observedAt": "2026-07-22T10:30:00Z",
                            "postAt": "2026-07-22T10:30:00Z",
                        }],
                        generated_at="2026-07-22T10:02:00Z",
                    )

    def test_main_reads_jsonl_and_writes_score_bundle(self):
        with tempfile.TemporaryDirectory() as directory:
            input_path = Path(directory) / "upcoming.jsonl"
            output_path = Path(directory) / "shadow-score.json"
            model_path, report_path, manifest_path, _model_bytes = self._write_fixture_bundle(
                directory,
            )
            input_path.write_text(
                json.dumps({
                    "raceId": "2026-07-22-HV-R1",
                    "runnerId": "H001",
                    "barrier": 1,
                    "marketWinOddsT10": 3.2,
                    "observedAt": "2026-07-22T10:01:00Z",
                    "postAt": "2026-07-22T10:30:00Z",
                }) + "\n",
                encoding="utf-8",
            )
            expected_bundle = {
                "generatedAt": "2026-07-22T10:02:00Z",
                "predictions": [{"raceId": "2026-07-22-HV-R1", "runnerId": "H001", "probability": 0.42}],
            }
            with patch(
                "score_market_aware_candidate.load_frozen_bundle",
                return_value={"bundle": True},
            ) as load_bundle:
                with patch(
                    "score_market_aware_candidate.build_score_bundle",
                    return_value=expected_bundle,
                ) as build_bundle:
                    main([
                        "--input", str(input_path),
                        "--model", str(model_path),
                        "--report", str(report_path),
                        "--feature-manifest", str(manifest_path),
                        "--generated-at", "2026-07-22T10:02:00Z",
                        "--output", str(output_path),
                    ])
                load_bundle.assert_called_once_with(
                    model_path=model_path,
                    report_path=report_path,
                    feature_manifest_path=manifest_path,
                )
                build_bundle.assert_called_once()
                self.assertEqual(
                    json.loads(output_path.read_text(encoding="utf-8")),
                    expected_bundle,
                )


if __name__ == "__main__":
    unittest.main()
