# Profile Control Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一“我的”页面筹码单位、编辑入口和列表箭头的视觉尺寸，同时保留不低于 88rpx 的可靠点击热区。

**Architecture:** 在 WXML 中把直接点击事件从可见按钮移到独立 hit wrapper，使点击尺寸与视觉尺寸解耦。WXSS 只在 `.profile-command-page` 下定义 wrapper 与紧凑视觉尺寸；列表箭头统一复用现有 `.setting-arrow` 和 Unicode `›`。

**Tech Stack:** 微信小程序 WXML/WXSS、Node.js `node:test` 源码契约测试、微信开发者工具 CLI `auto-preview`。

## Global Constraints

- 筹码单位视觉高度固定为 60rpx，点击包装层最小高度为 88rpx。
- 三个编辑按钮视觉高度固定为 56rpx，点击包装层最小尺寸为 88×88rpx。
- 所有非加载列表箭头统一使用 Unicode `›`；导入加载态使用 `…`。
- 不改变现有处理器名称、数据绑定、弹层、路由、版本、后端或客服行为。
- 不修改或提交主工作区中与本任务无关的现有改动。
- 不运行 `tools/upload-dev.ps1`，不上传微信开发版。

---

### Task 1: Separate Visual Controls From Hit Targets And Normalize Arrows

**Files:**
- Modify: `tests/profile-command-list-redesign.test.js`
- Modify: `pages/profile/profile.wxml`
- Modify: `pages/profile/profile.wxss`

**Interfaces:**
- Consumes: handlers `selectChipUnit`, `editVenues`, `editBlindPresets`, `editOpponentTypes`, `importPbtPlayerData`, `importPbtBankrollData`, and `exportBackup`.
- Produces: WXML hooks `segment-hit` and `profile-action-hit`; scoped WXSS blocks with 88rpx hit targets and compact visual controls.

- [ ] **Step 1: Add failing source-contract tests**

Append these tests to `tests/profile-command-list-redesign.test.js`:

```js
test('preference controls separate compact visuals from 88rpx hit targets', () => {
  const segmentHits = wxml.match(
    /<view class="segment-hit" data-value="(?:BB|CNY|HKD|USD)" bindtap="selectChipUnit">\s*<view class="segment-item \{\{settings\.chipUnit === '[A-Z]+' \? 'active' : ''\}\}">(?:BB|¥|HK\$|\$)<\/view>\s*<\/view>/g
  ) || []
  const actionHits = wxml.match(
    /<view class="profile-action-hit" bindtap="(?:editVenues|editBlindPresets|editOpponentTypes)">\s*<view class="profile-action compact">编辑<\/view>\s*<\/view>/g
  ) || []

  assert.equal(segmentHits.length, 4)
  assert.equal(actionHits.length, 3)

  const segmentHit = cssBlock('.profile-command-page .segment-hit')
  const segmentVisual = cssBlock('.profile-command-page .segment-item')
  const actionHit = cssBlock('.profile-command-page .profile-action-hit')
  const actionVisual = cssBlock('.profile-command-page .profile-action.compact')

  assert.match(segmentHit, /min-height:\s*88rpx/)
  assert.match(segmentVisual, /height:\s*60rpx/)
  assert.match(segmentVisual, /min-height:\s*60rpx/)
  assert.doesNotMatch(segmentVisual, /min-height:\s*88rpx/)
  assert.match(actionHit, /min-width:\s*88rpx/)
  assert.match(actionHit, /min-height:\s*88rpx/)
  assert.match(actionVisual, /height:\s*56rpx/)
  assert.match(actionVisual, /min-height:\s*56rpx/)
  assert.doesNotMatch(actionVisual, /min-height:\s*88rpx/)
})

test('all command-list arrows use one chevron and a stable loading glyph', () => {
  assert.match(wxml, /<view class="setting-arrow">\{\{importingPbtPlayerData \? '…' : '›'\}\}<\/view>/)
  assert.equal((wxml.match(/<view class="setting-arrow">›<\/view>/g) || []).length, 7)
  assert.doesNotMatch(wxml, /<view class="setting-arrow">><\/view>/)
  assert.doesNotMatch(wxml, /importingPbtPlayerData \? '\.\.\.' : '>'/)

  const arrow = cssBlock('.setting-arrow')
  assert.match(arrow, /width:\s*44rpx/)
  assert.match(arrow, /height:\s*44rpx/)
  assert.match(arrow, /display:\s*inline-flex/)
  assert.match(arrow, /align-items:\s*center/)
  assert.match(arrow, /justify-content:\s*center/)
})
```

- [ ] **Step 2: Run the new contracts and verify RED**

Run:

```powershell
node --test --test-name-pattern="preference controls|all command-list arrows" tests/profile-command-list-redesign.test.js
```

Expected: both tests FAIL because `segment-hit` / `profile-action-hit` do not exist, the visible controls still inherit 88rpx, and data-management arrows still use `>` / `...`.

- [ ] **Step 3: Wrap the four chip-unit controls**

Replace the current `.segment-row` children in `pages/profile/profile.wxml` with:

```xml
<view class="segment-row">
  <view class="segment-hit" data-value="BB" bindtap="selectChipUnit">
    <view class="segment-item {{settings.chipUnit === 'BB' ? 'active' : ''}}">BB</view>
  </view>
  <view class="segment-hit" data-value="CNY" bindtap="selectChipUnit">
    <view class="segment-item {{settings.chipUnit === 'CNY' ? 'active' : ''}}">¥</view>
  </view>
  <view class="segment-hit" data-value="HKD" bindtap="selectChipUnit">
    <view class="segment-item {{settings.chipUnit === 'HKD' ? 'active' : ''}}">HK$</view>
  </view>
  <view class="segment-hit" data-value="USD" bindtap="selectChipUnit">
    <view class="segment-item {{settings.chipUnit === 'USD' ? 'active' : ''}}">$</view>
  </view>
</view>
```

The wrapper owns `data-value` and `bindtap`; the visible child owns only the selected-state class and label.

- [ ] **Step 4: Wrap the three edit controls**

Replace each direct edit button with the corresponding wrapper. The three final forms are:

```xml
<view class="profile-action-hit" bindtap="editVenues">
  <view class="profile-action compact">编辑</view>
</view>

<view class="profile-action-hit" bindtap="editBlindPresets">
  <view class="profile-action compact">编辑</view>
</view>

<view class="profile-action-hit" bindtap="editOpponentTypes">
  <view class="profile-action compact">编辑</view>
</view>
```

- [ ] **Step 5: Normalize data-management arrow content**

Use exactly these three arrow nodes:

```xml
<view class="setting-arrow">{{importingPbtPlayerData ? '…' : '›'}}</view>
<view class="setting-arrow">›</view>
<view class="setting-arrow">›</view>
```

Do not change the existing `.setting-arrow` nodes in Help & Feedback or Account & Security.

- [ ] **Step 6: Replace the oversized scoped rules**

Replace the existing scoped `.segment-item` and `.profile-action.compact` rules in `pages/profile/profile.wxss` with:

```css
.profile-command-page .segment-hit {
  flex: 1;
  min-width: 0;
  min-height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}

.profile-command-page .segment-item {
  width: 100%;
  height: 60rpx;
  min-height: 60rpx;
}

.profile-command-page .profile-action-hit {
  flex-shrink: 0;
  min-width: 88rpx;
  min-height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.profile-command-page .profile-action.compact {
  height: 56rpx;
  min-height: 56rpx;
  padding: 0 18rpx;
  box-sizing: border-box;
}
```

This preserves reliable interaction size without making the visible controls 88rpx tall.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run:

```powershell
node --test --test-name-pattern="preference controls|all command-list arrows" tests/profile-command-list-redesign.test.js
node --test tests/profile-command-list-redesign.test.js tests/profile-layout.test.js tests/profile-customer-feedback-entry.test.js tests/profile-settings-editor.test.js tests/ai-reminder-profile-ui.test.js tests/release-notes-poster.test.js
node --check pages/profile/profile.js
git diff --check
```

Expected: all selected tests PASS; syntax and diff checks exit 0.

- [ ] **Step 8: Commit only the consistency fix**

Run:

```powershell
git add -- pages/profile/profile.wxml pages/profile/profile.wxss tests/profile-command-list-redesign.test.js
git commit -m "fix: unify profile control sizing"
```

Expected: the commit contains only the three listed files and preserves all unrelated dirty-worktree changes.

---

### Task 2: Full Regression And Real WeChat Preview

**Files:**
- Verify: `pages/profile/profile.wxml`
- Verify: `pages/profile/profile.wxss`
- Verify: `tests/*.test.js`
- Verify: `tools/auto-preview.ps1`

**Interfaces:**
- Consumes: committed compact visual controls and normalized arrow markup from Task 1.
- Produces: automated regression evidence and a phone-visible WeChat preview package.

- [ ] **Step 1: Run all Profile-adjacent tests**

Run:

```powershell
node --test tests/profile-command-list-redesign.test.js tests/profile-layout.test.js tests/profile-customer-feedback-entry.test.js tests/profile-settings-editor.test.js tests/ai-reminder-profile-ui.test.js tests/ai-reminder-profile-channel-layout.test.js tests/ai-reminder-sheet-layout.test.js tests/ai-reminder-editor-channel-layout.test.js tests/release-notes-poster.test.js
```

Expected: all Profile-adjacent tests PASS with 0 failures.

- [ ] **Step 2: Run the complete committed suite**

Run:

```powershell
$tests = git ls-files 'tests/*.test.js'
node --test $tests
```

Expected: all committed tests PASS. If only the known ledger equity timing threshold fails under concurrency, run that file three times and then run the complete suite with `--test-concurrency=1`; record exact evidence instead of modifying unrelated files.

- [ ] **Step 3: Generate a real-workspace preview**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File tools/auto-preview.ps1 -ProjectRoot 'D:\TRAE\xuan\poker-live-miniapp'
```

Expected: output includes `√ auto-preview`, an info-output JSON path and a valid package size. Do not run `tools/upload-dev.ps1`.

- [ ] **Step 4: Verify preview-package contracts**

Run:

```powershell
$previewWxml = Join-Path $env:TEMP 'poker-live-miniapp-auto-preview\pages\profile\profile.wxml'
$previewWxss = Join-Path $env:TEMP 'poker-live-miniapp-auto-preview\pages\profile\profile.wxss'
Select-String -LiteralPath $previewWxml -Pattern 'class="segment-hit"','class="profile-action-hit"','setting-arrow">›','importingPbtPlayerData ? ''…'' : ''›'''
Select-String -LiteralPath $previewWxss -Pattern '.profile-command-page .segment-hit','.profile-command-page .profile-action-hit','height: 60rpx','height: 56rpx'
```

Expected: every pattern is present in the clean runtime package.

- [ ] **Step 5: Phone-visible acceptance**

Confirm from the same logged-in Profile state as the reference screenshot:

1. four chip-unit visual buttons are equal and visibly smaller than before;
2. all three edit buttons have identical compact visual size;
3. preset chips remain compact and readable;
4. data, help and account arrows have identical glyph, circle and alignment;
5. chip-unit and edit controls remain easy to tap;
6. no list row, modal, bottom tab or account action regresses.

Expected: user confirms the latest preview or returns an exact screenshot for one more measured adjustment.
