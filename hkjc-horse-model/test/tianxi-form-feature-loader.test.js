import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  loadTianxiFormFeatureIndex,
  tianxiRunnerFeatureKey,
} from '../src/tianxi-form-feature-loader.js';

describe('Tianxi local form feature loader', () => {
  it('reads only files for local runner codes and reports missing coverage', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-tianxi-form-'));
    const formDir = path.join(tempDir, 'horses', 'form_records');

    try {
      await mkdir(formDir, { recursive: true });
      await writeFile(path.join(formDir, 'form_K390.csv'), csv([
        ['K390', '15/07/26', '1', '51', '1200', '2.1', '0'],
        ['K390', '14/07/26', '2', '50', '1200', '4', '1'],
      ]));
      await writeFile(path.join(formDir, 'form_L001.csv'), csv([
        ['L001', '01/07/26', '4', '45', '1400', '8', '3'],
      ]));
      await writeFile(path.join(formDir, 'form_Z999.csv'), 'not,a,valid,fixture\n');

      const races = [{
        raceId: '2026-07-15-HV-1',
        date: '2026-07-15',
        distance: 1200,
        runners: [
          { horseId: 'HK_2023_K390', horseNo: 1 },
          { horseId: 'L001', horseNo: 2 },
          { horseId: 'M999', horseNo: 3 },
        ],
      }];
      const index = await loadTianxiFormFeatureIndex({
        rootPath: tempDir,
        races,
        checkoutRef: 'test-checkout',
      });

      assert.equal(index.summary.sourceId, 'sleepingarhat-tianxi-database');
      assert.equal(index.summary.checkoutRef, 'test-checkout');
      assert.equal(index.summary.requestedRunnerRows, 3);
      assert.equal(index.summary.uniqueHorseCodes, 3);
      assert.equal(index.summary.sourceFilesRead, 2);
      assert.equal(index.summary.missingHorseCodes, 1);
      assert.equal(index.summary.parsedRows, 3);
      assert.equal(index.summary.eligibleRows, 2);
      assert.equal(index.summary.excludedNotAvailableRows, 1);
      assert.equal(index.summary.availableFeatureRows, 2);
      assert.equal(JSON.stringify(index.summary).includes(tempDir), false);

      const kFeatures = index.featuresByRunner.get(tianxiRunnerFeatureKey(races[0], races[0].runners[0]));
      const lFeatures = index.featuresByRunner.get(tianxiRunnerFeatureKey(races[0], races[0].runners[1]));
      const missingFeatures = index.featuresByRunner.get(tianxiRunnerFeatureKey(races[0], races[0].runners[2]));
      assert.equal(kFeatures.tianxiPriorStarts, 1);
      assert.equal(lFeatures.tianxiPriorStarts, 1);
      assert.equal(missingFeatures.tianxiFormAvailable, 0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

function csv(rows) {
  return [
    'horse_no,date,place,rating,distance_m,win_odds,lbw',
    ...rows.map((row) => row.join(',')),
  ].join('\n');
}
