#!/usr/bin/env python3
"""Train and calibrate independent unordered QIN/QPL pair probabilities."""

import argparse
import importlib
import importlib.metadata
import json
import math
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from build_probability_stack import fit_calibrator


SUPPORTED_POOLS = ("quinella", "quinellaPlace")
CALIBRATION_METHODS = ("raw", "sigmoid", "isotonic")
PROBABILITY_EPSILON = 1e-6
REPORT_VERSION = "exotic-pair-model-v1"
PAIR_METADATA_COLUMNS = frozenset((
    "raceId", "date", "split", "poolKey", "pairKey", "horseNoA",
    "horseNoB", "targetPair",
))


def select_pair_feature_columns(columns):
    """Apply the T-10 pair feature policy and report rejected leakage fields."""
    selected = []
    excluded = []
    for column in columns:
        if column in PAIR_METADATA_COLUMNS:
            continue
        normalized = str(column).lower()
        windows = [int(value) for value in re.findall(r"t(\d+)", normalized)]
        leaks = (
            any(token in normalized for token in ("target", "dividend", "payout", "result", "final"))
            or any(window < 10 for window in windows)
        )
        if leaks:
            excluded.append(column)
        else:
            selected.append(column)
    return selected, excluded


def compare_pair_model(
    rows,
    raw_probabilities,
    *,
    pool,
    calibration_methods=CALIBRATION_METHODS,
    calibration_fitter=fit_calibrator,
):
    """Compare an independent pair model with a market-derived baseline."""
    model = calibrate_pair_predictions(
        rows,
        raw_probabilities,
        pool=pool,
        calibration_methods=calibration_methods,
        calibration_fitter=calibration_fitter,
    )
    baseline = calibrate_pair_predictions(
        rows,
        baseline_pair_probabilities(rows, pool=pool),
        pool=pool,
        calibration_methods=calibration_methods,
        calibration_fitter=calibration_fitter,
    )
    selected_stack = select_pair_stack(
        rows,
        model["probabilities"],
        baseline["probabilities"],
        pool=pool,
    )
    validation_lift = _metric_lift(
        selected_stack["metrics"]["validation"], baseline["metrics"]["validation"]
    )
    holdout_lift = _metric_lift(
        selected_stack["metrics"]["holdout"], baseline["metrics"]["holdout"]
    )
    failed_gates = []
    if selected_stack["metrics"]["holdout"]["races"] < 200:
        failed_gates.append("minimumHoldoutRaces")
    if validation_lift["logLossReduction"] <= 0:
        failed_gates.append("validationLogLossImprovement")
    if holdout_lift["logLossReduction"] <= 0:
        failed_gates.append("holdoutLogLossImprovement")
    if holdout_lift["brierReduction"] < 0:
        failed_gates.append("holdoutBrierNonDegradation")
    if holdout_lift["topPairHitRateLift"] < -0.01:
        failed_gates.append("holdoutTopPairNonDegradation")
    return {
        "pool": pool,
        "model": model,
        "marketBaseline": baseline,
        "selectedStack": selected_stack,
        "improvementVsMarketBaseline": {
            "validationLogLossReduction": validation_lift["logLossReduction"],
            "validationBrierReduction": validation_lift["brierReduction"],
            "validationTopPairHitRateLift": validation_lift["topPairHitRateLift"],
            "holdoutLogLossReduction": holdout_lift["logLossReduction"],
            "holdoutBrierReduction": holdout_lift["brierReduction"],
            "holdoutTopPairHitRateLift": holdout_lift["topPairHitRateLift"],
        },
        "promotion": {
            "researchStatus": "RESEARCH_CHAMPION" if not failed_gates else "NO_GO",
            "failedGates": failed_gates,
            "cashMode": "NO_BET",
            "prospectiveStatus": "BLOCKED_DATA",
            "reason": "QIN/QPL require prospective locked prices, settlement, and portfolio-risk evidence",
        },
    }


def select_pair_stack(
    rows,
    model_probabilities,
    baseline_probabilities,
    *,
    pool,
    model_weights=(0.0, 0.25, 0.5, 0.75, 1.0),
):
    """Choose a Benter-style model/market blend using validation only."""
    if len(rows) != len(model_probabilities) or len(rows) != len(baseline_probabilities):
        raise ValueError("rows, model probabilities, and baseline probabilities must align")
    weights = tuple(float(value) for value in model_weights)
    if not weights or any(not math.isfinite(value) or value < 0 or value > 1 for value in weights):
        raise ValueError("model_weights must contain finite values between 0 and 1")
    selected = None
    candidates = []
    for index, weight in enumerate(weights):
        blended = [
            weight * model + (1.0 - weight) * baseline
            for model, baseline in zip(model_probabilities, baseline_probabilities)
        ]
        probabilities = _apply_pool_probability_policy(rows, blended, pool)
        validation_metrics = _split_metrics(rows, probabilities, "validation")
        candidate = {
            "modelWeight": weight,
            "marketWeight": 1.0 - weight,
            "validationMetrics": validation_metrics,
        }
        candidates.append(candidate)
        score = (
            validation_metrics["logLoss"],
            validation_metrics["brierScore"],
            index,
        )
        if selected is None or score < selected["score"]:
            selected = {
                "score": score,
                "modelWeight": weight,
                "probabilities": probabilities,
                "validationMetrics": validation_metrics,
            }
    holdout_metrics = _split_metrics(rows, selected["probabilities"], "holdout")
    holdout_metrics["isOutOfSample"] = True
    return {
        "selection": {
            "selectedOn": "validation",
            "holdoutUsedForSelection": False,
            "modelWeight": selected["modelWeight"],
            "marketWeight": 1.0 - selected["modelWeight"],
        },
        "candidates": candidates,
        "probabilities": selected["probabilities"],
        "metrics": {
            "validation": selected["validationMetrics"],
            "holdout": holdout_metrics,
        },
    }


def run_training(
    input_path,
    output_path,
    *,
    pool,
    parameters=None,
    predictions_output_path=None,
    calibration_methods=CALIBRATION_METHODS,
    predictor=None,
):
    """Train CatBoost pair probabilities and write compact research artifacts."""
    if pool not in SUPPORTED_POOLS:
        raise ValueError(f"unsupported exotic pool {pool!r}")
    pandas_module = importlib.import_module("pandas")
    frame = pandas_module.read_json(input_path, lines=True, convert_dates=False)
    if frame.empty:
        raise ValueError("pair matrix is empty")
    required = set(PAIR_METADATA_COLUMNS) | {
        "marketWinImpliedProbT10Low",
        "marketWinImpliedProbT10High",
        "marketPlaceImpliedProbT10Product",
    }
    missing = sorted(required - set(frame.columns))
    if missing:
        raise ValueError("pair matrix is missing columns: " + ", ".join(missing))
    feature_names, excluded_features = select_pair_feature_columns(list(frame.columns))
    if not feature_names:
        raise ValueError("no usable T-10 pair features remain")

    compact_columns = [
        "raceId", "date", "split", "poolKey", "pairKey", "horseNoA",
        "horseNoB", "targetPair", "marketWinImpliedProbT10Low",
        "marketWinImpliedProbT10High", "marketPlaceImpliedProbT10Product",
    ]
    rows = frame[compact_columns].to_dict(orient="records")
    placeholder_probabilities = [0.5] * len(rows)
    _validate_rows(rows, placeholder_probabilities, pool)
    fit_indexes = [index for index, row in enumerate(rows) if row["split"] == "train"]
    validation_indexes = [
        index for index, row in enumerate(rows) if row["split"] == "validation"
    ]
    if not fit_indexes:
        raise ValueError("pair training requires train rows")
    if not validation_indexes:
        raise ValueError("pair training requires validation rows")

    params = {
        "iterations": 500,
        "learning_rate": 0.05,
        "depth": 7,
        "l2_leaf_reg": 5.0,
        "random_strength": 1.0,
        "loss_function": "Logloss",
        "eval_metric": "Logloss",
        "random_seed": 20260718,
        "thread_count": 1,
        "allow_writing_files": False,
        "verbose": False,
        "early_stopping_rounds": 40,
    }
    if parameters:
        params.update(parameters)
    _validate_training_parameters(params)

    output = Path(output_path).expanduser()
    output.parent.mkdir(parents=True, exist_ok=True)
    model_path = output.with_suffix(".model.cbm")
    manifest_path = output.with_suffix(".feature-manifest.json")
    if predictor is None:
        raw_probabilities, training = _fit_catboost(
            frame,
            feature_names,
            fit_indexes,
            validation_indexes,
            params,
            model_path,
        )
        model_artifact = str(model_path.resolve())
    else:
        raw_probabilities, training = predictor(
            frame, feature_names, fit_indexes, validation_indexes, params
        )
        model_artifact = None
    raw_probabilities = [float(value) for value in raw_probabilities]
    if len(raw_probabilities) != len(rows):
        raise ValueError(
            f"pair predictor returned {len(raw_probabilities)} probabilities for {len(rows)} rows"
        )

    comparison = compare_pair_model(
        rows,
        raw_probabilities,
        pool=pool,
        calibration_methods=calibration_methods,
    )
    model_probabilities = comparison["model"]["probabilities"]
    baseline_probabilities = comparison["marketBaseline"]["probabilities"]
    selected_probabilities = comparison["selectedStack"]["probabilities"]
    prediction_path = (
        Path(predictions_output_path).expanduser()
        if predictions_output_path is not None
        else output.with_suffix(".predictions.jsonl")
    )
    prediction_path.parent.mkdir(parents=True, exist_ok=True)
    with prediction_path.open("w", encoding="utf-8") as handle:
        for row, model_probability, baseline_probability, selected_probability in zip(
            rows, model_probabilities, baseline_probabilities, selected_probabilities
        ):
            handle.write(json.dumps({
                "version": REPORT_VERSION,
                "modelId": f"catboost-{pool}-pair-t10-v1",
                "raceId": row["raceId"],
                "date": row["date"],
                "split": row["split"],
                "poolKey": pool,
                "pairKey": row["pairKey"],
                "horseNoA": int(row["horseNoA"]),
                "horseNoB": int(row["horseNoB"]),
                "targetPair": int(row["targetPair"]),
                "modelProbability": _round(model_probability),
                "marketBaselineProbability": _round(baseline_probability),
                "selectedProbability": _round(selected_probability),
            }, ensure_ascii=False) + "\n")

    categorical_features = [
        name for name in feature_names
        if not pandas_module.api.types.is_numeric_dtype(frame[name])
    ]
    manifest = {
        "version": REPORT_VERSION,
        "modelId": f"catboost-{pool}-pair-t10-v1",
        "pool": pool,
        "features": feature_names,
        "categoricalFeatures": categorical_features,
        "excludedFeatures": excluded_features,
        "decisionWindow": "T-10",
        "target": "targetPair",
        "symmetry": "unordered pair features",
    }
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    public_model = {
        key: value for key, value in comparison["model"].items() if key != "probabilities"
    }
    public_baseline = {
        key: value
        for key, value in comparison["marketBaseline"].items()
        if key != "probabilities"
    }
    public_stack = {
        key: value
        for key, value in comparison["selectedStack"].items()
        if key != "probabilities"
    }
    report = {
        "version": REPORT_VERSION,
        "modelId": f"catboost-{pool}-pair-t10-v1",
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "pool": pool,
        "cashMode": "NO_BET",
        "input": {
            "matrix": str(Path(input_path).expanduser().resolve()),
            "rows": len(rows),
            "races": len({row["raceId"] for row in rows}),
            "rowsBySplit": {
                split: sum(row["split"] == split for row in rows)
                for split in ("train", "validation", "holdout")
            },
            "racesBySplit": {
                split: len({row["raceId"] for row in rows if row["split"] == split})
                for split in ("train", "validation", "holdout")
            },
        },
        "training": training,
        "parameters": params,
        "features": feature_names,
        "excludedFeatures": excluded_features,
        "featureManifest": str(manifest_path.resolve()),
        "modelArtifact": model_artifact,
        "predictionArtifact": str(prediction_path.resolve()),
        "holdoutPolicy": {
            "chronologicallyOutOfSample": True,
            "usedForTraining": False,
            "usedForCalibration": False,
            "researchIterationStatus": "REUSED",
            "promotionEligible": False,
            "reason": (
                "the historical holdout cohort has already been viewed in prior "
                "P1/P2 research iterations; promotion requires a fresh later cohort "
                "or prospective locked sample"
            ),
        },
        "model": public_model,
        "marketBaseline": public_baseline,
        "selectedStack": public_stack,
        "improvementVsMarketBaseline": comparison["improvementVsMarketBaseline"],
        "promotion": comparison["promotion"],
        "settlementPolicy": {
            "status": "NOT_EVALUATED_FOR_VALUE",
            "reason": "historical official dividends are outcomes, not lockable pre-race QIN/QPL prices",
        },
    }
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def _fit_catboost(
    frame,
    feature_names,
    fit_indexes,
    validation_indexes,
    parameters,
    model_path,
):
    catboost_module = importlib.import_module("catboost")
    pandas_module = importlib.import_module("pandas")
    features = frame[feature_names].copy()
    categorical_features = []
    for name in feature_names:
        if pandas_module.api.types.is_numeric_dtype(features[name]):
            features[name] = pandas_module.to_numeric(features[name], errors="coerce")
        else:
            categorical_features.append(name)
            features[name] = features[name].fillna("__MISSING__").astype(str)
    labels = frame["targetPair"].astype(int)
    model_parameters = dict(parameters)
    early_stopping_rounds = int(model_parameters.pop("early_stopping_rounds"))
    model = catboost_module.CatBoostClassifier(**model_parameters)
    model.fit(
        features.iloc[fit_indexes],
        labels.iloc[fit_indexes],
        eval_set=(features.iloc[validation_indexes], labels.iloc[validation_indexes]),
        cat_features=categorical_features,
        early_stopping_rounds=early_stopping_rounds,
        use_best_model=True,
    )
    model.save_model(str(model_path))
    best_zero_based = model.get_best_iteration()
    best_iteration = int(best_zero_based) + 1 if best_zero_based is not None and best_zero_based >= 0 else None
    return model.predict_proba(features)[:, 1].tolist(), {
        "engine": "catboost",
        "bestIteration": best_iteration,
        "effectiveIterations": best_iteration or int(parameters["iterations"]),
        "fitSplits": ["train"],
        "modelSelectionSplit": "validation",
        "holdoutUsedForSelection": False,
        "dependencyVersions": _dependency_versions(),
    }


def _validate_training_parameters(parameters):
    for name in ("iterations", "depth", "thread_count", "early_stopping_rounds"):
        try:
            value = int(parameters[name])
        except (TypeError, ValueError) as error:
            raise ValueError(f"{name} must be an integer") from error
        if value <= 0:
            raise ValueError(f"{name} must be > 0")
    for name in ("learning_rate", "l2_leaf_reg", "random_strength"):
        try:
            value = float(parameters[name])
        except (TypeError, ValueError) as error:
            raise ValueError(f"{name} must be numeric") from error
        if not math.isfinite(value) or value < 0 or (name == "learning_rate" and value == 0):
            raise ValueError(f"{name} has an invalid value")


def _dependency_versions():
    versions = {}
    for package in ("catboost", "pandas", "numpy", "scikit-learn"):
        try:
            versions[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            versions[package] = None
    return versions


def build_parser():
    parser = argparse.ArgumentParser(description="Train an independent QIN/QPL pair model.")
    parser.add_argument("--input", required=True, help="pair matrix JSONL")
    parser.add_argument("--output", required=True, help="model report JSON")
    parser.add_argument("--pool", required=True, choices=SUPPORTED_POOLS)
    parser.add_argument("--predictions-output")
    parser.add_argument("--iterations", type=int, default=500)
    parser.add_argument("--learning-rate", type=float, default=0.05)
    parser.add_argument("--depth", type=int, default=7)
    parser.add_argument("--early-stopping-rounds", type=int, default=40)
    parser.add_argument("--thread-count", type=int, default=1)
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        report = run_training(
            args.input,
            args.output,
            pool=args.pool,
            predictions_output_path=args.predictions_output,
            parameters={
                "iterations": args.iterations,
                "learning_rate": args.learning_rate,
                "depth": args.depth,
                "early_stopping_rounds": args.early_stopping_rounds,
                "thread_count": args.thread_count,
            },
        )
    except (ImportError, OSError, ValueError) as error:
        raise SystemExit(str(error)) from error
    holdout = report["model"]["metrics"]["holdout"]
    print(
        f"{args.pool}: holdout log loss {holdout['logLoss']}, "
        f"Brier {holdout['brierScore']}, Top-pair {holdout['topPairHitRate']}"
    )
    print(
        f"Research {report['promotion']['researchStatus']}; cash {report['promotion']['cashMode']}"
    )
    print(f"Saved report to {Path(args.output).expanduser().resolve()}")


def calibrate_pair_predictions(
    rows,
    raw_probabilities,
    *,
    pool,
    calibration_methods=CALIBRATION_METHODS,
    calibration_fitter=fit_calibrator,
):
    """Select calibration on validation and evaluate untouched holdout once."""
    _validate_rows(rows, raw_probabilities, pool)
    methods = tuple(calibration_methods)
    if not methods:
        raise ValueError("calibration_methods must not be empty")
    validation_indexes = [index for index, row in enumerate(rows) if row["split"] == "validation"]
    holdout_indexes = [index for index, row in enumerate(rows) if row["split"] == "holdout"]
    if not validation_indexes:
        raise ValueError("pair calibration requires validation rows")
    if not holdout_indexes:
        raise ValueError("pair calibration requires holdout rows")
    validation_labels = [int(rows[index]["targetPair"]) for index in validation_indexes]
    validation_raw = [raw_probabilities[index] for index in validation_indexes]

    selected = None
    candidates = []
    for method_index, method in enumerate(methods):
        if method not in CALIBRATION_METHODS:
            raise ValueError(f"unsupported calibration method {method!r}")
        try:
            if method == "raw":
                transformed = list(raw_probabilities)
            else:
                transform = calibration_fitter(method, validation_raw, validation_labels)
                transformed = list(transform(raw_probabilities))
            probabilities = _apply_pool_probability_policy(rows, transformed, pool)
            validation_metrics = _split_metrics(rows, probabilities, "validation")
            candidate = {
                "method": method,
                "available": True,
                "validationMetrics": validation_metrics,
            }
            score = (
                validation_metrics["logLoss"],
                validation_metrics["brierScore"],
                method_index,
            )
            if selected is None or score < selected["score"]:
                selected = {
                    "method": method,
                    "score": score,
                    "probabilities": probabilities,
                    "validationMetrics": validation_metrics,
                }
        except ValueError as error:
            candidate = {"method": method, "available": False, "error": str(error)}
        candidates.append(candidate)
    if selected is None:
        raise ValueError("no usable pair calibration candidate")

    holdout_metrics = _split_metrics(rows, selected["probabilities"], "holdout")
    holdout_metrics["isOutOfSample"] = True
    return {
        "pool": pool,
        "cashMode": "NO_BET",
        "selection": {
            "selectedOn": "validation",
            "holdoutUsedForSelection": False,
            "calibration": selected["method"],
            "probabilityPolicy": (
                "race-normalized unordered pair probabilities"
                if pool == "quinella"
                else "independent unordered pair marginal probabilities"
            ),
        },
        "calibrationCandidates": candidates,
        "probabilities": selected["probabilities"],
        "metrics": {
            "validation": selected["validationMetrics"],
            "holdout": holdout_metrics,
        },
    }


def baseline_pair_probabilities(rows, *, pool):
    """Return T-10 market-derived Harville QIN or product QPL baselines."""
    if pool not in SUPPORTED_POOLS:
        raise ValueError(f"unsupported exotic pool {pool!r}")
    scores = []
    for index, row in enumerate(rows, start=1):
        if pool == "quinella":
            left = _required_probability(row.get("marketWinImpliedProbT10Low"), index)
            right = _required_probability(row.get("marketWinImpliedProbT10High"), index)
            score = left * right * (
                1.0 / max(PROBABILITY_EPSILON, 1.0 - left)
                + 1.0 / max(PROBABILITY_EPSILON, 1.0 - right)
            )
            scores.append(score)
        else:
            product = _required_probability(
                row.get("marketPlaceImpliedProbT10Product"), index,
                allow_one=True,
            )
            scores.append(product)
    return _apply_pool_probability_policy(rows, scores, pool)


def _apply_pool_probability_policy(rows, values, pool):
    if len(rows) != len(values):
        raise ValueError("rows and probabilities must have the same length")
    clipped = [_probability(value) for value in values]
    if pool != "quinella":
        return clipped
    grouped = defaultdict(list)
    for index, row in enumerate(rows):
        grouped[str(row.get("raceId"))].append(index)
    normalized = [0.0] * len(rows)
    for indexes in grouped.values():
        total = sum(clipped[index] for index in indexes)
        if total <= 0:
            total = float(len(indexes))
            for index in indexes:
                clipped[index] = 1.0
        for index in indexes:
            normalized[index] = clipped[index] / total
    return normalized


def _split_metrics(rows, probabilities, split):
    indexes = [index for index, row in enumerate(rows) if row["split"] == split]
    if not indexes:
        return _empty_metrics()
    labels = [int(rows[index]["targetPair"]) for index in indexes]
    values = [_probability(probabilities[index]) for index in indexes]
    log_loss = -sum(
        label * math.log(value) + (1 - label) * math.log(1.0 - value)
        for label, value in zip(labels, values)
    ) / len(values)
    brier = sum((value - label) ** 2 for label, value in zip(labels, values)) / len(values)
    by_race = defaultdict(list)
    for index in indexes:
        by_race[str(rows[index]["raceId"])].append(index)
    top_pair_hits = 0
    winning_pairs_in_top3 = 0
    positive_pairs = sum(labels)
    for race_indexes in by_race.values():
        ranked = sorted(
            race_indexes,
            key=lambda index: (-probabilities[index], str(rows[index].get("pairKey") or "")),
        )
        top_pair_hits += int(rows[ranked[0]]["targetPair"])
        winning_pairs_in_top3 += sum(int(rows[index]["targetPair"]) for index in ranked[:3])
    return {
        "rows": len(indexes),
        "races": len(by_race),
        "positivePairs": positive_pairs,
        "logLoss": _round(log_loss),
        "brierScore": _round(brier),
        "topPairHits": top_pair_hits,
        "topPairHitRate": _round(top_pair_hits / len(by_race)),
        "winningPairsInTop3": winning_pairs_in_top3,
        "winningPairRecallAt3": _round(
            winning_pairs_in_top3 / positive_pairs if positive_pairs > 0 else 0.0
        ),
    }


def _validate_rows(rows, probabilities, pool):
    if pool not in SUPPORTED_POOLS:
        raise ValueError(f"unsupported exotic pool {pool!r}")
    if not isinstance(rows, list) or not rows:
        raise ValueError("pair rows must be a non-empty list")
    if len(rows) != len(probabilities):
        raise ValueError("rows and probabilities must have the same length")
    race_splits = defaultdict(set)
    for index, row in enumerate(rows, start=1):
        race_id = str(row.get("raceId") or "").strip()
        split = str(row.get("split") or "").strip()
        if not race_id or not split:
            raise ValueError(f"pair row {index} is missing raceId or split")
        target = row.get("targetPair")
        if target not in (0, 1):
            raise ValueError(f"pair row {index} has invalid targetPair {target!r}")
        race_splits[race_id].add(split)
    for race_id, splits in race_splits.items():
        if len(splits) > 1:
            raise ValueError(
                f"race {race_id!r} appears in multiple splits: {', '.join(sorted(splits))}"
            )


def _required_probability(value, row_number, allow_one=False):
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"pair row {row_number} is missing a T-10 market baseline") from error
    upper_ok = number <= 1.0 if allow_one else number < 1.0
    if not math.isfinite(number) or number <= 0.0 or not upper_ok:
        raise ValueError(f"pair row {row_number} has invalid T-10 market baseline {value!r}")
    return number


def _probability(value):
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"invalid pair probability {value!r}") from error
    if not math.isfinite(number):
        raise ValueError(f"invalid pair probability {value!r}")
    return min(1.0 - PROBABILITY_EPSILON, max(PROBABILITY_EPSILON, number))


def _round(value):
    return round(float(value), 6)


def _metric_lift(model, baseline):
    return {
        "logLossReduction": _round(baseline["logLoss"] - model["logLoss"]),
        "brierReduction": _round(baseline["brierScore"] - model["brierScore"]),
        "topPairHitRateLift": _round(model["topPairHitRate"] - baseline["topPairHitRate"]),
    }


def _empty_metrics():
    return {
        "rows": 0,
        "races": 0,
        "positivePairs": 0,
        "logLoss": None,
        "brierScore": None,
        "topPairHits": 0,
        "topPairHitRate": None,
        "winningPairsInTop3": 0,
        "winningPairRecallAt3": None,
    }


if __name__ == "__main__":
    main()
