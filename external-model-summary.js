export function buildExternalComparisonSummary(report = {}) {
  const races = Array.isArray(report.races) ? report.races : [];
  const rows = races
    .map((race) => {
      const comparison = race?.comparison ?? {};
      const currentTopPick = normalizePick(comparison.currentTopPick);
      const catTopPick = normalizePick(comparison.catowabisabi?.topPick);
      const marketAwareTopPick = normalizePick(comparison.jerrydaphantomMarketAware?.topPick);
      const topQuinellaBox = Array.isArray(comparison.catowabisabi?.topQuinellaBox)
        ? comparison.catowabisabi.topQuinellaBox.filter((horseNo) => horseNo !== null && horseNo !== undefined)
        : [];
      const marketAwareStatus = comparison.jerrydaphantomMarketAware?.status ?? "unavailable";

      return {
        raceId: race?.raceId ?? null,
        raceNo: numericOrNull(race?.raceNo),
        startTime: race?.startTime ?? null,
        fieldSize: numericOrNull(race?.fieldSize),
        currentTopPick,
        catowabisabi: {
          ...catTopPick,
          topQuinellaBox,
          topQuinellaBoxLabel: topQuinellaBox.length ? topQuinellaBox.join(" + ") : "-",
        },
        jerrydaphantomMarketAware: {
          ...marketAwareTopPick,
          status: marketAwareStatus,
          ready: marketAwareStatus === "available",
        },
        agreement: {
          currentVsCat: sameHorse(currentTopPick, catTopPick),
          currentVsMarketAware: sameHorse(currentTopPick, marketAwareTopPick),
          allSame: sameHorse(currentTopPick, catTopPick) && sameHorse(currentTopPick, marketAwareTopPick),
        },
        agreementSummary: comparison.agreementSummary ?? "",
      };
    })
    .sort((left, right) => (left.raceNo ?? 999) - (right.raceNo ?? 999));

  return {
    generatedAt: report.generatedAt ?? null,
    scope: report.scope ?? "",
    upcomingRaces: numberOrDefault(report.summary?.upcomingRaces, rows.length),
    marketAwareReadyRaces: numberOrDefault(
      report.summary?.marketAwareReadyRaces,
      rows.filter((row) => row.jerrydaphantomMarketAware.ready).length,
    ),
    currentVsCatSame: rows.filter((row) => row.agreement.currentVsCat).length,
    currentVsMarketSame: rows.filter((row) => row.agreement.currentVsMarketAware).length,
    allSame: rows.filter((row) => row.agreement.allSame).length,
    rows,
  };
}

export function externalModelBenchmarkCards(report = {}) {
  const models = Array.isArray(report.models) ? report.models : [];
  return models
    .filter((model) => model?.referenceMetrics)
    .map((model) => {
      const metrics = model.referenceMetrics ?? {};
      if (model.modelId === "catowabisabi-lgb-no-odds-proxy") {
        return {
          modelId: model.modelId,
          label: model.label ?? model.modelId,
          source: model.source ?? "",
          primary: metrics.headline ?? formatSignedPercent(metrics.quinellaRoi2018H1, "OOS ROI"),
          secondary: metrics.detail ?? "Public Quinella benchmark; local implementation is proxy only.",
        };
      }
      if (model.modelId === "jerrydaphantom-catboost-market-aware") {
        return {
          modelId: model.modelId,
          label: model.label ?? model.modelId,
          source: model.source ?? "",
          primary: Number.isFinite(metrics.topPickWinRate)
            ? `${(metrics.topPickWinRate * 100).toFixed(1)}% Top Pick`
            : metrics.headline ?? "Market-aware benchmark",
          secondary: [
            Number.isFinite(metrics.logLoss) ? `LogLoss ${metrics.logLoss.toFixed(4)}` : null,
            Number.isFinite(metrics.brierScore) ? `Brier ${metrics.brierScore.toFixed(4)}` : null,
          ].filter(Boolean).join(" · ") || metrics.detail || "Public market-aware benchmark; not local validation yet.",
        };
      }
      return {
        modelId: model.modelId ?? "unknown",
        label: model.label ?? model.modelId ?? "External model",
        source: model.source ?? "",
        primary: metrics.headline ?? "Public benchmark",
        secondary: metrics.detail ?? "External benchmark; local validation pending.",
      };
    });
}

function normalizePick(pick) {
  if (!pick) {
    return {
      horseNo: null,
      horseName: "",
      probability: null,
      winOdds: null,
      fairOdds: null,
      label: "-",
    };
  }
  const horseNo = numericOrNull(pick.horseNo);
  const horseName = pick.horseName ?? "";
  return {
    horseNo,
    horseName,
    probability: numericOrNull(pick.probability),
    winOdds: numericOrNull(pick.winOdds),
    fairOdds: numericOrNull(pick.fairOdds),
    label: horseNo === null ? horseName || "-" : `#${horseNo}${horseName ? ` ${horseName}` : ""}`,
  };
}

function sameHorse(left, right) {
  return left?.horseNo !== null
    && left?.horseNo !== undefined
    && right?.horseNo !== null
    && right?.horseNo !== undefined
    && Number(left.horseNo) === Number(right.horseNo);
}

function numberOrDefault(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function numericOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatSignedPercent(value, label) {
  if (!Number.isFinite(value)) return label;
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}% ${label}`;
}
