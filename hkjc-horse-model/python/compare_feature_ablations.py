#!/usr/bin/env python3
"""Compare precomputed feature-policy probabilities on identical validation/forward races."""

import argparse
import hashlib
import json
import math
from collections import defaultdict
from datetime import date
from pathlib import Path


REPORT_VERSION = "feature-ablation-v1"
DEFAULT_POLICY_IDS = ("base", "speedpro", "poolMoney", "oddsMovement", "combined")


def compare_feature_ablations(
    validation_rows,
    prospective_rows,
    *,
    feature_policy,
    freeze_date,
    policy_ids=DEFAULT_POLICY_IDS,
):
    """Select a feature policy on validation and read forward performance without reselection."""
    normalized_freeze_date = _date_text(freeze_date, "freeze_date")
    normalized_policy_ids = _policy_ids(policy_ids)
    normalized_feature_policy = _feature_policy(feature_policy)
    target_field = str(normalized_feature_policy.get("target") or "targetWin").strip()
    if target_field not in {"targetWin", "targetPlace"}:
        raise ValueError("feature_policy.target must be targetWin or targetPlace")

    validation = _normalize_rows(
        validation_rows,
        cohort="validation",
        target_field=target_field,
        policy_ids=normalized_policy_ids,
    )
    prospective = _normalize_rows(
        prospective_rows,
        cohort="prospective",
        target_field=target_field,
        policy_ids=normalized_policy_ids,
    )
    leaked_validation_dates = sorted({
        row["date"] for row in validation if row["date"] >= normalized_freeze_date
    })
    if leaked_validation_dates:
        raise ValueError(
            f"validation rows must be before freeze date {normalized_freeze_date}: "
            f"{', '.join(leaked_validation_dates)}"
        )
    validation_races = {row["raceId"] for row in validation}
    prospective_races = {row["raceId"] for row in prospective}
    overlap = sorted(validation_races & prospective_races)
    if overlap:
        raise ValueError(f"validation/prospective race overlap: {', '.join(overlap)}")
    stale_dates = sorted({row["date"] for row in prospective if row["date"] < normalized_freeze_date})
    if stale_dates:
        raise ValueError(
            f"prospective rows must be on or after freeze date {normalized_freeze_date}: "
            f"{', '.join(stale_dates)}"
        )

    validation_cohort = _common_race_cohort(validation, normalized_policy_ids)
    prospective_cohort = _common_race_cohort(prospective, normalized_policy_ids)
    policies = {}
    for policy_id in normalized_policy_ids:
        policies[policy_id] = {
            "validation": _metrics(validation_cohort["rows"], policy_id),
            "prospective": _metrics(prospective_cohort["rows"], policy_id),
        }

    ranked = sorted(
        normalized_policy_ids,
        key=lambda policy_id: (
            _metric_or_infinity(policies[policy_id]["validation"]["logLoss"]),
            _metric_or_infinity(policies[policy_id]["validation"]["brierScore"]),
            policy_id,
        ),
    )
    selected_policy = ranked[0] if validation_cohort["summary"]["commonRaces"] > 0 else None
    deficits = []
    if validation_cohort["summary"]["commonRaces"] == 0:
        deficits.append({
            "cohort": "validation",
            "metric": "commonRaces",
            "required": 1,
            "actual": 0,
        })
    if prospective_cohort["summary"]["commonRaces"] == 0:
        deficits.append({
            "cohort": "prospective",
            "metric": "commonRaces",
            "required": 1,
            "actual": 0,
        })
    state = "READY_FOR_PROSPECTIVE_REVIEW" if selected_policy and not deficits else "BLOCKED_DATA"
    feature_policy_id = _policy_hash(normalized_feature_policy, normalized_policy_ids)

    return {
        "version": REPORT_VERSION,
        "state": state,
        "cashMode": "NO_BET",
        "executionStatus": "RESEARCH_ONLY",
        "deficits": deficits,
        "freeze": {
            "date": normalized_freeze_date,
            "featurePolicyId": feature_policy_id,
            "featurePolicy": normalized_feature_policy,
            "policyIds": list(normalized_policy_ids),
        },
        "evaluationPolicy": {
            "selectionCohort": "VALIDATION_ONLY",
            "prospectiveReuse": "NO_RESELECTION",
            "cohortUnit": "COMPLETE_RACE_RUNNER_SET",
            "missingData": "EXCLUDE_INCOMPLETE_RACE_FOR_ALL_POLICIES",
            "target": target_field,
        },
        "cohorts": {
            "validation": validation_cohort["summary"],
            "prospective": {
                **prospective_cohort["summary"],
                "fresh": bool(prospective_cohort["rows"])
                and all(
                    row["date"] >= normalized_freeze_date
                    for row in prospective_cohort["rows"]
                ),
            },
        },
        "selection": {
            "selectedPolicy": selected_policy,
            "selectedOn": "validation.logLoss",
            "tieBreakers": ["validation.brierScore", "policyId"],
            "prospectiveMetricsUsedForSelection": False,
        },
        "policies": policies,
        "selectedProspective": {
            "policyId": selected_policy,
            "metrics": policies[selected_policy]["prospective"] if selected_policy else None,
        },
    }


def write_feature_ablation_report(
    *, validation_path, prospective_path, feature_policy_path, freeze_date, output_path
):
    """Freeze the policy first, then read each evaluation cohort exactly once."""
    feature_policy = json.loads(Path(feature_policy_path).expanduser().read_text(encoding="utf-8"))
    validation_rows = _load_jsonl(validation_path)
    prospective_rows = _load_jsonl(prospective_path)
    report = compare_feature_ablations(
        validation_rows,
        prospective_rows,
        feature_policy=feature_policy,
        freeze_date=freeze_date,
    )
    destination = Path(output_path).expanduser()
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return report


def _normalize_rows(rows, *, cohort, target_field, policy_ids):
    if not isinstance(rows, list):
        raise ValueError(f"{cohort}_rows must be a list")
    normalized = []
    identities = set()
    race_dates = {}
    for index, row in enumerate(rows, start=1):
        if not isinstance(row, dict):
            raise ValueError(f"{cohort} row {index} must be an object")
        race_id = str(row.get("raceId") or "").strip()
        runner_id = str(row.get("runnerId") or row.get("horseId") or "").strip()
        row_date = _date_text(row.get("date"), f"{cohort} row {index} date")
        if not race_id or not runner_id:
            raise ValueError(f"{cohort} row {index} is missing raceId or runnerId")
        identity = (race_id, runner_id)
        if identity in identities:
            raise ValueError(f"duplicate {cohort} race/runner identity: {race_id}/{runner_id}")
        identities.add(identity)
        if race_id in race_dates and race_dates[race_id] != row_date:
            raise ValueError(f"race {race_id!r} appears on multiple dates")
        race_dates[race_id] = row_date
        target = row.get(target_field)
        if target not in (0, 1, False, True):
            raise ValueError(f"{cohort} row {index} has invalid {target_field}")
        supplied_predictions = row.get("predictions")
        if not isinstance(supplied_predictions, dict):
            raise ValueError(f"{cohort} row {index} predictions must be an object")
        predictions = {}
        for policy_id in policy_ids:
            value = supplied_predictions.get(policy_id)
            if value is None or value == "":
                predictions[policy_id] = None
                continue
            try:
                probability = float(value)
            except (TypeError, ValueError) as error:
                raise ValueError(
                    f"{cohort} row {index} has invalid probability for {policy_id}"
                ) from error
            if not math.isfinite(probability) or probability < 0 or probability > 1:
                raise ValueError(
                    f"{cohort} row {index} has invalid probability for {policy_id}"
                )
            predictions[policy_id] = probability
        normalized.append({
            "raceId": race_id,
            "runnerId": runner_id,
            "date": row_date,
            "target": int(target),
            "predictions": predictions,
        })
    return normalized


def _common_race_cohort(rows, policy_ids):
    grouped = defaultdict(list)
    for row in rows:
        grouped[row["raceId"]].append(row)
    missing_by_policy = {policy_id: 0 for policy_id in policy_ids}
    common_rows = []
    excluded_races = 0
    excluded_rows = 0
    for race_id in sorted(grouped):
        race_rows = grouped[race_id]
        complete = True
        for row in race_rows:
            for policy_id in policy_ids:
                if row["predictions"][policy_id] is None:
                    missing_by_policy[policy_id] += 1
                    complete = False
        if len(race_rows) < 2:
            complete = False
        if complete:
            common_rows.extend(race_rows)
        else:
            excluded_races += 1
            excluded_rows += len(race_rows)
    common_races = len({row["raceId"] for row in common_rows})
    return {
        "rows": common_rows,
        "summary": {
            "totalRaces": len(grouped),
            "commonRaces": common_races,
            "commonRows": len(common_rows),
            "excludedRaces": excluded_races,
            "excludedRows": excluded_rows,
            "missingByPolicy": missing_by_policy,
        },
    }


def _metrics(rows, policy_id):
    if not rows:
        return {
            "rows": 0,
            "races": 0,
            "logLoss": None,
            "brierScore": None,
            "calibrationError": None,
            "topPickHits": 0,
            "topPickHitRate": None,
        }
    log_loss = 0.0
    brier = 0.0
    buckets = defaultdict(list)
    grouped = defaultdict(list)
    for row in rows:
        probability = min(0.999999, max(0.000001, row["predictions"][policy_id]))
        target = row["target"]
        log_loss -= target * math.log(probability) + (1 - target) * math.log(1 - probability)
        brier += (probability - target) ** 2
        bucket = min(4, int(probability * 5))
        buckets[bucket].append((probability, target))
        grouped[row["raceId"]].append((probability, row["runnerId"], target))
    calibration_error = 0.0
    for values in buckets.values():
        predicted = sum(value[0] for value in values) / len(values)
        actual = sum(value[1] for value in values) / len(values)
        calibration_error += len(values) / len(rows) * abs(predicted - actual)
    top_pick_hits = 0
    for race_rows in grouped.values():
        selected = sorted(race_rows, key=lambda value: (-value[0], value[1]))[0]
        top_pick_hits += selected[2]
    return {
        "rows": len(rows),
        "races": len(grouped),
        "logLoss": _round(log_loss / len(rows)),
        "brierScore": _round(brier / len(rows)),
        "calibrationError": _round(calibration_error),
        "topPickHits": top_pick_hits,
        "topPickHitRate": _round(top_pick_hits / len(grouped)) if grouped else None,
    }


def _feature_policy(value):
    if not isinstance(value, dict) or not value:
        raise ValueError("feature_policy must be a non-empty object")
    return json.loads(json.dumps(value, ensure_ascii=False))


def _policy_ids(values):
    normalized = []
    for value in values:
        policy_id = str(value or "").strip()
        if not policy_id:
            raise ValueError("policy_ids must contain non-empty strings")
        if policy_id not in normalized:
            normalized.append(policy_id)
    if not normalized or "base" not in normalized:
        raise ValueError("policy_ids must include base")
    return tuple(normalized)


def _policy_hash(feature_policy, policy_ids):
    payload = {"featurePolicy": feature_policy, "policyIds": list(policy_ids)}
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return f"sha256:{hashlib.sha256(canonical.encode('utf-8')).hexdigest()}"


def _date_text(value, label):
    text = str(value or "").strip()
    try:
        parsed = date.fromisoformat(text)
    except ValueError as error:
        raise ValueError(f"{label} must be a valid YYYY-MM-DD date") from error
    if parsed.isoformat() != text:
        raise ValueError(f"{label} must be a valid YYYY-MM-DD date")
    return text


def _metric_or_infinity(value):
    return float(value) if value is not None and math.isfinite(float(value)) else math.inf


def _round(value):
    return round(float(value), 6)


def _load_jsonl(path_value):
    rows = []
    with Path(path_value).expanduser().open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                raise ValueError(f"JSONL line {line_number} must be an object")
            rows.append(value)
    return rows


def build_parser():
    parser = argparse.ArgumentParser(description="Compare frozen feature policies on common cohorts.")
    parser.add_argument("--validation", required=True)
    parser.add_argument("--prospective", required=True)
    parser.add_argument("--feature-policy", required=True)
    parser.add_argument("--freeze-date", required=True)
    parser.add_argument("--output", required=True)
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        report = write_feature_ablation_report(
            validation_path=args.validation,
            prospective_path=args.prospective,
            feature_policy_path=args.feature_policy,
            freeze_date=args.freeze_date,
            output_path=args.output,
        )
    except (OSError, ValueError, json.JSONDecodeError) as error:
        raise SystemExit(str(error)) from error
    print(
        f"Feature ablation: {report['state']}; selected "
        f"{report['selection']['selectedPolicy'] or 'none'} on validation"
    )
    print(f"Saved report to {Path(args.output).expanduser().resolve()}")


if __name__ == "__main__":
    main()
