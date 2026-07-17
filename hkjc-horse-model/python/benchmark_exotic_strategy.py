#!/usr/bin/env python3
"""Strict local backtests for top-2/top-3 QIN and QPL strategies.

The evaluator consumes an already-trained LightGBM report, feature manifest,
and model artifact. It reuses the trainer's persisted encoder and race-level
probability normalization; it never fits an encoder or model during a
backtest. Only validation and holdout races are settled against official
SQLite dividends.
"""

import argparse
import itertools
import json
import math
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

from train_tree_model import (
    MissingDependencyError as TrainingMissingDependencyError,
    load_matrix_rows,
    normalize_race_probabilities,
    transform_feature_rows,
)


UNIT_BET = 10.0
SPLITS = ("validation", "holdout")
STRATEGIES = (
    "top2-quinella",
    "top2-qpl",
    "top3-box-quinella",
    "top3-box-qpl",
)
POOL_FOR_STRATEGY = {
    "top2-quinella": "quinella",
    "top2-qpl": "quinellaPlace",
    "top3-box-quinella": "quinella",
    "top3-box-qpl": "quinellaPlace",
}


class MissingDependencyError(RuntimeError):
    """Raised when local prediction dependencies are not available."""


def build_model_bundle(model_report_path):
    """Load report metadata and resolve its persisted manifest and artifact."""
    report_path = Path(model_report_path).expanduser().resolve()
    report = _read_json_object(report_path, "model report")
    manifest_path = _resolve_report_path(
        report_path,
        report.get("featureManifest"),
        report_path.with_suffix(".feature-manifest.json"),
    )
    model_path = _resolve_report_path(
        report_path,
        report.get("modelArtifact"),
        report_path.with_suffix(".model.txt"),
    )
    manifest = _read_json_object(manifest_path, "feature manifest")
    if not model_path.is_file():
        raise FileNotFoundError(f"Model artifact does not exist: {model_path}")
    feature_names = manifest.get("featureNames") or manifest.get("features")
    if not feature_names:
        raise ValueError(f"Feature manifest has no features: {manifest_path}")
    feature_types = manifest.get("featureTypes") or {}
    missing_types = [name for name in feature_names if name not in feature_types]
    if missing_types:
        raise ValueError(
            "Feature manifest is missing featureTypes for: " + ", ".join(missing_types)
        )
    encoder = {
        "featureNames": list(feature_names),
        "featureTypes": feature_types,
        "categoricalMappings": manifest.get("categoricalMappings") or {},
        "unknownCategoryValue": manifest.get("unknownCategoryValue", -1),
    }
    return {
        "reportPath": report_path,
        "report": report,
        "featureManifest": manifest_path,
        "manifest": manifest,
        "modelArtifact": model_path,
        "encoder": encoder,
    }


def predict_with_bundle(rows, encoder, report, manifest, model_path, predictor=None):
    """Predict with a persisted bundle, allowing deterministic test injection."""
    transformed = transform_feature_rows(rows, encoder)
    if predictor is not None:
        raw_probabilities = predictor(rows, transformed, report, manifest, Path(model_path))
    else:
        pandas_module, lightgbm_module = _require_prediction_dependencies()
        frame = pandas_module.DataFrame(
            transformed,
            columns=encoder["featureNames"],
            dtype=float,
        )
        booster = lightgbm_module.Booster(model_file=str(model_path))
        effective_iterations = _positive_int(report.get("effectiveIterations"))
        kwargs = {"num_iteration": effective_iterations} if effective_iterations else {}
        raw_probabilities = booster.predict(frame, **kwargs)
    try:
        values = list(raw_probabilities)
    except TypeError as error:
        raise ValueError("Model predictor did not return an iterable of probabilities") from error
    if len(values) != len(rows):
        raise ValueError(
            f"Model predictor returned {len(values)} probabilities for {len(rows)} rows"
        )
    return normalize_race_probabilities(rows, values)


def load_dividend_map(database, connection=None):
    """Return official dividend rows keyed by race, pool, and unordered pair."""
    supplied_connection = connection or (database if isinstance(database, sqlite3.Connection) else None)
    owns_connection = supplied_connection is None
    db = supplied_connection or sqlite3.connect(str(Path(database).expanduser()))
    try:
        rows = db.execute(
            """
            SELECT race_id, pool_key, combination_json, dividend_per10
            FROM dividends
            WHERE pool_key IN ('quinella', 'quinellaPlace')
            ORDER BY race_id, pool_key, combination_json
            """
        ).fetchall()
        dividends = {}
        for race_id, pool_key, combination_json, dividend_per10 in rows:
            combination = _parse_combination(combination_json)
            amount = _finite_nonnegative(dividend_per10)
            if combination is None or amount is None:
                continue
            key = (str(race_id), str(pool_key))
            dividends.setdefault(key, {})[_canonical_combination(combination)] = amount
        return dividends
    finally:
        if owns_connection:
            db.close()


def settle_race_strategy(race_id, date, strategy, ranked_horses, dividend_map):
    """Settle one race; missing pool data is ineligible, not a loss."""
    if strategy not in STRATEGIES:
        raise ValueError(f"Unsupported strategy: {strategy}")
    ranked = [_normalise_ranked_entry(entry) for entry in ranked_horses]
    count = 2 if strategy.startswith("top2-") else 3
    if len(ranked) < count:
        return _ineligible_result(race_id, date, strategy, "insufficient_runners")
    top = [entry[0] for entry in ranked[:count]]
    if count == 2:
        combinations = [_canonical_combination(top)]
    else:
        combinations = sorted(
            {_canonical_combination(pair) for pair in itertools.combinations(top, 2)}
        )
    selections = [list(combination) for combination in combinations]
    pool_key = POOL_FOR_STRATEGY[strategy]
    pool_dividends = dividend_map.get((str(race_id), pool_key))
    if not pool_dividends:
        return _ineligible_result(race_id, date, strategy, "missing_official_dividend", selections)

    stake = UNIT_BET * len(selections)
    returns = sum(pool_dividends.get(combination, 0.0) for combination in combinations)
    hits = sum(1 for combination in combinations if combination in pool_dividends)
    return {
        "split": None,
        "race": str(race_id),
        "date": date,
        "strategy": strategy,
        "poolKey": pool_key,
        "selections": selections,
        "eligible": True,
        "skipReason": None,
        "bets": len(selections),
        "hits": hits,
        "stake": _money(stake),
        "return": _money(returns),
        "profit": _money(returns - stake),
    }


def benchmark_exotic_strategies(
    matrix_path,
    model_report_path,
    database,
    *,
    output_path=None,
    ledger_output=None,
    predictor=None,
    connection=None,
):
    """Run all required strategies on validation and holdout only."""
    bundle = build_model_bundle(model_report_path)
    rows = load_matrix_rows(matrix_path)
    _validate_benchmark_race_splits(rows)
    probabilities = predict_with_bundle(
        rows,
        bundle["encoder"],
        bundle["report"],
        bundle["manifest"],
        bundle["modelArtifact"],
        predictor=predictor,
    )
    probability_by_index = dict(enumerate(probabilities))
    dividends = load_dividend_map(database, connection=connection)
    grouped = {split: {} for split in SPLITS}
    for index, row in enumerate(rows):
        split = row.get("split")
        if split not in SPLITS:
            continue
        race_id = str(row.get("raceId"))
        grouped[split].setdefault(race_id, []).append((index, row, probability_by_index[index]))

    metrics_by_split = {}
    ledger_rows = []
    for split in SPLITS:
        race_groups = grouped[split]
        split_metrics = {}
        for strategy in STRATEGIES:
            settlements = []
            for race_id in sorted(
                race_groups,
                key=lambda value: _race_sort_key(value, race_groups[value]),
            ):
                entries = race_groups[race_id]
                ranked = sorted(
                    entries,
                    key=lambda item: (
                        -_finite(item[2], 0.0),
                        _horse_sort_key(item[1].get("horseNo")),
                        _stable_text(item[1].get("horseId")),
                        item[0],
                    ),
                )
                date = next((item[1].get("date") for item in entries if item[1].get("date")), None)
                settlement = settle_race_strategy(
                    race_id,
                    date,
                    strategy,
                    [(item[1].get("horseNo"), item[2], item[0]) for item in ranked],
                    dividends,
                )
                settlement["split"] = split
                settlements.append(settlement)
                ledger_rows.append(_ledger_row(settlement))
            split_metrics[strategy] = _aggregate_settlements(
                split,
                strategy,
                len(race_groups),
                settlements,
                _is_out_of_sample(bundle["report"], split),
            )
        metrics_by_split[split] = split_metrics

    result = {
        "version": "exotic-strategy-benchmark-v1",
        "unitBet": UNIT_BET,
        "input": {
            "matrix": str(Path(matrix_path).expanduser().resolve()),
            "modelReport": str(bundle["reportPath"]),
            "database": str(Path(database).expanduser().resolve()) if not isinstance(database, sqlite3.Connection) else "<connection>",
            "rows": len(rows),
            "rowsBySplit": {split: sum(row.get("split") == split for row in rows) for split in SPLITS},
            "racesBySplit": {split: len(grouped[split]) for split in SPLITS},
        },
        "model": {
            "modelId": bundle["report"].get("modelId"),
            "featureManifest": str(bundle["featureManifest"]),
            "modelArtifact": str(bundle["modelArtifact"]),
            "effectiveIterations": bundle["report"].get("effectiveIterations"),
        },
        "settlementPolicy": {
            "pools": {strategy: POOL_FOR_STRATEGY[strategy] for strategy in STRATEGIES},
            "dividendField": "dividend_per10",
            "missingPoolPolicy": "race is ineligible and excluded from bets, stake, returns, profit, and ROI",
            "combinationOrdering": "stable probability rank; unordered combinations canonicalized numerically and lexicographically",
            "splitNotes": {
                "validation": "validation may be in-sample when the report is a final-refit model; consult isOutOfSample",
                "holdout": "holdout is the untouched out-of-sample split",
            },
        },
        "splitStatus": {
            split: {
                "isOutOfSample": _is_out_of_sample(bundle["report"], split),
                "isInSample": not _is_out_of_sample(bundle["report"], split),
            }
            for split in SPLITS
        },
        "metricsBySplit": metrics_by_split,
        "ledger": {
            "written": ledger_output is not None,
            "rows": len(ledger_rows),
            "path": str(Path(ledger_output).expanduser().resolve()) if ledger_output else None,
        },
    }
    if output_path is not None:
        output = Path(output_path).expanduser()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if ledger_output is not None:
        ledger = Path(ledger_output).expanduser()
        ledger.parent.mkdir(parents=True, exist_ok=True)
        with ledger.open("w", encoding="utf-8") as handle:
            for row in ledger_rows:
                handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
    return result


def _validate_benchmark_race_splits(rows):
    race_splits = defaultdict(set)
    for index, row in enumerate(rows, start=1):
        race_id = row.get("raceId")
        split = row.get("split")
        if race_id is None or str(race_id).strip() == "":
            raise ValueError(f"Benchmark row {index} is missing raceId")
        if split is None or str(split).strip() == "":
            raise ValueError(f"Benchmark row {index} is missing split")
        race_splits[str(race_id)].add(str(split))
    for race_id, splits in race_splits.items():
        if len(splits) > 1:
            joined = ", ".join(sorted(splits))
            raise ValueError(
                f"Benchmark raceId {race_id!r} appears in multiple splits: {joined}"
            )


def _aggregate_settlements(split, strategy, races_total, settlements, is_out_of_sample):
    eligible = [settlement for settlement in settlements if settlement["eligible"]]
    bets = sum(item["bets"] for item in eligible)
    hits = sum(item["hits"] for item in eligible)
    stake = sum(item["stake"] for item in eligible)
    returns = sum(item["return"] for item in eligible)
    profit = returns - stake
    cumulative = 0.0
    peak = 0.0
    max_drawdown = 0.0
    longest_losing_run = 0
    losing_run = 0
    for settlement in eligible:
        cumulative += settlement["profit"]
        peak = max(peak, cumulative)
        max_drawdown = max(max_drawdown, peak - cumulative)
        if settlement["profit"] < 0:
            losing_run += 1
            longest_losing_run = max(longest_losing_run, losing_run)
        else:
            losing_run = 0
    return {
        "split": split,
        "strategy": strategy,
        "isOutOfSample": is_out_of_sample,
        "racesTotal": races_total,
        "racesEligible": len(eligible),
        "racesIneligible": races_total - len(eligible),
        "coverage": _rate(len(eligible), races_total),
        "bets": bets,
        "hits": hits,
        "hitRate": _rate(hits, bets),
        "stake": _money(stake),
        "returns": _money(returns),
        "profit": _money(profit),
        "ROI": _rate(profit, stake),
        "maxDrawdown": _money(max_drawdown),
        "longestLosingRun": longest_losing_run,
    }


def _ledger_row(settlement):
    return {
        "split": settlement["split"],
        "race": settlement["race"],
        "date": settlement["date"],
        "strategy": settlement["strategy"],
        "selections": settlement["selections"],
        "eligible": settlement["eligible"],
        "skipReason": settlement["skipReason"],
        "stake": settlement["stake"],
        "return": settlement["return"],
        "profit": settlement["profit"],
    }


def _ineligible_result(race_id, date, strategy, reason, selections=None):
    return {
        "split": None,
        "race": str(race_id),
        "date": date,
        "strategy": strategy,
        "poolKey": POOL_FOR_STRATEGY[strategy],
        "selections": selections or [],
        "eligible": False,
        "skipReason": reason,
        "bets": 0,
        "hits": 0,
        "stake": 0.0,
        "return": 0.0,
        "profit": 0.0,
    }


def _is_out_of_sample(report, split):
    by_split = ((report.get("metrics") or {}).get("bySplit") or {}).get(split) or {}
    if "isOutOfSample" in by_split:
        return bool(by_split["isOutOfSample"])
    fit_splits = report.get("fitSplits") or []
    return split not in fit_splits


def _normalise_ranked_entry(entry):
    if len(entry) < 2:
        raise ValueError("ranked horse entries require horse number and probability")
    horse_no = _normalise_horse(entry[0])
    if horse_no is None:
        raise ValueError(f"Invalid horse number in ranked entry: {entry!r}")
    return horse_no, _finite(entry[1], 0.0), entry[2] if len(entry) > 2 else 0


def _parse_combination(value):
    try:
        parsed = json.loads(value) if isinstance(value, str) else value
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(parsed, (list, tuple)) or len(parsed) != 2:
        return None
    values = [_normalise_horse(item) for item in parsed]
    return values if all(value is not None for value in values) else None


def _canonical_combination(values):
    return tuple(sorted((_normalise_horse(value) for value in values), key=_horse_sort_key))


def _normalise_horse(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value).strip() if value is not None and str(value).strip() else None
    if not math.isfinite(number):
        return None
    return int(number) if number.is_integer() else str(value).strip()


def _horse_sort_key(value):
    if isinstance(value, int):
        return (0, value)
    return (1, _stable_text(value))


def _resolve_report_path(report_path, value, fallback):
    candidate = Path(value).expanduser() if value else fallback
    if candidate.is_absolute():
        return candidate
    beside_report = (report_path.parent / candidate).resolve()
    if beside_report.exists():
        return beside_report
    from_current_directory = (Path.cwd() / candidate).resolve()
    if from_current_directory.exists():
        return from_current_directory
    return beside_report


def _read_json_object(path, label):
    if not path.is_file():
        raise FileNotFoundError(f"{label} does not exist: {path}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"Invalid {label} JSON: {path}: {error}") from error
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be a JSON object: {path}")
    return value


def _require_lightgbm():
    try:
        import lightgbm
    except ImportError as error:
        raise MissingDependencyError(
            "Missing required Python dependency: lightgbm. "
            f"Install it with: {sys.executable} -m pip install lightgbm"
        ) from error
    return lightgbm


def _require_prediction_dependencies():
    lightgbm = _require_lightgbm()
    try:
        import pandas
    except ImportError as error:
        raise MissingDependencyError(
            "Missing required Python dependency: pandas. "
            f"Install it with: {sys.executable} -m pip install pandas"
        ) from error
    return pandas, lightgbm


def _finite(value, fallback):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


def _finite_nonnegative(value):
    number = _finite(value, float("nan"))
    return number if math.isfinite(number) and number >= 0 else None


def _positive_int(value):
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _stable_text(value):
    return "" if value is None else str(value)


def _race_sort_key(race_id, entries):
    dates = sorted(
        _stable_text(entry[1].get("date"))
        for entry in entries
        if entry[1].get("date")
    )
    return (dates[0] if dates else "", _stable_text(race_id))


def _money(value):
    return round(float(value), 2)


def _rate(numerator, denominator):
    return round(float(numerator) / denominator, 6) if denominator else None


def build_parser():
    parser = argparse.ArgumentParser(description="Backtest strict local QIN/QPL strategies.")
    parser.add_argument("--matrix", required=True, help="training-matrix.jsonl or .csv")
    parser.add_argument("--model-report", required=True, help="trained model final report JSON")
    parser.add_argument("--db", required=True, help="SQLite database containing official dividends")
    parser.add_argument("--output", required=True, help="JSON backtest report")
    parser.add_argument("--ledger-output", help="optional compact per-race JSONL ledger")
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        result = benchmark_exotic_strategies(
            args.matrix,
            args.model_report,
            args.db,
            output_path=args.output,
            ledger_output=args.ledger_output,
        )
    except (MissingDependencyError, TrainingMissingDependencyError, ValueError, OSError, sqlite3.Error) as error:
        raise SystemExit(str(error)) from error
    print(
        f"Backtested QIN/QPL strategies: validation races {result['input']['racesBySplit']['validation']}, "
        f"holdout races {result['input']['racesBySplit']['holdout']}"
    )
    print(f"Saved report to {args.output}")
    if args.ledger_output:
        print(f"Saved ledger to {args.ledger_output}")


if __name__ == "__main__":
    main()
