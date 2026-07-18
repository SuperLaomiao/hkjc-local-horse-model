#!/usr/bin/env python3
"""Forecast T-3 indicative odds from T-30/T-10 movement without target leakage."""

import argparse
import json
import math
from pathlib import Path

from evaluate_market_value import load_jsonl, load_single_runner_dividends


REPORT_VERSION = "closing-price-forecast-v1"
POOLS = {
    "WIN": {"prefix": "marketWinOdds", "target": "targetWin"},
    "PLACE": {"prefix": "marketPlaceOdds", "target": "targetPlace"},
}


def build_closing_price_forecast(
    matrix_rows,
    dividends,
    *,
    pool,
    trend_alphas=(-0.25, 0.0, 0.25, 0.35, 0.5, 0.75, 1.0),
):
    """Select a log-trend extrapolator on validation and evaluate holdout once."""
    pool = str(pool).upper()
    if pool not in POOLS:
        raise ValueError(f"unsupported pool {pool!r}; choose WIN or PLACE")
    if not isinstance(matrix_rows, list) or not matrix_rows:
        raise ValueError("matrix_rows must be a non-empty list")
    alphas = _alpha_grid(trend_alphas)
    policy = POOLS[pool]
    prefix = policy["prefix"]
    prepared = []
    rejected_missing = 0
    for row in matrix_rows:
        if row.get("split") not in {"train", "validation", "holdout"}:
            continue
        t30 = _positive_number(row.get(f"{prefix}T30"))
        t10 = _positive_number(row.get(f"{prefix}T10"))
        t3 = _positive_number(row.get(f"{prefix}T3"))
        if None in (t30, t10, t3):
            rejected_missing += 1
            continue
        prepared.append({
            "raceId": str(row.get("raceId")),
            "date": str(row.get("date") or ""),
            "split": row.get("split"),
            "horseNo": int(row.get("horseNo")),
            "t30": t30,
            "t10": t10,
            "t3": t3,
            "outcome": _binary_label(row.get(policy["target"])),
        })
    if not any(row["split"] == "validation" for row in prepared):
        raise ValueError("closing-price forecast requires validation rows")
    if not any(row["split"] == "holdout" for row in prepared):
        raise ValueError("closing-price forecast requires holdout rows")

    validation_candidates = []
    selected = None
    for alpha in alphas:
        predictions = [_forecast(row["t30"], row["t10"], alpha) for row in prepared]
        validation = _metrics(prepared, predictions, "validation")
        candidate = {"trendAlpha": alpha, "validationMetrics": validation}
        validation_candidates.append(candidate)
        if selected is None or _selection_score(candidate) < _selection_score(selected):
            selected = candidate

    selected_predictions = [
        _forecast(row["t30"], row["t10"], selected["trendAlpha"])
        for row in prepared
    ]
    persistence_predictions = [_forecast(row["t30"], row["t10"], 0.0) for row in prepared]
    selected_validation = _metrics(prepared, selected_predictions, "validation")
    selected_holdout = _metrics(prepared, selected_predictions, "holdout")
    selected_holdout["isOutOfSample"] = True
    persistence_validation = _metrics(prepared, persistence_predictions, "validation")
    persistence_holdout = _metrics(prepared, persistence_predictions, "holdout")
    persistence_holdout["isOutOfSample"] = True
    return {
        "version": REPORT_VERSION,
        "status": "READY_RESEARCH",
        "cashMode": "NO_BET",
        "pool": pool,
        "featureWindows": ["T-30", "T-10"],
        "targetWindow": "T-3",
        "selection": {
            "selectedOn": "validation",
            "holdoutUsedForSelection": False,
            "trendAlpha": selected["trendAlpha"],
            "formula": "log(T3_hat) = log(T10) + alpha * (log(T10) - log(T30))",
        },
        "validationCandidates": validation_candidates,
        "metrics": {
            "validation": selected_validation,
            "holdout": selected_holdout,
        },
        "persistenceBaseline": {
            "formula": "T3_hat = T10",
            "validation": persistence_validation,
            "holdout": persistence_holdout,
        },
        "improvementVsPersistence": {
            "validationRmsleReduction": _round(
                persistence_validation["rmsle"] - selected_validation["rmsle"]
            ),
            "holdoutRmsleReduction": _round(
                persistence_holdout["rmsle"] - selected_holdout["rmsle"]
            ),
        },
        "officialDividendAudit": {
            split: _official_dividend_audit(prepared, dividends, pool, split)
            for split in ("validation", "holdout")
        },
        "quality": {
            "usableRows": len(prepared),
            "rowsBySplit": {
                split: sum(row["split"] == split for row in prepared)
                for split in ("train", "validation", "holdout")
            },
            "rejectedMissingWindow": rejected_missing,
        },
        "interpretation": (
            "HKJC is pari-mutuel: T-10 odds are indicative and not locked. T-10 to T-3 "
            "movement is a price-drift/CLV diagnostic, while official dividends settle wins."
        ),
        "prospectivePromotion": {
            "status": "BLOCKED_DATA",
            "cashMode": "NO_BET",
            "reason": "requires locked 2026 T-window decisions and final settlements",
        },
    }


def _forecast(t30, t10, alpha):
    log_prediction = math.log(t10) + alpha * (math.log(t10) - math.log(t30))
    return min(10000.0, max(1.0, math.exp(log_prediction)))


def _metrics(rows, predictions, split):
    selected = [
        (row, prediction)
        for row, prediction in zip(rows, predictions)
        if row["split"] == split
    ]
    if not selected:
        return {"rows": 0, "races": 0, "mae": None, "mape": None, "rmsle": None}
    absolute_errors = [abs(prediction - row["t3"]) for row, prediction in selected]
    percentage_errors = [
        abs(prediction - row["t3"]) / row["t3"]
        for row, prediction in selected
    ]
    squared_log_errors = [
        (math.log(prediction) - math.log(row["t3"])) ** 2
        for row, prediction in selected
    ]
    signed_changes = [(row["t3"] / row["t10"]) - 1.0 for row, _prediction in selected]
    return {
        "rows": len(selected),
        "races": len({row["raceId"] for row, _prediction in selected}),
        "mae": _round(sum(absolute_errors) / len(selected)),
        "mape": _round(sum(percentage_errors) / len(selected)),
        "rmsle": _round(math.sqrt(sum(squared_log_errors) / len(selected))),
        "meanT10ToT3Change": _round(sum(signed_changes) / len(selected)),
    }


def _official_dividend_audit(rows, dividends, pool, split):
    comparisons = []
    for row in rows:
        if row["split"] != split:
            continue
        dividend_per10 = _positive_number(
            dividends.get((row["raceId"], pool, row["horseNo"]))
        )
        if dividend_per10 is None:
            continue
        official_decimal = dividend_per10 / 10.0
        comparisons.append((row["t3"], official_decimal))
    if not comparisons:
        return {"samples": 0, "mae": None, "mape": None}
    return {
        "samples": len(comparisons),
        "mae": _round(sum(abs(t3 - official) for t3, official in comparisons) / len(comparisons)),
        "mape": _round(
            sum(abs(t3 - official) / official for t3, official in comparisons)
            / len(comparisons)
        ),
        "note": "Outcome-conditioned audit because official dividends exist only for winning combinations.",
    }


def _selection_score(candidate):
    metrics = candidate["validationMetrics"]
    return metrics["rmsle"], metrics["mape"], abs(candidate["trendAlpha"])


def _alpha_grid(values):
    try:
        numbers = sorted({float(value) for value in values})
    except (TypeError, ValueError) as error:
        raise ValueError("trend_alphas must contain finite numbers") from error
    if not numbers or any(not math.isfinite(value) for value in numbers):
        raise ValueError("trend_alphas must contain finite numbers")
    return tuple(numbers)


def _positive_number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number > 0 else None


def _binary_label(value):
    try:
        number = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"invalid binary label {value!r}") from error
    if number not in (0, 1) or number != float(value):
        raise ValueError(f"invalid binary label {value!r}")
    return number


def _round(value):
    return round(float(value), 6)


def _parse_alphas(value):
    return tuple(item.strip() for item in str(value).split(",") if item.strip())


def build_parser():
    parser = argparse.ArgumentParser(description="Forecast T-3 odds from T-30/T-10 movement.")
    parser.add_argument("--matrix", required=True)
    parser.add_argument("--db", required=True)
    parser.add_argument("--pool", choices=tuple(POOLS), required=True)
    parser.add_argument("--trend-alphas", default="-0.25,0,0.25,0.35,0.5,0.75,1")
    parser.add_argument("--output", required=True)
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        report = build_closing_price_forecast(
            load_jsonl(args.matrix),
            load_single_runner_dividends(args.db, args.pool),
            pool=args.pool,
            trend_alphas=_parse_alphas(args.trend_alphas),
        )
    except (OSError, ValueError) as error:
        raise SystemExit(str(error)) from error
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    holdout = report["metrics"]["holdout"]
    print(
        f"{args.pool} closing forecast alpha={report['selection']['trendAlpha']}: "
        f"holdout RMSLE {holdout['rmsle']}, MAPE {holdout['mape']}"
    )
    print(f"Saved report to {output}")


if __name__ == "__main__":
    main()
