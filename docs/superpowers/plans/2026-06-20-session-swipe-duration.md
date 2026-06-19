# Session Swipe And Duration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add review-style swipe edit/delete actions to the Session list and a P5-style `HH:MM` duration display to Session detail.

**Architecture:** Keep duration math in a small CommonJS utility so it can be tested without a WeChat runtime. Reuse the review list's gesture state machine in the Session list, and expose one `dataService.deleteSession` operation whose local and cloud repositories both perform explicit cascade deletion.

**Tech Stack:** WeChat Mini Program JavaScript/WXML/WXSS, CommonJS modules, Node `assert` regression tests, local store plus WeChat cloud database adapter.

---

## File Structure

- Create `utils/session-duration.js`: parse Session timestamps, choose the effective end time, format minute duration.
- Create `tests/session-duration.test.js`: pure duration cases including active, paused, finished, cross-day, over-24-hour and invalid input.
- Modify `pages/session-detail/session-detail.js`: lifecycle-managed minute refresh using the duration utility.
- Modify `pages/session-detail/session-detail.wxml`: B-style centered duration instrument above the start-time form.
- Modify `pages/session-detail/session-detail.wxss`: P5 dark panel, red underline and tabular large digits.
- Create `tests/session-detail-duration-ui.test.js`: static contract for markup and lifecycle cleanup.
- Modify `pages/session-list/session-list.js`: swipe state, guarded navigation, edit action and confirmed delete action.
- Modify `pages/session-list/session-list.wxml`: swipe action layer around each Session card.
- Modify `pages/session-list/session-list.wxss`: reuse review-list swipe dimensions and colors.
- Create `tests/session-swipe-actions.test.js`: static and behavioral contracts for Session list gestures and confirmation.
- Modify `utils/store.js`: local cascade deletion.
- Modify `services/cloud-repo.js`: cloud cascade deletion.
- Modify `services/data-service.js`: public deletion API and sync scheduling.
- Create `tests/session-delete-cascade.test.js`: local cascade and service wiring regression coverage.

### Task 1: Duration Utility

**Files:**
- Create: `utils/session-duration.js`
- Create: `tests/session-duration.test.js`

- [ ] **Step 1: Write the failing duration test**

```js
const assert = require('assert')
const duration = require('../utils/session-duration')

assert.strictEqual(duration.buildDurationView({
  status: 'active', startTime: '2026-06-19 17:52'
}, new Date('2026-06-20T01:42:00')).display, '07:50')
assert.strictEqual(duration.buildDurationView({
  status: 'active', startTime: '2026-06-19 17:52', timerPausedAt: '2026-06-19 20:12'
}, new Date('2026-06-20T01:42:00')).display, '02:20')
assert.strictEqual(duration.buildDurationView({
  status: 'finished', startTime: '2026-06-19 17:52', endTime: '2026-06-20 01:42'
}).display, '07:50')
assert.strictEqual(duration.formatDurationMinutes(1625), '27:05')
assert.strictEqual(duration.buildDurationView({ status: 'active', startTime: 'bad' }).display, '--:--')
console.log('session duration tests passed')
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node tests/session-duration.test.js`

Expected: FAIL with `Cannot find module '../utils/session-duration'`.

- [ ] **Step 3: Implement the pure utility**

```js
function parseSessionDateTime(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]))
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDurationMinutes(minutes) {
  const total = Math.max(0, Math.floor(Number(minutes) || 0))
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0')
}

function buildDurationView(session, now) {
  const start = parseSessionDateTime(session && session.startTime)
  const endText = session && session.status === 'finished'
    ? session.endTime
    : session && session.timerPausedAt
  const end = endText ? parseSessionDateTime(endText) : (now || new Date())
  if (!start || !end || end.getTime() < start.getTime()) {
    return { display: '--:--', label: session && session.status === 'finished' ? 'TOTAL DURATION' : 'SESSION TIME' }
  }
  return {
    display: formatDurationMinutes((end.getTime() - start.getTime()) / 60000),
    label: session && session.status === 'finished' ? 'TOTAL DURATION' : 'SESSION TIME'
  }
}

module.exports = { parseSessionDateTime, formatDurationMinutes, buildDurationView }
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `node tests/session-duration.test.js`

Expected: `session duration tests passed`.

- [ ] **Step 5: Commit**

```bash
git add utils/session-duration.js tests/session-duration.test.js
git commit -m "feat: add session duration formatter"
```

### Task 2: Session Detail Duration Instrument

**Files:**
- Modify: `pages/session-detail/session-detail.js`
- Modify: `pages/session-detail/session-detail.wxml`
- Modify: `pages/session-detail/session-detail.wxss`
- Create: `tests/session-detail-duration-ui.test.js`

- [ ] **Step 1: Write the failing UI lifecycle contract**

```js
const assert = require('assert')
const fs = require('fs')
const js = fs.readFileSync('pages/session-detail/session-detail.js', 'utf8')
const wxml = fs.readFileSync('pages/session-detail/session-detail.wxml', 'utf8')
const wxss = fs.readFileSync('pages/session-detail/session-detail.wxss', 'utf8')

assert.match(wxml, /session-duration-instrument/)
assert.match(wxml, /durationLabel/)
assert.match(wxml, /durationDisplay/)
assert.match(js, /startDurationClock\(\)/)
assert.match(js, /stopDurationClock\(\)/)
assert.match(js, /onHide\(\)[\s\S]*stopDurationClock/)
assert.match(js, /onUnload\(\)[\s\S]*stopDurationClock/)
assert.match(wxss, /font-variant-numeric:\s*tabular-nums/)
console.log('session detail duration ui tests passed')
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node tests/session-detail-duration-ui.test.js`

Expected: FAIL because `session-duration-instrument` is absent.

- [ ] **Step 3: Add lifecycle-driven display state**

Require `../../utils/session-duration`, add `durationDisplay: '--:--'` and `durationLabel: 'SESSION TIME'`, then implement:

```js
refreshDurationDisplay() {
  const view = sessionDuration.buildDurationView(this.data.session)
  this.setData({ durationDisplay: view.display, durationLabel: view.label })
},
startDurationClock() {
  this.stopDurationClock()
  this.refreshDurationDisplay()
  if (!this.data.session || this.data.session.status !== 'active' || this.data.session.timerPausedAt) return
  const delay = 60000 - (Date.now() % 60000) + 50
  this.durationClock = setTimeout(() => {
    this.refreshDurationDisplay()
    this.durationClock = setInterval(() => this.refreshDurationDisplay(), 60000)
  }, delay)
},
stopDurationClock() {
  if (this.durationClock) clearTimeout(this.durationClock)
  if (this.durationClock) clearInterval(this.durationClock)
  this.durationClock = null
}
```

Call `startDurationClock()` after refresh has loaded the Session, and call `stopDurationClock()` in both `onHide` and `onUnload`.

- [ ] **Step 4: Add the selected B markup and styles**

Insert above the start-time form:

```xml
<view wx:if="{{mode !== 'create' && session}}" class="session-duration-instrument">
  <view class="session-duration-label">{{durationLabel}}</view>
  <view class="session-duration-value">{{durationDisplay}}</view>
  <view class="session-duration-rule"></view>
  <view class="session-duration-caption">{{session.status === 'finished' ? 'SESSION 总时长' : (session.timerPausedAt ? '计时已暂停' : '已进行 · 动态计时')}}</view>
</view>
```

Use a centered 76rpx bold value, `font-variant-numeric: tabular-nums`, a red gradient underline, and the existing dark translucent card palette.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `node tests/session-duration.test.js; node tests/session-detail-duration-ui.test.js`

Expected: both scripts print their passed messages.

- [ ] **Step 6: Commit**

```bash
git add pages/session-detail/session-detail.js pages/session-detail/session-detail.wxml pages/session-detail/session-detail.wxss tests/session-detail-duration-ui.test.js
git commit -m "feat: show live session duration"
```

### Task 3: Local And Cloud Session Cascade Delete

**Files:**
- Modify: `utils/store.js`
- Modify: `services/cloud-repo.js`
- Modify: `services/data-service.js`
- Create: `tests/session-delete-cascade.test.js`

- [ ] **Step 1: Write the failing local cascade test**

Create fixture data with one target Session, two target hands, their actions, one unrelated Session and one unrelated hand. Call `store.deleteSession(targetId)` and assert the target Session, target hands and target actions are absent while unrelated records remain. Also assert `data-service.js` and `cloud-repo.js` export `deleteSession`.

```js
assert.strictEqual(store.getSessionById(targetId), null)
assert.strictEqual(store.getHandsBySessionId(targetId).length, 0)
assert.strictEqual(store.getActionsByHandId(targetHandId).length, 0)
assert.ok(store.getSessionById(otherSessionId))
assert.match(dataServiceSource, /async function deleteSession\(sessionId\)/)
assert.match(cloudRepoSource, /async function deleteSession\(sessionId\)/)
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node tests/session-delete-cascade.test.js`

Expected: FAIL with `store.deleteSession is not a function`.

- [ ] **Step 3: Implement local cascade deletion**

In `utils/store.js`, filter all hands belonging to the Session, build their ID set, filter related actions and settlement logs, then remove the Session. Persist once after the state is internally consistent and export `deleteSession`.

```js
function deleteSession(sessionId) {
  const data = readStore()
  const targetHands = data.hands.filter(item => item.sessionId === sessionId)
  const handIds = new Set(targetHands.map(item => item._id))
  data.handActions = data.handActions.filter(item => !handIds.has(item.handId))
  data.hands = data.hands.filter(item => item.sessionId !== sessionId)
  data.bankrollLogs = data.bankrollLogs.filter(item => item.sessionId !== sessionId)
  data.sessions = data.sessions.filter(item => item._id !== sessionId)
  writeStore(data)
  return true
}
```

- [ ] **Step 4: Implement cloud and service deletion**

In `services/cloud-repo.js`, load Session hands, remove each hand's actions, remove the hands, remove `bankrollLogs` matching `sessionId`, then remove the Session document. Export it. In `services/data-service.js`, call the local adapter, schedule business sync with `sync delete session failed`, return the result, and export the function.

```js
async function deleteSession(sessionId) {
  const result = await getLocalAdapter().deleteSession(sessionId)
  scheduleBusinessDataSync('sync delete session failed')
  return result
}
```

- [ ] **Step 5: Run the cascade test and verify GREEN**

Run: `node tests/session-delete-cascade.test.js`

Expected: `session delete cascade tests passed`.

- [ ] **Step 6: Commit**

```bash
git add utils/store.js services/cloud-repo.js services/data-service.js tests/session-delete-cascade.test.js
git commit -m "feat: cascade delete sessions"
```

### Task 4: Session List Swipe Edit And Confirmed Delete

**Files:**
- Modify: `pages/session-list/session-list.js`
- Modify: `pages/session-list/session-list.wxml`
- Modify: `pages/session-list/session-list.wxss`
- Create: `tests/session-swipe-actions.test.js`

- [ ] **Step 1: Write the failing swipe contract test**

```js
const assert = require('assert')
const fs = require('fs')
const js = fs.readFileSync('pages/session-list/session-list.js', 'utf8')
const wxml = fs.readFileSync('pages/session-list/session-list.wxml', 'utf8')
const wxss = fs.readFileSync('pages/session-list/session-list.wxss', 'utf8')

assert.match(wxml, /session-swipe-row/)
assert.match(wxml, /catchtap="editSessionFromList"/)
assert.match(wxml, /catchtap="deleteSessionFromList"/)
assert.match(wxml, /bindtouchstart="onSessionItemTouchStart"/)
assert.match(js, /swipedSessionId/)
assert.match(js, /dataService\.deleteSession\(sessionId\)/)
assert.match(js, /Session[\s\S]*手牌[\s\S]*行动记录[\s\S]*结算记录[\s\S]*无法恢复/)
assert.match(wxss, /translateX\(-176rpx\)/)
console.log('session swipe action tests passed')
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node tests/session-swipe-actions.test.js`

Expected: FAIL because `session-swipe-row` is absent.

- [ ] **Step 3: Add swipe state and gesture handlers**

Add `swipedSessionId`, touch coordinates, active ID and `touchMoved` to page data. Port the review list's 72rpx open and 48rpx close thresholds, update only one Session's `swiped` flag, and guard `goSessionDetail` so a completed swipe never navigates.

- [ ] **Step 4: Add edit and confirmed delete actions**

```js
editSessionFromList(e) {
  const sessionId = e.currentTarget.dataset.id
  if (!sessionId) return
  this.closeSwipedSessionItem()
  wx.navigateTo({ url: '/pages/session-detail/session-detail?id=' + sessionId })
},
deleteSessionFromList(e) {
  const sessionId = e.currentTarget.dataset.id
  if (!sessionId) return
  wx.showModal({
    title: '删除 Session',
    content: '删除后，该 Session、该场全部手牌、行动记录及结算记录都会永久删除且无法恢复。是否继续？',
    confirmText: '删除',
    confirmColor: '#dc2626',
    success: async res => {
      if (!res.confirm) return
      await dataService.deleteSession(sessionId)
      wx.showToast({ title: '已删除', icon: 'success' })
      this.closeSwipedSessionItem()
      this.refreshSessions()
    }
  })
}
```

Extract the current `onShow` loading body into `refreshSessions()` so deletion can refresh without replaying tab setup.

- [ ] **Step 5: Wrap cards and add matching swipe styles**

Use the same two 88rpx action columns, 176rpx translation, cyan edit gradient, red delete gradient and 160ms transition as `review-list`.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `node tests/session-swipe-actions.test.js; node tests/session-delete-cascade.test.js`

Expected: both scripts print their passed messages.

- [ ] **Step 7: Commit**

```bash
git add pages/session-list/session-list.js pages/session-list/session-list.wxml pages/session-list/session-list.wxss tests/session-swipe-actions.test.js
git commit -m "feat: add session swipe actions"
```

### Task 5: Regression Verification

**Files:**
- Verify all changed files and the existing uncommitted review-list work without modifying unrelated behavior.

- [ ] **Step 1: Run every test script**

Run:

```powershell
$failed = 0
$tests = Get-ChildItem tests -Filter *.test.js | Sort-Object Name
foreach ($test in $tests) {
  node $test.FullName
  if ($LASTEXITCODE -ne 0) { $failed += 1 }
}
Write-Output "SUMMARY total=$($tests.Count) failed=$failed"
if ($failed -ne 0) { exit 1 }
```

Expected: `failed=0`.

- [ ] **Step 2: Check whitespace and changed scope**

Run: `git diff --check; git status --short; git diff --stat`

Expected: no whitespace errors; only planned Session files plus the user's existing review-list changes are present.

- [ ] **Step 3: Inspect requirements one by one**

Confirm from tests and diff: B-style centered duration, minute refresh, paused and finished behavior, timer cleanup, swipe edit, destructive warning, confirmed cascade deletion and delete-failure handling.

- [ ] **Step 4: Commit final integration adjustments if any**

```bash
git add utils/session-duration.js utils/store.js services/data-service.js services/cloud-repo.js pages/session-list pages/session-detail tests/session-duration.test.js tests/session-detail-duration-ui.test.js tests/session-delete-cascade.test.js tests/session-swipe-actions.test.js
git commit -m "test: verify session management flow"
```

Skip this commit when verification required no additional changes.
