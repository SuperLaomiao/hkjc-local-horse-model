#!/usr/bin/env python3
"""Build fail-closed, pool-specific QIN/QPL promotion reports."""

import argparse
import json
from pathlib import Path


REPORT_VERSION = "exotic-pool-promotion-v1"


def build_exotic_pool_promotion(model_report, strategy_report, prospective=None):
    """Combine probability, blind ROI, concentration, and prospective gates."""
    pool = model_report.get("pool")
    if not pool or pool != strategy_report.get("pool"):
        raise ValueError("model and strategy reports must describe the same pool")
    selected_metrics = model_report.get("selectedStack", {}).get("metrics", {})
    validation_probability = selected_metrics.get("validation", {})
    holdout_probability = selected_metrics.get("holdout", {})
    holdout_policy = model_report.get("holdoutPolicy", {})
    strategy_metrics = strategy_report.get("metricsBySplit", {})
    validation_strategy = strategy_metrics.get("validation", {}).get("selectedStack", {})
    holdout_strategy = strategy_metrics.get("holdout", {}).get("selectedStack", {})

    retrospective_gates = {
        "probabilityQuality": (
            model_report.get("promotion", {}).get("researchStatus") == "RESEARCH_CHAMPION"
        ),
        "minimumValidationRaces": _number(validation_probability.get("races"), 0) >= 200,
        "minimumHoldoutRaces": _number(holdout_probability.get("races"), 0) >= 200,
        "untouchedHoldout": holdout_probability.get("isOutOfSample") is True,
        "freshResearchHoldout": holdout_policy.get("promotionEligible") is True,
        "positiveValidationRoi": _number(validation_strategy.get("ROI"), -1) > 0,
        "positiveHoldoutRoi": _number(holdout_strategy.get("ROI"), -1) > 0,
        "minimumHoldoutBets": _number(holdout_strategy.get("bets"), 0) >= 200,
        "returnConcentration": _number(
            holdout_strategy.get("largestReturnShare"), 1
        ) <= 0.25,
        "losingRun": _number(holdout_strategy.get("longestLosingRun"), 10**9) <= 40,
    }
    retrospective_failed = [name for name, passed in retrospective_gates.items() if not passed]

    prospective = prospective or {}
    cash_gates = {
        "prospectiveLockedLines": _number(prospective.get("eligibleLockedLines"), 0) >= 100,
        "positiveProspectiveRoi": _number(prospective.get("roi"), -1) > 0,
        "positiveAverageClv": _number(prospective.get("averageIndicativeClv"), -1) > 0,
        "prospectiveDrawdownRecorded": prospective.get("maxDrawdown") is not None,
    }
    cash_failed = [name for name, passed in cash_gates.items() if not passed]
    research_status = "READY_PAPER" if not retrospective_failed else "NO_GO"
    prospective_status = "PASS" if not cash_failed else "BLOCKED_DATA"
    return {
        "version": REPORT_VERSION,
        "pool": pool,
        "researchStatus": research_status,
        "cashMode": (
            "REVIEW_REQUIRED"
            if research_status == "READY_PAPER" and prospective_status == "PASS"
            else "NO_BET"
        ),
        "prospectiveStatus": prospective_status,
        "retrospectiveGates": retrospective_gates,
        "retrospectiveFailedGates": retrospective_failed,
        "cashGates": cash_gates,
        "cashFailedGates": cash_failed,
        "evidence": {
            "probability": selected_metrics,
            "strategy": {
                "validation": validation_strategy,
                "holdout": holdout_strategy,
            },
            "prospective": prospective,
        },
        "policy": (
            "Retrospective results can approve paper research only. Even a full gate pass "
            "requires explicit review before executable recommendations."
        ),
    }


def _number(value, fallback):
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def build_parser():
    parser = argparse.ArgumentParser(description="Build one QIN/QPL promotion report.")
    parser.add_argument("--model-report", required=True)
    parser.add_argument("--strategy-report", required=True)
    parser.add_argument("--prospective-report")
    parser.add_argument("--output", required=True)
    return parser


def _read_json(path):
    value = json.loads(Path(path).expanduser().read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"report {path} is not an object")
    return value


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        report = build_exotic_pool_promotion(
            _read_json(args.model_report),
            _read_json(args.strategy_report),
            _read_json(args.prospective_report) if args.prospective_report else None,
        )
    except (OSError, ValueError, json.JSONDecodeError) as error:
        raise SystemExit(str(error)) from error
    output = Path(args.output).expanduser()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"{report['pool']}: research {report['researchStatus']}, "
        f"prospective {report['prospectiveStatus']}, cash {report['cashMode']}"
    )
    print(f"Saved promotion report to {output.resolve()}")


if __name__ == "__main__":
    main()
