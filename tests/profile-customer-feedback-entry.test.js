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

test('logged-in profile users can open native customer feedback chat', () => {
  const markup = helpAndFeedbackMarkup()

  assert.ok(markup, '帮助与反馈 should have its own logged-in-only section')
  assert.match(markup, /class="profile-command-list"/)
  assert.match(markup, /<button class="setting-row customer-feedback-button" open-type="contact"/)
  assert.match(markup, />反馈与建议<\/view>/)
  assert.match(markup, />反馈问题、Bug 或功能建议<\/view>/)
})

test('native customer feedback button removes WeChat default button chrome', () => {
  assert.match(wxss, /\.customer-feedback-button\s*\{[\s\S]*?width:\s*100%;[\s\S]*?margin:\s*0;[\s\S]*?padding:\s*18rpx 4rpx;[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;/)
  assert.match(wxss, /\.customer-feedback-button::after\s*\{[\s\S]*?border:\s*none;/)
})

test('native customer feedback does not add a standalone page route', () => {
  assert.equal(appConfig.pages.some(page => /feedback/i.test(page)), false)
})
