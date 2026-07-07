# HKJC Training Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first training foundation: deterministic as-of runner feature export from local SQLite plus a baseline model leaderboard for the current heuristic model.

**Architecture:** Keep Node.js as the data/export layer for the first slice. Add a focused `training-dataset` module that converts settled races into leakage-safe runner rows, then add a CLI command and a compact baseline leaderboard JSON. Python model training comes in the next plan after this data contract is proven.

**Tech Stack:** Node.js ES modules, built-in `node:test`, local SQLite via existing `sqlite-store.js`, JSON/JSONL exports, existing rolling model functions.

---

## File structure

- Create `hkjc-horse-model/src/training-dataset.js`
  - Owns as-of runner feature construction, calendar split assignment, and summary counts.
  - Does not read files or databases directly.
- Create `hkjc-horse-model/test/training-dataset.test.js`
  - Tests leakage prevention and split assignment with tiny in-memory races.
- Create `hkjc-horse-model/src/model-leaderboard.js`
  - Owns baseline leaderboard metrics for model outputs.
  - First release compares only the existing heuristic model, but exports a shape that Phase 2 Python models can join.
- Create `hkjc-horse-model/test/model-leaderboard.test.js`
  - Tests Brier score, log loss, calibration buckets, and split metrics with synthetic predictions.
- Modify `hkjc-horse-model/src/cli.js`
  - Add `training-dataset` command.
  - Add `model-leaderboard` command.
- Modify `package.json`
  - Add `hkjc:training-dataset` and `hkjc:model-leaderboard`.
- Modify `README.md` and `hkjc-horse-model/README.md`
  - Document the training export and responsible-use boundary.

## Task 1: Add leakage-safe training dataset builder

**Files:**
- Create: `hkjc-horse-model/src/training-dataset.js`
- Create: `hkjc-horse-model/test/training-dataset.test.js`

- [ ] **Step 1: Write the failing tests**

Create `hkjc-horse-model/test/training-dataset.test.js`:

```js
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildAsOfTrainingRows,
  splitTrainingRows,
  summarizeTrainingRows,
} from '../src/training-dataset.js';

describe('as-of training dataset', () => {
  it('uses only prior races when building runner features', () => {
    const rows = buildAsOfTrainingRows([
      race('2023-12-30-ST-1', '2023-12-30', [
        runner('A', 1, 'J1', 'T1', 1),
        runner('B', 2, 'J2', 'T2', 2),
      ]),
      race('2024-01-07-ST-1', '2024-01-07', [
        runner('A', 1, 'J1', 'T1', 3),
        runner('C', 3, 'J3', 'T3', 1),
      ]),
    ]);

    const firstA = rows.find((row) => row.raceId === '2023-12-30-ST-1' && row.horseId === 'A');
    const secondA = rows.find((row) => row.raceId === '2024-01-07-ST-1' && row.horseId === 'A');
    const secondC = rows.find((row) => row.raceId === '2024-01-07-ST-1' && row.horseId === 'C');

    assert.equal(firstA.features.horseRunsBefore, 0);
    assert.equal(firstA.features.horseWinsBefore, 0);
    assert.equal(firstA.features.jockeyRunsBefore, 0);
    assert.equal(firstA.targetWin, 1);
    assert.equal(firstA.targetPlace, 1);

    assert.equal(secondA.features.horseRunsBefore, 1);
    assert.equal(secondA.features.horseWinsBefore, 1);
    assert.equal(secondA.features.horsePlacesBefore, 1);
    assert.equal(secondA.features.jockeyRunsBefore, 1);
    assert.equal(secondA.features.jockeyWinsBefore, 1);
    assert.equal(secondA.features.trainerRunsBefore, 1);
    assert.equal(secondA.features.trainerWinsBefore, 1);
    assert.equal(secondA.targetWin, 0);
    assert.equal(secondA.targetPlace, 1);

    assert.equal(secondC.features.horseRunsBefore, 0);
    assert.equal(secondC.features.jockeyRunsBefore, 0);
    assert.equal(secondC.targetWin, 1);
  });

  it('assigns fixed calendar splits and summarizes row counts', () => {
    const rows = splitTrainingRows([
      row('2023-12-31', 'a'),
      row('2024-01-01', 'b'),
      row('2025-12-31', 'c'),
      row('2026-01-01', 'd'),
    ]);
    assert.deepEqual(rows.map((item) => item.split), ['train', 'validation', 'validation', 'holdout']);

    const summary = summarizeTrainingRows(rows);
    assert.equal(summary.rows, 4);
    assert.equal(summary.trainRows, 1);
    assert.equal(summary.validationRows, 2);
    assert.equal(summary.holdoutRows, 1);
  });
});

function row(date, horseId) {
  return {
    raceId: `${date}-ST-1`,
    date,
    racecourse: 'ST',
    raceNo: 1,
    horseId,
    targetWin: horseId === 'a' ? 1 : 0,
    targetPlace: 1,
    features: {},
  };
}

function race(raceId, date, runners) {
  return {
    raceId,
    date,
    racecourse: 'ST',
    raceNo: 1,
    distance: 1200,
    surface: 'TURF',
    going: 'GOOD',
    raceClass: 4,
    runners,
  };
}

function runner(horseId, horseNo, jockey, trainer, placing) {
  return {
    horseId,
    horseName: `Horse ${horseId}`,
    horseNo,
    jockey,
    trainer,
    draw: horseNo,
    actualWeight: 120 + horseNo,
    placing,
    lbw: placing === 1 ? 0 : placing,
  };
}
```

- [ ] **Step 2: Run the tests and verify failure**

Run:

```bash
node --test hkjc-horse-model/test/training-dataset.test.js
```

Expected: fail with `Cannot find module .../src/training-dataset.js`.

- [ ] **Step 3: Implement the dataset builder**

Create `hkjc-horse-model/src/training-dataset.js`:

```js
const TRAIN_END = '2023-12-31';
const VALIDATION_END = '2025-12-31';

export function buildAsOfTrainingRows(races, options = {}) {
  const orderedRaces = [...(races ?? [])]
    .filter((race) => race?.status !== 'upcoming')
    .filter((race) => Array.isArray(race.runners) && race.runners.length > 0)
    .sort(compareRaces);
  const placeCutoffForRace = options.placeCutoffForRace ?? defaultPlaceCutoff;
  const state = createAsOfState();
  const rows = [];

  for (const race of orderedRaces) {
    const fieldSize = race.runners.length;
    const placeCutoff = placeCutoffForRace(race);

    for (const runner of race.runners) {
      const horseId = stableId(runner.horseId ?? runner.horseName ?? runner.horseNo);
      const jockeyId = stableId(runner.jockey);
      const trainerId = stableId(runner.trainer);
      const horseStats = state.horses.get(horseId) ?? emptyStats();
      const jockeyStats = state.jockeys.get(jockeyId) ?? emptyStats();
      const trainerStats = state.trainers.get(trainerId) ?? emptyStats();
      const distanceSurfaceStats = state.distanceSurface.get(distanceSurfaceKey(horseId, race)) ?? emptyStats();

      rows.push({
        raceId: race.raceId,
        date: race.date,
        racecourse: race.racecourse,
        raceNo: race.raceNo,
        horseId,
        horseNo: runner.horseNo ?? null,
        horseName: runner.horseName ?? null,
        targetWin: runner.placing === 1 ? 1 : 0,
        targetPlace: Number.isFinite(runner.placing) && runner.placing <= placeCutoff ? 1 : 0,
        fieldSize,
        split: splitForDate(race.date),
        features: {
          racecourse: race.racecourse ?? null,
          distance: numericOrNull(race.distance),
          surface: race.surface ?? null,
          going: race.going ?? null,
          raceClass: numericOrNull(race.raceClass),
          fieldSize,
          draw: numericOrNull(runner.draw),
          actualWeight: numericOrNull(runner.actualWeight),
          horseRunsBefore: horseStats.runs,
          horseWinsBefore: horseStats.wins,
          horsePlacesBefore: horseStats.places,
          horseWinRateBefore: rate(horseStats.wins, horseStats.runs),
          horsePlaceRateBefore: rate(horseStats.places, horseStats.runs),
          horseAverageLbwBefore: horseStats.runs > 0 ? round(horseStats.totalLbw / horseStats.runs, 4) : null,
          daysSinceLastRun: horseStats.lastDate ? daysBetween(horseStats.lastDate, race.date) : null,
          jockeyRunsBefore: jockeyStats.runs,
          jockeyWinsBefore: jockeyStats.wins,
          jockeyPlacesBefore: jockeyStats.places,
          jockeyWinRateBefore: rate(jockeyStats.wins, jockeyStats.runs),
          jockeyPlaceRateBefore: rate(jockeyStats.places, jockeyStats.runs),
          trainerRunsBefore: trainerStats.runs,
          trainerWinsBefore: trainerStats.wins,
          trainerPlacesBefore: trainerStats.places,
          trainerWinRateBefore: rate(trainerStats.wins, trainerStats.runs),
          trainerPlaceRateBefore: rate(trainerStats.places, trainerStats.runs),
          distanceSurfaceStartsBefore: distanceSurfaceStats.runs,
          distanceSurfaceWinRateBefore: rate(distanceSurfaceStats.wins, distanceSurfaceStats.runs),
          distanceSurfacePlaceRateBefore: rate(distanceSurfaceStats.places, distanceSurfaceStats.runs),
        },
      });
    }

    updateStateWithRace(state, race, placeCutoff);
  }

  return rows;
}

export function splitTrainingRows(rows) {
  return (rows ?? []).map((row) => ({
    ...row,
    split: splitForDate(row.date),
  }));
}

export function summarizeTrainingRows(rows) {
  const items = rows ?? [];
  return {
    rows: items.length,
    races: new Set(items.map((row) => row.raceId)).size,
    trainRows: items.filter((row) => row.split === 'train').length,
    validationRows: items.filter((row) => row.split === 'validation').length,
    holdoutRows: items.filter((row) => row.split === 'holdout').length,
    generatedAt: new Date().toISOString(),
  };
}

function updateStateWithRace(state, race, placeCutoff) {
  for (const runner of race.runners) {
    const horseId = stableId(runner.horseId ?? runner.horseName ?? runner.horseNo);
    const jockeyId = stableId(runner.jockey);
    const trainerId = stableId(runner.trainer);
    const win = runner.placing === 1 ? 1 : 0;
    const place = Number.isFinite(runner.placing) && runner.placing <= placeCutoff ? 1 : 0;
    updateStats(state.horses, horseId, race.date, runner, win, place);
    updateStats(state.jockeys, jockeyId, race.date, runner, win, place);
    updateStats(state.trainers, trainerId, race.date, runner, win, place);
    updateStats(state.distanceSurface, distanceSurfaceKey(horseId, race), race.date, runner, win, place);
  }
}

function updateStats(map, key, date, runner, win, place) {
  if (!key) return;
  const current = map.get(key) ?? emptyStats();
  map.set(key, {
    runs: current.runs + 1,
    wins: current.wins + win,
    places: current.places + place,
    totalLbw: current.totalLbw + Number(runner.lbw ?? 0),
    lastDate: date,
  });
}

function createAsOfState() {
  return {
    horses: new Map(),
    jockeys: new Map(),
    trainers: new Map(),
    distanceSurface: new Map(),
  };
}

function emptyStats() {
  return { runs: 0, wins: 0, places: 0, totalLbw: 0, lastDate: null };
}

function defaultPlaceCutoff(race) {
  const fieldSize = race.runners?.length ?? 0;
  return fieldSize > 0 && fieldSize <= 6 ? 2 : 3;
}

function splitForDate(date) {
  if (date <= TRAIN_END) return 'train';
  if (date <= VALIDATION_END) return 'validation';
  return 'holdout';
}

function compareRaces(a, b) {
  return String(a.date).localeCompare(String(b.date))
    || String(a.racecourse).localeCompare(String(b.racecourse))
    || Number(a.raceNo ?? 0) - Number(b.raceNo ?? 0);
}

function distanceSurfaceKey(horseId, race) {
  return [horseId, race.racecourse, race.distance, race.surface].map((value) => value ?? '').join('|');
}

function stableId(value) {
  if (value == null || value === '') return '';
  return String(value);
}

function numericOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rate(numerator, denominator) {
  return denominator > 0 ? round(numerator / denominator, 4) : 0;
}

function daysBetween(from, to) {
  const ms = Date.parse(to) - Date.parse(from);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round(ms / 86400000));
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(Number(value ?? 0) * factor) / factor;
}
```

- [ ] **Step 4: Run the dataset tests and verify pass**

Run:

```bash
node --test hkjc-horse-model/test/training-dataset.test.js
```

Expected: pass.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add hkjc-horse-model/src/training-dataset.js hkjc-horse-model/test/training-dataset.test.js
git commit -m "Add HKJC as-of training dataset builder"
```

## Task 2: Add CLI export for the training dataset

**Files:**
- Modify: `hkjc-horse-model/src/cli.js`
- Modify: `package.json`
- Modify: `hkjc-horse-model/test/sqlite-store.test.js`

- [ ] **Step 1: Write the failing CLI test**

In `hkjc-horse-model/test/sqlite-store.test.js`, add this test after the existing dashboard-db test:

```js
  it('exports an as-of training dataset from the local SQLite database', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-sqlite-'));
    try {
      const rawDir = path.join(tempDir, 'raw');
      const dbPath = path.join(tempDir, 'hkjc.sqlite');
      const outputPath = path.join(tempDir, 'training-dataset.json');
      await mkdir(rawDir, { recursive: true });
      await writeFile(path.join(rawDir, '2026-07-04-ST.json'), JSON.stringify([settledRace()], null, 2), 'utf8');
      syncRaceFilesToDatabase({ dbPath, inputPath: rawDir, sourceKind: 'raw' });

      const result = spawnSync(process.execPath, [
        'hkjc-horse-model/src/cli.js',
        'training-dataset',
        '--db',
        dbPath,
        '--output',
        outputPath,
      ], {
        cwd: path.resolve(import.meta.dirname, '..', '..'),
        encoding: 'utf8',
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /Training dataset from SQLite/);
      const payload = JSON.parse(await readFile(outputPath, 'utf8'));
      assert.equal(payload.summary.rows, 3);
      assert.equal(payload.summary.races, 1);
      assert.equal(payload.rows[0].raceId, '2026-07-04-ST-1');
      assert.equal(payload.rows[0].split, 'holdout');
      assert.equal(payload.rows[0].features.horseRunsBefore, 0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
node --test hkjc-horse-model/test/sqlite-store.test.js
```

Expected: fail with `Unknown command: training-dataset`.

- [ ] **Step 3: Add CLI imports and command routing**

Modify `hkjc-horse-model/src/cli.js` imports:

```js
import {
  buildAsOfTrainingRows,
  summarizeTrainingRows,
} from './training-dataset.js';
```

Add command routing in `main(argv)` before `market-snapshot`:

```js
  if (command === 'training-dataset') {
    await trainingDatasetCommand(args);
    return;
  }
```

Add the command function near `dashboardDbCommand`:

```js
async function trainingDatasetCommand(args) {
  const dbPath = path.resolve(args.db ?? sqliteDbPath);
  const settledRaces = loadRacesFromDatabase({ dbPath, status: 'settled' });
  const rows = buildAsOfTrainingRows(settledRaces);
  const summary = summarizeTrainingRows(rows);
  const outputPath = path.resolve(args.output ?? path.join(processedDataDir, 'training-dataset.json'));

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeJson(outputPath, {
    generatedAt: summary.generatedAt,
    dataSource: {
      source: 'sqlite',
      database: publicDatabaseLabel(dbPath),
      settledRaces: settledRaces.length,
    },
    summary,
    rows,
  });

  console.log(`Training dataset from SQLite: ${summary.rows} runner rows, ${summary.races} races`);
  console.log(`Saved training dataset to ${outputPath}`);
}
```

Update `printHelp()` command list:

```text
  training-dataset --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/processed/training-dataset.json
```

- [ ] **Step 4: Add package script**

Modify `package.json` scripts:

```json
"hkjc:training-dataset": "node hkjc-horse-model/src/cli.js training-dataset"
```

Keep the existing scripts unchanged.

- [ ] **Step 5: Run the CLI tests and verify pass**

Run:

```bash
node --test hkjc-horse-model/test/sqlite-store.test.js
```

Expected: pass.

- [ ] **Step 6: Run the real local export**

Run:

```bash
npm run hkjc:training-dataset -- --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/processed/training-dataset.json
```

Expected output includes `Training dataset from SQLite`. The generated JSON should have more than 100,000 runner rows in this workspace.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add package.json hkjc-horse-model/src/cli.js hkjc-horse-model/test/sqlite-store.test.js hkjc-horse-model/data/processed/training-dataset.json
git commit -m "Export HKJC as-of training dataset"
```

## Task 3: Add baseline model leaderboard metrics

**Files:**
- Create: `hkjc-horse-model/src/model-leaderboard.js`
- Create: `hkjc-horse-model/test/model-leaderboard.test.js`

- [ ] **Step 1: Write the failing metrics tests**

Create `hkjc-horse-model/test/model-leaderboard.test.js`:

```js
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildModelLeaderboard,
  scoreProbabilityRows,
} from '../src/model-leaderboard.js';

describe('model leaderboard', () => {
  it('scores probability quality by split', () => {
    const scored = scoreProbabilityRows([
      prediction('r1', 'train', 0.8, 1),
      prediction('r1', 'train', 0.2, 0),
      prediction('r2', 'validation', 0.7, 0),
      prediction('r2', 'validation', 0.3, 1),
      prediction('r3', 'holdout', 0.6, 1),
      prediction('r3', 'holdout', 0.4, 0),
    ]);

    assert.equal(scored.overall.rows, 6);
    assert.equal(scored.bySplit.train.rows, 2);
    assert.equal(scored.bySplit.validation.rows, 2);
    assert.equal(scored.bySplit.holdout.rows, 2);
    assert.equal(scored.bySplit.train.topPickWins, 1);
    assert.equal(scored.bySplit.validation.topPickWins, 0);
    assert.equal(scored.bySplit.holdout.topPickWins, 1);
    assert.equal(scored.bySplit.train.brierScore < scored.bySplit.validation.brierScore, true);
  });

  it('builds a leaderboard sorted by holdout then validation log loss', () => {
    const leaderboard = buildModelLeaderboard([
      {
        modelId: 'weak',
        label: 'Weak',
        rows: [
          prediction('r1', 'validation', 0.51, 1),
          prediction('r2', 'holdout', 0.51, 0),
        ],
      },
      {
        modelId: 'strong',
        label: 'Strong',
        rows: [
          prediction('r1', 'validation', 0.8, 1),
          prediction('r2', 'holdout', 0.2, 0),
        ],
      },
    ]);

    assert.equal(leaderboard.models[0].modelId, 'strong');
    assert.equal(leaderboard.models[0].status, 'candidate');
    assert.equal(leaderboard.models[1].status, 'baseline');
  });
});

function prediction(raceId, split, probability, targetWin) {
  return {
    raceId,
    split,
    horseId: `${raceId}-${probability}`,
    probability,
    targetWin,
  };
}
```

- [ ] **Step 2: Run the tests and verify failure**

Run:

```bash
node --test hkjc-horse-model/test/model-leaderboard.test.js
```

Expected: fail with `Cannot find module .../src/model-leaderboard.js`.

- [ ] **Step 3: Implement leaderboard metrics**

Create `hkjc-horse-model/src/model-leaderboard.js`:

```js
const SPLITS = ['train', 'validation', 'holdout'];

export function buildModelLeaderboard(models, options = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const scoredModels = (models ?? []).map((model) => ({
    modelId: model.modelId,
    label: model.label,
    status: 'baseline',
    metrics: scoreProbabilityRows(model.rows),
  }));

  scoredModels.sort(compareModels);
  scoredModels.forEach((model, index) => {
    model.status = index === 0 ? 'candidate' : 'baseline';
  });

  return {
    generatedAt,
    selectionMetric: 'holdout.logLoss then validation.logLoss',
    models: scoredModels,
  };
}

export function scoreProbabilityRows(rows) {
  const items = (rows ?? []).filter((row) => Number.isFinite(Number(row.probability)));
  return {
    overall: summarizeRows(items),
    bySplit: Object.fromEntries(SPLITS.map((split) => [
      split,
      summarizeRows(items.filter((row) => row.split === split)),
    ])),
    calibration: buildCalibration(items),
  };
}

function summarizeRows(rows) {
  const races = groupByRace(rows);
  const topPicks = [...races.values()].map((raceRows) => (
    [...raceRows].sort((a, b) => Number(b.probability) - Number(a.probability))[0]
  )).filter(Boolean);
  const topPickWins = topPicks.filter((row) => Number(row.targetWin) === 1).length;
  const brierTotal = rows.reduce((sum, row) => {
    const probability = clampProbability(row.probability);
    const outcome = Number(row.targetWin) === 1 ? 1 : 0;
    return sum + (probability - outcome) ** 2;
  }, 0);
  const logLossTotal = rows.reduce((sum, row) => {
    const probability = clampProbability(row.probability);
    const outcome = Number(row.targetWin) === 1 ? 1 : 0;
    return sum - (outcome * Math.log(probability) + (1 - outcome) * Math.log(1 - probability));
  }, 0);

  return {
    rows: rows.length,
    races: races.size,
    brierScore: rows.length ? round(brierTotal / rows.length, 6) : null,
    logLoss: rows.length ? round(logLossTotal / rows.length, 6) : null,
    topPickWins,
    topPickWinRate: topPicks.length ? round(topPickWins / topPicks.length, 6) : null,
  };
}

function buildCalibration(rows) {
  const buckets = [
    { label: '<10%', min: 0, max: 0.1 },
    { label: '10-15%', min: 0.1, max: 0.15 },
    { label: '15-20%', min: 0.15, max: 0.2 },
    { label: '20%+', min: 0.2, max: 1.000001 },
  ];

  return buckets.map((bucket) => {
    const bucketRows = rows.filter((row) => {
      const probability = Number(row.probability);
      return probability >= bucket.min && probability < bucket.max;
    });
    const predicted = bucketRows.reduce((sum, row) => sum + Number(row.probability), 0);
    const actual = bucketRows.reduce((sum, row) => sum + (Number(row.targetWin) === 1 ? 1 : 0), 0);
    return {
      label: bucket.label,
      rows: bucketRows.length,
      averageProbability: bucketRows.length ? round(predicted / bucketRows.length, 6) : null,
      actualWinRate: bucketRows.length ? round(actual / bucketRows.length, 6) : null,
      calibrationGap: bucketRows.length ? round(actual / bucketRows.length - predicted / bucketRows.length, 6) : null,
    };
  });
}

function compareModels(a, b) {
  const aHoldout = metricOrInfinity(a.metrics.bySplit.holdout.logLoss);
  const bHoldout = metricOrInfinity(b.metrics.bySplit.holdout.logLoss);
  if (aHoldout !== bHoldout) return aHoldout - bHoldout;
  const aValidation = metricOrInfinity(a.metrics.bySplit.validation.logLoss);
  const bValidation = metricOrInfinity(b.metrics.bySplit.validation.logLoss);
  return aValidation - bValidation;
}

function groupByRace(rows) {
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.raceId)) grouped.set(row.raceId, []);
    grouped.get(row.raceId).push(row);
  }
  return grouped;
}

function metricOrInfinity(value) {
  return Number.isFinite(Number(value)) ? Number(value) : Infinity;
}

function clampProbability(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.min(0.999999, Math.max(0.000001, number));
}

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}
```

- [ ] **Step 4: Run the leaderboard tests and verify pass**

Run:

```bash
node --test hkjc-horse-model/test/model-leaderboard.test.js
```

Expected: pass.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add hkjc-horse-model/src/model-leaderboard.js hkjc-horse-model/test/model-leaderboard.test.js
git commit -m "Add HKJC model leaderboard metrics"
```

## Task 4: Export current heuristic model predictions into the leaderboard

**Files:**
- Modify: `hkjc-horse-model/src/cli.js`
- Modify: `hkjc-horse-model/src/model-leaderboard.js`
- Modify: `hkjc-horse-model/test/sqlite-store.test.js`

- [ ] **Step 1: Write the failing CLI test**

In `hkjc-horse-model/test/sqlite-store.test.js`, add:

```js
  it('exports a model leaderboard from settled SQLite races', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-sqlite-'));
    try {
      const rawDir = path.join(tempDir, 'raw');
      const dbPath = path.join(tempDir, 'hkjc.sqlite');
      const outputPath = path.join(tempDir, 'model-leaderboard.json');
      await mkdir(rawDir, { recursive: true });
      await writeFile(path.join(rawDir, '2026-07-04-ST.json'), JSON.stringify([settledRace()], null, 2), 'utf8');
      syncRaceFilesToDatabase({ dbPath, inputPath: rawDir, sourceKind: 'raw' });

      const result = spawnSync(process.execPath, [
        'hkjc-horse-model/src/cli.js',
        'model-leaderboard',
        '--db',
        dbPath,
        '--output',
        outputPath,
      ], {
        cwd: path.resolve(import.meta.dirname, '..', '..'),
        encoding: 'utf8',
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /Model leaderboard from SQLite/);
      const payload = JSON.parse(await readFile(outputPath, 'utf8'));
      assert.equal(payload.models[0].modelId, 'heuristic-current');
      assert.equal(payload.models[0].metrics.overall.rows, 3);
      assert.equal(payload.dataSource.database, 'hkjc.sqlite');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
node --test hkjc-horse-model/test/sqlite-store.test.js
```

Expected: fail with `Unknown command: model-leaderboard`.

- [ ] **Step 3: Add helper to convert rolling ledger into prediction rows**

Modify `hkjc-horse-model/src/model-leaderboard.js` to export:

```js
export function predictionRowsFromLedger(ledger) {
  return (ledger ?? []).flatMap((entry) => {
    const split = splitForDate(entry.date);
    return (entry.forecast?.predictions ?? []).map((runner) => ({
      raceId: entry.raceId,
      date: entry.date,
      split,
      horseId: String(runner.horseId ?? runner.horseNo ?? runner.horseName),
      horseNo: runner.horseNo ?? null,
      horseName: runner.horseName ?? null,
      probability: Number(runner.probability),
      targetWin: entry.settlement?.winnerHorseId === runner.horseId ? 1 : 0,
    }));
  });
}

function splitForDate(date) {
  if (date <= '2023-12-31') return 'train';
  if (date <= '2025-12-31') return 'validation';
  return 'holdout';
}
```

`settleForecast()` in `hkjc-horse-model/src/model.js` emits the winning runner as `settlement.winnerHorseId`; use that field for `targetWin`.

- [ ] **Step 4: Add CLI command**

Modify `hkjc-horse-model/src/cli.js` imports:

```js
import {
  buildModelLeaderboard,
  predictionRowsFromLedger,
} from './model-leaderboard.js';
import { buildRollingPredictionLedger } from './model.js';
```

If `buildRollingPredictionLedger` is already imported through the grouped model import, add it to that import list instead of creating a second import.

Add command routing:

```js
  if (command === 'model-leaderboard') {
    await modelLeaderboardCommand(args);
    return;
  }
```

Add command function:

```js
async function modelLeaderboardCommand(args) {
  const dbPath = path.resolve(args.db ?? sqliteDbPath);
  const settledRaces = loadRacesFromDatabase({ dbPath, status: 'settled' });
  const ledger = buildRollingPredictionLedger(settledRaces, {
    minEdge: args.minEdge == null ? 0 : Number(args.minEdge),
    minProbability: args.minProbability == null ? 0.15 : Number(args.minProbability),
  });
  const predictionRows = predictionRowsFromLedger(ledger.entries ?? ledger);
  const leaderboard = buildModelLeaderboard([
    {
      modelId: 'heuristic-current',
      label: 'Current heuristic rolling model',
      rows: predictionRows,
    },
  ]);
  const outputPath = path.resolve(args.output ?? path.join(processedDataDir, 'model-leaderboard.json'));

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeJson(outputPath, {
    ...leaderboard,
    dataSource: {
      source: 'sqlite',
      database: publicDatabaseLabel(dbPath),
      settledRaces: settledRaces.length,
    },
  });

  console.log(`Model leaderboard from SQLite: ${settledRaces.length} settled races`);
  console.log(`Saved model leaderboard to ${outputPath}`);
}
```

Add help line:

```text
  model-leaderboard --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/processed/model-leaderboard.json
```

- [ ] **Step 5: Add package script**

Modify `package.json` scripts:

```json
"hkjc:model-leaderboard": "node hkjc-horse-model/src/cli.js model-leaderboard"
```

- [ ] **Step 6: Run tests and real export**

Run:

```bash
node --test hkjc-horse-model/test/model-leaderboard.test.js hkjc-horse-model/test/sqlite-store.test.js
npm run hkjc:model-leaderboard -- --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/processed/model-leaderboard.json
```

Expected:

- tests pass,
- command writes `hkjc-horse-model/data/processed/model-leaderboard.json`,
- output mentions `Model leaderboard from SQLite`.

- [ ] **Step 7: Commit Task 4**

Run:

```bash
git add package.json hkjc-horse-model/src/cli.js hkjc-horse-model/src/model-leaderboard.js hkjc-horse-model/test/sqlite-store.test.js hkjc-horse-model/data/processed/model-leaderboard.json
git commit -m "Export HKJC baseline model leaderboard"
```

## Task 5: Document the training workflow

**Files:**
- Modify: `README.md`
- Modify: `hkjc-horse-model/README.md`

- [ ] **Step 1: Update root README**

Add this section after the SQLite workflow section in `README.md`:

````md
## Local model training exports

The mobile dashboard intentionally stays lightweight. Full historical modelling runs locally from SQLite.

Generate leakage-safe runner rows:

```bash
npm run hkjc:training-dataset -- --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/processed/training-dataset.json
```

Generate the current baseline model leaderboard:

```bash
npm run hkjc:model-leaderboard -- --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/processed/model-leaderboard.json
```

The first leaderboard is a baseline for research. It should not be treated as proof of a betting edge.
````

- [ ] **Step 2: Update model README**

Add this section after the existing calibration/backtest content in `hkjc-horse-model/README.md`:

````md
## Training dataset and model leaderboard

`training-dataset` exports one row per runner using only races seen earlier in chronological order. This protects model training from post-race leakage.

```bash
npm run hkjc:training-dataset -- --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/processed/training-dataset.json
```

`model-leaderboard` scores the current heuristic model by split:

- train: through 2023-12-31
- validation: 2024-01-01 through 2025-12-31
- holdout: 2026-01-01 onward

```bash
npm run hkjc:model-leaderboard -- --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/processed/model-leaderboard.json
```

Promotion to real-money recommendation logic requires calibration, turnover, drawdown, and market-price gates. Historical ROI alone is not enough.
````

- [ ] **Step 3: Run full tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit Task 5**

Run:

```bash
git add README.md hkjc-horse-model/README.md
git commit -m "Document HKJC training exports"
```

## Task 6: Final verification and handoff

**Files:**
- No source changes.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm test
npm run hkjc:training-dataset -- --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/processed/training-dataset.json
npm run hkjc:model-leaderboard -- --db hkjc-horse-model/data/hkjc.sqlite --output hkjc-horse-model/data/processed/model-leaderboard.json
```

Expected:

- `npm test` exits 0.
- training dataset command exits 0.
- model leaderboard command exits 0.

- [ ] **Step 2: Inspect generated report sizes**

Run:

```bash
node -e "const fs=require('fs'); for (const p of ['hkjc-horse-model/data/processed/training-dataset.json','hkjc-horse-model/data/processed/model-leaderboard.json']) { const d=JSON.parse(fs.readFileSync(p,'utf8')); console.log(p, fs.statSync(p).size, d.summary ?? d.models?.map(m=>({modelId:m.modelId,status:m.status}))); }"
```

Expected:

- training dataset JSON has a `summary` object,
- leaderboard JSON has at least the `heuristic-current` model.

- [ ] **Step 3: Commit generated artifacts if they are intentionally tracked**

Run:

```bash
git status --short
```

If `hkjc-horse-model/data/processed/training-dataset.json` is too large for git, do not commit it. Commit only the CLI, tests, docs, and a small `model-leaderboard.json` if it is compact enough for the repo. Add generated large training exports to `.gitignore` if they appear as accidental churn.

- [ ] **Step 4: Push**

Run:

```bash
git push
```

Expected: push succeeds to `origin/main`.

## Self-review checklist

- The plan covers the Phase 1 scope in the design: leakage-safe data export and baseline leaderboard.
- The plan does not modify live betting recommendations.
- The plan creates tests before implementation for every new behavior.
- The first model leaderboard is deliberately limited to the current heuristic model; Python logistic/GBM training is the next implementation plan after the data contract is verified.
- The plan keeps mobile data lightweight and uses SQLite as the local compute source.
