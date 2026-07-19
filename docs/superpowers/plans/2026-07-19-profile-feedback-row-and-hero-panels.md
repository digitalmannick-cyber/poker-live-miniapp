# Profile Feedback Row And Hero Panels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复原生客服按钮的换行和箭头错位，并把 Hero 两个黑色统计面板替换为两级半透明酒红背景。

**Architecture:** 保留现有 WXML 和行为，只通过测试锁定微信原生 button 的显式 flex 布局与箭头稳定规则。Hero 颜色通过 `.profile-command-page` 下的共享 fallback 和两个语义子类覆盖实现，不影响其他页面或普通 Profile 规则。

**Tech Stack:** 微信小程序 WXSS、Node.js `node:test` 源码契约、微信开发者工具 `auto-preview`、同状态截图对照。

## Global Constraints

- 客服入口继续使用 `<button open-type="contact">`，不得改成普通 view 或新增路由。
- 客服按钮必须显式使用 flex 横向布局，箭头固定在最右侧且不压缩。
- 不使用 `white-space: nowrap` 强制描述单行；正常宽度靠正确 flex 分配保持单行，窄屏允许自然换行。
- 手数面板渐变固定为 `rgba(112, 20, 38, 0.88)` 到 `rgba(72, 8, 24, 0.84)`。
- 战绩面板渐变固定为 `rgba(82, 14, 42, 0.88)` 到 `rgba(52, 7, 28, 0.84)`。
- Hero 统计面板不得使用 `var(--profile-panel)` 或黑色背景。
- 不修改 WXML 数据绑定、版本、路由、后端、客服配置或其他 Profile 模块。
- 不运行 `tools/upload-dev.ps1`，不上传微信开发版。

---

### Task 1: Fix Feedback Flex Layout And Hero Panel Colors

**Files:**
- Modify: `tests/profile-customer-feedback-entry.test.js`
- Modify: `tests/profile-command-list-redesign.test.js`
- Modify: `pages/profile/profile.wxss`

**Interfaces:**
- Consumes: WXML classes `customer-feedback-button`, `setting-main`, `setting-arrow`, `profile-hero-chip-hands`, and `profile-hero-chip-profit`.
- Produces: explicit feedback-row flex contract and scoped wine-red Hero surface contracts.

- [ ] **Step 1: Add a CSS block helper to the feedback test**

Add this helper after `helpAndFeedbackMarkup()` in `tests/profile-customer-feedback-entry.test.js`:

```js
function cssBlock(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = wxss.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))
  assert.ok(match, `${selector} should exist`)
  return match[1]
}
```

- [ ] **Step 2: Replace the button-chrome test with a layout contract**

Replace `native customer feedback button removes WeChat default button chrome` with:

```js
test('native customer feedback matches the command-row flex layout', () => {
  const button = cssBlock('.customer-feedback-button')
  const arrow = cssBlock('.profile-command-page .customer-feedback-button .setting-arrow')

  assert.match(button, /width:\s*100%/)
  assert.match(button, /display:\s*flex/)
  assert.match(button, /align-items:\s*center/)
  assert.match(button, /justify-content:\s*space-between/)
  assert.match(button, /gap:\s*20rpx/)
  assert.match(button, /border:\s*0/)
  assert.match(button, /background:\s*transparent/)
  assert.doesNotMatch(button, /white-space:\s*nowrap/)
  assert.match(arrow, /margin-left:\s*auto/)
  assert.match(cssBlock('.setting-arrow'), /flex-shrink:\s*0/)
  assert.match(wxss, /\.customer-feedback-button::after\s*\{[\s\S]*?border:\s*none/)
})
```

- [ ] **Step 3: Add the Hero surface contract**

Append this test to `tests/profile-command-list-redesign.test.js`:

```js
test('hero stats use layered wine surfaces instead of black command panels', () => {
  const shared = cssBlock('.profile-command-page .profile-hero-chip')
  const hands = cssBlock('.profile-command-page .profile-hero-chip-hands')
  const profit = cssBlock('.profile-command-page .profile-hero-chip-profit')

  assert.doesNotMatch(shared, /var\(--profile-panel\)/)
  assert.match(shared, /border-left:\s*6rpx solid rgba\(255, 255, 255, 0\.22\)/)
  assert.match(hands, /linear-gradient\(135deg, rgba\(112, 20, 38, 0\.88\), rgba\(72, 8, 24, 0\.84\)\)/)
  assert.match(profit, /linear-gradient\(135deg, rgba\(82, 14, 42, 0\.88\), rgba\(52, 7, 28, 0\.84\)\)/)
  assert.doesNotMatch(hands, /#(?:000|000000)|rgba\(0,\s*0,\s*0/)
  assert.doesNotMatch(profit, /#(?:000|000000)|rgba\(0,\s*0,\s*0/)
})
```

- [ ] **Step 4: Run the new contracts and verify RED**

Run:

```powershell
node --test --test-name-pattern="customer feedback matches|hero stats use layered" tests/profile-customer-feedback-entry.test.js tests/profile-command-list-redesign.test.js
```

Expected: both tests FAIL because the button has no explicit flex declarations and the scoped Hero chip still uses `var(--profile-panel)`.

- [ ] **Step 5: Make the native feedback button an explicit flex row**

Update `.customer-feedback-button` in `pages/profile/profile.wxss` to include these declarations while preserving its existing reset declarations:

```css
.customer-feedback-button {
  width: 100%;
  margin: 0;
  padding: 18rpx 4rpx;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  line-height: normal;
  text-align: left;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
}
```

Add `flex-shrink: 0` to the existing `.setting-arrow` block.

Add this scoped rule near the other P5 command-list rules:

```css
.profile-command-page .customer-feedback-button .setting-arrow {
  margin-left: auto;
}
```

Do not add `white-space: nowrap` to the button or description.

- [ ] **Step 6: Replace the black Hero override with wine surfaces**

Replace the existing `.profile-command-page .profile-hero-chip` rule with:

```css
.profile-command-page .profile-hero-chip {
  border-radius: 0;
  border: 0;
  border-left: 6rpx solid rgba(255, 255, 255, 0.22);
  background: rgba(92, 12, 32, 0.86);
  box-shadow: none;
}

.profile-command-page .profile-hero-chip-hands {
  background: linear-gradient(135deg, rgba(112, 20, 38, 0.88), rgba(72, 8, 24, 0.84));
}

.profile-command-page .profile-hero-chip-profit {
  background: linear-gradient(135deg, rgba(82, 14, 42, 0.88), rgba(52, 7, 28, 0.84));
}
```

Keep the existing kicker/value/sub colors unchanged.

- [ ] **Step 7: Run focused and adjacent tests**

Run:

```powershell
node --test --test-name-pattern="customer feedback matches|hero stats use layered" tests/profile-customer-feedback-entry.test.js tests/profile-command-list-redesign.test.js
node --test tests/profile-command-list-redesign.test.js tests/profile-layout.test.js tests/profile-customer-feedback-entry.test.js tests/profile-settings-editor.test.js tests/ai-reminder-profile-ui.test.js tests/release-notes-poster.test.js
node --check pages/profile/profile.js
git diff --check
```

Expected: all tests PASS; syntax and diff checks exit 0.

- [ ] **Step 8: Commit only the scoped fix**

Run:

```powershell
git add -- pages/profile/profile.wxss tests/profile-customer-feedback-entry.test.js tests/profile-command-list-redesign.test.js
git commit -m "fix: align profile feedback and hero panels"
```

Expected: one commit containing only the three listed files.

---

### Task 2: Full Regression, Preview And Visual QA

**Files:**
- Verify: `pages/profile/profile.wxml`
- Verify: `pages/profile/profile.wxss`
- Verify: `tests/*.test.js`
- Create: `design-qa.md`

**Interfaces:**
- Consumes: Task 1's explicit feedback flex layout and wine-red Hero panels.
- Produces: complete regression evidence, a clean WeChat runtime package and screenshot-based QA result.

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
node --test --test-concurrency=1 $tests
```

Expected: all committed tests PASS.

- [ ] **Step 3: Generate a real-workspace WeChat preview**

Run:

```powershell
$projectRoot = git rev-parse --show-toplevel
powershell -ExecutionPolicy Bypass -File tools/auto-preview.ps1 -ProjectRoot $projectRoot
```

Expected: output includes `√ auto-preview`, an info-output JSON path and a valid package size. Do not run `tools/upload-dev.ps1`.

When implementation runs in an isolated worktree, preview that tested checkout here. After local integration, repeat the same command from `D:\TRAE\xuan\poker-live-miniapp` before final handoff.

- [ ] **Step 4: Check the clean runtime package**

Verify the generated `pages/profile/profile.wxss` contains:

```text
display: flex
margin-left: auto
linear-gradient(135deg, rgba(112, 20, 38, 0.88), rgba(72, 8, 24, 0.84))
linear-gradient(135deg, rgba(82, 14, 42, 0.88), rgba(52, 7, 28, 0.84))
```

Expected: every pattern is present and the scoped Hero rule does not contain `var(--profile-panel)`.

- [ ] **Step 5: Capture and compare the same logged-in Profile state**

Capture the latest WeChat DevTools simulator or phone screen and compare it with:

- `C:\Users\11075\AppData\Local\Temp\codex-clipboard-ff833ace-2aa4-48cf-badf-5e4057f21721.png`
- `C:\Users\11075\AppData\Local\Temp\codex-clipboard-babedf24-ddb9-4c81-8205-dafa2d975bef.png`

Check:

1. feedback title and description share the left content column;
2. feedback description remains one line at the reference width;
3. feedback arrow is at the same far-right position as the following rows;
4. both Hero statistic surfaces are visibly wine red, not black;
5. yellow and green numbers retain adequate contrast.

- [ ] **Step 6: Save the visual QA report**

Create project-root `design-qa.md` following Product Design `design-qa` requirements. It must contain source paths, implementation evidence, viewport/state, full and focused comparison, findings, comparison history and exactly one final result:

```text
final result: passed
```

Use `blocked` instead if the same logged-in state cannot be captured or any P0/P1/P2 visual mismatch remains.
