#!/usr/bin/env python3
"""Build one fail-closed P1 market-aware model and value comparison."""

import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path


REPORT_VERSION = "market-aware-comparison-v1"
POOLS = {"WIN": "targetWin", "PLACE": "targetPlace"}


def build_market_aware_comparison(
    *,
    gate_report,
    model_reports,
    stack_reports,
    value_reports,
):
    """Compare identical-cohort candidates and reject unstable historical ROI."""
    if gate_report.get("status") != "READY_RESEARCH" or not gate_report.get("trainingAllowed"):
        raise ValueError("market-aware gate must be READY_RESEARCH")
    if gate_report.get("decisionWindow") != "T-10":
        raise ValueError("comparison requires a T-10 gate")
    expected_holdout_races = _positive_number(
        gate_report.get("splits", {}).get("holdout", {}).get("candidateRaces"),
        "gate holdout candidateRaces",
    )

    candidates_by_pool = {pool: [] for pool in POOLS}
    for report in model_reports:
        target = report.get("target")
        pool = _pool_for_target(target)
        mode = report.get("mode")
        if mode not in {"no-market", "market-aware-t10"}:
            raise ValueError(f"unsupported model mode {mode!r}")
        metrics = _holdout_metrics(report.get("metrics", {}).get("bySplit", {}).get("holdout"))
        if metrics["races"] != expected_holdout_races:
            raise ValueError("model report holdout race count differs from market gate")
        candidates_by_pool[pool].append({
            "source": "MODEL",
            "modelId": _required_text(report.get("modelId"), "modelId"),
            "mode": mode,
            "lineage": report.get("lineage"),
            "holdout": metrics,
        })

    for mode, report in stack_reports.items():
        if mode not in {"no-market", "market-aware-t10"}:
            raise ValueError(f"unsupported stack mode {mode!r}")
        if report.get("selectionSplit") != "validation" or report.get("holdoutUsedForSelection") is not False:
            raise ValueError("stack selection must use validation without holdout")
        for pool, target in POOLS.items():
            pool_report = report.get("pools", {}).get(pool, {})
            if pool_report.get("target") != target:
                raise ValueError(f"stack {pool} target must be {target}")
            metrics = _holdout_metrics(pool_report.get("metrics", {}).get("holdout"))
            if metrics["races"] != expected_holdout_races:
                raise ValueError("stack holdout race count differs from market gate")
            candidates_by_pool[pool].append({
                "source": "STACK",
                "modelId": f"{_required_text(report.get('version'), 'stack version')}:{mode}",
                "mode": mode,
                "lineage": pool_report.get("components"),
                "holdout": metrics,
            })

    pool_reports = {}
    for pool, candidates in candidates_by_pool.items():
        no_market = sorted(
            (item for item in candidates if item["mode"] == "no-market"),
            key=_candidate_score,
        )
        market = sorted(
            (item for item in candidates if item["mode"] == "market-aware-t10"),
            key=_candidate_score,
        )
        if not no_market or not market:
            raise ValueError(f"{pool} requires no-market and market-aware-t10 candidates")
        ranked = sorted(candidates, key=_candidate_score)
        pool_reports[pool] = {
            "researchChampion": ranked[0],
            "bestNoMarket": no_market[0],
            "bestMarketAware": market[0],
            "marketLift": {
                "logLossReduction": _round(
                    no_market[0]["holdout"]["logLoss"] - market[0]["holdout"]["logLoss"]
                ),
                "brierReduction": _round(
                    no_market[0]["holdout"]["brierScore"] - market[0]["holdout"]["brierScore"]
                ),
                "topPickHitRateLift": _round(
                    market[0]["holdout"]["topPickHitRate"]
                    - no_market[0]["holdout"]["topPickHitRate"]
                ),
            },
            "candidates": ranked,
        }

    value_candidates = [_value_candidate(report) for report in value_reports]
    passed_value_candidates = [item for item in value_candidates if item["historicalPassed"]]
    value_status = "PASS_HISTORICAL" if passed_value_candidates else "NO_GO"
    return {
        "version": REPORT_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "status": "READY_RESEARCH",
        "cashMode": "NO_BET",
        "decisionWindow": "T-10",
        "cohort": gate_report.get("cohort"),
        "splits": gate_report.get("splits"),
        "selectionPolicy": {
            "predictionResearchChampion": "lowest untouched-holdout log loss, then Brier score",
            "valueThresholds": "selected on validation and applied unchanged to holdout",
            "cashAuthorization": "never granted by historical evidence",
        },
        "pools": pool_reports,
        "valueGate": {
            "status": value_status,
            "cashMode": "NO_BET",
            "requirements": {
                "positiveValidationRoi": True,
                "positiveHoldoutRoi": True,
                "minimumBetsPerSplit": 100,
                "maximumLargestReturnShare": 0.25,
                "minimumProfitableMonthShare": 0.5,
                "maximumDrawdownToStake": 0.5,
            },
            "historicalCandidatesPassed": len(passed_value_candidates),
            "candidates": value_candidates,
        },
        "prospectivePromotion": gate_report.get("prospectivePromotion", {
            "status": "BLOCKED_DATA",
            "cashMode": "NO_BET",
            "reason": "requires prospective locked evidence",
        }),
        "conclusion": (
            "Market features improve probability quality, but no historical value candidate "
            "passes all stability gates; keep every executable recommendation at NO_BET."
        ),
    }


def _value_candidate(report):
    if report.get("selection", {}).get("selectedOn") != "validation":
        raise ValueError("value threshold must be selected on validation")
    if report.get("selection", {}).get("holdoutUsedForSelection") is not False:
        raise ValueError("value threshold selection must not use holdout")
    validation = _value_metrics(report.get("metrics", {}).get("validation"), "validation")
    holdout = _value_metrics(report.get("metrics", {}).get("holdout"), "holdout")
    if report.get("metrics", {}).get("holdout", {}).get("isOutOfSample") is not True:
        raise ValueError("value holdout must be out-of-sample")
    reasons = []
    if validation["roi"] <= 0:
        reasons.append("validation ROI is non-positive")
    if holdout["roi"] <= 0:
        reasons.append("holdout ROI is non-positive")
    if validation["bets"] < 100 or holdout["bets"] < 100:
        reasons.append("sample has fewer than 100 bets in validation or holdout")
    if validation["largestReturnShare"] > 0.25 or holdout["largestReturnShare"] > 0.25:
        reasons.append("profit concentration exceeds the 25% largest-return limit")
    if _profitable_month_share(validation["byMonth"]) < 0.5 or _profitable_month_share(holdout["byMonth"]) < 0.5:
        reasons.append("fewer than half of evaluated months are profitable")
    if (
        validation["maxDrawdown"] / validation["stake"] > 0.5
        or holdout["maxDrawdown"] / holdout["stake"] > 0.5
    ):
        reasons.append("drawdown exceeds 50% of stake in validation or holdout")
    return {
        "pool": report.get("pool"),
        "modelId": _required_text(report.get("modelId"), "value modelId"),
        "selection": report.get("selection"),
        "validation": validation,
        "holdout": holdout,
        "historicalPassed": not reasons,
        "reasons": reasons,
    }


def _holdout_metrics(metrics):
    if not isinstance(metrics, dict) or metrics.get("isOutOfSample") is not True:
        raise ValueError("model holdout must be an out-of-sample object")
    output = {}
    for field in ("rows", "races", "logLoss", "brierScore", "topPickHitRate"):
        output[field] = _finite_number(metrics.get(field), f"holdout {field}")
    output["isOutOfSample"] = True
    return output


def _value_metrics(metrics, label):
    if not isinstance(metrics, dict):
        raise ValueError(f"value {label} metrics must be an object")
    output = {}
    for field in ("bets", "stake", "return", "profit", "roi", "maxDrawdown", "largestReturnShare"):
        output[field] = _finite_number(metrics.get(field), f"value {label} {field}")
    by_month = metrics.get("byMonth")
    if not isinstance(by_month, dict) or not by_month:
        raise ValueError(f"value {label} byMonth is required")
    output["byMonth"] = by_month
    return output


def _profitable_month_share(by_month):
    return sum(float(item.get("roi", 0)) > 0 for item in by_month.values()) / len(by_month)


def _candidate_score(candidate):
    return (
        candidate["holdout"]["logLoss"],
        candidate["holdout"]["brierScore"],
        candidate["modelId"],
    )


def _pool_for_target(target):
    for pool, expected in POOLS.items():
        if target == expected:
            return pool
    raise ValueError(f"unsupported target {target!r}")


def _positive_number(value, label):
    number = _finite_number(value, label)
    if number <= 0:
        raise ValueError(f"{label} must be positive")
    return number


def _finite_number(value, label):
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{label} must be numeric") from error
    if not math.isfinite(number):
        raise ValueError(f"{label} must be finite")
    return number


def _required_text(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a non-empty string")
    return value.strip()


def _round(value):
    return round(float(value), 6)


def _load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _stack_spec(value):
    if "=" not in value:
        raise argparse.ArgumentTypeError("stack report must be MODE=PATH")
    mode, path = value.split("=", 1)
    return mode, path


def main(argv=None):
    parser = argparse.ArgumentParser(description="Build the P1 market-aware comparison report.")
    parser.add_argument("--gate", required=True)
    parser.add_argument("--model-report", action="append", default=[], required=True)
    parser.add_argument("--stack-report", action="append", default=[], type=_stack_spec)
    parser.add_argument("--value-report", action="append", default=[], required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    report = build_market_aware_comparison(
        gate_report=_load_json(args.gate),
        model_reports=[_load_json(path) for path in args.model_report],
        stack_reports={mode: _load_json(path) for mode, path in args.stack_report},
        value_reports=[_load_json(path) for path in args.value_report],
    )
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for pool in POOLS:
        champion = report["pools"][pool]["researchChampion"]
        print(
            f"{pool}: {champion['modelId']} ({champion['mode']}) | "
            f"holdout logLoss {champion['holdout']['logLoss']:.6f}"
        )
    print(f"Value gate: {report['valueGate']['status']} | cash {report['cashMode']}")
    print(f"Saved report to {output}")


if __name__ == "__main__":
    main()
