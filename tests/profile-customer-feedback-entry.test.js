const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const wxml = fs.readFileSync(path.join(root, 'pages/profile/profile.wxml'), 'utf8')
const wxss = fs.readFileSync(path.join(root, 'pages/profile/profile.wxss'), 'utf8')
const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))

function helpAndFeedbackMarkup() {
  const marker = '<view wx:if="{{!accountLoggedOut}}" class="section-label profile-command-label">帮助与反馈</view>'
  const start = wxml.indexOf(marker)
  if (start < 0) return ''
  const nextSection = wxml.indexOf('class="section-label profile-command-label"', start + marker.length)
  return wxml.slice(start, nextSection < 0 ? wxml.length : nextSection)
}

function cssBlock(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = wxss.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))
  assert.ok(match, `${selector} should exist`)
  return match[1]
}

test('logged-in profile users can open native customer feedback chat', () => {
  const markup = helpAndFeedbackMarkup()

  assert.ok(markup, '帮助与反馈 should have its own logged-in-only section')
  assert.match(markup, /class="profile-command-list"/)
  assert.match(markup, /<view class="setting-row customer-feedback-row">/)
  assert.match(markup, /<button class="customer-feedback-button" open-type="contact"/)
  assert.match(markup, />反馈与建议<\/view>/)
  assert.match(markup, />反馈问题、Bug 或功能建议<\/view>/)
})

test('native customer feedback overlays a standard full-width command row', () => {
  const markup = helpAndFeedbackMarkup()
  const button = cssBlock('.customer-feedback-button')
  const row = cssBlock('.setting-row')
  const commandRow = cssBlock('.profile-command-page .profile-command-list .setting-row')

  assert.match(markup, /<view class="setting-row customer-feedback-row">[\s\S]*?<view class="setting-arrow">›<\/view>[\s\S]*?<button class="customer-feedback-button" open-type="contact"/)
  assert.match(button, /position:\s*absolute/)
  assert.match(button, /inset:\s*0/)
  assert.match(button, /width:\s*100%/)
  assert.match(button, /height:\s*100%/)
  assert.match(button, /padding:\s*0/)
  assert.match(button, /border:\s*0/)
  assert.match(button, /background:\s*transparent/)
  assert.match(button, /opacity:\s*0/)
  assert.match(button, /z-index:\s*2/)
  assert.doesNotMatch(button, /display:\s*flex/)
  assert.match(row, /display:\s*flex/)
  assert.match(row, /justify-content:\s*space-between/)
  assert.match(commandRow, /border-bottom:\s*1rpx solid var\(--profile-line\)/)
  assert.match(cssBlock('.setting-arrow'), /flex-shrink:\s*0/)
  assert.match(wxss, /\.customer-feedback-button::after\s*\{[\s\S]*?border:\s*none;/)
})

test('customer feedback description stays on one line at narrow phone widths', () => {
  const markup = helpAndFeedbackMarkup()
  const description = cssBlock('.profile-command-page .customer-feedback-desc')

  assert.match(markup, /class="small muted customer-feedback-desc">反馈问题、Bug 或功能建议<\/view>/)
  assert.match(description, /white-space:\s*nowrap/)
  assert.match(description, /font-size:\s*23rpx/)
})

test('native customer feedback does not add a standalone page route', () => {
  assert.equal(appConfig.pages.some(page => /feedback/i.test(page)), false)
})
