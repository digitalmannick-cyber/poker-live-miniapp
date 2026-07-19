# Hand Ledger Player Search And Bet Anchor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make player-library matches identifiable and keep every table bet badge attached to its seat without covering cards, avatars, names, or the center board.

**Architecture:** Keep player data normalization in the existing ledger page and render matches as a bounded vertical list using the existing avatar cache fields. Move bet-anchor selection into `utils/hand-table-layout.js`: each seat receives ordered candidate anchors, and the page selects the first candidate that clears the seat's cards/avatar footprint and center-board safety area.

**Tech Stack:** WeChat Mini Program WXML/WXSS/JavaScript, Node.js assertion tests, WeChat DevTools CLI preview.

## Global Constraints

- Preserve existing `pages/hand-ledger-input` routes, fields, player-note binding behavior, and tap handlers.
- Support 6max, 8max, and 9max tables.
- Do not abbreviate stored amounts or player names; presentation may reduce font size for long amounts.
- Keep production changes test-first and verify on the real workspace preview.

---

### Task 1: Player Search Result List

**Files:**
- Modify: `tests/hand-ledger-input-flow.test.js`
- Modify: `pages/hand-ledger-input/hand-ledger-input.wxml`
- Modify: `pages/hand-ledger-input/hand-ledger-input.wxss`

**Interfaces:**
- Consumes: existing `playerLibraryOptions` entries from `buildPlayerLibraryOption()`.
- Produces: vertical `scroll-view` rows showing `avatarDisplayUrl`, `avatarText`, full `name`, `type`, and selected state.

- [ ] Add assertions that the result list scrolls vertically, hides its scrollbar, renders avatar image/fallback, keeps names on up to two lines, and preserves the existing selection event.
- [ ] Run `node tests/hand-ledger-input-flow.test.js` and confirm the new assertions fail.
- [ ] Replace horizontal chips with vertical player rows and add bounded-list styles.
- [ ] Run `node tests/hand-ledger-input-flow.test.js` and confirm the assertions pass.

### Task 2: Collision-Aware Bet Anchors

**Files:**
- Modify: `tests/hand-table-layout.test.js`
- Modify: `tests/hand-ledger-input-flow.test.js`
- Modify: `utils/hand-table-layout.js`
- Modify: `pages/hand-ledger-input/hand-ledger-input.js`
- Modify: `pages/hand-ledger-input/hand-ledger-input.wxml`
- Modify: `pages/hand-ledger-input/hand-ledger-input.wxss`

**Interfaces:**
- Produces: `getBetAnchorCandidates(tableSize, slot)` returning ordered `{ x, y, placement }` points.
- Consumes: seat card/avatar/name occupancy from the page's existing seat view model.
- Produces: each seat view receives `betStyle`, `betPlacement`, and `betCompact`.

- [ ] Add layout assertions for candidate order, table bounds, seat clearance, and center-board clearance across all table sizes.
- [ ] Add page-flow assertions that right-edge avatar seats and card seats choose distinct, non-covering anchors.
- [ ] Run the two focused tests and confirm the new assertions fail.
- [ ] Implement candidate anchors and page selection using deterministic rectangle-overlap scoring.
- [ ] Add placement classes and a compact long-amount style while keeping the full amount text.
- [ ] Run the focused tests and confirm they pass.

### Task 3: Regression And Preview Verification

**Files:**
- Verify only: `tests/*.test.js`
- Verify only: `tools/auto-preview.ps1`

**Interfaces:**
- Produces: passing Node regression suite and a real-workspace WeChat preview artifact.

- [ ] Run all repository Node tests and fix regressions attributable to these changes.
- [ ] Run syntax/static checks for the edited JavaScript and WXML/WXSS contract tests.
- [ ] Run the real-workspace WeChat DevTools auto-preview workflow and record its result without uploading a development version.
