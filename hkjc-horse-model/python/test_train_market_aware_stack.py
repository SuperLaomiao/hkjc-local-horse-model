import sys
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch


PYTHON_DIR = Path(__file__).resolve().parent
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))

from train_market_aware_stack import (  # noqa: E402
    build_market_research_gate,
    main,
    write_market_cohort_matrix,
)


class MarketAwareResearchGateTest(unittest.TestCase):
    def test_builds_date_safe_market_cohort_splits_for_research_only(self):
        snapshots = market_snapshots(date_count=20, races_per_date=2)

        report = build_market_research_gate(
            snapshots,
            decision_window="T-10",
            min_races_per_split=4,
        )

        self.assertEqual(report["status"], "READY_RESEARCH")
        self.assertTrue(report["trainingAllowed"])
        self.assertEqual(report["cashMode"], "NO_BET")
        self.assertEqual(report["splitPolicy"], "market-cohort-chronological-v1")
        self.assertLess(
            report["splits"]["train"]["lastDate"],
            report["splits"]["validation"]["firstDate"],
        )
        self.assertLess(
            report["splits"]["validation"]["lastDate"],
            report["splits"]["holdout"]["firstDate"],
        )
        self.assertEqual(report["splits"]["holdout"]["completePoolCoverage"], 1.0)
        self.assertEqual(report["prospectivePromotion"]["status"], "BLOCKED_DATA")

    def test_blocks_research_when_validation_or_holdout_lacks_both_win_and_place(self):
        snapshots = market_snapshots(date_count=20, races_per_date=2)
        for item in snapshots:
            if item["date"] >= "2018-01-15" and item["pool"] == "PLACE":
                item["minutesToPost"] = 60

        report = build_market_research_gate(
            snapshots,
            decision_window="T-10",
            min_races_per_split=4,
            min_complete_coverage=0.95,
        )

        self.assertEqual(report["status"], "BLOCKED_DATA")
        self.assertFalse(report["trainingAllowed"])
        self.assertTrue(any("holdout" in reason for reason in report["reasons"]))
        self.assertEqual(report["splits"]["holdout"]["pools"]["PLACE"]["races"], 0)

    def test_rejects_post_time_and_unknown_window_snapshots(self):
        snapshots = market_snapshots(date_count=20, races_per_date=2)
        snapshots.extend([
            snapshot("POST", "2018-02-01", "WIN", 0),
            snapshot("UNKNOWN", "2018-02-02", "PLACE", None),
        ])

        report = build_market_research_gate(
            snapshots,
            decision_window="T-10",
            min_races_per_split=4,
        )

        self.assertEqual(report["quality"]["rejectedPostOrUnknown"], 2)
        self.assertNotIn("POST", report["raceAssignments"])
        self.assertNotIn("UNKNOWN", report["raceAssignments"])

    def test_writes_identical_cohort_matrix_with_remapped_splits_and_no_later_window(self):
        gate = build_market_research_gate(
            market_snapshots(date_count=20, races_per_date=1),
            decision_window="T-10",
            min_races_per_split=2,
        )
        assigned_by_split = {
            split: next(
                race_id
                for race_id, assigned_split in gate["raceAssignments"].items()
                if assigned_split == split
            )
            for split in ("train", "validation", "holdout")
        }
        rows = [
            matrix_row(race_id, "stale-original-split")
            for race_id in assigned_by_split.values()
        ] + [matrix_row("not-in-market-cohort", "holdout")]

        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = Path(temp_dir) / "input.jsonl"
            output_path = Path(temp_dir) / "cohort.jsonl"
            input_path.write_text(
                "".join(json.dumps(row) + "\n" for row in rows),
                encoding="utf-8",
            )

            report = write_market_cohort_matrix(input_path, output_path, gate)
            output_rows = [
                json.loads(line)
                for line in output_path.read_text(encoding="utf-8").splitlines()
            ]

        self.assertEqual(report["status"], "READY_RESEARCH")
        self.assertEqual(report["rows"], 3)
        self.assertEqual(
            {row["split"] for row in output_rows},
            {"train", "validation", "holdout"},
        )
        self.assertIn("marketWinOddsT10", output_rows[0])
        self.assertIn("marketPlaceOddsT10", output_rows[0])
        self.assertNotIn("marketWinOddsT3", output_rows[0])
        self.assertEqual(report["bothOddsCoverage"], 1.0)

    def test_refuses_to_write_training_matrix_when_gate_is_blocked(self):
        gate = build_market_research_gate([], min_races_per_split=2)
        with tempfile.TemporaryDirectory() as temp_dir:
            input_path = Path(temp_dir) / "input.jsonl"
            output_path = Path(temp_dir) / "cohort.jsonl"
            input_path.write_text("", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "BLOCKED_DATA"):
                write_market_cohort_matrix(input_path, output_path, gate)

    def test_cli_can_write_gate_report_and_matching_cohort_matrix(self):
        rows = [
            matrix_row(f"2018-01-{day:02d}-ST-1", "stale")
            for day in range(1, 21)
        ]
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            input_path = temp_path / "input.jsonl"
            matrix_output = temp_path / "cohort.jsonl"
            report_output = temp_path / "gate.json"
            input_path.write_text(
                "".join(json.dumps(row) + "\n" for row in rows),
                encoding="utf-8",
            )
            arguments = [
                "train_market_aware_stack.py",
                "--db", str(temp_path / "unused.sqlite"),
                "--window", "T-10",
                "--min-races-per-split", "2",
                "--output", str(report_output),
                "--input-matrix", str(input_path),
                "--matrix-output", str(matrix_output),
            ]
            with patch.object(sys, "argv", arguments), patch(
                "train_market_aware_stack.load_market_snapshot_books",
                return_value=market_snapshots(date_count=20, races_per_date=1),
            ), redirect_stdout(StringIO()):
                main()

            report = json.loads(report_output.read_text(encoding="utf-8"))

        self.assertEqual(report["status"], "READY_RESEARCH")
        self.assertEqual(report["matrix"]["status"], "READY_RESEARCH")
        self.assertEqual(report["matrix"]["rows"], 20)


def market_snapshots(date_count, races_per_date):
    rows = []
    for day in range(1, date_count + 1):
        date = f"2018-01-{day:02d}"
        for race_no in range(1, races_per_date + 1):
            race_id = f"{date}-ST-{race_no}"
            rows.append(snapshot(race_id, date, "WIN", 10))
            rows.append(snapshot(race_id, date, "PLACE", 10))
    return rows


def snapshot(race_id, date, pool, minutes_to_post):
    return {
        "raceId": race_id,
        "date": date,
        "pool": pool,
        "minutesToPost": minutes_to_post,
        "capturedAt": f"{date}T04:00:00.000Z",
        "source": "eprochasson/horserace_data",
    }


def matrix_row(race_id, split):
    return {
        "raceId": race_id,
        "date": race_id[:10],
        "split": split,
        "horseId": "H1",
        "horseNo": 1,
        "racecourse": "ST",
        "raceNo": 1,
        "fieldSize": 10,
        "targetWin": 1,
        "targetPlace": 1,
        "horseRunsBefore": 3,
        "marketWinOddsT30": 5.5,
        "marketPlaceOddsT30": 2.1,
        "marketWinOddsT10": 5.8,
        "marketPlaceOddsT10": 2.2,
        "marketWinOddsT3": 6.0,
        "marketPlaceOddsT3": 2.3,
    }


if __name__ == "__main__":
    unittest.main()
