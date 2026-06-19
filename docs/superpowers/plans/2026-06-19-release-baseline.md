# Release Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the current miniapp work as a tested, traceable Git baseline before the next WeChat upload.

**Architecture:** Keep the intertwined working-tree changes together in one checkpoint commit so no partial feature state is lost. Isolate the checkpoint on a `codex/` release branch, verify all repository tests, and leave publishing as a separate explicit operation.

**Tech Stack:** Git, PowerShell, Node.js test scripts, WeChat Mini Program source files

---

### Task 1: Audit and isolate the working tree

**Files:**
- Inspect: all tracked modifications and untracked files reported by Git

- [x] **Step 1: List all changes**

Run: `git status --short --branch`

- [x] **Step 2: Scan changed files for private keys and credential assignments**

Expected: no production secret values in the pending baseline.

- [x] **Step 3: Create the release baseline branch**

Run: `git switch -c codex/release-baseline-20260619`

### Task 2: Verify the baseline

**Files:**
- Test: `tests/*.test.js`

- [x] **Step 1: Run every Node.js test file**

Run each `tests/*.test.js` file with Node.js and collect every failure rather than stopping after the first file.

- [x] **Step 2: Resolve canonical field regressions**

Keep current user-entered straddle fields authoritative, allow explicit transcript evidence to fill missing straddle data, and preserve `heroQuestion` during normalization.

- [x] **Step 3: Re-run the complete test suite**

Expected: all test files pass with zero failures.

### Task 3: Create and verify the checkpoint

**Files:**
- Stage: all intended tracked and untracked project files

- [x] **Step 1: Check whitespace errors**

Run: `git diff --check`

- [x] **Step 2: Commit the complete baseline**

Run: `git add -A && git commit -m "chore: establish tested release baseline"`

- [x] **Step 3: Verify final repository state**

Run: `git status --short --branch` and `git log -1 --oneline --decorate`.

Expected: clean working tree on `codex/release-baseline-20260619`, with the new baseline commit at `HEAD`.
