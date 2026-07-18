import { recordOddsSnapshots, recordPoolSnapshot } from './sqlite-store.js';

export const DEFAULT_HKJC_GRAPHQL_ENDPOINT = 'https://info.cld.hkjc.com/graphql/base/';
export const DEFAULT_LIVE_MARKET_SOURCE = 'hkjc-live-graphql';
export const DEFAULT_LIVE_MARKET_ODDS_TYPES = ['WIN', 'PLA', 'QIN', 'QPL'];

const MAX_ODDS_TYPES_PER_CALL = 4;

const HKJC_POOL_LABELS = {
  WIN: 'WIN',
  PLA: 'PLACE',
  QIN: 'QUINELLA',
  QPL: 'QUINELLA PLACE',
  CWA: 'COMPOSITE WIN A',
  CWB: 'COMPOSITE WIN B',
  CWC: 'COMPOSITE WIN C',
  IWN: 'INVESTMENT WIN',
  FCT: 'FORECAST',
  TCE: 'TIERCE',
  TRI: 'TRIO',
  FF: 'FIRST FOUR',
  QTT: 'QUARTET',
  DBL: 'DOUBLE',
  TBL: 'TREBLE',
  DT: 'DOUBLE TRIO',
  TT: 'TRIPLE TRIO',
  SixUP: 'SIX UP',
};

export const HKJC_RACE_MEETINGS_QUERY = `
fragment raceFragment on Race {
  id
  no
  status
  raceName_en
  raceName_ch
  postTime
  country_en
  country_ch
  distance
  wageringFieldSize
  go_en
  go_ch
  ratingType
  raceTrack {
    description_en
    description_ch
  }
  raceCourse {
    description_en
    description_ch
    displayCode
  }
  claCode
  raceClass_en
  raceClass_ch
  judgeSigns {
    value_en
  }
}

fragment racingBlockFragment on RaceMeeting {
  jpEsts: pmPools(
    oddsTypes: [WIN, PLA, TCE, TRI, FF, QTT, DT, TT, SixUP]
    filters: ["jackpot", "estimatedDividend"]
  ) {
    leg {
      number
      races
    }
    oddsType
    jackpot
    estimatedDividend
    mergedPoolId
  }
  poolInvs: pmPools(
    oddsTypes: [WIN, PLA, QIN, QPL, CWA, CWB, CWC, IWN, FCT, TCE, TRI, FF, QTT, DBL, TBL, DT, TT, SixUP]
  ) {
    id
    leg {
      races
    }
  }
  penetrometerReadings(filters: ["first"]) {
    reading
    readingTime
  }
  hammerReadings(filters: ["first"]) {
    reading
    readingTime
  }
  changeHistories(filters: ["top3"]) {
    type
    time
    raceNo
    runnerNo
    horseName_ch
    horseName_en
    jockeyName_ch
    jockeyName_en
    scratchHorseName_ch
    scratchHorseName_en
    handicapWeight
    scrResvIndicator
  }
}

query raceMeetings($date: String, $venueCode: String) {
  timeOffset {
    rc
  }
  activeMeetings: raceMeetings {
    id
    venueCode
    date
    status
    races {
      no
      postTime
      status
      wageringFieldSize
    }
  }
  raceMeetings(date: $date, venueCode: $venueCode) {
    id
    status
    venueCode
    date
    totalNumberOfRace
    currentNumberOfRace
    dateOfWeek
    meetingType
    totalInvestment
    country {
      code
      namech
      nameen
      seq
    }
    races {
      ...raceFragment
      runners {
        id
        no
        standbyNo
        status
        name_ch
        name_en
        horse {
          id
          code
        }
        color
        barrierDrawNumber
        handicapWeight
        currentWeight
        currentRating
        internationalRating
        gearInfo
        racingColorFileName
        allowance
        trainerPreference
        last6run
        saddleClothNo
        trumpCard
        priority
        finalPosition
        deadHeat
        winOdds
        jockey {
          code
          name_en
          name_ch
        }
        trainer {
          code
          name_en
          name_ch
        }
      }
    }
    obSt: pmPools(oddsTypes: [WIN, PLA]) {
      leg {
        races
      }
      oddsType
      comingleStatus
    }
    poolInvs: pmPools(
      oddsTypes: [WIN, PLA, QIN, QPL, CWA, CWB, CWC, IWN, FCT, TCE, TRI, FF, QTT, DBL, TBL, DT, TT, SixUP]
    ) {
      id
      leg {
        number
        races
      }
      status
      sellStatus
      oddsType
      investment
      mergedPoolId
      lastUpdateTime
    }
    ...racingBlockFragment
    pmPools(oddsTypes: []) {
      id
    }
    jkcInstNo: foPools(oddsTypes: [JKC], filters: ["top"]) {
      instNo
    }
    tncInstNo: foPools(oddsTypes: [TNC], filters: ["top"]) {
      instNo
    }
  }
}`;

export const HKJC_HORSE_ODDS_QUERY = `
query racing($date: String, $venueCode: String, $oddsTypes: [OddsType], $raceNo: Int) {
  raceMeetings(date: $date, venueCode: $venueCode) {
    pmPools(oddsTypes: $oddsTypes, raceNo: $raceNo) {
      id
      status
      sellStatus
      oddsType
      lastUpdateTime
      guarantee
      minTicketCost
      name_en
      name_ch
      leg {
        number
        races
      }
      cWinSelections {
        composite
        name_ch
        name_en
        starters
      }
      oddsNodes {
        combString
        oddsValue
        hotFavourite
        oddsDropValue
        bankerOdds {
          combString
          oddsValue
        }
      }
    }
  }
}`;

export const HKJC_HORSE_POOL_QUERY = `
query racing($date: String, $venueCode: String, $oddsTypes: [OddsType], $raceNo: Int) {
  raceMeetings(date: $date, venueCode: $venueCode) {
    totalInvestment
    poolInvs: pmPools(oddsTypes: $oddsTypes, raceNo: $raceNo) {
      id
      leg {
        number
        races
      }
      status
      sellStatus
      oddsType
      investment
      mergedPoolId
      lastUpdateTime
    }
  }
}`;

export async function fetchLiveMarketPayload({
  date,
  venueCode,
  raceNos = [1],
  oddsTypes = DEFAULT_LIVE_MARKET_ODDS_TYPES,
  endpoint = DEFAULT_HKJC_GRAPHQL_ENDPOINT,
  requestTimeoutMs = 15000,
} = {}) {
  const normalizedDate = normalizeDate(date);
  const normalizedVenue = normalizeVenue(venueCode);
  if (!normalizedDate) throw new Error('fetchLiveMarketPayload requires date');
  if (!normalizedVenue) throw new Error('fetchLiveMarketPayload requires venueCode');

  const sourceResults = [];
  const meetingResponse = await requestHkjcGraphql({
    endpoint,
    query: HKJC_RACE_MEETINGS_QUERY,
    variables: { date: normalizedDate, venueCode: normalizedVenue },
    requestTimeoutMs,
  });
  sourceResults.push(sourceResult('raceMeetings', meetingResponse));

  const baseMeeting = firstMeeting(meetingResponse.payload) ?? {
    date: normalizedDate,
    venueCode: normalizedVenue,
    races: [],
  };
  const mergedMeeting = {
    ...baseMeeting,
    date: baseMeeting.date ?? normalizedDate,
    venueCode: baseMeeting.venueCode ?? normalizedVenue,
    pmPools: [],
    poolInvs: [],
  };

  const batches = chunk(oddsTypes.map(String).filter(Boolean), MAX_ODDS_TYPES_PER_CALL);
  for (const raceNo of raceNos.map(Number).filter(Number.isInteger)) {
    for (const batch of batches) {
      const variables = {
        date: normalizedDate,
        venueCode: normalizedVenue,
        raceNo,
        oddsTypes: batch,
      };
      const oddsResponse = await requestHkjcGraphql({
        endpoint,
        query: HKJC_HORSE_ODDS_QUERY,
        variables,
        requestTimeoutMs,
      });
      sourceResults.push(sourceResult(`odds:R${raceNo}:${batch.join(',')}`, oddsResponse));
      mergedMeeting.pmPools.push(...(firstMeeting(oddsResponse.payload)?.pmPools ?? []));

      const poolResponse = await requestHkjcGraphql({
        endpoint,
        query: HKJC_HORSE_POOL_QUERY,
        variables,
        requestTimeoutMs,
      });
      sourceResults.push(sourceResult(`pools:R${raceNo}:${batch.join(',')}`, poolResponse));
      const poolMeeting = firstMeeting(poolResponse.payload);
      if (poolMeeting?.totalInvestment != null) mergedMeeting.totalInvestment = poolMeeting.totalInvestment;
      mergedMeeting.poolInvs.push(...(poolMeeting?.poolInvs ?? []));
    }
  }

  return {
    payload: {
      data: {
        raceMeetings: [mergedMeeting],
      },
    },
    sourceResults,
  };
}

export function normalizeLiveMarketPayload({
  payload,
  source = DEFAULT_LIVE_MARKET_SOURCE,
  capturedAt = null,
  date = null,
  venueCode = null,
  raceNo = null,
} = {}) {
  const meetings = extractMeetings(payload);
  const raceFilter = raceNo == null ? null : new Set(String(raceNo).split(',').map((item) => Number(item)).filter(Number.isInteger));
  const capturedAtIso = capturedAt ? normalizeTimestamp(capturedAt) : null;
  const oddsSnapshots = [];
  const poolSnapshots = [];
  const summary = {
    source,
    meetings: meetings.length,
    oddsSnapshots: 0,
    poolSnapshots: 0,
    pools: {},
    races: [],
    skipped: {
      nonNumericOdds: 0,
      missingRace: 0,
      postTime: 0,
    },
  };
  const raceIds = new Set();

  for (const meeting of meetings) {
    const meetingDate = normalizeDate(meeting.date ?? date);
    const racecourse = normalizeVenue(meeting.venueCode ?? meeting.racecourse ?? venueCode);
    const raceByNo = buildRaceIndex(meeting.races);

    for (const pool of Array.isArray(meeting.pmPools) ? meeting.pmPools : []) {
      const currentRaceNo = poolRaceNo(pool, raceNo);
      if (!shouldKeepRace(currentRaceNo, raceFilter)) continue;
      const race = raceByNo.get(currentRaceNo);
      const observationTime = capturedAtIso ?? normalizeTimestamp(pool.lastUpdateTime);
      if (isAtOrAfterPostTime(race, observationTime)) {
        summary.skipped.postTime += 1;
        continue;
      }
      const raceMeta = buildRaceMeta({
        meetingDate,
        racecourse,
        raceNo: currentRaceNo,
        race,
        capturedAt: observationTime,
      });
      if (!raceMeta) {
        summary.skipped.missingRace += 1;
        continue;
      }

      const poolLabel = normalizePoolLabel(pool.oddsType);
      for (const oddsNode of Array.isArray(pool.oddsNodes) ? pool.oddsNodes : []) {
        const oddsValue = toNumber(oddsNode.oddsValue);
        if (!Number.isFinite(oddsValue) || oddsValue <= 0) {
          summary.skipped.nonNumericOdds += 1;
          continue;
        }

        const combination = parseCombination(oddsNode.combString);
        if (combination.length === 0) continue;

        oddsSnapshots.push({
          ...raceMeta,
          pool: poolLabel,
          combination,
          oddsValue,
          source,
          raw: {
            source,
            poolId: pool.id,
            oddsType: pool.oddsType,
            sellStatus: pool.sellStatus ?? pool.status ?? null,
            lastUpdateTime: pool.lastUpdateTime ?? null,
            oddsNode,
          },
        });
        summary.pools[poolLabel] = (summary.pools[poolLabel] ?? 0) + 1;
        summary.oddsSnapshots += 1;
        raceIds.add(raceMeta.raceId);
      }
    }

    for (const pool of Array.isArray(meeting.poolInvs) ? meeting.poolInvs : []) {
      const currentRaceNo = poolRaceNo(pool, raceNo);
      if (!shouldKeepRace(currentRaceNo, raceFilter)) continue;
      const race = raceByNo.get(currentRaceNo);
      const observationTime = capturedAtIso ?? normalizeTimestamp(pool.lastUpdateTime);
      if (isAtOrAfterPostTime(race, observationTime)) {
        summary.skipped.postTime += 1;
        continue;
      }
      const raceMeta = buildRaceMeta({
        meetingDate,
        racecourse,
        raceNo: currentRaceNo,
        race,
        capturedAt: observationTime,
      });
      if (!raceMeta) {
        summary.skipped.missingRace += 1;
        continue;
      }

      const investment = toNumber(pool.investment);
      poolSnapshots.push({
        ...raceMeta,
        pool: normalizePoolLabel(pool.oddsType),
        investment: Number.isFinite(investment) ? investment : null,
        sellStatus: pool.sellStatus ?? pool.status ?? null,
        source,
        raw: {
          source,
          poolId: pool.id,
          oddsType: pool.oddsType,
          investment: pool.investment ?? null,
          mergedPoolId: pool.mergedPoolId ?? null,
          lastUpdateTime: pool.lastUpdateTime ?? null,
        },
      });
      summary.poolSnapshots += 1;
      raceIds.add(raceMeta.raceId);
    }
  }

  summary.races = [...raceIds].sort();
  return { summary, oddsSnapshots, poolSnapshots };
}

export function importLiveMarketSnapshotsToDatabase({
  dbPath,
  oddsSnapshots,
  poolSnapshots,
}) {
  if (!dbPath) throw new Error('importLiveMarketSnapshotsToDatabase requires dbPath');
  if (!Array.isArray(oddsSnapshots)) throw new Error('importLiveMarketSnapshotsToDatabase requires oddsSnapshots');
  if (!Array.isArray(poolSnapshots)) throw new Error('importLiveMarketSnapshotsToDatabase requires poolSnapshots');

  recordOddsSnapshots({ dbPath, snapshots: oddsSnapshots });
  for (const snapshot of poolSnapshots) {
    recordPoolSnapshot({ dbPath, snapshot });
  }

  return {
    oddsSnapshots: oddsSnapshots.length,
    poolSnapshots: poolSnapshots.length,
  };
}

export function buildLiveMarketSnapshotReport({
  summary,
  oddsSnapshots,
  poolSnapshots,
  sourceResults = [],
  dryRun = false,
  database = null,
} = {}) {
  const odds = Array.isArray(oddsSnapshots) ? oddsSnapshots : [];
  const pools = Array.isArray(poolSnapshots) ? poolSnapshots : [];
  return {
    generatedAt: new Date().toISOString(),
    status: odds.length > 0 || pools.length > 0 ? 'ready' : 'no-live-market-data',
    dataSource: {
      source: summary?.source ?? DEFAULT_LIVE_MARKET_SOURCE,
      database,
    },
    summary: {
      ...(summary ?? {}),
      oddsSnapshots: odds.length,
      poolSnapshots: pools.length,
      races: summary?.races ?? [...new Set([...odds, ...pools].map((snapshot) => snapshot.raceId))].sort(),
      imported: !dryRun,
    },
    sourceResults,
    samples: {
      odds: odds.slice(0, 10),
      pools: pools.slice(0, 10),
    },
  };
}

async function requestHkjcGraphql({
  endpoint,
  query,
  variables,
  requestTimeoutMs,
}) {
  const startedAt = new Date().toISOString();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      origin: 'https://bet.hkjc.com',
      referer: 'https://bet.hkjc.com/',
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(Number(requestTimeoutMs)),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    // Keep payload null; caller records the non-JSON source result.
  }
  if (!response.ok) {
    throw new Error(`HKJC GraphQL request failed: ${response.status} ${response.statusText}`);
  }
  if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
    const message = payload.errors.map((error) => error.message).filter(Boolean).join('; ');
    throw new Error(`HKJC GraphQL returned errors: ${message || 'unknown error'}`);
  }

  return {
    ok: true,
    status: response.status,
    contentType: response.headers.get('content-type'),
    startedAt,
    finishedAt: new Date().toISOString(),
    variables,
    payload,
  };
}

function sourceResult(label, response) {
  return {
    label,
    ok: response.ok,
    status: response.status,
    contentType: response.contentType,
    startedAt: response.startedAt,
    finishedAt: response.finishedAt,
    variables: response.variables,
    meetings: extractMeetings(response.payload).length,
  };
}

function firstMeeting(payload) {
  return extractMeetings(payload)[0] ?? null;
}

function extractMeetings(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.raceMeetings)) return payload.raceMeetings;
  if (Array.isArray(payload?.data?.raceMeetings)) return payload.data.raceMeetings;
  return [];
}

function buildRaceIndex(races) {
  const index = new Map();
  for (const race of Array.isArray(races) ? races : []) {
    const raceNo = toInteger(race.no ?? race.raceNo);
    if (Number.isInteger(raceNo)) index.set(raceNo, race);
  }
  return index;
}

function buildRaceMeta({
  meetingDate,
  racecourse,
  raceNo,
  race,
  capturedAt,
}) {
  const normalizedRaceNo = toInteger(raceNo);
  if (!meetingDate || !racecourse || !Number.isInteger(normalizedRaceNo) || !capturedAt) return null;
  const postTime = normalizeTimestamp(race?.postTime);
  return {
    raceId: `${meetingDate}-${racecourse}-${normalizedRaceNo}`,
    date: meetingDate,
    racecourse,
    raceNo: normalizedRaceNo,
    capturedAt,
    minutesToPost: postTime ? Math.round((new Date(postTime).getTime() - new Date(capturedAt).getTime()) / 60000) : null,
  };
}

function isAtOrAfterPostTime(race, observedAt) {
  const postTime = normalizeTimestamp(race?.postTime);
  if (!postTime || !observedAt) return false;
  const observedAtMs = new Date(observedAt).getTime();
  const postTimeMs = new Date(postTime).getTime();
  return Number.isFinite(observedAtMs)
    && Number.isFinite(postTimeMs)
    && observedAtMs >= postTimeMs;
}

function poolRaceNo(pool, fallbackRaceNo) {
  const races = pool?.leg?.races;
  if (Array.isArray(races) && races.length > 0) return toInteger(races[0]);
  return toInteger(pool?.leg?.number ?? fallbackRaceNo);
}

function shouldKeepRace(raceNo, raceFilter) {
  if (!raceFilter) return true;
  return Number.isInteger(raceNo) && raceFilter.has(raceNo);
}

function parseCombination(value) {
  return String(value ?? '')
    .match(/\d+/g)
    ?.map(Number)
    .filter(Number.isFinite) ?? [];
}

function normalizePoolLabel(value) {
  const key = String(value ?? '').trim();
  return HKJC_POOL_LABELS[key] ?? key.toUpperCase();
}

function normalizeVenue(value) {
  const text = String(value ?? '').trim().toUpperCase();
  return text || null;
}

function normalizeDate(value) {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function normalizeTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function toInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
