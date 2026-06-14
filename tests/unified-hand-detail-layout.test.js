const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

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
