#!/usr/bin/env python3
"""Build leakage-safe unordered QIN/QPL pair rows from runner matrices."""

import argparse
import itertools
import json
import math
import sqlite3
from collections import defaultdict
from pathlib import Path


SUPPORTED_POOLS = ("quinella", "quinellaPlace")
REPORT_VERSION = "exotic-pair-matrix-v1"
METADATA_FIELDS = frozenset((
    "raceId", "date", "split", "horseId", "horseNo", "fieldSize",
    "raceNo", "targetWin", "targetPlace",
))
RACE_CONTEXT_FIELDS = (
    "fieldSize", "racecourse", "raceNo", "distance", "raceClass",
    "surface", "going",
)


def build_exotic_pair_matrix(*, runner_rows, dividends, pool):
    """Return symmetric pair features and official pool labels.

    Races without a complete official dividend row for the requested pool are
    excluded rather than silently converted into all-negative training races.
    """
    if pool not in SUPPORTED_POOLS:
        raise ValueError(f"unsupported exotic pool {pool!r}")
    if not isinstance(runner_rows, list) or not runner_rows:
        raise ValueError("runner_rows must be a non-empty list")

    grouped = defaultdict(list)
    for index, row in enumerate(runner_rows, start=1):
        race_id = str(row.get("raceId") or "").strip()
        split = str(row.get("split") or "").strip()
        if not race_id:
            raise ValueError(f"runner row {index} is missing raceId")
        if not split:
            raise ValueError(f"runner row {index} is missing split")
        grouped[race_id].append(row)

    feature_types = _feature_types(runner_rows)
    output_rows = []
    excluded_missing_pool = 0
    positives = 0
    eligible_by_split = defaultdict(int)
    pairs_by_split = defaultdict(int)
    for race_id in sorted(grouped, key=lambda value: _race_sort_key(grouped[value])):
        race_rows = grouped[race_id]
        splits = {str(row.get("split")) for row in race_rows}
        if len(splits) != 1:
            raise ValueError(
                f"race {race_id!r} appears in multiple splits: {', '.join(sorted(splits))}"
            )
        winning_pairs = dividends.get((race_id, pool))
        if not winning_pairs:
            excluded_missing_pool += 1
            continue
        canonical_winners = {_canonical_pair(pair) for pair in winning_pairs}
        runners = sorted(race_rows, key=lambda row: _horse_sort_key(row.get("horseNo")))
        split = next(iter(splits))
        eligible_by_split[split] += 1
        for left, right in itertools.combinations(runners, 2):
            row = _pair_row(left, right, pool=pool, feature_types=feature_types)
            target = int((row["horseNoA"], row["horseNoB"]) in canonical_winners)
            row["targetPair"] = target
            positives += target
            pairs_by_split[split] += 1
            output_rows.append(row)

    return {
        "pool": pool,
        "rows": output_rows,
        "quality": {
            "inputRows": len(runner_rows),
            "inputRaces": len(grouped),
            "eligibleRaces": sum(eligible_by_split.values()),
            "eligibleRacesBySplit": dict(sorted(eligible_by_split.items())),
            "excludedMissingPoolRaces": excluded_missing_pool,
            "pairs": len(output_rows),
            "pairsBySplit": dict(sorted(pairs_by_split.items())),
            "positives": positives,
        },
    }


def load_runner_rows(path):
    """Load a JSONL runner matrix without changing its chronological split."""
    rows = []
    with Path(path).expanduser().open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                raise ValueError(f"runner matrix line {line_number} is not an object")
            rows.append(value)
    if not rows:
        raise ValueError("runner matrix is empty")
    return rows


def load_exotic_dividends(database, pool):
    """Load only official winning pairs for one requested pool."""
    if pool not in SUPPORTED_POOLS:
        raise ValueError(f"unsupported exotic pool {pool!r}")
    database_path = Path(database).expanduser().resolve()
    connection = sqlite3.connect(f"file:{database_path}?mode=ro", uri=True)
    try:
        rows = connection.execute(
            """
            SELECT race_id, combination_json, dividend_per10
            FROM dividends
            WHERE pool_key = ?
            ORDER BY race_id, combination_json
            """,
            (pool,),
        ).fetchall()
    finally:
        connection.close()
    dividends = {}
    for race_id, combination_json, dividend_per10 in rows:
        try:
            combination = json.loads(combination_json)
        except (TypeError, json.JSONDecodeError):
            continue
        try:
            pair = _canonical_pair(combination)
            amount = float(dividend_per10)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(amount) or amount < 0:
            continue
        dividends.setdefault((str(race_id), pool), {})[pair] = amount
    return dividends


def write_exotic_pair_matrix(*, input_path, database, pool, output_path, report_path):
    """Build and persist a pair matrix plus a compact coverage report."""
    runner_rows = load_runner_rows(input_path)
    result = build_exotic_pair_matrix(
        runner_rows=runner_rows,
        dividends=load_exotic_dividends(database, pool),
        pool=pool,
    )
    output = Path(output_path).expanduser()
    report = Path(report_path).expanduser()
    output.parent.mkdir(parents=True, exist_ok=True)
    report.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in result["rows"]) + "\n",
        encoding="utf-8",
    )
    compact = {
        "version": REPORT_VERSION,
        "pool": pool,
        "input": str(Path(input_path).expanduser().resolve()),
        "database": str(Path(database).expanduser().resolve()),
        "matrix": str(output.resolve()),
        "quality": result["quality"],
    }
    report.write_text(json.dumps(compact, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return compact


def build_parser():
    parser = argparse.ArgumentParser(description="Build an unordered QIN/QPL pair matrix.")
    parser.add_argument("--input", required=True, help="runner training matrix JSONL")
    parser.add_argument("--db", required=True, help="SQLite database with official dividends")
    parser.add_argument("--pool", required=True, choices=SUPPORTED_POOLS)
    parser.add_argument("--output", required=True, help="pair matrix JSONL")
    parser.add_argument("--report", required=True, help="compact coverage report JSON")
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    try:
        report = write_exotic_pair_matrix(
            input_path=args.input,
            database=args.db,
            pool=args.pool,
            output_path=args.output,
            report_path=args.report,
        )
    except (OSError, sqlite3.Error, ValueError) as error:
        raise SystemExit(str(error)) from error
    quality = report["quality"]
    print(
        f"{args.pool}: {quality['eligibleRaces']} races, "
        f"{quality['pairs']} pairs, {quality['positives']} positives"
    )
    print(f"Saved pair matrix to {report['matrix']}")


def _pair_row(left, right, *, pool, feature_types):
    left_no = _horse_number(left.get("horseNo"))
    right_no = _horse_number(right.get("horseNo"))
    if right_no < left_no:
        left, right = right, left
        left_no, right_no = right_no, left_no
    output = {
        "raceId": str(left.get("raceId")),
        "date": left.get("date"),
        "split": left.get("split"),
        "poolKey": pool,
        "pairKey": f"{left_no}-{right_no}",
        "horseNoA": left_no,
        "horseNoB": right_no,
    }
    for field in RACE_CONTEXT_FIELDS:
        left_value = left.get(field)
        right_value = right.get(field)
        if left_value != right_value:
            raise ValueError(
                f"race {output['raceId']!r} has inconsistent {field}: "
                f"{left_value!r} != {right_value!r}"
            )
        output[field] = left_value
    for feature, feature_type in feature_types.items():
        if feature_type == "numeric":
            _add_numeric_pair_features(output, feature, left.get(feature), right.get(feature))
        else:
            _add_categorical_pair_features(output, feature, left.get(feature), right.get(feature))
    return output


def _feature_types(rows):
    names = sorted({name for row in rows for name in row if name not in METADATA_FIELDS})
    types = {}
    for name in names:
        if name in RACE_CONTEXT_FIELDS:
            continue
        values = [row.get(name) for row in rows if not _is_missing(row.get(name))]
        types[name] = "numeric" if values and all(_number(value) is not None for value in values) else "categorical"
    return types


def _add_numeric_pair_features(output, name, left, right):
    left_number = _number(left)
    right_number = _number(right)
    output[f"{name}MissingCount"] = int(left_number is None) + int(right_number is None)
    if left_number is None or right_number is None:
        output[f"{name}Low"] = None
        output[f"{name}High"] = None
        output[f"{name}Mean"] = None
        output[f"{name}AbsDiff"] = None
        output[f"{name}Product"] = None
        return
    low, high = sorted((left_number, right_number))
    output[f"{name}Low"] = low
    output[f"{name}High"] = high
    output[f"{name}Mean"] = (low + high) / 2.0
    output[f"{name}AbsDiff"] = high - low
    output[f"{name}Product"] = low * high


def _add_categorical_pair_features(output, name, left, right):
    values = sorted((_category(left), _category(right)))
    output[f"{name}Pair"] = "|".join(values)
    output[f"{name}Same"] = int(values[0] == values[1] and values[0] != "__MISSING__")


def _canonical_pair(pair):
    values = tuple(sorted(_horse_number(value) for value in pair))
    if len(values) != 2 or values[0] == values[1]:
        raise ValueError(f"invalid exotic pair {pair!r}")
    return values


def _horse_number(value):
    try:
        number = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"invalid horse number {value!r}") from error
    if number <= 0 or number != float(value):
        raise ValueError(f"invalid horse number {value!r}")
    return number


def _horse_sort_key(value):
    try:
        return 0, _horse_number(value)
    except ValueError:
        return 1, str(value)


def _race_sort_key(rows):
    first = rows[0]
    return str(first.get("date") or ""), int(first.get("raceNo") or 0), str(first.get("raceId"))


def _number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _is_missing(value):
    return value is None or str(value).strip() == ""


def _category(value):
    return "__MISSING__" if _is_missing(value) else str(value)


if __name__ == "__main__":
    main()
