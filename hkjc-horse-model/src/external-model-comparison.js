import { buildRaceForecast, trainStateFromRaces } from './model.js';
import { validateProbabilityArtifact } from './probability-artifact.js';

const MODEL_DEFINITIONS = [
  {
    modelId: 'hkjc-current-heuristic',
    label: 'Current HKJC local heuristic',
    status: 'available',
    source: 'local',
    note: 'Existing rolling local model used by the dashboard.',
  },
  {
    modelId: 'catowabisabi-lgb-no-odds-proxy',
    label: 'catowabisabi LightGBM no-odds inspired proxy',
    status: 'proxy',
    source: 'catowabisabi/horse-racing-model-training',
    note: 'No-odds fundamental ranker plus top-2 Quinella box. This is not the original LightGBM artifact.',
    referenceMetrics: {
      headline: '+2.6% OOS ROI',
      detail: 'Public project note: 2017 Quinella validation +7.9% ROI; 2018 H1 OOS +2.6% ROI. Local output is a proxy until independently replayed.',
      quinellaRoi2017: 0.079,
      quinellaRoi2018H1: 0.026,
    },
  },
  {
    modelId: 'jerrydaphantom-market-free-calibrated-proxy',
    label: 'jerrydaphantom market-free calibrated proxy',
    status: 'proxy',
    source: 'jerrydaphantom/hkjc-ml-research',
    note: 'Uses the local numpy logit report with race normalization as a calibration proxy.',
  },
  {
    modelId: 'jerrydaphantom-catboost-market-aware',
    label: 'jerrydaphantom CatBoost market-aware',
    status: 'pending-live-market',
    source: 'jerrydaphantom/hkjc-ml-research',
    note: 'Requires live WIN odds. Before T-30/T-10/T-3 market snapshots, this model is intentionally not emitted as a cash prediction.',
    referenceMetrics: {
      topPickWinRate: 0.327,
      logLoss: 0.234958,
      brierScore: 0.065478,
      winnerInTop3Rate: 0.6214,
      detail: 'Public market-aware CatBoost benchmark; local validation requires our own live odds and pool snapshots.',
    },
  },
  {
    modelId: 'hkjc-live-market-baseline',
    label: 'HKJC live market baseline',
    status: 'pending-live-market',
    source: 'HKJC live WIN odds',
    note: 'Normalized public WIN odds baseline for comparing model vs market probabilities on the same upcoming race.',
  },
];

export function buildExternalModelComparison({
  settledRaces = [],
  upcomingRaces = [],
  trainingReport = null,
  marketOddsByRunner = new Map(),
  marketAwareBundlesByRace = new Map(),
  generatedAt = new Date().toISOString(),
  options = {},
} = {}) {
  const settled = uniqueRaces(settledRaces).sort(compareRaces);
  const upcoming = uniqueRaces(upcomingRaces)
    .filter((race) => Array.isArray(race.runners) && race.runners.length > 0)
    .sort(compareRaces);
  const trainedState = trainStateFromRaces(settled, options);
  const asOfRowsByRace = buildAsOfRowsByRace({
    settledRaces: settled,
    targetRaces: upcoming,
    marketOddsByRunner,
  });

  const races = upcoming.map((race) => {
    const currentForecast = buildRaceForecast(race, trainedState, {
      ...options,
      allowProbabilityOnly: true,
    });
    const asOfRows = asOfRowsByRace.get(race.raceId) ?? [];
    const currentPredictions = sanitizePredictions(currentForecast.predictions ?? []);
    const catowabisabiPredictions = rankRowsByScore(
      asOfRows,
      catowabisabiFundamentalScore,
      'catowabisabi-lgb-no-odds-proxy',
    );
    const jerryMarketFreePredictions = trainingReport?.weights?.length
      ? rankRowsByScore(
        asOfRows,
        (row) => logitScore(row, trainingReport),
        'jerrydaphantom-market-free-calibrated-proxy',
        { input: 'sigmoid-normalized-logit' },
      )
      : [];
    const marketBaselinePredictions = buildMarketBaselinePredictions({ rows: asOfRows });
    const marketAwarePredictions = buildMarketAwarePredictions({
      race,
      rows: asOfRows,
      basePredictions: jerryMarketFreePredictions.length ? jerryMarketFreePredictions : catowabisabiPredictions,
      marketAwareBundle: marketAwareBundlesByRace.get(race.raceId) ?? null,
    });

    const currentTopPick = currentPredictions[0] ?? null;
    const catTopPick = catowabisabiPredictions[0] ?? null;
    const jerryTopPick = jerryMarketFreePredictions[0] ?? null;
    const marketAwareTopPick = marketAwarePredictions.status === 'available'
      ? marketAwarePredictions.predictions[0] ?? null
      : null;
    const marketBaselineTopPick = marketBaselinePredictions.status === 'available'
      ? marketBaselinePredictions.predictions[0] ?? null
      : null;

    return {
      raceId: race.raceId,
      date: race.date,
      racecourse: race.racecourse,
      raceNo: race.raceNo,
      raceName: race.raceName ?? null,
      startTime: race.startTime ?? null,
      fieldSize: race.runners.length,
      models: [
        modelRaceResult('hkjc-current-heuristic', currentPredictions),
        {
          ...modelRaceResult('catowabisabi-lgb-no-odds-proxy', catowabisabiPredictions),
          topQuinellaBox: topHorseNos(catowabisabiPredictions, 2),
          quinellaStrategy: {
            pool: 'QIN',
            mode: 'top-2-box',
            status: 'paper-only',
            note: 'Original project found the no-odds top-2 Quinella idea most interesting; local proxy needs validation before cash mode.',
          },
        },
        modelRaceResult('jerrydaphantom-market-free-calibrated-proxy', jerryMarketFreePredictions),
        {
          ...modelRaceResult('jerrydaphantom-catboost-market-aware', marketAwarePredictions.predictions),
          status: marketAwarePredictions.status,
          topPick: marketAwareTopPick,
          note: marketAwarePredictions.note,
          researchMode: marketAwarePredictions.researchMode ?? null,
          executionStatus: marketAwarePredictions.executionStatus ?? null,
          probabilityStatus: marketAwarePredictions.probabilityStatus ?? null,
          artifactId: marketAwarePredictions.artifactId ?? null,
          featurePolicyId: marketAwarePredictions.featurePolicyId ?? null,
          calibrationMethod: marketAwarePredictions.calibrationMethod ?? null,
          trainingCutoff: marketAwarePredictions.trainingCutoff ?? null,
          lineage: marketAwarePredictions.lineage ?? null,
        },
        {
          ...modelRaceResult('hkjc-live-market-baseline', marketBaselinePredictions.predictions),
          status: marketBaselinePredictions.status,
          topPick: marketBaselineTopPick,
          note: marketBaselinePredictions.note,
        },
      ],
      comparison: {
        currentTopPick,
        catowabisabi: {
          topPick: catTopPick,
          topQuinellaBox: topHorseNos(catowabisabiPredictions, 2),
          sameTopPickAsCurrent: sameHorse(currentTopPick, catTopPick),
        },
        jerrydaphantomMarketFree: {
          topPick: jerryTopPick,
          sameTopPickAsCurrent: sameHorse(currentTopPick, jerryTopPick),
        },
        jerrydaphantomMarketAware: {
          status: marketAwarePredictions.status,
          topPick: marketAwareTopPick,
          sameTopPickAsCurrent: sameHorse(currentTopPick, marketAwareTopPick),
          note: marketAwarePredictions.note,
        },
        marketBaseline: {
          status: marketBaselinePredictions.status,
          topPick: marketBaselineTopPick,
          sameTopPickAsCurrent: sameHorse(currentTopPick, marketBaselineTopPick),
          note: marketBaselinePredictions.note,
        },
        agreementSummary: summarizeAgreement({
          currentTopPick,
          catTopPick,
          jerryTopPick,
          marketAwareTopPick,
          marketAwareStatus: marketAwarePredictions.status,
          marketBaselineTopPick,
          marketBaselineStatus: marketBaselinePredictions.status,
        }),
      },
    };
  });

  return {
    generatedAt,
    scope: 'upcoming HKJC races; external projects are proxies unless marked available',
    summary: {
      settledRaces: settled.length,
      upcomingRaces: races.length,
      modelCount: MODEL_DEFINITIONS.length,
      marketAwareReadyRaces: races.filter((race) => (
        race.comparison.jerrydaphantomMarketAware.status === 'available'
      )).length,
      marketBaselineReadyRaces: races.filter((race) => (
        race.comparison.marketBaseline.status === 'available'
      )).length,
      marketAwareShadowRaces: races.filter((race) => (
        race.models.some((model) => (
          model.modelId === 'jerrydaphantom-catboost-market-aware'
          && model.status === 'available'
          && model.researchMode === 'SHADOW'
        ))
      )).length,
    },
    models: MODEL_DEFINITIONS,
    races,
    responsibleUse: 'Research and paper comparison only. Do not treat proxy output as a guarantee of profit.',
  };
}

function buildAsOfRowsByRace({ settledRaces, targetRaces, marketOddsByRunner = new Map() }) {
  const state = createAsOfState();
  for (const race of settledRaces) {
    if (!Array.isArray(race.runners)) continue;
    if (!race.runners.some((runner) => Number.isFinite(runner.placing))) continue;
    updateStateWithRace(state, race);
  }

  const rowsByRace = new Map();
  for (const race of targetRaces) {
    const fieldSize = race.runners.length;
    const rows = race.runners.map((runner) => {
      const horseId = stableId(runner.horseId ?? runner.horseName ?? runner.horseNo);
      const jockeyId = stableId(runner.jockey);
      const trainerId = stableId(runner.trainer);
      const horseStats = state.horses.get(horseId) ?? emptyStats();
      const jockeyStats = state.jockeys.get(jockeyId) ?? emptyStats();
      const trainerStats = state.trainers.get(trainerId) ?? emptyStats();
      const distanceStats = state.distanceSurface.get(distanceSurfaceKey(horseId, race)) ?? emptyStats();

      const marketOdds = marketOddsByRunner.get(`${race.raceId}|${runner.horseNo}`) ?? {};

      return {
        raceId: race.raceId,
        date: race.date,
        racecourse: race.racecourse,
        raceNo: race.raceNo,
        horseId,
        horseNo: runner.horseNo ?? null,
        horseName: runner.horseName ?? null,
        winOdds: numericOrNull(marketOdds.winOdds ?? runner.winOdds),
        features: {
          distance: numericOrNull(race.distance),
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
          distanceSurfaceStartsBefore: distanceStats.runs,
          distanceSurfaceWinRateBefore: rate(distanceStats.wins, distanceStats.runs),
          distanceSurfacePlaceRateBefore: rate(distanceStats.places, distanceStats.runs),
        },
      };
    });
    rowsByRace.set(race.raceId, rows);
  }
  return rowsByRace;
}

function rankRowsByScore(rows, scorer, modelId, metadata = {}) {
  if (!rows.length) return [];
  const rawScores = rows.map((row) => scorer(row));
  const probabilities = softmax(rawScores, metadata.temperature ?? 1);
  return rows
    .map((row, index) => ({
      modelId,
      horseId: row.horseId,
      horseNo: row.horseNo,
      horseName: row.horseName,
      probability: round(probabilities[index], 6),
      fairOdds: probabilities[index] > 0 ? round(1 / probabilities[index], 3) : null,
      score: round(rawScores[index], 6),
      winOdds: row.winOdds ?? null,
      input: metadata.input ?? 'as-of-fundamental-features',
    }))
    .sort(comparePredictions);
}

function catowabisabiFundamentalScore(row) {
  const f = row.features ?? {};
  const fieldSize = value(f.fieldSize, 12);
  const draw = value(f.draw, (fieldSize + 1) / 2);
  const idealDraw = Math.max(1, Math.min(fieldSize, (fieldSize + 1) / 2));
  return (
    1.65 * value(f.horseWinRateBefore)
    + 0.85 * value(f.horsePlaceRateBefore)
    + 0.70 * value(f.jockeyWinRateBefore)
    + 0.58 * value(f.trainerWinRateBefore)
    + 0.52 * value(f.distanceSurfaceWinRateBefore)
    + 0.28 * value(f.distanceSurfacePlaceRateBefore)
    + 0.055 * Math.log1p(value(f.horseRunsBefore))
    + 0.025 * Math.log1p(value(f.jockeyRunsBefore))
    + 0.020 * Math.log1p(value(f.trainerRunsBefore))
    - 0.020 * Math.abs(draw - idealDraw)
    - 0.0015 * Math.max(0, value(f.daysSinceLastRun, 28) - 45)
  );
}

function logitScore(row, report) {
  const features = report.features ?? [];
  const weights = report.weights ?? [];
  const means = report.featureMeans ?? [];
  const stds = report.featureStds ?? [];
  let z = Number(weights[0] ?? 0);
  for (let index = 0; index < features.length; index += 1) {
    const rawValue = value(row.features?.[features[index]]);
    const mean = Number.isFinite(Number(means[index])) ? Number(means[index]) : 0;
    const std = Number.isFinite(Number(stds[index])) && Number(stds[index]) > 1e-9 ? Number(stds[index]) : 1;
    z += Number(weights[index + 1] ?? 0) * ((rawValue - mean) / std);
  }
  return sigmoid(z);
}

function buildMarketAwarePredictions({ race, rows, basePredictions, marketAwareBundle = null }) {
  if (marketAwareBundle) {
    return buildShadowMarketAwarePredictions({
      race,
      rows,
      bundle: marketAwareBundle,
    });
  }
  if (!rows.some((row) => Number.isFinite(row.winOdds) && row.winOdds > 1)) {
    return {
      status: 'pending-live-market',
      predictions: [],
      note: 'No usable live WIN odds in the race card/database yet. Re-run near T-30/T-10/T-3 after live odds snapshots are imported.',
    };
  }

  const baseByHorse = new Map(basePredictions.map((prediction) => [stableId(prediction.horseId), prediction]));
  const implied = rows.map((row) => (Number.isFinite(row.winOdds) && row.winOdds > 1 ? 1 / row.winOdds : 0));
  const impliedTotal = implied.reduce((sum, item) => sum + item, 0) || 1;
  const scores = rows.map((row, index) => {
    const base = baseByHorse.get(row.horseId)?.probability ?? 1 / rows.length;
    const market = implied[index] / impliedTotal;
    return Math.sqrt(Math.max(base, 0.000001) * Math.max(market, 0.000001));
  });
  const total = scores.reduce((sum, item) => sum + item, 0) || 1;
  const predictions = rows
    .map((row, index) => {
      const probability = scores[index] / total;
      return {
        modelId: 'jerrydaphantom-catboost-market-aware',
        horseId: row.horseId,
        horseNo: row.horseNo,
        horseName: row.horseName,
        probability: round(probability, 6),
        fairOdds: probability > 0 ? round(1 / probability, 3) : null,
        winOdds: row.winOdds,
        input: 'fundamental-market-geometric-blend-proxy',
      };
    })
    .sort(comparePredictions);

  return {
    status: 'available',
    predictions,
    note: 'Live WIN odds were available, so this uses a Benter-style geometric blend as a market-aware proxy.',
  };
}

function buildShadowMarketAwarePredictions({ race, rows, bundle }) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    return {
      status: 'bundle-invalid',
      predictions: [],
      note: 'The supplied shadow bundle is not a valid object.',
    };
  }

  const raceId = race?.raceId ?? rows[0]?.raceId ?? null;
  let validatedBundle;
  try {
    validatedBundle = validateProbabilityArtifact(bundle, {
      raceId,
      postAt: racePostAt(race),
    });
  } catch (error) {
    return {
      status: 'bundle-invalid',
      predictions: [],
      note: `The supplied shadow bundle failed validation: ${error.message}`,
    };
  }
  const runnerLookup = new Map(rows.map((row) => [stableId(row.runnerId ?? row.horseId), row]));
  const predictions = [];
  for (const prediction of validatedBundle.predictions) {
    const key = stableId(prediction.runnerId);
    const row = runnerLookup.get(key);
    if (!row || prediction.raceId !== raceId) {
      return {
        status: 'bundle-runner-mismatch',
        predictions: [],
        note: 'The supplied shadow bundle does not match the upcoming race runners.',
      };
    }
    predictions.push({
      modelId: 'jerrydaphantom-catboost-market-aware',
      horseId: row.horseId,
      horseNo: row.horseNo,
      horseName: row.horseName,
      probability: round(Number(prediction.probability), 6),
      fairOdds: Number(prediction.probability) > 0 ? round(1 / Number(prediction.probability), 3) : null,
      winOdds: row.winOdds ?? null,
      input: 'frozen-shadow-score-bundle',
    });
  }
  if (predictions.length !== runnerLookup.size) {
    return {
      status: 'bundle-runner-mismatch',
      predictions: [],
      note: 'The supplied shadow bundle does not cover every upcoming race runner.',
    };
  }

  predictions.sort(comparePredictions);
  return {
    status: 'available',
    predictions,
    note: 'Using the frozen CatBoost shadow bundle for this upcoming race.',
    researchMode: validatedBundle.researchMode,
    executionStatus: validatedBundle.executionStatus,
    probabilityStatus: validatedBundle.probabilityStatus,
    artifactId: validatedBundle.artifactId,
    featurePolicyId: validatedBundle.featurePolicyId,
    calibrationMethod: validatedBundle.calibrationMethod,
    trainingCutoff: validatedBundle.trainingCutoff,
    lineage: validatedBundle.lineage,
  };
}

function racePostAt(race) {
  const date = String(race?.date ?? '').trim();
  const startTime = String(race?.startTime ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}(?::\d{2})?$/.test(startTime)) {
    throw new Error('upcoming race must include date and startTime for shadow bundle validation');
  }
  const time = startTime.length === 5 ? `${startTime}:00` : startTime;
  return `${date}T${time}+08:00`;
}

function buildMarketBaselinePredictions({ rows }) {
  if (!rows.some((row) => Number.isFinite(row.winOdds) && row.winOdds > 1)) {
    return {
      status: 'pending-live-market',
      predictions: [],
      note: 'No usable live WIN odds in the race card/database yet, so the market baseline is not available.',
    };
  }

  const implied = rows.map((row) => (Number.isFinite(row.winOdds) && row.winOdds > 1 ? 1 / row.winOdds : 0));
  const impliedTotal = implied.reduce((sum, item) => sum + item, 0) || 1;
  return {
    status: 'available',
    predictions: rows
      .map((row, index) => {
        const probability = implied[index] / impliedTotal;
        return {
          modelId: 'hkjc-live-market-baseline',
          horseId: row.horseId,
          horseNo: row.horseNo,
          horseName: row.horseName,
          probability: round(probability, 6),
          fairOdds: probability > 0 ? round(1 / probability, 3) : null,
          winOdds: row.winOdds,
          input: 'normalized-live-win-odds',
        };
      })
      .sort(comparePredictions),
    note: 'Normalized live WIN odds baseline for side-by-side market comparison.',
  };
}

function sanitizePredictions(predictions) {
  return (predictions ?? [])
    .map((prediction) => ({
      modelId: 'hkjc-current-heuristic',
      horseId: stableId(prediction.horseId ?? prediction.horseName ?? prediction.horseNo),
      horseNo: prediction.horseNo ?? null,
      horseName: prediction.horseName ?? null,
      probability: round(prediction.probability, 6),
      fairOdds: Number.isFinite(prediction.fairOdds) ? round(prediction.fairOdds, 3) : null,
      winOdds: prediction.winOdds ?? null,
      input: 'dashboard-current-forecast',
    }))
    .sort(comparePredictions);
}

function modelRaceResult(modelId, predictions) {
  return {
    modelId,
    status: predictions.length ? 'available' : 'unavailable',
    predictions,
    topPick: predictions[0] ?? null,
    top3: predictions.slice(0, 3),
  };
}

function summarizeAgreement({
  currentTopPick,
  catTopPick,
  jerryTopPick,
  marketAwareTopPick,
  marketAwareStatus,
  marketBaselineTopPick,
  marketBaselineStatus,
}) {
  const parts = [];
  parts.push(`current vs catowabisabi: ${sameHorse(currentTopPick, catTopPick) ? 'same' : 'different'}`);
  parts.push(`current vs jerrydaphantom-free: ${sameHorse(currentTopPick, jerryTopPick) ? 'same' : 'different'}`);
  if (marketAwareStatus === 'available') {
    parts.push(`current vs jerrydaphantom-market: ${sameHorse(currentTopPick, marketAwareTopPick) ? 'same' : 'different'}`);
  } else {
    parts.push('jerrydaphantom-market: pending live odds');
  }
  if (marketBaselineStatus === 'available') {
    parts.push(`current vs live-market: ${sameHorse(currentTopPick, marketBaselineTopPick) ? 'same' : 'different'}`);
  } else {
    parts.push('live-market: pending live odds');
  }
  return parts.join('; ');
}

function topHorseNos(predictions, limit) {
  return predictions.slice(0, limit).map((prediction) => prediction.horseNo);
}

function sameHorse(a, b) {
  if (!a || !b) return false;
  return stableId(a.horseId) === stableId(b.horseId)
    || (a.horseNo != null && b.horseNo != null && Number(a.horseNo) === Number(b.horseNo));
}

function createAsOfState() {
  return {
    horses: new Map(),
    jockeys: new Map(),
    trainers: new Map(),
    distanceSurface: new Map(),
  };
}

function updateStateWithRace(state, race) {
  const placeCutoff = race.runners.length <= 6 ? 2 : 3;
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

function emptyStats() {
  return {
    runs: 0,
    wins: 0,
    places: 0,
    totalLbw: 0,
    lastDate: null,
  };
}

function distanceSurfaceKey(horseId, race) {
  return [horseId, race.racecourse, race.distance, race.surface]
    .map((item) => item ?? '')
    .join('|');
}

function uniqueRaces(races) {
  const seen = new Set();
  const unique = [];
  for (const race of races ?? []) {
    const key = race.raceId ?? `${race.date}-${race.racecourse}-${race.raceNo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(race);
  }
  return unique;
}

function compareRaces(a, b) {
  return String(a.date).localeCompare(String(b.date))
    || String(a.racecourse).localeCompare(String(b.racecourse))
    || Number(a.raceNo ?? 0) - Number(b.raceNo ?? 0);
}

function comparePredictions(a, b) {
  return Number(b.probability ?? 0) - Number(a.probability ?? 0)
    || Number(a.horseNo ?? 999) - Number(b.horseNo ?? 999);
}

function softmax(scores, temperature = 1) {
  const scaled = scores.map((score) => Number(score) / Math.max(0.000001, temperature));
  const max = Math.max(...scaled);
  const exp = scaled.map((score) => Math.exp(score - max));
  const total = exp.reduce((sum, value) => sum + value, 0) || 1;
  return exp.map((value) => value / total);
}

function sigmoid(value) {
  const z = Math.max(-35, Math.min(35, Number(value) || 0));
  return 1 / (1 + Math.exp(-z));
}

function rate(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function daysBetween(from, to) {
  const ms = Date.parse(to) - Date.parse(from);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round(ms / 86400000));
}

function numericOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stableId(value) {
  if (value == null || value === '') return '';
  return String(value);
}

function value(raw, fallback = 0) {
  const number = Number(raw);
  return Number.isFinite(number) ? number : fallback;
}

function round(raw, digits = 6) {
  const number = Number(raw);
  if (!Number.isFinite(number)) return null;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}
