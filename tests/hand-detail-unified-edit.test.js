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
