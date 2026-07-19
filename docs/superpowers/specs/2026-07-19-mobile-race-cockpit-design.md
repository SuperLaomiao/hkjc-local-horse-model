# Mobile Race-Day Cockpit Design

Date: 2026-07-19
Status: approved design, pending implementation plan
Target: public GitHub Pages dashboard at `https://superlaomiao.github.io/hkjc-local-horse-model/`

## Goal

Redesign the public dashboard as a mobile-first race-day cockpit. A user opening the site should understand, in order:

1. whether betting is available now, when the next race starts, and whether the race is inside the T-30 review window;
2. the exact race, pool, selection and HKD amount for the current structured recommendation;
3. the model confidence, value-gate evidence and research context supporting that recommendation.

The approved priority is `A > B > C`: availability and timing first, actionable plan second, model metrics third.

## Non-goals and safety boundary

- Do not change probabilities, model training, calibration, EV thresholds, staking limits, market freshness rules, SQLite, automation cadence or settlement logic.
- Do not promote any paper or research-only strategy to cash.
- Do not infer an executable price from final dividends or a missing live market.
- Do not publish private reports, personal betting history, local paths, raw third-party data or secrets.
- Do not remove current public functionality. Existing tools are regrouped into clearer destinations.
- A visually positive state never overrides an execution gate. `PLAY`, `WATCH`, `BLOCK` and the actual stake must always appear together.

## Responsive information architecture

The current desktop three-column dashboard and seven-button tool drawer become four top-level destinations on all screen sizes:

| Destination | Primary responsibility | Existing content retained |
| --- | --- | --- |
| Today | Availability, next race, T-window, race selector, final plan, structured portfolio and immediate reasons | betting availability, meeting forecast, final bet plan, staking/portfolio summary, compact top-ranked runners |
| Review | Settle the latest recommendation and inspect historical performance | review, self-test, settlement, comparison, performance and chart panels |
| Research | Explain model quality, benchmark gaps and upgrade status | Research Lab, public aggregate model comparison and sanitized research evidence |
| More | Reference tools and detailed analysis that are useful but not required in the first three seconds | pool guide, adaptive route, full prediction table, discipline and assumptions |

On mobile, the four destinations use a fixed bottom navigation with a minimum 44px target. On desktop, the same destinations appear in a compact top or side navigation and the selected page uses a maximum two-column content layout. The old three-column layout is removed rather than hidden below the fold.

URL hashes (`#today`, `#review`, `#research`, `#more`) make destinations linkable and preserve browser back/forward behavior. An unknown or stale hash falls back to `#today`.

## Today page hierarchy

The Today page renders the following blocks in this order:

1. Compact header: meeting/course label, public publication badge, last refreshed time and refresh action.
2. Availability hero: one explicit state, next race time and T-window countdown.
3. Horizontal race chips: every chip includes `R{n}` and scheduled time; settled, selected and upcoming states are visually distinct.
4. Structured plan card: state, total stake, race context and one row per line showing pool, horse/combination, amount and reason.
5. Primary refresh button: refreshes the sanitized dashboard and recomputes presentation from existing recommendation fields.
6. Collapsed evidence link: model confidence, disagreement, EV, price freshness and data completeness.
7. Compact model summary: performance metrics remain below the immediate decision content and link to Research or Review.

Every recommendation line must include an explicit race context such as `R3 · PLA · 8号 · HK$10` or `R3 · QPL · 2+8 · HK$10`. A recommendation without a resolvable race number is never shown as executable.

## State model

The cockpit derives one display state without modifying forecast data:

| State | User-facing result | Stake behavior |
| --- | --- | --- |
| No confirmed meeting | “今天不可下注” and the next known meeting or “等待官方排位表” | `NO_BET`, HK$0 |
| Future meeting | Meeting date and “等赛马当天再检查” | `NO_BET`, HK$0 |
| Race day outside review window | Scheduled next race and countdown | Show preparation only; no new executable line |
| T-30 review window | “已进入检查窗口” plus exact countdown | Existing gates determine PLAY, WATCH or BLOCK |
| PLAY | Exact race/pool/selection/amount plus conservative EV and price time | Preserve only already executable stake lines |
| WATCH | Candidate line and reason it has not cleared the gate | HK$0 |
| BLOCK | Stale/missing/suspended market, model disagreement or unsafe publication boundary | `NO_BET`, HK$0 |
| Settled race | Settlement/review entry | No further betting |

The UI must distinguish “today is a race day” from “this specific line is safe to execute.” A race-day availability banner alone never means the user should bet.

## Visual system

- Brand/navigation: deep green `#0C5C53`.
- Primary user action: track gold `#E6A83E` with dark text.
- Safe/ready-to-review state: pale green `#DFF5E9` with `#16553D` text.
- Waiting/no-meeting state: pale amber `#FFF1CF` with `#654B12` text.
- Blocking/error state: pale red `#FDE7E4` with `#8E2D24` text.
- Page background: mist `#F4F8F6`; cards remain white with quiet borders.

Gold means “take an interface action,” not “place a winning bet.” Green means data/state readiness, not a guaranteed outcome. Red is reserved for stopped, unsafe or failed states. Main titles use at most two lines, numbers use tabular figures, and technical labels provide a plain-language “为什么？” path.

## Component and code boundaries

The implementation stays framework-free and follows the existing ES module architecture.

### New `dashboard-cockpit.js`

- Define destination metadata and hash normalization.
- Build a pure cockpit view model from the sanitized snapshot, selected entry, Hong Kong time status and existing execution policy.
- Return explicit availability, countdown, plan state, stake, race chips, evidence and error fields.
- Render only cockpit-level primitives: header, availability hero, race chips, plan summary and primary navigation.
- Accept already-rendered legacy detail panels where necessary so existing complex tools can be moved without rewriting their business logic.

### Existing `dashboard-layout.js`

- Group the seven existing tool tabs under Review, Research and More.
- Preserve existing IDs for compatibility with saved selections and tests.
- Provide deterministic lookup from old tool ID to new destination.

### Existing `app.js`

- Continue to own dashboard fetch, local UI state, existing detailed panel renderers and event binding.
- Replace the three-column shell with destination rendering from `dashboard-cockpit.js`.
- Synchronize selected destination with the URL hash.
- Keep complex legacy renderers intact until moved behind their new destination, avoiding a broad unrelated refactor of the 2,300-line file.

### Existing `styles.css`

- Add cockpit design tokens and component styles.
- Replace mobile overrides that merely reorder the old three-column layout.
- Use one-column mobile and a maximum two-column desktop layout.
- Retain existing specialized panel styles so Review and Research do not regress.

## Data flow and trust boundary

1. Fetch the allowlisted public `data/dashboard.json`.
2. Validate publication mode through the existing `dashboardExecutionPolicy`.
3. Resolve the selected or next entry and Hong Kong race-day/T-window status.
4. Pass those values into the pure cockpit view-model builder.
5. Render one of the explicit states above.
6. Route user actions back through existing refresh, race selection, paper lock and review handlers.

The cockpit does not calculate a new probability, quote, EV or stake. It formats existing approved fields and may only reduce an unsafe or ambiguous line to `NO_BET`.

## Failure and stale-data behavior

- No race entries: render the no-meeting cockpit instead of the current generic missing-data page.
- Fetch failure with a previously loaded in-memory snapshot: keep the prior screen, show the failed refresh time and downgrade actionable state to `BLOCK / NO_BET` until a successful refresh.
- Fetch failure without a snapshot: show a small retry screen with no recommendation and no stake.
- Missing or invalid post time: do not invent a precise countdown; display “开跑时间待确认.”
- Missing, stale, future-dated or suspended market quote: `BLOCK / NO_BET`, HK$0.
- Unsafe or unknown publication contract: preserve the existing public execution boundary and zero every executable amount.
- Unknown race context: do not render a cash line.

The last successful dashboard timestamp remains visible in every state so the user can distinguish “no meeting” from “data did not refresh.”

## Accessibility and interaction

- Fixed mobile navigation and primary actions have at least a 44px target.
- Navigation uses semantic `nav`, current-page labeling and keyboard focus styles.
- Status changes use a polite live region; color is never the only signal.
- Text/background pairs must pass WCAG AA contrast for normal text.
- Horizontal race chips remain keyboard-scrollable and do not force the whole page wider than the viewport.
- Reduced-motion preferences disable non-essential countdown or state transitions.

## Test design

### Unit tests

- Destination/hash normalization and old tool-ID grouping.
- No-meeting, future-meeting, race-day pre-window, T-30, PLAY, WATCH, BLOCK and settled states.
- Unknown race context and unsafe publication always zero the executable amount.
- Every displayed recommendation line includes race number, pool, selection and amount.
- Invalid or missing start time produces no fabricated countdown.

### Integration tests

- Public app renders the publication badge and new four-destination navigation.
- Existing Review, Research Lab, pool guide, adaptive route, prediction table and discipline content remains reachable.
- A sanitized functional snapshot can show public tools while private research files remain inaccessible.
- Fetch-error and stale-snapshot messages cannot leave an active cash state on screen.

### Responsive and accessibility checks

- Browser checks at 390×844 and 430×932, plus one desktop width.
- No horizontal page overflow; race chips may scroll only inside their own container.
- Bottom navigation does not cover the final card content.
- Keyboard traversal reaches navigation, race chips, refresh and evidence controls in a logical order.

### Release checks

- `TZ=UTC npm test`
- `npm run hkjc:build-public-site`
- `npm run hkjc:privacy-scan`
- `git diff --check`
- Online verification against the deployed sanitized JSON and mobile page.

## Acceptance criteria

The redesign is complete when:

1. A phone user can identify betting availability, next-race time/T-window and current total stake without scrolling.
2. Any suggested line explicitly names race, pool, selection and amount.
3. `PLAY`, `WATCH`, `BLOCK` and `NO_BET` cannot be confused with one another by color or wording.
4. All current public tools remain reachable within one of the four destinations.
5. Missing/stale/unsafe data fails closed to HK$0.
6. Mobile layouts pass the responsive and accessibility checks.
7. Full regression, public build and privacy scans pass before deployment.
