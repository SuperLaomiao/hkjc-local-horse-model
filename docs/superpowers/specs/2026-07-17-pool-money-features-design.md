# Pool Money Features Design

## Goal

Convert pre-race WIN, PLACE, QIN, and QPL odds plus pool-investment snapshots into leakage-safe runner features for model research. The feature layer must remain optional because historical pool coverage is incomplete, and it must never make cash-mode or ROI claims by itself.

## Chosen approach

Use one pure JavaScript feature builder between SQLite snapshot loading and the existing training-row builder. This keeps the calculations independently testable and lets the same logic work with SQLite, fixtures, or future live imports. The training CLI will merge these features with the existing runner odds features; missing snapshots will produce explicit availability flags and null numeric values instead of dropping a runner.

Alternatives considered:

- SQL-only aggregation would reduce JavaScript code, but consistent book-level selection, exotic-combination parsing, and unit testing would be harder.
- Python-only feature engineering would be convenient for model experiments, but it would duplicate the current JavaScript export contract and weaken dashboard/replay reuse.
- A pure JavaScript adapter offers the clearest source boundary and is the selected design.

## Snapshot selection and leakage controls

- Supported windows are T60, T30, T10, and T3, using the same minute ranges as existing odds features.
- A market book is selected as a whole by `(raceId, pool, capturedAt)` and nearest distance to the target minute. Combinations from different capture times are never mixed into one book.
- Pool investment is selected independently from the nearest in-window pool snapshot, preferring an exact capture-time match with the selected odds book.
- Negative `minutesToPost`, dividends, results, placing, and post-race records are excluded.
- Payout rate is a configurable research constant, defaulting to `0.825`; takeout is represented as `1 - payoutRate`. It is context, not a measured live deduction.

## Feature contract

Each runner receives features for each supported pool/window. Common fields include:

- availability flag;
- pool investment;
- normalized market share or exotic involvement share;
- estimated money represented by that share;
- crowding ratio versus an equal-share baseline;
- book concentration (HHI);
- odds-book overround;
- configured payout and takeout rates.

WIN and PLACE use the selected runner combination directly. QIN and QPL sum the normalized shares of every pair containing the runner. For pair pools, the equal-share involvement baseline is `2 / uniqueRunnerCount`.

Pool-level investment movement is attached to every runner in the race for T60-to-T30, T30-to-T10, and T10-to-T3 when both endpoints exist. Missing endpoints return null.

## Integration and reporting

`loadPoolMoneyFeatures` will read races and market snapshots from SQLite, invoke the pure builder, and return `featuresByRunner` plus coverage diagnostics. The training CLI will merge its output into the existing market feature map and publish only sanitized summary counts. The Python baseline will include the new numeric fields, with missing values continuing to map to zero after availability flags preserve missingness information.

The real database smoke check must report actual pool coverage. Zero coverage is a valid result and must not be represented as a model gain.

## Verification

- Unit tests cover WIN share/money/concentration, QIN runner involvement, missing pools, post-race exclusion, coherent book selection, and pool movement.
- SQLite integration tests prove snapshots become runner features.
- Training-row tests prove missing pool data does not remove or invalidate rows.
- Focused tests run after each red-green cycle, followed by the complete `npm test` suite.

