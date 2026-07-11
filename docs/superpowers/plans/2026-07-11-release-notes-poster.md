# Release Notes Poster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each logged-in account the current version update poster once, with an always-available manual entry in Profile.

**Architecture:** Keep version content in a static config, isolate account/version acknowledgement state in a utility, and render one shared component from Session and Profile. Pages own display priority and persistence so the component remains presentation-only.

**Tech Stack:** WeChat Mini Program JavaScript, WXML, WXSS, Node.js regression tests.

## Global Constraints

- The poster has no close affordance and only closes after “我知道了” is persisted.
- Automatic display is scoped by player ID and app version.
- Logged-out accounts do not see or acknowledge the poster.
- Existing onboarding and WeChat profile authorization dialogs take priority.
- Profile provides a manual “版本更新” entry after acknowledgement.

---

### Task 1: Version config and acknowledgement state

**Files:**
- Create: `config/release-notes.js`
- Create: `utils/release-notes.js`
- Test: `tests/release-notes-poster.test.js`

- [ ] Write tests for config validity, account/version keys, acknowledgement, manual reopen, and storage failure.
- [ ] Run the test and verify it fails because the modules do not exist.
- [ ] Implement the minimal config and state utility.
- [ ] Run the test and verify it passes.

### Task 2: Shared poster component

**Files:**
- Create: `components/release-notes-poster/index.js`
- Create: `components/release-notes-poster/index.json`
- Create: `components/release-notes-poster/index.wxml`
- Create: `components/release-notes-poster/index.wxss`
- Modify: `app.json`
- Test: `tests/release-notes-poster.test.js`

- [ ] Add failing structural tests for one acknowledgement action and no close action.
- [ ] Implement the shared component and global registration.
- [ ] Run the test and verify it passes.

### Task 3: Session and Profile integration

**Files:**
- Modify: `pages/session-list/session-list.js`
- Modify: `pages/session-list/session-list.wxml`
- Modify: `pages/profile/profile.js`
- Modify: `pages/profile/profile.wxml`
- Test: `tests/release-notes-poster.test.js`

- [ ] Add failing tests for automatic Session display, Profile manual entry, and shared component usage.
- [ ] Integrate display priority, acknowledgement handling, and manual reopen.
- [ ] Run focused and existing page tests.

### Task 4: Verification

**Files:**
- Modify: `config/app-version.js`

- [ ] Set the new local version and matching release-note version.
- [ ] Run release-note, Session, Profile, and onboarding regression tests.
- [ ] Run JavaScript syntax checks.
- [ ] Run WeChat DevTools auto-preview and record package size.
