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


def evaluate_pair_strategies(rows, dividends, *, pool):
    """Evaluate one fixed top-pair selection per race for each probability source."""
    if pool not in SUPPORTED_POOLS:
        raise ValueError(f"unsupported exotic pool {pool!r}")
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
        "cashMode": "NO_BET",
        "valueStatus": "RESEARCH_ONLY",
        "reason": (
            "top-pair selection is fixed before settlement, but official dividends are final outcomes "
            "rather than lockable pre-race QIN/QPL prices"
        ),
        "metricsBySplit": metrics_by_split,
        "ledger": ledger,
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


def write_pair_strategy_report(*, predictions, database, pool, output, ledger_output=None):
    report = evaluate_pair_strategies(
        load_prediction_rows(predictions),
        load_exotic_dividends(database, pool),
        pool=pool,
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
        )
    except (OSError, ValueError) as error:
        raise SystemExit(str(error)) from error
    holdout = report["metricsBySplit"]["holdout"]["selectedStack"]
    print(
        f"{args.pool} selected stack: holdout {holdout['hits']}/{holdout['bets']} hits, "
        f"ROI {holdout['ROI']}, max drawdown {holdout['maxDrawdown']}"
    )
    print(f"Saved report to {Path(args.output).expanduser().resolve()}")


if __name__ == "__main__":
    main()
