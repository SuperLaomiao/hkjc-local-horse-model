# HKJC Phase 2 Python Logit Training Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first offline Python-trained model, `logit-runner-v1`, trained from the leakage-safe local training dataset and reported with the same probability metrics as the current heuristic model.

**Architecture:** Keep Node as the orchestration layer and add a small Python `numpy` trainer under `hkjc-horse-model/python/`. The trainer reads `training-dataset.json`, trains a binary runner-level logistic model on train rows, normalizes probabilities within each race, evaluates train/validation/holdout splits, and writes a compact JSON report. The Node CLI gets a `train-model` command that invokes the Python trainer.

**Tech Stack:** Node.js ES modules, built-in `node:test`, Python 3, `numpy`, local JSON training dataset, existing SQLite/data export workflow.

---

## File structure

- Create `hkjc-horse-model/python/train_logit_model.py`
  - Reads training dataset JSON.
  - Extracts numeric features.
  - Trains logistic regression with batch gradient descent and L2 regularization.
  - Normalizes predicted probabilities per race.
  - Exports compact metrics and feature weights.
- Create `hkjc-horse-model/test/train-model-cli.test.js`
  - Builds a tiny training dataset fixture.
  - Runs the Python trainer through the Node CLI.
  - Asserts report shape and split metrics.
- Modify `hkjc-horse-model/src/cli.js`
  - Add `train-model` command.
  - Spawn `python3 hkjc-horse-model/python/train_logit_model.py`.
- Modify `package.json`
  - Add `hkjc:train-model`.
- Modify `.gitignore`
  - Ignore large or repeatedly generated `training-dataset.json`.
  - Keep compact `model-training-report.json` tracked only when intentionally refreshed.
- Modify `README.md` and `hkjc-horse-model/README.md`
  - Document the training command and the fact that this is still paper-mode research.

## Task 1: Add Python logit trainer

**Files:**
- Create: `hkjc-horse-model/python/train_logit_model.py`
- Create: `hkjc-horse-model/test/train-model-cli.test.js`

- [ ] **Step 1: Write the failing CLI test**

Create `hkjc-horse-model/test/train-model-cli.test.js`:

```js
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

describe('train-model CLI', () => {
  it('trains a compact logistic baseline report from a training dataset', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-train-'));
    try {
      const inputPath = path.join(tempDir, 'training-dataset.json');
      const outputPath = path.join(tempDir, 'model-training-report.json');
      await mkdir(tempDir, { recursive: true });
      await writeFile(inputPath, JSON.stringify(trainingFixture(), null, 2), 'utf8');

      const result = spawnSync(process.execPath, [
        'hkjc-horse-model/src/cli.js',
        'train-model',
        '--input',
        inputPath,
        '--output',
        outputPath,
        '--iterations',
        '80',
        '--learningRate',
        '0.15',
      ], {
        cwd: path.resolve(import.meta.dirname, '..', '..'),
        encoding: 'utf8',
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, /Trained model logit-runner-v1/);
      const report = JSON.parse(await readFile(outputPath, 'utf8'));
      assert.equal(report.modelId, 'logit-runner-v1');
      assert.equal(report.metrics.bySplit.train.races, 2);
      assert.equal(report.metrics.bySplit.validation.races, 1);
      assert.equal(report.metrics.bySplit.holdout.races, 1);
      assert.equal(report.features.includes('horseWinRateBefore'), true);
      assert.equal(report.weights.length, report.features.length + 1);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

function trainingFixture() {
  return {
    generatedAt: '2026-07-07T00:00:00.000Z',
    summary: { rows: 8, races: 4 },
    rows: [
      row('r1', '2023-01-01', 'train', 'A', 1, { horseWinRateBefore: 0.4, jockeyWinRateBefore: 0.3, trainerWinRateBefore: 0.2, draw: 1 }),
      row('r1', '2023-01-01', 'train', 'B', 0, { horseWinRateBefore: 0.1, jockeyWinRateBefore: 0.1, trainerWinRateBefore: 0.1, draw: 8 }),
      row('r2', '2023-02-01', 'train', 'C', 1, { horseWinRateBefore: 0.5, jockeyWinRateBefore: 0.4, trainerWinRateBefore: 0.3, draw: 2 }),
      row('r2', '2023-02-01', 'train', 'D', 0, { horseWinRateBefore: 0.05, jockeyWinRateBefore: 0.1, trainerWinRateBefore: 0.1, draw: 9 }),
      row('r3', '2024-01-01', 'validation', 'E', 1, { horseWinRateBefore: 0.45, jockeyWinRateBefore: 0.35, trainerWinRateBefore: 0.25, draw: 3 }),
      row('r3', '2024-01-01', 'validation', 'F', 0, { horseWinRateBefore: 0.08, jockeyWinRateBefore: 0.1, trainerWinRateBefore: 0.1, draw: 10 }),
      row('r4', '2026-01-01', 'holdout', 'G', 1, { horseWinRateBefore: 0.5, jockeyWinRateBefore: 0.35, trainerWinRateBefore: 0.25, draw: 2 }),
      row('r4', '2026-01-01', 'holdout', 'H', 0, { horseWinRateBefore: 0.05, jockeyWinRateBefore: 0.1, trainerWinRateBefore: 0.1, draw: 11 }),
    ],
  };
}

function row(raceId, date, split, horseId, targetWin, features) {
  return {
    raceId,
    date,
    split,
    horseId,
    horseNo: horseId.charCodeAt(0),
    horseName: `Horse ${horseId}`,
    targetWin,
    targetPlace: targetWin,
    fieldSize: 2,
    features: {
      distance: 1200,
      raceClass: 4,
      fieldSize: 2,
      actualWeight: 120,
      horseRunsBefore: 4,
      horsePlacesBefore: 2,
      horsePlaceRateBefore: 0.25,
      jockeyRunsBefore: 10,
      jockeyPlacesBefore: 3,
      jockeyPlaceRateBefore: 0.2,
      trainerRunsBefore: 20,
      trainerPlacesBefore: 5,
      trainerPlaceRateBefore: 0.2,
      distanceSurfaceStartsBefore: 2,
      distanceSurfaceWinRateBefore: 0.1,
      distanceSurfacePlaceRateBefore: 0.2,
      ...features,
    },
  };
}
```

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
node --test hkjc-horse-model/test/train-model-cli.test.js
```

Expected: fail with `Unknown command: train-model`.

- [ ] **Step 3: Create the Python trainer**

Create `hkjc-horse-model/python/train_logit_model.py` with a `main()` function that:

1. Parses `--input`, `--output`, `--iterations`, `--learningRate`, and `--l2`.
2. Loads the dataset JSON.
3. Uses this feature order:

```python
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
]
```

4. Fits standardization statistics on train rows only.
5. Trains logistic regression on train rows only.
6. Scores all rows, then normalizes raw probabilities within each race.
7. Computes Brier, log loss, top-pick win rate, and calibration buckets by split.
8. Writes a compact report with no per-runner prediction rows.

- [ ] **Step 4: Run the Python trainer directly**

Run:

```bash
python3 hkjc-horse-model/python/train_logit_model.py --input hkjc-horse-model/data/processed/training-dataset.json --output hkjc-horse-model/data/processed/model-training-report.json --iterations 120 --learningRate 0.05
```

Expected: exits 0 and writes `model-training-report.json`.

## Task 2: Add Node CLI orchestration

**Files:**
- Modify: `hkjc-horse-model/src/cli.js`
- Modify: `package.json`

- [ ] **Step 1: Add `train-model` command to CLI**

Modify `hkjc-horse-model/src/cli.js`:

- import `spawnSync` from `node:child_process`;
- route `train-model` to a new `trainModelCommand(args)`;
- implement `trainModelCommand(args)` to call:

```js
const result = spawnSync('python3', [
  path.join(projectRoot, 'python', 'train_logit_model.py'),
  '--input', inputPath,
  '--output', outputPath,
  '--iterations', String(args.iterations ?? 160),
  '--learningRate', String(args.learningRate ?? 0.05),
  '--l2', String(args.l2 ?? 0.001),
], { encoding: 'utf8' });
```

Print the Python stdout and throw an error if `result.status !== 0`.

- [ ] **Step 2: Add package script**

Modify `package.json` scripts:

```json
"hkjc:train-model": "node hkjc-horse-model/src/cli.js train-model"
```

- [ ] **Step 3: Run the CLI test**

Run:

```bash
node --test hkjc-horse-model/test/train-model-cli.test.js
```

Expected: pass.

## Task 3: Generate and document the Phase 2 artifact

**Files:**
- Create: `hkjc-horse-model/data/processed/model-training-report.json`
- Modify: `README.md`
- Modify: `hkjc-horse-model/README.md`

- [ ] **Step 1: Run full local training**

Run:

```bash
npm run hkjc:train-model -- --input hkjc-horse-model/data/processed/training-dataset.json --output hkjc-horse-model/data/processed/model-training-report.json --iterations 160 --learningRate 0.05
```

Expected: report contains `modelId: "logit-runner-v1"`.

- [ ] **Step 2: Document the command**

Add to both README files:

```md
Train the first offline Python baseline:

```bash
npm run hkjc:train-model -- --input hkjc-horse-model/data/processed/training-dataset.json --output hkjc-horse-model/data/processed/model-training-report.json
```

This produces `logit-runner-v1`, a paper-mode probability baseline. It is used for comparison and calibration research, not automatic cash betting.
```

- [ ] **Step 3: Run verification**

Run:

```bash
npm test
npm run hkjc:train-model -- --input hkjc-horse-model/data/processed/training-dataset.json --output hkjc-horse-model/data/processed/model-training-report.json --iterations 160 --learningRate 0.05
```

Expected: tests pass and training command exits 0.

- [ ] **Step 4: Commit**

Run:

```bash
git add package.json hkjc-horse-model/src/cli.js hkjc-horse-model/python/train_logit_model.py hkjc-horse-model/test/train-model-cli.test.js hkjc-horse-model/data/processed/model-training-report.json README.md hkjc-horse-model/README.md
git commit -m "Add HKJC Python logit training baseline"
```

## Self-review checklist

- The plan stays within Phase 2 and does not alter cash betting logic.
- The trainer depends only on Python and numpy, both available in the current environment.
- The generated report is compact and can be tracked.
- The large training dataset remains ignored and local-only.
