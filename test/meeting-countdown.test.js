import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildMeetingCountdown,
  findNextTimedRace,
  formatDurationToRace,
} from '../meeting-countdown.js';

describe('meeting countdown helpers', () => {
  it('finds the next timed race by Hong Kong start time', () => {
    const next = findNextTimedRace([
      race(1, '16:00'),
      race(2, '16:30'),
      race(3, '17:00'),
    ], hkDate('2026-07-04T16:10:00'));

    assert.equal(next.raceNo, 2);
    assert.equal(next.startTime, '16:30');
  });

  it('formats a future race in hours and minutes rather than days', () => {
    const label = formatDurationToRace(
      hkDate('2026-07-02T10:00:00'),
      hkDate('2026-07-04T16:00:00'),
    );

    assert.equal(label, '还有 54小时00分钟');
  });

  it('marks the T-30 betting check window when the next race is within 30 minutes', () => {
    const countdown = buildMeetingCountdown({
      meeting: { date: '2026-07-04', racecourse: 'ST', raceCount: 11 },
      upcomingEntries: [race(1, '16:00'), race(2, '16:30')],
      now: hkDate('2026-07-04T15:35:00'),
    });

    assert.equal(countdown.status, 'T_MINUS_30');
    assert.equal(countdown.distanceText, 'T-30窗口内 · 还有25分钟');
    assert.equal(countdown.t30Text, 'T-30 复核：15:30');
    assert.equal(countdown.nextRaceText, 'R1 · 16:00');
  });

  it('does not guess a precise hour when the race card has no start time', () => {
    const countdown = buildMeetingCountdown({
      meeting: { date: '2026-07-04', racecourse: 'ST', raceCount: 11 },
      upcomingEntries: [],
      now: hkDate('2026-07-02T10:00:00'),
    });

    assert.equal(countdown.status, 'FIXTURE_ONLY');
    assert.equal(countdown.distanceText, '还有 2 天 · 开跑时间待公布');
    assert.equal(countdown.t30Text, 'Race Card 发布后自动显示 T-30');
  });
});

function race(raceNo, startTime) {
  return {
    raceId: `2026-07-04-ST-${raceNo}`,
    date: '2026-07-04',
    racecourse: 'ST',
    raceNo,
    forecast: { startTime },
  };
}

function hkDate(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (!match) throw new Error(`Bad HK date fixture: ${text}`);
  const [, year, month, day, hour, minute, second] = match;
  return new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour) - 8,
    Number(minute),
    Number(second),
  ));
}
