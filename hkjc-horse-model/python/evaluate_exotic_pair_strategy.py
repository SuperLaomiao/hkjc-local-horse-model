#!/usr/bin/env python3
"""Settle blind top-pair QIN/QPL predictions against official dividends."""

import argparse
import json
import math
from collections import defaultdict
from pathlib import Path

from build_exotic_pair_matrix import SUPPORTED_POOLS, load_exotic_dividends


REPORT_VERSION = "exotic-pair-strategy-v1"
UNIT_BET = 10.0
SPLITS = ("validation", "holdout")
SOURCES = {
    "model": "modelProbability",
    "marketBaseline": "marketBaselineProbability",
    "selectedStack": "selectedProbability",
}
REQUIRED_BOOK_WINDOWS = ("T-30", "T-10", "T-3")
DEFAULT_MIN_BOOK_RACES = 100
DEFAULT_MIN_BOOK_COVERAGE = 0.75


def evaluate_pair_strategies(
    rows,
    dividends,
    *,
    pool,
    combination_book_coverage=None,
    minimum_book_races=DEFAULT_MIN_BOOK_RACES,
    minimum_book_coverage=DEFAULT_MIN_BOOK_COVERAGE,
):
    """Evaluate one fixed top-pair selection per race for each probability source."""
    if pool not in SUPPORTED_POOLS:
        raise ValueError(f"unsupported exotic pool {pool!r}")
    combination_book_gate = evaluate_combination_book_gate(
        combination_book_coverage,
        pool=pool,
        minimum_book_races=minimum_book_races,
        minimum_book_coverage=minimum_book_coverage,
    )
    if combination_book_gate["status"] != "READY":
        return {
            "version": REPORT_VERSION,
            "pool": pool,
            "unitBet": UNIT_BET,
            "state": "BLOCKED_DATA",
            "cashMode": "NO_BET",
            "executionStatus": "PAPER_ONLY",
            "valueStatus": "RESEARCH_ONLY",
            "reason": "verified T-30/T-10/T-3 combination books have not passed the declared gate",
            "combinationBookGate": combination_book_gate,
            "metricsBySplit": {},
            "ledger": [],
        }
    grouped = {split: defaultdict(list) for split in SPLITS}
    race_splits = defaultdict(set)
    for index, row in enumerate(rows, start=1):
        race_id = str(row.get("raceId") or "").strip()
        split = str(row.get("split") or "").strip()
        if not race_id or not split:
            raise ValueError(f"prediction row {index} is missing raceId or split")
        race_splits[race_id].add(split)
        if split not in SPLITS:
            continue
        if str(row.get("poolKey")) != pool:
            raise ValueError(
                f"prediction row {index} pool {row.get('poolKey')!r} does not match {pool!r}"
            )
        _pair(row)
        for field in SOURCES.values():
            _probability(row.get(field), field, index)
        grouped[split][race_id].append(row)
    for race_id, splits in race_splits.items():
        if len(splits) > 1:
            raise ValueError(
                f"race {race_id!r} appears in multiple splits: {', '.join(sorted(splits))}"
            )

    metrics_by_split = {}
    ledger = []
    for split in SPLITS:
        race_groups = grouped[split]
        split_metrics = {}
        for source, probability_field in SOURCES.items():
            settlements = []
            for race_id in sorted(race_groups, key=lambda value: _race_sort_key(race_groups[value])):
                race_rows = race_groups[race_id]
                selected = sorted(
                    race_rows,
                    key=lambda row: (
                        -float(row[probability_field]),
                        str(row.get("pairKey") or ""),
                    ),
                )[0]
                pair = _pair(selected)
                pool_dividends = dividends.get((race_id, pool))
                eligible = bool(pool_dividends)
                returned = float(pool_dividends.get(pair, 0.0)) if eligible else 0.0
                settlement = {
                    "split": split,
                    "raceId": race_id,
                    "date": selected.get("date"),
                    "poolKey": pool,
                    "source": source,
                    "pairKey": selected.get("pairKey"),
                    "combination": list(pair),
                    "probability": _round(float(selected[probability_field])),
                    "eligible": eligible,
                    "skipReason": None if eligible else "missing_official_dividend",
                    "stake": UNIT_BET if eligible else 0.0,
                    "return": _money(returned),
                    "profit": _money(returned - UNIT_BET) if eligible else 0.0,
                    "hit": bool(returned > 0),
                }
                settlements.append(settlement)
                ledger.append(settlement)
            split_metrics[source] = _aggregate(
                settlements,
                races_total=len(race_groups),
                is_out_of_sample=split == "holdout",
            )
        metrics_by_split[split] = split_metrics
    return {
        "version": REPORT_VERSION,
        "pool": pool,
        "unitBet": UNIT_BET,
        "state": "READY_FOR_RESEARCH",
        "cashMode": "NO_BET",
        "executionStatus": "PAPER_ONLY",
        "valueStatus": "RESEARCH_ONLY",
        "reason": (
            "top-pair selection is fixed before settlement, but official dividends are final outcomes "
            "rather than lockable pre-race QIN/QPL prices"
        ),
        "combinationBookGate": combination_book_gate,
        "metricsBySplit": metrics_by_split,
        "ledger": ledger,
    }


def evaluate_combination_book_gate(
    coverage,
    *,
    pool,
    minimum_book_races=DEFAULT_MIN_BOOK_RACES,
    minimum_book_coverage=DEFAULT_MIN_BOOK_COVERAGE,
):
    if pool not in SUPPORTED_POOLS:
        raise ValueError(f"unsupported exotic pool {pool!r}")
    minimum_races = _non_negative_integer(minimum_book_races, "minimum_book_races")
    minimum_coverage = _coverage_rate(minimum_book_coverage, "minimum_book_coverage")
    rows = [] if coverage is None else coverage
    if isinstance(coverage, dict):
        rows = coverage.get("byPoolWindow") or coverage.get("rows") or []
    if not isinstance(rows, list):
        raise ValueError("combination_book_coverage must be a list or aggregate report")
    normalized_rows = []
    for index, row in enumerate(rows, start=1):
        if not isinstance(row, dict):
            raise ValueError(f"combination book coverage row {index} must be an object")
        if _canonical_pool(row.get("poolKey") or row.get("pool")) != pool:
            continue
        window = str(row.get("window") or "").strip().upper()
        if window not in REQUIRED_BOOK_WINDOWS:
            continue
        eligible_races = _non_negative_integer(
            row.get("eligibleRaces", row.get("dueRaces", 0)),
            f"coverage row {index} eligibleRaces",
        )
        verified_races = _non_negative_integer(
            row.get("racesWithVerifiedBook", row.get("usableRaces", 0)),
            f"coverage row {index} racesWithVerifiedBook",
        )
        if verified_races > eligible_races:
            raise ValueError(f"coverage row {index} verified races exceed eligible races")
        normalized_rows.append({
            "window": window,
            "eligibleRaces": eligible_races,
            "racesWithVerifiedBook": verified_races,
            "coverage": _round(verified_races / eligible_races) if eligible_races else None,
            "verified": row.get("verified") is True,
        })

    by_window = {}
    deficits = []
    for window in REQUIRED_BOOK_WINDOWS:
        candidates = [row for row in normalized_rows if row["window"] == window]
        selected = sorted(
            candidates,
            key=lambda row: (row["racesWithVerifiedBook"], row["eligibleRaces"]),
            reverse=True,
        )[0] if candidates else None
        by_window[window] = selected
        if selected is None:
            deficits.append({
                "window": window,
                "reason": "MISSING_VERIFIED_BOOK_COVERAGE",
                "requiredRaces": minimum_races,
                "actualRaces": 0,
            })
            continue
        if not selected["verified"]:
            deficits.append({
                "window": window,
                "reason": "BOOK_NOT_VERIFIED",
                "required": True,
                "actual": False,
            })
        if selected["racesWithVerifiedBook"] < minimum_races:
            deficits.append({
                "window": window,
                "reason": "INSUFFICIENT_VERIFIED_RACES",
                "requiredRaces": minimum_races,
                "actualRaces": selected["racesWithVerifiedBook"],
            })
        if selected["coverage"] is None or selected["coverage"] < minimum_coverage:
            deficits.append({
                "window": window,
                "reason": "INSUFFICIENT_COVERAGE_RATE",
                "requiredCoverage": minimum_coverage,
                "actualCoverage": selected["coverage"],
            })
    return {
        "version": "combination-book-gate-v1",
        "status": "READY" if not deficits else "BLOCKED_DATA",
        "pool": pool,
        "requiredWindows": list(REQUIRED_BOOK_WINDOWS),
        "declaredMinimums": {
            "racesPerWindow": minimum_races,
            "coveragePerWindow": minimum_coverage,
            "verified": True,
        },
        "byWindow": by_window,
        "deficits": deficits,
        "roiReadBeforeGate": False,
        "cashMode": "NO_BET",
    }


def load_prediction_rows(path):
    rows = []
    with Path(path).expanduser().open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                raise ValueError(f"prediction line {line_number} is not an object")
            rows.append(value)
    if not rows:
        raise ValueError("prediction artifact is empty")
    return rows


def write_pair_strategy_report(
    *, predictions, database, pool, output, ledger_output=None, coverage=None
):
    coverage_report = None
    if coverage:
        coverage_report = json.loads(Path(coverage).expanduser().read_text(encoding="utf-8"))
    report = evaluate_pair_strategies(
        load_prediction_rows(predictions),
        load_exotic_dividends(database, pool),
        pool=pool,
        combination_book_coverage=coverage_report,
    )
    output_path = Path(output).expanduser()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    public_report = {**report, "ledger": {
        "rows": len(report["ledger"]),
        "path": str(Path(ledger_output).expanduser().resolve()) if ledger_output else None,
    }}
    output_path.write_text(
        json.dumps(public_report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    if ledger_output:
        ledger_path = Path(ledger_output).expanduser()
        ledger_path.parent.mkdir(parents=True, exist_ok=True)
        ledger_path.write_text(
            "\n".join(json.dumps(row, ensure_ascii=False) for row in report["ledger"]) + "\n",
            encoding="utf-8",
        )
    return public_report


def _aggregate(settlements, *, races_total, is_out_of_sample):
    eligible = [row for row in settlements if row["eligible"]]
    stake = sum(row["stake"] for row in eligible)
    returns = sum(row["return"] for row in eligible)
    profit = returns - stake
    hits = sum(row["hit"] for row in eligible)
    cumulative = 0.0
    peak = 0.0
    max_drawdown = 0.0
    losing_run = 0
    longest_losing_run = 0
    for row in eligible:
        cumulative += row["profit"]
        peak = max(peak, cumulative)
        max_drawdown = max(max_drawdown, peak - cumulative)
        if row["hit"]:
            losing_run = 0
        else:
            losing_run += 1
            longest_losing_run = max(longest_losing_run, losing_run)
    return_values = [row["return"] for row in eligible if row["return"] > 0]
    largest_return_share = max(return_values) / returns if returns > 0 and return_values else None
    return {
        "racesTotal": races_total,
        "racesEligible": len(eligible),
        "coverage": _round(len(eligible) / races_total) if races_total else None,
        "bets": len(eligible),
        "hits": hits,
        "hitRate": _round(hits / len(eligible)) if eligible else None,
        "stake": _money(stake),
        "returns": _money(returns),
        "profit": _money(profit),
        "ROI": _round(profit / stake) if stake > 0 else None,
        "maxDrawdown": _money(max_drawdown),
        "longestLosingRun": longest_losing_run,
        "largestReturnShare": _round(largest_return_share) if largest_return_share is not None else None,
        "isOutOfSample": is_out_of_sample,
    }


def _pair(row):
    try:
        values = tuple(sorted((int(row["horseNoA"]), int(row["horseNoB"]))))
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError(f"invalid pair prediction {row!r}") from error
    if values[0] <= 0 or values[0] == values[1]:
        raise ValueError(f"invalid pair prediction {row!r}")
    return values


def _probability(value, field, row_number):
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"prediction row {row_number} has invalid {field}") from error
    if not math.isfinite(number) or number < 0 or number > 1:
        raise ValueError(f"prediction row {row_number} has invalid {field}")
    return number


def _canonical_pool(value):
    compact = "".join(character for character in str(value or "").lower() if character.isalnum())
    if compact in {"qin", "quinella"}:
        return "quinella"
    if compact in {"qpl", "quinellaplace"}:
        return "quinellaPlace"
    return None


def _non_negative_integer(value, label):
    if isinstance(value, bool):
        raise ValueError(f"{label} must be a non-negative integer")
    try:
        number = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{label} must be a non-negative integer") from error
    if number < 0 or float(value) != number:
        raise ValueError(f"{label} must be a non-negative integer")
    return number


def _coverage_rate(value, label):
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{label} must be between 0 and 1") from error
    if not math.isfinite(number) or number < 0 or number > 1:
        raise ValueError(f"{label} must be between 0 and 1")
    return number


def _race_sort_key(rows):
    return str(rows[0].get("date") or ""), str(rows[0].get("raceId") or "")


def _money(value):
    return round(float(value), 2)


def _round(value):
    return round(float(value), 6)


def build_parser():
    parser = argparse.ArgumentParser(description="Settle blind top-pair QIN/QPL predictions.")
    parser.add_argument("--predictions", required=True)
    parser.add_argument("--db", required=True)
    parser.add_argument("--pool", required=True, choices=SUPPORTED_POOLS)
    parser.add_argument("--output", required=True)
    parser.add_argument("--ledger-output")
    parser.add_argument("--coverage")
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        report = write_pair_strategy_report(
            predictions=args.predictions,
            database=args.db,
            pool=args.pool,
            output=args.output,
            ledger_output=args.ledger_output,
            coverage=args.coverage,
        )
    except (OSError, ValueError) as error:
        raise SystemExit(str(error)) from error
    if report["state"] == "BLOCKED_DATA":
        print(
            f"{args.pool} strategy BLOCKED_DATA: "
            f"{len(report['combinationBookGate']['deficits'])} combination-book deficits"
        )
    else:
        holdout = report["metricsBySplit"]["holdout"]["selectedStack"]
        print(
            f"{args.pool} selected stack: holdout {holdout['hits']}/{holdout['bets']} hits, "
            f"ROI {holdout['ROI']}, max drawdown {holdout['maxDrawdown']}"
        )
    print(f"Saved report to {Path(args.output).expanduser().resolve()}")


if __name__ == "__main__":
    main()
