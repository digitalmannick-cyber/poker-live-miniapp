# Stats Command Center Redesign

## Context

The current `pages/stats` screen shows only five basic KPI values and its WXML copy is corrupted. The redesign will turn this tab into a comprehensive poker performance command center while staying consistent with the miniapp's existing Persona 5-inspired visual system.

The user selected the comprehensive direction: combine business performance, review diagnosis, volatility, opponent/position breakdowns, and review priorities. The style should stay aligned with the current miniapp instead of becoming a separate, over-designed theme.

## Goals

- Preserve the existing miniapp mood: black/red base, cyan positive highlights, sharp Persona 5-like rhythm, dark cards, and existing reusable app chrome.
- Make the stats tab useful for decisions, not just passive totals.
- Use only fields already present in local/cloud data: sessions, hands, hand actions, settings, and review metadata.
- Keep the page mobile-first for WeChat Mini Program screens, with dense but readable data blocks.
- Avoid fake metrics that cannot be derived from current fields.

## Existing Data Surface

Session fields available for stats:

- `status`, `venue`, `smallBlind`, `bigBlind`, `tableSize`
- `buyIn`, `cashOut`, `totalProfit`, `durationMinutes`
- `handCount`, `startTime`, `endTime`, `date`

Hand fields available for stats:

- `playedDate`, `stakeLevel`, `heroPosition`, `villainPosition`
- `villainType`, `opponentType`, `opponentName`
- `hasStraddle`, `effectiveStack`, `potSize`, `currentProfit`, `resultBB`
- `tags`, `reviewStatus`, `aiReview`, `detailBackfilled`
- `heroCardsInput`, `board`, `showdown`, `streetInputs`

Hand action fields available for future extension:

- `street`, `actorSeat`, `actorLabel`, `actionType`, `amount`, `potAfter`

## Information Architecture

The stats tab will be one vertically scrolling screen with five sections.

### 1. Hero Report

Purpose: give the player an immediate read on current performance.

Content:

- Total profit
- Hourly rate
- Completed session count
- Total hands
- Win-rate by completed sessions
- Bankroll estimate
- Small status line such as "Profitable", "Waiting for sample", or "Stop-loss review needed". The implementation should use normal Chinese UI copy.

Visual treatment:

- Keep the app's existing card system but make the top panel more editorial and P5-like.
- Use angled red blocks, strong type, and optional existing P5 character asset as low-opacity background art.
- Positive values use current cyan convention; negative values use red.

### 2. Performance Board

Purpose: summarize whether the player is making money and where.

Metrics:

- Average profit per completed session
- Average duration per completed session
- Best session and worst session
- Venue ranking by total profit and hourly rate
- Stake ranking by total profit and hands

Display:

- Compact two-column metric cards for high-level values.
- Ranking rows for venue and stake.
- Empty states when there are no completed sessions.

### 3. Tactical Diagnosis

Purpose: show which poker contexts are driving results.

Breakdowns:

- Hero position: hands, profit, win count, average profit
- Opponent type: hands, profit, average profit
- Straddle vs non-straddle: hands, profit, average profit
- Review tag frequency and total profit

Highlighted insights:

- Best position
- Worst position
- Most expensive tag
- Most profitable opponent type

Display:

- Small "intel cards" for highlighted insights.
- Bar-like rows using CSS width percentages for relative magnitude.
- Do not render complex chart libraries; WeChat CSS bars are enough and safer.

### 4. Volatility And Big Pots

Purpose: make risk and swing profile visible.

Metrics:

- Biggest winning hand
- Biggest losing hand
- Average pot size
- Big pot count using current data-derived threshold: pot size at least 2x average pot, or at least 100BB when stake level is parseable.
- Profit distribution: win hands, lose hands, breakeven hands
- Profit factor: total won divided by absolute total lost, shown only when losses exist.

Display:

- Three compact distribution bars.
- A featured largest win/loss pair with card-like rows.
- Use current hand fields only; no EV approximation unless `ev` is structured later.

### 5. Review Priority

Purpose: turn stats into the next action.

Priority buckets:

- Large losing hands not reviewed
- Hands with tags that are frequent or costly
- Hands missing detailed backfill
- Reviewed hands count vs total hands

Display:

- "Review priority" style list with counts and reasons. The implementation should use normal Chinese UI copy.
- A short empty state when all available hands are reviewed or sample size is too small.
- Optional tap targets can later navigate to review filters, but first implementation can be read-only if route-level filters are not already supported.

## Interaction Model

The first implementation should include:

- Time range segmented control: all time, last 30 days, last 7 days. The implementation should use normal Chinese UI copy.
- Metric sections recompute from the selected time range.
- Ranking rows and diagnosis rows are rendered from actual data arrays.
- No new pages are required.

Non-goals for the first implementation:

- Exporting charts.
- Cloud-only aggregate queries.
- Advanced line chart canvas rendering.
- Predictive or AI-generated advice.

## Data Architecture

Add a richer stats builder in the data layer rather than computing everything inside the page component.

Preferred shape:

- `dataService.getStatsData()` returns existing `stats` plus a new `analytics` object.
- `store.getStatsAnalytics(filters)` or an equivalent helper builds analytics from local arrays.
- Cloud fallback can initially use local synced data because the app already reads stats locally for dashboard speed.

Analytics object outline:

```js
{
  rangeKey,
  overview,
  performance,
  byVenue,
  byStake,
  byPosition,
  byOpponentType,
  byStraddle,
  byTag,
  volatility,
  reviewPriority,
  insights
}
```

Each row should include display-ready primitives where useful: `label`, `count`, `profit`, `profitDisplay`, `averageProfit`, `tone`, and `barWidth`.

## Visual System

Use current miniapp tokens and behavior:

- Background: existing dark red/black global page background.
- Cards: current dark translucent cards with light border, but stats-specific cards can use sharper corners and angled pseudo-elements.
- Accent: `#e60012` red for aggression and section identity.
- Positive: current cyan.
- Negative: current red.
- Typography: keep system fonts and current heavy weights. Do not introduce external fonts.
- Imagery: reuse existing local P5 assets such as `assets/p5-character.svg` or `assets/p5-knight-bg.svg` as subtle page art if compatible with Mini Program image rendering.

Layout rules:

- No nested cards inside cards.
- Keep repeated metric cells stable in height to prevent layout jumps.
- Avoid tiny labels that become unreadable on mobile.
- Keep bottom spacing compatible with custom tab bar and agent chat.

## Empty And Low-Data States

- If no sessions or hands exist, show a P5-style empty report. The implementation should use normal Chinese UI copy.
- If sessions exist but none are finished, show active sample count and explain that profit metrics need completed sessions.
- If a dimension has no usable rows, hide the ranking and show a short muted line.
- Do not show divide-by-zero values, `NaN`, or misleading zeroes for unavailable stats.

## Testing Plan

Unit tests should cover the analytics builder:

- Empty data returns stable zero/empty analytics.
- Completed and active sessions are separated correctly.
- Time range filters include the expected sessions and hands.
- Venue, stake, position, opponent type, straddle, and tag rankings aggregate profit and counts correctly.
- Volatility handles wins, losses, breakeven hands, and missing stake levels.
- Review priority detects large unreviewed losses and missing detail backfill.

UI syntax tests should cover:

- `pages/stats/stats.wxml` parses successfully.
- The page can render with empty analytics arrays.

## Implementation Boundaries

Files likely to change:

- `pages/stats/stats.js`
- `pages/stats/stats.wxml`
- `pages/stats/stats.wxss`
- `services/data-service.js`
- `utils/store.js` or a new focused analytics utility under `utils/`
- focused tests under `tests/`

Avoid changing unrelated active work in other tabs or the agent chat component.
