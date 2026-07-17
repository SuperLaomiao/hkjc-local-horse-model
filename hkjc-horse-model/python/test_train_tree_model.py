import json
import math
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


PYTHON_DIR = Path(__file__).resolve().parent
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))

from train_tree_model import (  # noqa: E402
    compute_split_metrics,
    fit_feature_encoder,
    normalize_race_probabilities,
    select_feature_columns,
    transform_feature_rows,
)


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
            self.assertTrue(Path(report["modelArtifact"]).exists())
            self.assertTrue(Path(report["featureManifest"]).exists())


if __name__ == "__main__":
    unittest.main()
