#!/usr/bin/env python3
import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np


FEATURES = [
    "distance",
    "raceClass",
    "fieldSize",
    "draw",
    "actualWeight",
    "horseRunsBefore",
    "horseWinsBefore",
    "horsePlacesBefore",
    "horseWinRateBefore",
    "horsePlaceRateBefore",
    "horseAverageLbwBefore",
    "daysSinceLastRun",
    "jockeyRunsBefore",
    "jockeyWinsBefore",
    "jockeyPlacesBefore",
    "jockeyWinRateBefore",
    "jockeyPlaceRateBefore",
    "trainerRunsBefore",
    "trainerWinsBefore",
    "trainerPlacesBefore",
    "trainerWinRateBefore",
    "trainerPlaceRateBefore",
    "distanceSurfaceStartsBefore",
    "distanceSurfaceWinRateBefore",
    "distanceSurfacePlaceRateBefore",
    "marketWinOddsT60",
    "marketWinImpliedProbT60",
    "marketWinRankT60",
    "marketWinOddsT30",
    "marketWinImpliedProbT30",
    "marketWinRankT30",
    "marketWinOddsT10",
    "marketWinImpliedProbT10",
    "marketWinRankT10",
    "marketWinOddsT3",
    "marketWinImpliedProbT3",
    "marketWinRankT3",
    "marketWinOddsPctChangeT60ToT30",
    "marketPlaceOddsT60",
    "marketPlaceImpliedProbT60",
    "marketPlaceRankT60",
    "marketPlaceOddsT30",
    "marketPlaceImpliedProbT30",
    "marketPlaceRankT30",
    "marketPlaceOddsT10",
    "marketPlaceImpliedProbT10",
    "marketPlaceRankT10",
    "marketPlaceOddsT3",
    "marketPlaceImpliedProbT3",
    "marketPlaceRankT3",
    "marketPlaceOddsPctChangeT60ToT30",
    "tianxiFormAvailable",
    "tianxiPriorStarts",
    "tianxiPriorWins",
    "tianxiPriorPlaces",
    "tianxiPriorWinRate",
    "tianxiPriorPlaceRate",
    "tianxiDaysSinceLastRun",
    "tianxiLatestRating",
    "tianxiRatingTrend3",
    "tianxiRecentAverageLbw3",
    "tianxiRecentAverageWinOdds5",
    "tianxiSameDistanceStarts",
    "tianxiSameDistanceWinRate",
]


SPLITS = ["train", "validation", "holdout"]


def main():
    parser = argparse.ArgumentParser(description="Train a local HKJC logistic baseline model.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--iterations", type=int, default=160)
    parser.add_argument("--learningRate", type=float, default=0.05)
    parser.add_argument("--l2", type=float, default=0.001)
    args = parser.parse_args()

    input_path = Path(args.input)
    payload = json.loads(input_path.read_text(encoding="utf8"))
    rows = [row for row in payload.get("rows", []) if row.get("split") in SPLITS]
    if not rows:
        raise SystemExit("No training rows found")

    x_raw = np.array([[feature_value(row, feature) for feature in FEATURES] for row in rows], dtype=float)
    y = np.array([1.0 if row.get("targetWin") == 1 else 0.0 for row in rows], dtype=float)
    train_mask = np.array([row.get("split") == "train" for row in rows], dtype=bool)
    if train_mask.sum() == 0:
        raise SystemExit("No train split rows found")

    means = x_raw[train_mask].mean(axis=0)
    stds = x_raw[train_mask].std(axis=0)
    stds = np.where(stds > 1e-9, stds, 1.0)
    x = (x_raw - means) / stds
    x = np.nan_to_num(x, nan=0.0, posinf=0.0, neginf=0.0)
    x_with_bias = np.column_stack([np.ones(x.shape[0]), x])

    weights = train_logit(
        x_with_bias[train_mask],
        y[train_mask],
        iterations=args.iterations,
        learning_rate=args.learningRate,
        l2=args.l2,
    )

    raw_probabilities = sigmoid(x_with_bias @ weights)
    normalized_probabilities = normalize_by_race(rows, raw_probabilities)
    prediction_rows = [
        {
            "raceId": row.get("raceId"),
            "date": row.get("date"),
            "split": row.get("split"),
            "horseId": row.get("horseId"),
            "horseNo": row.get("horseNo"),
            "horseName": row.get("horseName"),
            "probability": float(probability),
            "targetWin": int(row.get("targetWin") == 1),
        }
        for row, probability in zip(rows, normalized_probabilities)
    ]

    report = {
        "modelId": "logit-runner-v1",
        "label": "Python numpy logistic runner model",
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "training": {
            "input": input_path.name,
            "rows": len(rows),
            "trainRows": int(train_mask.sum()),
            "iterations": args.iterations,
            "learningRate": args.learningRate,
            "l2": args.l2,
            "normalization": "sigmoid runner score normalized within race",
            "externalFeatures": payload.get("externalFeatures"),
        },
        "features": FEATURES,
        "weights": [round_float(value) for value in weights.tolist()],
        "featureMeans": [round_float(value) for value in means.tolist()],
        "featureStds": [round_float(value) for value in stds.tolist()],
        "metrics": score_probability_rows(prediction_rows),
        "responsibleUse": "paper-mode probability baseline; not an automatic cash betting model",
    }

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    holdout = report["metrics"]["bySplit"]["holdout"]
    print(
        "Trained model logit-runner-v1: "
        f"{len(rows)} rows, holdout races {holdout['races']}, "
        f"holdout logLoss {holdout['logLoss']}"
    )
    print(f"Saved model training report to {output_path}")


def feature_value(row, feature):
    value = (row.get("features") or {}).get(feature)
    if value is None:
        return 0.0
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    if math.isfinite(number):
        return number
    return 0.0


def train_logit(x, y, iterations, learning_rate, l2):
    weights = np.zeros(x.shape[1], dtype=float)
    n = max(1, x.shape[0])
    for _ in range(max(1, int(iterations))):
        predictions = sigmoid(x @ weights)
        gradient = (x.T @ (predictions - y)) / n
        regularization = l2 * weights
        regularization[0] = 0.0
        weights -= learning_rate * (gradient + regularization)
    return weights


def sigmoid(values):
    values = np.clip(values, -35, 35)
    return 1.0 / (1.0 + np.exp(-values))


def normalize_by_race(rows, raw_probabilities):
    grouped = {}
    for index, row in enumerate(rows):
        grouped.setdefault(row.get("raceId"), []).append(index)

    normalized = np.zeros_like(raw_probabilities, dtype=float)
    for indexes in grouped.values():
        total = float(raw_probabilities[indexes].sum())
        if total <= 0:
            normalized[indexes] = 1.0 / len(indexes)
        else:
            normalized[indexes] = raw_probabilities[indexes] / total
    return normalized


def score_probability_rows(rows):
    items = [row for row in rows if is_number(row.get("probability"))]
    return {
        "overall": summarize_rows(items),
        "bySplit": {
            split: summarize_rows([row for row in items if row.get("split") == split])
            for split in SPLITS
        },
        "calibration": build_calibration(items),
    }


def summarize_rows(rows):
    races = group_by_race(rows)
    top_picks = []
    for race_rows in races.values():
        top_picks.append(max(race_rows, key=lambda row: float(row["probability"])))
    top_pick_wins = sum(1 for row in top_picks if row.get("targetWin") == 1)
    brier_total = 0.0
    log_loss_total = 0.0
    for row in rows:
        probability = clamp_probability(row["probability"])
        outcome = 1.0 if row.get("targetWin") == 1 else 0.0
        brier_total += (probability - outcome) ** 2
        log_loss_total -= outcome * math.log(probability) + (1.0 - outcome) * math.log(1.0 - probability)
    return {
        "rows": len(rows),
        "races": len(races),
        "brierScore": round_float(brier_total / len(rows)) if rows else None,
        "logLoss": round_float(log_loss_total / len(rows)) if rows else None,
        "topPickWins": top_pick_wins,
        "topPickWinRate": round_float(top_pick_wins / len(top_picks)) if top_picks else None,
    }


def build_calibration(rows):
    buckets = [
        {"label": "<10%", "min": 0.0, "max": 0.1},
        {"label": "10-15%", "min": 0.1, "max": 0.15},
        {"label": "15-20%", "min": 0.15, "max": 0.2},
        {"label": "20%+", "min": 0.2, "max": 1.000001},
    ]
    result = []
    for bucket in buckets:
        bucket_rows = [
            row for row in rows
            if bucket["min"] <= float(row["probability"]) < bucket["max"]
        ]
        predicted = sum(float(row["probability"]) for row in bucket_rows)
        actual = sum(1 for row in bucket_rows if row.get("targetWin") == 1)
        result.append({
            "label": bucket["label"],
            "rows": len(bucket_rows),
            "averageProbability": round_float(predicted / len(bucket_rows)) if bucket_rows else None,
            "actualWinRate": round_float(actual / len(bucket_rows)) if bucket_rows else None,
            "calibrationGap": round_float(actual / len(bucket_rows) - predicted / len(bucket_rows)) if bucket_rows else None,
        })
    return result


def group_by_race(rows):
    grouped = {}
    for row in rows:
        grouped.setdefault(row.get("raceId"), []).append(row)
    return grouped


def is_number(value):
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError):
        return False


def clamp_probability(value):
    return min(0.999999, max(0.000001, float(value)))


def round_float(value, digits=6):
    if value is None:
        return None
    return round(float(value), digits)


if __name__ == "__main__":
    main()
