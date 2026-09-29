export function resolveRefreshStartDate({
  today,
  from,
  historyDays = 14,
  resumeFromLatest = false,
  availableRaceDates = [],
}) {
  if (validDate(from)) return from;
  if (enabled(resumeFromLatest)) {
    const latest = availableRaceDates.filter(validDate).sort().at(-1);
    if (latest) return latest;
  }
  return addDays(today, -Number(historyDays ?? 14));
}

function enabled(value) {
  return value === true || String(value).toLowerCase() === 'true' || String(value) === '1';
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''));
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + Number(days));
  return value.toISOString().slice(0, 10);
}
