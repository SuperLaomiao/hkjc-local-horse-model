#!/usr/bin/env python3
"""Gate market-aware research on leakage-safe chronological snapshot coverage."""

import argparse
import json
import math
import sqlite3
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


GATE_VERSION = "market-aware-research-gate-v1"
SPLIT_POLICY = "market-cohort-chronological-v1"
REQUIRED_POOLS = ("WIN", "PLACE")
WINDOWS = {
    "T-30": (21, 45),
    "T-10": (6, 20),
    "T-3": (1, 5),
}
ACTIVE_SELL_STATUSES = {"SELLING", "OPEN", "SALE_OPEN"}
MISSING_STATUS_SOURCES = {"eprochasson/horserace_data"}


def build_market_research_gate(
    snapshots,
    *,
    decision_window="T-10",
    min_races_per_split=100,
    min_complete_coverage=0.95,
):
    """Create a date-safe market cohort and decide whether research training may run."""
    if decision_window not in WINDOWS:
        raise ValueError(f"unsupported decision window {decision_window!r}")
    min_races = _positive_int(min_races_per_split, "min_races_per_split")
    coverage_threshold = _bounded_ratio(min_complete_coverage, "min_complete_coverage")
    if not isinstance(snapshots, list):
        raise ValueError("snapshots must be a list")

    valid_rows = []
    quality = {
        "inputRows": len(snapshots),
        "acceptedRows": 0,
        "rejectedPostOrUnknown": 0,
        "rejectedMissingTimestamp": 0,
        "rejectedSellStatus": 0,
        "rejectedOtherWindow": 0,
    }
    for row in snapshots:
        normalized, reason = _normalize_snapshot(row, decision_window)
        if normalized is not None:
            valid_rows.append(normalized)
            quality["acceptedRows"] += 1
        elif reason in quality:
            quality[reason] += 1

    race_books = defaultdict(lambda: {"date": None, "pools": set()})
    for row in valid_rows:
        book = race_books[row["raceId"]]
        if book["date"] is not None and book["date"] != row["date"]:
            raise ValueError(f"race {row['raceId']} spans multiple dates")
        book["date"] = row["date"]
        book["pools"].add(row["pool"])

    dates = sorted({book["date"] for book in race_books.values() if book["date"]})
    date_splits = _chronological_date_splits(dates)
    race_assignments = {
        race_id: date_splits.get(book["date"])
        for race_id, book in sorted(race_books.items())
        if date_splits.get(book["date"])
    }
    split_summaries = {
        split: _summarize_split(split, race_books, race_assignments)
        for split in ("train", "validation", "holdout")
    }

    reasons = []
    if len(dates) < 3:
        reasons.append("market cohort requires at least three distinct race dates")
    for split, summary in split_summaries.items():
        if summary["completePoolRaces"] < min_races:
            reasons.append(
                f"{split} has {summary['completePoolRaces']} complete WIN/PLACE races; "
                f"requires at least {min_races}"
            )
        if summary["completePoolCoverage"] < coverage_threshold:
            reasons.append(
                f"{split} complete WIN/PLACE coverage {summary['completePoolCoverage']:.4f} "
                f"is below {coverage_threshold:.4f}"
            )

    status = "READY_RESEARCH" if not reasons else "BLOCKED_DATA"
    return {
        "version": GATE_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "status": status,
        "trainingAllowed": status == "READY_RESEARCH",
        "cashMode": "NO_BET",
        "decisionWindow": decision_window,
        "requiredPools": list(REQUIRED_POOLS),
        "splitPolicy": SPLIT_POLICY,
        "thresholds": {
            "minRacesPerSplit": min_races,
            "minCompleteCoverage": coverage_threshold,
        },
        "cohort": {
            "races": len(race_books),
            "dates": len(dates),
            "firstDate": dates[0] if dates else None,
            "lastDate": dates[-1] if dates else None,
        },
        "splits": split_summaries,
        "quality": quality,
        "reasons": reasons,
        "raceAssignments": race_assignments,
        "prospectivePromotion": {
            "status": "BLOCKED_DATA",
            "cashMode": "NO_BET",
            "reason": "requires locked 2026 pre-race decisions, final prices, and settlements",
        },
        "note": (
            "READY_RESEARCH permits historical model comparison only. It never promotes cash mode; "
            "2026 prospective evidence is a separate gate."
        ),
    }


def load_market_snapshot_books(db_path):
    """Read one compact race/pool/window record per settled race from SQLite."""
    connection = sqlite3.connect(f"file:{Path(db_path).resolve()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        rows = connection.execute(
            """
            SELECT
              odds.race_id AS race_id,
              COALESCE(odds.date, races.date) AS date,
              UPPER(odds.pool_key) AS pool,
              CASE
                WHEN odds.minutes_to_post BETWEEN 21 AND 45 THEN 'T-30'
                WHEN odds.minutes_to_post BETWEEN 6 AND 20 THEN 'T-10'
                WHEN odds.minutes_to_post BETWEEN 1 AND 5 THEN 'T-3'
              END AS market_window,
              MIN(odds.captured_at) AS captured_at,
              MAX(odds.sell_status) AS sell_status,
              MAX(odds.source) AS source
            FROM odds_snapshots AS odds
            INNER JOIN races ON races.race_id = odds.race_id
            WHERE races.status = 'settled'
              AND LOWER(odds.pool_key) IN ('win', 'place')
              AND odds.minutes_to_post BETWEEN 1 AND 45
            GROUP BY odds.race_id, COALESCE(odds.date, races.date), UPPER(odds.pool_key), market_window
            """
        ).fetchall()
    finally:
        connection.close()
    return [
        {
            "raceId": row["race_id"],
            "date": row["date"],
            "pool": row["pool"],
            "marketWindow": row["market_window"],
            "capturedAt": row["captured_at"],
            "sellStatus": row["sell_status"],
            "source": row["source"],
        }
        for row in rows
    ]


def _normalize_snapshot(row, decision_window):
    if not isinstance(row, dict):
        return None, "rejectedPostOrUnknown"
    minutes = _finite_number(row.get("minutesToPost"))
    explicit_window = row.get("marketWindow")
    if explicit_window in WINDOWS:
        market_window = explicit_window
    elif minutes is None or minutes <= 0:
        return None, "rejectedPostOrUnknown"
    else:
        market_window = _window_for_minutes(minutes)
    if market_window is None:
        return None, "rejectedOtherWindow"
    if market_window != decision_window:
        return None, "rejectedOtherWindow"

    race_id = _clean_text(row.get("raceId"))
    date = _clean_text(row.get("date"))
    captured_at = _clean_text(row.get("capturedAt"))
    pool = _normalize_pool(row.get("pool") or row.get("poolKey"))
    if not race_id or not date or pool not in REQUIRED_POOLS:
        return None, "rejectedPostOrUnknown"
    if not captured_at:
        return None, "rejectedMissingTimestamp"

    sell_status = _clean_text(row.get("sellStatus"))
    source = _clean_text(row.get("source"))
    if sell_status and sell_status.upper() not in ACTIVE_SELL_STATUSES:
        return None, "rejectedSellStatus"
    if not sell_status and source not in MISSING_STATUS_SOURCES:
        return None, "rejectedSellStatus"
    return {
        "raceId": race_id,
        "date": date,
        "pool": pool,
        "marketWindow": market_window,
        "capturedAt": captured_at,
        "source": source,
    }, None


def _chronological_date_splits(dates):
    if not dates:
        return {}
    if len(dates) < 3:
        return {date: "train" for date in dates}
    train_end = min(max(1, math.floor(len(dates) * 0.70)), len(dates) - 2)
    validation_end = min(
        max(train_end + 1, math.floor(len(dates) * 0.85)),
        len(dates) - 1,
    )
    return {
        date: "train" if index < train_end else "validation" if index < validation_end else "holdout"
        for index, date in enumerate(dates)
    }


def _summarize_split(split, race_books, assignments):
    selected = [
        (race_id, book)
        for race_id, book in race_books.items()
        if assignments.get(race_id) == split
    ]
    dates = sorted({book["date"] for _, book in selected})
    pool_counts = {
        pool: sum(pool in book["pools"] for _, book in selected)
        for pool in REQUIRED_POOLS
    }
    complete = sum(all(pool in book["pools"] for pool in REQUIRED_POOLS) for _, book in selected)
    race_count = len(selected)
    return {
        "candidateRaces": race_count,
        "completePoolRaces": complete,
        "completePoolCoverage": round(complete / race_count, 6) if race_count else 0.0,
        "firstDate": dates[0] if dates else None,
        "lastDate": dates[-1] if dates else None,
        "pools": {
            pool: {
                "races": pool_counts[pool],
                "coverage": round(pool_counts[pool] / race_count, 6) if race_count else 0.0,
            }
            for pool in REQUIRED_POOLS
        },
    }


def _window_for_minutes(minutes):
    for label, (minimum, maximum) in WINDOWS.items():
        if minimum <= minutes <= maximum:
            return label
    return None


def _normalize_pool(value):
    normalized = _clean_text(value).upper() if value is not None else ""
    return {"W": "WIN", "PLA": "PLACE"}.get(normalized, normalized)


def _finite_number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _clean_text(value):
    return value.strip() if isinstance(value, str) else ""


def _positive_int(value, label):
    if isinstance(value, bool):
        raise ValueError(f"{label} must be a positive integer")
    number = int(value)
    if number <= 0 or number != float(value):
        raise ValueError(f"{label} must be a positive integer")
    return number


def _bounded_ratio(value, label):
    number = float(value)
    if not math.isfinite(number) or not 0 < number <= 1:
        raise ValueError(f"{label} must be greater than 0 and at most 1")
    return number


def main():
    parser = argparse.ArgumentParser(description="Audit market-aware research coverage before training.")
    parser.add_argument("--db", required=True)
    parser.add_argument("--window", default="T-10", choices=tuple(WINDOWS))
    parser.add_argument("--min-races-per-split", type=int, default=100)
    parser.add_argument("--min-complete-coverage", type=float, default=0.95)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    report = build_market_research_gate(
        load_market_snapshot_books(args.db),
        decision_window=args.window,
        min_races_per_split=args.min_races_per_split,
        min_complete_coverage=args.min_complete_coverage,
    )
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"Market-aware gate: {report['status']} | window {report['decisionWindow']} | "
        f"cohort {report['cohort']['races']} races"
    )
    for split, summary in report["splits"].items():
        print(
            f"{split}: {summary['completePoolRaces']}/{summary['candidateRaces']} complete "
            f"WIN/PLACE races"
        )
    print(f"Saved market-aware research gate to {output_path}")


if __name__ == "__main__":
    main()
