# 智牌屋启动动画 HTML Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建一个可独立打开、可重复播放的 HTML Demo，演示已确认的智牌屋启动动画主视觉与退场效果。

**Architecture:** 使用单文件 `web-preview/launch-animation-demo.html` 承载 HTML 和 CSS，不引入框架或第三方动画库。复用项目内压缩主视觉，通过整幅人物上下悬浮、伪元素光效和状态类完成 2.8 秒启动序列。

**Tech Stack:** HTML5、CSS 动画、原生 JavaScript、Node.js 静态回归测试。

## Global Constraints

- 品牌名称必须为“智牌屋”。
- 主视觉必须使用 `assets/branding/launch-phantom-five-cards-v1.jpg`，手牌恰好五张。
- 动画目标时长 2.8 秒，硬上限 3000 ms。
- 不实现缓存逻辑，不修改微信小程序运行代码。
- 不引入视频、GIF 或第三方动画库。
- 必须支持 `prefers-reduced-motion`。

---

### Task 1: HTML Demo 与回归测试

**Files:**
- Create: `web-preview/launch-animation-demo.html`
- Create: `tests/launch-animation-html-demo.test.js`

**Interfaces:**
- Consumes: `assets/branding/launch-phantom-five-cards-v1.jpg`
- Produces: 指向 `launch-animation-demo.html` 的原生重载链接，用于无脚本重新播放完整启动序列。

- [ ] **Step 1: 写失败测试**

```js
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const html = fs.readFileSync(path.join(__dirname, '..', 'web-preview', 'launch-animation-demo.html'), 'utf8')
assert.match(html, /智牌屋/)
assert.match(html, /launch-phantom-five-cards-v1\.jpg/)
assert.match(html, /href="launch-animation-demo\.html"/)
assert.doesNotMatch(html, /onclick=/)
assert.match(html, /prefers-reduced-motion/)
assert.match(html, /--launch-duration:\s*2800ms/)
assert.match(html, /@keyframes heroFloat/)
assert.doesNotMatch(html, /cape-layer/)
```

- [ ] **Step 2: 运行 `node tests/launch-animation-html-demo.test.js`，确认因 Demo 文件不存在而失败。**
- [ ] **Step 3: 实现手机比例舞台、主视觉、整个人物上下悬浮、红光呼吸、智牌屋文字、斜切退场和重新播放链接。**
- [ ] **Step 4: 再次运行测试并确认通过。**
- [ ] **Step 5: 通过本地 HTTP 服务在浏览器检查首次播放、重新播放、响应式布局和图片加载。**
- [ ] **Step 6: 只提交计划、Demo 和测试文件。**
