// Read-only, public HKJC price feed. Never send credentials or local model data.
export const HKJC_BROWSER_ODDS_ENDPOINT = 'https://info.cld.hkjc.com/graphql/base/';
export const HKJC_BROWSER_ODDS_QUERY = `
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

const ODDS_TYPES = ['WIN', 'PLA', 'QIN', 'QPL'];
const SELLING_STATUSES = new Set(['SELLING', 'OPEN', 'SALE_OPEN', 'START_SELL', 'START_SELLING']);
const POOL_BY_BET_TYPE = {
  WIN: 'WIN', PLACE: 'PLA', QUINELLA: 'QIN', QUINELLA_PLACE: 'QPL',
};

export async function fetchLiveRaceOdds({
  date,
  venueCode,
  raceNo,
  now = new Date(),
  fetchImpl = fetch,
  signal,
} = {}) {
  const normalizedVenue = String(venueCode ?? '').toUpperCase();
  const normalizedRaceNo = Number(raceNo);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))
    || !['ST', 'HV'].includes(normalizedVenue)
    || !Number.isInteger(normalizedRaceNo)
    || normalizedRaceNo < 1
    || normalizedRaceNo > 15) {
    throw new Error('无效的香港本地赛事资料');
  }
  const response = await fetchImpl(HKJC_BROWSER_ODDS_ENDPOINT, {
    method: 'POST',
    mode: 'cors',
    cache: 'no-store',
    credentials: 'omit',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      query: HKJC_BROWSER_ODDS_QUERY,
      variables: { date, venueCode: normalizedVenue, oddsTypes: ODDS_TYPES, raceNo: normalizedRaceNo },
    }),
    signal,
  });
  if (!response.ok) throw new Error(`马会赔率接口 HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.errors?.length) throw new Error('马会赔率接口拒绝查询');
  const raceId = `${date}-${normalizedVenue}-${normalizedRaceNo}`;
  const pools = {};
  for (const meeting of payload?.data?.raceMeetings ?? []) {
    for (const pool of meeting?.pmPools ?? []) {
      const type = String(pool?.oddsType ?? '').toUpperCase();
      if (!ODDS_TYPES.includes(type)) continue;
      if (!pool?.leg?.races?.some((number) => Number(number) === normalizedRaceNo)) continue;
      const quotes = {};
      for (const node of pool.oddsNodes ?? []) {
        const combination = String(node?.combString ?? '').match(/\d+/g)?.map(Number) ?? [];
        const price = Number(node?.oddsValue);
        const key = combinationKey(type, combination);
        if (!key || !Number.isFinite(price) || price <= 0) continue;
        quotes[key] = price;
      }
      pools[type] = {
        capturedAt: pool.lastUpdateTime ?? null,
        sellStatus: pool.sellStatus ?? pool.status ?? null,
        quotes,
      };
    }
  }
  return {
    raceId,
    fetchedAt: new Date(now).toISOString(),
    source: 'HKJC public GraphQL',
    pools,
  };
}

export function quoteForSelection(market, betType, selections, now = new Date()) {
  const type = POOL_BY_BET_TYPE[betType] ?? betType;
  const pool = market?.pools?.[type];
  if (!pool) return null;
  const key = combinationKey(type, (selections ?? []).map((selection) => (
    typeof selection === 'object' && selection !== null ? selection.horseNo : selection
  )));
  const oddsValue = pool.quotes?.[key];
  if (!Number.isFinite(oddsValue) || oddsValue <= 0) return null;
  const captured = Date.parse(pool.capturedAt);
  const ageMinutes = (new Date(now).getTime() - captured) / 60_000;
  let status = 'FRESH';
  if (!Number.isFinite(ageMinutes)) status = 'UNKNOWN_TIME';
  else if (ageMinutes < -1) status = 'FUTURE';
  else if (ageMinutes > 15) status = 'STALE';
  else if (!SELLING_STATUSES.has(String(pool.sellStatus ?? '').toUpperCase())) status = 'CLOSED';
  return {
    oddsValue,
    capturedAt: pool.capturedAt,
    sellStatus: pool.sellStatus,
    ageMinutes: Number.isFinite(ageMinutes) ? ageMinutes : null,
    status,
    source: market.source,
  };
}

export function formatLiveOddsValue(value) {
  const odds = Number(value);
  return Number.isFinite(odds) && odds > 0 ? String(odds) : '—';
}

export function withLiveOdds(entry, market, now = new Date()) {
  if (!entry?.forecast) return entry;
  const validMarket = market?.raceId === entry.raceId ? market : null;
  return {
    ...entry,
    evaluatedAt: new Date(now).toISOString(),
    forecast: {
      ...entry.forecast,
      predictions: (entry.forecast.predictions ?? []).map((runner) => {
        const win = quoteForSelection(validMarket, 'WIN', [runner], now);
        const place = quoteForSelection(validMarket, 'PLACE', [runner], now);
        return {
          ...runner,
          winOdds: win?.status === 'FRESH' ? win.oddsValue : null,
          placeOdds: place?.status === 'FRESH' ? place.oddsValue : null,
          winMarketCapturedAt: win?.status === 'FRESH' ? win.capturedAt : null,
          placeMarketCapturedAt: place?.status === 'FRESH' ? place.capturedAt : null,
          winSellStatus: win?.status === 'FRESH' ? win.sellStatus : null,
          placeSellStatus: place?.status === 'FRESH' ? place.sellStatus : null,
          marketSource: validMarket?.source ?? null,
        };
      }),
    },
  };
}

function combinationKey(type, numbers) {
  const normalized = numbers.map(Number);
  if (!normalized.length || normalized.some((number) => !Number.isInteger(number) || number <= 0)) return null;
  if (['QIN', 'QPL'].includes(type)) normalized.sort((a, b) => a - b);
  return normalized.join('+');
}
