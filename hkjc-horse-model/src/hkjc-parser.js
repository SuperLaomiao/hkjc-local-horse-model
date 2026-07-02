const HKJC_LOCAL_RESULTS_URL = 'https://racing.hkjc.com/en-us/local/information/localresults';
const HKJC_RACE_CARD_URL = 'https://racing.hkjc.com/en-us/local/information/racecard';
const HKJC_FIXTURE_URL = 'https://racing.hkjc.com/en-us/local/information/fixture';

export function normalizeRaceDate(value) {
  if (!value) return null;
  const text = String(value).trim().replaceAll('-', '/');
  const parts = text.split('/').map((part) => part.trim());
  if (parts.length !== 3) return text;

  if (parts[0].length === 4) {
    return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
  }

  return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
}

export function toHkjcDate(value) {
  const normalized = normalizeRaceDate(value);
  if (!normalized) return null;
  return normalized.replaceAll('-', '/');
}

export function parseRaceUrl(url) {
  const parsed = new URL(url);
  const params = new Map();
  for (const [key, value] of parsed.searchParams.entries()) {
    params.set(key.toLowerCase(), value);
  }

  const date = normalizeRaceDate(params.get('racedate'));
  const racecourse = params.get('racecourse')?.toUpperCase() ?? null;
  const raceNo = Number.parseInt(params.get('raceno'), 10);

  return {
    date,
    racecourse,
    raceNo: Number.isFinite(raceNo) ? raceNo : null,
  };
}

export function buildLocalResultUrl({ date, racecourse, raceNo }) {
  const url = new URL(HKJC_LOCAL_RESULTS_URL);
  url.searchParams.set('racedate', toHkjcDate(date));
  url.searchParams.set('Racecourse', racecourse);
  url.searchParams.set('RaceNo', String(raceNo));
  return url.toString();
}

export function buildRaceCardUrl({ date, racecourse, raceNo }) {
  const url = new URL(HKJC_RACE_CARD_URL);
  url.searchParams.set('racedate', toHkjcDate(date));
  url.searchParams.set('Racecourse', racecourse);
  url.searchParams.set('RaceNo', String(raceNo));
  return url.toString();
}

export function buildFixtureUrl({ year, month } = {}) {
  const url = new URL(HKJC_FIXTURE_URL);
  if (year) url.searchParams.set('calyear', String(year));
  if (month) url.searchParams.set('calmonth', String(month).padStart(2, '0'));
  return url.toString();
}

export function secondsFromRaceTime(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text || text === '---') return null;

  const colonMatch = text.match(/^(\d+):(\d+(?:\.\d+)?)$/);
  if (colonMatch) {
    return Number(colonMatch[1]) * 60 + Number(colonMatch[2]);
  }

  const dottedMatch = text.match(/^(\d+)\.(\d{2})\.(\d+)$/);
  if (dottedMatch) {
    return Number(dottedMatch[1]) * 60 + Number(`${dottedMatch[2]}.${dottedMatch[3]}`);
  }

  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : null;
}

export function parseLbw(value) {
  if (value == null) return null;
  const text = stripText(String(value)).toUpperCase();
  if (!text || text === '---') return 0;

  const namedMargins = new Map([
    ['N', 0.05],
    ['NOSE', 0.05],
    ['SH', 0.1],
    ['SHORT HEAD', 0.1],
    ['HD', 0.2],
    ['HEAD', 0.2],
    ['NK', 0.3],
    ['NECK', 0.3],
  ]);

  if (namedMargins.has(text)) return namedMargins.get(text);

  const mixed = text.match(/^(\d+)-(\d+)\/(\d+)$/);
  if (mixed) {
    return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  }

  const fraction = text.match(/^(\d+)\/(\d+)$/);
  if (fraction) {
    return Number(fraction[1]) / Number(fraction[2]);
  }

  const numeric = Number.parseFloat(text);
  return Number.isFinite(numeric) ? numeric : null;
}

export function parseLocalResultHtml(html, context = {}) {
  const title = html.match(/RACE\s+(\d+)\s+\((\d+)\)/i);
  const condition = stripText(html).match(/Class\s+(\d+)\s*-\s*(\d+)M\s*-\s*\(([^)]*)\)/i);
  const courseText = extractLabelValue(html, 'Course');
  const going = extractLabelValue(html, 'Going')?.toUpperCase() ?? null;
  const surface = parseSurface(courseText);
  const titleRaceNo = title ? Number(title[1]) : null;
  const raceNo = context.raceNo ?? titleRaceNo;
  const date = normalizeRaceDate(context.date);
  const racecourse = context.racecourse?.toUpperCase() ?? null;
  const htmlContext = inferResultPageContext(html);
  const runners = parsePerformanceRows(html);
  const dividends = parseDividendRows(html);

  if (!raceNo || !date || !racecourse) {
    throw new Error('Missing race context: date, racecourse, and raceNo are required');
  }

  if (htmlContext.date && htmlContext.date !== date) {
    throw new Error(`HKJC result date mismatch: requested ${date}, received ${htmlContext.date}`);
  }

  if (htmlContext.racecourse && htmlContext.racecourse !== racecourse) {
    throw new Error(`HKJC result racecourse mismatch: requested ${racecourse}, received ${htmlContext.racecourse}`);
  }

  if (titleRaceNo && context.raceNo && titleRaceNo !== context.raceNo) {
    throw new Error(`HKJC result race number mismatch: requested ${context.raceNo}, received ${titleRaceNo}`);
  }

  if (runners.length === 0) {
    throw new Error(`No performance rows found for ${date} ${racecourse} race ${raceNo}`);
  }

  return {
    raceId: `${date}-${racecourse}-${raceNo}`,
    date,
    racecourse,
    raceNo,
    raceIndex: title ? Number(title[2]) : null,
    raceClass: condition ? Number(condition[1]) : null,
    distance: condition ? Number(condition[2]) : null,
    ratingBand: condition?.[3] ?? null,
    surface,
    course: courseText,
    going,
    runners,
    ...(dividends ? { dividends } : {}),
    source: buildLocalResultUrl({ date, racecourse, raceNo }),
  };
}

export function parseRaceCardHtml(html, context = {}) {
  const raceNo = context.raceNo ?? firstNumber(stripText(html.match(/Race\s+\d+/i)?.[0] ?? ''));
  const date = normalizeRaceDate(context.date);
  const racecourse = context.racecourse?.toUpperCase() ?? null;
  const summary = parseRaceCardSummary(html);
  const runners = parseStarterRows(html);

  if (!raceNo || !date || !racecourse) {
    throw new Error('Missing race card context: date, racecourse, and raceNo are required');
  }

  if (!['ST', 'HV'].includes(racecourse)) {
    throw new Error(`Race card is not a Hong Kong local racecourse: ${racecourse}`);
  }

  if (runners.length === 0) {
    throw new Error(`No starter rows found for ${date} ${racecourse} race ${raceNo}`);
  }

  return {
    raceId: `${date}-${racecourse}-${raceNo}`,
    date,
    racecourse,
    raceNo,
    status: 'upcoming',
    raceName: summary.raceName,
    startTime: summary.startTime,
    raceClass: summary.raceClass,
    distance: summary.distance,
    ratingBand: summary.ratingBand,
    surface: summary.surface,
    course: summary.course,
    going: summary.going,
    runners,
    source: buildRaceCardUrl({ date, racecourse, raceNo }),
  };
}

export function parseFixtureHtml(html, context = {}) {
  const pageText = stripText(html);
  const monthTitle = pageText.match(/\b(\d{1,2})\/(\d{4})\b/);
  const month = Number(context.month ?? monthTitle?.[1]);
  const year = Number(context.year ?? monthTitle?.[2]);

  if (!year || !month) {
    throw new Error('Could not determine fixture month and year');
  }

  return Array.from(html.matchAll(/<td\b[^>]*class=["'][^"']*\bcalendar\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi))
    .map((match) => parseFixtureCell(match[1], { year, month }))
    .filter(Boolean);
}

export async function fetchLocalResultRace({ date, racecourse, raceNo, fetchImpl = fetch }) {
  const url = buildLocalResultUrl({ date, racecourse, raceNo });
  const response = await fetchImpl(url, {
    headers: {
      'user-agent': 'hkjc-local-horse-model/0.1 (+research; official public pages)',
    },
  });

  if (!response.ok) {
    throw new Error(`HKJC request failed ${response.status} ${response.statusText}: ${url}`);
  }

  const html = await response.text();
  return parseLocalResultHtml(html, { date, racecourse, raceNo });
}

export async function fetchRaceCardRace({ date, racecourse, raceNo, fetchImpl = fetch }) {
  const url = buildRaceCardUrl({ date, racecourse, raceNo });
  const response = await fetchImpl(url, {
    headers: {
      'user-agent': 'hkjc-local-horse-model/0.1 (+research; official public pages)',
    },
  });

  if (!response.ok) {
    throw new Error(`HKJC race card request failed ${response.status} ${response.statusText}: ${url}`);
  }

  const html = await response.text();
  return parseRaceCardHtml(html, { date, racecourse, raceNo });
}

export async function fetchFixtureMeetings({ year, month, fetchImpl = fetch }) {
  const url = buildFixtureUrl({ year, month });
  const response = await fetchImpl(url, {
    headers: {
      'user-agent': 'hkjc-local-horse-model/0.1 (+research; official public pages)',
    },
  });

  if (!response.ok) {
    throw new Error(`HKJC fixture request failed ${response.status} ${response.statusText}: ${url}`);
  }

  const html = await response.text();
  return parseFixtureHtml(html, { year, month }).map((meeting) => ({
    ...meeting,
    source: url,
  }));
}

export async function fetchMeetingResults({
  date,
  racecourse,
  races,
  fetchImpl = fetch,
  continueOnError = false,
}) {
  const results = [];
  const errors = [];

  for (const raceNo of races) {
    try {
      results.push(await fetchLocalResultRace({ date, racecourse, raceNo, fetchImpl }));
    } catch (error) {
      if (!continueOnError) throw error;
      errors.push({ raceNo, message: error.message });
    }
  }

  return { races: results, errors };
}

export async function fetchMeetingRaceCards({
  date,
  racecourse,
  races,
  fetchImpl = fetch,
  continueOnError = false,
}) {
  const results = [];
  const errors = [];

  for (const raceNo of races) {
    try {
      results.push(await fetchRaceCardRace({ date, racecourse, raceNo, fetchImpl }));
    } catch (error) {
      if (!continueOnError) throw error;
      errors.push({ raceNo, message: error.message });
    }
  }

  return { races: results, errors };
}

function parsePerformanceRows(html) {
  const performanceStart = html.search(/<div\b[^>]*class=["'][^"']*\bperformance\b/i);
  if (performanceStart < 0) return [];

  const performanceHtml = html.slice(performanceStart);
  const tbody = performanceHtml.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tbody) return [];

  return Array.from(tbody[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi))
    .map((match) => parseRunnerRow(match[1]))
    .filter(Boolean);
}

function parseRunnerRow(rowHtml) {
  const cells = Array.from(rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)).map((match) => match[1]);
  if (cells.length < 12) return null;

  const placing = firstNumber(stripText(cells[0]));
  const horseNo = firstNumber(stripText(cells[1]));
  const horseCell = cells[2];
  const horseText = stripText(horseCell);
  const horseId = decodeHtml(horseCell.match(/horseid=([^"'&\s>]+)/i)?.[1] ?? '').trim() || null;
  const brandNo = horseText.match(/\(([A-Z]\d{3})\)/)?.[1] ?? null;
  const horseName = horseText.replace(/\s*\([A-Z]\d{3}\)\s*$/, '').trim();

  if (!placing || !horseName) return null;

  return {
    placing,
    horseNo,
    horseId,
    brandNo,
    horseName,
    jockey: stripText(cells[3]),
    trainer: stripText(cells[4]),
    actualWeight: numberOrNull(stripText(cells[5])),
    declaredHorseWeight: numberOrNull(stripText(cells[6])),
    draw: numberOrNull(stripText(cells[7])),
    lbw: parseLbw(cells[8]),
    runningPosition: numbersFromText(stripText(cells[9])),
    finishSeconds: secondsFromRaceTime(stripText(cells[10])),
    winOdds: numberOrNull(stripText(cells[11])),
  };
}

function parseDividendRows(html) {
  const dividendStart = html.search(/<div\b[^>]*class=["'][^"']*\bdividend_tab\b/i);
  if (dividendStart < 0) return null;

  const dividendHtml = html.slice(dividendStart);
  const tbody = dividendHtml.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tbody) return null;

  const dividends = {};
  let currentPool = null;
  for (const match of tbody[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = Array.from(match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)).map((cellMatch) => cellMatch[1]);
    if (cells.length < 2) continue;

    let combinationCell;
    let dividendCell;
    if (cells.length >= 3) {
      currentPool = normalizeDividendPool(stripText(cells[0]));
      combinationCell = cells[1];
      dividendCell = cells[2];
    } else {
      combinationCell = cells[0];
      dividendCell = cells[1];
    }

    const key = dividendPoolKey(currentPool);
    const combination = parseDividendCombination(stripText(combinationCell));
    const dividendPer10 = numberOrNull(stripText(dividendCell));
    if (!key || combination.length === 0 || !Number.isFinite(dividendPer10)) continue;

    dividends[key] ??= [];
    dividends[key].push({
      pool: currentPool,
      combination,
      dividendPer10,
    });
  }

  return Object.keys(dividends).length > 0 ? dividends : null;
}

function normalizeDividendPool(value) {
  return String(value).replace(/\s+/g, ' ').trim().toUpperCase();
}

function dividendPoolKey(pool) {
  return {
    WIN: 'win',
    PLACE: 'place',
    QUINELLA: 'quinella',
    'QUINELLA PLACE': 'quinellaPlace',
    FORECAST: 'forecast',
    TIERCE: 'tierce',
    TRIO: 'trio',
    'FIRST 4': 'first4',
    QUARTET: 'quartet',
  }[pool] ?? null;
}

function parseDividendCombination(value) {
  return Array.from(String(value).matchAll(/\d+/g)).map((match) => Number(match[0]));
}

function parseRaceCardSummary(html) {
  const text = stripText(html);
  const raceMatch = text.match(/Race\s+(\d+)\s+-\s+(.+?)\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),/i);
  const raceName = raceMatch?.[2]?.trim() ?? null;
  const startTime = text.match(/\b(\d{1,2}:\d{2})\b/)?.[1] ?? null;
  const condition = text.match(/\b(Turf|All Weather Track|AWT),\s*([^,]+Course),\s*(\d+)M,\s*([^<]+?)\s+Prize Money:/i);
  const prizeTail = text.match(/Prize Money:\s*\$[\d,]+,\s*([^,]+),\s*(Class\s+\d+|Griffin Race)/i);
  const ratingBand = prizeTail?.[1] && prizeTail[1] !== '-' ? prizeTail[1].replace(/^Rating:\s*/i, '') : null;
  const raceClass = prizeTail?.[2]?.match(/Class\s+(\d+)/i)?.[1];

  return {
    raceName,
    startTime,
    surface: condition ? parseSurface(condition[1]) : null,
    course: condition ? `${condition[1]}, ${condition[2]}` : null,
    distance: condition ? Number(condition[3]) : null,
    going: condition?.[4]?.trim().toUpperCase() ?? null,
    ratingBand,
    raceClass: raceClass ? Number(raceClass) : null,
  };
}

function parseStarterRows(html) {
  const starterStart = html.search(/<table\b[^>]*class=["'][^"']*\bstarter\b/i);
  if (starterStart < 0) return [];

  const starterHtml = html.slice(starterStart);
  const tbody = starterHtml.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tbody) return [];

  return Array.from(tbody[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi))
    .map((match) => parseStarterRow(match[1]))
    .filter(Boolean);
}

function parseStarterRow(rowHtml) {
  const cells = Array.from(rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)).map((match) => match[1]);
  if (cells.length < 14) return null;

  const horseNo = firstNumber(stripText(cells[0]));
  const horseCell = cells[3];
  const horseName = stripText(horseCell);
  const horseId = decodeHtml(horseCell.match(/horseid=([^"'&\s>]+)/i)?.[1] ?? '').trim() || null;

  if (!horseNo || !horseName) return null;

  return {
    horseNo,
    lastSixRuns: stripText(cells[1]),
    horseId,
    brandNo: stripText(cells[4]) || null,
    horseName,
    actualWeight: numberOrNull(stripText(cells[5])),
    jockey: cleanJockeyName(stripText(cells[6])),
    draw: numberOrNull(stripText(cells[8])),
    trainer: stripText(cells[9]),
    rating: numberOrNull(stripText(cells[11])),
    ratingChange: numberOrNull(stripText(cells[12])),
    declaredHorseWeight: numberOrNull(stripText(cells[13])),
    priority: stripText(cells[20]) || null,
    daysSinceLastRun: numberOrNull(stripText(cells[21] ?? '')),
    gear: stripText(cells[22] ?? ''),
  };
}

function parseFixtureCell(cellHtml, { year, month }) {
  const alts = Array.from(cellHtml.matchAll(/\balt=["']([^"']+)["']/gi)).map((match) => decodeHtml(match[1]).toUpperCase());
  const racecourse = alts.find((alt) => alt === 'ST' || alt === 'HV');
  if (!racecourse) return null;

  const dayText = cellHtml.match(/<span\b[^>]*class=["'][^"']*\bf_fl\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]
    ?? stripText(cellHtml);
  const day = firstNumber(stripText(dayText));
  if (!day) return null;

  const raceCount = Array.from(stripText(cellHtml).matchAll(/\b\d{3,4}\((\d+)\)/g))
    .reduce((sum, match) => sum + Number(match[1]), 0);

  return {
    date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    racecourse,
    raceCount: raceCount || null,
  };
}

function inferResultPageContext(html) {
  const resultLinks = Array.from(String(html).matchAll(/localresults\?([^"'<>]+)/gi))
    .map((match) => parseResultLinkQuery(match[1]))
    .filter(Boolean);

  return {
    date: firstMostCommon(resultLinks.map((link) => link.date).filter(Boolean)),
    racecourse: firstMostCommon(resultLinks.map((link) => link.racecourse).filter(Boolean)),
  };
}

function parseResultLinkQuery(queryText) {
  const query = decodeHtml(String(queryText)).replaceAll('&amp;', '&');
  const params = new Map();

  for (const part of query.split('&')) {
    const [rawKey, rawValue = ''] = part.split('=');
    const key = decodeURIComponent(rawKey).toLowerCase();
    const value = decodeURIComponent(rawValue);
    params.set(key, value);
  }

  const date = normalizeRaceDate(params.get('racedate'));
  const racecourse = params.get('racecourse')?.toUpperCase() ?? null;
  if (!date && !racecourse) return null;
  return { date, racecourse };
}

function firstMostCommon(values) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function cleanJockeyName(value) {
  return String(value).replace(/\s*\([^)]+\)\s*$/, '').trim();
}

function parseSurface(courseText) {
  if (!courseText) return null;
  const text = courseText.toUpperCase();
  if (text.includes('ALL WEATHER') || text.includes('AWT')) return 'AWT';
  if (text.includes('TURF')) return 'TURF';
  return text.split(/\s+/)[0] || null;
}

function extractLabelValue(html, label) {
  const pattern = new RegExp(`<td[^>]*>\\s*${label}\\s*:\\s*<\\/td>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`, 'i');
  const match = html.match(pattern);
  return match ? stripText(match[1]) : null;
}

function stripText(html) {
  return decodeHtml(String(html)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function decodeHtml(value) {
  return String(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim();
}

function firstNumber(text) {
  const match = String(text).match(/\d+/);
  return match ? Number(match[0]) : null;
}

function numberOrNull(text) {
  const numeric = Number.parseFloat(String(text).replace(/,/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

function numbersFromText(text) {
  return Array.from(String(text).matchAll(/\d+/g)).map((match) => Number(match[0]));
}
