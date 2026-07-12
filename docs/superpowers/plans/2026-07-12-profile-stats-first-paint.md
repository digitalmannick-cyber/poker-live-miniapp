# Profile Stats First Paint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Profile cumulative-hours value render from the latest trusted account-scoped cloud summary without flashing a placeholder or stale local value.

**Architecture:** `services/data-service.js` owns a small persistent Profile stats snapshot keyed by `playerId`. `pages/profile/profile.js` synchronously hydrates its initial statistics from that snapshot, while the existing background cloud refresh remains authoritative and refreshes the snapshot. A stable skeleton is shown only when no trusted snapshot exists.

**Tech Stack:** WeChat Mini Program JavaScript/WXML/WXSS, synchronous WeChat storage, Node.js `node:test`.

## Global Constraints

- Preserve cloud `sync_stats` as the authoritative refresh path.
- Never reuse a snapshot across different `playerId` values.
- Do not upload a WeChat development version.
- Bump `config/app-version.js` and run auto-preview after code verification.

---

### Task 1: Account-scoped Profile stats snapshot

**Files:**
- Modify: `services/data-service.js`
- Test: `tests/stats-cache-no-local-fallback.test.js`

**Interfaces:**
- Produces: `getProfileStatsSnapshot(): object|null`
- Internal: cloud `all` stats writes `{ playerId, stats, cachedAt }` to WeChat storage.

- [ ] **Step 1: Write failing tests** for persisting a successful cloud summary, reading it after in-memory cache reset, rejecting another account, and clearing it on cache invalidation.
- [ ] **Step 2: Run test to verify it fails** with the missing snapshot API or missing persisted value.
- [ ] **Step 3: Implement minimal snapshot helpers** with guarded storage reads/writes and exact `playerId` matching.
- [ ] **Step 4: Run test to verify it passes** using `node tests/stats-cache-no-local-fallback.test.js`.

### Task 2: Stable Profile first paint

**Files:**
- Modify: `pages/profile/profile.js`
- Modify: `pages/profile/profile.wxml`
- Modify: `pages/profile/profile.wxss`
- Test: `tests/profile-layout.test.js`

**Interfaces:**
- Consumes: `dataService.getProfileStatsSnapshot()`.
- Produces: `titleStatsReady` state and a fixed-size skeleton when no trusted summary exists.

- [ ] **Step 1: Write a failing source-level test** requiring initial stats/title progress to come from the snapshot and forbidding `resolvePlayerTitle(0)` as the first-paint source.
- [ ] **Step 2: Run test to verify it fails** against the hard-coded Profile defaults.
- [ ] **Step 3: Hydrate initial Profile data synchronously** and set `titleStatsReady` after any valid Profile payload is applied.
- [ ] **Step 4: Add the stable skeleton branch** without changing the header layout dimensions.
- [ ] **Step 5: Run Profile and stats regression tests** and confirm all pass.

### Task 3: Version and preview verification

**Files:**
- Modify: `config/app-version.js`

**Interfaces:**
- Produces: visible version `3.14`.

- [ ] **Step 1: Bump display version** from `3.13` to `3.14`.
- [ ] **Step 2: Run syntax and focused regression checks** for modified modules and tests.
- [ ] **Step 3: Run WeChat DevTools auto-preview** on the real workspace, using the existing clean-package fallback only if package limits require it.
- [ ] **Step 4: Inspect the final diff and working tree** to ensure unrelated user changes remain untouched.
