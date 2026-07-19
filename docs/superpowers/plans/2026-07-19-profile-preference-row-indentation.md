# Profile Preference Row Indentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为偏好设置的四个区块增加与命令列表一致的灰色圆点，并让标题、说明和控件共享统一左侧缩进。

**Architecture:** 给偏好设置列表增加独立作用域类 `profile-preference-list`，只在该作用域内调整 `.setting-block` 的左侧内边距，并通过 `::before` 绘制圆点。保留现有 WXML 层级、事件、循环数据、控件尺寸和完整宽度分隔线。

**Tech Stack:** 微信小程序 WXML/WXSS、Node.js `node:test` 源码契约、微信开发者工具 `auto-preview`。

## Global Constraints

- 四个偏好区块都必须显示 `10rpx × 10rpx` 灰色圆点。
- 圆点左侧位置固定为 `22rpx`，内容左侧内边距固定为 `54rpx`。
- 圆点颜色固定为 `rgba(255,255,255,0.22)`，光晕固定为 `0 0 0 8rpx rgba(255,255,255,0.03)`。
- 右侧内边距保持现状，不移动编辑按钮或缩小其 `88rpx` 点击热区。
- 不改变筹码单位按钮、预设标签、事件、数据绑定、版本、路由或其他 Profile 模块。
- 不运行 `tools/upload-dev.ps1`，不上传微信开发版本。

---

### Task 1: Add Scoped Preference Dots And Content Inset

**Files:**
- Modify: `pages/profile/profile.wxml:138`
- Modify: `pages/profile/profile.wxss:3216`
- Modify: `tests/profile-command-list-redesign.test.js`

**Interfaces:**
- Consumes: existing classes `profile-command-list`, `setting-block`, `setting-head`, `segment-row`, `chip-list`, and `profile-action-hit`.
- Produces: scoped class `profile-preference-list` and its `setting-block` / `setting-block::before` layout contracts.

- [ ] **Step 1: Add the failing preference layout contract**

Append this test to `tests/profile-command-list-redesign.test.js`:

```js
test('preference blocks use command-row dots and a shared content inset', () => {
  const preferences = commandModuleMarkup('偏好设置')
  const block = cssBlock('.profile-command-page .profile-preference-list .setting-block')
  const dot = cssBlock('.profile-command-page .profile-preference-list .setting-block::before')

  assert.match(preferences, /class="profile-command-list profile-preference-list"/)
  assert.equal((preferences.match(/class="setting-block"/g) || []).length, 4)
  assert.match(block, /padding:\s*20rpx 0 20rpx 54rpx/)
  assert.match(dot, /content:\s*''/)
  assert.match(dot, /position:\s*absolute/)
  assert.match(dot, /left:\s*22rpx/)
  assert.match(dot, /top:\s*36rpx/)
  assert.match(dot, /width:\s*10rpx/)
  assert.match(dot, /height:\s*10rpx/)
  assert.match(dot, /border-radius:\s*50%/)
  assert.match(dot, /background:\s*rgba\(255,\s*255,\s*255,\s*0\.22\)/)
  assert.match(dot, /box-shadow:\s*0 0 0 8rpx rgba\(255,\s*255,\s*255,\s*0\.03\)/)
  assert.match(cssBlock('.setting-block'), /border-bottom:\s*1rpx solid rgba\(255,255,255,0\.08\)/)
  assert.match(cssBlock('.profile-command-page .profile-action-hit'), /min-height:\s*88rpx/)
})
```

- [ ] **Step 2: Run the new contract and verify RED**

Run:

```powershell
node --test --test-name-pattern="preference blocks use command-row dots" tests/profile-command-list-redesign.test.js
```

Expected: FAIL because `profile-preference-list` and its scoped WXSS rules do not exist.

- [ ] **Step 3: Add the preference-only WXML scope**

Change the list immediately below the `偏好设置` section label in `pages/profile/profile.wxml` from:

```xml
<view class="profile-command-list">
```

to:

```xml
<view class="profile-command-list profile-preference-list">
```

Do not change any of the four `setting-block` children or their event bindings.

- [ ] **Step 4: Add the scoped inset and dot styles**

Add these rules near the other `.profile-command-page` command-list overrides in `pages/profile/profile.wxss`:

```css
.profile-command-page .profile-preference-list .setting-block {
  padding: 20rpx 0 20rpx 54rpx;
}

.profile-command-page .profile-preference-list .setting-block::before {
  content: '';
  position: absolute;
  left: 22rpx;
  top: 36rpx;
  width: 10rpx;
  height: 10rpx;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.22);
  box-shadow: 0 0 0 8rpx rgba(255, 255, 255, 0.03);
}
```

Do not add right padding; keeping the right edge unchanged preserves the current edit-button position.

- [ ] **Step 5: Verify GREEN and adjacent behavior**

Run:

```powershell
node --test --test-name-pattern="preference blocks use command-row dots" tests/profile-command-list-redesign.test.js
node --test tests/profile-command-list-redesign.test.js tests/profile-layout.test.js tests/profile-customer-feedback-entry.test.js tests/profile-settings-editor.test.js tests/ai-reminder-profile-ui.test.js tests/release-notes-poster.test.js
git diff --check -- pages/profile/profile.wxml pages/profile/profile.wxss tests/profile-command-list-redesign.test.js
```

Expected: the focused contract passes; all Profile-adjacent tests pass; diff check exits 0.

- [ ] **Step 6: Commit the scoped implementation**

Run:

```powershell
git add -- pages/profile/profile.wxml pages/profile/profile.wxss tests/profile-command-list-redesign.test.js
git commit -m "style: align profile preference rows"
```

Expected: one commit containing only the three listed files.

---

### Task 2: Full Regression And WeChat Preview

**Files:**
- Verify: `pages/profile/profile.wxml`
- Verify: `pages/profile/profile.wxss`
- Verify: `tests/*.test.js`

**Interfaces:**
- Consumes: Task 1's scoped preference-list class and dot styles.
- Produces: full test evidence and a clean WeChat runtime preview package.

- [ ] **Step 1: Run the complete committed test suite**

Run:

```powershell
$tests = git ls-files 'tests/*.test.js'
node --test --test-concurrency=1 $tests
```

Expected: all committed tests pass with 0 failures.

- [ ] **Step 2: Generate a unique clean preview from the real workspace**

Run:

```powershell
$projectRoot = git rev-parse --show-toplevel
$previewRoot = Join-Path $env:TEMP 'codex-profile-preference-dots\poker-live-miniapp-auto-preview'
powershell -ExecutionPolicy Bypass -File tools/auto-preview.ps1 -ProjectRoot $projectRoot -PreviewRoot $previewRoot
```

Expected: output contains `√ auto-preview`, an info-output JSON path, and a valid total package size. Do not run `tools/upload-dev.ps1`.

- [ ] **Step 3: Verify the clean package matches the source**

Run:

```powershell
$previewRoot = Join-Path $env:TEMP 'codex-profile-preference-dots\poker-live-miniapp-auto-preview'
@('pages\profile\profile.wxml','pages\profile\profile.wxss') | ForEach-Object {
  $source = (Get-FileHash $_ -Algorithm SHA256).Hash
  $packaged = (Get-FileHash (Join-Path $previewRoot $_) -Algorithm SHA256).Hash
  if ($source -ne $packaged) { throw "Preview hash mismatch: $_" }
}
```

Expected: exit 0 with matching hashes for both Profile files.

- [ ] **Step 4: Inspect the rendered Profile state when available**

Check the logged-in Profile page at the supplied phone width:

1. all four preference blocks show one gray dot;
2. titles, description, unit buttons and chips start after the dot;
3. edit buttons retain their right-side placement;
4. separators remain full width;
5. lower modules are unchanged.

If WeChat DevTools cannot render the logged-in Profile state, report visual verification as blocked while preserving the automated and clean-package results.
