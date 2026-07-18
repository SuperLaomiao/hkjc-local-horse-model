import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path


PYTHON_DIR = Path(__file__).resolve().parent
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))

from build_exotic_pair_matrix import build_exotic_pair_matrix, main  # noqa: E402


class ExoticPairMatrixTest(unittest.TestCase):
    def test_builds_canonical_qin_pairs_and_excludes_missing_pool_races(self):
        result = build_exotic_pair_matrix(
            runner_rows=_runner_rows(),
            dividends={
                ("R1", "quinella"): {(1, 2): 25.0},
            },
            pool="quinella",
        )

        self.assertEqual(result["quality"]["inputRaces"], 2)
        self.assertEqual(result["quality"]["eligibleRaces"], 1)
        self.assertEqual(result["quality"]["excludedMissingPoolRaces"], 1)
        self.assertEqual(result["quality"]["pairs"], 3)
        self.assertEqual(result["quality"]["positives"], 1)
        self.assertEqual(
            [(row["horseNoA"], row["horseNoB"]) for row in result["rows"]],
            [(1, 2), (1, 3), (2, 3)],
        )
        self.assertEqual(
            [row["targetPair"] for row in result["rows"]],
            [1, 0, 0],
        )

        pair = result["rows"][0]
        self.assertEqual(pair["pairKey"], "1-2")
        self.assertEqual(pair["distance"], 1200)
        self.assertEqual(pair["racecourse"], "ST")
        self.assertEqual(pair["speedLow"], 80.0)
        self.assertEqual(pair["speedHigh"], 90.0)
        self.assertEqual(pair["speedMean"], 85.0)
        self.assertEqual(pair["speedAbsDiff"], 10.0)
        self.assertEqual(pair["speedProduct"], 7200.0)
        self.assertEqual(pair["jockeyPair"], "J1|J2")
        self.assertEqual(pair["jockeySame"], 0)
        self.assertNotIn("targetWin", pair)
        self.assertNotIn("targetPlace", pair)
        self.assertNotIn("dividendPer10", pair)

    def test_qpl_labels_each_official_winning_pair_without_order_dependence(self):
        rows = list(reversed(_runner_rows(include_second_race=False)))
        result = build_exotic_pair_matrix(
            runner_rows=rows,
            dividends={
                ("R1", "quinellaPlace"): {
                    (2, 1): 12.0,
                    (3, 1): 14.0,
                    (3, 2): 16.0,
                },
            },
            pool="quinellaPlace",
        )

        self.assertEqual(result["quality"]["positives"], 3)
        self.assertEqual(
            [(row["pairKey"], row["targetPair"]) for row in result["rows"]],
            [("1-2", 1), ("1-3", 1), ("2-3", 1)],
        )
        self.assertEqual(result["rows"][0]["jockeyPair"], "J1|J2")

    def test_rejects_a_race_that_crosses_chronological_splits(self):
        rows = _runner_rows(include_second_race=False)
        rows[-1] = {**rows[-1], "split": "holdout"}

        with self.assertRaisesRegex(ValueError, "R1.*multiple splits"):
            build_exotic_pair_matrix(
                runner_rows=rows,
                dividends={("R1", "quinella"): {(1, 2): 25.0}},
                pool="quinella",
            )

    def test_cli_writes_pair_jsonl_and_quality_report(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            matrix = root / "runner.jsonl"
            database = root / "races.sqlite"
            output = root / "qin-pairs.jsonl"
            report = root / "qin-pairs.report.json"
            matrix.write_text(
                "\n".join(json.dumps(row) for row in _runner_rows(include_second_race=False)) + "\n",
                encoding="utf-8",
            )
            connection = sqlite3.connect(database)
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
            connection.execute(
                "INSERT INTO dividends VALUES (?, ?, ?, ?)",
                ("R1", "quinella", "[2, 1]", 25.0),
            )
            connection.commit()
            connection.close()

            main([
                "--input", str(matrix),
                "--db", str(database),
                "--pool", "quinella",
                "--output", str(output),
                "--report", str(report),
            ])

            pair_rows = [json.loads(line) for line in output.read_text(encoding="utf-8").splitlines()]
            quality = json.loads(report.read_text(encoding="utf-8"))
            self.assertEqual(len(pair_rows), 3)
            self.assertEqual(sum(row["targetPair"] for row in pair_rows), 1)
            self.assertEqual(quality["pool"], "quinella")
            self.assertEqual(quality["quality"]["eligibleRaces"], 1)


def _runner_rows(include_second_race=True):
    rows = [
        _runner("R1", 3, 70, "J3", 0, 1),
        _runner("R1", 1, 90, "J1", 1, 1),
        _runner("R1", 2, 80, "J2", 0, 1),
    ]
    if include_second_race:
        rows.extend([
            _runner("R2", 1, 75, "J1", 1, 1, split="holdout"),
            _runner("R2", 2, 74, "J2", 0, 1, split="holdout"),
        ])
    return rows


def _runner(race_id, horse_no, speed, jockey, target_win, target_place, split="train"):
    return {
        "raceId": race_id,
        "date": "2026-01-01" if split == "train" else "2026-02-01",
        "split": split,
        "horseId": f"{race_id}-H{horse_no}",
        "horseNo": horse_no,
        "fieldSize": 3,
        "racecourse": "ST",
        "raceNo": 1,
        "distance": 1200,
        "surface": "TURF",
        "going": "GOOD",
        "speed": speed,
        "jockey": jockey,
        "targetWin": target_win,
        "targetPlace": target_place,
    }


if __name__ == "__main__":
    unittest.main()
