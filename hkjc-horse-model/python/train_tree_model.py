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


def fit_feature_encoder(rows, feature_names, train_split="train"):
    """Fit numeric/category handling using train rows only.

    Categories are assigned stable integer codes from sorted train-only values;
    values first seen outside train therefore transform to -1.
    """
    train_rows = [row for row in rows if row.get("split") == train_split]
    feature_types = {}
    categorical_mappings = {}
    for feature_name in feature_names:
        values = [row.get(feature_name) for row in train_rows if not _is_missing(row.get(feature_name))]
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


def run_training(input_path, output_path, *, target="targetWin", mode="no-market", parameters=None):
    """Train LightGBM and write report, model text, and feature manifest."""
    dependencies = _require_training_dependencies()
    pandas_module, numpy_module, _sklearn_module, lightgbm_module = dependencies
    rows = load_matrix_rows(input_path, pandas_module)
    _validate_rows(rows, target)
    all_columns = _ordered_columns(rows)
    feature_names, excluded_features = select_feature_columns(all_columns, mode=mode, target=target)
    if not feature_names:
        raise ValueError("No usable features remain after metadata/identifier/label/no-market exclusion")
    train_rows = [row for row in rows if row.get("split") == "train"]
    if not train_rows:
        raise ValueError("No train split rows found; existing chronological split labels are required")

    encoder = fit_feature_encoder(rows, feature_names)
    x = pandas_module.DataFrame(transform_feature_rows(rows, encoder), columns=feature_names, dtype=float)
    y = numpy_module.asarray([_label_value(row.get(target)) for row in rows], dtype=int)
    train_indexes = [index for index, row in enumerate(rows) if row.get("split") == "train"]
    train_labels = y[train_indexes]
    if len(set(train_labels.tolist())) < 2:
        raise ValueError(f"Train split target {target} must contain both 0 and 1 labels")

    params = {
        "objective": "binary",
        "boosting_type": "gbdt",
        "n_estimators": 160,
        "learning_rate": 0.05,
        "num_leaves": 31,
        "max_depth": -1,
        "min_child_samples": 20,
        "reg_lambda": 0.1,
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
    model = lightgbm_module.LGBMClassifier(**params)
    model.fit(x.iloc[train_indexes], train_labels)
    raw_probabilities = model.predict_proba(x)[:, 1]
    probabilities = normalize_race_probabilities(rows, raw_probabilities.tolist())

    metrics_by_split = {
        split: compute_split_metrics(
            [row for row in rows if row.get("split") == split],
            [probability for row, probability in zip(rows, probabilities) if row.get("split") == split],
            target=target,
        )
        for split in SPLITS
    }
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    model_path = output.with_suffix(".model.txt")
    manifest_path = output.with_suffix(".feature-manifest.json")
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
        "chronologicalSplits": list(SPLITS),
        "metadataColumnsExcluded": list(METADATA_COLUMNS),
        "labelColumnsExcluded": sorted(LABEL_COLUMNS),
        "excludedFeatures": excluded_features,
        "features": feature_names,
        "featureManifest": str(manifest_path),
        "modelArtifact": str(model_path),
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
    for index, row in enumerate(rows, start=1):
        try:
            _label_value(row.get(target))
        except ValueError as error:
            raise ValueError(f"Row {index} has invalid {target}: {row.get(target)!r}") from error


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
    parser.add_argument("--target", choices=sorted(LABEL_COLUMNS), default="targetWin")
    parser.add_argument("--mode", choices=("no-market",), default="no-market")
    parser.add_argument("--n-estimators", type=int, default=160)
    parser.add_argument("--learning-rate", type=float, default=0.05)
    parser.add_argument("--num-leaves", type=int, default=31)
    parser.add_argument("--max-depth", type=int, default=-1)
    parser.add_argument("--min-child-samples", type=int, default=20)
    parser.add_argument("--reg-lambda", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=20260718)
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    seed = args.seed
    parameters = {
        "n_estimators": args.n_estimators,
        "learning_rate": args.learning_rate,
        "num_leaves": args.num_leaves,
        "max_depth": args.max_depth,
        "min_child_samples": args.min_child_samples,
        "reg_lambda": args.reg_lambda,
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
            parameters=parameters,
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


if __name__ == "__main__":
    main()
