# Profile P5 Command List Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将小程序“我的”页重构为已确认的 P5“怪盗命令清单”，按玩家信息、偏好设置、数据管理、AI 自动提醒、帮助与反馈、账号与安全排列，同时保留全部现有业务能力。

**Architecture:** 继续使用现有 `pages/profile/profile` 页面和处理函数，不新增路由或数据层。先用源码级 Node 测试锁定模块顺序、入口归属、事件绑定和危险操作位置，再重排 WXML；随后通过页面根级作用域类实现 P5 视觉系统，避免影响资料编辑、AI 提醒编辑器和版本海报等弹层。

**Tech Stack:** WeChat Mini Program WXML/WXSS/JavaScript、Node.js `node:test`、微信开发者工具 CLI `auto-preview`。

## Global Constraints

- 登录态模块顺序必须为：玩家信息 → 偏好设置 → 数据管理 → AI 自动提醒 → 帮助与反馈 → 账号与安全。
- “新手引导”必须迁入“帮助与反馈”；不得删除或改写 `restartOnboardingGuide` 行为。
- “关于”和“版本更新”必须合并为“关于与版本更新”，点击继续调用 `openReleaseNotes`。
- “清除所有数据”继续调用 `clearData` 并保留现有二次确认，不得误写成“清除本地数据”。
- “退出登录”必须是页面内容区域最后一个可操作项，并继续调用 `logoutAccount`。
- 原生反馈入口必须保留 `<button open-type="contact">`，且仅登录用户可见。
- 不改变资料、统计、设置、提醒、导入导出、登录或版本海报的数据结构。
- 不新增页面路由，不调整底部 Tab，不修改 AI 提醒编辑器、资料编辑器、称号路线或版本海报内部布局。
- 不修改 `config/app-version.js` 或 `config/release-notes.js`；当前工作区已有与本任务无关的版本改动。
- 不自动上传开发版本；仅运行真实工作区自动预览。
- 当前工作树含大量用户未提交改动。执行阶段必须先使用 `superpowers:using-git-worktrees` 创建隔离工作树，或在用户明确要求当前工作树执行时仅精确暂存本计划列出的文件。

---

## File Map

- Modify: `pages/profile/profile.wxml` — 登录态信息架构、入口迁移、关于与版本入口合并、页面作用域类。
- Modify: `pages/profile/profile.wxss` — 怪盗命令清单视觉系统，只作用于页面常规内容，不覆盖弹层组件。
- Modify: `pages/profile/profile.js` — 删除失去引用的 `showAbout`，其余业务方法保持原样。
- Modify: `tests/profile-layout.test.js` — 更新新手引导归属断言，并保留现有布局/数据能力回归。
- Modify: `tests/release-notes-poster.test.js` — 锁定合并入口仍调用现有版本海报。
- Modify: `tests/profile-customer-feedback-entry.test.js` — 适配新清单容器，继续锁定登录态原生客服。
- Create: `tests/profile-command-list-redesign.test.js` — 锁定六段顺序、退出登录位置、页面作用域类和 P5 样式契约。

---

### Task 1: Lock The New Information Architecture With Failing Tests

**Files:**
- Create: `tests/profile-command-list-redesign.test.js`
- Modify: `tests/profile-layout.test.js`
- Modify: `tests/release-notes-poster.test.js`
- Modify: `tests/profile-customer-feedback-entry.test.js`

**Interfaces:**
- Consumes: `pages/profile/profile.wxml` source markup and `pages/profile/profile.js` source text.
- Produces: source-level regression contract for module order, handlers, logged-in visibility, and final destructive action.

- [ ] **Step 1: Create the failing command-list structure test**

Create `tests/profile-command-list-redesign.test.js` with:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const wxml = fs.readFileSync(path.join(root, 'pages/profile/profile.wxml'), 'utf8')
const wxss = fs.readFileSync(path.join(root, 'pages/profile/profile.wxss'), 'utf8')
const js = fs.readFileSync(path.join(root, 'pages/profile/profile.js'), 'utf8')

function indexOfOrFail(text, label) {
  const index = wxml.indexOf(text)
  assert.ok(index >= 0, `${label} should exist`)
  return index
}

test('logged-in profile follows the approved command-list order', () => {
  const player = indexOfOrFail('class="profile-hero"', 'player hero')
  const preferences = indexOfOrFail('>偏好设置</view>', 'preferences')
  const data = indexOfOrFail('>数据管理</view>', 'data management')
  const ai = indexOfOrFail('>AI 自动提醒</view>', 'AI reminder')
  const help = indexOfOrFail('>帮助与反馈</view>', 'help and feedback')
  const account = indexOfOrFail('>账号与安全</view>', 'account and security')

  assert.ok(player < preferences)
  assert.ok(preferences < data)
  assert.ok(data < ai)
  assert.ok(ai < help)
  assert.ok(help < account)
})

test('help owns feedback onboarding and the merged release entry', () => {
  const helpStart = indexOfOrFail('>帮助与反馈</view>', 'help and feedback')
  const accountStart = indexOfOrFail('>账号与安全</view>', 'account and security')
  const helpMarkup = wxml.slice(helpStart, accountStart)

  assert.match(helpMarkup, /open-type="contact"/)
  assert.match(helpMarkup, /restartOnboardingGuide/)
  assert.match(helpMarkup, />关于与版本更新</)
  assert.match(helpMarkup, /bindtap="openReleaseNotes"/)
  assert.doesNotMatch(helpMarkup, />版本更新</)
  assert.doesNotMatch(helpMarkup, />关于</)
  assert.doesNotMatch(wxml.slice(accountStart), /restartOnboardingGuide/)
  assert.doesNotMatch(wxml, /bindtap="showAbout"/)
  assert.doesNotMatch(js, /showAbout\(\)/)
})

test('logout is the final actionable profile content', () => {
  const accountStart = indexOfOrFail('>账号与安全</view>', 'account and security')
  const logout = indexOfOrFail('bindtap="logoutAccount"', 'logout')
  const footer = indexOfOrFail('class="profile-footer"', 'profile footer')

  assert.ok(accountStart < logout)
  assert.ok(logout < footer)
  assert.doesNotMatch(wxml.slice(logout + 1, footer), /bindtap=|catchtap=|open-type=/)
})

```

- [ ] **Step 2: Update the existing onboarding ownership test**

In `tests/profile-layout.test.js`, first replace `sectionMarkup` so it supports the new multi-class labels:

```js
function sectionMarkup(title) {
  const titleMarker = `>${title}</view>`
  const titleIndex = wxml.indexOf(titleMarker)
  if (titleIndex < 0) return ''
  const start = wxml.lastIndexOf('<view', titleIndex)
  const next = wxml.indexOf('class="section-label profile-command-label"', titleIndex + titleMarker.length)
  return wxml.slice(start, next < 0 ? wxml.length : next)
}
```

Then replace the test named `onboarding guide is inside account and data module` with:

```js
test('onboarding guide is inside help and feedback module', () => {
  const preferences = sectionMarkup('偏好设置')
  const help = sectionMarkup('帮助与反馈')
  const account = sectionMarkup('账号与安全')

  assert.doesNotMatch(preferences, /新手引导/)
  assert.match(help, /新手引导/)
  assert.match(help, /restartOnboardingGuide/)
  assert.doesNotMatch(account, /新手引导/)
})
```

- [ ] **Step 3: Update the release-notes manual-entry assertion**

In `tests/release-notes-poster.test.js`, update the final test’s profile assertions to:

```js
assert.match(profileWxml, /关于与版本更新/)
assert.doesNotMatch(profileWxml, /<view class="setting-title">版本更新<\/view>/)
assert.doesNotMatch(profileWxml, /<view class="setting-title">关于<\/view>/)
assert.match(profileWxml, /<release-notes-poster/)
assert.match(profileJs, /openReleaseNotes/)
assert.doesNotMatch(profileJs, /showAbout\(\)/)
assert.match(profileJs, /acknowledgeReleaseNotes/)
```

- [ ] **Step 4: Adapt the feedback container assertion without weakening the native-contact contract**

In `tests/profile-customer-feedback-entry.test.js`, replace `helpAndFeedbackMarkup` with:

```js
function helpAndFeedbackMarkup() {
  const marker = '<view wx:if="{{!accountLoggedOut}}" class="section-label profile-command-label">帮助与反馈</view>'
  const start = wxml.indexOf(marker)
  if (start < 0) return ''
  const nextSection = wxml.indexOf('class="section-label profile-command-label"', start + marker.length)
  return wxml.slice(start, nextSection < 0 ? wxml.length : nextSection)
}
```

Then replace the card-container assertion with:

```js
assert.match(markup, /class="profile-command-list"/)
assert.match(markup, /<button class="setting-row customer-feedback-button" open-type="contact"/)
```

Keep the existing logged-in section, copy, button chrome, and no-route assertions unchanged.

- [ ] **Step 5: Run the focused tests and verify RED**

Run:

```powershell
node --test tests/profile-command-list-redesign.test.js tests/profile-layout.test.js tests/profile-customer-feedback-entry.test.js tests/release-notes-poster.test.js
```

Expected: FAIL because `profile-command-page`, the new order, “账号与安全”, onboarding migration, merged release entry, and P5 hooks do not yet exist. Existing unrelated profile behavior tests may still pass.

---

### Task 2: Reorder Profile Markup And Merge Existing Entries

**Files:**
- Modify: `pages/profile/profile.wxml`
- Modify: `pages/profile/profile.js`
- Test: `tests/profile-command-list-redesign.test.js`
- Test: `tests/profile-layout.test.js`
- Test: `tests/profile-customer-feedback-entry.test.js`
- Test: `tests/release-notes-poster.test.js`

**Interfaces:**
- Consumes: existing handlers `selectChipUnit`, `editVenues`, `editBlindPresets`, `editOpponentTypes`, `importPbtPlayerData`, `importPbtBankrollData`, `exportBackup`, `openAiReminderEditor`, `toggleAiReminderMasterSwitch`, `restartOnboardingGuide`, `openReleaseNotes`, `copyPlayerId`, `clearData`, and `logoutAccount`.
- Produces: WXML source ordered by the approved six modules and scoped with `profile-command-page`.

- [ ] **Step 1: Add the page-level scope and command-section hooks**

Change the opening container in `pages/profile/profile.wxml` to:

```xml
<view class="container profile-command-page">
```

For every logged-in module, use this structure:

```xml
<view wx:if="{{!accountLoggedOut}}" class="section-label profile-command-label">模块标题</view>
<view wx:if="{{!accountLoggedOut}}" class="profile-command-section">
  <view class="profile-command-list">
    <!-- existing controls and bindings -->
  </view>
</view>
```

The outer `profile-command-section` provides vertical rhythm; `profile-command-list` is the shared list surface. Do not wrap individual rows in additional cards.

- [ ] **Step 2: Move the complete preference block before data management**

Move the current “偏好设置” markup, including chip unit, venue, blind and opponent controls, so it appears immediately after the profile/WeChat-sync area and before “数据管理”. Preserve all bindings and `settings.*` expressions exactly.

- [ ] **Step 3: Keep data management and AI reminder behavior unchanged while converting containers**

Convert the existing data and AI containers to `profile-command-section` / `profile-command-list`. Preserve:

```xml
bindtap="importPbtPlayerData"
bindtap="importPbtBankrollData"
bindtap="exportBackup"
catchtap="openAiReminderEditor"
catchtap="toggleAiReminderMasterSwitch"
```

- [ ] **Step 4: Build the help-and-feedback list in the approved order**

Replace the current single-row help card with:

```xml
<view wx:if="{{!accountLoggedOut}}" class="section-label profile-command-label">帮助与反馈</view>
<view wx:if="{{!accountLoggedOut}}" class="profile-command-section">
  <view class="profile-command-list">
    <button class="setting-row customer-feedback-button" open-type="contact" hover-class="none" aria-label="反馈与建议">
      <view class="setting-main">
        <view>
          <view class="setting-title">反馈与建议</view>
          <view class="small muted">反馈问题、Bug 或功能建议</view>
        </view>
      </view>
      <view class="setting-arrow">›</view>
    </button>
    <view class="setting-row" bindtap="restartOnboardingGuide">
      <view class="setting-main">
        <view>
          <view class="setting-title">新手引导</view>
          <view class="small muted">重新查看开局、记牌、复盘和统计流程</view>
        </view>
      </view>
      <view class="setting-arrow">›</view>
    </view>
    <view class="setting-row" bindtap="openReleaseNotes">
      <view class="setting-main">
        <view>
          <view class="setting-title">关于与版本更新</view>
          <view class="small muted">当前版本 {{version}} · 查看更新内容</view>
        </view>
      </view>
      <view class="setting-arrow">›</view>
    </view>
  </view>
</view>
```

Use the real Unicode chevron `›`; do not create a CSS or SVG approximation.

- [ ] **Step 5: Build account and security with standalone final logout**

Replace “账号与数据” with the logged-in section:

```xml
<view wx:if="{{!accountLoggedOut}}" class="section-label profile-command-label">账号与安全</view>
<view wx:if="{{!accountLoggedOut}}" class="profile-command-section profile-account-section">
  <view class="profile-command-list">
    <view class="setting-row" bindtap="copyPlayerId">
      <view class="setting-main">
        <view>
          <view class="setting-title">复制账号 ID</view>
          <view class="small muted">用于定位和排查当前账号数据</view>
        </view>
      </view>
      <view class="setting-arrow">›</view>
    </view>
    <view class="setting-row danger" bindtap="clearData">
      <view class="setting-main">
        <view>
          <view class="setting-title">清除所有数据</view>
          <view class="small muted">清除资料、设置、牌局和手牌数据</view>
        </view>
      </view>
      <view class="setting-arrow">›</view>
    </view>
  </view>
  <view class="profile-logout-action" bindtap="logoutAccount">退出登录</view>
</view>
```

Place `profile-footer` immediately after this section. Keep the current logged-out login hero at the top, remove the duplicated logged-out login row from the old account card, and ensure the logged-out state does not create empty module headings.

- [ ] **Step 6: Remove the now-unreferenced about handler**

Delete only this method from `pages/profile/profile.js`:

```js
showAbout() {
  wx.showModal({
    title: '关于',
    content: '智牌屋\n版本 ' + this.data.version + '\n用于记录牌局、手牌、统计与复盘。',
    showCancel: false,
    confirmText: '知道了',
    confirmColor: '#e60012'
  })
},
```

Do not change `openReleaseNotes`, `maybeShowReleaseNotes`, or `acknowledgeReleaseNotes`.

- [ ] **Step 7: Run focused tests and verify structure GREEN**

Run:

```powershell
node --test tests/profile-command-list-redesign.test.js tests/profile-layout.test.js tests/profile-customer-feedback-entry.test.js tests/release-notes-poster.test.js
node --check pages/profile/profile.js
```

Expected: all focused tests PASS and JavaScript syntax check exits 0.

- [ ] **Step 8: Commit the information-architecture change**

```powershell
git add -- pages/profile/profile.wxml pages/profile/profile.js tests/profile-command-list-redesign.test.js tests/profile-layout.test.js tests/profile-customer-feedback-entry.test.js tests/release-notes-poster.test.js
git commit -m "feat: reorganize profile command sections"
```

Expected: one commit containing only the listed files.

---

### Task 3: Implement The Scoped P5 Command-List Visual System

**Files:**
- Modify: `pages/profile/profile.wxml`
- Modify: `pages/profile/profile.wxss`
- Test: `tests/profile-command-list-redesign.test.js`
- Test: `tests/ai-reminder-profile-ui.test.js`

**Interfaces:**
- Consumes: WXML classes `profile-command-page`, `profile-command-label`, `profile-command-section`, `profile-command-list`, `profile-account-section`, and `profile-logout-action` from Task 2.
- Produces: final P5 profile styling while leaving modal/editor selectors untouched.

- [ ] **Step 1: Add the CSS contract before implementation**

Add this test to `tests/profile-command-list-redesign.test.js`:

```js
test('command-list page exposes scoped P5 styling hooks', () => {
  assert.match(wxml, /class="container profile-command-page"/)
  assert.match(wxml, /profile-command-section/)
  assert.match(wxml, /profile-command-label/)
  assert.match(wxml, /profile-logout-action/)
  assert.match(wxss, /\.profile-command-page\s+\.profile-command-label/)
  assert.match(wxss, /\.profile-command-page\s+\.profile-command-list/)
  assert.match(wxss, /\.profile-command-page\s+\.profile-logout-action/)
  assert.match(wxss, /clip-path:\s*polygon/)
  assert.match(wxss, /min-height:\s*88rpx/)
  assert.match(wxss, /env\(safe-area-inset-bottom\)/)
})
```

- [ ] **Step 2: Run the style contract and verify RED**

Run:

```powershell
node --test --test-name-pattern="scoped P5 styling hooks" tests/profile-command-list-redesign.test.js
```

Expected: FAIL because scoped list, logout and safe-area rules are missing.

- [ ] **Step 3: Add the page-level P5 palette and background**

Append one final, clearly labelled scoped block to `pages/profile/profile.wxss`. Keep it after existing normal profile rules so it is authoritative, but before any future page-specific final override marker:

```css
/* Profile P5 command-list redesign. Keep selectors scoped to the page root. */
.profile-command-page {
  --profile-red: #ef1028;
  --profile-red-dark: #a90819;
  --profile-cyan: #11dff3;
  --profile-yellow: #ffd733;
  --profile-ink: #08090d;
  --profile-panel: #12151d;
  --profile-line: rgba(255, 255, 255, 0.10);
  padding-bottom: calc(190rpx + env(safe-area-inset-bottom));
}

.profile-command-page::before {
  content: '';
  position: fixed;
  inset: 0;
  z-index: -1;
  background:
    linear-gradient(158deg, rgba(239, 16, 40, 0.10), transparent 30%),
    linear-gradient(180deg, #101219 0%, #08090d 58%, #0b0d12 100%);
}
```

- [ ] **Step 4: Restyle the player hero and metrics without changing bindings**

Scope overrides under `.profile-command-page`:

```css
.profile-command-page .profile-hero {
  position: relative;
  overflow: hidden;
  padding: 30rpx 28rpx 34rpx;
  border: 0;
  border-radius: 0;
  background: linear-gradient(112deg, #ef1028 0%, #d80d23 72%, #990817 72%);
  clip-path: polygon(0 0, 100% 0, 96% 90%, 5% 100%);
  box-shadow: 14rpx 14rpx 0 rgba(0, 0, 0, 0.42);
}

.profile-command-page .profile-avatar {
  border: 4rpx solid #ffffff;
  box-shadow: 8rpx 8rpx 0 rgba(0, 0, 0, 0.50);
}

.profile-command-page .profile-title-progress-fill {
  background: var(--profile-yellow);
}

.profile-command-page .profile-hero-chip {
  border-radius: 0;
  border: 0;
  border-left: 6rpx solid var(--profile-red);
  background: var(--profile-panel);
  box-shadow: none;
}
```

Keep current responsive `@media (max-width: 360px)` safeguards and do not change hero data expressions.

- [ ] **Step 5: Implement slanted labels and shared list surfaces**

Add:

```css
.profile-command-page .profile-command-section {
  margin: 0 0 28rpx;
}

.profile-command-page .profile-command-label {
  display: table;
  width: auto;
  margin: 34rpx 0 20rpx 10rpx;
  padding: 8rpx 26rpx;
  color: #08090d;
  background: #ffffff;
  font-size: 24rpx;
  font-weight: 950;
  line-height: 1.2;
  letter-spacing: 1rpx;
  clip-path: polygon(0 0, 100% 0, 92% 100%, 6% 88%);
  box-shadow: 12rpx 10rpx 0 var(--profile-red);
}

.profile-command-page .profile-command-list {
  overflow: hidden;
  border-left: 4rpx solid rgba(255, 255, 255, 0.16);
  background: var(--profile-panel);
}

.profile-command-page .profile-command-list .setting-row {
  min-height: 88rpx;
  margin: 0;
  padding: 20rpx 22rpx;
  border-bottom: 1rpx solid var(--profile-line);
  border-radius: 0;
  background: transparent;
}

.profile-command-page .profile-command-list .setting-row:last-child {
  border-bottom: 0;
}

.profile-command-page .setting-arrow {
  color: rgba(255, 255, 255, 0.56);
  font-size: 34rpx;
}
```

The existing `.customer-feedback-button::after { border: none; }` reset must remain effective.

- [ ] **Step 6: Style preference controls and AI state with restrained accents**

Add scoped rules that keep current controls recognizable:

```css
.profile-command-page .segment-item.active {
  color: #ffffff;
  border-color: var(--profile-red);
  background: rgba(239, 16, 40, 0.22);
  box-shadow: inset 0 -4rpx 0 var(--profile-red);
}

.profile-command-page .pref-chip {
  border-color: rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.06);
}

.profile-command-page .ai-reminder-entry-switch.on {
  border-color: var(--profile-cyan);
  background: var(--profile-cyan);
}
```

Do not modify `.ai-reminder-mask`, `.ai-reminder-sheet-*`, `.settings-editor-*`, or `.wechat-profile-*` rules.

- [ ] **Step 7: Style dangerous operations and bottom safe area**

Add:

```css
.profile-command-page .profile-command-list .setting-row.danger {
  color: #ff6b79;
  background: rgba(239, 16, 40, 0.06);
}

.profile-command-page .profile-logout-action {
  min-height: 88rpx;
  margin-top: 22rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  background: rgba(239, 16, 40, 0.18);
  border: 1rpx solid rgba(239, 16, 40, 0.60);
  font-size: 27rpx;
  font-weight: 950;
  clip-path: polygon(3% 0, 100% 0, 97% 100%, 0 90%);
}

.profile-command-page .profile-logout-action:active {
  opacity: 0.76;
  transform: translateY(2rpx);
}
```

- [ ] **Step 8: Run style and adjacent-modal regressions**

Run:

```powershell
node --test tests/profile-command-list-redesign.test.js tests/profile-customer-feedback-entry.test.js tests/ai-reminder-profile-ui.test.js tests/profile-settings-editor.test.js
```

Expected: all tests PASS. Existing AI reminder footer, input width and customer button reset assertions must remain green.

- [ ] **Step 9: Commit the visual redesign**

```powershell
git add -- pages/profile/profile.wxml pages/profile/profile.wxss tests/profile-command-list-redesign.test.js
git commit -m "feat: redesign profile as P5 command list"
```

Expected: one commit containing only the listed files.

---

### Task 4: Verify Profile Behaviors And Full Regression

**Files:**
- Verify: `pages/profile/profile.wxml`
- Verify: `pages/profile/profile.wxss`
- Verify: `pages/profile/profile.js`
- Verify: `tests/*.test.js`

**Interfaces:**
- Consumes: final markup, styles and existing handlers from Tasks 2–3.
- Produces: automated evidence that the redesign does not regress profile or repository behavior.

- [ ] **Step 1: Run all profile-adjacent tests**

Run:

```powershell
node --test tests/profile-command-list-redesign.test.js tests/profile-layout.test.js tests/profile-customer-feedback-entry.test.js tests/profile-settings-editor.test.js tests/ai-reminder-profile-ui.test.js tests/ai-reminder-profile-channel-layout.test.js tests/ai-reminder-sheet-layout.test.js tests/ai-reminder-editor-channel-layout.test.js tests/release-notes-poster.test.js
```

Expected: all listed committed tests PASS with 0 failures.

- [ ] **Step 2: Run syntax and diff checks**

Run:

```powershell
node --check pages/profile/profile.js
git diff --check
git status --short
```

Expected: syntax exits 0; no whitespace errors; status contains only intentional task files or is clean after commits.

- [ ] **Step 3: Run the complete committed test suite**

Run in PowerShell:

```powershell
$tests = git ls-files 'tests/*.test.js'
node --test $tests
```

Expected: all committed tests PASS with 0 failures. If a pre-existing unrelated failure occurs, record the exact test and reproduce it against the plan’s starting commit before changing task code.

---

### Task 5: Real WeChat Preview And Manual Acceptance

**Files:**
- Verify: `tools/auto-preview.ps1`
- Verify: clean preview copy generated by the script.

**Interfaces:**
- Consumes: tested real workspace implementation.
- Produces: WeChat DevTools preview evidence and phone-visible acceptance checklist.

- [ ] **Step 1: Run real-workspace auto-preview**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File tools/auto-preview.ps1 -ProjectRoot 'D:\TRAE\xuan\poker-live-miniapp'
```

Expected: output includes `√ auto-preview`, an info-output JSON path, and a valid package size. Do not run `tools/upload-dev.ps1`.

- [ ] **Step 2: Verify the clean preview package contains the redesign**

Run:

```powershell
$preview = Join-Path $env:TEMP 'poker-live-miniapp-auto-preview\pages\profile\profile.wxml'
Select-String -LiteralPath $preview -Pattern 'profile-command-page','关于与版本更新','profile-logout-action'
```

Expected: all three patterns are present.

- [ ] **Step 3: Complete phone-visible acceptance**

On a logged-in phone preview, verify:

1. player hero, title progress and stats render without clipping;
2. the five setting modules follow the approved order;
3. preference chips remain editable;
4. data imports/exports, AI row/switch, native customer feedback, onboarding, release poster, copy ID and clear-data confirmation open correctly;
5. logout is the final actionable item;
6. the logged-out page has no empty modules and hides feedback;
7. bottom Tab does not cover the final action.

Expected: user confirms the visible result or reports an exact screenshot/state for correction.

---

## Plan Self-Review

- Spec coverage: every section in `docs/superpowers/specs/2026-07-19-profile-p5-command-list-redesign-design.md` maps to Tasks 1–5.
- Placeholder scan: no unresolved placeholder or undefined handler remains; every code-changing step includes exact code or preserved binding names.
- Type/name consistency: all handlers and data expressions are existing names from `pages/profile/profile.js`; new WXML/CSS hook names are defined in Task 2 and consumed unchanged in Task 3.
- Scope: one page redesign with focused tests and preview; no backend, route, release, upload, or unrelated refactor is included.
