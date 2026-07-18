# 好友系统 HTML Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建一个可独立打开的手机端交互 Demo，完整演示已确认的好友系统信息架构、关键流程和隐私反馈，不修改微信小程序正式业务代码。

**Architecture:** 使用单文件 `web-preview/friend-system-demo.html` 承载静态示例数据、Persona 风格界面、页面状态和原生 JavaScript 交互。所有关键页面通过 `data-screen` 容器切换，弹层通过 `data-sheet` 管理；Demo 只模拟产品流程，不调用云函数、不写本地业务数据。

**Tech Stack:** HTML5、CSS3、原生 JavaScript、Node.js 静态回归测试、浏览器人工验证。

## Global Constraints

- 底部导航继续显示“场次 / 手牌 / 玩家 / 统计 / 我的”，好友系统入口位于“玩家”。
- 玩家页一级切换为“好友 / 玩家库”，好友区包含“好友手牌 / 好友列表 / 排行榜”。
- 消息中心位于玩家页右上角，底部玩家 tab 只显示未读红点。
- 分享手牌统一 BB 化；Hero 显示为 `Hero`，其他玩家使用夜鸦、赤狐、黑猫、银狼、幻蝶、灰隼、绯蛇、白鲸等原创代号。
- 好友主页和排行榜不得出现盈亏、胜率、小时盈利、资金曲线、真实地点或真实盲注金额。
- 玩家名片一次只能分享给一位指定好友，字段仅包含头像、名称、玩家类型、Leak 标签和 Note。
- Demo 必须保持独立，不修改 `app.json`、正式页面、云函数、服务层或现有私有数据模型。
- 必须支持窄屏手机与桌面浏览器，并支持 `prefers-reduced-motion`。

---

### Task 1: 可交互好友系统 Demo 与静态回归测试

**Files:**
- Create: `web-preview/friend-system-demo.html`
- Create: `tests/friend-system-html-demo.test.js`

**Interfaces:**
- Consumes: `docs/superpowers/specs/2026-07-19-friend-system-requirements.md` 中确认的文案、隐私边界和流程。
- Produces: 独立 HTML 文件；通过 `[data-screen]`、`[data-action]`、`[data-tab]` 和 `[data-sheet]` 暴露可测试的交互锚点。

- [ ] **Step 1: 写完整 Demo 契约测试**

```js
const assert = require('assert')
const fs = require('fs')
const path = require('path')

const html = fs.readFileSync(
  path.join(__dirname, '..', 'web-preview', 'friend-system-demo.html'),
  'utf8'
)

assert.match(html, /好友手牌/)
assert.match(html, /好友列表/)
assert.match(html, /排行榜/)
assert.match(html, /本周/)
assert.match(html, /本月/)
assert.match(html, /累计/)
assert.match(html, /隐私与分享/)
assert.match(html, /全部好友可见/)
assert.match(html, /指定好友/)
assert.match(html, /Hero/)
assert.match(html, /夜鸦/)
assert.match(html, /赤狐/)
assert.match(html, /分享玩家名片/)
assert.match(html, /保存到我的玩家库/)
assert.match(html, /覆盖已有玩家/)
assert.match(html, /新建玩家/)
assert.match(html, /7 天内有效/)
assert.match(html, /data-screen="friends-home"/)
assert.match(html, /data-screen="friend-hands"/)
assert.match(html, /data-screen="friend-list"/)
assert.match(html, /data-screen="leaderboard"/)
assert.match(html, /data-screen="messages"/)
assert.match(html, /data-screen="friend-profile"/)
assert.match(html, /data-screen="shared-hand"/)
assert.match(html, /data-screen="player-library"/)
assert.match(html, /data-screen="player-card-preview"/)
assert.match(html, /data-action="publish-hand"/)
assert.match(html, /data-action="send-comment"/)
assert.match(html, /data-action="toggle-like"/)
assert.match(html, /data-action="withdraw-hand"/)
assert.match(html, /data-action="import-player-card"/)
assert.match(html, /data-action="remove-friend"/)
assert.match(html, /prefers-reduced-motion/)
assert.doesNotMatch(html, /小时盈利|资金曲线|累计盈亏/)
```

- [ ] **Step 2: 运行契约测试确认失败**

Run: `node tests/friend-system-html-demo.test.js`

Expected: FAIL，错误为无法读取 `web-preview/friend-system-demo.html`。

- [ ] **Step 3: 实现 Demo 基础框架和导航**

在单一 HTML 文件中实现：

- 桌面说明栏、手机设备框和状态栏。
- Persona 风格黑红白视觉，但不使用 Persona 5 官方角色名或素材。
- 底部五项导航，玩家项激活并带未读红点。
- 玩家页“好友 / 玩家库”切换。
- 好友首页三个入口和右上角消息按钮。
- `showScreen(id)`、`openSheet(id)`、`closeSheet()`、`toast(message)` 四个基础交互函数。

- [ ] **Step 4: 实现好友与排行榜流程**

实现以下可点击页面和状态：

- 好友手牌列表：全部好友和指定好友标签、评论数、点赞数。
- 好友列表：好友统计数据、隐藏统计状态、邀请卡片和个人二维码入口。
- 好友主页：头像、昵称、称号、累计时长、手牌数、最近分享和解除好友。
- 排行榜：本周、本月、累计切换，只按时长排序并固定显示自己。
- 解除好友确认层：确认后显示权限已撤销状态，但不真实修改数据。

- [ ] **Step 5: 实现手牌分享与互动流程**

实现以下交互：

- 从好友手牌列表进入分享手牌详情。
- 手牌详情显示 Hero、夜鸦、赤狐等匿名代号、公共牌、行动线和 BB 底池。
- 点赞切换并即时更新数量。
- 文字评论输入、Emoji 快捷输入、内置扑克贴纸选择。
- 评论最多一层回复的视觉示例。
- 发布手牌预览层：默认全部好友，可切换指定好友，固定显示“BB 化 + 匿名化”。
- 撤回分享确认层：确认后显示“该分享已撤回”的失效状态。

- [ ] **Step 6: 实现消息和玩家名片流程**

实现以下交互：

- 消息中心列表：好友申请、评论、回复、聚合点赞、指定手牌和玩家名片。
- 好友申请接受/拒绝的 Demo 状态。
- 玩家库列表和玩家详情。
- “分享玩家名片”预览，明确五类字段和单一指定好友。
- 接收方名片预览显示“7 天内有效”。
- 导入时出现同名提示，并提供“覆盖已有玩家 / 新建玩家”。
- 覆盖说明明确保留本地对战手牌关联。

- [ ] **Step 7: 完成响应式和可访问性处理**

实现：

- 视口宽度小于 760px 时隐藏桌面说明栏，设备框占满可用宽度。
- 底部安全区、可滚动内容区和固定操作栏互不遮挡。
- 所有交互按钮使用 `button` 或声明可识别的 `data-action`，具备可见焦点。
- `prefers-reduced-motion: reduce` 时关闭非必要过渡和动画。

- [ ] **Step 8: 运行自动化验证**

Run: `node tests/friend-system-html-demo.test.js`

Expected: PASS，无输出且退出码为 0。

Run: `git diff --check -- web-preview/friend-system-demo.html tests/friend-system-html-demo.test.js`

Expected: 无空白错误。

- [ ] **Step 9: 浏览器人工验证**

通过本地 HTTP 服务打开 `web-preview/friend-system-demo.html`，依次验证：

1. 好友首页可进入好友手牌、好友列表、排行榜和消息中心。
2. 排行榜三个周期可切换且无盈亏信息。
3. 手牌详情可点赞、评论、选择贴纸和撤回。
4. 发布预览固定显示 BB 化、匿名化，默认全部好友并可切换指定好友。
5. 好友主页解除好友后展示访问撤销反馈。
6. 玩家名片只能选择一位好友，接收预览可进入覆盖或新建流程。
7. 手机窄屏和桌面宽屏均无横向溢出，固定栏不遮挡内容。

- [ ] **Step 10: 提交 Demo**

```powershell
git add -- web-preview/friend-system-demo.html tests/friend-system-html-demo.test.js docs/superpowers/plans/2026-07-19-friend-system-html-demo.md
git commit -m "feat: add friend system interactive demo"
```
