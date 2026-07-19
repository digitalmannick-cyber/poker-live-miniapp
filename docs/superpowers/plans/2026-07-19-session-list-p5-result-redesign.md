# Session 历史列表 P5 输赢主视觉重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将“全部 Session”历史列表实现为已确认的 P5 斜切卡片设计，并让每场输赢成为卡片第一视觉重点。

**Architecture:** 保留 `buildSessionListItem()` 和全部现有事件处理，只重构 `pages/session-list/session-list.wxml` 的历史列表标记与对应 WXSS。新增一个静态视觉契约测试锁定页头、字段、无编号、正负色调和交互绑定；现有 Session 交互测试负责确认行为不回退。

**Tech Stack:** 微信小程序 WXML/WXSS、Node.js `assert` 静态契约测试、微信开发者工具 `auto-preview`

## Global Constraints

- 只修改“全部 Session”历史列表，不修改进行中 Session、计时、速记、结算、数据模型、云函数或版本号。
- 每张卡片必须显示场地/级别、日期、买入、手牌数、AI 总结、状态和输赢。
- 不显示 Session 编号，也不保留编号占位装饰。
- 正收益使用 `#00d1ff`，负收益使用 `#ff3b3b`；输赢金额保持单行。
- 保留点击详情、左滑编辑/删除、AI 总结、新建 Session 和新手引导 class。
- 不增加筛选、排序、搜索、图表、人物或扑克牌素材。
- 不上传开发版，仅生成真实主工作区 `auto-preview`。

---

### Task 1: 锁定历史列表视觉与交互契约

**Files:**
- Create: `tests/session-list-p5-history-redesign.test.js`
- Read: `pages/session-list/session-list.wxml`
- Read: `pages/session-list/session-list.wxss`

**Interfaces:**
- Consumes: 历史列表现有数据字段 `item.title`、`item.date`、`item.buyIn`、`item.handCount`、`item.totalProfitDisplay`、`item.totalProfitTone`、`item.summaryEligible`、`item.status`
- Produces: 静态测试，约束 `session-history-*` 标记、事件绑定和关键视觉规则

- [ ] **Step 1: 新增失败的视觉契约测试**

```js
const assert = require('node:assert/strict')
const fs = require('node:fs')

const wxml = fs.readFileSync('pages/session-list/session-list.wxml', 'utf8')
const wxss = fs.readFileSync('pages/session-list/session-list.wxss', 'utf8')

assert.match(wxml, /class="card session-history-head-card"/)
assert.match(wxml, /class="session-history-title"[\s\S]*全部[\s\S]*Session/)
assert.match(wxml, /class="primary-btn small-btn new-session-btn session-history-create[^"]*"[\s\S]*\+ 新建/)
assert.match(wxml, /class="session-history-card \{\{item\.totalProfitTone\}\}"/)
assert.match(wxml, /class="session-history-result \{\{item\.totalProfitTone\}\}"/)
assert.match(wxml, /class="session-history-result-label">本场输赢/)
assert.match(wxml, /class="session-history-result-value">\{\{item\.totalProfitDisplay\}\}/)
assert.match(wxml, /买入 \{\{item\.buyIn\}\}/)
assert.match(wxml, /手牌 \{\{item\.handCount\}\}/)
assert.match(wxml, /catchtap="openSessionSummary"/)
assert.match(wxml, /bindtap="goSessionDetail"/)
assert.match(wxml, /bindtouchstart="onSessionItemTouchStart"/)
assert.doesNotMatch(wxml, /session-history-(?:index|number|sequence)/)

assert.match(wxss, /\.session-history-title\s*\{[\s\S]*clip-path:\s*polygon/)
assert.match(wxss, /\.session-history-create\s*\{[\s\S]*clip-path:\s*polygon/)
assert.match(wxss, /\.session-history-card-layout\s*\{[\s\S]*grid-template-columns:/)
assert.match(wxss, /\.session-history-result\s*\{[\s\S]*clip-path:\s*polygon/)
assert.match(wxss, /\.session-history-result-value\s*\{[\s\S]*white-space:\s*nowrap/)
assert.match(wxss, /\.session-history-result\.positive[\s\S]*#00d1ff/)
assert.match(wxss, /\.session-history-result\.negative[\s\S]*#ff3b3b/)
assert.match(wxss, /\.session-history-card-layout::before\s*\{[\s\S]*pointer-events:\s*none/)

console.log('session list P5 history redesign ok')
```

- [ ] **Step 2: 运行测试并确认它因新结构尚不存在而失败**

Run: `node tests/session-list-p5-history-redesign.test.js`

Expected: FAIL，首个错误指向缺少 `session-history-head-card`。

- [ ] **Step 3: 提交测试基线**

```powershell
git add -- tests/session-list-p5-history-redesign.test.js
git commit -m "test: specify P5 session history layout"
```

---

### Task 2: 实现 P5 页头与斜切输赢卡片

**Files:**
- Modify: `pages/session-list/session-list.wxml:132-181`
- Modify: `pages/session-list/session-list.wxss:1460-1630`
- Test: `tests/session-list-p5-history-redesign.test.js`

**Interfaces:**
- Consumes: `sessions` 列表和 Task 1 的静态契约；继续调用 `goNewSession`、`goSessionDetail`、`openSessionSummary`、`onSessionItemTouchStart/Move/End`、`editSessionFromList`、`deleteSessionFromList`
- Produces: `session-history-head-card`、`session-history-title`、`session-history-create`、`session-history-list-card`、`session-history-card`、`session-history-card-layout`、`session-history-result` 与 `session-history-footer` UI 结构

- [ ] **Step 1: 用批准后的语义结构替换历史列表标记**

```xml
<view wx:elif="{{sessions.length}}" class="card session-history-head-card">
  <view class="session-history-head">
    <view class="session-history-title"><text>全部</text><text>Session</text></view>
    <button class="primary-btn small-btn new-session-btn session-history-create onboarding-target-session" bindtap="goNewSession">+ 新建</button>
  </view>
</view>

<view wx:if="{{(!activeSessionView || !showActiveSessionHome) && sessions.length}}" class="card session-history-list-card">
  <view wx:for="{{sessions}}" wx:key="_id" class="session-swipe-row {{item.swiped ? 'open' : ''}}">
    <view class="session-swipe-actions {{item.onboardingSessionSwipeTargetClass}}">
      <view class="session-swipe-action edit" catchtap="editSessionFromList" data-id="{{item._id}}">编辑</view>
      <view class="session-swipe-action delete {{item.onboardingSessionDeleteTargetClass}}" catchtap="deleteSessionFromList" data-id="{{item._id}}">删除</view>
    </view>
    <view
      class="session-swipe-content session-history-card {{item.totalProfitTone}}"
      bindtap="goSessionDetail"
      bindtouchstart="onSessionItemTouchStart"
      bindtouchmove="onSessionItemTouchMove"
      bindtouchend="onSessionItemTouchEnd"
      data-id="{{item._id}}"
    >
      <view class="session-history-card-layout">
        <view class="session-history-info">
          <view class="session-history-name">{{item.title}}</view>
          <view class="session-history-date">{{item.date}}</view>
        </view>
        <view class="session-history-result {{item.totalProfitTone}}">
          <view class="session-history-result-label">本场输赢</view>
          <view class="session-history-result-value">{{item.totalProfitDisplay}}</view>
        </view>
        <view class="session-history-footer">
          <view class="session-history-metrics">
            <text>买入 {{item.buyIn}}</text><text class="session-history-divider"></text><text>手牌 {{item.handCount}}</text>
          </view>
          <view
            wx:if="{{item.summaryEligible}}"
            class="session-summary-trigger session-history-summary onboarding-target-session-summary"
            catchtap="openSessionSummary"
            data-id="{{item._id}}"
            aria-label="查看 AI Session 总结"
          >AI总结</view>
          <view class="badge-outline session-status-badge session-history-status {{item.status === 'active' ? 'active' : 'finished'}}">
            {{item.status === 'active' ? '进行中' : '已结束'}}
          </view>
        </view>
      </view>
    </view>
  </view>
</view>
```

- [ ] **Step 2: 添加页头、卡片网格和正负结果区的最小样式**

```css
.session-history-head-card { padding: 22rpx 24rpx; }
.session-history-head { position: relative; z-index: 1; display: grid; grid-template-columns: minmax(0, 1fr) 220rpx; align-items: center; gap: 22rpx; }
.session-history-title { display: flex; gap: 12rpx; padding: 18rpx 46rpx 18rpx 26rpx; color: #090a0d; background: #f4f4f1; clip-path: polygon(0 7%, 100% 0, 89% 100%, 2% 94%); font-size: 34rpx; font-weight: 1000; transform: rotate(-1deg); }
.session-history-create { width: 100%; margin: 0; border-radius: 0; clip-path: polygon(10% 0, 100% 5%, 88% 100%, 0 94%); }
.session-history-list-card { padding: 0; overflow: visible; background: transparent; border: 0; }
.session-history-list-card::before, .session-history-list-card::after { display: none; }
.session-history-card { min-height: 180rpx; padding: 0; border-radius: 8rpx; overflow: hidden; border: 2rpx solid rgba(255,255,255,0.18); background: linear-gradient(145deg, #15171d, #090a0e); }
.session-history-card.positive { border-color: rgba(0,209,255,0.64); }
.session-history-card.negative { border-color: rgba(255,59,59,0.64); }
.session-history-card-layout { position: relative; min-height: 180rpx; display: grid; grid-template-columns: minmax(0, 1fr) minmax(250rpx, 42%); grid-template-rows: minmax(112rpx, auto) 68rpx; }
.session-history-card-layout::before { content: ''; position: absolute; inset: 0; z-index: 0; pointer-events: none; background: repeating-linear-gradient(135deg, rgba(255,255,255,0.025) 0 1rpx, transparent 1rpx 18rpx); }
.session-history-info { position: relative; z-index: 2; padding: 24rpx 18rpx 10rpx 28rpx; min-width: 0; }
.session-history-name { overflow: hidden; color: #fff; font-size: 32rpx; line-height: 1.1; font-weight: 1000; white-space: nowrap; text-overflow: ellipsis; }
.session-history-date { margin-top: 12rpx; color: rgba(255,255,255,0.62); font-size: 23rpx; }
.session-history-result { position: relative; z-index: 1; grid-row: 1 / 3; grid-column: 2; padding: 24rpx 24rpx 72rpx 58rpx; display: flex; flex-direction: column; align-items: flex-end; justify-content: center; clip-path: polygon(20% 0, 100% 0, 100% 100%, 0 100%, 12% 58%); }
.session-history-result.positive { color: #00d1ff; background: linear-gradient(135deg, rgba(0,25,33,0.45), rgba(0,209,255,0.22)); }
.session-history-result.negative { color: #ff3b3b; background: linear-gradient(135deg, rgba(36,0,6,0.42), rgba(230,0,18,0.28)); }
.session-history-result-label { font-size: 20rpx; font-weight: 900; }
.session-history-result-value { margin-top: 8rpx; max-width: 100%; overflow: hidden; font-size: 38rpx; line-height: 1; font-weight: 1000; letter-spacing: -1rpx; white-space: nowrap; }
.session-history-footer { position: relative; z-index: 3; grid-column: 1 / 3; grid-row: 2; display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 10rpx; padding: 8rpx 24rpx 14rpx 28rpx; background: linear-gradient(90deg, rgba(9,10,14,0.98) 0 58%, rgba(9,10,14,0.78) 74%, transparent 100%); }
.session-history-metrics { min-width: 0; display: flex; align-items: center; gap: 10rpx; color: rgba(255,255,255,0.68); font-size: 21rpx; white-space: nowrap; }
.session-history-divider { width: 1rpx; height: 24rpx; background: rgba(255,255,255,0.22); }
.session-history-summary, .session-history-status { flex-shrink: 0; }
```

- [ ] **Step 3: 运行专项测试并按真实 WXSS 输出修正断言**

Run: `node tests/session-list-p5-history-redesign.test.js`

Expected: PASS，输出 `session list P5 history redesign ok`。

- [ ] **Step 4: 运行现有 Session 相邻回归**

Run: `node tests/session-list-active-entry.test.js; node tests/session-timeline-style.test.js; node tests/session-list-quick-time-editor.test.js`

Expected: 三个命令均退出 0；现有详情跳转、左滑、AI 总结与时间轴测试不回退。

- [ ] **Step 5: 提交页面实现**

```powershell
git add -- pages/session-list/session-list.wxml pages/session-list/session-list.wxss tests/session-list-p5-history-redesign.test.js
git commit -m "style: redesign P5 session history cards"
```

---

### Task 3: 完整验证与微信预览

**Files:**
- Verify: `pages/session-list/session-list.wxml`
- Verify: `pages/session-list/session-list.wxss`
- Verify: `tests/session-list-p5-history-redesign.test.js`
- Read: `C:/Users/11075/.codex/memories/skills/wechat-miniapp-auto-preview/SKILL.md` when available

**Interfaces:**
- Consumes: Task 2 的已提交页面与测试
- Produces: 完整测试结果、真实主工作区预览包和视觉对照结论

- [ ] **Step 1: 运行完整测试套件**

```powershell
Get-ChildItem tests -Filter *.test.js | Sort-Object Name | ForEach-Object {
  node $_.FullName
  if ($LASTEXITCODE -ne 0) { throw "failed: $($_.Name)" }
}
```

Expected: 所有当前测试文件均退出 0。

- [ ] **Step 2: 运行语法与差异检查**

Run: `node --check pages/session-list/session-list.js; git diff --check`

Expected: 两个检查均退出 0，且 diff 只包含计划内的 Session 列表文件和专项测试。

- [ ] **Step 3: 在真实主工作区生成微信预览**

按 `wechat-miniapp-auto-preview` 工作流对 `D:\TRAE\xuan\poker-live-miniapp` 执行 `auto-preview`；不得执行 `upload`。

Expected: 开发者工具返回 `√ auto preview` 或等价成功标记，并输出预览目录、info JSON 与包体积。

- [ ] **Step 4: 对照最终确认稿完成视觉检查**

检查以下状态：页头斜切比例、无 Session 编号、右侧输赢单行、正负色调、AI/状态标签基线、底部导航无遮挡、左滑操作层未被装饰层阻断。

Expected: 所有检查通过；若模拟器无法进入登录数据态，明确把真机数据列表对照列为唯一剩余项，不以猜测代替验证。
