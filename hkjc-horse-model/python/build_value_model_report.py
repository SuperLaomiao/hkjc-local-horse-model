#!/usr/bin/env python3
"""Build separate, fail-closed WIN and PLACE P0 promotion reports."""

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


REPORT_VERSION = "value-model-promotion-v1"
POOLS = ("WIN", "PLACE")
TARGETS = {"WIN": "targetWin", "PLACE": "targetPlace"}


def build_value_model_report(
    *,
    lightgbm_reports,
    catboost_reports,
    stack_report,
    place_benchmarks,
    market_coverage,
):
    """Compare P0 probability candidates while keeping cash execution fail closed."""
    _required_mapping(market_coverage, "market coverage")
    stack_version = _required_text(stack_report.get("version"), "stack lineage version")
    if stack_report.get("selectionSplit") != "validation":
        raise ValueError("stack calibration must be selected on validation")
    if stack_report.get("holdoutUsedForSelection") is not False:
        raise ValueError("stack holdout must remain untouched during selection")

    promotion = {}
    comparisons = {}
    for pool in POOLS:
        target = TARGETS[pool]
        lightgbm = _validated_model_report(lightgbm_reports, pool, target, "LightGBM")
        catboost = _validated_model_report(catboost_reports, pool, target, "CatBoost")
        stack = _validated_stack_pool(stack_report, pool, target)
        benchmark = _validated_benchmark(place_benchmarks, pool)

        candidates = [
            _candidate("LightGBM", lightgbm["modelId"], lightgbm["holdout"], {
                "method": "raw",
                "lineage": lightgbm["lineage"],
                "predictionArtifact": lightgbm["predictionArtifact"],
            }),
            _candidate("CatBoost", catboost["modelId"], catboost["holdout"], {
                "method": "raw",
                "lineage": catboost["lineage"],
                "predictionArtifact": catboost["predictionArtifact"],
            }),
            _candidate("STACK", stack_version, stack["holdout"], {
                "method": "blend",
                "lineage": {
                    "version": stack_version,
                    "selectedOn": stack["selection"]["selectedOn"],
                    "holdoutUsedForSelection": stack["selection"]["holdoutUsedForSelection"],
                },
                "calibration": {
                    "lightgbm": stack["selection"]["lightgbmCalibration"],
                    "catboost": stack["selection"]["catboostCalibration"],
                },
                "blendWeights": {
                    "lightgbm": stack["selection"].get("blendWeightLightgbm"),
                    "catboost": stack["selection"].get("blendWeightCatboost"),
                },
            }),
        ]
        candidates.sort(key=lambda item: (
            item["holdout"]["logLoss"],
            item["holdout"]["brierScore"],
            item["source"],
        ))
        champion = candidates[0]
        prospective = _prospective_market_evidence(market_coverage, pool)
        reasons = _promotion_reasons(pool, champion, benchmark, prospective)
        comparisons[pool] = candidates
        promotion[pool] = {
            "status": "NO_BET",
            "predictionStatus": "RESEARCH_CHAMPION",
            "researchChampion": champion,
            "strategyBaseline": _strategy_summary(benchmark, pool),
            "gates": {
                "holdout": {
                    "passed": True,
                    "rows": champion["holdout"]["rows"],
                    "races": champion["holdout"]["races"],
                    "isOutOfSample": champion["holdout"]["isOutOfSample"],
                },
                "calibration": {
                    "passed": champion["source"] == "STACK",
                    "method": champion["calibration"]["method"],
                },
                "lineage": {"passed": True},
                "strategyAudit": {
                    "passed": pool == "PLACE" and benchmark["roi"] > 0,
                    "evaluatedPool": "PLACE",
                    "bets": benchmark["bets"],
                    "roi": benchmark["roi"],
                    "maxDrawdown": benchmark["maxDrawdown"],
                },
                "prospectiveMarket": prospective,
                "cashAuthorization": {
                    "passed": False,
                    "reason": "P0 promotion reports never authorize cash execution",
                },
            },
            "reasons": reasons,
        }

    return {
        "version": REPORT_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "selectionPolicy": {
            "researchChampion": "lowest untouched-holdout log loss, then Brier score",
            "cashMode": "disabled until pool-specific prospective market and ROI gates pass",
            "holdoutUsedForSelection": False,
        },
        "promotion": promotion,
        "comparisons": comparisons,
        "marketEvidence": _market_summary(market_coverage),
    }


def _validated_model_report(reports, pool, target, source):
    report = _required_mapping(reports, f"{source} reports").get(pool)
    report = _required_mapping(report, f"{source} {pool} report")
    if report.get("target") != target:
        raise ValueError(f"{source} {pool} target must be {target}")
    model_id = _required_text(report.get("modelId"), f"{source} {pool} modelId")
    lineage = report.get("lineage")
    if not isinstance(lineage, (str, dict)) or not lineage:
        raise ValueError(f"{source} {pool} lineage is required")
    prediction_artifact = _required_text(
        report.get("predictionArtifact"),
        f"{source} {pool} prediction lineage artifact",
    )
    holdout = _validated_metrics(
        report.get("metrics", {}).get("bySplit", {}).get("holdout"),
        f"{source} {pool} holdout",
    )
    return {
        "modelId": model_id,
        "lineage": lineage,
        "predictionArtifact": prediction_artifact,
        "holdout": holdout,
    }


def _validated_stack_pool(stack_report, pool, target):
    pool_report = _required_mapping(
        stack_report.get("pools", {}).get(pool),
        f"stack {pool} report",
    )
    if pool_report.get("target") != target:
        raise ValueError(f"stack {pool} target must be {target}")
    selection = _required_mapping(pool_report.get("selection"), f"stack {pool} calibration")
    if selection.get("selectedOn") != "validation":
        raise ValueError(f"stack {pool} calibration must be selected on validation")
    if selection.get("holdoutUsedForSelection") is not False:
        raise ValueError(f"stack {pool} holdout must remain untouched during calibration")
    for field in ("lightgbmCalibration", "catboostCalibration"):
        _required_text(selection.get(field), f"stack {pool} calibration {field}")
    holdout = _validated_metrics(
        pool_report.get("metrics", {}).get("holdout"),
        f"stack {pool} holdout",
    )
    return {"selection": selection, "holdout": holdout}


def _validated_metrics(metrics, label):
    metrics = _required_mapping(metrics, label)
    for field in ("rows", "races", "logLoss", "brierScore", "topPickHitRate"):
        value = metrics.get(field)
        if not isinstance(value, (int, float)):
            raise ValueError(f"{label} missing numeric {field}")
    if metrics["rows"] <= 0 or metrics["races"] <= 0:
        raise ValueError(f"{label} sample count must be positive")
    if metrics.get("isOutOfSample") is not True:
        raise ValueError(f"{label} must be marked out-of-sample")
    return {field: metrics[field] for field in (
        "rows", "races", "logLoss", "brierScore", "topPickHits", "topPickHitRate", "isOutOfSample"
    ) if field in metrics}


def _validated_benchmark(benchmarks, pool):
    benchmark = _required_mapping(
        _required_mapping(benchmarks, "place benchmarks").get(pool),
        f"{pool} place benchmark",
    )
    if benchmark.get("split") != "holdout":
        raise ValueError(f"{pool} benchmark must use holdout")
    for field in (
        "bets", "hits", "hitRate", "stake", "return", "profit", "roi",
        "maxDrawdown", "longestLosingRun",
    ):
        if not isinstance(benchmark.get(field), (int, float)):
            raise ValueError(f"{pool} benchmark missing numeric {field}")
    if benchmark["bets"] <= 0:
        raise ValueError(f"{pool} benchmark bets sample count must be positive")
    return benchmark


def _candidate(source, model_id, holdout, calibration):
    return {
        "source": source,
        "modelId": model_id,
        "holdout": holdout,
        "calibration": calibration,
    }


def _strategy_summary(benchmark, source_pool):
    return {
        "strategy": benchmark.get("strategy"),
        "sourceModelTarget": source_pool,
        "evaluatedPool": "PLACE",
        **{field: benchmark[field] for field in (
            "split", "bets", "hits", "hitRate", "stake", "return", "profit", "roi",
            "maxDrawdown", "longestLosingRun",
        )},
    }


def _prospective_market_evidence(market_coverage, pool):
    evidence = market_coverage.get("prospective", {}).get(pool)
    if not isinstance(evidence, dict):
        return {
            "passed": False,
            "settledBets": 0,
            "reason": "prospective market sample unavailable",
        }
    settled_bets = evidence.get("settledBets")
    roi = evidence.get("roi")
    max_drawdown = evidence.get("maxDrawdown")
    passed = (
        isinstance(settled_bets, (int, float))
        and settled_bets > 0
        and isinstance(roi, (int, float))
        and isinstance(max_drawdown, (int, float))
    )
    return {
        "passed": passed,
        "settledBets": settled_bets if isinstance(settled_bets, (int, float)) else 0,
        "roi": roi if isinstance(roi, (int, float)) else None,
        "maxDrawdown": max_drawdown if isinstance(max_drawdown, (int, float)) else None,
        "reason": None if passed else "prospective market sample unavailable",
    }


def _promotion_reasons(pool, champion, benchmark, prospective):
    reasons = []
    if champion["source"] != "STACK":
        reasons.append("research champion is not the calibrated stack")
    if pool == "WIN":
        reasons.append("WIN-specific holdout ROI and drawdown unavailable")
    elif benchmark["roi"] <= 0:
        reasons.append("blind holdout ROI is non-positive")
    if not prospective["passed"]:
        reasons.append("prospective market sample unavailable")
    reasons.append("P0 report does not authorize cash execution")
    return reasons


def _market_summary(market_coverage):
    return {
        "summary": market_coverage.get("summary", {}),
        "byWindow": market_coverage.get("byWindow", {}),
        "byPool": market_coverage.get("byPool", {}),
        "prospective": market_coverage.get("prospective", {}),
    }


def _required_mapping(value, label):
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def _required_text(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a non-empty string")
    return value.strip()


def _load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def main():
    parser = argparse.ArgumentParser(description="Build P0 WIN/PLACE value-model promotion report.")
    parser.add_argument("--lightgbm-win", required=True)
    parser.add_argument("--lightgbm-place", required=True)
    parser.add_argument("--catboost-win", required=True)
    parser.add_argument("--catboost-place", required=True)
    parser.add_argument("--stack-report", required=True)
    parser.add_argument("--place-win-baseline", required=True)
    parser.add_argument("--place-model-baseline", required=True)
    parser.add_argument("--market-coverage", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    report = build_value_model_report(
        lightgbm_reports={
            "WIN": _load_json(args.lightgbm_win),
            "PLACE": _load_json(args.lightgbm_place),
        },
        catboost_reports={
            "WIN": _load_json(args.catboost_win),
            "PLACE": _load_json(args.catboost_place),
        },
        stack_report=_load_json(args.stack_report),
        place_benchmarks={
            "WIN": _load_json(args.place_win_baseline),
            "PLACE": _load_json(args.place_model_baseline),
        },
        market_coverage=_load_json(args.market_coverage),
    )
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for pool in POOLS:
        section = report["promotion"][pool]
        champion = section["researchChampion"]
        print(
            f"{pool}: {section['status']} | research champion "
            f"{champion['source']} {champion['modelId']} | "
            f"holdout log loss {champion['holdout']['logLoss']:.6f}"
        )
    print(f"Saved value-model promotion report to {output_path}")


if __name__ == "__main__":
    main()
