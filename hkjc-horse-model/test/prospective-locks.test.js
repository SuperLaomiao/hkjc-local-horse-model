import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  buildProspectiveLockId,
  recordProspectiveLock,
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
      rawProbability: 0.221,
      conservativeProbability: 0.207,
      fairDividendPer10: 28.2,
      requiredDividendPer10: 30.1,
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
