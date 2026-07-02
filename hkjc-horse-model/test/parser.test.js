import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseLocalResultHtml } from '../src/hkjc-parser.js';

describe('HKJC result parser safeguards', () => {
  it('parses official dividend rows with repeated pool labels omitted by rowspan', () => {
    const parsed = parseLocalResultHtml(resultHtml({
      date: '2026/07/01',
      raceNo: 1,
      dividends: true,
    }), {
      date: '2026-07-01',
      racecourse: 'ST',
      raceNo: 1,
    });

    assert.deepEqual(parsed.dividends.win, [
      { pool: 'WIN', combination: [3], dividendPer10: 82 },
    ]);
    assert.deepEqual(parsed.dividends.place, [
      { pool: 'PLACE', combination: [3], dividendPer10: 25.5 },
      { pool: 'PLACE', combination: [10], dividendPer10: 23 },
      { pool: 'PLACE', combination: [7], dividendPer10: 50 },
    ]);
    assert.deepEqual(parsed.dividends.quinella, [
      { pool: 'QUINELLA', combination: [3, 10], dividendPer10: 312 },
    ]);
    assert.deepEqual(parsed.dividends.quinellaPlace, [
      { pool: 'QUINELLA PLACE', combination: [3, 10], dividendPer10: 102.5 },
      { pool: 'QUINELLA PLACE', combination: [3, 7], dividendPer10: 240 },
      { pool: 'QUINELLA PLACE', combination: [7, 10], dividendPer10: 221 },
    ]);
    assert.deepEqual(parsed.dividends.trio, [
      { pool: 'TRIO', combination: [3, 7, 10], dividendPer10: 1523 },
    ]);
  });

  it('rejects a fallback result page when the actual meeting date differs from the requested date', () => {
    assert.throws(
      () => parseLocalResultHtml(resultHtml({ date: '2026/06/27', raceNo: 1 }), {
        date: '2026-07-01',
        racecourse: 'ST',
        raceNo: 1,
      }),
      /date mismatch/i,
    );
  });

  it('rejects a fallback result page when the actual race number differs from the requested race', () => {
    assert.throws(
      () => parseLocalResultHtml(resultHtml({ date: '2026/06/27', raceNo: 1 }), {
        date: '2026-06-27',
        racecourse: 'ST',
        raceNo: 2,
      }),
      /race number mismatch/i,
    );
  });
});

function resultHtml({ date, raceNo, dividends = false }) {
  return `
    <html>
      <body>
        <a href="/en-us/local/information/localresults?racedate=${date}&Racecourse=ST&RaceNo=2">R2</a>
        <h2>RACE ${raceNo} (805)</h2>
        <table>
          <tr><td>Course :</td><td>Turf, A Course</td></tr>
          <tr><td>Going :</td><td>GOOD</td></tr>
        </table>
        <div class="performance">
          <table>
            <tbody>
              <tr>
                <td>1</td>
                <td>10</td>
                <td><a href="/horse.asp?horseid=E123">CIRCUIT VICTORY (E123)</a></td>
                <td>A Rider</td>
                <td>A Trainer</td>
                <td>120</td>
                <td>1100</td>
                <td>4</td>
                <td>---</td>
                <td>1 1 1</td>
                <td>1:09.99</td>
                <td>15</td>
              </tr>
            </tbody>
          </table>
        </div>
        ${dividends ? `
          <div class="dividend_tab f_clear">
            <table>
              <thead>
                <tr><td colspan="3">Dividend</td></tr>
                <tr><td>Pool</td><td>Winning Combination</td><td>Dividend (HK$)</td></tr>
              </thead>
              <tbody>
                <tr class="bg_dc">
                  <td class="fontXi" rowspan="1">WIN</td>
                  <td class="f_fs14">3</td>
                  <td class="f_fs14 f_tar">82.00</td>
                </tr>
                <tr>
                  <td class="fontXi" rowspan="3">PLACE</td>
                  <td class="f_fs14">3</td>
                  <td class="f_fs14 f_tar">25.50</td>
                </tr>
                <tr>
                  <td class="f_fs14">10</td>
                  <td class="f_fs14 f_tar">23.00</td>
                </tr>
                <tr>
                  <td class="f_fs14">7</td>
                  <td class="f_fs14 f_tar">50.00</td>
                </tr>
                <tr class="bg_dc">
                  <td class="fontXi" rowspan="1">QUINELLA</td>
                  <td class="f_fs14">3,10</td>
                  <td class="f_fs14 f_tar">312.00</td>
                </tr>
                <tr>
                  <td class="fontXi" rowspan="3">QUINELLA PLACE</td>
                  <td class="f_fs14">3,10</td>
                  <td class="f_fs14 f_tar">102.50</td>
                </tr>
                <tr>
                  <td class="f_fs14">3,7</td>
                  <td class="f_fs14 f_tar">240.00</td>
                </tr>
                <tr>
                  <td class="f_fs14">7,10</td>
                  <td class="f_fs14 f_tar">221.00</td>
                </tr>
                <tr class="bg_dc">
                  <td class="fontXi" rowspan="1">TRIO</td>
                  <td class="f_fs14">3,7,10</td>
                  <td class="f_fs14 f_tar">1,523.00</td>
                </tr>
              </tbody>
            </table>
          </div>
        ` : ''}
      </body>
    </html>
  `;
}
