#!/usr/bin/env python3
"""Score upcoming runners from a frozen market-aware CatBoost bundle."""

import argparse
import hashlib
import importlib
import json
from datetime import datetime, timezone
from pathlib import Path


CAT_MISSING = "__MISSING__"


class MissingDependencyError(RuntimeError):
    """Raised when the optional scoring stack is unavailable."""


def _require_scoring_dependencies():
    try:
        pandas_module = importlib.import_module("pandas")
        numpy_module = importlib.import_module("numpy")
        catboost_module = importlib.import_module("catboost")
    except ImportError as error:
        raise MissingDependencyError(
            "Shadow scoring requires catboost, pandas, and numpy. "
            "Install hkjc-horse-model/python/requirements-tree-model.txt in the local scoring environment."
        ) from error
    return pandas_module, numpy_module, catboost_module


def load_frozen_bundle(*, model_path, report_path, feature_manifest_path):
    """Load a frozen CatBoost artifact and verify its lineage contract."""
    model_path = Path(model_path)
    report_path = Path(report_path)
    feature_manifest_path = Path(feature_manifest_path)

    report = _load_json_object(report_path, "report")
    manifest = _load_json_object(feature_manifest_path, "feature manifest")
    _validate_bundle_contract(
        report=report,
        manifest=manifest,
        model_path=model_path,
        feature_manifest_path=feature_manifest_path,
    )

    artifact_bytes = model_path.read_bytes()
    artifact_id = f"sha256:{hashlib.sha256(artifact_bytes).hexdigest()}"
    pandas_module, numpy_module, catboost_module = _require_scoring_dependencies()
    model = catboost_module.CatBoostClassifier()
    model.load_model(str(model_path))

    return {
        "model": model,
        "pandas": pandas_module,
        "numpy": numpy_module,
        "report": report,
        "manifest": manifest,
        "modelPath": str(model_path),
        "reportPath": str(report_path),
        "featureManifestPath": str(feature_manifest_path),
        "artifactId": artifact_id,
        "modelId": _required_text(report.get("modelId"), "report modelId"),
        "featurePolicyId": _resolve_feature_policy_id(report, manifest),
        "calibrationMethod": _resolve_calibration_method(report),
        "trainingCutoff": _required_text(report.get("trainingCutoff"), "report trainingCutoff"),
    }


def score_rows(*, bundle, rows):
    """Score one or more runner rows from a validated frozen bundle."""
    normalized_rows = _normalize_rows(rows)
    frame = _build_feature_frame(
        rows=normalized_rows,
        feature_names=bundle["manifest"]["features"],
        feature_types=bundle["manifest"].get("featureTypes") or {},
        pandas_module=bundle["pandas"],
    )
    probabilities = bundle["model"].predict_proba(frame)
    output = []
    for row, raw_probability in zip(normalized_rows, probabilities):
        probability = _positive_probability(raw_probability)
        output.append({
            "raceId": row["raceId"],
            "runnerId": row["runnerId"],
            "probability": probability,
            "modelId": bundle["modelId"],
            "artifactId": bundle["artifactId"],
            "featurePolicyId": bundle["featurePolicyId"],
            "calibrationMethod": bundle["calibrationMethod"],
            "trainingCutoff": bundle["trainingCutoff"],
        })
    return output


def build_score_bundle(*, bundle, rows, generated_at):
    """Build a zero-stake shadow probability bundle for one race."""
    normalized_rows = _normalize_rows(rows)
    generated_at_text = _normalize_timestamp(generated_at, "generatedAt")
    generated_at_dt = _parse_timestamp(generated_at_text, "generatedAt")
    for row in normalized_rows:
        if generated_at_dt >= row["postAtDt"]:
            raise ValueError("generatedAt must be before postAt")

    predictions = score_rows(bundle=bundle, rows=normalized_rows)
    return {
        "generatedAt": generated_at_text,
        "modelId": bundle["modelId"],
        "artifactId": bundle["artifactId"],
        "featurePolicyId": bundle["featurePolicyId"],
        "calibrationMethod": bundle["calibrationMethod"],
        "trainingCutoff": bundle["trainingCutoff"],
        "lineage": {
            "reportLineage": _required_text(bundle["report"].get("lineage"), "report lineage"),
            "modelPath": Path(bundle["modelPath"]).name,
            "reportPath": Path(bundle["reportPath"]).name,
            "featureManifestPath": Path(bundle["featureManifestPath"]).name,
        },
        "predictions": predictions,
    }


def _load_json_object(path, label):
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ValueError(f"{label} not found: {path}") from error
    except json.JSONDecodeError as error:
        raise ValueError(f"{label} is not valid JSON: {path}") from error
    if not isinstance(payload, dict):
        raise ValueError(f"{label} must be a JSON object")
    return payload


def _validate_bundle_contract(*, report, manifest, model_path, feature_manifest_path):
    if _required_text(report.get("modelId"), "report modelId") != _required_text(
        manifest.get("modelId"), "feature manifest modelId"
    ):
        raise ValueError("feature manifest modelId does not match report modelId")
    if _required_text(report.get("mode"), "report mode") != _required_text(
        manifest.get("mode"), "feature manifest mode"
    ):
        raise ValueError("feature manifest mode does not match report mode")
    if _required_text(report.get("target"), "report target") != _required_text(
        manifest.get("target"), "feature manifest target"
    ):
        raise ValueError("feature manifest target does not match report target")

    report_features = _required_text_list(report.get("features"), "report features")
    manifest_features = _required_text_list(manifest.get("features"), "feature manifest features")
    if report_features != manifest_features:
        raise ValueError("feature manifest does not match report features")

    report_manifest_name = Path(_required_text(report.get("featureManifest"), "report featureManifest")).name
    if report_manifest_name != feature_manifest_path.name:
        raise ValueError("report featureManifest does not match supplied manifest path")
    report_model_name = Path(_required_text(report.get("modelArtifact"), "report modelArtifact")).name
    if report_model_name != model_path.name:
        raise ValueError("report modelArtifact does not match supplied model path")

    _required_text(report.get("lineage"), "report lineage")
    _required_text(report.get("trainingCutoff"), "report trainingCutoff")


def _normalize_rows(rows):
    normalized = []
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("score rows must be JSON objects")
        race_id = _required_text(row.get("raceId"), "row raceId")
        runner_id = _required_text(row.get("runnerId") or row.get("horseId"), "row runnerId")
        observed_at = _normalize_timestamp(row.get("observedAt"), "observedAt")
        post_at = _normalize_timestamp(row.get("postAt"), "postAt")
        observed_at_dt = _parse_timestamp(observed_at, "observedAt")
        post_at_dt = _parse_timestamp(post_at, "postAt")
        if observed_at_dt >= post_at_dt:
            raise ValueError("observedAt must be before postAt")
        normalized.append({
            **row,
            "raceId": race_id,
            "runnerId": runner_id,
            "observedAt": observed_at,
            "postAt": post_at,
            "observedAtDt": observed_at_dt,
            "postAtDt": post_at_dt,
        })
    if not normalized:
        raise ValueError("score rows must not be empty")
    return normalized


def _build_feature_frame(*, rows, feature_names, feature_types, pandas_module):
    columns = {}
    for feature_name in feature_names:
        feature_type = feature_types.get(feature_name, "numeric")
        if feature_type == "categorical":
            columns[feature_name] = [
                CAT_MISSING if _is_missing(row.get(feature_name)) else str(row.get(feature_name))
                for row in rows
            ]
            continue
        columns[feature_name] = [
            float("nan") if _as_float(row.get(feature_name)) is None else _as_float(row.get(feature_name))
            for row in rows
        ]
    return pandas_module.DataFrame(columns)


def _resolve_feature_policy_id(report, manifest):
    for value in (
        manifest.get("featurePolicyId"),
        report.get("featurePolicyId"),
    ):
        if isinstance(value, str) and value.strip():
            return value.strip()
    mode = _required_text(report.get("mode"), "report mode")
    return f"{mode}-v1"


def _resolve_calibration_method(report):
    policy = report.get("probabilityPolicy")
    if isinstance(policy, dict):
        value = policy.get("calibrationMethod")
        if isinstance(value, str) and value.strip():
            return value.strip()
    return "none"


def _positive_probability(value):
    if isinstance(value, (list, tuple)) and len(value) >= 2:
        value = value[1]
    value = _as_float(value)
    if value is None:
        raise ValueError("model returned a non-numeric probability")
    return round(float(value), 12)


def _required_text(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a non-empty string")
    return value.strip()


def _required_text_list(value, label):
    if not isinstance(value, list) or not value:
        raise ValueError(f"{label} must be a non-empty list")
    result = []
    for index, item in enumerate(value, start=1):
        result.append(_required_text(item, f"{label}[{index}]"))
    return result


def _normalize_timestamp(value, label):
    return _required_text(value, label)


def _parse_timestamp(value, label):
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as error:
        raise ValueError(f"{label} must be an ISO-8601 timestamp") from error
    if parsed.tzinfo is None:
        raise ValueError(f"{label} must include a timezone")
    return parsed.astimezone(timezone.utc)


def _is_missing(value):
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() == ""
    return False


def _as_float(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number


def build_parser():
    parser = argparse.ArgumentParser(description="Score upcoming runners from a frozen market-aware CatBoost bundle.")
    parser.add_argument("--input", required=True, help="JSONL row input path")
    parser.add_argument("--model", required=True, help="CatBoost model artifact path")
    parser.add_argument("--report", required=True, help="Training report JSON path")
    parser.add_argument("--feature-manifest", required=True, help="Feature manifest JSON path")
    parser.add_argument("--generated-at", required=True, help="Score bundle generation timestamp")
    parser.add_argument("--output", required=True, help="JSON output path")
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        rows = _load_jsonl_rows(Path(args.input))
        bundle = load_frozen_bundle(
            model_path=Path(args.model),
            report_path=Path(args.report),
            feature_manifest_path=Path(args.feature_manifest),
        )
        score_bundle = build_score_bundle(
            bundle=bundle,
            rows=rows,
            generated_at=args.generated_at,
        )
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps(score_bundle, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except (MissingDependencyError, OSError, ValueError) as error:
        raise SystemExit(str(error)) from error
    print(f"Scored {len(score_bundle['predictions'])} runners into SHADOW bundle")
    print(f"Saved score bundle to {args.output}")


def _load_jsonl_rows(path):
    rows = []
    try:
        content = path.read_text(encoding="utf-8")
    except OSError as error:
        raise ValueError(f"unable to read input rows: {path}") from error
    for line_number, line in enumerate(content.splitlines(), start=1):
        text = line.strip()
        if not text:
            continue
        try:
            row = json.loads(text)
        except json.JSONDecodeError as error:
            raise ValueError(f"input row {line_number} is not valid JSON") from error
        if not isinstance(row, dict):
            raise ValueError(f"input row {line_number} must be a JSON object")
        rows.append(row)
    if not rows:
        raise ValueError("input rows must not be empty")
    return rows


if __name__ == "__main__":
    main()
