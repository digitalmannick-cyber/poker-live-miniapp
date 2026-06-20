# Single Active Session And Status Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent a second active Session from being created and replace the review page's growing Session list with a stable active/finished status filter.

**Architecture:** Put the shared creation rule, error code and user message in a small CommonJS utility used by pages, local storage, data service and cloud repository. Keep review UI state as `sessionStatus`, and let `dataService.getReviewData()` filter reviewed hands against the Session status map after existing hand filters run.

**Tech Stack:** WeChat Mini Program JavaScript/WXML/WXSS, CommonJS modules, Node `assert` tests.

---

### Task 1: Shared Single-Active-Session Rule

**Files:**
- Create: `utils/session-rules.js`
- Create: `tests/single-active-session.test.js`
- Modify: `utils/store.js`
- Modify: `services/data-service.js`
- Modify: `services/cloud-repo.js`

- [ ] **Step 1: Write the failing rule test**

Test that `assertCanCreateSession()` throws `ACTIVE_SESSION_EXISTS`, that local store refuses a second Session, and that `dataService.createSession()` exposes the same error.

```js
const assert = require('assert')
const rules = require('../utils/session-rules')

assert.throws(
  () => rules.assertCanCreateSession([{ _id: 's1', status: 'active' }]),
  error => error.code === 'ACTIVE_SESSION_EXISTS' && error.message === rules.ACTIVE_SESSION_MESSAGE
)
assert.doesNotThrow(() => rules.assertCanCreateSession([{ _id: 's1', status: 'finished' }]))
```

- [ ] **Step 2: Run RED**

Run: `node tests/single-active-session.test.js`

Expected: FAIL because `utils/session-rules.js` does not exist.

- [ ] **Step 3: Implement shared rule and repository guards**

```js
const ACTIVE_SESSION_ERROR_CODE = 'ACTIVE_SESSION_EXISTS'
const ACTIVE_SESSION_MESSAGE = '创建新 Session 前需先结束当前 Session'

function findActiveSession(sessions) {
  return (sessions || []).find(item => item && item.status === 'active') || null
}

function assertCanCreateSession(sessions) {
  const activeSession = findActiveSession(sessions)
  if (!activeSession) return true
  const error = new Error(ACTIVE_SESSION_MESSAGE)
  error.code = ACTIVE_SESSION_ERROR_CODE
  error.activeSessionId = activeSession._id || ''
  throw error
}

module.exports = { ACTIVE_SESSION_ERROR_CODE, ACTIVE_SESSION_MESSAGE, findActiveSession, assertCanCreateSession }
```

Call `assertCanCreateSession(data.sessions)` before local store mutation, before data-service adapter creation, and after cloud repository reads existing Sessions.

- [ ] **Step 4: Run GREEN and syntax checks**

Run: `node tests/single-active-session.test.js; node --check utils/store.js; node --check services/data-service.js; node --check services/cloud-repo.js`

Expected: test prints `single active session tests passed`; checks exit 0.

### Task 2: Guard Every Create Entry

**Files:**
- Create: `tests/session-create-entry-guard.test.js`
- Modify: `pages/session-list/session-list.js`
- Modify: `pages/session-list/session-list.wxml`
- Modify: `pages/session-list/session-list.wxss`
- Modify: `pages/hand-record/hand-record.js`
- Modify: `pages/session-detail/session-detail.js`

- [ ] **Step 1: Write the failing UI contract test**

Assert all three pages import the shared rule, list button renders a disabled class from `activeSession`, list and record entry handlers show `ACTIVE_SESSION_MESSAGE`, and direct create mode checks before rendering.

```js
assert.match(sessionListWxml, /new-session-btn \{\{activeSession \? 'disabled' : ''\}\}/)
assert.match(sessionListJs, /goNewSession\(\)[\s\S]*ACTIVE_SESSION_MESSAGE/)
assert.match(handRecordJs, /goCreateSession\(\)[\s\S]*ACTIVE_SESSION_MESSAGE/)
assert.match(sessionDetailJs, /guardCreateMode\(\)/)
```

- [ ] **Step 2: Run RED**

Run: `node tests/session-create-entry-guard.test.js`

Expected: FAIL because the shared UI guard is absent.

- [ ] **Step 3: Implement list and record guards**

Store `activeSession` during list refresh. In both entry handlers, when active exists, call:

```js
wx.showToast({ title: sessionRules.ACTIVE_SESSION_MESSAGE, icon: 'none' })
return
```

Add a visually disabled but tappable class to the Session list button so the message remains discoverable.

- [ ] **Step 4: Guard direct create mode and save errors**

Before building the create form, load Sessions and leave the create page if one is active. Wrap `dataService.createSession(payload)` in `try/catch`; show the shared message for `ACTIVE_SESSION_EXISTS`, otherwise show `创建失败，请稍后重试`.

- [ ] **Step 5: Run GREEN**

Run: `node tests/session-create-entry-guard.test.js; node tests/session-action-buttons.test.js; node tests/session-list-wxml-syntax.test.js`

Expected: all scripts pass.

### Task 3: Review Status Filter Data Flow

**Files:**
- Create: `tests/review-session-status-filter.test.js`
- Modify: `services/data-service.js`
- Modify: `pages/hand-record/hand-record.js`
- Modify: `pages/review-list/review-list.js`
- Modify: `pages/review-list/review-list.wxml`

- [ ] **Step 1: Write the failing status-filter test**

Test the data helper with active and finished Session IDs and assert the WXML contains exactly the two status choices, uses “牌局状态”, and no longer renders `draftSessionOptions`.

```js
const hands = [{ _id: 'h1', sessionId: 'active' }, { _id: 'h2', sessionId: 'finished' }]
const sessions = [{ _id: 'active', status: 'active' }, { _id: 'finished', status: 'finished' }]
assert.deepStrictEqual(filterHandsBySessionStatus(hands, sessions, 'active').map(item => item._id), ['h1'])
assert.deepStrictEqual(filterHandsBySessionStatus(hands, sessions, 'finished').map(item => item._id), ['h2'])
assert.match(wxml, /牌局状态/)
assert.doesNotMatch(wxml, /draftSessionOptions/)
```

- [ ] **Step 2: Run RED**

Run: `node tests/review-session-status-filter.test.js`

Expected: FAIL because `filterHandsBySessionStatus` and status controls are absent.

- [ ] **Step 3: Implement data-service status filtering**

```js
function normalizeSessionStatus(value) {
  return value === 'active' ? 'active' : 'finished'
}

function filterHandsBySessionStatus(hands, sessions, status) {
  const normalized = normalizeSessionStatus(status)
  const allowed = new Set((sessions || []).filter(item => item.status === normalized).map(item => item._id))
  return (hands || []).filter(item => allowed.has(item.sessionId))
}
```

In `getReviewData`, remove `sessionStatus` and legacy `sessionId` from the adapter filters, fetch matching hands using existing date/result/tag/sort logic, apply status filtering, then calculate summary from the filtered list. Export helpers through `__test`.

- [ ] **Step 4: Replace review page Session state with status state**

Use `selectedSessionStatus` and `draftSessionStatus`. Build two options:

```js
const SESSION_STATUS_OPTIONS = [
  { key: 'active', label: '进行中' },
  { key: 'finished', label: '已结束' }
]
```

On first load choose active when present, otherwise finished. If active is currently selected and no active Session remains, switch to finished. Preserve an explicit finished selection on refresh. Convert legacy pending `sessionId` to the referenced Session's status.

- [ ] **Step 5: Update filter UI and hand-record pending filter**

Render the two `draftSessionStatusOptions` chips under “牌局状态”. Change saved-hand pending filters to `sessionStatus: 'active'`.

- [ ] **Step 6: Run GREEN and regression tests**

Run: `node tests/review-session-status-filter.test.js; node tests/store-review-filters.test.js; node tests/review-wxml-syntax.test.js; node tests/review-voice-idempotency.test.js`

Expected: all scripts pass.

### Task 4: Full Verification

**Files:** Verify all planned files while preserving existing uncommitted review work.

- [ ] **Step 1: Run all test scripts**

```powershell
$failed = 0
$tests = Get-ChildItem tests -Filter *.test.js | Sort-Object Name
foreach ($test in $tests) { node $test.FullName; if ($LASTEXITCODE -ne 0) { $failed += 1 } }
Write-Output "SUMMARY total=$($tests.Count) failed=$failed"
if ($failed -ne 0) { exit 1 }
```

- [ ] **Step 2: Verify scope and whitespace**

Run: `git diff --check; git status --short; git diff --stat`

Expected: no whitespace errors; existing review changes remain present alongside planned feature files.
