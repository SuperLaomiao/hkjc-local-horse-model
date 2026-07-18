# j-csc HKJC scraper schema and source-coverage audit

Audit date: 2026-07-18

Repository: [j-csc/HK-Horse-Racing-Data-Scraper](https://github.com/j-csc/HK-Horse-Racing-Data-Scraper)

Audited commit: `063a889ebfc60621a81df3f14b5def6b9c8edd89` (2020-08-09)

## Decision

Use this repository only as a clean-room schema and parser-test reference.

- GitHub exposes no license for the audited public tree. Code reuse and raw-data publication are therefore disabled.
- The README says six newer scrapers were completed, but the public tree does not contain the imported `scrapers/` directory, output fixtures, or schemas.
- Only the legacy local-results collector, legacy horse-profile collector, and notebook result columns can be verified from public code.
- No j-csc row is added to SQLite or the public Pages artifact. This audit publishes only field-level metadata and independently designed fixture ideas.

The executable classification lives in `hkjc-horse-model/src/source-coverage-audit.js` and fails closed if a proposed pre-race field does not require both `observedAt` and `targetRacePostAt`.

## Evidence boundary

| Page group | Repository evidence | Public implementation at audited commit | Decision |
| --- | --- | --- | --- |
| Local race results | `old/scraper.py`, `notebooks/DataPrep.ipynb` | Present | Same-race row is post-race evidence only. |
| Horse profile | `old/horse_scraper.py` | Present | Static identity can be captured prospectively; changing ratings/stakes/counts are unsafe without as-of history. |
| Racecard | README and missing import in `main.py` | Missing | Reimplement independently against current official pages. |
| Racecard info | README and missing import in `main.py` | Missing | Schema is unavailable; do not infer it. |
| Veterinary records | README and missing import in `main.py` | Missing | Reimplement independently; event date is not publication time. |
| Penetrometer | README and missing import in `main.py` | Missing | Reimplement independently with each displayed as-of time and actual capture time. |
| Roarers | README and missing import in `main.py` | Missing | Reimplement independently; diagnosis must have known pre-race availability. |

Current official pages independently confirm the useful public schemas:

- The [HKJC Race Card](https://racing.hkjc.com/racing/information/english/Racing/racecard.aspx) exposes meeting/race context plus horse number, recent runs, weight, jockey, draw, trainer, rating/change, declaration weight, priority/order and gear.
- [Veterinary Records for declared starters](https://racing.hkjc.com/racing/information/English/Racing/VeterinaryRecord.aspx) exposes horse number/name, date, details and passed-on date. The [Veterinary Records Database](https://racing.hkjc.com/racing/information/english/VeterinaryRecords/OveDatabase.aspx) also uses brand number identity.
- [Course Information](https://racing.hkjc.com/racing/english/racing-info/racing_course.asp) explains course layouts and penetrometer/going interpretation; actual readings can be revised during a meeting.
- The [Roarers Database](https://racing.hkjc.com/racing/information/English/VeterinaryRecords/OVERoar.aspx) exposes horse identity, diagnosis date and surgery status.

These official pages confirm candidate fields, not historical availability. Every usable observation still needs its own retrieval timestamp, checksum, meeting identity and pre-post guard.

## Field policy

### Pre-race usable only with provenance

- Racecard: meeting/race/post time, venue, surface/course/distance, displayed going, class/rating band/prize, horse identity, last-six form, handicap weight, jockey/allowance, draw, trainer, rating/change, declaration weight, trainer preference/priority and gear.
- Horse profile: horse identity, country/age, colour/sex, import type, trainer, owner and pedigree, provided an actual capture precedes the target race.
- Veterinary derivations: count of already published prior events, days since the last safely observed event, and unresolved-record flag as of the cutoff.
- Track readings: venue/surface, value, displayed as-of time and going, preserving every revision instead of overwriting it.
- Roarer derivation: whether diagnosis was already known before cutoff.

Required minimum provenance is `sourceUrl`, `retrievedAt`, `checksum`, `observedAt`, and `targetRacePostAt`. Veterinary/roarer derivations additionally require `publishedOrObservedAt`.

### Post-race only

The legacy result page contributes placing, lengths behind, running position, finish time and undated public odds. Even pre-race-looking columns such as draw or declared weight remain part of a post-race artifact and must not be relabelled as a pre-race snapshot.

### Unsafe until an as-of history exists

- Current rating, season/total stakes and cumulative starts/placings from a current horse page.
- Raw veterinary date/details/passed-on values when only the event date is known.
- Diagnosis/surgery fields without a publication or observation time.
- Historical odds without a real snapshot timestamp and target post time.
- Penetrometer readings without both displayed as-of time and capture time.

### Unavailable

The public tree does not expose the newer racecard-info implementation or output schema. README wording alone is not an executable data source.

## Independent parser fixture backlog

Only synthetic, minimal fixtures should be committed:

1. Two racecard captures where jockey, draw, weight or gear changes before cutoff; preserve versions and select the latest safe one.
2. Scratched runner plus stand-by starter without shifting horse-number identity.
3. Bilingual labels, blank optional rating change/gear and jockey allowance.
4. Veterinary table rowspans where continuation rows omit horse identity.
5. Veterinary event date earlier than first observed publication; availability must use the latter.
6. Morning and afternoon penetrometer readings preserved as separate observations.
7. Requested meeting/date/venue/race identity mismatch rejected.
8. Capture at or after post time rejected from same-race pre-race features.

## Model impact and next gate

This audit changes no probability, ROI or cash recommendation. Cash remains `NO_BET` unless the existing market, calibration, EV and prospective gates pass.

The highest-value follow-up is an independently written official racecard/veterinary parser backed by synthetic fixtures and immutable observation storage. Any model promotion then requires an identical chronological cohort comparing the baseline with and without these lagged features; a higher hit rate alone is insufficient without calibrated probability and ROI/drawdown evidence.
