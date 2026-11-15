import { parseLocalResultHtml } from '../src/hkjc-parser.js';

export function abandonedHtml({ date = '14/11/2026', racecourse = 'ST', raceNo = 6, refund = true } = {}) {
  const course = racecourse === 'ST' ? 'Sha Tin' : 'Happy Valley';
  return `<div class="localResults">
    <div class="top_races"><table class="js_racecard"><tr><td>${course}:</td>
      <td><img src="/racing/info/StaticFile/Images/Racing/racecard_rt_${raceNo}_o.gif"></td>
    </tr></table></div>
    <div class="raceMeeting_select"><span>Race Meeting: ${date} ${course}</span></div>
    <div>This race is declared abandoned.</div>
    <div class="dividend_tab"><table><tbody>
      <tr><td>WIN</td><td>-</td><td>${refund ? 'REFUND' : '5.00'}</td></tr>
      <tr><td>PLACE</td><td>-</td><td>${refund ? 'REFUND' : '2.00'}</td></tr>
    </tbody></table></div>
  </div>`;
}

export function abandonedRace(raceNo = 6) {
  return parseLocalResultHtml(abandonedHtml({ raceNo }), {
    date: '2026-11-14', racecourse: 'ST', raceNo, observedAt: '2026-11-14T11:00:00Z',
  });
}
