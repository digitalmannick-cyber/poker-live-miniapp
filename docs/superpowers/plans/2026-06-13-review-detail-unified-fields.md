# Review Detail Unified Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one canonical hand detail field model used by quick entry expanded details, AI voice confirmation, read-only review detail, and edit detail.

**Architecture:** Add a shared `utils/hand-detail-fields.js` module that defines field order, empty display values, straddle behavior, and mode-specific view models. Existing pages consume that module instead of independently maintaining field lists. Persist the new fields on hand records and pass them through AI review requests.

**Tech Stack:** WeChat miniapp pages (`.js`, `.wxml`, `.wxss`), CommonJS utilities, Node built-in test/assert scripts in `tests/`, local store/cloud repository services.

---

## File Structure

- Create: `utils/hand-detail-fields.js`  
  Shared schema, straddle helpers, position filtering, form normalization, read-only display rows, and street view model builders.

- Create: `tests/hand-detail-fields.test.js`  
  Unit tests for schema order, straddle behavior, read-only empty placeholders, quick-entry completeness detection, and street labels.

- Modify: `utils/store.js`  
  Persist `hasStraddle`, `heroQuestion`, `opponentName`, and existing `showdown` consistently during create/update.

- Modify: `services/cloud-repo.js`  
  Preserve the same fields in cloud hand normalization and updates.

- Modify: `pages/hand-record/hand-record.js`  
  Add canonical fields to the form, straddle toggle behavior, filtered position options, and save payload.

- Modify: `pages/hand-record/hand-record.wxml`  
  Make expanded quick-entry details match the canonical field set and full Chinese street names.

- Modify: `pages/hand-detail/hand-detail.js`  
  Use the shared model for full detail/edit form values, add new fields, and apply straddle-filtered position selectors.

- Modify: `pages/hand-detail/hand-detail.wxml`  
  Align full detail/edit fields to the canonical layout and show empty read-only values as `-`.

- Modify: `pages/review-list/review-list.js`  
  Use the shared model for detail view, parsed voice preview, voice patch, straddle state, and AI request payload.

- Modify: `pages/review-list/review-list.wxml`  
  Ensure AI confirmation is the only full canonical form while active, then collapse after backfill and show read-only canonical details.

- Modify: `cloudfunctions/poker_review/index.js`  
  Include `hasStraddle`, computed `straddleAmount`, `heroQuestion`, and opponent hand/showdown in extraction/advice prompt contracts.

- Modify: targeted tests under `tests/`  
  Add static assertions around shared field usage, straddle gating, AI collapse behavior, and full Chinese street labels.

---

### Task 1: Shared Hand Detail Field Model

**Files:**
- Create: `utils/hand-detail-fields.js`
- Create: `tests/hand-detail-fields.test.js`

- [ ] **Step 1: Write the failing shared-model test**

Create `tests/hand-detail-fields.test.js`:

```js
const test = require('node:test')
const assert = require('node:assert/strict')

const fields = require('../utils/hand-detail-fields')

test('canonical fields include agreed detail fields in order', () => {
  assert.deepEqual(
    fields.CANONICAL_FIELD_KEYS,
    [
      'playedDate',
      'stakeLevel',
      'playerCount',
      'hasStraddle',
      'heroPosition',
      'villainPosition',
      'villainType',
      'effectiveStack',
      'potSize',
      'currentProfit',
      'opponentName',
      'showdown',
      'heroCardsInput',
      'streetSummary',
      'mindJourney',
      'heroQuestion',
      'streetDetails',
      'tags',
      'aiReview'
    ]
  )
})

test('straddle gates STR position and computes fixed 2x big blind amount', () => {
  const positions = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB', 'STR']

  assert.deepEqual(fields.getPositionOptions(positions, false), ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'])
  assert.deepEqual(fields.getPositionOptions(positions, true), positions)
  assert.equal(fields.getBigBlindFromLevel('300/600'), 600)
  assert.equal(fields.getStraddleAmount('300/600'), 1200)
})

test('read-only rows show all canonical fields and use dash for empty values after backfill', () => {
  const view = fields.buildHandDetailViewModel({
    playedDate: '2026/06/06',
    stakeLevel: '300/600',
    hasStraddle: true,
    heroCardsInput: '7h8h',
    currentProfit: -67000,
    streetInputs: {
      preflop: { pot: '42300', actionLine: 'STR open1800 -> Hero call' },
      flop: { pot: '42300', actionLine: 'Hero fold' },
      turn: { pot: '', actionLine: '' },
      river: { pot: '', actionLine: '' }
    },
    board: { flop: 'Js8d3d', turn: '6s', river: '' }
  }, {
    mode: 'readonly',
    backfilled: true,
    positions: ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB', 'STR']
  })

  assert.equal(view.shouldShowFullDetails, true)
  assert.equal(view.rows.find(item => item.key === 'showdown').displayValue, '-')
  assert.equal(view.rows.find(item => item.key === 'heroQuestion').displayValue, '-')
  assert.deepEqual(
    view.streetItems.map(item => item.label),
    ['翻前', '翻牌', '转牌', '河牌']
  )
})

test('quick-entry-only hands hide full details before AI confirmation', () => {
  const view = fields.buildHandDetailViewModel({
    heroCardsInput: 'AhAd',
    currentProfit: 80000
  }, {
    mode: 'readonly',
    backfilled: false,
    positions: ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB']
  })

  assert.equal(view.hasOnlyQuickEntryDetails, true)
  assert.equal(view.shouldShowFullDetails, false)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
node tests\hand-detail-fields.test.js
```

Expected: FAIL with `Cannot find module '../utils/hand-detail-fields'`.

- [ ] **Step 3: Implement the shared module**

Create `utils/hand-detail-fields.js`:

```js
const cardUi = require('./card-ui')

const EMPTY_DISPLAY = '-'

const CANONICAL_FIELD_KEYS = [
  'playedDate',
  'stakeLevel',
  'playerCount',
  'hasStraddle',
  'heroPosition',
  'villainPosition',
  'villainType',
  'effectiveStack',
  'potSize',
  'currentProfit',
  'opponentName',
  'showdown',
  'heroCardsInput',
  'streetSummary',
  'mindJourney',
  'heroQuestion',
  'streetDetails',
  'tags',
  'aiReview'
]

const FIELD_META = {
  playedDate: { label: '日期', type: 'date' },
  stakeLevel: { label: '级别', type: 'select' },
  playerCount: { label: '人数', type: 'number' },
  hasStraddle: { label: '是否 Straddle', type: 'checkbox' },
  heroPosition: { label: 'Hero 位置', type: 'select' },
  villainPosition: { label: '对手位置', type: 'select' },
  villainType: { label: '对手类型', type: 'select' },
  effectiveStack: { label: '有效筹码', type: 'number' },
  potSize: { label: '当前底池', type: 'number' },
  currentProfit: { label: '本手输赢', type: 'number' },
  opponentName: { label: '对手昵称', type: 'text' },
  showdown: { label: '对手手牌 / Showdown', type: 'text' },
  heroCardsInput: { label: 'Hero 手牌', type: 'cards' },
  streetSummary: { label: '行动线总结', type: 'textarea' },
  mindJourney: { label: '心路历程', type: 'textarea' },
  heroQuestion: { label: 'Hero 疑问点', type: 'textarea', rows: 2 },
  streetDetails: { label: '逐街详情', type: 'streetGroup' },
  tags: { label: '标签', type: 'tags' },
  aiReview: { label: 'AI 建议', type: 'aiReview' }
}

const STREET_META = [
  { key: 'preflop', label: '翻前', boardLimit: 0 },
  { key: 'flop', label: '翻牌', boardLimit: 3 },
  { key: 'turn', label: '转牌', boardLimit: 1 },
  { key: 'river', label: '河牌', boardLimit: 1 }
]

function present(value) {
  if (value == null) return false
  if (Array.isArray(value)) return value.length > 0
  return String(value).trim() !== ''
}

function displayValue(value) {
  return present(value) ? String(value) : EMPTY_DISPLAY
}

function getBigBlindFromLevel(levelText, session) {
  const text = String(levelText || '').trim()
  const match = text.match(/^(\d+)\s*\/\s*(\d+)$/)
  if (match) return Number(match[2]) || 0
  return Number(session && session.bigBlind) || 0
}

function getStraddleAmount(levelText, session) {
  const bigBlind = getBigBlindFromLevel(levelText, session)
  return bigBlind ? bigBlind * 2 : 0
}

function getPositionOptions(positions, hasStraddle) {
  const source = positions || []
  return hasStraddle
    ? source.slice()
    : source.filter(item => String(item || '').toUpperCase() !== 'STR')
}

function normalizeBoolean(value) {
  return value === true || value === 1 || value === '1' || value === 'true'
}

function normalizeHandDetailForm(hand) {
  const source = hand || {}
  const board = source.board || {}
  const streetInputs = source.streetInputs || {}
  return {
    playedDate: source.playedDate || '',
    stakeLevel: source.stakeLevel || '',
    playerCount: source.playerCount || '',
    hasStraddle: normalizeBoolean(source.hasStraddle),
    heroPosition: source.heroPosition || '',
    villainPosition: source.villainPosition || '',
    villainType: source.villainType || source.opponentType || '',
    effectiveStack: source.effectiveStack || '',
    potSize: source.potSize || '',
    currentProfit: source.currentProfit === 0 ? 0 : source.currentProfit || '',
    opponentName: source.opponentName || '',
    showdown: source.showdown || source.villainCards || '',
    heroCardsInput: source.heroCardsInput || '',
    streetSummary: source.streetSummary || '',
    mindJourney: source.mindJourney || source.notes || '',
    heroQuestion: source.heroQuestion || '',
    tags: Array.isArray(source.tags) ? source.tags : [],
    aiReview: source.aiReview || null,
    board: {
      flop: board.flop || source.flop || '',
      turn: board.turn || source.turn || '',
      river: board.river || source.river || ''
    },
    streetInputs: {
      preflop: Object.assign({ pot: '', actionLine: '' }, streetInputs.preflop || {}),
      flop: Object.assign({ pot: '', actionLine: '' }, streetInputs.flop || {}),
      turn: Object.assign({ pot: '', actionLine: '' }, streetInputs.turn || {}),
      river: Object.assign({ pot: '', actionLine: '' }, streetInputs.river || {})
    }
  }
}

function hasOnlyQuickEntryDetails(hand) {
  const form = normalizeHandDetailForm(hand)
  const detailKeys = [
    'playedDate',
    'stakeLevel',
    'playerCount',
    'heroPosition',
    'villainPosition',
    'villainType',
    'effectiveStack',
    'potSize',
    'opponentName',
    'showdown',
    'streetSummary',
    'mindJourney',
    'heroQuestion'
  ]
  const hasField = detailKeys.some(key => present(form[key]))
  const hasBoard = present(form.board.flop) || present(form.board.turn) || present(form.board.river)
  const hasStreet = STREET_META.some(item => {
    const street = form.streetInputs[item.key] || {}
    return present(street.pot) || present(street.actionLine)
  })
  const hasTags = form.tags.length > 0
  return !hasField && !form.hasStraddle && !hasBoard && !hasStreet && !hasTags
}

function buildRows(form, options) {
  const config = options || {}
  return CANONICAL_FIELD_KEYS
    .filter(key => key !== 'streetDetails' && key !== 'aiReview')
    .map(key => {
      const meta = FIELD_META[key]
      const rawValue = key === 'hasStraddle' ? (form.hasStraddle ? '是' : '否') : form[key]
      return {
        key,
        label: meta.label,
        type: meta.type,
        editable: config.mode !== 'readonly',
        value: form[key],
        displayValue: displayValue(rawValue)
      }
    })
}

function buildStreetItems(form) {
  const board = form.board || {}
  const streetInputs = form.streetInputs || {}
  return STREET_META.map(item => {
    const street = streetInputs[item.key] || {}
    const boardValue = item.key === 'preflop' ? '' : board[item.key] || ''
    return {
      key: item.key,
      label: item.label,
      boardValue,
      boardCards: item.boardLimit ? cardUi.parseCardsInput(boardValue, item.boardLimit) : [],
      boardDisplay: item.key === 'preflop' ? EMPTY_DISPLAY : displayValue(boardValue),
      pot: street.pot || '',
      potDisplay: displayValue(street.pot),
      actionLine: street.actionLine || '',
      actionLineDisplay: displayValue(street.actionLine)
    }
  })
}

function buildHandDetailViewModel(hand, options) {
  const config = options || {}
  const form = normalizeHandDetailForm(hand)
  const quickOnly = hasOnlyQuickEntryDetails(hand)
  const backfilled = !!config.backfilled || !!(hand && hand.detailBackfilled)
  const fullDetailsRequested = config.mode !== 'readonly' || backfilled || !quickOnly
  return {
    mode: config.mode || 'readonly',
    editable: config.mode !== 'readonly',
    form,
    rows: buildRows(form, config),
    streetItems: buildStreetItems(form),
    positionOptions: getPositionOptions(config.positions || [], form.hasStraddle),
    straddleAmount: form.hasStraddle ? getStraddleAmount(form.stakeLevel, config.session) : 0,
    hasOnlyQuickEntryDetails: quickOnly,
    shouldShowFullDetails: fullDetailsRequested
  }
}

module.exports = {
  EMPTY_DISPLAY,
  CANONICAL_FIELD_KEYS,
  FIELD_META,
  STREET_META,
  getBigBlindFromLevel,
  getStraddleAmount,
  getPositionOptions,
  normalizeHandDetailForm,
  hasOnlyQuickEntryDetails,
  buildHandDetailViewModel
}
```

- [ ] **Step 4: Run the shared-model test to verify it passes**

Run:

```powershell
node tests\hand-detail-fields.test.js
```

Expected: PASS with no assertion errors.

- [ ] **Step 5: Commit**

```powershell
git add utils\hand-detail-fields.js tests\hand-detail-fields.test.js
git commit -m "feat: add shared hand detail field model"
```

---

### Task 2: Persist New Canonical Fields

**Files:**
- Modify: `utils/store.js`
- Modify: `services/cloud-repo.js`
- Create: `tests/hand-detail-persistence.test.js`

- [ ] **Step 1: Write the failing persistence test**

Create `tests/hand-detail-persistence.test.js`:

```js
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const root = path.resolve(__dirname, '..')

test('local store createHand persists new canonical fields', () => {
  const source = fs.readFileSync(path.join(root, 'utils/store.js'), 'utf8')

  assert.match(source, /hasStraddle:\s*!!payload\.hasStraddle/)
  assert.match(source, /heroQuestion:\s*payload\.heroQuestion\s*\|\|\s*''/)
  assert.match(source, /opponentName:\s*payload\.opponentName\s*\|\|\s*''/)
  assert.match(source, /detailBackfilled:\s*!!payload\.detailBackfilled/)
})

test('cloud repo normalization preserves new canonical fields', () => {
  const source = fs.readFileSync(path.join(root, 'services/cloud-repo.js'), 'utf8')

  assert.match(source, /hasStraddle:\s*!!merged\.hasStraddle/)
  assert.match(source, /heroQuestion:\s*merged\.heroQuestion\s*\|\|\s*''/)
  assert.match(source, /opponentName:\s*merged\.opponentName\s*\|\|\s*''/)
  assert.match(source, /detailBackfilled:\s*!!merged\.detailBackfilled/)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
node tests\hand-detail-persistence.test.js
```

Expected: FAIL because at least `hasStraddle`, `heroQuestion`, and `detailBackfilled` are not persisted yet.

- [ ] **Step 3: Update local store persistence**

In `utils/store.js`, update the hand object inside `createHand(payload)` so it includes:

```js
hasStraddle: !!payload.hasStraddle,
heroQuestion: payload.heroQuestion || '',
opponentName: payload.opponentName || '',
detailBackfilled: !!payload.detailBackfilled,
```

In `updateHand(handId, patch)`, keep the existing merge behavior, but ensure these fields are allowed by the generic merge and not overwritten by older derived values. If `updateHand` builds an explicit object, include:

```js
hasStraddle: patch.hasStraddle == null ? existing.hasStraddle : !!patch.hasStraddle,
heroQuestion: patch.heroQuestion == null ? existing.heroQuestion || '' : patch.heroQuestion || '',
opponentName: patch.opponentName == null ? existing.opponentName || '' : patch.opponentName || '',
detailBackfilled: patch.detailBackfilled == null ? !!existing.detailBackfilled : !!patch.detailBackfilled,
```

- [ ] **Step 4: Update cloud repo normalization**

In `services/cloud-repo.js`, update the hand normalization/merge object to include:

```js
hasStraddle: !!merged.hasStraddle,
heroQuestion: merged.heroQuestion || '',
opponentName: merged.opponentName || '',
detailBackfilled: !!merged.detailBackfilled,
```

Keep `showdown` as the canonical opponent hand field. Do not add a separate required user-facing `villainCards` field.

- [ ] **Step 5: Run the persistence test**

Run:

```powershell
node tests\hand-detail-persistence.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add utils\store.js services\cloud-repo.js tests\hand-detail-persistence.test.js
git commit -m "feat: persist canonical hand detail fields"
```

---

### Task 3: Quick Entry Expanded Details

**Files:**
- Modify: `pages/hand-record/hand-record.js`
- Modify: `pages/hand-record/hand-record.wxml`
- Test: `tests/quick-entry-unified-fields.test.js`

- [ ] **Step 1: Write the failing quick-entry test**

Create `tests/quick-entry-unified-fields.test.js`:

```js
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const root = path.resolve(__dirname, '..')
const js = fs.readFileSync(path.join(root, 'pages/hand-record/hand-record.js'), 'utf8')
const wxml = fs.readFileSync(path.join(root, 'pages/hand-record/hand-record.wxml'), 'utf8')

test('quick entry imports shared hand detail field helpers', () => {
  assert.ok(js.includes("require('../../utils/hand-detail-fields')"))
  assert.ok(js.includes('getPositionOptions'))
  assert.ok(js.includes('hasStraddle'))
})

test('expanded quick entry includes canonical new fields', () => {
  assert.ok(wxml.includes('是否 Straddle'))
  assert.ok(wxml.includes('对手昵称'))
  assert.ok(wxml.includes('对手手牌'))
  assert.ok(wxml.includes('Hero 疑问点'))
})

test('quick entry uses full street names', () => {
  ;['翻前', '翻牌', '转牌', '河牌'].forEach(label => {
    assert.ok(wxml.includes(label), `missing ${label}`)
  })
  assert.equal(wxml.includes('>PF<'), false)
})

test('save payload includes new canonical fields', () => {
  assert.ok(js.includes('hasStraddle: form.hasStraddle'))
  assert.ok(js.includes('heroQuestion: form.heroQuestion'))
  assert.ok(js.includes('opponentName: form.opponentName'))
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
node tests\quick-entry-unified-fields.test.js
```

Expected: FAIL because quick entry does not yet expose all canonical new fields.

- [ ] **Step 3: Add quick-entry form fields and straddle toggle**

In `pages/hand-record/hand-record.js`:

Add the import:

```js
const handDetailFields = require('../../utils/hand-detail-fields')
```

Add fields to `data.form` and `getEmptyHandFormPatch()`:

```js
playerCount: '',
hasStraddle: false,
opponentName: '',
heroQuestion: '',
```

Add the toggle:

```js
toggleStraddle() {
  const hasStraddle = !this.data.form.hasStraddle
  const positionOptions = handDetailFields.getPositionOptions(this.data.positions, hasStraddle)
  const patch = {
    'form.hasStraddle': hasStraddle
  }
  if (!hasStraddle && this.data.form.heroPosition === 'STR') {
    patch['form.heroPosition'] = positionOptions[0] || ''
  }
  if (!hasStraddle && this.data.form.villainPosition === 'STR') {
    patch['form.villainPosition'] = positionOptions[positionOptions.length - 1] || ''
  }
  this.setData(patch)
}
```

Update selector openings to use:

```js
const positionOptions = handDetailFields.getPositionOptions(this.data.positions, this.data.form.hasStraddle)
```

Use `positionOptions` for Hero and villain position selectors.

- [ ] **Step 4: Add expanded quick-entry fields to WXML**

In `pages/hand-record/hand-record.wxml`, inside expanded details, add:

```xml
<view>
  <view class="label">是否 Straddle</view>
  <view class="picker compact-input preset-trigger" bindtap="toggleStraddle">{{form.hasStraddle ? '是' : '否'}}</view>
</view>
<view>
  <view class="label">人数</view>
  <input class="input compact-input" type="number" value="{{form.playerCount}}" data-key="playerCount" bindinput="onInput" />
</view>
<view>
  <view class="label">对手昵称</view>
  <input class="input compact-input" value="{{form.opponentName}}" data-key="opponentName" bindinput="onInput" />
</view>
<view>
  <view class="label">对手手牌</view>
  <input class="input compact-input" placeholder="例如 AQ / AhQd / 77" value="{{form.showdown}}" data-key="showdown" bindinput="onInput" />
</view>
```

In the analysis card, add the two-line Hero question field:

```xml
<view class="label">Hero 疑问点</view>
<textarea class="textarea hero-question-textarea" maxlength="160" value="{{form.heroQuestion}}" data-key="heroQuestion" bindinput="onInput"></textarea>
```

Rename street titles to full Chinese labels if any are still abbreviated.

- [ ] **Step 5: Update save payload**

In `saveHand`, include:

```js
playerCount: form.playerCount,
hasStraddle: form.hasStraddle,
opponentName: form.opponentName,
heroQuestion: form.heroQuestion,
```

Keep `resultBB` calculated with `formatResultBb(form.currentProfit, form.stakeLevel, this.data.session)` so BB remains big-blind based.

- [ ] **Step 6: Run quick-entry test**

Run:

```powershell
node tests\quick-entry-unified-fields.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add pages\hand-record\hand-record.js pages\hand-record\hand-record.wxml tests\quick-entry-unified-fields.test.js
git commit -m "feat: align quick entry detail fields"
```

---

### Task 4: AI Confirmation and Read-Only Review Detail

**Files:**
- Modify: `pages/review-list/review-list.js`
- Modify: `pages/review-list/review-list.wxml`
- Test: `tests/review-unified-detail-state.test.js`

- [ ] **Step 1: Write the failing review state test**

Create `tests/review-unified-detail-state.test.js`:

```js
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const root = path.resolve(__dirname, '..')
const js = fs.readFileSync(path.join(root, 'pages/review-list/review-list.js'), 'utf8')
const wxml = fs.readFileSync(path.join(root, 'pages/review-list/review-list.wxml'), 'utf8')

test('review list uses shared hand detail field helpers', () => {
  assert.ok(js.includes("require('../../utils/hand-detail-fields')"))
  assert.ok(js.includes('buildHandDetailViewModel'))
})

test('voice confirmation includes new canonical fields', () => {
  assert.ok(wxml.includes('是否 Straddle'))
  assert.ok(wxml.includes('对手手牌'))
  assert.ok(wxml.includes('Hero 疑问点'))
})

test('read-only detail is gated while voice confirmation is expanded', () => {
  assert.ok(wxml.includes('wx:if="{{detailHand.shouldShowFullDetails && !voicePanelVisible}}"'))
})

test('apply voice patch marks hand as backfilled and collapses voice panel', () => {
  assert.ok(js.includes('detailBackfilled: true'))
  assert.ok(js.includes('voicePanelVisible: false'))
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
node tests\review-unified-detail-state.test.js
```

Expected: FAIL because shared model and gating are not wired yet.

- [ ] **Step 3: Import shared helpers and build detail view**

In `pages/review-list/review-list.js`, add:

```js
const handDetailFields = require('../../utils/hand-detail-fields')
```

In `buildDetailHandView(hand, chipUnit)`, build the shared model:

```js
const detailView = handDetailFields.buildHandDetailViewModel(hand, {
  mode: 'readonly',
  backfilled: !!hand.detailBackfilled,
  positions: dataService.getAppSettings().positions || [],
  session: null
})
```

Merge these properties into the returned detail hand:

```js
detailRows: detailView.rows,
streetItems: detailView.streetItems,
shouldShowFullDetails: detailView.shouldShowFullDetails,
hasOnlyQuickEntryDetails: detailView.hasOnlyQuickEntryDetails,
straddleAmount: detailView.straddleAmount,
hasStraddle: detailView.form.hasStraddle,
heroQuestion: detailView.form.heroQuestion,
opponentName: detailView.form.opponentName,
showdown: detailView.form.showdown
```

Preserve existing `aiReviewView`, `currentProfitDisplay`, `resultBBDisplay`, and tag logic.

- [ ] **Step 4: Extend parsed voice preview**

In `buildParsedVoicePreview(parsedVoice, reviewResult)`, include:

```js
hasStraddle: !!parsedVoice.hasStraddle,
heroQuestion: parsedVoice.heroQuestion || '',
opponentName: parsedVoice.opponentName || '',
showdown: parsedVoice.showdown || '',
detailRows: handDetailFields.buildHandDetailViewModel(parsedVoice, {
  mode: 'confirm',
  backfilled: true,
  positions: dataService.getAppSettings().positions || []
}).rows
```

Add `hasStraddle`, `heroQuestion`, and `opponentName` support to `setParsedVoiceDraftField`.

- [ ] **Step 5: Update voice patch and collapse behavior**

In `buildVoicePatch(detailHand, parsedVoice, voiceNote)`, include:

```js
hasStraddle: !!lockedParsedVoice.hasStraddle,
heroQuestion: lockedParsedVoice.heroQuestion || current.heroQuestion || '',
opponentName: lockedParsedVoice.opponentName || current.opponentName || '',
detailBackfilled: true,
```

In `applyVoicePatch`, after successful save and reload, keep or add:

```js
this.setData({
  voicePanelVisible: false,
  voiceBusy: false,
  voiceStatus: '语音复盘已保存，EV脑 正在生成建议...'
})
```

- [ ] **Step 6: Gate read-only detail WXML**

In `pages/review-list/review-list.wxml`, wrap the full read-only canonical detail sections with:

```xml
<block wx:if="{{detailHand.shouldShowFullDetails && !voicePanelVisible}}">
  <!-- canonical read-only detail cards -->
</block>
```

Keep the top summary and voice entry visible outside this block. When `voicePanelVisible` is true, only the AI confirmation form is the full field form.

Render read-only rows from `detailHand.detailRows`:

```xml
<view class="review-detail-card review-info-card">
  <view class="review-detail-grid">
    <view wx:for="{{detailHand.detailRows}}" wx:key="key" class="review-info-item">
      <view class="kpi-label">{{item.label}}</view>
      <view class="review-detail-text">{{item.displayValue}}</view>
    </view>
  </view>
</view>
```

Keep street details as a dedicated card using `detailHand.streetItems` and full Chinese labels.

- [ ] **Step 7: Run review state test and existing review tests**

Run:

```powershell
node tests\review-unified-detail-state.test.js
node tests\review-missing-field-ux.test.js
node tests\review-detail-order.test.js
node tests\review-agent-advice.test.js
```

Expected: all PASS. If older tests assert old WXML fragments, update those tests only when the product behavior intentionally changed.

- [ ] **Step 8: Commit**

```powershell
git add pages\review-list\review-list.js pages\review-list\review-list.wxml tests\review-unified-detail-state.test.js tests\review-missing-field-ux.test.js tests\review-detail-order.test.js
git commit -m "feat: unify review detail confirmation state"
```

---

### Task 5: Full Detail/Edit Page Alignment

**Files:**
- Modify: `pages/hand-detail/hand-detail.js`
- Modify: `pages/hand-detail/hand-detail.wxml`
- Test: `tests/hand-detail-unified-edit.test.js`

- [ ] **Step 1: Write the failing hand-detail test**

Create `tests/hand-detail-unified-edit.test.js`:

```js
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const root = path.resolve(__dirname, '..')
const js = fs.readFileSync(path.join(root, 'pages/hand-detail/hand-detail.js'), 'utf8')
const wxml = fs.readFileSync(path.join(root, 'pages/hand-detail/hand-detail.wxml'), 'utf8')

test('hand detail imports shared canonical field helpers', () => {
  assert.ok(js.includes("require('../../utils/hand-detail-fields')"))
  assert.ok(js.includes('buildHandDetailViewModel'))
})

test('hand detail edit page includes canonical new fields', () => {
  assert.ok(wxml.includes('是否 Straddle'))
  assert.ok(wxml.includes('对手昵称'))
  assert.ok(wxml.includes('对手手牌'))
  assert.ok(wxml.includes('Hero 疑问点'))
})

test('hand detail save payload includes canonical new fields', () => {
  assert.ok(js.includes('hasStraddle: this.data.form.hasStraddle'))
  assert.ok(js.includes('heroQuestion: this.data.form.heroQuestion'))
  assert.ok(js.includes('opponentName: this.data.form.opponentName'))
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
node tests\hand-detail-unified-edit.test.js
```

Expected: FAIL because the full detail page does not yet import the shared module or expose all fields.

- [ ] **Step 3: Import shared helpers and extend form**

In `pages/hand-detail/hand-detail.js`, add:

```js
const handDetailFields = require('../../utils/hand-detail-fields')
```

Add fields to `data.form`:

```js
playerCount: '',
hasStraddle: false,
opponentName: '',
heroQuestion: '',
```

In `refresh()`, populate them from `hand`:

```js
playerCount: String(hand.playerCount || ''),
hasStraddle: !!hand.hasStraddle,
opponentName: hand.opponentName || '',
heroQuestion: hand.heroQuestion || '',
```

Build and set a detail view:

```js
const detailView = handDetailFields.buildHandDetailViewModel(hand, {
  mode: this.data.editMode ? 'edit' : 'readonly',
  backfilled: true,
  positions: settings.positions,
  session
})
```

Set:

```js
detailRows: detailView.rows,
detailStreetItems: detailView.streetItems,
positionOptions: detailView.positionOptions
```

- [ ] **Step 4: Add straddle toggle and filtered selectors**

Add:

```js
toggleStraddle() {
  const hasStraddle = !this.data.form.hasStraddle
  const positionOptions = handDetailFields.getPositionOptions(this.data.positions, hasStraddle)
  const patch = { 'form.hasStraddle': hasStraddle, positionOptions }
  if (!hasStraddle && this.data.form.heroPosition === 'STR') patch['form.heroPosition'] = positionOptions[0] || ''
  if (!hasStraddle && this.data.form.villainPosition === 'STR') patch['form.villainPosition'] = positionOptions[positionOptions.length - 1] || ''
  this.setData(patch)
}
```

Use `this.data.positionOptions` in `openPositionSelector()` and `openVillainPositionSelector()`.

- [ ] **Step 5: Update WXML**

In `pages/hand-detail/hand-detail.wxml`, add editable fields in the same positions used by quick entry:

```xml
<view>
  <view class="label">是否 Straddle</view>
  <view class="picker preset-trigger" bindtap="toggleStraddle">{{form.hasStraddle ? '是' : '否'}}</view>
</view>
<view>
  <view class="label">人数</view>
  <input class="input" type="number" value="{{form.playerCount}}" data-key="playerCount" bindinput="onInput" />
</view>
<view>
  <view class="label">对手昵称</view>
  <input class="input" value="{{form.opponentName}}" data-key="opponentName" bindinput="onInput" />
</view>
<view>
  <view class="label">对手手牌</view>
  <input class="input" value="{{form.showdown}}" data-key="showdown" bindinput="onInput" />
</view>
<view class="label">Hero 疑问点</view>
<textarea class="textarea analysis-textarea hero-question-textarea" value="{{form.heroQuestion}}" data-key="heroQuestion" bindinput="onInput"></textarea>
```

For read-only mode, render `detailRows` with `{{item.displayValue}}` so empty fields show `-`.

- [ ] **Step 6: Update save payload**

In `saveDetail()`, include:

```js
playerCount: this.data.form.playerCount,
hasStraddle: this.data.form.hasStraddle,
opponentName: this.data.form.opponentName,
heroQuestion: this.data.form.heroQuestion,
detailBackfilled: true,
```

- [ ] **Step 7: Run hand-detail tests**

Run:

```powershell
node tests\hand-detail-unified-edit.test.js
node tests\card-picker-size.test.js
node tests\review-swipe-actions.test.js
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```powershell
git add pages\hand-detail\hand-detail.js pages\hand-detail\hand-detail.wxml tests\hand-detail-unified-edit.test.js
git commit -m "feat: align hand detail edit fields"
```

---

### Task 6: AI Payload and Prompt Contract

**Files:**
- Modify: `pages/review-list/review-list.js`
- Modify: `cloudfunctions/poker_review/index.js`
- Modify: `utils/ai-normalizer.js`
- Test: `tests/poker-review-canonical-fields.test.js`

- [ ] **Step 1: Write the failing AI contract test**

Create `tests/poker-review-canonical-fields.test.js`:

```js
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const root = path.resolve(__dirname, '..')
const reviewJs = fs.readFileSync(path.join(root, 'pages/review-list/review-list.js'), 'utf8')
const cloud = fs.readFileSync(path.join(root, 'cloudfunctions/poker_review/index.js'), 'utf8')
const normalizer = fs.readFileSync(path.join(root, 'utils/ai-normalizer.js'), 'utf8')

test('review request sends straddle and hero question fields', () => {
  assert.ok(reviewJs.includes('hasStraddle'))
  assert.ok(reviewJs.includes('straddleAmount'))
  assert.ok(reviewJs.includes('heroQuestion'))
})

test('cloud prompt asks AI to answer Hero question and preserve showdown', () => {
  assert.ok(cloud.includes('heroQuestion'))
  assert.ok(cloud.includes('hasStraddle'))
  assert.ok(cloud.includes('straddleAmount'))
  assert.ok(cloud.includes('优先回答 Hero 疑问点'))
  assert.ok(cloud.includes('showdown'))
})

test('normalizer preserves hero question and straddle fields', () => {
  assert.ok(normalizer.includes('heroQuestion'))
  assert.ok(normalizer.includes('hasStraddle'))
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
node tests\poker-review-canonical-fields.test.js
```

Expected: FAIL because the AI payload does not fully include the new fields yet.

- [ ] **Step 3: Update review request builder**

In `pages/review-list/review-list.js`, inside `buildReviewRequest(detailHand, detailSession, detailActions, voiceNote, options)`, compute:

```js
const bigBlind = handDetailFields.getBigBlindFromLevel(
  detailHand && detailHand.stakeLevel,
  detailSession
)
const hasStraddle = !!(detailHand && detailHand.hasStraddle)
const straddleAmount = hasStraddle ? bigBlind * 2 : 0
```

Add these fields to the `hand` payload:

```js
hasStraddle,
straddleAmount,
heroQuestion: (detailHand && detailHand.heroQuestion) || '',
opponentName: (detailHand && detailHand.opponentName) || '',
showdown: (detailHand && detailHand.showdown) || '',
```

- [ ] **Step 4: Update cloud function schema and prompts**

In `cloudfunctions/poker_review/index.js`, extend extraction/advice JSON examples and schema with:

```js
hasStraddle: { type: 'boolean' },
straddleAmount: { type: 'number' },
heroQuestion: { type: 'string' },
opponentName: { type: 'string' },
```

Add a prompt sentence in the advice prompt construction:

```js
'如果 heroQuestion 不为空，优先回答 Hero 疑问点，并明确说明建议针对这个问题。'
```

Add straddle context lines near the hand summary:

```js
`hasStraddle: ${!!hand.hasStraddle}`,
`straddleAmount: ${hand.straddleAmount || 0}`,
`heroQuestion: ${hand.heroQuestion || '-'}`,
```

- [ ] **Step 5: Preserve fields in normalizer**

In `utils/ai-normalizer.js`, preserve these fields in the normalized hand object:

```js
hand.hasStraddle = !!hand.hasStraddle
hand.heroQuestion = String(hand.heroQuestion || '').trim()
```

Do not infer `hasStraddle` from the word `straddle` unless the extraction explicitly sets it or the user-confirmed form has it checked.

- [ ] **Step 6: Run AI contract tests**

Run:

```powershell
node tests\poker-review-canonical-fields.test.js
node tests\poker-agent-two-stage.test.js
node tests\poker-review-provider-config.test.js
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```powershell
git add pages\review-list\review-list.js cloudfunctions\poker_review\index.js utils\ai-normalizer.js tests\poker-review-canonical-fields.test.js
git commit -m "feat: pass canonical detail fields to poker review"
```

---

### Task 7: Final Verification

**Files:**
- Modify if needed: any tests whose static assertions intentionally changed.

- [ ] **Step 1: Run the focused test suite**

Run:

```powershell
node tests\hand-detail-fields.test.js
node tests\hand-detail-persistence.test.js
node tests\quick-entry-unified-fields.test.js
node tests\review-unified-detail-state.test.js
node tests\hand-detail-unified-edit.test.js
node tests\poker-review-canonical-fields.test.js
```

Expected: all PASS.

- [ ] **Step 2: Run existing regression tests related to this flow**

Run:

```powershell
node tests\review-missing-field-ux.test.js
node tests\review-voice-panel-state.test.js
node tests\review-detail-order.test.js
node tests\review-agent-advice.test.js
node tests\review-swipe-actions.test.js
node tests\card-picker-size.test.js
node tests\compact-action-line.test.js
node tests\voice-parser.test.js
```

Expected: all PASS.

- [ ] **Step 3: Inspect git diff for unrelated changes**

Run:

```powershell
git status --short
git diff -- pages\hand-record pages\review-list pages\hand-detail utils services cloudfunctions tests
```

Expected: changes are limited to the files in this plan and existing unrelated dirty files remain untouched.

- [ ] **Step 4: Commit final test adjustments if any**

If Step 2 required test-only updates, commit them:

```powershell
git add tests
git commit -m "test: update review detail unified field coverage"
```

If no additional changes are needed, do not create an empty commit.

---

## Self-Review

Spec coverage:

- Unified fields across quick entry, AI confirmation, read-only detail, and edit detail are covered by Tasks 1, 3, 4, and 5.
- Straddle checkbox, STR gating, fixed `bigBlind * 2`, and unchanged BB statistics are covered by Tasks 1, 3, 5, and 6.
- Opponent hand/showdown and Hero question are covered by Tasks 2 through 6.
- AI confirmation not duplicating read-only detail and collapsing after backfill is covered by Task 4.
- Empty read-only fields showing `-` after backfill is covered by Tasks 1, 4, and 5.
- AI payload improvements are covered by Task 6.

Placeholder scan:

- No task contains open-ended placeholders. Every code step names exact files, functions, snippets, and commands.

Type consistency:

- The canonical field names are `hasStraddle`, `heroQuestion`, `opponentName`, `showdown`, and `detailBackfilled`.
- `showdown` remains the persisted opponent hand/showdown field; no separate user-facing required `villainCards` field is introduced.
- Straddle helper names are `getBigBlindFromLevel`, `getStraddleAmount`, and `getPositionOptions`.
