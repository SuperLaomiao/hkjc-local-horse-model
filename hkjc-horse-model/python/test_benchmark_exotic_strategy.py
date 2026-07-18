import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


PYTHON_DIR = Path(__file__).resolve().parent
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))

from benchmark_exotic_strategy import (  # noqa: E402
    MissingDependencyError,
    benchmark_exotic_strategies,
    build_model_bundle,
    main,
    settle_race_strategy,
)


def _rows():
    rows = []
    for split, race_ids in (("validation", ("V1", "V2")), ("holdout", ("H1",))):
        for race_id in race_ids:
            for horse_no in (1, 2, 3, 4):
                rows.append({
                    "raceId": race_id,
                    "date": "2026-01-01" if split == "validation" else "2026-02-01",
                    "split": split,
                    "horseId": f"{race_id}-{horse_no}",
                    "horseNo": horse_no,
                    "racecourse": "ST",
                    "raceNo": int(race_id[1:]),
                    "fieldSize": 4,
                    "targetWin": int(horse_no == 1),
                    "targetPlace": int(horse_no <= 3),
                    "speed": horse_no,
                })
    return rows


def _db(connection, dividends):
    connection.execute(
        """
        CREATE TABLE dividends (
            race_id TEXT NOT NULL,
            pool_key TEXT NOT NULL,
            combination_json TEXT NOT NULL,
            dividend_per10 REAL NOT NULL
        )
        """
    )
    connection.executemany(
        "INSERT INTO dividends VALUES (?, ?, ?, ?)",
        dividends,
    )
    connection.commit()
    return connection


def _write_fixture(directory):
    root = Path(directory)
    matrix = root / "matrix.jsonl"
    report = root / "reports" / "model-report.json"
    manifest = root / "reports" / "model-report.feature-manifest.json"
    model = root / "reports" / "model-report.model.txt"
    matrix.parent.mkdir(parents=True, exist_ok=True)
    report.parent.mkdir(parents=True, exist_ok=True)
    matrix.write_text("\n".join(json.dumps(row) for row in _rows()) + "\n", encoding="utf-8")
    manifest.write_text(json.dumps({
        "features": ["speed"],
        "featureTypes": {"speed": "numeric"},
        "categoricalMappings": {},
        "unknownCategoryValue": -1,
    }), encoding="utf-8")
    model.write_text("mock model", encoding="utf-8")
    report.write_text(json.dumps({
        "modelId": "lightgbm-no-market-v1",
        "featureManifest": manifest.name,
        "modelArtifact": model.name,
        "effectiveIterations": 11,
        "fitSplits": ["train"],
        "validationIsInSample": False,
        "metrics": {"bySplit": {
            "validation": {"isOutOfSample": True},
            "holdout": {"isOutOfSample": True},
        }},
    }), encoding="utf-8")
    return matrix, report, manifest, model


class ExoticStrategySettlementTest(unittest.TestCase):
    def test_hit_and_miss_and_box_three_combinations(self):
        dividend_map = {
            ("R1", "quinella"): {
                (1, 2): 25.0,
            },
            ("R1", "quinellaPlace"): {
                (1, 2): 12.0,
                (1, 3): 14.0,
                (2, 3): 16.0,
            },
        }
        ranked = [(1, 0.7), (2, 0.2), (3, 0.1)]

        qin = settle_race_strategy("R1", "2026-01-01", "top2-quinella", ranked, dividend_map)
        qpl = settle_race_strategy("R1", "2026-01-01", "top3-box-qpl", ranked, dividend_map)

        self.assertTrue(qin["eligible"])
        self.assertEqual(qin["selections"], [[1, 2]])
        self.assertEqual(qin["bets"], 1)
        self.assertEqual(qin["hits"], 1)
        self.assertEqual(qin["stake"], 10.0)
        self.assertEqual(qin["return"], 25.0)
        self.assertEqual(qpl["selections"], [[1, 2], [1, 3], [2, 3]])
        self.assertEqual(qpl["bets"], 3)
        self.assertEqual(qpl["hits"], 3)
        self.assertEqual(qpl["stake"], 30.0)
        self.assertEqual(qpl["return"], 42.0)

    def test_missing_pool_is_ineligible_not_a_loss(self):
        result = settle_race_strategy(
            "R2", "2026-01-01", "top2-quinella",
            [(8, 0.8), (1, 0.2)], {},
        )

        self.assertFalse(result["eligible"])
        self.assertEqual(result["skipReason"], "missing_official_dividend")
        self.assertEqual(result["stake"], 0.0)
        self.assertEqual(result["return"], 0.0)


class ExoticStrategyBenchmarkTest(unittest.TestCase):
    @staticmethod
    def _predictor(rows, features, report, manifest, model_path):
        # The top two are deliberately 2 and 1, with ties resolved by horseNo.
        return [0.9 if row["horseNo"] == 2 else 0.8 if row["horseNo"] == 1 else 0.1 for row in rows]

    def test_splits_metrics_coverage_drawdown_and_losing_run(self):
        with tempfile.TemporaryDirectory() as directory:
            matrix, report, _manifest, _model = _write_fixture(directory)
            db = _db(sqlite3.connect(":memory:"), [
                ("V1", "quinella", "[1, 2]", 25.0),
                ("V1", "quinellaPlace", "[1, 2]", 12.0),
                ("V1", "quinellaPlace", "[1, 3]", 14.0),
                ("V1", "quinellaPlace", "[2, 3]", 16.0),
                ("V2", "quinella", "[3, 4]", 30.0),
                ("V2", "quinellaPlace", "[1, 4]", 11.0),
                ("H1", "quinella", "[1, 2]", 20.0),
                ("H1", "quinellaPlace", "[1, 2]", 10.0),
                ("H1", "quinellaPlace", "[1, 3]", 10.0),
                ("H1", "quinellaPlace", "[2, 3]", 10.0),
            ])
            result = benchmark_exotic_strategies(
                matrix, report, db, predictor=self._predictor,
            )

        validation = result["metricsBySplit"]["validation"]
        self.assertEqual(result["input"]["racesBySplit"], {"validation": 2, "holdout": 1})
        self.assertEqual(set(validation), {
            "top2-quinella", "top2-qpl", "top3-box-quinella", "top3-box-qpl",
        })
        self.assertEqual(validation["top2-quinella"]["racesTotal"], 2)
        self.assertEqual(validation["top2-quinella"]["racesEligible"], 2)
        self.assertEqual(validation["top2-quinella"]["bets"], 2)
        self.assertEqual(validation["top2-quinella"]["hits"], 1)
        self.assertEqual(validation["top2-quinella"]["stake"], 20.0)
        self.assertEqual(validation["top2-quinella"]["returns"], 25.0)
        self.assertEqual(validation["top2-quinella"]["profit"], 5.0)
        self.assertAlmostEqual(validation["top2-quinella"]["ROI"], 0.25)
        self.assertEqual(validation["top3-box-quinella"]["racesEligible"], 2)
        self.assertEqual(validation["top3-box-quinella"]["bets"], 6)
        self.assertEqual(validation["top3-box-quinella"]["hits"], 1)
        self.assertEqual(validation["top3-box-quinella"]["maxDrawdown"], 35.0)
        self.assertEqual(validation["top3-box-quinella"]["longestLosingRun"], 2)
        self.assertEqual(validation["top3-box-quinella"]["coverage"], 1.0)
        self.assertTrue(validation["top2-quinella"]["isOutOfSample"])
        self.assertTrue(result["metricsBySplit"]["holdout"]["top2-quinella"]["isOutOfSample"])

    def test_ledger_is_compact_and_stable(self):
        with tempfile.TemporaryDirectory() as directory:
            matrix, report, _manifest, _model = _write_fixture(directory)
            db = _db(sqlite3.connect(":memory:"), [
                ("V1", "quinella", "[1, 2]", 25.0),
                ("V1", "quinellaPlace", "[1, 2]", 12.0),
                ("V1", "quinellaPlace", "[1, 3]", 14.0),
                ("V1", "quinellaPlace", "[2, 3]", 16.0),
            ])
            ledger = Path(directory) / "ledger.jsonl"
            result = benchmark_exotic_strategies(
                matrix, report, db, output_path=Path(directory) / "out.json",
                ledger_output=ledger, predictor=self._predictor,
            )

            lines = [json.loads(line) for line in ledger.read_text().splitlines()]
            self.assertEqual(len(lines), 12)
            self.assertEqual(lines[0]["split"], "validation")
            self.assertEqual(lines[0]["race"], "V1")
            self.assertEqual(lines[0]["strategy"], "top2-quinella")
            self.assertEqual(lines[0]["selections"], [[1, 2]])
            self.assertIn("eligible", lines[0])
            self.assertEqual(result["ledger"]["rows"], 12)

    def test_manifest_and_model_paths_resolve_relative_to_report(self):
        with tempfile.TemporaryDirectory() as directory:
            _matrix, report, manifest, model = _write_fixture(directory)
            bundle = build_model_bundle(report)
            self.assertEqual(bundle["featureManifest"], manifest.resolve())
            self.assertEqual(bundle["modelArtifact"], model.resolve())

    def test_rejects_race_id_that_appears_across_splits(self):
        with tempfile.TemporaryDirectory() as directory:
            matrix, report, _manifest, _model = _write_fixture(directory)
            rows = [json.loads(line) for line in matrix.read_text(encoding="utf-8").splitlines()]
            for row in rows:
                if row["raceId"] == "H1":
                    row["raceId"] = "V1"
            matrix.write_text(
                "\n".join(json.dumps(row) for row in rows) + "\n",
                encoding="utf-8",
            )
            db = _db(sqlite3.connect(":memory:"), [])
            with self.assertRaisesRegex(
                ValueError,
                "Benchmark raceId 'V1' appears in multiple splits: holdout, validation",
            ):
                benchmark_exotic_strategies(
                    matrix, report, db, predictor=self._predictor,
                )

    def test_final_refit_marks_validation_in_sample_and_holdout_oos(self):
        with tempfile.TemporaryDirectory() as directory:
            matrix, report, _manifest, _model = _write_fixture(directory)
            report_value = json.loads(report.read_text(encoding="utf-8"))
            report_value["fitSplits"] = ["train", "validation"]
            report_value["validationIsInSample"] = True
            report_value["metrics"]["bySplit"]["validation"]["isOutOfSample"] = False
            report.write_text(json.dumps(report_value), encoding="utf-8")
            db = _db(sqlite3.connect(":memory:"), [
                ("V1", "quinella", "[1, 2]", 25.0),
                ("V1", "quinellaPlace", "[1, 2]", 12.0),
                ("V1", "quinellaPlace", "[1, 3]", 14.0),
                ("V1", "quinellaPlace", "[2, 3]", 16.0),
            ])
            result = benchmark_exotic_strategies(
                matrix, report, db, predictor=self._predictor,
            )
            self.assertFalse(result["splitStatus"]["validation"]["isOutOfSample"])
            self.assertTrue(result["splitStatus"]["validation"]["isInSample"])
            self.assertTrue(result["splitStatus"]["holdout"]["isOutOfSample"])

    def test_cli_missing_dependency_is_clear(self):
        with tempfile.TemporaryDirectory() as directory:
            matrix, report, _manifest, _model = _write_fixture(directory)
            with patch(
                "benchmark_exotic_strategy._require_lightgbm",
                side_effect=MissingDependencyError("Missing required Python dependency: lightgbm"),
            ):
                with self.assertRaises(SystemExit) as error:
                    main([
                        "--matrix", str(matrix),
                        "--model-report", str(report),
                        "--db", str(Path(directory) / "missing.sqlite"),
                        "--output", str(Path(directory) / "out.json"),
                    ])
            self.assertIn("lightgbm", str(error.exception))


if __name__ == "__main__":
    unittest.main()
