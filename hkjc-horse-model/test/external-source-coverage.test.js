import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { buildExternalSourceCoverage } from '../src/external-source-coverage.js';

describe('external source coverage', () => {
  it('audits Tianxi and SpeedPRO file coverage without exposing local paths or raw rows', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-external-coverage-'));
    const tianxiRoot = path.join(tempDir, 'tianxi-database');
    const magRoot = path.join(tempDir, 'mag-dot-race-data');

    try {
      await mkdir(path.join(tianxiRoot, 'data', '2016'), { recursive: true });
      await mkdir(path.join(tianxiRoot, 'speedpro', 'data'), { recursive: true });
      await mkdir(path.join(tianxiRoot, 'trials'), { recursive: true });
      await mkdir(path.join(tianxiRoot, 'horses', 'form_records'), { recursive: true });
      await mkdir(path.join(tianxiRoot, 'horses', 'trackwork'), { recursive: true });
      await mkdir(path.join(tianxiRoot, 'horses', 'injury'), { recursive: true });
      await writeFile(
        path.join(tianxiRoot, 'data', '2016', 'results_2016-01-20.csv'),
        'date,venue,race_no,horse_no,finish_time,win_odds\n2016-01-20,HV,1,5,1:10.37,1.7\n',
      );
      await writeFile(
        path.join(tianxiRoot, 'speedpro', 'data', '2026-07-15_HV.json'),
        JSON.stringify({ racedate: '2026-07-15', scraped_at: '2026-07-14T08:00:00Z', races: [] }),
      );
      await writeFile(
        path.join(tianxiRoot, 'trials', 'trial_results.csv'),
        'trial_date,horse_no,finish_time,commentary\n16/04/2026,K246,1.10.96,good\n',
      );
      await writeFile(
        path.join(tianxiRoot, 'horses', 'form_records', 'form_K390.csv'),
        'horse_no,date,place,win_odds\nK390,15/07/26,10,70\n',
      );
      await writeFile(
        path.join(tianxiRoot, 'horses', 'trackwork', 'trackwork_K390.csv'),
        'horse_no,date,work_type\nK390,01/05/2026,gallop\n',
      );
      await writeFile(
        path.join(tianxiRoot, 'horses', 'injury', 'injury_K390.csv'),
        'horse_no,date,detail,cleared_date\nK390,12/09/2025,tendon,26/01/2026\n',
      );
      await writeFile(
        path.join(tianxiRoot, 'horses', 'injury', '_horseid_map.json'),
        JSON.stringify(Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`K${index}`, index]))),
      );

      await mkdir(path.join(magRoot, 'data', 'formguide'), { recursive: true });
      await mkdir(path.join(magRoot, 'data', 'results'), { recursive: true });
      await mkdir(path.join(magRoot, 'data', 'trackwork'), { recursive: true });
      await writeFile(
        path.join(magRoot, 'data', 'formguide', '2026-04-01.json'),
        JSON.stringify([{ raceNo: 1, horses: [{ number: 1, form: [] }] }]),
      );
      await writeFile(
        path.join(magRoot, 'data', 'results', '2026-04-22.json'),
        JSON.stringify([{ raceNo: 1, results: [{ placing: '1', horseNo: '1' }] }]),
      );
      await writeFile(
        path.join(magRoot, 'data', 'trackwork', '2026-04-01.json'),
        JSON.stringify([{ raceNo: 1, horses: [{ horseNo: '1', gallops: [] }] }]),
      );

      const report = await buildExternalSourceCoverage({
        sources: [
          { sourceId: 'sleepingarhat-tianxi-database', rootPath: tianxiRoot },
          { sourceId: 'mag-dot-race-data', rootPath: magRoot },
        ],
        generatedAt: '2026-07-17T01:00:00.000Z',
      });

      assert.equal(report.summary.requestedSources, 2);
      assert.equal(report.summary.availableSources, 2);
      assert.equal(report.summary.totalFiles, 10);
      assert.equal(report.summary.preRaceCandidateFiles, 8);
      assert.equal(report.summary.postRaceFiles, 2);
      assert.equal(JSON.stringify(report).includes(tempDir), false);

      const tianxi = report.sources.find((source) => source.sourceId === 'sleepingarhat-tianxi-database');
      assert.equal(tianxi.status, 'available');
      assert.equal(tianxi.summary.files, 7);
      assert.equal(tianxi.summary.earliestDatedFile, '2016-01-20');
      assert.equal(tianxi.summary.latestDatedFile, '2026-07-15');
      assert.match(tianxi.inventoryChecksum, /^sha256:[a-f0-9]{64}$/);
      assert.equal(tianxi.categories['historical-results'].timing, 'post-race');
      assert.equal(tianxi.categories['speedpro-form'].timing, 'pre-race-candidate');
      assert.equal(tianxi.categories['prior-horse-form'].files, 1);
      assert.equal(tianxi.categories['prior-trackwork'].files, 1);
      assert.equal(tianxi.categories['prior-veterinary-records'].files, 2);
      const veterinarySchema = tianxi.schemaSamples.find((sample) => sample.category === 'prior-veterinary-records');
      assert.equal(veterinarySchema.fields.length, 40);
      assert.equal(veterinarySchema.omittedFields, 20);
      assert.deepEqual(
        tianxi.schemaSamples.find((sample) => sample.category === 'historical-results').fields,
        ['date', 'venue', 'race_no', 'horse_no', 'finish_time', 'win_odds'],
      );

      const mag = report.sources.find((source) => source.sourceId === 'mag-dot-race-data');
      assert.equal(mag.categories.formguide.files, 1);
      assert.equal(mag.categories.results.timing, 'post-race');
      assert.deepEqual(
        mag.schemaSamples.find((sample) => sample.category === 'formguide').fields,
        ['horses', 'raceNo'],
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('reports a missing local source instead of treating the audit as complete', async () => {
    const report = await buildExternalSourceCoverage({
      sources: [{ sourceId: 'sleepingarhat-tianxi-database', rootPath: '/definitely/missing' }],
    });

    assert.equal(report.summary.availableSources, 0);
    assert.equal(report.summary.missingSources, 1);
    assert.equal(report.sources[0].status, 'missing');
  });
});
