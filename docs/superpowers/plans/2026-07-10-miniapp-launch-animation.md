# 智牌屋微信小程序启动动画 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已确认的 2.95 秒启动动画接入微信小程序冷启动首屏，并保证同一进程只播放一次且不阻塞场次数据初始化。

**Architecture:** `utils/launch-animation.js` 提供一次性进程门闩和固定时长；`pages/session-list` 在首屏最外层渲染固定遮罩，并继续执行原有 `onShow/refreshSessions`。CSS 复用 HTML Demo 的整幅人物缓慢上下浮动、红光呼吸和斜切退场。

**Tech Stack:** 微信小程序 WXML/WXSS/JavaScript、Node.js 回归测试。

## Global Constraints

- 品牌名为“智牌屋”。
- 运行素材为 `assets/branding/launch-phantom-five-cards-v1.jpg`。
- 动画总时长 2950ms，绝不等待云数据。
- 同一小程序进程只播放一次。
- 不修改现有 `onShow()` 数据加载顺序；只后台预热默认 `all` 统计缓存，不预加载手牌列表。
- 不使用视频、GIF 或第三方动画库。

---

### Task 1: 启动门闩与页面接入

**Files:**
- Create: `utils/launch-animation.js`
- Create: `tests/session-list-launch-animation.test.js`
- Modify: `pages/session-list/session-list.js`
- Modify: `pages/session-list/session-list.wxml`
- Modify: `pages/session-list/session-list.wxss`

**Interfaces:**
- `consumeLaunchAnimation(): boolean`：当前进程首次调用返回 `true`，其后返回 `false`。
- `getLaunchAnimationDuration(): number`：返回 `2950`。
- `__test.reset(): void`：只供 Node 测试复位门闩。

- [ ] **Step 1:** 先写门闩行为与页面静态接线测试。
- [ ] **Step 2:** 运行 `node tests/session-list-launch-animation.test.js`，确认因模块和页面结构不存在而失败。
- [ ] **Step 3:** 实现门闩、WXML 启动层、页面定时移除和 WXSS 动画。
- [ ] **Step 4:** 运行启动动画测试及相关场次页测试。
- [ ] **Step 5:** 在真实工作区运行微信开发者工具自动预览，不上传开发版。

### Task 2: 启动期间统计缓存预热

**Files:**
- Create: `utils/launch-prefetch.js`
- Create: `tests/launch-stats-prefetch.test.js`
- Modify: `pages/session-list/session-list.js`

**Interfaces:**
- `scheduleStatsPrefetch(dataService, options?): timerId | null`：首次冷启动 600ms 后后台预热 `all` 统计；已有缓存、未登录或接口缺失时不调度。

- [ ] **Step 1:** 先写延迟调度、缓存去重、未登录跳过和异常静默测试。
- [ ] **Step 2:** 运行 `node tests/launch-stats-prefetch.test.js`，确认因模块不存在而失败。
- [ ] **Step 3:** 实现后台预热并接入冷启动 `onLoad()`，不等待返回值。
- [ ] **Step 4:** 运行统计缓存、启动动画和场次页回归测试。
