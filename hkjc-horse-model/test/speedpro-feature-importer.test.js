import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  loadSpeedproFeatureIndex,
  speedproRunnerFeatureKey,
} from '../src/speedpro-feature-importer.js';

describe('SpeedPRO feature importer', () => {
  it('rejects a source whose latest update time is after the target race post time', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-speedpro-'));
    try {
      const sourceDir = path.join(tempDir, 'speedpro', 'data');
      await mkdir(sourceDir, { recursive: true });
      await writeFile(
        path.join(sourceDir, '2026-07-04_ST.json'),
        JSON.stringify({
          racedate: '2026-07-04',
          venue: 'ST',
          scraped_at: '2026-07-04T07:00:00.000Z',
          lastupdatetime: '2026-07-04 04:05 PM',
          races: [{
            raceno: 1,
            raceinfo_eng: { PostTime: '4:00 PM' },
            energy: [{ brandno: 'L245', speedproenergy: '99' }],
            formguide: [],
          }],
        }),
        'utf8',
      );
      const race = {
        raceId: '2026-07-04-ST-1',
        date: '2026-07-04',
        racecourse: 'ST',
        raceNo: 1,
        startTime: '16:00',
        distance: 1200,
        runners: [{ horseId: 'HK_2025_L245', horseNo: 2 }],
      };

      const result = await loadSpeedproFeatureIndex({ rootPath: tempDir, races: [race] });
      const features = result.featuresByRunner.get(speedproRunnerFeatureKey(race, race.runners[0]));

      assert.equal(features.speedproAvailable, 0);
      assert.equal(result.summary.availableFeatureRows, 0);
      assert.equal(result.summary.excludedPostTimeSnapshotRunnerRows, 1);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('fails closed when a present source timestamp cannot be parsed', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-speedpro-'));
    try {
      await writeMeeting(tempDir, {
        scraped_at: '2026-07-04T07:00:00.000Z',
        lastupdatetime: 'updated after the race but malformed',
      });
      const race = targetRace({ startTime: '16:00' });

      const result = await loadSpeedproFeatureIndex({ rootPath: tempDir, races: [race] });

      assert.equal(result.summary.availableFeatureRows, 0);
      assert.equal(result.summary.excludedMissingSnapshotTimeRunnerRows, 1);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('interprets a timezone-free full race datetime as Hong Kong local time', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-speedpro-'));
    try {
      await writeMeeting(tempDir, {
        scraped_at: '2026-07-04T08:02:00.000Z',
      });
      const race = targetRace({ startTime: '2026-07-04T16:00:00' });

      const result = await loadSpeedproFeatureIndex({ rootPath: tempDir, races: [race] });

      assert.equal(result.summary.availableFeatureRows, 0);
      assert.equal(result.summary.excludedPostTimeSnapshotRunnerRows, 1);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects incomplete, impossible, and invalid-clock source timestamps', async () => {
    const cases = [
      { scraped_at: '2026-07-04Z' },
      { scraped_at: '2026-02-31T07:00:00Z' },
      { lastupdatetime: '2026-07-04 13:00 PM' },
    ];

    for (const timestampFields of cases) {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-speedpro-'));
      try {
        await writeMeeting(tempDir, timestampFields);
        const result = await loadSpeedproFeatureIndex({
          rootPath: tempDir,
          races: [targetRace({ startTime: '16:00' })],
        });

        assert.equal(result.summary.availableFeatureRows, 0, JSON.stringify(timestampFields));
        assert.equal(result.summary.excludedMissingSnapshotTimeRunnerRows, 1);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    }
  });

  it('rejects a full race datetime whose Hong Kong date differs from the race date', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-speedpro-'));
    try {
      await writeMeeting(tempDir, {
        scraped_at: '2026-07-04T09:00:00.000Z',
      });
      const race = targetRace({ startTime: '2026-07-05T16:00:00' });

      const result = await loadSpeedproFeatureIndex({ rootPath: tempDir, races: [race] });

      assert.equal(result.summary.availableFeatureRows, 0);
      assert.equal(result.summary.excludedMissingCutoffRunnerRows, 1);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('records observed-at/source/identity provenance and separates cohort coverage', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-speedpro-'));
    try {
      const races = [
        targetRace({ date: '2023-12-30', startTime: '16:00' }),
        targetRace({ date: '2024-07-04', startTime: '16:00' }),
        targetRace({ date: '2026-07-04', startTime: '16:00' }),
      ];
      for (const race of races) await writeMeetingForRace(tempDir, race);

      const result = await loadSpeedproFeatureIndex({
        rootPath: tempDir,
        races,
        prospectiveFreezeDate: '2026-07-01',
      });
      const prospectiveRace = races.at(-1);
      const provenance = result.provenanceByRunner.get(
        speedproRunnerFeatureKey(prospectiveRace, prospectiveRace.runners[0]),
      );

      assert.equal(provenance.sourceId, 'sleepingarhat-tianxi-speedpro');
      assert.equal(provenance.observedAt, '2026-07-04T07:00:00.000Z');
      assert.equal(provenance.horseCode, 'L245');
      assert.equal(provenance.identityMatched, true);
      assert.deepEqual(result.summary.coverageByCohort.train, coverage(1, 1));
      assert.deepEqual(result.summary.coverageByCohort.validation, coverage(1, 1));
      assert.deepEqual(result.summary.coverageByCohort.holdout, coverage(0, 0));
      assert.deepEqual(result.summary.coverageByCohort.prospective, coverage(1, 1));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects a source runner that does not match the requested horse identity', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-speedpro-'));
    try {
      const race = targetRace({ date: '2026-07-04', startTime: '16:00' });
      await writeMeetingForRace(tempDir, race, { brandNo: 'A999' });

      const result = await loadSpeedproFeatureIndex({ rootPath: tempDir, races: [race] });
      const key = speedproRunnerFeatureKey(race, race.runners[0]);

      assert.equal(result.featuresByRunner.get(key).speedproAvailable, 0);
      assert.equal(result.provenanceByRunner.get(key), null);
      assert.equal(result.summary.excludedIdentityMismatchRunnerRows, 1);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

async function writeMeeting(rootPath, timestampFields) {
  const sourceDir = path.join(rootPath, 'speedpro', 'data');
  await mkdir(sourceDir, { recursive: true });
  await writeFile(
    path.join(sourceDir, '2026-07-04_ST.json'),
    JSON.stringify({
      racedate: '2026-07-04',
      venue: 'ST',
      ...timestampFields,
      races: [{
        raceno: 1,
        raceinfo_eng: { PostTime: '4:00 PM' },
        energy: [{ brandno: 'L245', speedproenergy: '99' }],
        formguide: [],
      }],
    }),
    'utf8',
  );
}

async function writeMeetingForRace(rootPath, race, { brandNo = 'L245' } = {}) {
  const sourceDir = path.join(rootPath, 'speedpro', 'data');
  await mkdir(sourceDir, { recursive: true });
  await writeFile(
    path.join(sourceDir, `${race.date}_ST.json`),
    JSON.stringify({
      racedate: race.date,
      venue: 'ST',
      scraped_at: `${race.date}T07:00:00.000Z`,
      races: [{
        raceno: 1,
        raceinfo_eng: { PostTime: '4:00 PM' },
        energy: [{ brandno: brandNo, speedproenergy: '99' }],
        formguide: [],
      }],
    }),
    'utf8',
  );
}

function targetRace({ date = '2026-07-04', startTime }) {
  return {
    raceId: `${date}-ST-1`,
    date,
    racecourse: 'ST',
    raceNo: 1,
    startTime,
    distance: 1200,
    runners: [{ horseId: 'HK_2025_L245', horseNo: 2 }],
  };
}

function coverage(requestedRunnerRows, availableFeatureRows) {
  return {
    requestedRunnerRows,
    availableFeatureRows,
    unavailableFeatureRows: requestedRunnerRows - availableFeatureRows,
    excludedTimingRunnerRows: 0,
    excludedIdentityMismatchRunnerRows: 0,
  };
}
