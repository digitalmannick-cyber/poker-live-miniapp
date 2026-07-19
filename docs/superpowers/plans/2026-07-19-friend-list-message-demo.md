# 好友列表与消息中心 Demo 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐好友列表和独立消息中心的联动交互原型。

**Architecture:** 单个静态 HTML 用两台 390×844 手机画布展示两个正式页面。左侧好友列表复用玩家库卡片结构，右侧消息中心用时间流承载好友申请、互动、定向手牌和玩家名片。

**Tech Stack:** HTML、CSS、原生 JavaScript、Node.js `assert` 测试。

## Global Constraints

- 玩家库原页面样式和语义不变。
- 好友列表保留玩家类型、Leak、Note 和对战信息，并新增累计时长、手牌数。
- 消息中心是独立页面，不使用抽屉。
- 第一版不接微信订阅消息。

---

### Task 1: 好友列表与消息中心联动

**Files:**

- Create: `web-preview/friend-list-message-demo.html`
- Create: `tests/friend-list-message-demo.test.js`

**Interfaces:**

- Produces: `openMessageCenter()`、`acceptRequest()`、`rejectRequest()`、`markAllRead()`、`openCardPreview()`。

- [x] **Step 1: 写失败测试并确认 RED**
- [x] **Step 2: 实现两屏视觉结构**
- [x] **Step 3: 实现好友申请、全部已读和名片预览交互**
- [x] **Step 4: 运行测试并通过浏览器检查 390×844 画布**
