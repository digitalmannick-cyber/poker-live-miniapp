const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')
const actionLine = require('../utils/action-line')

const root = path.resolve(__dirname, '..')
const files = {
  quick: fs.readFileSync(path.join(root, 'pages/hand-record/hand-record.wxml'), 'utf8'),
  review: fs.readFileSync(path.join(root, 'pages/review-list/review-list.wxml'), 'utf8'),
  detail: fs.readFileSync(path.join(root, 'pages/hand-detail/hand-detail.wxml'), 'utf8')
}
const appWxss = fs.readFileSync(path.join(root, 'app.wxss'), 'utf8')

const orderedLabels = [
  '日期',
  '级别',
  '人数',
  '是否 Straddle',
  'Hero 位置',
  '对手位置',
  '对手类型',
  '有效筹码',
  '当前底池',
  '本手输赢',
  '对手昵称',
  '对手手牌'
]

function assertOrderedLabels(name, source) {
  let cursor = -1
  orderedLabels.forEach(label => {
    const index = source.indexOf(label, cursor + 1)
    assert.notEqual(index, -1, `${name} missing ${label}`)
    assert.ok(index > cursor, `${name} should render ${label} after previous canonical field`)
    cursor = index
  })
}

test('quick entry, review confirmation, and detail edit share canonical field layout', () => {
  Object.entries(files).forEach(([name, source]) => {
    assert.ok(source.includes('unified-field-grid'), `${name} should use unified field grid`)
    assert.ok(source.includes('unified-field-card'), `${name} should use unified field cards`)
    assertOrderedLabels(name, source)
  })
})

test('straddle is rendered as checkbox and opponent hand uses card picker surfaces', () => {
  Object.entries(files).forEach(([name, source]) => {
    assert.equal(source.includes('<switch checked="{{'), false, `${name} should not use switch for Straddle`)
    assert.ok(source.includes('<checkbox'), `${name} should use checkbox for Straddle`)
  })

  assert.ok(files.quick.includes('bindtap="openShowdownPicker"'))
  assert.ok(files.review.includes('bindtap="openVoiceShowdownPicker"'))
  assert.ok(files.detail.includes('bindtap="openShowdownPicker"'))
  assert.equal(files.quick.includes('data-key="showdown"'), false)
  assert.equal(files.review.includes('data-field="showdown"'), false)
  assert.equal(files.detail.includes('data-key="showdown"'), false)
})

test('editable unified inputs override global rounded input chrome', () => {
  assert.ok(appWxss.includes('.input.unified-field-value'))
  assert.match(appWxss, /\.input\.unified-field-value,[\s\S]*?border-radius:\s*0;/)
  assert.match(appWxss, /\.input\.unified-field-value,[\s\S]*?border-bottom:\s*2rpx solid rgba\(0, 209, 255, 0\.30\);/)
})

test('quick entry and detail edit use the screenshot edit detail sequence', () => {
  ;['quick', 'detail'].forEach(name => {
    const source = files[name]
    const main = source.indexOf('edit-detail-main')
    const analysis = source.indexOf('edit-detail-analysis')
    const streets = source.indexOf('edit-detail-streets')
    assert.ok(main > -1, `${name} should render the main editable detail panel`)
    assert.ok(analysis > main, `${name} should render analysis after main fields`)
    assert.ok(streets > analysis || appWxss.includes('.edit-detail-streets'), `${name} should place streets after analysis by layout order`)
    assert.ok(source.includes('edit-hero-trigger') || source.includes('bindtap="openHeroPicker"'), `${name} should show Hero hand in the edit detail surface`)
    assert.ok(source.includes('edit-detail-section-label'), `${name} should show the street recognition label`)
    assert.ok(source.includes('edit-tag-chip'), `${name} should render fixed tag chips`)
  })
  assert.ok(appWxss.includes('.edit-detail-main'))
  assert.ok(appWxss.includes('.edit-detail-analysis'))
  assert.ok(appWxss.includes('.edit-detail-streets'))
})

test('detail entry surfaces use full street labels and blank empty hints', () => {
  Object.entries(files).forEach(([name, source]) => {
    assert.equal(source.includes('例如'), false, `${name} should not show example placeholders`)
    assert.equal(source.includes('点选修改'), false, `${name} should not show the card edit badge text`)
  })

  assert.equal(actionLine.formatStreetLine('preflop', 'HJ open 2.5, Hero call', ''), '翻前: HJ R2.5, Hero C')
  assert.equal(actionLine.formatStreetLine('flop', 'HJ bet 33%, Hero call', 'Qs8d4c'), '翻牌 Q♠8♦4♣: HJ B33%, Hero C')
  assert.equal(actionLine.formatStreetLine('turn', 'Hero check', 'Kh'), '转牌 K♥: Hero X')
  assert.equal(actionLine.formatStreetLine('river', 'Hero check', '2c'), '河牌 2♣: Hero X')
})
