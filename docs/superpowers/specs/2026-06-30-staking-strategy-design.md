# Staking Strategy Design

**Goal:** Add a conservative HK$10-100 per-race staking strategy to the racing dashboard so the user sees a budget tier and exact paper-bet split instead of only one top-pick horse.

**Approved constraints:**

- Per-race budget range: HK$0, $10, $20, $30, $50, $80, $100.
- Default useful recommendation: HK$30.
- Maximum per-race recommendation: HK$100, used only for rare strong signals.
- Prefer Place, Quinella Place, and small Win stakes.
- Avoid Tierce, First 4, and Quartet for now because current model ordering is not strong enough.
- Treat the result as a disciplined decision aid, not a guarantee of profit.
- Always include stop rules: final odds, scratchings, stale data, or noisy last-minute changes can turn the strategy into PASS.

## Strategy shape

The dashboard will compute a `stakingStrategy` client-side from the selected race forecast:

- `mode`: `pass`, `watch`, `prepare`, or `execute`.
- `budget`: suggested HKD amount from the approved tiers.
- `confidence`: `pass`, `low`, `medium`, `strong`, `very-strong`.
- `primaryHorse`: the main model candidate.
- `supportHorses`: second and third model candidates when they are usable for combinations.
- `bets`: exact line items such as HK$20 Place, HK$10 Win, HK$10 Quinella Place.
- `checklist` and `stopRules`: operational guardrails for the final betting window.

The first version will be conservative:

- No signal: HK$0 PASS.
- Weak but usable Place signal: HK$10-20 Place only.
- Normal signal: HK$30, usually HK$20 Place + HK$10 Win.
- Strong signal with usable support horses: HK$50 or HK$80, adding Quinella Place.
- Very strong signal: HK$100, adding only one small Quinella line.

## Data limits

Current stored HKJC data has Win odds but not official Place, Quinella Place, or Quinella dividends. Therefore the first version cannot truthfully claim multi-bet ROI. It will show a strategy budget and paper-bet structure, while continuing to label historical ROI as model diagnostics only.

## UI placement

Add a "建议投注策略" panel near the final betting plan. It should show:

- Recommended budget.
- Exact bet lines.
- Why this budget was chosen.
- What to check before betting.
- A clear "not guaranteed" guardrail.

The existing "我的测试台" remains the place for the user to record their own paper picks.

