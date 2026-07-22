import path from 'node:path';

export const LOCAL_SCHEDULER_LABEL = 'com.superlaomiao.hkjc-race-day-cycle';
export const MIN_SCHEDULER_INTERVAL_MINUTES = 5;

export function renderLaunchAgent({
  projectPath,
  dbPath = null,
  logDirectory = null,
  intervalMinutes = 10,
  label = LOCAL_SCHEDULER_LABEL,
} = {}) {
  const project = safeAbsolutePath(projectPath, 'projectPath');
  const database = safeAbsolutePath(
    dbPath ?? path.join(project, 'hkjc-horse-model', 'data', 'hkjc.sqlite'),
    'dbPath',
  );
  const logs = safeAbsolutePath(
    logDirectory ?? path.join(project, 'hkjc-horse-model', 'data', 'private', 'logs'),
    'logDirectory',
  );
  const interval = Number(intervalMinutes);
  if (!Number.isInteger(interval) || interval < MIN_SCHEDULER_INTERVAL_MINUTES) {
    throw new Error(`intervalMinutes must be at least ${MIN_SCHEDULER_INTERVAL_MINUTES}`);
  }
  if (interval > 24 * 60) throw new Error('intervalMinutes must not exceed 1440');
  const normalizedLabel = safeLabel(label);
  const command = [
    `cd ${shellQuote(project)}`,
    `/usr/bin/env npm run hkjc:race-day-cycle -- --db ${shellQuote(database)}`,
  ].join(' && ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(normalizedLabel)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>${xmlEscape(command)}</string>
  </array>
  <key>StartInterval</key>
  <integer>${interval * 60}</integer>
  <key>RunAtLoad</key>
  <false/>
  <key>Disabled</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(path.join(logs, 'race-day-cycle.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(path.join(logs, 'race-day-cycle-error.log'))}</string>
</dict>
</plist>
`;
}

function safeAbsolutePath(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new Error(`${label} must be absolute`);
  }
  if (/[\0\r\n]/.test(value)) throw new Error(`${label} contains unsafe characters`);
  return path.normalize(value);
}

function safeLabel(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9.-]+$/.test(value)) {
    throw new Error('label contains unsafe characters');
  }
  return value;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
