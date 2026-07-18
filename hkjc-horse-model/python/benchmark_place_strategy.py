#!/usr/bin/env python3
"""Strictly settle one model top pick per race into the HKJC PLACE pool."""

import argparse
import json
import math
from collections import defaultdict
from pathlib import Path


WILSON_Z_95 = 1.959963984540054


def benchmark_top_pick_place(predictions, races, *, split="holdout", stake_per_bet=10):
    """Rank one runner per race and settle hits with official PLACE dividends only."""
    stake_per_bet = _positive_float(stake_per_bet, "stake_per_bet")
    race_index = _index_races(races)
    predictions_by_race = defaultdict(list)
    for prediction in predictions:
        if not isinstance(prediction, dict):
            raise ValueError("predictions must contain objects")
        if prediction.get("split") != split:
            continue
        race_id = _required_text(prediction.get("raceId"), "prediction raceId")
        probability = _bounded_probability(prediction.get("probability"))
        horse_no = _required_horse_no(prediction.get("horseNo"))
        target_place = _binary_label(prediction.get("targetPlace"), "targetPlace")
        predictions_by_race[race_id].append({
            **prediction,
            "raceId": race_id,
            "horseNo": horse_no,
            "probability": probability,
            "targetPlace": target_place,
        })
    if not predictions_by_race:
        raise ValueError(f"no predictions found for split {split!r}")

    selected = []
    for race_id, entries in predictions_by_race.items():
        if race_id not in race_index:
            raise ValueError(f"missing official race result for {race_id}")
        top_pick = sorted(
            entries,
            key=lambda row: (-row["probability"], _horse_sort_key(row["horseNo"])),
        )[0]
        race = race_index[race_id]
        date = _required_text(top_pick.get("date") or race.get("date"), f"date for {race_id}")
        hit = top_pick["targetPlace"] == 1
        dividend_per_10 = None
        returned = 0.0
        if hit:
            dividend_per_10 = _find_place_dividend(race, top_pick["horseNo"])
            if dividend_per_10 is None:
                raise ValueError(
                    f"missing official PLACE dividend for {race_id} horse {top_pick['horseNo']}"
                )
            returned = dividend_per_10 * (stake_per_bet / 10.0)
        selected.append({
            "raceId": race_id,
            "date": date,
            "month": date[:7],
            "horseNo": top_pick["horseNo"],
            "probability": top_pick["probability"],
            "hit": hit,
            "stake": stake_per_bet,
            "dividendPer10": dividend_per_10,
            "return": returned,
            "profit": returned - stake_per_bet,
        })

    selected.sort(key=lambda row: (row["date"], row["raceId"]))
    summary = _summarize_settlements(selected)
    summary.update({
        "strategy": "TOP_PICK_PLACE",
        "split": split,
        "stakePerBet": _round(stake_per_bet),
        "hitRateWilson95": _wilson_interval(summary["hits"], summary["bets"]),
        "monthly": _monthly_summaries(selected),
        "settlements": [_rounded_settlement(row) for row in selected],
    })
    return summary


def _summarize_settlements(settlements):
    bets = len(settlements)
    hits = sum(bool(row["hit"]) for row in settlements)
    stake = sum(row["stake"] for row in settlements)
    returned = sum(row["return"] for row in settlements)
    winning_dividends = [row["dividendPer10"] for row in settlements if row["hit"]]
    cumulative_profit = 0.0
    peak_profit = 0.0
    max_drawdown = 0.0
    losing_run = 0
    longest_losing_run = 0
    for row in settlements:
        cumulative_profit += row["profit"]
        peak_profit = max(peak_profit, cumulative_profit)
        max_drawdown = max(max_drawdown, peak_profit - cumulative_profit)
        if row["hit"]:
            losing_run = 0
        else:
            losing_run += 1
            longest_losing_run = max(longest_losing_run, losing_run)
    return {
        "bets": bets,
        "hits": hits,
        "hitRate": _round(hits / bets if bets else None),
        "stake": _round(stake),
        "return": _round(returned),
        "profit": _round(returned - stake),
        "roi": _round((returned - stake) / stake if stake else None),
        "averageWinningDividendPer10": _round(
            sum(winning_dividends) / len(winning_dividends) if winning_dividends else None
        ),
        "breakEvenDividendPer10": _round(10.0 * bets / hits if hits else None),
        "maxDrawdown": _round(max_drawdown),
        "longestLosingRun": longest_losing_run,
    }


def _monthly_summaries(settlements):
    by_month = defaultdict(list)
    for settlement in settlements:
        by_month[settlement["month"]].append(settlement)
    return [
        {"month": month, **_summarize_settlements(by_month[month])}
        for month in sorted(by_month)
    ]


def _wilson_interval(hits, bets, z=WILSON_Z_95):
    if bets <= 0:
        return {"lower": None, "upper": None}
    proportion = hits / bets
    denominator = 1.0 + z * z / bets
    center = (proportion + z * z / (2.0 * bets)) / denominator
    margin = (
        z
        * math.sqrt(proportion * (1.0 - proportion) / bets + z * z / (4.0 * bets * bets))
        / denominator
    )
    return {"lower": _round(center - margin), "upper": _round(center + margin)}


def _index_races(races):
    if isinstance(races, dict):
        races = races.get("races", list(races.values()))
    if not isinstance(races, list):
        raise ValueError("races must be a list or an object containing races")
    result = {}
    for race in races:
        if not isinstance(race, dict):
            raise ValueError("races must contain objects")
        race_id = _required_text(race.get("raceId"), "race raceId")
        if race_id in result:
            raise ValueError(f"duplicate official race result for {race_id}")
        result[race_id] = race
    return result


def _find_place_dividend(race, horse_no):
    dividends = race.get("dividends") or {}
    place_rows = dividends.get("place") or []
    for row in place_rows:
        combination = row.get("combination") or []
        if len(combination) != 1 or str(combination[0]) != str(horse_no):
            continue
        try:
            dividend = float(row.get("dividendPer10"))
        except (TypeError, ValueError):
            return None
        return dividend if math.isfinite(dividend) and dividend > 0 else None
    return None


def _rounded_settlement(row):
    return {
        **row,
        "probability": _round(row["probability"]),
        "stake": _round(row["stake"]),
        "dividendPer10": _round(row["dividendPer10"]),
        "return": _round(row["return"]),
        "profit": _round(row["profit"]),
    }


def load_prediction_jsonl(path):
    rows = []
    with Path(path).open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(f"invalid prediction JSONL line {line_number}: {error}") from error
            rows.append(row)
    return rows


def load_official_races(path, required_race_ids=None):
    source = Path(path)
    if source.is_file():
        return _races_from_json_file(source)
    if not source.is_dir():
        raise ValueError(f"official race path does not exist: {source}")
    files = list(source.rglob("*.json"))
    if required_race_ids:
        required_meetings = {race_id.rsplit("-", 1)[0] + ".json" for race_id in required_race_ids}
        files = [file for file in files if file.name in required_meetings]
    races = []
    for file in sorted(files):
        races.extend(_races_from_json_file(file))
    return races


def _races_from_json_file(path):
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict) and isinstance(payload.get("races"), list):
        return payload["races"]
    if isinstance(payload, dict) and payload.get("raceId"):
        return [payload]
    raise ValueError(f"unsupported official race JSON shape: {path}")


def _positive_float(value, name):
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{name} must be a positive number") from error
    if not math.isfinite(number) or number <= 0:
        raise ValueError(f"{name} must be a positive number")
    return number


def _bounded_probability(value):
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"invalid prediction probability: {value!r}") from error
    if not math.isfinite(number) or number < 0 or number > 1:
        raise ValueError(f"invalid prediction probability: {value!r}")
    return number


def _binary_label(value, name):
    try:
        number = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{name} must be 0 or 1") from error
    if number not in (0, 1):
        raise ValueError(f"{name} must be 0 or 1")
    return number


def _required_text(value, name):
    text = str(value).strip() if value is not None else ""
    if not text:
        raise ValueError(f"{name} is required")
    return text


def _required_horse_no(value):
    if value is None or str(value).strip() == "":
        raise ValueError("prediction horseNo is required")
    try:
        number = int(value)
    except (TypeError, ValueError):
        return str(value).strip()
    return number


def _horse_sort_key(horse_no):
    if isinstance(horse_no, int):
        return (0, horse_no)
    return (1, str(horse_no))


def _round(value):
    return round(float(value), 6) if value is not None else None


def build_parser():
    parser = argparse.ArgumentParser(description="Benchmark one model top pick per HKJC PLACE pool.")
    parser.add_argument("--predictions", required=True, help="versioned runner prediction JSONL")
    parser.add_argument("--races", required=True, help="official raw race JSON file or directory")
    parser.add_argument("--output", required=True, help="benchmark report JSON path")
    parser.add_argument("--split", default="holdout", help="chronological split to settle")
    parser.add_argument("--stake", type=float, default=10.0, help="flat stake per race")
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        predictions = load_prediction_jsonl(args.predictions)
        race_ids = {
            str(row.get("raceId"))
            for row in predictions
            if row.get("split") == args.split and row.get("raceId") is not None
        }
        races = load_official_races(args.races, required_race_ids=race_ids)
        report = benchmark_top_pick_place(
            predictions,
            races,
            split=args.split,
            stake_per_bet=args.stake,
        )
    except (OSError, ValueError, json.JSONDecodeError) as error:
        raise SystemExit(str(error)) from error
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"PLACE benchmark: bets={report['bets']} hits={report['hits']} "
        f"hitRate={report['hitRate']} stake={report['stake']} "
        f"return={report['return']} profit={report['profit']} roi={report['roi']}"
    )
    print(f"Saved report to {output}")


if __name__ == "__main__":
    main()
