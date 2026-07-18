# Public Functional GitHub Pages Design

Date: 2026-07-18
Status: approved direction, pending implementation plan

## Goal

Keep the repository and GitHub Pages site publicly accessible on the free Pages tier while restoring the complete user-facing product on mobile: race forecasts, WIN/PLACE value checks, structured staking suggestions, rejection reasons, paper-pick tracking, and post-race review. Sensitive underlying data remains excluded from the deployed artifact.

The public product provides decision support, not guaranteed returns. Existing conservative probability, market freshness, expected-value, exposure, and `NO_BET` gates remain authoritative.

## Approaches considered

### A. Public functional product with sanitized data — selected

Publish only the data needed to run the product, then compute recommendations and suggested stakes in the browser. Keep personal settings and paper tickets in browser-local storage. Continue excluding raw data, SQLite, full ledgers, audits, model artifacts, and local paths.

This provides mobile access without publishing the research database or personal records.

### B. Publish the complete repository data

This would be simplest operationally but would expose row-level history, audits, generated research files, and potentially local metadata. It is rejected.

### C. Private source with authenticated API

This is the long-term product architecture, but it adds hosting, authentication, storage, account recovery, and privacy operations. It is deferred until the product and model evidence are mature.

## Publication contract

The deployed dashboard must carry a versioned publication marker representing a sanitized but functional public product. It must explicitly state:

- public user-facing recommendations are enabled;
- personal staking inputs and paper tickets are browser-local;
- row-level private history is not published;
- sensitive source artifacts are not published.

The public artifact allowlist and fail-closed scanner remain in place. The scanner must continue rejecting:

- SQLite databases and database paths;
- raw/upcoming/processed/private data directories unless a specific sanitized file is allowlisted;
- full row-level ledgers and recommendation audits;
- ticket images and personal settlement records;
- local absolute filesystem paths and secret patterns;
- unexpected files and symlinks.

Public model predictions, race context, aggregate performance, aggregate research results, and client-side recommendation inputs are allowed.

## Functional behavior

On the public GitHub Pages site:

1. The final-plan panel is available for every visible race.
2. WIN and PLACE candidates use the existing calibrated probability and expected-value engine.
3. Suggested stakes remain bounded by the existing HK$10–100 product rules and exposure controls.
4. Missing, stale, future, or suspended market prices produce `WATCH`, `PAPER`, or `NO_BET`, never a fabricated executable recommendation.
5. QIN/QPL remain subject to their independent promotion gates; current `NO_GO / NO_BET` results cannot be bypassed merely because the UI is public.
6. Race number, course, date, start time, pool, runner number, price basis, expected ROI, and rejection reason are shown on every recommendation.
7. User bankroll preferences, paper picks, and forecast locks are stored only in browser-local storage and are never added to the published dashboard JSON.
8. Post-race review uses public race results and local paper records without uploading personal activity.

## UI states

The current `PUBLIC_RESEARCH_ONLY` state is replaced by a sanitized functional-public state. The header should show `公开功能版` rather than implying that recommendations are hidden.

The product must distinguish:

- `PLAY`: all probability, lineage, freshness, price, EV, and risk gates pass;
- `WATCH`: a candidate exists but the selling price or safety buffer is not yet sufficient;
- `PAPER`: research candidate is not promoted for cash execution;
- `NO_BET`: evidence or data quality is insufficient;
- `CLOSED`: betting is unavailable or the race has started/settled.

Public access must never convert a non-executable model state into `PLAY`.

## Data flow

1. The scheduled workflow refreshes source data in an ephemeral runner.
2. The dashboard publisher creates a sanitized functional snapshot.
3. The public-site builder copies only allowlisted assets and the sanitized snapshot.
4. The privacy scan validates the exact artifact.
5. GitHub Pages deploys that artifact.
6. The browser computes display recommendations from published race/model/market inputs and keeps user-specific state locally.

## Error handling

- If the publication marker is missing or malformed, the browser fails closed to research-only `NO_BET`.
- If required recommendation inputs are absent, the affected race shows the missing-data reason instead of a stake.
- If the privacy scan detects a forbidden field or path, deployment fails.
- If local storage is unavailable, predictions still work but personal paper tracking is disabled with a visible notice.

## Verification

Implementation is complete only when:

- unit tests prove the functional-public marker enables UI tools without weakening EV and pool promotion gates;
- privacy tests prove sensitive fields and unexpected files still fail closed;
- generated public JSON contains no row-level ledger, audit, ticket, database, secret, or local path;
- desktop and mobile browser checks show complete race context and functional strategy panels;
- a public-page smoke test confirms the deployed site works from the GitHub Pages URL;
- existing Python and Node suites remain green.

## Deferred scope

Authentication, cloud-synced personal records, private APIs, paid hosting, repository history rewriting, and multi-user account isolation are deferred to the later privacy-split phase.
