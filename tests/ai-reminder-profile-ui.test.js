const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const wxss = fs.readFileSync(path.join(__dirname, '..', 'pages', 'profile', 'profile.wxss'), 'utf8')
const wxml = fs.readFileSync(path.join(__dirname, '..', 'pages', 'profile', 'profile.wxml'), 'utf8')

function cssBlock(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = wxss.match(new RegExp(escaped + '\\s*\\{([\\s\\S]*?)\\}', 'm'))
  return match ? match[1] : ''
}

function lastCssBlock(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = [...wxss.matchAll(new RegExp(escaped + '\\s*\\{([\\s\\S]*?)\\}', 'gm'))]
  return matches.length ? matches[matches.length - 1][1] : ''
}

test('AI reminder amount input is wide enough for six digit values', () => {
  const wrap = cssBlock('.ai-reminder-input-wrap')
  const input = cssBlock('.ai-reminder-input')

  assert.match(wrap, /width:\s*(2[2-9]\d|[3-9]\d{2})rpx/)
  assert.match(input, /width:\s*(1[5-9]\d|[2-9]\d{2})rpx/)
})

test('AI reminder sheet keeps save actions visible above the bottom nav', () => {
  const actions = cssBlock('.ai-reminder-sheet-actions')
  const mask = lastCssBlock('.ai-reminder-mask')

  assert.match(actions, /position:\s*sticky/)
  assert.match(actions, /bottom:\s*0/)
  assert.doesNotMatch(mask, /padding:\s*0\s*;/)
  assert.match(mask, /padding:\s*0\s+(?:0|\d+rpx)\s+calc\(\s*(1[6-9]\d|2\d{2})rpx\s*\+\s*env\(safe-area-inset-bottom\)\s*\)/)
})

test('AI reminder sheet keeps save action in the bottom footer, not in the header', () => {
  const headStart = wxml.indexOf('class="ai-reminder-sheet-head"')
  const scrollStart = wxml.indexOf('class="ai-reminder-sheet-scroll"')
  const actionsStart = wxml.indexOf('class="settings-editor-actions ai-reminder-sheet-actions"')
  const headMarkup = wxml.slice(headStart, scrollStart)
  const footerMarkup = wxml.slice(actionsStart)

  assert.ok(headStart >= 0)
  assert.ok(scrollStart > headStart)
  assert.ok(actionsStart > scrollStart)
  assert.doesNotMatch(headMarkup, /bindtap="saveAiReminderSettings"/)
  assert.match(footerMarkup, /bindtap="saveAiReminderSettings"[\s\S]*>保存</)
})
