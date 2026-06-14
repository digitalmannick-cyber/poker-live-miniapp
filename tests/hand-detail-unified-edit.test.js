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

test('hand detail gates mutation form behind edit mode', () => {
  const editBlock = wxml.match(/<block wx:if="\{\{editMode\}\}">([\s\S]*)<\/block>\s*<view wx:if="\{\{boardPickerVisible\}\}"/)

  assert.ok(editBlock)
  assert.ok(editBlock[1].includes('data-key="playedDate"'))
  assert.ok(editBlock[1].includes('data-key="currentProfit"'))
  assert.ok(editBlock[1].includes('data-key="voiceNote"'))
  assert.ok(editBlock[1].includes('bindtap="saveDetail"'))
  assert.ok(editBlock[1].includes('bindtap="deleteHand"'))
})

test('hand detail readonly view renders canonical rows and street details', () => {
  assert.ok(wxml.includes('wx:if="{{!editMode}}"'))
  assert.ok(wxml.includes('wx:for="{{detailRows}}"'))
  assert.ok(wxml.includes('wx:for="{{detailStreetItems}}"'))
})

test('hand detail has one canonical showdown editor', () => {
  assert.equal((wxml.match(/data-key="showdown"/g) || []).length, 1)
})

test('hand detail refresh uses canonical boolean normalization', () => {
  assert.ok(!js.includes('hasStraddle: !!hand.hasStraddle'))
  assert.match(js, /hasStraddle:\s*handDetailFields\.normalizeBoolean\(hand\.hasStraddle\)/)
})

test('hand detail mutation handlers require edit mode', () => {
  assert.match(js, /async saveDetail\(\) \{[\s\S]*!this\.data\.editMode/)
  assert.match(js, /deleteHand\(\) \{[\s\S]*!this\.data\.editMode/)
})
