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

test('straddle toggle filters STR out of position selectors when unchecked', () => {
  const toggleStart = js.indexOf('setStraddleValue(hasStraddle)')
  const toggleEnd = js.indexOf('noop() {}', toggleStart)
  const toggleBody = toggleStart >= 0 && toggleEnd > toggleStart ? js.slice(toggleStart, toggleEnd) : ''

  assert.ok(js.includes('onStraddleCheckboxChange(e)'))
  assert.ok(js.includes('this.setStraddleValue(!this.data.form.hasStraddle)'))
  assert.ok(toggleBody.includes('handDetailFields.getPositionOptions(this.data.positions, hasStraddle)'))
  assert.ok(toggleBody.includes("this.data.form.heroPosition === 'STR'"))
  assert.ok(toggleBody.includes("this.data.form.villainPosition === 'STR'"))
  assert.ok(toggleBody.includes("patch['form.heroPosition'] = positionOptions[0] || ''"))
  assert.ok(toggleBody.includes("patch['form.villainPosition'] = positionOptions[positionOptions.length - 1] || ''"))
})

test('position selector methods use straddle-aware option lists', () => {
  const heroStart = js.indexOf('openPositionSelector()')
  const heroEnd = js.indexOf('openOpponentTypeSelector()', heroStart)
  const heroBody = heroStart >= 0 && heroEnd > heroStart ? js.slice(heroStart, heroEnd) : ''
  const villainStart = js.indexOf('openVillainPositionSelector()')
  const villainEnd = js.indexOf('openLevelSelector()', villainStart)
  const villainBody = villainStart >= 0 && villainEnd > villainStart ? js.slice(villainStart, villainEnd) : ''

  assert.ok(heroBody.includes('handDetailFields.getPositionOptions(this.data.positions, this.data.form.hasStraddle)'))
  assert.ok(heroBody.includes('selectorOptions: buildSelectorOptions(positionOptions, this.data.form.heroPosition)'))
  assert.ok(villainBody.includes('handDetailFields.getPositionOptions(this.data.positions, this.data.form.hasStraddle)'))
  assert.ok(villainBody.includes('selectorOptions: buildSelectorOptions(positionOptions, this.data.form.villainPosition)'))
})

test('expanded field controls are bound to the canonical form keys', () => {
  assert.ok(wxml.includes('bindchange="onStraddleCheckboxChange"'))
  assert.ok(wxml.includes('data-key="playerCount"'))
  assert.ok(wxml.includes('data-key="opponentName"'))
  assert.ok(wxml.includes('bindtap="openShowdownPicker"'))
  assert.ok(wxml.includes('data-key="heroQuestion"'))
  assert.ok(wxml.includes('maxlength="160"'))
})

test('opponent hand uses card picker instead of free text input', () => {
  assert.ok(js.includes('openShowdownPicker()'))
  assert.ok(js.includes('pickShowdownCard(e)'))
  assert.ok(js.includes('buildShowdownPickerDeck'))
  assert.equal(wxml.includes('data-key="showdown"'), false)
  assert.ok(wxml.includes('showdownPickerVisible'))
})

test('quick entry does not prefill hero or villain positions', () => {
  assert.equal(js.includes("positionOptions[0] || 'CO'"), false)
  assert.equal(js.includes("positionOptions[positionOptions.length - 1] || 'BB'"), false)
})
