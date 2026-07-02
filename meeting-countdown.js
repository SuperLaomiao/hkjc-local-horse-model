const HK_TIME_ZONE = "Asia/Hong_Kong";
const T30_MINUTES = 30;

export function buildMeetingCountdown({ meeting, upcomingEntries = [], now = new Date() } = {}) {
  const timedEntries = normalizeEntries(upcomingEntries);
  const nextRace = findNextTimedRace(timedEntries, now);

  if (nextRace) {
    const raceDate = hkRaceDateTime(nextRace.date, nextRace.startTime);
    const diffMinutes = Math.max(0, Math.ceil((raceDate.getTime() - now.getTime()) / 60000));
    const t30Date = new Date(raceDate.getTime() - T30_MINUTES * 60000);
    const isT30 = diffMinutes <= T30_MINUTES && diffMinutes > 0;

    return {
      status: isT30 ? "T_MINUS_30" : "COUNTDOWN",
      hasStartTime: true,
      nextRace,
      nextRaceText: `R${nextRace.raceNo} · ${nextRace.startTime}`,
      distanceText: isT30 ? `T-30窗口内 · ${formatDurationToRace(now, raceDate, { compactUnderHour: true })}` : formatDurationToRace(now, raceDate),
      t30Text: `T-30 复核：${formatHkTime(t30Date)}`,
      targetIso: raceDate.toISOString(),
      detail: isT30
        ? "现在进入最终复核窗口：刷新赔率、退出马和场地；不要提前追价。"
        : "按小时倒计时；T-30 开始重点复核，T-10 到 T-5 才执行。",
    };
  }

  const fixtureDate = meeting?.date ?? upcomingEntries[0]?.date ?? null;
  const daysText = formatDaysUntil(fixtureDate, hkDateString(now));
  return {
    status: "FIXTURE_ONLY",
    hasStartTime: false,
    nextRace: null,
    nextRaceText: "首场时间待公布",
    distanceText: fixtureDate ? `${daysText} · 开跑时间待公布` : "待官方赛程更新",
    t30Text: "Race Card 发布后自动显示 T-30",
    targetIso: null,
    detail: "官方 Race Card 未发布或未含开跑时间；暂不猜具体小时。",
  };
}

export function findNextTimedRace(entries = [], now = new Date()) {
  return normalizeEntries(entries)
    .map((entry) => ({
      ...entry,
      raceDate: hkRaceDateTime(entry.date, entry.startTime),
    }))
    .filter((entry) => entry.raceDate && entry.raceDate.getTime() >= now.getTime())
    .sort((a, b) => a.raceDate.getTime() - b.raceDate.getTime())[0] ?? null;
}

export function formatDurationToRace(now, target, options = {}) {
  const diffMinutes = Math.ceil((target.getTime() - now.getTime()) / 60000);
  if (!Number.isFinite(diffMinutes)) return "待确认";
  if (diffMinutes <= 0) return "已开跑";
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  if (options.compactUnderHour && hours === 0) return `还有${minutes}分钟`;
  if (hours === 0) return `还有 ${minutes}分钟`;
  return `还有 ${hours}小时${String(minutes).padStart(2, "0")}分钟`;
}

export function hkRaceDateTime(dateString, timeString) {
  const date = parseDateString(dateString);
  const time = parseTimeString(timeString);
  if (!date || !time) return null;
  return new Date(Date.UTC(date.year, date.month - 1, date.day, time.hour - 8, time.minute, 0));
}

function normalizeEntries(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => ({
      raceId: entry.raceId ?? null,
      date: entry.date ?? entry.forecast?.date ?? null,
      racecourse: entry.racecourse ?? entry.forecast?.racecourse ?? null,
      raceNo: entry.raceNo ?? entry.forecast?.raceNo ?? null,
      startTime: entry.startTime ?? entry.forecast?.startTime ?? null,
    }))
    .filter((entry) => entry.date && entry.startTime);
}

function formatHkTime(value) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: HK_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

function hkDateString(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: HK_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function formatDaysUntil(dateString, todayString = hkDateString()) {
  const diff = dayNumber(dateString) - dayNumber(todayString);
  if (!Number.isFinite(diff)) return "待确认";
  if (diff < 0) return "已结束";
  if (diff === 0) return "今天";
  if (diff === 1) return "明天";
  return `还有 ${diff} 天`;
}

function dayNumber(dateString) {
  const parts = parseDateString(dateString);
  if (!parts) return Number.NaN;
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86400000);
}

function parseDateString(dateString) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateString ?? ""));
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function parseTimeString(timeString) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(timeString ?? ""));
  if (!match) return null;
  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  };
}
