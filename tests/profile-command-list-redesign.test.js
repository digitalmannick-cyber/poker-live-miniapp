const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const wxml = fs.readFileSync(path.join(root, 'pages/profile/profile.wxml'), 'utf8')
const wxss = fs.readFileSync(path.join(root, 'pages/profile/profile.wxss'), 'utf8')
const js = fs.readFileSync(path.join(root, 'pages/profile/profile.js'), 'utf8')

function indexOfOrFail(text, label) {
  const index = wxml.indexOf(text)
  assert.ok(index >= 0, `${label} should exist`)
  return index
}

test('logged-in profile follows the approved command-list order', () => {
  const player = indexOfOrFail('class="profile-hero"', 'player hero')
  const preferences = indexOfOrFail('>偏好设置</view>', 'preferences')
  const data = indexOfOrFail('>数据管理</view>', 'data management')
  const ai = indexOfOrFail('>AI 自动提醒</view>', 'AI reminder')
  const help = indexOfOrFail('>帮助与反馈</view>', 'help and feedback')
  const account = indexOfOrFail('>账号与安全</view>', 'account and security')

  assert.ok(player < preferences)
  assert.ok(preferences < data)
  assert.ok(data < ai)
  assert.ok(ai < help)
  assert.ok(help < account)
})

test('help owns feedback onboarding and the merged release entry', () => {
  const helpStart = indexOfOrFail('>帮助与反馈</view>', 'help and feedback')
  const accountStart = indexOfOrFail('>账号与安全</view>', 'account and security')
  const helpMarkup = wxml.slice(helpStart, accountStart)

  assert.match(helpMarkup, /open-type="contact"/)
  assert.match(helpMarkup, /restartOnboardingGuide/)
  assert.match(helpMarkup, />关于与版本更新/)
  assert.match(helpMarkup, /bindtap="openReleaseNotes"/)
  assert.doesNotMatch(helpMarkup, />版本更新</)
  assert.doesNotMatch(helpMarkup, />关于</)
  assert.doesNotMatch(wxml.slice(accountStart), /restartOnboardingGuide/)
  assert.doesNotMatch(wxml, /bindtap="showAbout"/)
  assert.doesNotMatch(js, /showAbout\(\)/)
})

test('logout is the final actionable profile content', () => {
  const accountStart = indexOfOrFail('>账号与安全</view>', 'account and security')
  const logout = indexOfOrFail('bindtap="logoutAccount"', 'logout')
  const footer = indexOfOrFail('class="profile-footer"', 'profile footer')

  assert.ok(accountStart < logout)
  assert.ok(logout < footer)
  assert.doesNotMatch(wxml.slice(logout + 1, footer), /bindtap=|catchtap=|open-type=/)
})
