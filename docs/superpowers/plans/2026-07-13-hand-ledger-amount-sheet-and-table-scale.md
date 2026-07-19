# 手牌完整录入金额面板与桌面空间优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 复用统一数字金额面板完成有效筹码与 Raise/Bet 录入，同时扩大完整录入桌面、座位和手牌并强化当前行动提示。

**Architecture:** 新建独立 `numeric-amount-sheet` 小程序组件，组件只维护未提交草稿并通过事件返回结果，扑克业务继续留在 `pages/hand-ledger-input`。桌面几何继续由 `utils/hand-table-layout.js` 提供稳定 6/8/9max 坐标，尺寸和动画由页面 CSS token 控制。

**Tech Stack:** 微信小程序 Component/WXML/WXSS、CommonJS JavaScript、Node `assert` 回归测试、微信开发者工具 CLI。

## Global Constraints

- 每次打开玩家有效筹码面板默认 `0`，可直接输入新金额；已有值仍保留在座位数据中。
- 有效筹码快捷项固定为 `100bb`、`200bb`、`300bb`，按手牌记录时级别换算。
- 不改变行动顺序、底池计算、保存结构或扑克语义。
- 6/8/9max 必须继续使用稳定坐标且桌面区域不得出现滚动条。
- 不新增前端牌谱 parser、normalizer 或本地语义兜底。

---

### Task 1: 可复用数字金额面板

**Files:**
- Create: `components/numeric-amount-sheet/index.js`
- Create: `components/numeric-amount-sheet/index.json`
- Create: `components/numeric-amount-sheet/index.wxml`
- Create: `components/numeric-amount-sheet/index.wxss`
- Create: `tests/numeric-amount-sheet.test.js`

**Interfaces:**
- Consumes properties: `visible:Boolean`, `title:String`, `value:Number|String`, `unit:String`, `presets:Array<{label,value}>`, `max:Number`, `accent:String`, `secondaryLabel:String`.
- Produces events: `confirm({value:Number})`, `close()`, `secondary({value:Number})`.
- Produces methods: `appendDigit`, `applyPreset`, `clearDraft`, `backspaceDraft`, `onSliderChange`, `confirm`, `secondary`.

- [ ] **Step 1: 写组件状态与交互失败测试**

在 `tests/numeric-amount-sheet.test.js` 建立微信组件测试桩，断言：`0` 后输入 `2` 得到 `2`；快捷项替换草稿；退格和清空正确；属性 value 更新时重置草稿；确认只发送正整数；次要命令带当前草稿。

```js
assert.strictEqual(component.data.draft, '0')
component.appendDigit(event({ digit: '2' }))
assert.strictEqual(component.data.draft, '2')
component.applyPreset(event({ value: 80000 }))
assert.strictEqual(component.data.draft, '80000')
component.confirm()
assert.deepStrictEqual(events.confirm, { value: 80000 })
```

- [ ] **Step 2: 运行测试并确认正确失败**

Run: `node tests/numeric-amount-sheet.test.js`
Expected: FAIL，原因是组件文件不存在或所需方法未定义。

- [ ] **Step 3: 实现最小组件逻辑**

组件内部使用字符串草稿，属性 observer 在打开或 value 改变时同步；所有输出统一转换为有限正整数。

```js
Component({
  properties: {
    visible: Boolean,
    title: String,
    value: { type: null, observer(value) { this.setData({ draft: normalize(value) }) } },
    presets: { type: Array, value: [] },
    max: { type: Number, value: 100000 },
    unit: String,
    accent: { type: String, value: '#ffd429' },
    secondaryLabel: String
  },
  data: { draft: '0' },
  methods: {
    appendDigit(e) {},
    applyPreset(e) {},
    clearDraft() {},
    backspaceDraft() {},
    onSliderChange(e) {},
    confirm() {},
    secondary() {}
  }
})
```

- [ ] **Step 4: 实现组件 WXML/WXSS**

渲染底部遮罩、标题、快捷项、数字显示与单位、3 列数字键盘、滑杆、可选次要命令和保存按钮；不使用 `<input>`，避免原生键盘。

- [ ] **Step 5: 运行组件测试**

Run: `node tests/numeric-amount-sheet.test.js`
Expected: PASS。

### Task 2: 有效筹码接入复用组件

**Files:**
- Modify: `pages/hand-ledger-input/hand-ledger-input.json`
- Modify: `pages/hand-ledger-input/hand-ledger-input.js`
- Modify: `pages/hand-ledger-input/hand-ledger-input.wxml`
- Modify: `pages/hand-ledger-input/hand-ledger-input.wxss`
- Modify: `tests/hand-ledger-input-flow.test.js`

**Interfaces:**
- Consumes component `numeric-amount-sheet` and its `confirm`, `close`, `secondary` events.
- Produces page fields `stackPresets`, `stackMax` and handlers `confirmStackAmount`, `syncStackAmount`.

- [ ] **Step 1: 写有效筹码默认值与快捷值失败测试**

扩展 `tests/hand-ledger-input-flow.test.js`：在 `300/600` 级别打开座位，金额草稿为 `0`，快捷项为 `60000/120000/180000`；把该座位保存为 `90000` 后再次打开草稿仍为 `0`。

```js
page.setData({ levelText: '300/600' })
page.pickSeatMenu(event({ action: 'stack' }))
assert.strictEqual(page.data.stackEffectiveInput, '60000')
assert.deepStrictEqual(page.data.stackPresets.map(item => item.value), [60000, 120000, 180000])
```

- [ ] **Step 2: 运行专项测试并确认失败**

Run: `node tests/hand-ledger-input-flow.test.js`
Expected: FAIL，缺少 `stackPresets` 或仍使用旧原生输入面板。

- [ ] **Step 3: 注册并渲染组件**

在页面 JSON 注册：

```json
{
  "usingComponents": {
    "numeric-amount-sheet": "/components/numeric-amount-sheet/index"
  }
}
```

WXML 用组件替换 `.stack-sheet`：

```xml
<numeric-amount-sheet
  visible="{{stackSheetVisible}}"
  title="设置 {{seatMenuLabel}} 有效筹码"
  value="{{stackEffectiveInput}}"
  unit="{{chipUnit}}"
  presets="{{stackPresets}}"
  max="{{stackMax}}"
  secondary-label="其他玩家设置同样筹码"
  bind:close="closeStackSheet"
  bind:confirm="confirmStackAmount"
  bind:secondary="syncStackAmount"
/>
```

- [ ] **Step 4: 实现父页面筹码规则**

打开面板时使用 `player.stackCustomized ? existing : bigBlind * 100`，生成 100/200/300bb 快捷项；单人确认写入当前玩家并标记 `stackCustomized:true`；批量同步只更新非 Hero 玩家。

- [ ] **Step 5: 运行专项测试**

Run: `node tests/hand-ledger-input-flow.test.js`
Expected: PASS。

### Task 3: Raise/Bet 迁移到复用组件

**Files:**
- Modify: `pages/hand-ledger-input/hand-ledger-input.js`
- Modify: `pages/hand-ledger-input/hand-ledger-input.wxml`
- Modify: `pages/hand-ledger-input/hand-ledger-input.wxss`
- Modify: `tests/hand-ledger-input-flow.test.js`

**Interfaces:**
- Consumes existing `amountPresets`, `maxStack`, `amountInput`, `submitAmount` semantics.
- Produces handlers `confirmActionAmount(e)` and `closeAmountSheet()`.

- [ ] **Step 1: 写唯一金额键盘与动作提交失败测试**

断言页面 WXML 只包含两次组件调用，不再包含 `.amount-keypad`；触发组件确认 `2000` 后仍调用 `commitAction('R', 2000)`。

```js
assert.strictEqual((wxml.match(/<numeric-amount-sheet/g) || []).length, 2)
assert(!wxml.includes('class="amount-keypad"'))
page.confirmActionAmount({ detail: { value: 2000 } })
assert.deepStrictEqual(committed, { action: 'R', amount: 2000 })
```

- [ ] **Step 2: 运行专项测试并确认失败**

Run: `node tests/hand-ledger-input-flow.test.js`
Expected: FAIL，页面仍有内联数字键盘或缺少组件确认处理器。

- [ ] **Step 3: 替换 Raise/Bet 内联面板**

使用同一组件传入现有翻牌前 BB 倍数或翻牌后底池比例快捷项；组件确认后执行原有 pushHistory 与 commitAction，关闭不修改动作状态。

- [ ] **Step 4: 删除页面级重复数字键盘方法和样式**

删除只服务旧内联面板的 `appendAmountDigit`、`handleAmountKeyTool`、`onAmountSlider` 以及 `.amount-keypad/.amount-key/.preset-row` 页面样式，保留业务快捷项计算。

- [ ] **Step 5: 运行组件和页面测试**

Run: `node tests/numeric-amount-sheet.test.js; node tests/hand-ledger-input-flow.test.js`
Expected: 两个测试文件全部 PASS。

### Task 4: 扩大桌面并强化当前行动高亮

**Files:**
- Modify: `pages/hand-ledger-input/hand-ledger-input.wxml`
- Modify: `pages/hand-ledger-input/hand-ledger-input.wxss`
- Modify: `utils/hand-table-layout.js`
- Modify: `tests/hand-table-layout.test.js`
- Modify: `tests/hand-ledger-input-flow.test.js`

**Interfaces:**
- Consumes `seat-unit-{large|medium|compact}` 与 `item.current`。
- Produces扩大后的稳定座位 token 和 `.seat-unit.current::before` 行动外环。

- [ ] **Step 1: 写尺寸与行动状态失败测试**

断言页面底部预留小于旧 `318rpx`、桌框高度大于旧 `calc(100% - 30rpx)`、座位和牌面尺寸增大、当前行动存在独立伪元素动画、WXML 不再渲染 `.turn-flow`。

- [ ] **Step 2: 运行布局测试并确认失败**

Run: `node tests/hand-table-layout.test.js; node tests/hand-ledger-input-flow.test.js`
Expected: FAIL，仍匹配旧尺寸或独立 turn-flow。

- [ ] **Step 3: 调整可用高度和桌框**

将 `.page` 底部预留调整到实际 play dock 高度；桌框高度扩展到接近容器边界，保持 `overflow:hidden`，不增加桌面滚动。

- [ ] **Step 4: 调整 6/8/9max 座位与牌面 token**

提高 large/medium/compact 的宽高与座位内牌面尺寸；如边界测试失败，仅微调 `utils/hand-table-layout.js` 的稳定坐标，禁止恢复动态椭圆公式。

- [ ] **Step 5: 实现当前行动外环**

删除独立 `turn-flow` 节点；用 `.seat-unit.current::before` 绘制青绿色呼吸外环，Hero 黄色 `.seat-body` 边框保持不变。

```css
.seat-unit.current::before {
  content: '';
  position: absolute;
  inset: -8rpx -6rpx 28rpx;
  border: 4rpx solid #61f4b0;
  border-radius: 50%;
  animation: currentSeatPulse 1.15s ease-in-out infinite;
  pointer-events: none;
}
```

- [ ] **Step 6: 运行全部专项测试**

Run: `node tests/numeric-amount-sheet.test.js; node tests/hand-table-layout.test.js; node tests/hand-ledger-input-flow.test.js`
Expected: 全部 PASS。

### Task 5: 最终回归与微信预览

**Files:**
- Verify only: all modified files above.

- [ ] **Step 1: 运行语法检查**

Run: `node --check components/numeric-amount-sheet/index.js; node --check pages/hand-ledger-input/hand-ledger-input.js; node --check utils/hand-table-layout.js`
Expected: exit 0。

- [ ] **Step 2: 运行仓库测试**

Run: `Get-ChildItem tests -Filter *.test.js | ForEach-Object { node $_.FullName; if ($LASTEXITCODE -ne 0) { throw "failed: $($_.Name)" } }`
Expected: 本次相关测试全部通过；若仅有既存版本公告不匹配，单独报告且不覆盖公告内容。

- [ ] **Step 3: 执行微信开发者工具自动预览**

Run: `powershell -ExecutionPolicy Bypass -File tools/auto-preview.ps1`
Expected: 真实工作区优先成功；如体积限制，使用脚本生成的干净运行包并明确报告。

- [ ] **Step 4: 视觉检查**

检查 6/8/9max：桌面无滚动条、底部无明显空白、座位/牌面/下注互不遮挡、当前行动环清晰、Hero 当前行动双状态可见、金额组件不拉起系统键盘。
