# Native Customer Feedback Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a logged-in-only “反馈与建议” entry on the Profile page that opens the personal mini program's native WeChat customer-service conversation.

**Architecture:** The feature is declarative and remains entirely inside `pages/profile/profile.wxml` and `pages/profile/profile.wxss`. A native `<button open-type="contact">` reuses the existing Profile setting-row visual language; no page controller, route, cloud function, database, image upload, or third-party issue list is added.

**Tech Stack:** WeChat Mini Program WXML/WXSS, Node.js `node:test`, WeChat DevTools auto-preview.

## Global Constraints

- Show the feedback entry only when `!accountLoggedOut`.
- Use an actual `<button open-type="contact">`; a `<view>` tap handler is not acceptable.
- Copy must be exactly `反馈与建议` and `反馈问题、Bug 或功能建议`.
- Do not add a feedback page route, JavaScript handler, cloud function, database collection, image-upload code, Feishu integration, or GitHub integration.
- Do not bump the app version or upload a development version for this change.
- Preserve all unrelated working-tree changes.
- Run auto-preview against `D:\TRAE\xuan\poker-live-miniapp`; full send/receive verification additionally requires a customer-service account bound in WeChat Public Platform.

---

## File Structure

- Create `tests/profile-customer-feedback-entry.test.js`: source-level regression contract for visibility, native contact behavior, copy, styling, and absence of a new route.
- Modify `pages/profile/profile.wxml`: logged-in-only “帮助与反馈” section containing the native contact button.
- Modify `pages/profile/profile.wxss`: remove native button chrome while preserving the existing setting-row layout.

### Task 1: Logged-in native customer feedback entry

**Files:**
- Create: `tests/profile-customer-feedback-entry.test.js`
- Modify: `pages/profile/profile.wxml`
- Modify: `pages/profile/profile.wxss`

**Interfaces:**
- Consumes: existing Profile state `accountLoggedOut: boolean` and existing classes `section-label`, `card`, `profile-card-compact`, `setting-row`, `setting-main`, `setting-title`, `small muted`, and `setting-arrow`.
- Produces: a logged-in-only native WeChat customer-service launch control with `open-type="contact"`.

- [ ] **Step 1: Write the failing regression test**

Create `tests/profile-customer-feedback-entry.test.js` with:

```js
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const wxml = fs.readFileSync(path.join(root, 'pages/profile/profile.wxml'), 'utf8')
const wxss = fs.readFileSync(path.join(root, 'pages/profile/profile.wxss'), 'utf8')
const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))

function helpAndFeedbackMarkup() {
  const marker = '<view wx:if="{{!accountLoggedOut}}" class="section-label">帮助与反馈</view>'
  const start = wxml.indexOf(marker)
  if (start < 0) return ''
  const nextSection = wxml.indexOf('<view class="section-label">', start + marker.length)
  return wxml.slice(start, nextSection < 0 ? wxml.length : nextSection)
}

test('logged-in profile users can open native customer feedback chat', () => {
  const markup = helpAndFeedbackMarkup()

  assert.ok(markup, '帮助与反馈 should have its own logged-in-only section')
  assert.match(markup, /<view wx:if="\{\{!accountLoggedOut\}\}" class="card profile-card-compact">/)
  assert.match(markup, /<button class="setting-row customer-feedback-button" open-type="contact"/)
  assert.match(markup, />反馈与建议<\/view>/)
  assert.match(markup, />反馈问题、Bug 或功能建议<\/view>/)
})

test('native customer feedback button removes WeChat default button chrome', () => {
  assert.match(wxss, /\.customer-feedback-button\s*\{[\s\S]*?width:\s*100%;[\s\S]*?margin:\s*0;[\s\S]*?padding:\s*18rpx 4rpx;[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;/)
  assert.match(wxss, /\.customer-feedback-button::after\s*\{[\s\S]*?border:\s*none;/)
})

test('native customer feedback does not add a standalone page route', () => {
  assert.equal(appConfig.pages.some(page => /feedback/i.test(page)), false)
})
```

- [ ] **Step 2: Run the focused test and confirm the red state**

Run:

```powershell
node tests/profile-customer-feedback-entry.test.js
```

Expected: the first two tests fail because the Profile feedback markup and `.customer-feedback-button` styles do not exist; the route test passes.

- [ ] **Step 3: Add the minimal native contact markup**

In `pages/profile/profile.wxml`, insert the following block after the closing card for “AI 自动提醒” and before the “账号与数据” section:

```xml
  <view wx:if="{{!accountLoggedOut}}" class="section-label">帮助与反馈</view>
  <view wx:if="{{!accountLoggedOut}}" class="card profile-card-compact">
    <button class="setting-row customer-feedback-button" open-type="contact" hover-class="none" aria-label="反馈与建议">
      <view class="setting-main">
        <view>
          <view class="setting-title">反馈与建议</view>
          <view class="small muted">反馈问题、Bug 或功能建议</view>
        </view>
      </view>
      <view class="setting-arrow">></view>
    </button>
  </view>
```

- [ ] **Step 4: Normalize native button styling**

In `pages/profile/profile.wxss`, immediately after the base `.setting-row` rule, add:

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
}

.customer-feedback-button::after {
  border: none;
}
```

- [ ] **Step 5: Run focused and neighboring Profile tests**

Run:

```powershell
node tests/profile-customer-feedback-entry.test.js
node tests/profile-layout.test.js
node tests/ai-reminder-profile-ui.test.js
node tests/ai-reminder-profile-channel-layout.test.js
```

Expected: every command exits `0` and all assertions pass.

- [ ] **Step 6: Run static scope checks**

Run:

```powershell
git diff --check -- pages/profile/profile.wxml pages/profile/profile.wxss tests/profile-customer-feedback-entry.test.js
rg -n "feedbacks|uploadFile|chooseMedia|openCustomerServiceChat" pages/profile tests/profile-customer-feedback-entry.test.js
git status --short -- pages/profile/profile.wxml pages/profile/profile.wxss pages/profile/profile.js tests/profile-customer-feedback-entry.test.js
```

Expected:

- `git diff --check` prints nothing.
- The restricted-code search prints nothing.
- Status lists only `profile.wxml`, `profile.wxss`, and the new focused test; `profile.js` remains absent.
- `app.json`, cloud functions, services, and all pre-existing unrelated working-tree changes remain untouched by this feature.

- [ ] **Step 7: Run real-workspace WeChat auto-preview**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File tools/auto-preview.ps1
```

Expected: WeChat DevTools reports a successful preview for `D:\TRAE\xuan\poker-live-miniapp`. Do not run `tools/upload-dev.ps1`.

Manual acceptance after a customer-service person is bound in WeChat Public Platform:

1. Scan the preview with a logged-in account.
2. Open “我的” and tap “反馈与建议”.
3. Confirm the native customer-service conversation opens.
4. Send one text message and one screenshot.
5. Confirm the bound customer-service account receives both and can reply.
6. Log out of the mini program account and confirm the entry is hidden.

- [ ] **Step 8: Commit only the feature files**

```powershell
git add -- pages/profile/profile.wxml pages/profile/profile.wxss tests/profile-customer-feedback-entry.test.js
git commit -m "feat: add native customer feedback entry"
```

Expected: the commit contains exactly the three listed files; all unrelated working-tree changes remain unstaged.
