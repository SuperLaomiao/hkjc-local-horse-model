import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function syncRaceFilesToDatabase({ dbPath, inputPath, sourceKind = 'raw' }) {
  if (!dbPath) throw new Error('syncRaceFilesToDatabase requires dbPath');
  if (!inputPath) throw new Error('syncRaceFilesToDatabase requires inputPath');

  mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = openDatabase(dbPath);
  const files = collectJsonFiles(inputPath);
  const summary = {
    filesSeen: 0,
    racesSeen: 0,
    runnersSeen: 0,
    dividendsSeen: 0,
  };

  const transaction = db.prepare(`
    INSERT INTO source_files (path, kind, sha256, imported_at, race_count)
    VALUES (?, ?, ?, datetime('now'), ?)
    ON CONFLICT(path) DO UPDATE SET
      kind = excluded.kind,
      sha256 = excluded.sha256,
      imported_at = excluded.imported_at,
      race_count = excluded.race_count
  `);

  db.exec('BEGIN');
  try {
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const parsed = JSON.parse(text);
      const races = normalizeRacePayload(parsed);
      const hash = createHash('sha256').update(text).digest('hex');

      transaction.run(path.resolve(file), sourceKind, hash, races.length);
      summary.filesSeen += 1;

      for (const race of races) {
        importRace(db, {
          race,
          sourceKind,
          sourceFile: path.resolve(file),
        });
        summary.racesSeen += 1;
        summary.runnersSeen += race.runners?.length ?? 0;
        summary.dividendsSeen += countDividends(race.dividends);
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.close();
  }

  return summary;
}

export function getDatabaseStats(dbPath) {
  const db = openDatabase(dbPath);
  try {
    return {
      races: countTable(db, 'races'),
      settledRaces: countTable(db, 'races', "status = 'settled'"),
      upcomingRaces: countTable(db, 'races', "status = 'upcoming'"),
      runners: countTable(db, 'runners'),
      dividends: countTable(db, 'dividends'),
      oddsSnapshots: countTable(db, 'odds_snapshots'),
      poolSnapshots: countTable(db, 'pool_snapshots'),
      recommendationRuns: countTable(db, 'recommendation_runs'),
      sourceFiles: countTable(db, 'source_files'),
    };
  } finally {
    db.close();
  }
}

export function recordOddsSnapshot({ dbPath, snapshot }) {
  if (!dbPath) throw new Error('recordOddsSnapshot requires dbPath');
  if (!snapshot?.raceId) throw new Error('recordOddsSnapshot requires snapshot.raceId');
  if (!snapshot?.pool) throw new Error('recordOddsSnapshot requires snapshot.pool');

  const capturedAt = nullableText(snapshot.capturedAt) ?? new Date().toISOString();
  const poolKey = normalizePoolKey(snapshot.pool);
  const combination = normalizeCombination(snapshot.combination ?? snapshot.combString);
  const db = openDatabase(dbPath);
  try {
    db.prepare(`
      INSERT INTO odds_snapshots (
        race_id, date, racecourse, race_no, captured_at, minutes_to_post,
        pool_key, pool, combination_key, combination_json, odds_value, source, raw_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(race_id, captured_at, pool_key, combination_key) DO UPDATE SET
        date = excluded.date,
        racecourse = excluded.racecourse,
        race_no = excluded.race_no,
        minutes_to_post = excluded.minutes_to_post,
        pool = excluded.pool,
        combination_json = excluded.combination_json,
        odds_value = excluded.odds_value,
        source = excluded.source,
        raw_json = excluded.raw_json
    `).run(
      snapshot.raceId,
      nullableText(snapshot.date),
      nullableText(snapshot.racecourse)?.toUpperCase() ?? null,
      nullableInteger(snapshot.raceNo),
      capturedAt,
      nullableInteger(snapshot.minutesToPost),
      poolKey,
      nullableText(snapshot.pool),
      combinationKey(combination, poolKey),
      JSON.stringify(combination),
      nullableNumber(snapshot.oddsValue),
      nullableText(snapshot.source),
      JSON.stringify(snapshot.raw ?? snapshot),
    );
  } finally {
    db.close();
  }
}

export function recordPoolSnapshot({ dbPath, snapshot }) {
  if (!dbPath) throw new Error('recordPoolSnapshot requires dbPath');
  if (!snapshot?.raceId) throw new Error('recordPoolSnapshot requires snapshot.raceId');
  if (!snapshot?.pool) throw new Error('recordPoolSnapshot requires snapshot.pool');

  const capturedAt = nullableText(snapshot.capturedAt) ?? new Date().toISOString();
  const poolKey = normalizePoolKey(snapshot.pool);
  const db = openDatabase(dbPath);
  try {
    db.prepare(`
      INSERT INTO pool_snapshots (
        race_id, date, racecourse, race_no, captured_at, minutes_to_post,
        pool_key, pool, investment, sell_status, source, raw_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(race_id, captured_at, pool_key) DO UPDATE SET
        date = excluded.date,
        racecourse = excluded.racecourse,
        race_no = excluded.race_no,
        minutes_to_post = excluded.minutes_to_post,
        pool = excluded.pool,
        investment = excluded.investment,
        sell_status = excluded.sell_status,
        source = excluded.source,
        raw_json = excluded.raw_json
    `).run(
      snapshot.raceId,
      nullableText(snapshot.date),
      nullableText(snapshot.racecourse)?.toUpperCase() ?? null,
      nullableInteger(snapshot.raceNo),
      capturedAt,
      nullableInteger(snapshot.minutesToPost),
      poolKey,
      nullableText(snapshot.pool),
      nullableNumber(snapshot.investment),
      nullableText(snapshot.sellStatus),
      nullableText(snapshot.source),
      JSON.stringify(snapshot.raw ?? snapshot),
    );
  } finally {
    db.close();
  }
}

export function loadLatestMarketSnapshots({ dbPath, raceId }) {
  if (!dbPath) throw new Error('loadLatestMarketSnapshots requires dbPath');
  if (!raceId) throw new Error('loadLatestMarketSnapshots requires raceId');

  const db = openDatabase(dbPath);
  try {
    const odds = db.prepare(`
      SELECT * FROM odds_snapshots
      WHERE race_id = ?
        AND captured_at = (
          SELECT MAX(captured_at) FROM odds_snapshots WHERE race_id = ?
        )
      ORDER BY pool_key, combination_key
    `).all(raceId, raceId).map(oddsSnapshotFromRow);

    const pools = db.prepare(`
      SELECT * FROM pool_snapshots
      WHERE race_id = ?
        AND captured_at = (
          SELECT MAX(captured_at) FROM pool_snapshots WHERE race_id = ?
        )
      ORDER BY pool_key
    `).all(raceId, raceId).map(poolSnapshotFromRow);

    return { odds, pools };
  } finally {
    db.close();
  }
}

export function loadMarketSnapshots({ dbPath, raceId = null } = {}) {
  if (!dbPath) throw new Error('loadMarketSnapshots requires dbPath');

  const db = openDatabase(dbPath);
  try {
    const oddsRows = raceId
      ? db.prepare(`
        SELECT * FROM odds_snapshots
        WHERE race_id = ?
        ORDER BY race_id, captured_at, pool_key, combination_key
      `).all(raceId)
      : db.prepare(`
        SELECT * FROM odds_snapshots
        ORDER BY race_id, captured_at, pool_key, combination_key
      `).all();

    const poolRows = raceId
      ? db.prepare(`
        SELECT * FROM pool_snapshots
        WHERE race_id = ?
        ORDER BY race_id, captured_at, pool_key
      `).all(raceId)
      : db.prepare(`
        SELECT * FROM pool_snapshots
        ORDER BY race_id, captured_at, pool_key
      `).all();

    return {
      odds: oddsRows.map(oddsSnapshotFromRow),
      pools: poolRows.map(poolSnapshotFromRow),
    };
  } finally {
    db.close();
  }
}

export function recordRecommendationRun({ dbPath, run }) {
  if (!dbPath) throw new Error('recordRecommendationRun requires dbPath');
  if (!run?.raceId) throw new Error('recordRecommendationRun requires run.raceId');

  const generatedAt = nullableText(run.generatedAt) ?? new Date().toISOString();
  const runId = nullableText(run.runId) ?? buildRecommendationRunId({ ...run, generatedAt });
  const db = openDatabase(dbPath);
  try {
    db.prepare(`
      INSERT INTO recommendation_runs (
        run_id, race_id, date, racecourse, race_no, generated_at, model_version,
        strategy_version, bankroll, final_edge_buffer, recommendations_json, summary_json, raw_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        race_id = excluded.race_id,
        date = excluded.date,
        racecourse = excluded.racecourse,
        race_no = excluded.race_no,
        generated_at = excluded.generated_at,
        model_version = excluded.model_version,
        strategy_version = excluded.strategy_version,
        bankroll = excluded.bankroll,
        final_edge_buffer = excluded.final_edge_buffer,
        recommendations_json = excluded.recommendations_json,
        summary_json = excluded.summary_json,
        raw_json = excluded.raw_json
    `).run(
      runId,
      run.raceId,
      nullableText(run.date),
      nullableText(run.racecourse)?.toUpperCase() ?? null,
      nullableInteger(run.raceNo),
      generatedAt,
      nullableText(run.modelVersion),
      nullableText(run.strategyVersion),
      nullableNumber(run.bankroll),
      nullableNumber(run.finalEdgeBuffer),
      JSON.stringify(run.recommendations ?? []),
      JSON.stringify(run.summary ?? {}),
      JSON.stringify(run),
    );
  } finally {
    db.close();
  }
  return runId;
}

export function loadRecommendationRuns({ dbPath, raceId = null } = {}) {
  if (!dbPath) throw new Error('loadRecommendationRuns requires dbPath');

  const db = openDatabase(dbPath);
  try {
    const rows = raceId
      ? db.prepare('SELECT * FROM recommendation_runs WHERE race_id = ? ORDER BY generated_at DESC, run_id DESC').all(raceId)
      : db.prepare('SELECT * FROM recommendation_runs ORDER BY generated_at DESC, run_id DESC').all();
    return rows.map(recommendationRunFromRow);
  } finally {
    db.close();
  }
}

export function loadRacesFromDatabase({ dbPath, status = null } = {}) {
  const db = openDatabase(dbPath);
  try {
    const raceRows = status
      ? db.prepare('SELECT * FROM races WHERE status = ? ORDER BY date, racecourse, race_no').all(status)
      : db.prepare('SELECT * FROM races ORDER BY date, racecourse, race_no').all();

    return raceRows.map((raceRow) => {
      const runners = db.prepare(`
        SELECT * FROM runners
        WHERE race_id = ?
        ORDER BY
          CASE WHEN placing IS NULL THEN 999 ELSE placing END,
          horse_no
      `).all(raceRow.race_id).map(runnerFromRow);

      const dividendRows = db.prepare(`
        SELECT * FROM dividends
        WHERE race_id = ?
        ORDER BY pool_key, combination_key
      `).all(raceRow.race_id);

      return {
        raceId: raceRow.race_id,
        date: raceRow.date,
        racecourse: raceRow.racecourse,
        raceNo: raceRow.race_no,
        raceIndex: raceRow.race_index,
        status: raceRow.status,
        raceClass: raceRow.race_class,
        distance: raceRow.distance,
        ratingBand: raceRow.rating_band,
        surface: raceRow.surface,
        course: raceRow.course,
        going: raceRow.going,
        runners,
        dividends: dividendsFromRows(dividendRows),
        source: {
          kind: raceRow.source_kind,
          url: raceRow.source_url,
          file: raceRow.source_file,
        },
      };
    });
  } finally {
    db.close();
  }
}

function openDatabase(dbPath) {
  const db = new DatabaseSync(path.resolve(dbPath));
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS source_files (
      path TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      race_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS races (
      race_id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      racecourse TEXT NOT NULL,
      race_no INTEGER NOT NULL,
      race_index INTEGER,
      status TEXT NOT NULL,
      race_class TEXT,
      distance INTEGER,
      rating_band TEXT,
      surface TEXT,
      course TEXT,
      going TEXT,
      source_kind TEXT NOT NULL,
      source_url TEXT,
      source_file TEXT,
      raw_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_races_date_course ON races(date, racecourse, race_no);
    CREATE TABLE IF NOT EXISTS runners (
      race_id TEXT NOT NULL REFERENCES races(race_id) ON DELETE CASCADE,
      horse_no INTEGER NOT NULL,
      horse_id TEXT,
      brand_no TEXT,
      horse_name TEXT,
      jockey TEXT,
      trainer TEXT,
      placing INTEGER,
      actual_weight INTEGER,
      declared_horse_weight INTEGER,
      draw INTEGER,
      lbw REAL,
      running_position_json TEXT,
      finish_seconds REAL,
      win_odds REAL,
      raw_json TEXT NOT NULL,
      PRIMARY KEY (race_id, horse_no)
    );
    CREATE INDEX IF NOT EXISTS idx_runners_horse_id ON runners(horse_id);
    CREATE TABLE IF NOT EXISTS dividends (
      race_id TEXT NOT NULL REFERENCES races(race_id) ON DELETE CASCADE,
      pool_key TEXT NOT NULL,
      pool TEXT NOT NULL,
      combination_key TEXT NOT NULL,
      combination_json TEXT NOT NULL,
      dividend_per10 REAL NOT NULL,
      raw_json TEXT NOT NULL,
      PRIMARY KEY (race_id, pool_key, combination_key)
    );
    CREATE TABLE IF NOT EXISTS odds_snapshots (
      race_id TEXT NOT NULL,
      date TEXT,
      racecourse TEXT,
      race_no INTEGER,
      captured_at TEXT NOT NULL,
      minutes_to_post INTEGER,
      pool_key TEXT NOT NULL,
      pool TEXT NOT NULL,
      combination_key TEXT NOT NULL,
      combination_json TEXT NOT NULL,
      odds_value REAL,
      source TEXT,
      raw_json TEXT NOT NULL,
      PRIMARY KEY (race_id, captured_at, pool_key, combination_key)
    );
    CREATE INDEX IF NOT EXISTS idx_odds_snapshots_race_time ON odds_snapshots(race_id, captured_at);
    CREATE TABLE IF NOT EXISTS pool_snapshots (
      race_id TEXT NOT NULL,
      date TEXT,
      racecourse TEXT,
      race_no INTEGER,
      captured_at TEXT NOT NULL,
      minutes_to_post INTEGER,
      pool_key TEXT NOT NULL,
      pool TEXT NOT NULL,
      investment REAL,
      sell_status TEXT,
      source TEXT,
      raw_json TEXT NOT NULL,
      PRIMARY KEY (race_id, captured_at, pool_key)
    );
    CREATE INDEX IF NOT EXISTS idx_pool_snapshots_race_time ON pool_snapshots(race_id, captured_at);
    CREATE TABLE IF NOT EXISTS recommendation_runs (
      run_id TEXT PRIMARY KEY,
      race_id TEXT NOT NULL,
      date TEXT,
      racecourse TEXT,
      race_no INTEGER,
      generated_at TEXT NOT NULL,
      model_version TEXT,
      strategy_version TEXT,
      bankroll REAL,
      final_edge_buffer REAL,
      recommendations_json TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      raw_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_recommendation_runs_race ON recommendation_runs(race_id, generated_at);
  `);
  return db;
}

function importRace(db, { race, sourceKind, sourceFile }) {
  const raceId = race.raceId ?? `${race.date}-${race.racecourse}-${race.raceNo}`;
  const status = sourceKind === 'upcoming' ? 'upcoming' : 'settled';
  const sourceUrl = typeof race.source === 'string' ? race.source : race.source?.url ?? null;
  const existing = db.prepare('SELECT status FROM races WHERE race_id = ?').get(raceId);

  if (sourceKind === 'upcoming' && existing?.status === 'settled') {
    return;
  }

  db.prepare(`
    INSERT INTO races (
      race_id, date, racecourse, race_no, race_index, status, race_class, distance,
      rating_band, surface, course, going, source_kind, source_url, source_file, raw_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(race_id) DO UPDATE SET
      date = excluded.date,
      racecourse = excluded.racecourse,
      race_no = excluded.race_no,
      race_index = excluded.race_index,
      status = excluded.status,
      race_class = excluded.race_class,
      distance = excluded.distance,
      rating_band = excluded.rating_band,
      surface = excluded.surface,
      course = excluded.course,
      going = excluded.going,
      source_kind = excluded.source_kind,
      source_url = excluded.source_url,
      source_file = excluded.source_file,
      raw_json = excluded.raw_json
  `).run(
    raceId,
    race.date,
    race.racecourse,
    nullableInteger(race.raceNo),
    nullableInteger(race.raceIndex),
    status,
    nullableText(race.raceClass),
    nullableInteger(race.distance),
    nullableText(race.ratingBand),
    nullableText(race.surface),
    nullableText(race.course),
    nullableText(race.going),
    sourceKind,
    sourceUrl,
    sourceFile,
    JSON.stringify(race),
  );

  db.prepare('DELETE FROM runners WHERE race_id = ?').run(raceId);
  db.prepare('DELETE FROM dividends WHERE race_id = ?').run(raceId);

  const insertRunner = db.prepare(`
    INSERT INTO runners (
      race_id, horse_no, horse_id, brand_no, horse_name, jockey, trainer, placing,
      actual_weight, declared_horse_weight, draw, lbw, running_position_json,
      finish_seconds, win_odds, raw_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const runner of race.runners ?? []) {
    insertRunner.run(
      raceId,
      nullableInteger(runner.horseNo),
      nullableText(runner.horseId),
      nullableText(runner.brandNo),
      nullableText(runner.horseName),
      nullableText(runner.jockey),
      nullableText(runner.trainer),
      nullableInteger(runner.placing),
      nullableInteger(runner.actualWeight),
      nullableInteger(runner.declaredHorseWeight),
      nullableInteger(runner.draw),
      nullableNumber(runner.lbw),
      JSON.stringify(runner.runningPosition ?? []),
      nullableNumber(runner.finishSeconds),
      nullableNumber(runner.winOdds),
      JSON.stringify(runner),
    );
  }

  const insertDividend = db.prepare(`
    INSERT INTO dividends (
      race_id, pool_key, pool, combination_key, combination_json, dividend_per10, raw_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const [poolKey, items] of Object.entries(race.dividends ?? {})) {
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const combination = Array.isArray(item.combination) ? item.combination.map(Number) : [];
      insertDividend.run(
        raceId,
        poolKey,
        item.pool ?? poolKey,
        combinationKey(combination, poolKey),
        JSON.stringify(combination),
        nullableNumber(item.dividendPer10),
        JSON.stringify(item),
      );
    }
  }
}

function collectJsonFiles(inputPath) {
  const absolute = path.resolve(inputPath);
  if (!existsSync(absolute)) throw new Error(`Input path does not exist: ${absolute}`);
  if (statSync(absolute).isFile()) return absolute.endsWith('.json') ? [absolute] : [];
  return readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(absolute, entry.name))
    .sort();
}

function normalizeRacePayload(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.races)) return parsed.races;
  return [parsed];
}

function countDividends(dividends) {
  return Object.values(dividends ?? {}).reduce((sum, items) => sum + (Array.isArray(items) ? items.length : 0), 0);
}

function countTable(db, table, where = null) {
  const sql = `SELECT COUNT(*) AS count FROM ${table}${where ? ` WHERE ${where}` : ''}`;
  return Number(db.prepare(sql).get().count);
}

function runnerFromRow(row) {
  return {
    placing: row.placing,
    horseNo: row.horse_no,
    horseId: row.horse_id,
    brandNo: row.brand_no,
    horseName: row.horse_name,
    jockey: row.jockey,
    trainer: row.trainer,
    actualWeight: row.actual_weight,
    declaredHorseWeight: row.declared_horse_weight,
    draw: row.draw,
    lbw: row.lbw,
    runningPosition: JSON.parse(row.running_position_json ?? '[]'),
    finishSeconds: row.finish_seconds,
    winOdds: row.win_odds,
  };
}

function dividendsFromRows(rows) {
  const dividends = {};
  for (const row of rows) {
    if (!dividends[row.pool_key]) dividends[row.pool_key] = [];
    dividends[row.pool_key].push({
      pool: row.pool,
      combination: JSON.parse(row.combination_json),
      dividendPer10: row.dividend_per10,
    });
  }
  return Object.keys(dividends).length > 0 ? dividends : null;
}

function oddsSnapshotFromRow(row) {
  return {
    raceId: row.race_id,
    date: row.date,
    racecourse: row.racecourse,
    raceNo: row.race_no,
    capturedAt: row.captured_at,
    minutesToPost: row.minutes_to_post,
    poolKey: row.pool_key,
    pool: row.pool,
    combination: JSON.parse(row.combination_json),
    oddsValue: row.odds_value,
    source: row.source,
    raw: JSON.parse(row.raw_json),
  };
}

function poolSnapshotFromRow(row) {
  return {
    raceId: row.race_id,
    date: row.date,
    racecourse: row.racecourse,
    raceNo: row.race_no,
    capturedAt: row.captured_at,
    minutesToPost: row.minutes_to_post,
    poolKey: row.pool_key,
    pool: row.pool,
    investment: row.investment,
    sellStatus: row.sell_status,
    source: row.source,
    raw: JSON.parse(row.raw_json),
  };
}

function recommendationRunFromRow(row) {
  return {
    runId: row.run_id,
    raceId: row.race_id,
    date: row.date,
    racecourse: row.racecourse,
    raceNo: row.race_no,
    generatedAt: row.generated_at,
    modelVersion: row.model_version,
    strategyVersion: row.strategy_version,
    bankroll: row.bankroll,
    finalEdgeBuffer: row.final_edge_buffer,
    recommendations: JSON.parse(row.recommendations_json),
    summary: JSON.parse(row.summary_json),
    raw: JSON.parse(row.raw_json),
  };
}

function combinationKey(combination, poolKey) {
  const numbers = combination.filter(Number.isFinite);
  if (poolKey === 'quinella' || poolKey === 'quinellaPlace') {
    numbers.sort((a, b) => a - b);
  }
  return numbers.join(',');
}

function normalizePoolKey(pool) {
  const text = String(pool ?? '').trim();
  if (!text) return '';
  const lower = text.toLowerCase().replaceAll(/[^a-z0-9]+/g, ' ');
  const words = lower.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  return words
    .map((word, index) => (index === 0 ? word : `${word[0].toUpperCase()}${word.slice(1)}`))
    .join('');
}

function normalizeCombination(value) {
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
  return String(value ?? '')
    .split(/[,+/\-\s]+/)
    .map(Number)
    .filter(Number.isFinite);
}

function buildRecommendationRunId(run) {
  const hash = createHash('sha256')
    .update(JSON.stringify({
      raceId: run.raceId,
      modelVersion: run.modelVersion,
      strategyVersion: run.strategyVersion,
      recommendations: run.recommendations ?? [],
    }))
    .digest('hex')
    .slice(0, 16);
  return `rec_${hash}`;
}

function nullableText(value) {
  return value == null || value === '' ? null : String(value);
}

function nullableInteger(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function nullableNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
