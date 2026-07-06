const DEFAULT_MAX_RANK = 4;

export function createRankingProbabilityModel(inputRunners, options = {}) {
  const runners = normalizeRunners(inputRunners);
  const byId = new Map(runners.map((runner) => [runner.horseId, runner]));
  const topKCache = new Map();
  const maxRank = Math.max(1, Number(options.maxRank ?? DEFAULT_MAX_RANK));

  function topKOrders(k) {
    const rank = Math.max(1, Math.min(Number(k) || 1, runners.length, maxRank));
    if (topKCache.has(rank)) return topKCache.get(rank);

    const orders = [];
    enumerateOrders({
      runners,
      rank,
      prefix: [],
      remainingTotal: 1,
      probability: 1,
      orders,
    });
    topKCache.set(rank, orders);
    return orders;
  }

  function winProbability(horseId) {
    return byId.get(normalizeId(horseId))?.winProbability ?? 0;
  }

  function orderedProbability(horseIds) {
    const ids = (horseIds ?? []).map(normalizeId).filter(Boolean);
    if (ids.length === 0 || ids.length > runners.length) return 0;
    if (new Set(ids).size !== ids.length) return 0;

    let remainingTotal = 1;
    let probability = 1;
    for (const id of ids) {
      const win = winProbability(id);
      if (win <= 0 || remainingTotal <= 0) return 0;
      probability *= win / remainingTotal;
      remainingTotal -= win;
    }
    return clampProbability(probability);
  }

  function unorderedTopKProbability(horseIds, k) {
    const ids = [...new Set((horseIds ?? []).map(normalizeId).filter(Boolean))];
    const rank = Math.max(1, Math.min(Number(k) || ids.length, runners.length, maxRank));
    if (ids.length === 0 || ids.length > rank) return 0;
    if (ids.some((id) => !byId.has(id))) return 0;

    let probability = 0;
    for (const order of topKOrders(rank)) {
      const orderSet = new Set(order.horseIds);
      if (ids.every((id) => orderSet.has(id))) {
        probability += order.probability;
      }
    }
    return clampProbability(probability);
  }

  function placeProbability(horseId, placeCutoff) {
    return unorderedTopKProbability([horseId], placeCutoff);
  }

  return {
    model: 'harville-plackett-luce',
    runners,
    placeProbability,
    orderedProbability,
    unorderedTopKProbability,
    winProbability,
  };
}

function enumerateOrders({ runners, rank, prefix, remainingTotal, probability, orders }) {
  if (prefix.length === rank) {
    orders.push({
      horseIds: prefix.map((runner) => runner.horseId),
      probability,
    });
    return;
  }

  for (const runner of runners) {
    if (prefix.some((item) => item.horseId === runner.horseId)) continue;
    if (remainingTotal <= 0) continue;
    const stepProbability = runner.winProbability / remainingTotal;
    enumerateOrders({
      runners,
      rank,
      prefix: [...prefix, runner],
      remainingTotal: remainingTotal - runner.winProbability,
      probability: probability * stepProbability,
      orders,
    });
  }
}

function normalizeRunners(inputRunners) {
  const runners = (inputRunners ?? [])
    .map((runner, index) => ({
      horseId: normalizeId(runner?.horseId ?? runner?.horseNo ?? runner?.horseName ?? index + 1),
      horseNo: runner?.horseNo ?? null,
      horseName: runner?.horseName ?? null,
      probability: Number(runner?.probability),
      original: runner,
    }))
    .filter((runner) => runner.horseId);

  if (runners.length === 0) return [];

  const totalPositive = runners.reduce((sum, runner) => (
    Number.isFinite(runner.probability) && runner.probability > 0
      ? sum + runner.probability
      : sum
  ), 0);

  if (totalPositive <= 0) {
    const uniform = 1 / runners.length;
    return runners.map((runner) => ({
      ...runner,
      winProbability: uniform,
    }));
  }

  return runners.map((runner) => ({
    ...runner,
    winProbability: Math.max(0, Number.isFinite(runner.probability) ? runner.probability : 0) / totalPositive,
  }));
}

function normalizeId(value) {
  if (value == null || value === '') return '';
  return String(value);
}

function clampProbability(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}
