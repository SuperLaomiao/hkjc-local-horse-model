import sys
import unittest
from pathlib import Path


PYTHON_DIR = Path(__file__).resolve().parent
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))

from train_market_aware_stack import build_market_research_gate  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()
