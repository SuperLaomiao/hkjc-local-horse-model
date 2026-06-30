import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseLocalResultHtml } from '../src/hkjc-parser.js';

describe('HKJC result parser safeguards', () => {
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

function resultHtml({ date, raceNo }) {
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
      </body>
    </html>
  `;
}
