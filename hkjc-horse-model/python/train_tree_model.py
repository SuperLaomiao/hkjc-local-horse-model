#!/usr/bin/env python3
"""Train the local LightGBM no-market runner benchmark.

The input is the flattened JSONL/CSV emitted by ``hkjc:training-matrix``.
Only the existing chronological ``train``/``validation``/``holdout`` labels
are used; this module never creates a random split.
"""

import argparse
import csv
import importlib.metadata
import json
import math
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


MODEL_ID = "lightgbm-no-market-v1"
SPLITS = ("train", "validation", "holdout")
METADATA_COLUMNS = (
    "raceId", "date", "split", "horseId", "horseNo",
    "racecourse", "raceNo", "fieldSize", "targetWin", "targetPlace",
)
LABEL_COLUMNS = frozenset(("targetWin", "targetPlace"))
MARKET_TOKENS = frozenset(("market", "odds", "pool", "money", "investment", "dividend", "payout"))
PROBABILITY_EPSILON = 1e-6
SELECTION_PARAMETER_NAMES = (
    "learning_rate", "num_leaves", "max_depth", "min_child_samples",
    "reg_lambda", "reg_alpha", "subsample", "colsample_bytree",
)


class MissingDependencyError(RuntimeError):
    """Raised when the optional local training stack is not installed."""


def select_feature_columns(columns, mode="no-market", target="targetWin"):
    """Return usable feature names and names excluded by the no-market policy."""
    if mode != "no-market":
        raise ValueError(f"Unsupported mode: {mode}; only no-market is implemented")
    selected = []
    excluded = []
    for column in columns:
        if column in METADATA_COLUMNS or column in LABEL_COLUMNS or _is_metadata_or_identifier(column):
            continue
        if _is_market_feature(column):
            excluded.append(column)
        else:
            selected.append(column)
    if target not in LABEL_COLUMNS:
        raise ValueError(f"Unsupported target: {target}")
    return selected, excluded


def _is_market_feature(feature_name):
    normalized = str(feature_name).lower()
    return any(token in normalized for token in MARKET_TOKENS)


def _is_metadata_or_identifier(feature_name):
    normalized = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", str(feature_name)).lower()
    tokens = set(re.findall(r"[a-z0-9]+", normalized))
    return bool(tokens & {"id", "identifier", "metadata"})


def fit_feature_encoder(rows, feature_names, train_split="train", fit_splits=None):
    """Fit numeric/category handling using fit splits only.

    ``train_split`` remains as a backward-compatible alias for the default
    behavior. Categories are assigned stable integer codes from sorted values
    in ``fit_splits``; values first seen outside those splits transform to -1.
    """
    if fit_splits is None:
        fit_splits = (train_split,)
    fit_splits = _normalize_fit_splits(fit_splits)
    fit_rows = [row for row in rows if row.get("split") in fit_splits]
    feature_types = {}
    categorical_mappings = {}
    for feature_name in feature_names:
        values = [row.get(feature_name) for row in fit_rows if not _is_missing(row.get(feature_name))]
        if values and all(_as_float(value) is not None for value in values):
            feature_types[feature_name] = "numeric"
            continue
        feature_types[feature_name] = "categorical"
        categories = sorted({_category_key(value) for value in values})
        categorical_mappings[feature_name] = {category: index for index, category in enumerate(categories)}
    return {
        "featureNames": list(feature_names),
        "featureTypes": feature_types,
        "categoricalMappings": categorical_mappings,
        "trainSplit": train_split,
        "fitSplits": list(fit_splits),
        "unknownCategoryValue": -1,
    }


def transform_feature_rows(rows, encoder):
    """Transform rows without imputing numeric missing values."""
    transformed = []
    for row in rows:
        values = []
        for feature_name in encoder["featureNames"]:
            value = row.get(feature_name)
            if encoder["featureTypes"][feature_name] == "numeric":
                number = _as_float(value)
                values.append(float("nan") if number is None else number)
            elif _is_missing(value):
                values.append(float(encoder["unknownCategoryValue"]))
            else:
                values.append(float(encoder["categoricalMappings"][feature_name].get(
                    _category_key(value), encoder["unknownCategoryValue"]
                )))
        transformed.append(values)
    return transformed


def _build_feature_frame(rows, encoder, pandas_module, numpy_module):
    frame = pandas_module.DataFrame(
        transform_feature_rows(rows, encoder),
        columns=encoder["featureNames"],
        dtype=float,
    )
    for feature_name, feature_type in encoder["featureTypes"].items():
        if feature_type == "categorical":
            frame[feature_name] = numpy_module.asarray(
                frame[feature_name].tolist(), dtype=numpy_module.int32
            )
    return frame


def normalize_race_probabilities(rows, raw_probabilities, epsilon=PROBABILITY_EPSILON):
    """Clip positive scores and normalize them so each race sums to one."""
    if len(rows) != len(raw_probabilities):
        raise ValueError("rows and probabilities must have the same length")
    by_race = defaultdict(list)
    for index, row in enumerate(rows):
        by_race[row.get("raceId")].append(index)
    normalized = [0.0] * len(rows)
    for indexes in by_race.values():
        scores = [max(epsilon, min(1.0, _finite_float(raw_probabilities[index], 0.0))) for index in indexes]
        total = sum(scores)
        if total <= 0.0:
            scores = [1.0] * len(indexes)
            total = float(len(indexes))
        for index, score in zip(indexes, scores):
            normalized[index] = score / total
    return normalized


def compute_split_metrics(rows, probabilities, target="targetWin"):
    """Compute row metrics plus race-level top-pick and top-three metrics."""
    if len(rows) != len(probabilities):
        raise ValueError("rows and probabilities must have the same length")
    race_rows = defaultdict(list)
    for index, row in enumerate(rows):
        race_rows[row.get("raceId")].append((index, row))
    top_pick_wins = 0
    winners_in_top3 = 0
    for entries in race_rows.values():
        ranked = sorted(entries, key=lambda item: (-float(probabilities[item[0]]), item[0]))
        if ranked and _label_value(ranked[0][1].get(target)) == 1:
            top_pick_wins += 1
        top_three = ranked[:3]
        if any(_label_value(row.get(target)) == 1 for _index, row in top_three):
            winners_in_top3 += 1

    log_loss_total = 0.0
    brier_total = 0.0
    for row, probability in zip(rows, probabilities):
        clipped = max(PROBABILITY_EPSILON, min(1.0 - PROBABILITY_EPSILON, float(probability)))
        outcome = float(_label_value(row.get(target)))
        log_loss_total -= outcome * math.log(clipped) + (1.0 - outcome) * math.log(1.0 - clipped)
        brier_total += (clipped - outcome) ** 2
    count = len(rows)
    race_count = len(race_rows)
    return {
        "rows": count,
        "races": race_count,
        "logLoss": _round_or_none(log_loss_total / count if count else None),
        "brierScore": _round_or_none(brier_total / count if count else None),
        "topPickWins": top_pick_wins,
        "topPickWinRate": _round_or_none(top_pick_wins / race_count if race_count else None),
        "winnerInTop3": winners_in_top3,
        "winnerInTop3Rate": _round_or_none(winners_in_top3 / race_count if race_count else None),
    }


def load_matrix_rows(input_path, pandas_module=None):
    """Load flattened training-matrix JSONL or CSV rows."""
    path = Path(input_path)
    if path.suffix.lower() == ".csv":
        with path.open("r", encoding="utf-8", newline="") as handle:
            rows = [
                {key: (value if value != "" else None) for key, value in row.items()}
                for row in csv.DictReader(handle)
            ]
    else:
        rows = []
        with path.open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, start=1):
                if not line.strip():
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError as error:
                    raise ValueError(f"Invalid JSONL at line {line_number}: {error}") from error
                if not isinstance(row, dict):
                    raise ValueError(f"JSONL line {line_number} must be an object")
                rows.append(row)
    if pandas_module is not None:
        # Keep pandas as an explicit runtime dependency for the supported local
        # stack and use it to normalize scalar/NA values before model fitting.
        frame = pandas_module.DataFrame(rows)
        rows = [
            {key: _python_scalar(value) for key, value in row.items()}
            for row in frame.where(pandas_module.notna(frame), None).to_dict("records")
        ]
    return rows


def run_training(
    input_path,
    output_path,
    *,
    target="targetWin",
    mode="no-market",
    fit_splits=("train",),
    parameters=None,
    selection_report_path=None,
    predictions_output_path=None,
):
    """Train LightGBM and write report, model, manifest, and optional predictions."""
    dependencies = _require_training_dependencies()
    pandas_module, numpy_module, _sklearn_module, lightgbm_module = dependencies
    rows = load_matrix_rows(input_path, pandas_module)
    _validate_rows(rows, target)
    fit_splits = _normalize_fit_splits(fit_splits)
    if "validation" in fit_splits and not any(row.get("split") == "validation" for row in rows):
        raise ValueError("validation is included in fit_splits but has no rows")
    all_columns = _ordered_columns(rows)
    feature_names, excluded_features = select_feature_columns(all_columns, mode=mode, target=target)
    if not feature_names:
        raise ValueError("No usable features remain after metadata/identifier/label/no-market exclusion")
    fit_indexes = [index for index, row in enumerate(rows) if row.get("split") in fit_splits]
    if not fit_indexes:
        raise ValueError("No rows found for fit_splits; train/validation rows are required")

    encoder = fit_feature_encoder(rows, feature_names, fit_splits=fit_splits)
    x = _build_feature_frame(rows, encoder, pandas_module, numpy_module)
    y = numpy_module.asarray([_label_value(row.get(target)) for row in rows], dtype=int)
    fit_labels = y[fit_indexes]
    if len(set(fit_labels.tolist())) < 2:
        joined_splits = ", ".join(fit_splits)
        raise ValueError(f"Fit splits ({joined_splits}) target {target} must contain both 0 and 1 labels")

    params = {
        "objective": "binary",
        "boosting_type": "gbdt",
        "n_estimators": 160,
        "learning_rate": 0.05,
        "num_leaves": 31,
        "max_depth": -1,
        "min_child_samples": 20,
        "reg_lambda": 0.1,
        "reg_alpha": 0.0,
        "subsample": 1.0,
        "subsample_freq": 1,
        "colsample_bytree": 1.0,
        "early_stopping_rounds": 0,
        "random_state": 20260718,
        "bagging_seed": 20260718,
        "feature_fraction_seed": 20260718,
        "data_random_seed": 20260718,
        "deterministic": True,
        "force_col_wise": True,
        "n_jobs": 1,
        "verbosity": -1,
    }
    if parameters:
        params.update(parameters)
    selection_report = None
    if selection_report_path is not None:
        if "validation" not in fit_splits:
            raise ValueError("selection_report requires validation in fit_splits")
        selection_report = _load_selection_report(selection_report_path)
        params.update(selection_report["selectedParameters"])
        params["n_estimators"] = selection_report["selectedBestIteration"]
        params["early_stopping_rounds"] = 0
    _validate_model_parameters(params)
    early_stopping_rounds = _validate_early_stopping_rounds(params.get("early_stopping_rounds", 0))
    if early_stopping_rounds > 0 and "validation" in fit_splits:
        raise ValueError(
            "Cannot enable early stopping when validation is included in fit_splits; "
            "final-refit uses fixed iterations. Set --early-stopping-rounds 0."
        )
    validation_indexes = [index for index, row in enumerate(rows) if row.get("split") == "validation"]
    validation_labels = y[validation_indexes]
    if early_stopping_rounds > 0:
        if not validation_indexes:
            raise ValueError(
                "Validation split is required when early stopping is enabled "
                "(--early-stopping-rounds > 0)"
            )
        if len(set(validation_labels.tolist())) < 2:
            raise ValueError(
                f"Validation split target {target} must contain both 0 and 1 labels "
                "when early stopping is enabled"
            )

    model_parameters = dict(params)
    model_parameters.pop("early_stopping_rounds", None)
    model = lightgbm_module.LGBMClassifier(**model_parameters)
    fit_kwargs = {}
    if early_stopping_rounds > 0:
        fit_kwargs = {
            "eval_set": [(x.iloc[validation_indexes], validation_labels)],
            "eval_names": ["validation"],
            "callbacks": [lightgbm_module.early_stopping(early_stopping_rounds, verbose=False)],
        }
    categorical_features = [
        feature_name for feature_name in feature_names
        if encoder["featureTypes"][feature_name] == "categorical"
    ]
    fit_kwargs["categorical_feature"] = categorical_features
    model.fit(x.iloc[fit_indexes], fit_labels, **fit_kwargs)
    best_iteration = (
        _positive_int_or_none(getattr(model, "best_iteration_", None))
        if early_stopping_rounds > 0 else None
    )
    effective_iterations = best_iteration or int(params["n_estimators"])
    raw_probabilities = model.predict_proba(x)[:, 1]
    probabilities = normalize_race_probabilities(rows, raw_probabilities.tolist())

    metrics_by_split = {}
    for split in SPLITS:
        metrics_by_split[split] = compute_split_metrics(
            [row for row in rows if row.get("split") == split],
            [probability for row, probability in zip(rows, probabilities) if row.get("split") == split],
            target=target,
        )
        is_model_selection_sample = split == "validation" and early_stopping_rounds > 0
        metrics_by_split[split]["isOutOfSample"] = (
            split == "holdout"
            or (split not in fit_splits and not is_model_selection_sample)
        )
        metrics_by_split[split]["isModelSelectionSample"] = is_model_selection_sample
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    model_path = output.with_suffix(".model.txt")
    manifest_path = output.with_suffix(".feature-manifest.json")
    prediction_path = Path(predictions_output_path) if predictions_output_path is not None else None
    if prediction_path is not None:
        prediction_path.parent.mkdir(parents=True, exist_ok=True)
        prediction_rows = []
        for row, probability in zip(rows, probabilities):
            prediction_rows.append({
                "version": MODEL_ID,
                "modelId": MODEL_ID,
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
            })
        prediction_path.write_text(
            "\n".join(json.dumps(row, ensure_ascii=False) for row in prediction_rows) + "\n",
            encoding="utf-8",
        )
    model.booster_.save_model(str(model_path))
    manifest = {
        "version": MODEL_ID,
        "modelId": MODEL_ID,
        "mode": mode,
        "target": target,
        "metadataColumns": list(METADATA_COLUMNS),
        "excludedFeatures": excluded_features,
        "features": feature_names,
        "featureTypes": encoder["featureTypes"],
        "categoricalMappings": encoder["categoricalMappings"],
        "fitSplits": list(fit_splits),
        "unknownCategoryValue": encoder["unknownCategoryValue"],
        "numericMissingValue": "NaN passed to LightGBM",
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    report = {
        "version": MODEL_ID,
        "modelId": MODEL_ID,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "input": {
            "name": Path(input_path).name,
            "format": "csv" if Path(input_path).suffix.lower() == ".csv" else "jsonl",
            "rows": len(rows),
            "races": len({row.get("raceId") for row in rows}),
            "rowsBySplit": {split: sum(row.get("split") == split for row in rows) for split in SPLITS},
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
        "lineage": "selection-report" if selection_report is not None else (
            "manual" if "validation" in fit_splits else "selection"
        ),
        "bestIteration": best_iteration if early_stopping_rounds > 0 else None,
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
            "normalization": "race-level positive model probabilities sum to one",
            "clipEpsilon": PROBABILITY_EPSILON,
            "numericMissing": "NaN passed to LightGBM",
            "categoryUnknown": -1,
        },
        "metrics": {
            "overall": compute_split_metrics(rows, probabilities, target=target),
            "bySplit": metrics_by_split,
        },
    }
    if selection_report is not None:
        report["selectionReport"] = {
            "basename": Path(selection_report_path).name,
            "selectedBestIteration": selection_report["selectedBestIteration"],
            "selectedParameters": selection_report["selectedParameters"],
        }
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def _validate_rows(rows, target):
    if not rows:
        raise ValueError("No training rows found")
    missing = [column for column in METADATA_COLUMNS if column not in rows[0]]
    if missing:
        raise ValueError(f"Training matrix is missing required columns: {', '.join(missing)}")
    if target not in LABEL_COLUMNS:
        raise ValueError(f"Unsupported target: {target}")
    invalid_splits = sorted({str(row.get("split")) for row in rows if row.get("split") not in SPLITS})
    if invalid_splits:
        raise ValueError(f"Training matrix contains unsupported split values: {', '.join(invalid_splits)}")
    race_splits = defaultdict(set)
    for row in rows:
        race_splits[row.get("raceId")].add(row.get("split"))
    for race_id, splits in race_splits.items():
        if len(splits) > 1:
            joined_splits = ", ".join(sorted(splits))
            raise ValueError(
                f"raceId {race_id!r} appears in multiple splits: {joined_splits}"
            )
    for index, row in enumerate(rows, start=1):
        try:
            _label_value(row.get(target))
        except ValueError as error:
            raise ValueError(f"Row {index} has invalid {target}: {row.get(target)!r}") from error


def _normalize_fit_splits(fit_splits):
    if isinstance(fit_splits, str):
        fit_splits = (fit_splits,)
    try:
        normalized = tuple(fit_splits)
    except TypeError as error:
        raise ValueError("fit_splits must be a non-empty sequence of train/validation") from error
    if not normalized:
        raise ValueError("fit_splits must be a non-empty sequence of train/validation")
    if len(set(normalized)) != len(normalized):
        raise ValueError("fit_splits must not contain duplicate split names")
    if "holdout" in normalized:
        raise ValueError("holdout must never be included in fit_splits")
    if "train" not in normalized:
        raise ValueError("fit_splits must include train")
    unsupported = sorted(set(normalized) - {"train", "validation"})
    if unsupported:
        names = ", ".join(str(value) for value in unsupported)
        raise ValueError(f"Unsupported fit split(s): {names}; only train and validation are allowed")
    return normalized


def _validate_early_stopping_rounds(value):
    try:
        rounds = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError("early_stopping_rounds must be a non-negative integer") from error
    if rounds < 0:
        raise ValueError("early_stopping_rounds must be a non-negative integer")
    return rounds


def _validate_model_parameters(params):
    _validate_numeric_boundary(params, "n_estimators", lambda value: value > 0, "must be > 0")
    _validate_numeric_boundary(params, "learning_rate", lambda value: value > 0, "must be > 0")
    _validate_numeric_boundary(params, "num_leaves", lambda value: value > 1, "must be > 1")
    _validate_numeric_boundary(params, "min_child_samples", lambda value: value > 0, "must be > 0")
    _validate_numeric_boundary(params, "reg_alpha", lambda value: value >= 0, "must be >= 0")
    _validate_numeric_boundary(params, "reg_lambda", lambda value: value >= 0, "must be >= 0")
    for parameter_name in ("subsample", "colsample_bytree"):
        _validate_numeric_boundary(
            params,
            parameter_name,
            lambda value: value > 0 and value <= 1,
            "must be > 0 and <= 1",
        )


def _validate_numeric_boundary(params, parameter_name, predicate, constraint):
    value = params.get(parameter_name)
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{parameter_name} {constraint}") from error
    if not math.isfinite(number) or not predicate(number):
        raise ValueError(f"{parameter_name} {constraint}")


def _load_selection_report(selection_report_path):
    path = Path(selection_report_path)
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Unable to read selection report: {path}") from error
    if not isinstance(report, dict):
        raise ValueError("selection report must be a JSON object")
    fit_splits = report.get("fitSplits")
    if not isinstance(fit_splits, list) or "holdout" in fit_splits:
        raise ValueError("selection report must not fit holdout")
    holdout_metrics = report.get("metrics", {}).get("bySplit", {}).get("holdout", {})
    if holdout_metrics.get("isOutOfSample") is not True:
        raise ValueError("selection report must not fit holdout")
    best_iteration = _positive_int_or_none(report.get("bestIteration"))
    if best_iteration is None:
        raise ValueError("selection report must contain a positive bestIteration")
    report_parameters = report.get("parameters")
    if not isinstance(report_parameters, dict):
        raise ValueError("selection report must contain parameters")
    missing = [name for name in SELECTION_PARAMETER_NAMES if name not in report_parameters]
    if missing:
        raise ValueError(
            "selection report is missing parameters: " + ", ".join(missing)
        )
    selected_parameters = {
        name: report_parameters[name] for name in SELECTION_PARAMETER_NAMES
    }
    return {
        "selectedBestIteration": best_iteration,
        "selectedParameters": selected_parameters,
    }


def _positive_int_or_none(value):
    try:
        integer = int(value)
    except (TypeError, ValueError):
        return None
    return integer if integer > 0 else None


def _ordered_columns(rows):
    columns = []
    seen = set()
    for row in rows:
        for column in row:
            if column not in seen:
                columns.append(column)
                seen.add(column)
    missing = [column for column in METADATA_COLUMNS if column not in seen]
    if missing:
        raise ValueError(f"Training matrix is missing required columns: {', '.join(missing)}")
    return columns


def _require_training_dependencies():
    missing = []
    modules = {}
    for module_name, package_name in (
        ("pandas", "pandas"),
        ("sklearn", "scikit-learn"),
        ("lightgbm", "lightgbm"),
        ("numpy", "numpy"),
    ):
        try:
            modules[module_name] = __import__(module_name)
        except ImportError:
            missing.append(package_name)
    if missing:
        requirements = Path(__file__).with_name("requirements-tree-model.txt")
        raise MissingDependencyError(
            "Missing required Python dependencies: " + ", ".join(missing)
            + f". Install them with: {sys.executable} -m pip install -r {requirements}"
        )
    return modules["pandas"], modules["numpy"], modules["sklearn"], modules["lightgbm"]


def _dependency_versions():
    versions = {}
    for package_name in ("lightgbm", "scikit-learn", "pandas", "numpy"):
        try:
            versions[package_name] = importlib.metadata.version(package_name)
        except importlib.metadata.PackageNotFoundError:
            versions[package_name] = None
    return versions


def _is_missing(value):
    if value is None:
        return True
    if isinstance(value, str) and not value.strip():
        return True
    try:
        return not math.isfinite(float(value))
    except (TypeError, ValueError):
        return False


def _as_float(value):
    if _is_missing(value):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _category_key(value):
    return str(value)


def _label_value(value):
    number = _as_float(value)
    if number not in (0.0, 1.0):
        raise ValueError(f"expected binary label, got {value!r}")
    return int(number)


def _finite_float(value, fallback):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


def _python_scalar(value):
    if value is None:
        return None
    try:
        if not math.isfinite(float(value)):
            return None
    except (TypeError, ValueError):
        pass
    return value.item() if hasattr(value, "item") else value


def _round_or_none(value):
    return round(float(value), 6) if value is not None else None


def build_parser():
    parser = argparse.ArgumentParser(description="Train the local LightGBM no-market runner model.")
    parser.add_argument("--input", required=True, help="training-matrix .jsonl or .csv")
    parser.add_argument("--output", required=True, help="JSON report path; model and manifest use the same stem")
    parser.add_argument(
        "--predictions-output",
        help="optional versioned per-runner prediction JSONL output path",
    )
    parser.add_argument("--target", choices=sorted(LABEL_COLUMNS), default="targetWin")
    parser.add_argument("--mode", choices=("no-market",), default="no-market")
    parser.add_argument("--n-estimators", type=int, default=160)
    parser.add_argument("--learning-rate", type=float, default=0.05)
    parser.add_argument("--num-leaves", type=int, default=31)
    parser.add_argument("--max-depth", type=int, default=-1)
    parser.add_argument("--min-child-samples", type=int, default=20)
    parser.add_argument("--reg-lambda", type=float, default=0.1)
    parser.add_argument("--reg-alpha", type=float, default=0.0)
    parser.add_argument("--subsample", type=float, default=1.0)
    parser.add_argument("--colsample-bytree", type=float, default=1.0)
    parser.add_argument("--early-stopping-rounds", type=int, default=0)
    parser.add_argument(
        "--include-validation-in-fit",
        action="store_true",
        help="final-refit on train and validation with fixed n_estimators; disables early stopping",
    )
    parser.add_argument(
        "--selection-report",
        help="completed selection report used to choose final-refit iterations and parameters",
    )
    parser.add_argument("--seed", type=int, default=20260718)
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    if args.selection_report and not args.include_validation_in_fit:
        raise SystemExit("--selection-report requires --include-validation-in-fit")
    seed = args.seed
    parameters = {
        "n_estimators": args.n_estimators,
        "learning_rate": args.learning_rate,
        "num_leaves": args.num_leaves,
        "max_depth": args.max_depth,
        "min_child_samples": args.min_child_samples,
        "reg_lambda": args.reg_lambda,
        "reg_alpha": args.reg_alpha,
        "subsample": args.subsample,
        "colsample_bytree": args.colsample_bytree,
        "early_stopping_rounds": args.early_stopping_rounds,
        "random_state": seed,
        "bagging_seed": seed,
        "feature_fraction_seed": seed,
        "data_random_seed": seed,
    }
    try:
        report = run_training(
            args.input,
            args.output,
            target=args.target,
            mode=args.mode,
            fit_splits=("train", "validation") if args.include_validation_in_fit else ("train",),
            parameters=parameters,
            selection_report_path=args.selection_report,
            predictions_output_path=args.predictions_output,
        )
    except (MissingDependencyError, ValueError, OSError) as error:
        raise SystemExit(str(error)) from error
    holdout = report["metrics"]["bySplit"]["holdout"]
    print(
        f"Trained {MODEL_ID}: {report['input']['rows']} rows, "
        f"holdout races {holdout['races']}, holdout logLoss {holdout['logLoss']}"
    )
    print(f"Saved report to {args.output}")
    print(f"Saved model artifact to {report['modelArtifact']}")
    print(f"Saved feature manifest to {report['featureManifest']}")
    if report["predictionArtifact"] is not None:
        print(f"Saved runner predictions to {report['predictionArtifact']}")


if __name__ == "__main__":
    main()
