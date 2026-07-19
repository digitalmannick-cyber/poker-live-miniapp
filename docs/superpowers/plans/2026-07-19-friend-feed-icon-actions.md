# 好友动态轻量互动区实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将统一动态卡片底部的点赞、评论大按钮改为小图标加数量，同时保留原有交互。

**Architecture:** 仅调整静态 Demo 的操作区 HTML、CSS 和点赞状态更新函数，不改变统一信息流、评论抽屉或发布范围模型。图标视觉尺寸约 16px，按钮保留至少 36px 点击热区。

**Tech Stack:** HTML、CSS、原生 JavaScript、Node.js `assert` 静态回归测试。

## Global Constraints

- 不拆分好友动态和广场动态。
- 不使用两列大按钮或有底色、边框的操作块。
- 点赞后数量增加、图标变红；评论仍打开评论抽屉。

---

### Task 1: 轻量点赞与评论图标

**Files:**

- Modify: `web-preview/friend-feed-demo.html`
- Modify: `tests/friend-feed-demo.test.js`
- Modify: `docs/superpowers/specs/2026-07-19-friend-system-requirements.md`

**Interfaces:**

- Consumes: `toggleLike(button)`、`openComments(title)`。
- Produces: `.action-icon`、`.action-count`、`.like-action`、`.comment-action`。

- [x] **Step 1: 写入失败测试**

要求每个操作使用图标、数字和无边框轻量样式，并禁止点赞函数覆盖整个按钮文本。

- [x] **Step 2: 确认测试失败**

Run: `node tests/friend-feed-demo.test.js`
Expected: FAIL，提示缺少轻量互动图标。

- [x] **Step 3: 实现最小改动**

将四张动态卡片的互动区改为小图标加数字；点赞函数只更新 `.action-count`。

- [x] **Step 4: 验证测试和浏览器交互**

Run: `node tests/friend-feed-demo.test.js`
Expected: PASS；浏览器中点赞数字从 8 变为 9，评论抽屉正常打开。
