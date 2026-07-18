#!/usr/bin/env python3
"""Select validation-only calibration and LightGBM/CatBoost runner blends."""

import argparse
import json
import math
from pathlib import Path

from train_tree_model import (
    PROBABILITY_EPSILON,
    apply_target_probability_policy,
    compute_split_metrics,
)


STACK_VERSION = "runner-probability-stack-v1"
CALIBRATION_METHODS = ("raw", "sigmoid", "isotonic")
BLEND_WEIGHTS = (0.0, 0.25, 0.5, 0.75, 1.0)


def build_probability_stack(
    lightgbm_win,
    catboost_win,
    lightgbm_place,
    catboost_place,
    *,
    calibration_fitter=None,
):
    """Build independent WIN and PLACE stacks without selecting on holdout."""
    fitter = calibration_fitter or fit_calibrator
    win = _build_pool_stack(
        lightgbm_win,
        catboost_win,
        target="targetWin",
        pool="WIN",
        calibration_fitter=fitter,
    )
    place = _build_pool_stack(
        lightgbm_place,
        catboost_place,
        target="targetPlace",
        pool="PLACE",
        calibration_fitter=fitter,
    )
    output_rows = _combine_pool_rows(win, place)
    report = {
        "version": STACK_VERSION,
        "selectionSplit": "validation",
        "holdoutUsedForSelection": False,
        "pools": {
            "WIN": win["report"],
            "PLACE": place["report"],
        },
        "metrics": {
            "validation": {
                "WIN": win["report"]["metrics"]["validation"],
                "PLACE": place["report"]["metrics"]["validation"],
            },
            "holdout": {
                "WIN": win["report"]["metrics"]["holdout"],
                "PLACE": place["report"]["metrics"]["holdout"],
            },
        },
        "promotion": {
            "automatic": False,
            "status": "RESEARCH_CANDIDATE",
            "reason": (
                "Validation selected calibration and weights; separate P0 promotion gates "
                "must review untouched holdout and prospective market evidence."
            ),
        },
        "predictionArtifact": None,
    }
    return report, output_rows


def _build_pool_stack(lightgbm_rows, catboost_rows, *, target, pool, calibration_fitter):
    reference_rows = _validate_component_rows(lightgbm_rows, target, "LightGBM")
    catboost_rows = _validate_component_rows(catboost_rows, target, "CatBoost")
    component_models = {
        "lightgbmModelId": _component_model_id(reference_rows, "LightGBM"),
        "catboostModelId": _component_model_id(catboost_rows, "CatBoost"),
    }
    catboost_probabilities = _align_component_probabilities(
        reference_rows,
        catboost_rows,
        "CatBoost",
    )
    lightgbm_probabilities = [_probability(row.get("probability")) for row in reference_rows]
    validation_indexes = [
        index for index, row in enumerate(reference_rows) if row.get("split") == "validation"
    ]
    holdout_indexes = [
        index for index, row in enumerate(reference_rows) if row.get("split") == "holdout"
    ]
    if not validation_indexes:
        raise ValueError(f"{pool} predictions require a validation split")
    if not holdout_indexes:
        raise ValueError(f"{pool} predictions require a holdout split")
    validation_labels = [int(reference_rows[index][target]) for index in validation_indexes]

    lightgbm = _select_component_calibration(
        reference_rows,
        lightgbm_probabilities,
        validation_indexes,
        validation_labels,
        target=target,
        component="LightGBM",
        calibration_fitter=calibration_fitter,
    )
    catboost = _select_component_calibration(
        reference_rows,
        catboost_probabilities,
        validation_indexes,
        validation_labels,
        target=target,
        component="CatBoost",
        calibration_fitter=calibration_fitter,
    )

    blend_candidates = []
    selected_blend = None
    for weight in BLEND_WEIGHTS:
        blended = [
            weight * lightgbm["probabilities"][index]
            + (1.0 - weight) * catboost["probabilities"][index]
            for index in range(len(reference_rows))
        ]
        blended = apply_target_probability_policy(reference_rows, blended, target)
        blended_ranking = [
            weight * lightgbm["rankingProbabilities"][index]
            + (1.0 - weight) * catboost["rankingProbabilities"][index]
            for index in range(len(reference_rows))
        ]
        blended_ranking = apply_target_probability_policy(reference_rows, blended_ranking, target)
        validation_metrics = _metrics_for_indexes(
            reference_rows,
            blended,
            validation_indexes,
            target,
            ranking_probabilities=blended_ranking,
        )
        candidate = {
            "blendWeightLightgbm": weight,
            "blendWeightCatboost": 1.0 - weight,
            "validationMetrics": validation_metrics,
            "probabilities": blended,
            "rankingProbabilities": blended_ranking,
        }
        blend_candidates.append({
            key: value
            for key, value in candidate.items()
            if key not in {"probabilities", "rankingProbabilities"}
        })
        if selected_blend is None or _metric_score(validation_metrics, weight) < _metric_score(
            selected_blend["validationMetrics"], selected_blend["blendWeightLightgbm"]
        ):
            selected_blend = candidate

    selected_probabilities = selected_blend["probabilities"]
    selected_ranking_probabilities = selected_blend["rankingProbabilities"]
    validation_metrics = _metrics_for_indexes(
        reference_rows,
        selected_probabilities,
        validation_indexes,
        target,
        ranking_probabilities=selected_ranking_probabilities,
    )
    holdout_metrics = _metrics_for_indexes(
        reference_rows,
        selected_probabilities,
        holdout_indexes,
        target,
        ranking_probabilities=selected_ranking_probabilities,
    )
    report = {
        "target": target,
        "components": component_models,
        "selection": {
            "selectedOn": "validation",
            "holdoutUsedForSelection": False,
            "lightgbmCalibration": lightgbm["method"],
            "catboostCalibration": catboost["method"],
            "blendWeightLightgbm": selected_blend["blendWeightLightgbm"],
            "blendWeightCatboost": selected_blend["blendWeightCatboost"],
        },
        "calibrationCandidates": {
            "LightGBM": lightgbm["candidates"],
            "CatBoost": catboost["candidates"],
        },
        "blendCandidates": blend_candidates,
        "metrics": {
            "validation": validation_metrics,
            "holdout": {**holdout_metrics, "isOutOfSample": True},
        },
    }
    return {
        "pool": pool,
        "target": target,
        "rows": reference_rows,
        "lightgbmProbabilities": lightgbm["probabilities"],
        "catboostProbabilities": catboost["probabilities"],
        "probabilities": selected_probabilities,
        "rankingProbabilities": selected_ranking_probabilities,
        "report": report,
    }


def _select_component_calibration(
    rows,
    raw_probabilities,
    validation_indexes,
    validation_labels,
    *,
    target,
    component,
    calibration_fitter,
):
    validation_raw = [raw_probabilities[index] for index in validation_indexes]
    ranking_probabilities = apply_target_probability_policy(rows, raw_probabilities, target)
    selected = None
    candidates = []
    for method_index, method in enumerate(CALIBRATION_METHODS):
        try:
            if method == "raw":
                transformed = list(raw_probabilities)
            else:
                transform = calibration_fitter(method, validation_raw, validation_labels)
                transformed = list(transform(raw_probabilities))
            probabilities = apply_target_probability_policy(rows, transformed, target)
            metrics = _metrics_for_indexes(
                rows,
                probabilities,
                validation_indexes,
                target,
                ranking_probabilities=ranking_probabilities,
            )
            candidate = {
                "method": method,
                "available": True,
                "validationMetrics": metrics,
            }
            if selected is None or _metric_score(metrics, method_index) < _metric_score(
                selected["metrics"], selected["methodIndex"]
            ):
                selected = {
                    "method": method,
                    "methodIndex": method_index,
                    "metrics": metrics,
                    "probabilities": probabilities,
                }
        except ValueError as error:
            candidate = {
                "method": method,
                "available": False,
                "error": str(error),
            }
        candidates.append(candidate)
    if selected is None:
        raise ValueError(f"no usable {component} calibration candidate")
    return {
        "method": selected["method"],
        "probabilities": selected["probabilities"],
        "rankingProbabilities": ranking_probabilities,
        "candidates": candidates,
    }


def fit_calibrator(method, probabilities, labels):
    """Fit one calibration mapping using validation rows only."""
    import numpy
    from sklearn.isotonic import IsotonicRegression
    from sklearn.linear_model import LogisticRegression

    values = numpy.asarray([_probability(value) for value in probabilities], dtype=float)
    outcomes = numpy.asarray([int(value) for value in labels], dtype=int)
    if len(set(outcomes.tolist())) < 2:
        raise ValueError(f"{method} calibration requires both target classes")
    if method == "sigmoid":
        logits = numpy.log(
            numpy.clip(values, PROBABILITY_EPSILON, 1.0 - PROBABILITY_EPSILON)
            / (1.0 - numpy.clip(values, PROBABILITY_EPSILON, 1.0 - PROBABILITY_EPSILON))
        ).reshape(-1, 1)
        model = LogisticRegression(random_state=20260718, solver="lbfgs")
        model.fit(logits, outcomes)

        def transform(new_values):
            clipped = numpy.clip(
                numpy.asarray(new_values, dtype=float),
                PROBABILITY_EPSILON,
                1.0 - PROBABILITY_EPSILON,
            )
            new_logits = numpy.log(clipped / (1.0 - clipped)).reshape(-1, 1)
            return model.predict_proba(new_logits)[:, 1].tolist()

        return transform
    if method == "isotonic":
        if len(set(values.tolist())) < 2:
            raise ValueError("isotonic calibration requires at least two distinct probabilities")
        model = IsotonicRegression(out_of_bounds="clip", y_min=PROBABILITY_EPSILON, y_max=1.0 - PROBABILITY_EPSILON)
        model.fit(values, outcomes)
        return lambda new_values: model.predict(new_values).tolist()
    raise ValueError(f"unsupported calibration method: {method}")


def _combine_pool_rows(win, place):
    place_index = {
        _row_key(row): index
        for index, row in enumerate(place["rows"])
    }
    if len(place_index) != len(place["rows"]):
        raise ValueError("PLACE predictions contain duplicate runner keys")
    win_selection = win["report"]["selection"]
    place_selection = place["report"]["selection"]
    output = []
    for index, row in enumerate(win["rows"]):
        key = _row_key(row)
        if key not in place_index:
            raise ValueError(f"PLACE predictions are missing runner {key}")
        place_index_value = place_index[key]
        place_row = place["rows"][place_index_value]
        _validate_matching_metadata(row, place_row, "PLACE")
        output.append({
            "version": STACK_VERSION,
            "raceId": row.get("raceId"),
            "date": row.get("date"),
            "split": row.get("split"),
            "horseId": row.get("horseId"),
            "horseNo": row.get("horseNo"),
            "fieldSize": row.get("fieldSize"),
            "targetWin": int(row.get("targetWin")),
            "targetPlace": int(row.get("targetPlace")),
            "winProbability": _round(win["probabilities"][index]),
            "placeProbability": _round(place["probabilities"][place_index_value]),
            "winRankingScore": _round(win["rankingProbabilities"][index]),
            "placeRankingScore": _round(place["rankingProbabilities"][place_index_value]),
            "winLightgbmProbability": _round(win["lightgbmProbabilities"][index]),
            "winCatboostProbability": _round(win["catboostProbabilities"][index]),
            "placeLightgbmProbability": _round(place["lightgbmProbabilities"][place_index_value]),
            "placeCatboostProbability": _round(place["catboostProbabilities"][place_index_value]),
            "winLightgbmCalibration": win_selection["lightgbmCalibration"],
            "winCatboostCalibration": win_selection["catboostCalibration"],
            "winBlendWeightLightgbm": win_selection["blendWeightLightgbm"],
            "placeLightgbmCalibration": place_selection["lightgbmCalibration"],
            "placeCatboostCalibration": place_selection["catboostCalibration"],
            "placeBlendWeightLightgbm": place_selection["blendWeightLightgbm"],
        })
    if len(output) != len(place["rows"]):
        raise ValueError("WIN and PLACE prediction runner sets differ")
    return output


def _validate_component_rows(rows, target, component):
    if not isinstance(rows, list) or not rows:
        raise ValueError(f"{component} {target} predictions must be a non-empty list")
    seen = set()
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError(f"{component} predictions must contain objects")
        if row.get("target") != target:
            raise ValueError(f"{component} prediction target must be {target}")
        key = _row_key(row)
        if key in seen:
            raise ValueError(f"{component} predictions contain duplicate runner {key}")
        seen.add(key)
        _probability(row.get("probability"))
        for label in ("targetWin", "targetPlace"):
            if int(row.get(label, -1)) not in (0, 1):
                raise ValueError(f"{component} prediction has invalid {label}")
    return rows


def _component_model_id(rows, component):
    model_ids = {
        str(row.get("modelId") or "").strip()
        for row in rows
    }
    if "" in model_ids or len(model_ids) != 1:
        raise ValueError(f"{component} predictions require one non-empty modelId")
    return next(iter(model_ids))


def _align_component_probabilities(reference_rows, candidate_rows, component):
    index = {_row_key(row): row for row in candidate_rows}
    if len(index) != len(reference_rows):
        raise ValueError(f"{component} prediction runner set differs from LightGBM")
    aligned = []
    for reference in reference_rows:
        key = _row_key(reference)
        if key not in index:
            raise ValueError(f"{component} predictions are missing runner {key}")
        candidate = index[key]
        _validate_matching_metadata(reference, candidate, component)
        aligned.append(_probability(candidate.get("probability")))
    return aligned


def _validate_matching_metadata(reference, candidate, component):
    for field in ("date", "split", "horseId", "fieldSize", "targetWin", "targetPlace"):
        if reference.get(field) != candidate.get(field):
            raise ValueError(f"{component} prediction metadata mismatch for {_row_key(reference)}: {field}")


def _metrics_for_indexes(
    rows,
    probabilities,
    indexes,
    target,
    *,
    ranking_probabilities=None,
):
    metrics = compute_split_metrics(
        [rows[index] for index in indexes],
        [probabilities[index] for index in indexes],
        target=target,
    )
    if ranking_probabilities is None:
        return metrics
    ranking_metrics = compute_split_metrics(
        [rows[index] for index in indexes],
        [ranking_probabilities[index] for index in indexes],
        target=target,
    )
    for key in ("topPickHits", "topPickHitRate", "positiveInTop3", "positiveInTop3Rate"):
        metrics[key] = ranking_metrics[key]
    if target == "targetWin":
        for key in ("topPickWins", "topPickWinRate", "winnerInTop3", "winnerInTop3Rate"):
            metrics[key] = ranking_metrics[key]
    metrics["rankingPolicy"] = "uncalibrated selected blend breaks calibration ties"
    return metrics


def _metric_score(metrics, tie_breaker):
    return (
        float(metrics.get("logLoss")) if metrics.get("logLoss") is not None else math.inf,
        float(metrics.get("brierScore")) if metrics.get("brierScore") is not None else math.inf,
        tie_breaker,
    )


def _row_key(row):
    return str(row.get("raceId")), str(row.get("horseNo"))


def _probability(value):
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"invalid probability: {value!r}") from error
    if not math.isfinite(number) or number < 0.0 or number > 1.0:
        raise ValueError(f"invalid probability: {value!r}")
    return number


def _round(value):
    return round(float(value), 6)


def load_prediction_jsonl(path):
    rows = []
    with Path(path).open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError as error:
                raise ValueError(f"invalid prediction JSONL line {line_number}: {error}") from error
    return rows


def build_parser():
    parser = argparse.ArgumentParser(description="Calibrate and blend runner-model predictions.")
    parser.add_argument("--lightgbm-win", required=True)
    parser.add_argument("--catboost-win", required=True)
    parser.add_argument("--lightgbm-place", required=True)
    parser.add_argument("--catboost-place", required=True)
    parser.add_argument("--output", required=True, help="probability-stack report JSON")
    parser.add_argument("--predictions-output", required=True, help="stack runner JSONL")
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        report, rows = build_probability_stack(
            load_prediction_jsonl(args.lightgbm_win),
            load_prediction_jsonl(args.catboost_win),
            load_prediction_jsonl(args.lightgbm_place),
            load_prediction_jsonl(args.catboost_place),
        )
    except (OSError, ValueError) as error:
        raise SystemExit(str(error)) from error
    prediction_path = Path(args.predictions_output)
    prediction_path.parent.mkdir(parents=True, exist_ok=True)
    prediction_path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n",
        encoding="utf-8",
    )
    report["predictionArtifact"] = str(prediction_path)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Built {STACK_VERSION}: {len(rows)} runner rows")
    for pool in ("WIN", "PLACE"):
        selection = report["pools"][pool]["selection"]
        holdout = report["pools"][pool]["metrics"]["holdout"]
        print(
            f"{pool}: LGB calibration={selection['lightgbmCalibration']} "
            f"CatBoost calibration={selection['catboostCalibration']} "
            f"LGB weight={selection['blendWeightLightgbm']} "
            f"holdout logLoss={holdout['logLoss']} Brier={holdout['brierScore']}"
        )
    print(f"Saved report to {output}")
    print(f"Saved stack predictions to {prediction_path}")


if __name__ == "__main__":
    main()
