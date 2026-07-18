#!/usr/bin/env python3
"""Train leakage-safe CatBoost WIN or PLACE runner models."""

import argparse
import importlib
import importlib.metadata
import json
import math
from datetime import datetime, timezone
from pathlib import Path

from train_tree_model import (
    LABEL_COLUMNS,
    METADATA_COLUMNS,
    PROBABILITY_EPSILON,
    SPLITS,
    SUPPORTED_MODES,
    _as_float,
    _is_missing,
    _label_value,
    _normalize_fit_splits,
    _ordered_columns,
    _positive_int_or_none,
    _python_scalar,
    _round_or_none,
    _validate_early_stopping_rounds,
    _validate_rows,
    apply_target_probability_policy,
    compute_split_metrics,
    fit_feature_encoder,
    load_matrix_rows,
    select_feature_columns,
)


MODEL_ID = "catboost-no-market-v1"
CAT_MISSING = "__MISSING__"


class MissingDependencyError(RuntimeError):
    """Raised when the optional CatBoost training stack is unavailable."""


def _require_catboost_dependencies():
    try:
        pandas_module = importlib.import_module("pandas")
        numpy_module = importlib.import_module("numpy")
        sklearn_module = importlib.import_module("sklearn")
        catboost_module = importlib.import_module("catboost")
    except ImportError as error:
        raise MissingDependencyError(
            "CatBoost training requires catboost, pandas, numpy, and scikit-learn. "
            "Install hkjc-horse-model/python/requirements-tree-model.txt in the local training environment."
        ) from error
    return pandas_module, numpy_module, sklearn_module, catboost_module


def _build_native_feature_frame(rows, encoder, pandas_module):
    columns = {}
    for feature_name in encoder["featureNames"]:
        if encoder["featureTypes"][feature_name] == "categorical":
            columns[feature_name] = [
                CAT_MISSING if _is_missing(row.get(feature_name)) else str(row.get(feature_name))
                for row in rows
            ]
        else:
            columns[feature_name] = [
                float("nan") if _as_float(row.get(feature_name)) is None else _as_float(row.get(feature_name))
                for row in rows
            ]
    return pandas_module.DataFrame(columns)


def run_training(
    input_path,
    output_path,
    *,
    target="targetWin",
    mode="no-market",
    fit_splits=("train",),
    parameters=None,
    predictions_output_path=None,
):
    """Fit CatBoost under a decision-time feature policy and write artifacts."""
    if mode not in SUPPORTED_MODES:
        raise ValueError(f"Unsupported mode: {mode}; choose from {', '.join(SUPPORTED_MODES)}")
    model_id = f"catboost-{mode}-v1"
    pandas_module, numpy_module, _sklearn_module, catboost_module = _require_catboost_dependencies()
    rows = load_matrix_rows(input_path, pandas_module)
    _validate_rows(rows, target)
    fit_splits = _normalize_fit_splits(fit_splits)
    if "validation" in fit_splits and not any(row.get("split") == "validation" for row in rows):
        raise ValueError("validation is included in fit_splits but has no rows")
    all_columns = _ordered_columns(rows)
    feature_names, excluded_features = select_feature_columns(all_columns, mode=mode, target=target)
    if not feature_names:
        raise ValueError("No usable features remain after no-market exclusion")

    fit_indexes = [index for index, row in enumerate(rows) if row.get("split") in fit_splits]
    validation_indexes = [index for index, row in enumerate(rows) if row.get("split") == "validation"]
    encoder = fit_feature_encoder(rows, feature_names, fit_splits=fit_splits)
    frame = _build_native_feature_frame(rows, encoder, pandas_module)
    labels = numpy_module.asarray([_label_value(row.get(target)) for row in rows], dtype=int)
    fit_labels = labels[fit_indexes]
    if len(set(fit_labels.tolist())) < 2:
        raise ValueError(f"Fit splits target {target} must contain both 0 and 1 labels")

    params = {
        "iterations": 500,
        "learning_rate": 0.05,
        "depth": 6,
        "l2_leaf_reg": 3.0,
        "random_strength": 1.0,
        "loss_function": "Logloss",
        "eval_metric": "Logloss",
        "random_seed": 20260718,
        "thread_count": 1,
        "allow_writing_files": False,
        "verbose": False,
        "early_stopping_rounds": 0,
    }
    if parameters:
        params.update(parameters)
    _validate_parameters(params)
    early_stopping_rounds = _validate_early_stopping_rounds(params["early_stopping_rounds"])
    if early_stopping_rounds > 0 and "validation" in fit_splits:
        raise ValueError(
            "Cannot enable early stopping when validation is included in fit_splits; "
            "final-refit uses fixed iterations."
        )
    if early_stopping_rounds > 0:
        if not validation_indexes:
            raise ValueError("Validation split is required when early stopping is enabled")
        validation_labels = labels[validation_indexes]
        if len(set(validation_labels.tolist())) < 2:
            raise ValueError(
                f"Validation split target {target} must contain both 0 and 1 labels"
            )

    model_parameters = dict(params)
    model_parameters.pop("early_stopping_rounds", None)
    model = catboost_module.CatBoostClassifier(**model_parameters)
    categorical_features = [
        feature_name
        for feature_name in feature_names
        if encoder["featureTypes"][feature_name] == "categorical"
    ]
    fit_kwargs = {"cat_features": categorical_features}
    if early_stopping_rounds > 0:
        fit_kwargs.update({
            "eval_set": (frame.iloc[validation_indexes], labels[validation_indexes]),
            "early_stopping_rounds": early_stopping_rounds,
            "use_best_model": True,
        })
    model.fit(frame.iloc[fit_indexes], fit_labels, **fit_kwargs)
    best_iteration_zero_based = (
        _positive_int_or_none(model.get_best_iteration())
        if early_stopping_rounds > 0
        else None
    )
    best_iteration = best_iteration_zero_based + 1 if best_iteration_zero_based is not None else None
    effective_iterations = best_iteration or int(params["iterations"])
    raw_probabilities = model.predict_proba(frame)[:, 1]
    probabilities = apply_target_probability_policy(rows, raw_probabilities.tolist(), target)

    metrics_by_split = {}
    for split in SPLITS:
        split_rows = [row for row in rows if row.get("split") == split]
        split_probabilities = [
            probability
            for row, probability in zip(rows, probabilities)
            if row.get("split") == split
        ]
        metrics_by_split[split] = compute_split_metrics(
            split_rows,
            split_probabilities,
            target=target,
        )
        is_model_selection_sample = split == "validation" and early_stopping_rounds > 0
        metrics_by_split[split]["isOutOfSample"] = (
            split == "holdout" or (split not in fit_splits and not is_model_selection_sample)
        )
        metrics_by_split[split]["isModelSelectionSample"] = is_model_selection_sample

    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    model_path = output.with_suffix(".model.cbm")
    manifest_path = output.with_suffix(".feature-manifest.json")
    prediction_path = Path(predictions_output_path) if predictions_output_path is not None else None
    model.save_model(str(model_path))

    manifest = {
        "version": model_id,
        "modelId": model_id,
        "mode": mode,
        "target": target,
        "metadataColumns": list(METADATA_COLUMNS),
        "excludedFeatures": excluded_features,
        "features": feature_names,
        "featureTypes": encoder["featureTypes"],
        "categoricalHandling": "native string categories with explicit missing sentinel",
        "fitSplits": list(fit_splits),
        "numericMissingValue": "NaN passed to CatBoost",
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if prediction_path is not None:
        prediction_path.parent.mkdir(parents=True, exist_ok=True)
        prediction_rows = [
            {
                "version": model_id,
                "modelId": model_id,
                "target": target,
                "raceId": _python_scalar(row.get("raceId")),
                "date": _python_scalar(row.get("date")),
                "split": _python_scalar(row.get("split")),
                "horseId": _python_scalar(row.get("horseId")),
                "horseNo": _python_scalar(row.get("horseNo")),
                "fieldSize": _python_scalar(row.get("fieldSize")),
                "probability": _round_or_none(probability),
                "targetWin": _label_value(row.get("targetWin")),
                "targetPlace": _label_value(row.get("targetPlace")),
            }
            for row, probability in zip(rows, probabilities)
        ]
        prediction_path.write_text(
            "\n".join(json.dumps(row, ensure_ascii=False) for row in prediction_rows) + "\n",
            encoding="utf-8",
        )

    report = {
        "version": model_id,
        "modelId": model_id,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "input": {
            "name": Path(input_path).name,
            "format": "csv" if Path(input_path).suffix.lower() == ".csv" else "jsonl",
            "rows": len(rows),
            "races": len({row.get("raceId") for row in rows}),
            "rowsBySplit": {
                split: sum(row.get("split") == split for row in rows) for split in SPLITS
            },
            "racesBySplit": {
                split: len({row.get("raceId") for row in rows if row.get("split") == split})
                for split in SPLITS
            },
            "columns": len(all_columns),
        },
        "dependencies": _dependency_versions(),
        "parameters": params,
        "target": target,
        "mode": mode,
        "fitSplits": list(fit_splits),
        "validationIsInSample": "validation" in fit_splits,
        "lineage": "final-refit" if "validation" in fit_splits else "selection",
        "bestIteration": best_iteration,
        "effectiveIterations": effective_iterations,
        "earlyStopping": {
            "enabled": early_stopping_rounds > 0,
            "rounds": early_stopping_rounds,
            "validationSplit": "validation" if early_stopping_rounds > 0 else None,
        },
        "chronologicalSplits": list(SPLITS),
        "metadataColumnsExcluded": list(METADATA_COLUMNS),
        "labelColumnsExcluded": sorted(LABEL_COLUMNS),
        "excludedFeatures": excluded_features,
        "features": feature_names,
        "featureManifest": str(manifest_path),
        "modelArtifact": str(model_path),
        "predictionArtifact": str(prediction_path) if prediction_path is not None else None,
        "probabilityPolicy": {
            "normalization": (
                "race-level positive model probabilities sum to one"
                if target == "targetWin"
                else "runner-level bounded binary probabilities; no race-sum normalization"
            ),
            "clipEpsilon": PROBABILITY_EPSILON,
            "numericMissing": "NaN passed to CatBoost",
            "categoricalHandling": "native string categories",
        },
        "metrics": {
            "overall": compute_split_metrics(rows, probabilities, target=target),
            "bySplit": metrics_by_split,
        },
    }
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def _validate_parameters(params):
    boundaries = (
        ("iterations", lambda value: value > 0, "must be > 0"),
        ("learning_rate", lambda value: value > 0, "must be > 0"),
        ("depth", lambda value: value > 0, "must be > 0"),
        ("l2_leaf_reg", lambda value: value >= 0, "must be >= 0"),
        ("random_strength", lambda value: value >= 0, "must be >= 0"),
    )
    for name, predicate, message in boundaries:
        try:
            value = float(params[name])
        except (TypeError, ValueError) as error:
            raise ValueError(f"{name} must be numeric") from error
        if not math.isfinite(value) or not predicate(value):
            raise ValueError(f"{name} {message}")


def _dependency_versions():
    versions = {}
    for package in ("catboost", "numpy", "pandas", "scikit-learn"):
        try:
            versions[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            versions[package] = None
    return versions


def build_parser():
    parser = argparse.ArgumentParser(description="Train a leakage-safe local CatBoost runner model.")
    parser.add_argument("--input", required=True, help="training-matrix .jsonl or .csv")
    parser.add_argument("--output", required=True, help="JSON report path")
    parser.add_argument("--predictions-output", help="versioned per-runner prediction JSONL")
    parser.add_argument("--target", choices=sorted(LABEL_COLUMNS), default="targetWin")
    parser.add_argument("--mode", choices=SUPPORTED_MODES, default="no-market")
    parser.add_argument("--iterations", type=int, default=500)
    parser.add_argument("--learning-rate", type=float, default=0.05)
    parser.add_argument("--depth", type=int, default=6)
    parser.add_argument("--l2-leaf-reg", type=float, default=3.0)
    parser.add_argument("--random-strength", type=float, default=1.0)
    parser.add_argument("--early-stopping-rounds", type=int, default=0)
    parser.add_argument("--include-validation-in-fit", action="store_true")
    parser.add_argument("--seed", type=int, default=20260718)
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    parameters = {
        "iterations": args.iterations,
        "learning_rate": args.learning_rate,
        "depth": args.depth,
        "l2_leaf_reg": args.l2_leaf_reg,
        "random_strength": args.random_strength,
        "early_stopping_rounds": args.early_stopping_rounds,
        "random_seed": args.seed,
    }
    try:
        report = run_training(
            args.input,
            args.output,
            target=args.target,
            mode=args.mode,
            fit_splits=("train", "validation") if args.include_validation_in_fit else ("train",),
            parameters=parameters,
            predictions_output_path=args.predictions_output,
        )
    except (MissingDependencyError, ValueError, OSError) as error:
        raise SystemExit(str(error)) from error
    holdout = report["metrics"]["bySplit"]["holdout"]
    print(
        f"Trained {report['modelId']}: {report['input']['rows']} rows, "
        f"holdout races {holdout['races']}, holdout logLoss {holdout['logLoss']}"
    )
    print(f"Saved report to {args.output}")
    print(f"Saved model artifact to {report['modelArtifact']}")
    print(f"Saved feature manifest to {report['featureManifest']}")
    if report["predictionArtifact"] is not None:
        print(f"Saved runner predictions to {report['predictionArtifact']}")


if __name__ == "__main__":
    main()
