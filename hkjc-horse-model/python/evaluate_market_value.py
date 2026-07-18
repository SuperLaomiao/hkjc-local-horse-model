#!/usr/bin/env python3
"""Select T-10 value thresholds on validation and settle untouched holdout."""

import argparse
import json
import math
import sqlite3
from collections import defaultdict
from pathlib import Path


REPORT_VERSION = "market-value-threshold-grid-v1"
POOLS = {
    "WIN": {
        "target": "targetWin",
        "odds": "marketWinOddsT10",
        "stackProbability": "winProbability",
        "dividendPool": "win",
    },
    "PLACE": {
        "target": "targetPlace",
        "odds": "marketPlaceOddsT10",
        "stackProbability": "placeProbability",
        "dividendPool": "place",
    },
}


def build_market_value_report(
    prediction_rows,
    matrix_rows,
    dividends,
    *,
    pool,
    ev_thresholds=(0.0, 0.05, 0.10, 0.15, 0.20),
    probability_gap_thresholds=(0.0, 0.01, 0.02, 0.03, 0.05),
    min_validation_bets=50,
):
    """Choose one validation threshold pair and apply it unchanged to holdout."""
    pool = str(pool).upper()
    if pool not in POOLS:
        raise ValueError(f"unsupported pool {pool!r}; choose WIN or PLACE")
    if not isinstance(prediction_rows, list) or not prediction_rows:
        raise ValueError("prediction_rows must be a non-empty list")
    if not isinstance(matrix_rows, list) or not matrix_rows:
        raise ValueError("matrix_rows must be a non-empty list")
    minimum_bets = _positive_int(min_validation_bets, "min_validation_bets")
    ev_grid = _threshold_grid(ev_thresholds, "ev_thresholds")
    gap_grid = _threshold_grid(probability_gap_thresholds, "probability_gap_thresholds")
    policy = POOLS[pool]
    target = policy["target"]

    matrix_index = {}
    for row in matrix_rows:
        key = _row_key(row)
        if key in matrix_index:
            raise ValueError(f"duplicate matrix runner {key}")
        matrix_index[key] = row

    candidates = []
    missing_matrix = 0
    missing_price = 0
    model_ids = set()
    for row in prediction_rows:
        if row.get("split") not in {"validation", "holdout"}:
            continue
        if row.get("target") not in (None, target):
            raise ValueError(f"prediction target must be {target}")
        model_ids.add(str(row.get("modelId") or row.get("version") or "").strip())
        key = _row_key(row)
        matrix_row = matrix_index.get(key)
        if matrix_row is None:
            missing_matrix += 1
            continue
        odds = _positive_number(matrix_row.get(policy["odds"]))
        if odds is None:
            missing_price += 1
            continue
        probability = _probability(
            row.get("probability", row.get(policy["stackProbability"]))
        )
        outcome = _binary_label(row.get(target))
        candidates.append({
            "raceId": str(row.get("raceId")),
            "date": str(row.get("date") or matrix_row.get("date") or ""),
            "horseNo": int(row.get("horseNo")),
            "split": row.get("split"),
            "probability": probability,
            "odds": odds,
            "expectedValue": probability * odds - 1.0,
            "probabilityGap": probability - 1.0 / odds,
            "outcome": outcome,
        })
    model_ids.discard("")
    if len(model_ids) != 1:
        raise ValueError("predictions require one non-empty modelId or version")

    validation_grid = []
    selected = None
    for minimum_ev in ev_grid:
        for minimum_gap in gap_grid:
            metrics = _evaluate_split(
                candidates,
                dividends,
                pool=pool,
                split="validation",
                minimum_ev=minimum_ev,
                minimum_gap=minimum_gap,
            )
            eligible = metrics["bets"] >= minimum_bets
            entry = {
                "minimumEv": minimum_ev,
                "minimumProbabilityGap": minimum_gap,
                "eligible": eligible,
                "metrics": metrics,
            }
            validation_grid.append(entry)
            if eligible and (selected is None or _selection_score(entry) > _selection_score(selected)):
                selected = entry

    if selected is None:
        return {
            "version": REPORT_VERSION,
            "status": "BLOCKED_DATA",
            "cashMode": "NO_BET",
            "pool": pool,
            "modelId": next(iter(model_ids)),
            "selection": None,
            "validationGrid": validation_grid,
            "metrics": {"validation": None, "holdout": None},
            "quality": {
                "usableCandidates": len(candidates),
                "missingMatrixRows": missing_matrix,
                "missingDecisionPrices": missing_price,
            },
            "reasons": [f"no validation grid cell reaches {minimum_bets} settled bets"],
            "prospectivePromotion": _prospective_block(),
        }

    holdout_metrics = _evaluate_split(
        candidates,
        dividends,
        pool=pool,
        split="holdout",
        minimum_ev=selected["minimumEv"],
        minimum_gap=selected["minimumProbabilityGap"],
    )
    holdout_metrics["isOutOfSample"] = True
    return {
        "version": REPORT_VERSION,
        "status": "READY_RESEARCH",
        "cashMode": "NO_BET",
        "pool": pool,
        "modelId": next(iter(model_ids)),
        "decisionWindow": "T-10",
        "stakePerBet": 10.0,
        "selection": {
            "selectedOn": "validation",
            "holdoutUsedForSelection": False,
            "minimumEv": selected["minimumEv"],
            "minimumProbabilityGap": selected["minimumProbabilityGap"],
            "minimumValidationBets": minimum_bets,
            "oneBetPerRace": True,
        },
        "validationGrid": validation_grid,
        "metrics": {
            "validation": selected["metrics"],
            "holdout": holdout_metrics,
        },
        "quality": {
            "usableCandidates": len(candidates),
            "missingMatrixRows": missing_matrix,
            "missingDecisionPrices": missing_price,
        },
        "settlement": "official HKJC dividend_per10; T-10 odds are used for decisions only",
        "prospectivePromotion": _prospective_block(),
        "note": (
            "Historical threshold evidence is research-only. Cash mode requires locked 2026 "
            "pre-race decisions, final prices, settlements, CLV, and drawdown review."
        ),
    }


def _evaluate_split(candidates, dividends, *, pool, split, minimum_ev, minimum_gap):
    by_race = defaultdict(list)
    for candidate in candidates:
        if (
            candidate["split"] == split
            and candidate["expectedValue"] >= minimum_ev
            and candidate["probabilityGap"] >= minimum_gap
        ):
            by_race[candidate["raceId"]].append(candidate)

    bets = []
    excluded_missing_settlement = 0
    for race_id in sorted(by_race):
        chosen = sorted(
            by_race[race_id],
            key=lambda item: (
                -item["expectedValue"],
                -item["probabilityGap"],
                -item["probability"],
                item["horseNo"],
            ),
        )[0]
        dividend = dividends.get((chosen["raceId"], pool, chosen["horseNo"]))
        if chosen["outcome"] == 1 and _positive_number(dividend) is None:
            excluded_missing_settlement += 1
            continue
        returned = float(dividend) if chosen["outcome"] == 1 else 0.0
        bets.append({**chosen, "return": returned, "profit": returned - 10.0})

    total_stake = 10.0 * len(bets)
    total_return = sum(item["return"] for item in bets)
    profit = total_return - total_stake
    cumulative = 0.0
    peak = 0.0
    max_drawdown = 0.0
    consecutive_losses = 0
    max_consecutive_losses = 0
    by_month = defaultdict(lambda: {"bets": 0, "hits": 0, "stake": 0.0, "return": 0.0})
    for item in bets:
        cumulative += item["profit"]
        peak = max(peak, cumulative)
        max_drawdown = max(max_drawdown, peak - cumulative)
        if item["outcome"] == 1:
            consecutive_losses = 0
        else:
            consecutive_losses += 1
            max_consecutive_losses = max(max_consecutive_losses, consecutive_losses)
        month = item["date"][:7] if len(item["date"]) >= 7 else "unknown"
        bucket = by_month[month]
        bucket["bets"] += 1
        bucket["hits"] += item["outcome"]
        bucket["stake"] += 10.0
        bucket["return"] += item["return"]
    monthly_metrics = {}
    for month, bucket in sorted(by_month.items()):
        month_profit = bucket["return"] - bucket["stake"]
        monthly_metrics[month] = {
            "bets": bucket["bets"],
            "hits": bucket["hits"],
            "stake": _round(bucket["stake"]),
            "return": _round(bucket["return"]),
            "profit": _round(month_profit),
            "roi": _round(month_profit / bucket["stake"]),
        }
    return {
        "bets": len(bets),
        "hits": sum(item["outcome"] for item in bets),
        "hitRate": _round(sum(item["outcome"] for item in bets) / len(bets)) if bets else None,
        "stake": _round(total_stake),
        "return": _round(total_return),
        "profit": _round(profit),
        "roi": _round(profit / total_stake) if total_stake else None,
        "maxDrawdown": _round(max_drawdown),
        "largestReturn": _round(max((item["return"] for item in bets), default=0.0)),
        "largestReturnShare": (
            _round(max(item["return"] for item in bets) / total_return)
            if bets and total_return > 0 else None
        ),
        "maxConsecutiveLosses": max_consecutive_losses,
        "byMonth": monthly_metrics,
        "excludedMissingSettlement": excluded_missing_settlement,
    }


def load_jsonl(path):
    rows = []
    with Path(path).open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(f"invalid JSONL line {line_number} in {path}") from error
            if not isinstance(row, dict):
                raise ValueError(f"JSONL line {line_number} in {path} must be an object")
            rows.append(row)
    return rows


def load_single_runner_dividends(db_path, pool):
    pool = str(pool).upper()
    if pool not in POOLS:
        raise ValueError(f"unsupported pool {pool!r}; choose WIN or PLACE")
    connection = sqlite3.connect(f"file:{Path(db_path).resolve()}?mode=ro", uri=True)
    try:
        rows = connection.execute(
            """
            SELECT race_id, combination_key, dividend_per10
            FROM dividends
            WHERE pool_key = ?
            """,
            (POOLS[pool]["dividendPool"],),
        ).fetchall()
    finally:
        connection.close()
    output = {}
    for race_id, combination_key, dividend_per10 in rows:
        try:
            horse_no = int(combination_key)
        except (TypeError, ValueError):
            continue
        output[(str(race_id), pool, horse_no)] = float(dividend_per10)
    return output


def _selection_score(entry):
    metrics = entry["metrics"]
    return (
        -math.inf if metrics["roi"] is None else metrics["roi"],
        -metrics["maxDrawdown"],
        metrics["bets"],
        entry["minimumEv"],
        entry["minimumProbabilityGap"],
    )


def _row_key(row):
    return str(row.get("raceId")), int(row.get("horseNo"))


def _probability(value):
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"invalid probability {value!r}") from error
    if not math.isfinite(number) or number < 0.0 or number > 1.0:
        raise ValueError(f"invalid probability {value!r}")
    return number


def _binary_label(value):
    number = _probability(value)
    if number not in (0.0, 1.0):
        raise ValueError(f"invalid binary label {value!r}")
    return int(number)


def _positive_number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number > 0 else None


def _positive_int(value, label):
    try:
        number = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{label} must be a positive integer") from error
    if number <= 0 or number != float(value):
        raise ValueError(f"{label} must be a positive integer")
    return number


def _threshold_grid(values, label):
    try:
        numbers = sorted({float(value) for value in values})
    except (TypeError, ValueError) as error:
        raise ValueError(f"{label} must contain finite non-negative numbers") from error
    if not numbers or any(not math.isfinite(value) or value < 0 for value in numbers):
        raise ValueError(f"{label} must contain finite non-negative numbers")
    return tuple(numbers)


def _prospective_block():
    return {
        "status": "BLOCKED_DATA",
        "cashMode": "NO_BET",
        "reason": "requires locked 2026 decisions, final prices, settlements, CLV, and drawdown",
    }


def _round(value):
    return round(float(value), 6)


def _parse_thresholds(value):
    return tuple(item.strip() for item in str(value).split(",") if item.strip())


def build_parser():
    parser = argparse.ArgumentParser(description="Evaluate T-10 model value with official dividends.")
    parser.add_argument("--predictions", required=True)
    parser.add_argument("--matrix", required=True)
    parser.add_argument("--db", required=True)
    parser.add_argument("--pool", choices=tuple(POOLS), required=True)
    parser.add_argument("--ev-thresholds", default="0,0.05,0.10,0.15,0.20")
    parser.add_argument("--gap-thresholds", default="0,0.01,0.02,0.03,0.05")
    parser.add_argument("--min-validation-bets", type=int, default=50)
    parser.add_argument("--output", required=True)
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        report = build_market_value_report(
            load_jsonl(args.predictions),
            load_jsonl(args.matrix),
            load_single_runner_dividends(args.db, args.pool),
            pool=args.pool,
            ev_thresholds=_parse_thresholds(args.ev_thresholds),
            probability_gap_thresholds=_parse_thresholds(args.gap_thresholds),
            min_validation_bets=args.min_validation_bets,
        )
    except (OSError, ValueError, sqlite3.Error) as error:
        raise SystemExit(str(error)) from error
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Market value grid {args.pool}: {report['status']} | cash {report['cashMode']}")
    if report["selection"]:
        holdout = report["metrics"]["holdout"]
        print(
            f"Selected validation EV>={report['selection']['minimumEv']:.3f}, "
            f"gap>={report['selection']['minimumProbabilityGap']:.3f}; "
            f"holdout {holdout['bets']} bets, ROI {holdout['roi']}"
        )
    print(f"Saved report to {output}")


if __name__ == "__main__":
    main()
