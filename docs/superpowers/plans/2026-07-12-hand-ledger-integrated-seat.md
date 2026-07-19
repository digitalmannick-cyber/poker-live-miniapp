# 完整手牌录入一体化座位 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将完整手牌录入牌桌的手牌、位置、玩家名称和有效筹码合并为稳定的一体化座位组件，并将下注金额固定在独立桌内轨道，消除 6max、8max、9max 下的漂移和遮挡。

**Architecture:** 新增纯函数布局模块，分别输出各桌型的稳定座位中心和下注锚点；`hand-ledger-input.js` 只负责把业务状态映射为座位视图模型。WXML 将手牌嵌入座位节点，删除独立对手手牌与 Hero 手牌浮层；WXSS 负责固定尺寸和状态样式，不参与坐标计算。

**Tech Stack:** 微信小程序 WXML/WXSS/JavaScript、Node.js `assert` 回归测试、微信开发者工具 CLI 自动预览。

## Global Constraints

- 未录入手牌时只显示位置，不显示牌背。
- 手牌不得使用独立桌面绝对坐标，必须属于对应座位组件。
- Hero 与其他玩家共用同一座位结构和坐标逻辑。
- 下注金额只能位于座位对应的桌内下注锚点。
- 不修改行动、底池、All-in、回放和保存数据结构。
- 牌桌区域不得出现横向或纵向滚动条。
- 6max、8max、9max 均需单独验证。

---

### Task 1: 建立稳定桌型布局模块

**Files:**
- Create: `utils/hand-table-layout.js`
- Create: `tests/hand-table-layout.test.js`

**Interfaces:**
- Produces: `getSeatLayout(tableSize, slot) -> { seat: { x, y }, bet: { x, y }, size: 'large'|'medium'|'compact', edge: 'top'|'right'|'bottom'|'left' }`
- Produces: `getActiveSlots(tableSize) -> string[]`
- Consumes: table size `6 | 8 | 9` and stable visual slots `BTN, SB, BB, UTG, UTG1, MP, LJ, HJ, CO`.

- [ ] **Step 1: Write the failing coordinate tests**

```js
const assert = require('node:assert/strict')
const layout = require('../utils/hand-table-layout')

for (const size of [6, 8, 9]) {
  const slots = layout.getActiveSlots(size)
  assert.equal(slots.length, size)
  const seats = slots.map(slot => layout.getSeatLayout(size, slot))
  seats.forEach(item => {
    assert(item.seat.x >= 7 && item.seat.x <= 93)
    assert(item.seat.y >= 7 && item.seat.y <= 91)
    assert(item.bet.x >= 17 && item.bet.x <= 83)
    assert(item.bet.y >= 17 && item.bet.y <= 83)
  })
  for (let i = 0; i < seats.length; i += 1) {
    for (let j = i + 1; j < seats.length; j += 1) {
      const dx = seats[i].seat.x - seats[j].seat.x
      const dy = seats[i].seat.y - seats[j].seat.y
      assert(Math.sqrt(dx * dx + dy * dy) >= (size === 9 ? 24 : 27))
    }
  }
}
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node tests/hand-table-layout.test.js`

Expected: FAIL because `utils/hand-table-layout.js` does not exist.

- [ ] **Step 3: Implement explicit layouts**

Create `utils/hand-table-layout.js` with explicit position tables rather than calculating hand-card offsets:

```js
const ACTIVE_SLOTS = {
  6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'],
  8: ['BTN', 'SB', 'BB', 'UTG', 'UTG1', 'MP', 'HJ', 'CO'],
  9: ['BTN', 'SB', 'BB', 'UTG', 'UTG1', 'MP', 'LJ', 'HJ', 'CO']
}

const LAYOUTS = {
  6: {
    BTN: { seat: [78, 13], bet: [70, 28], edge: 'top' },
    SB: { seat: [91, 49], bet: [76, 49], edge: 'right' },
    BB: { seat: [75, 88], bet: [68, 72], edge: 'bottom' },
    UTG: { seat: [25, 88], bet: [32, 72], edge: 'bottom' },
    HJ: { seat: [9, 49], bet: [24, 49], edge: 'left' },
    CO: { seat: [22, 13], bet: [30, 28], edge: 'top' }
  },
  8: {
    BTN: { seat: [74, 10], bet: [68, 26], edge: 'top' },
    SB: { seat: [91, 34], bet: [77, 38], edge: 'right' },
    BB: { seat: [91, 67], bet: [77, 62], edge: 'right' },
    UTG: { seat: [72, 90], bet: [67, 74], edge: 'bottom' },
    UTG1: { seat: [28, 90], bet: [33, 74], edge: 'bottom' },
    MP: { seat: [9, 67], bet: [23, 62], edge: 'left' },
    HJ: { seat: [9, 34], bet: [23, 38], edge: 'left' },
    CO: { seat: [26, 10], bet: [32, 26], edge: 'top' }
  },
  9: {
    BTN: { seat: [71, 9], bet: [66, 25], edge: 'top' },
    SB: { seat: [90, 28], bet: [76, 34], edge: 'right' },
    BB: { seat: [92, 58], bet: [77, 56], edge: 'right' },
    UTG: { seat: [79, 86], bet: [69, 72], edge: 'bottom' },
    UTG1: { seat: [50, 92], bet: [50, 75], edge: 'bottom' },
    MP: { seat: [21, 86], bet: [31, 72], edge: 'bottom' },
    LJ: { seat: [8, 58], bet: [23, 56], edge: 'left' },
    HJ: { seat: [10, 28], bet: [24, 34], edge: 'left' },
    CO: { seat: [29, 9], bet: [34, 25], edge: 'top' }
  }
}
```

Return cloned point objects and size token `large` for 6max, `medium` for 8max, `compact` for 9max. Throw for unsupported active slots so layout omissions fail loudly in tests.

- [ ] **Step 4: Run the coordinate test and verify GREEN**

Run: `node tests/hand-table-layout.test.js`

Expected: PASS for all three table sizes and all seat/bet bounds.

- [ ] **Step 5: Commit the isolated layout module**

```bash
git add utils/hand-table-layout.js tests/hand-table-layout.test.js
git commit -m "feat: add stable hand table seat layouts"
```

---

### Task 2: 将页面视图模型切换到座位组件和下注锚点

**Files:**
- Modify: `pages/hand-ledger-input/hand-ledger-input.js`
- Modify: `tests/hand-ledger-input-flow.test.js`

**Interfaces:**
- Consumes: `getSeatLayout(tableSize, slot)` and `getActiveSlots(tableSize)` from Task 1.
- Produces per-seat fields: `seatStyle`, `betStyle`, `sizeClass`, `edgeClass`, `cardsVisual`, `hasCards`, `stackText`, `playerName`, `hero`, `dealer`, `current`, `folded`, `allIn`.
- Removes page-level outputs: `cardsStyle`, `cardPlacement`, `heroCardsStyle`, `heroCardPlacement`.

- [ ] **Step 1: Replace geometry assertions with component ownership assertions**

Add to `tests/hand-ledger-input-flow.test.js`:

```js
async function testSeatViewOwnsCardsAndUsesIndependentBetAnchor() {
  const page = await createPage()
  const heroSlot = page.data.heroSlot
  page.setData({ heroCardsInput: 'AhKd' })
  const players = Object.assign({}, page.data.players, {
    BTN: Object.assign({}, page.data.players.BTN, { cards: 'QsQd', playerName: 'Long Player Name' })
  })
  page.setData({ players })
  page.updateAll()
  const hero = page.data.seats.find(item => item.slot === heroSlot)
  const button = page.data.seats.find(item => item.slot === 'BTN')
  assert.equal(hero.cardsVisual.length, 2)
  assert.equal(button.cardsVisual.length, 2)
  assert.equal(Object.hasOwn(button, 'cardsStyle'), false)
  assert.notEqual(button.seatStyle, button.betStyle)
}
```

Update the layout test so it checks active seat count and distinct bet anchors, not external card distance.

- [ ] **Step 2: Run the test and verify RED**

Run: `node tests/hand-ledger-input-flow.test.js`

Expected: FAIL because Hero cards are still page-level and `cardsStyle` still exists.

- [ ] **Step 3: Implement the minimal view-model migration**

In `hand-ledger-input.js`:

```js
const handTableLayout = require('../../utils/hand-table-layout')
```

Replace `activeSlots()` with `handTableLayout.getActiveSlots(Number(this.data.tableMax))`. In `updateAll()`, obtain `layout = handTableLayout.getSeatLayout(Number(this.data.tableMax), slot)`, use `pointStyle(layout.seat)` and `pointStyle(layout.bet)`, and choose cards from Hero input for Hero or player cards otherwise:

```js
const isHero = slot === this.data.heroSlot
const cardsVisual = isHero
  ? parseCards(this.data.heroCardsInput, 2)
  : parseCards(player.cards || '', 2)
```

Set `hasCards: cardsVisual.length === 2`, `sizeClass: layout.size`, and `edgeClass: layout.edge`. Delete `cardPoint()`, `cardPlacement()`, `cardsStyle`, `heroCardsStyle`, and `heroCardPlacement` only after the tests no longer reference them. Set `turnFlowStyle` from the active seat point returned by the layout module.

- [ ] **Step 4: Run page tests and verify GREEN**

Run: `node tests/hand-table-layout.test.js && node tests/hand-ledger-input-flow.test.js`

Expected: PASS with no independent card coordinate fields.

- [ ] **Step 5: Commit the view-model migration**

```bash
git add pages/hand-ledger-input/hand-ledger-input.js tests/hand-ledger-input-flow.test.js
git commit -m "refactor: bind hand cards to table seats"
```

---

### Task 3: 合并 WXML 座位结构并固定组件尺寸

**Files:**
- Modify: `pages/hand-ledger-input/hand-ledger-input.wxml`
- Modify: `pages/hand-ledger-input/hand-ledger-input.wxss`
- Modify: `tests/hand-ledger-input-flow.test.js`

**Interfaces:**
- Consumes seat view-model fields from Task 2.
- Produces one `.seat-unit` per active player with `.seat-body`, `.seat-cards-inline`, `.seat-position`, `.seat-meta`, and `.seat-stack`.

- [ ] **Step 1: Write failing static structure tests**

```js
function testCardsRenderInsideSeatUnitOnly() {
  const wxml = fs.readFileSync(wxmlPath, 'utf8')
  assert(wxml.includes('class="seat-unit'))
  assert(wxml.includes('class="seat-cards-inline"'))
  assert.equal(wxml.includes('class="seat-cards seat-cards-'), false)
  assert.equal(wxml.includes('class="hero-cards hero-cards-'), false)
}
```

Add assertions that `.seat-unit` has stable table-size classes and `.seat-player-name` uses single-line ellipsis.

- [ ] **Step 2: Run the static test and verify RED**

Run: `node tests/hand-ledger-input-flow.test.js`

Expected: FAIL because WXML still contains independent card layers.

- [ ] **Step 3: Replace the seat block**

Use this hierarchy inside the seat loop:

```xml
<view class="seat-unit seat-unit-{{item.sizeClass}} seat-edge-{{item.edgeClass}} {{item.hero ? 'hero' : ''}} {{item.current ? 'current' : ''}} {{item.folded ? 'folded' : ''}} {{item.allIn ? 'allin' : ''}}"
  style="{{item.seatStyle}}" data-slot="{{item.slot}}" bindtap="tapSeat" bindlongpress="longPressSeat">
  <view class="seat-body">
    <view wx:if="{{item.hasCards}}" class="seat-cards-inline" catchtap="tapSeat">
      <view wx:for="{{item.cardsVisual}}" wx:for-item="card" wx:key="index" class="seat-card mini-card-{{card.suitClass}}">
        <text class="seat-card-rank">{{card.rank}}</text>
        <text class="seat-card-suit">{{card.suitSymbol}}</text>
      </view>
    </view>
    <view class="seat-position {{item.hasCards ? 'with-cards' : ''}}">{{item.label}}</view>
    <view wx:if="{{item.dealer}}" class="dealer">D</view>
  </view>
  <view class="seat-meta">
    <text wx:if="{{item.playerName}}" class="seat-player-name">{{item.playerName}}</text>
    <text class="seat-stack">{{item.stackText}}</text>
  </view>
  <view wx:if="{{item.hero}}" class="hero-badge">HERO</view>
  <view wx:if="{{item.allIn}}" class="allin-badge">ALL-IN</view>
</view>
```

Keep the bet element as a sibling positioned by `item.betStyle`. Remove separate `.hero-cards` and `.seat-cards` blocks.

- [ ] **Step 4: Implement fixed responsive CSS tokens**

Define fixed seat dimensions using classes, no content-driven sizing:

```css
.seat-unit { position:absolute; transform:translate(-50%,-50%); z-index:12; }
.seat-unit-large { width:120rpx; }
.seat-unit-medium { width:112rpx; }
.seat-unit-compact { width:104rpx; }
.seat-body { width:100%; height:100rpx; border-radius:50%; box-sizing:border-box; }
.seat-cards-inline { height:58rpx; display:flex; justify-content:center; gap:4rpx; }
.seat-card { flex:0 0 auto; margin:0; }
.seat-player-name { max-width:100%; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
```

Use 6/8/9max size classes to apply the exact dimensions from the design spec. Keep meta text inside the seat unit width so long names cannot push adjacent seats.

- [ ] **Step 5: Run static and flow tests**

Run: `node tests/hand-table-layout.test.js && node tests/hand-ledger-input-flow.test.js`

Expected: PASS; no `hero-cards` or floating `seat-cards` selectors remain.

- [ ] **Step 6: Commit the integrated seat component**

```bash
git add pages/hand-ledger-input/hand-ledger-input.wxml pages/hand-ledger-input/hand-ledger-input.wxss tests/hand-ledger-input-flow.test.js
git commit -m "feat: render cards inside player seats"
```

---

### Task 4: 对齐下注动画、交互和中心安全区

**Files:**
- Modify: `pages/hand-ledger-input/hand-ledger-input.js`
- Modify: `pages/hand-ledger-input/hand-ledger-input.wxml`
- Modify: `pages/hand-ledger-input/hand-ledger-input.wxss`
- Modify: `tests/hand-ledger-input-flow.test.js`

**Interfaces:**
- Consumes `betStyle` and seat position from Task 1.
- Preserves existing `tapSeat`, `longPressSeat`, `openHeroPicker`, chip-flight, chip-collect, action, replay, All-in and save interfaces.

- [ ] **Step 1: Write failing interaction and safety tests**

Add tests that:

```js
assert(wxml.includes('catchtap="tapSeat"'), 'cards inside a seat must keep seat interaction')
assert.equal(wxml.includes('bindtap="openHeroPicker" class="hero-cards'), false)
assert(/\.table-center\s*\{[^}]*z-index:\s*[0-9]+/.test(wxss))
assert(/\.bet\s*\{[^}]*max-width:/.test(wxss))
```

For every table size, assert no bet anchor is closer than 13 percentage points to the center point `(50, 50)` and no bet anchor equals a seat point.

- [ ] **Step 2: Run tests and verify RED**

Run: `node tests/hand-ledger-input-flow.test.js && node tests/hand-table-layout.test.js`

Expected: FAIL until safety constraints and Hero card interaction are moved into the seat unit.

- [ ] **Step 3: Preserve Hero card editing without a floating layer**

In `tapSeat`, when the tapped slot is Hero and the event dataset includes `cardAction="edit"`, call `openHeroPicker()`; otherwise preserve the existing seat menu behavior. Add `data-card-action="edit"` only to Hero's `.seat-cards-inline`.

- [ ] **Step 4: Point animations at layout anchors**

Replace any remaining calls that calculate card coordinates. Chip flight starts at the active seat center and lands at `betStyle`; collection starts at each `betStyle` and ends at the unchanged pot center. Do not change contribution or pot arithmetic.

- [ ] **Step 5: Enforce visual bounds**

Set a fixed `max-width` and ellipsis on `.bet`. Keep `.table-center` above felt decoration but below seats and bets. Ensure `.table`, `.table-stage`, and their scroll containers use hidden scrollbars and do not create overflow from seat metadata.

- [ ] **Step 6: Run complete regression**

Run:

```powershell
$failed=@()
Get-ChildItem tests -File -Filter *.test.js | ForEach-Object {
  node $_.FullName
  if ($LASTEXITCODE -ne 0) { $failed += $_.Name }
}
if ($failed.Count) { throw ($failed -join ', ') }
```

Expected: all existing tests pass. If `release-notes-poster.test.js` still reports only the pre-existing app-version/release-notes mismatch, resolve that release metadata separately before upload; do not fold it into layout code.

- [ ] **Step 7: Run real WeChat auto-preview**

Run: `powershell -ExecutionPolicy Bypass -File tools/auto-preview.ps1`

Expected: `√ auto-preview` from the real workspace path.

- [ ] **Step 8: Perform visual acceptance in three states**

In WeChat DevTools verify:

1. 6max: Hero bottom-side with known cards, one opponent known, long player name.
2. 8max: known cards on top, left, right and bottom seats; simultaneous bets on at least four seats.
3. 9max: all seats active, two known opponents, one Fold, one All-in, Button and current action highlights.

For each state confirm no card/seat/meta/bet overlap, no center intrusion, no status-bar or street-tab obstruction, and no table scrollbar.

- [ ] **Step 9: Commit verified integration**

```bash
git add pages/hand-ledger-input/hand-ledger-input.js pages/hand-ledger-input/hand-ledger-input.wxml pages/hand-ledger-input/hand-ledger-input.wxss tests/hand-ledger-input-flow.test.js
git commit -m "fix: stabilize hand ledger seat and bet layout"
```
