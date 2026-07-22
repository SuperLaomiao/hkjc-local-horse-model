import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  buildProspectiveLocks,
  buildProspectiveLockId,
  normalizeProspectiveLock,
  recordProspectiveLock,
  summarizeProspectiveLocks,
  settleProspectiveLocks,
  settleProspectiveLock,
} from '../src/prospective-locks.js';
import { loadProspectiveLocks } from '../src/sqlite-store.js';

describe('prospective locks', () => {
  it('hashes the canonical identity fields and ignores unrelated decision payload order', () => {
    const base = prospectiveLock();
    const first = buildProspectiveLockId(base);
    const second = buildProspectiveLockId({
      ...base,
      decision: {
        currentDividendPer10: 31.5,
        fairDividendPer10: 28.2,
      },
    });

    assert.equal(first, second);
    assert.match(first, /^sha256:[a-f0-9]{64}$/);
  });

  it('records an append-only lock idempotently and reloads it as OPEN', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-prospective-lock-'));
    try {
      const dbPath = path.join(tempDir, 'hkjc.sqlite');
      const lock = prospectiveLock();

      const first = recordProspectiveLock({ dbPath, lock });
      const second = recordProspectiveLock({ dbPath, lock: structuredClone(lock) });
      const loaded = loadProspectiveLocks({ dbPath });

      assert.equal(first.lockId, second.lockId);
      assert.equal(first.createdAt, second.createdAt);
      assert.equal(loaded.length, 1);
      assert.equal(loaded[0].lockId, first.lockId);
      assert.equal(loaded[0].status, 'OPEN');
      assert.equal(loaded[0].decision.reasonCodes[0], 'EDGE_CLEARS_BUFFER');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('throws PROSPECTIVE_LOCK_CONFLICT when a stored lock id is replayed with changed immutable content', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-prospective-lock-'));
    try {
      const dbPath = path.join(tempDir, 'hkjc.sqlite');
      const lock = prospectiveLock();
      recordProspectiveLock({ dbPath, lock });

      assert.throws(
        () => recordProspectiveLock({
          dbPath,
          lock: {
            ...lock,
            decision: {
              ...lock.decision,
              currentDividendPer10: 33.1,
            },
          },
        }),
        /PROSPECTIVE_LOCK_CONFLICT/,
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('settles an OPEN lock exactly once and then rejects further mutation', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hkjc-prospective-lock-'));
    try {
      const dbPath = path.join(tempDir, 'hkjc.sqlite');
      const lock = prospectiveLock();
      const recorded = recordProspectiveLock({ dbPath, lock });

      const settled = settleProspectiveLock({
        dbPath,
        lockId: recorded.lockId,
        settlement: {
          status: 'SETTLED',
          settledAt: '2026-07-22T12:00:00Z',
          dividendPer10: 15,
          returned: 15,
          profit: 5,
        },
      });

      const loaded = loadProspectiveLocks({ dbPath, status: 'SETTLED' });
      assert.equal(settled.status, 'SETTLED');
      assert.equal(settled.settlement.dividendPer10, 15);
      assert.equal(loaded.length, 1);
      assert.equal(loaded[0].lockId, recorded.lockId);

      assert.throws(
        () => settleProspectiveLock({
          dbPath,
          lockId: recorded.lockId,
          settlement: {
            status: 'VOID',
            settledAt: '2026-07-22T12:05:00Z',
            dividendPer10: 0,
            returned: 10,
            profit: 0,
          },
        }),
        /PROSPECTIVE_LOCK_ALREADY_SETTLED/,
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('settles prospective locks from official race dividends with shared pool semantics', () => {
    const summary = settleProspectiveLocks({
      locks: [
        prospectiveLock(),
        {
          ...prospectiveLock(),
          pool: 'QUINELLA PLACE',
          combination: [1, 2],
          decision: {
            ...prospectiveLock().decision,
            currentDividendPer10: 14,
          },
        },
        {
          ...prospectiveLock(),
          pool: 'WIN',
          combination: [1],
        },
        {
          ...prospectiveLock(),
          pool: 'QUINELLA',
          combination: [2, 1],
        },
        {
          ...prospectiveLock(),
          pool: 'WIN',
          combination: [8],
        },
      ],
      race: settledRace(),
    });

    assert.equal(summary.status, 'SETTLED');
    assert.equal(summary.lines.length, 5);
    assert.equal(summary.lines[0].status, 'HIT');
    assert.equal(summary.lines[0].dividendPer10, 15);
    assert.equal(summary.lines[0].returned, 15);
    assert.equal(summary.lines[1].status, 'HIT');
    assert.equal(summary.lines[1].dividendPer10, 13.5);
    assert.equal(summary.lines[1].returned, 13.5);
    assert.equal(summary.lines[2].status, 'HIT');
    assert.equal(summary.lines[2].dividendPer10, 23);
    assert.equal(summary.lines[3].status, 'HIT');
    assert.deepEqual(summary.lines[3].combination, [1, 2]);
    assert.equal(summary.lines[3].dividendPer10, 42);
    assert.equal(summary.lines[4].status, 'MISS');
    assert.equal(summary.lines[4].dividendPer10, null);
    assert.equal(summary.lines[4].profit, -10);
  });

  it('rejects unsupported windows, pools, and malformed pool combinations', () => {
    assert.throws(
      () => normalizeProspectiveLock({ ...prospectiveLock(), marketWindow: 'T-5' }),
      /marketWindow must be T-30, T-10, or T-3/,
    );
    assert.throws(
      () => normalizeProspectiveLock({ ...prospectiveLock(), pool: 'TRIO', combination: [1, 2, 3] }),
      /pool must be WIN, PLACE, QUINELLA, or QUINELLA PLACE/,
    );
    assert.throws(
      () => normalizeProspectiveLock({ ...prospectiveLock(), pool: 'PLACE', combination: [2, 8] }),
      /PLACE combination must contain exactly 1 runner/,
    );
    assert.throws(
      () => normalizeProspectiveLock({ ...prospectiveLock(), pool: 'QPL', combination: [2, 2] }),
      /combination runner numbers must be unique/,
    );
    assert.throws(
      () => normalizeProspectiveLock({ ...prospectiveLock(), combination: [2.5] }),
      /positive integers/,
    );
  });

  it('rejects invalid probabilities, market economics, timestamps, and lineage mismatches', () => {
    assert.throws(
      () => normalizeProspectiveLock({
        ...prospectiveLock(),
        decision: { ...prospectiveLock().decision, rawProbability: 1.2 },
      }),
      /rawProbability must be between 0 and 1/,
    );
    assert.throws(
      () => normalizeProspectiveLock({
        ...prospectiveLock(),
        decision: {
          ...prospectiveLock().decision,
          conservativeProbability: 0.5,
        },
      }),
      /conservativeProbability must not exceed rawProbability/,
    );
    assert.throws(
      () => normalizeProspectiveLock({
        ...prospectiveLock(),
        decision: { ...prospectiveLock().decision, requiredDividendPer10: 20 },
      }),
      /requiredDividendPer10 must not be below fairDividendPer10/,
    );
    assert.throws(
      () => normalizeProspectiveLock({
        ...prospectiveLock(),
        decision: { ...prospectiveLock().decision, fairDividendPer10: 20 },
      }),
      /fairDividendPer10 must equal 10 divided by rawProbability/,
    );
    assert.throws(
      () => normalizeProspectiveLock({
        ...prospectiveLock(),
        decision: { ...prospectiveLock().decision, stake: -10 },
      }),
      /stake must be zero or greater/,
    );
    assert.throws(
      () => normalizeProspectiveLock({
        ...prospectiveLock(),
        decision: {
          ...prospectiveLock().decision,
          marketCapturedAt: '2026-07-22T10:21:00Z',
        },
      }),
      /marketCapturedAt must not be after generatedAt/,
    );
    assert.throws(
      () => normalizeProspectiveLock({
        ...prospectiveLock(),
        lineage: { ...prospectiveLock().lineage, artifactId: 'sha256:different' },
      }),
      /lineage artifactId must match lock artifactId/,
    );
  });

  it('fails closed when the official race or requested dividend pool is not settled and complete', () => {
    assert.throws(
      () => settleProspectiveLocks({
        locks: [prospectiveLock()],
        race: { ...settledRace(), raceId: '2026-07-22-HV-R2' },
      }),
      /raceId does not match/,
    );
    assert.throws(
      () => settleProspectiveLocks({
        locks: [prospectiveLock()],
        race: { ...settledRace(), status: 'upcoming' },
      }),
      /race must be settled/,
    );
    assert.throws(
      () => settleProspectiveLocks({
        locks: [prospectiveLock()],
        race: { ...settledRace(), dividends: {} },
      }),
      /official PLACE dividends are missing/,
    );
  });

  it('builds a pre-race paper-only lock from a frozen score bundle and matching market window', () => {
    const locks = buildProspectiveLocks({
      race: upcomingRace(),
      scoreBundles: [scoreBundle()],
      marketSnapshots: [marketSnapshot()],
      decisions: [{
        pool: 'PLACE',
        combination: [2],
        modelId: 'catboost-market-aware-t10-v1',
        rawProbability: 0.55,
        conservativeProbability: 0.52,
        paperStake: 10,
        marketWindow: 'T-10',
      }],
      generatedAt: '2026-07-22T10:20:00Z',
    });

    assert.equal(locks.length, 1);
    assert.equal(locks[0].raceId, '2026-07-22-HV-R1');
    assert.equal(locks[0].marketWindow, 'T-10');
    assert.equal(locks[0].poolKey, 'place');
    assert.deepEqual(locks[0].combination, [2]);
    assert.equal(locks[0].decision.executionStatus, 'PAPER_ONLY');
    assert.equal(locks[0].decision.currentDividendPer10, 21);
    assert.equal(locks[0].decision.stake, 10);
    assert.deepEqual(locks[0].decision.reasonCodes, ['PROBABILITY_NOT_PROMOTED']);
    assert.equal(locks[0].lineage.artifactId, 'sha256:abc123');
  });

  it('rejects post-time lock creation and any nonzero cash stake', () => {
    const base = {
      race: upcomingRace(),
      scoreBundles: [scoreBundle()],
      marketSnapshots: [marketSnapshot()],
      decisions: [{
        pool: 'PLACE',
        combination: [2],
        rawProbability: 0.55,
        conservativeProbability: 0.52,
        paperStake: 10,
        marketWindow: 'T-10',
      }],
    };
    assert.throws(
      () => buildProspectiveLocks({ ...base, generatedAt: '2026-07-22T10:30:00Z' }),
      /generatedAt must be before race post time/,
    );
    assert.throws(
      () => buildProspectiveLocks({
        ...base,
        generatedAt: '2026-07-22T10:20:00Z',
        decisions: [{ ...base.decisions[0], cashStake: 10 }],
      }),
      /cashStake must remain zero/,
    );
  });

  it('settles refunds as VOID and computes closing-price audit plus shadow and paper summaries', () => {
    const lock = prospectiveLock();
    const summary = settleProspectiveLocks({
      locks: [lock],
      race: settledRace(),
      marketSnapshots: [{
        raceId: lock.raceId,
        pool: 'PLACE',
        combination: [2],
        oddsValue: 2.8,
        minutesToPost: 3,
        capturedAt: '2026-07-22T10:27:00Z',
        sellStatus: 'START_SELL',
      }],
    });
    assert.equal(summary.lines[0].closingDividendPer10, 28);
    assert.equal(summary.lines[0].indicativeClv, 0.125);
    assert.equal(summary.lines[0].priceSlippageToT3, -0.1111);

    const ledgers = summarizeProspectiveLocks([
      {
        ...lock,
        status: 'SETTLED',
        settlement: {
          outcome: summary.lines[0].status,
          stake: summary.lines[0].stake,
          returned: summary.lines[0].returned,
          profit: summary.lines[0].profit,
          indicativeClv: summary.lines[0].indicativeClv,
        },
      },
      {
        ...lock,
        lockId: 'sha256:miss',
        status: 'SETTLED',
        settlement: { outcome: 'MISS', stake: 10, returned: 0, profit: -10, indicativeClv: null },
      },
    ]);
    assert.equal(ledgers.shadow.locks, 2);
    assert.equal(ledgers.shadow.hitRate, 0.5);
    assert.equal(ledgers.paper.stake, 20);
    assert.equal(ledgers.paper.returned, 15);
    assert.equal(ledgers.paper.profit, -5);
    assert.equal(ledgers.paper.roi, -0.25);
    assert.equal(ledgers.paper.maxDrawdown, 10);
    assert.equal(ledgers.paper.longestLosingRun, 1);
    assert.equal(ledgers.cash.stake, 0);
    assert.equal(ledgers.cash.executionStatus, 'NO_BET');

    const voided = settleProspectiveLocks({
      locks: [lock],
      race: { ...settledRace(), voidPools: ['PLACE'], dividends: {} },
    });
    assert.equal(voided.status, 'VOID');
    assert.equal(voided.lines[0].status, 'VOID');
    assert.equal(voided.lines[0].returned, 10);
    assert.equal(voided.lines[0].profit, 0);
  });
});

function prospectiveLock() {
  return {
    raceId: '2026-07-22-HV-R1',
    marketWindow: 'T-10',
    pool: 'PLACE',
    combination: [2],
    modelId: 'catboost-market-aware-t10-v1',
    artifactId: 'sha256:abc123',
    featurePolicyId: 'market-aware-t10-v1',
    generatedAt: '2026-07-22T10:20:00Z',
    decision: {
      executionStatus: 'PAPER_ONLY',
      rawProbability: 0.4,
      conservativeProbability: 0.35,
      fairDividendPer10: 25,
      requiredDividendPer10: 30.86,
      currentDividendPer10: 31.5,
      marketCapturedAt: '2026-07-22T10:19:00Z',
      sellStatus: 'SELLING',
      reasonCodes: ['EDGE_CLEARS_BUFFER'],
      stake: 10,
    },
    lineage: {
      modelId: 'catboost-market-aware-t10-v1',
      artifactId: 'sha256:abc123',
      featurePolicyId: 'market-aware-t10-v1',
      calibrationMethod: 'sigmoid',
      trainingCutoff: '2026-06-30',
    },
  };
}

function settledRace() {
  return {
    raceId: '2026-07-22-HV-R1',
    date: '2026-07-22',
    startTime: '18:30',
    status: 'settled',
    dividends: {
      win: [
        { pool: 'WIN', combination: [1], dividendPer10: 23 },
      ],
      place: [
        { pool: 'PLACE', combination: [2], dividendPer10: 15 },
      ],
      quinella: [
        { pool: 'QUINELLA', combination: [1, 2], dividendPer10: 42 },
      ],
      quinellaPlace: [
        { pool: 'QUINELLA PLACE', combination: [1, 2], dividendPer10: 13.5 },
      ],
    },
  };
}

function upcomingRace() {
  return {
    raceId: '2026-07-22-HV-R1',
    date: '2026-07-22',
    racecourse: 'HV',
    raceNo: 1,
    startTime: '18:30',
    status: 'upcoming',
    runners: [
      { horseId: 'H001', horseNo: 1, horseName: 'Horse 1' },
      { horseId: 'H002', horseNo: 2, horseName: 'Horse 2' },
    ],
  };
}

function scoreBundle() {
  return {
    researchMode: 'SHADOW',
    executionStatus: 'PAPER_ONLY',
    probabilityStatus: 'RESEARCH_ONLY',
    generatedAt: '2026-07-22T10:18:00Z',
    modelId: 'catboost-market-aware-t10-v1',
    artifactId: 'sha256:abc123',
    featurePolicyId: 'market-aware-t10-v1',
    calibrationMethod: 'sigmoid',
    trainingCutoff: '2026-06-30',
    lineage: {
      reportLineage: 'holdout-selection-v1',
      modelPath: 'model.cbm',
      reportPath: 'report.json',
      featureManifestPath: 'manifest.json',
    },
    predictions: [
      { raceId: '2026-07-22-HV-R1', runnerId: 'H001', probability: 0.45 },
      { raceId: '2026-07-22-HV-R1', runnerId: 'H002', probability: 0.55 },
    ],
  };
}

function marketSnapshot() {
  return {
    raceId: '2026-07-22-HV-R1',
    pool: 'PLACE',
    combination: [2],
    oddsValue: 2.1,
    minutesToPost: 10,
    capturedAt: '2026-07-22T10:19:00Z',
    sellStatus: 'START_SELL',
    source: 'hkjc-live-graphql-test',
  };
}
