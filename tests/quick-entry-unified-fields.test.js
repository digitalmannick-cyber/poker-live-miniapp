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
