const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const wxml = fs.readFileSync(path.join(root, 'pages/profile/profile.wxml'), 'utf8')
const js = fs.readFileSync(path.join(root, 'pages/profile/profile.js'), 'utf8')
const wxss = fs.readFileSync(path.join(root, 'pages/profile/profile.wxss'), 'utf8')

const commandModuleTitles = [
  '偏好设置',
  '数据管理',
  'AI 自动提醒',
  '帮助与反馈',
  '账号与安全'
]

function indexOfOrFail(text, label) {
  const index = wxml.indexOf(text)
  assert.ok(index >= 0, `${label} should exist`)
  return index
}

function commandModuleMarkup(title) {
  const marker = `<view wx:if="{{!accountLoggedOut}}" class="section-label profile-command-label">${title}</view>`
  const start = indexOfOrFail(marker, `${title} guarded label`)
  const nextStarts = commandModuleTitles
    .map(nextTitle => wxml.indexOf(
      `<view wx:if="{{!accountLoggedOut}}" class="section-label profile-command-label">${nextTitle}</view>`,
      start + marker.length
    ))
    .filter(index => index > start)
  const footer = indexOfOrFail('class="profile-footer"', 'profile footer')
  const end = nextStarts.length ? Math.min(...nextStarts) : footer
  return wxml.slice(start, end)
}

test('page scope and all six logged-in modules keep their visibility and command structure', () => {
  assert.match(wxml, /<view class="container profile-command-page">/)
  assert.match(wxml, /<view wx:else class="profile-hero">/)

  for (const title of commandModuleTitles) {
    const modulePattern = new RegExp(
      `<view wx:if="\\{\\{!accountLoggedOut\\}\\}" class="section-label profile-command-label">${title}</view>` +
      `\\s*<view wx:if="\\{\\{!accountLoggedOut\\}\\}" class="profile-command-section(?: [^"]*)?">` +
      `\\s*<view class="profile-command-list">`
    )
    assert.match(wxml, modulePattern, `${title} should keep a guarded label, section, and command list`)
  }

  assert.equal((wxml.match(/class="section-label profile-command-label"/g) || []).length, 5)
  assert.equal((wxml.match(/class="profile-command-section(?: [^"]*)?"/g) || []).length, 5)
  assert.equal((wxml.match(/class="profile-command-list"/g) || []).length, 5)
})

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
  const feedback = helpMarkup.indexOf('<view class="setting-title">反馈与建议</view>')
  const onboarding = helpMarkup.indexOf('<view class="setting-title">新手引导</view>')
  const release = helpMarkup.indexOf('<view class="setting-title">关于与版本更新</view>')

  assert.match(helpMarkup, /open-type="contact"/)
  assert.match(helpMarkup, /restartOnboardingGuide/)
  assert.match(helpMarkup, />关于与版本更新/)
  assert.match(helpMarkup, /bindtap="openReleaseNotes"/)
  assert.doesNotMatch(helpMarkup, />版本更新</)
  assert.doesNotMatch(helpMarkup, />关于</)
  assert.doesNotMatch(wxml.slice(accountStart), /restartOnboardingGuide/)
  assert.doesNotMatch(wxml, /bindtap="showAbout"/)
  assert.doesNotMatch(js, /showAbout\(\)/)
  assert.ok(feedback >= 0, 'feedback entry should exist')
  assert.ok(feedback < onboarding, 'feedback should precede onboarding')
  assert.ok(onboarding < release, 'onboarding should precede release notes')
})

test('logged-out profile keeps only the top login hero and no empty command modules', () => {
  assert.match(wxml, /<view wx:if="\{\{accountLoggedOut\}\}" class="profile-login-hero" bindtap="loginWithWechatAccount">/)
  assert.equal((wxml.match(/bindtap="loginWithWechatAccount"/g) || []).length, 1)
  assert.doesNotMatch(wxml, /class="setting-row" bindtap="loginWithWechatAccount"/)
  assert.doesNotMatch(wxml, /<view class="section-label profile-command-label">/)
  assert.doesNotMatch(wxml, /<view class="profile-command-section(?: [^"]*)?">/)
})

test('each command module retains its approved handlers', () => {
  const preferences = commandModuleMarkup('偏好设置')
  const data = commandModuleMarkup('数据管理')
  const ai = commandModuleMarkup('AI 自动提醒')
  const account = commandModuleMarkup('账号与安全')

  assert.match(preferences, /bindtap="selectChipUnit"/)
  assert.match(preferences, /bindtap="editVenues"/)
  assert.match(preferences, /bindtap="editBlindPresets"/)
  assert.match(preferences, /bindtap="editOpponentTypes"/)

  assert.match(data, /bindtap="importPbtPlayerData"/)
  assert.match(data, /bindtap="importPbtBankrollData"/)
  assert.match(data, /bindtap="exportBackup"/)

  assert.match(ai, /catchtap="openAiReminderEditor"/)
  assert.match(ai, /catchtap="toggleAiReminderMasterSwitch"/)

  assert.match(account, /bindtap="copyPlayerId"/)
  assert.match(account, /bindtap="clearData"/)
  assert.match(account, /bindtap="logoutAccount"/)
})

test('logout is the final actionable profile content', () => {
  const accountStart = indexOfOrFail('>账号与安全</view>', 'account and security')
  const logout = indexOfOrFail('bindtap="logoutAccount"', 'logout')
  const footer = indexOfOrFail('class="profile-footer"', 'profile footer')

  assert.ok(accountStart < logout)
  assert.ok(logout < footer)
  assert.doesNotMatch(wxml.slice(logout + 1, footer), /bindtap=|catchtap=|open-type=/)
})

test('command-list page exposes scoped P5 styling hooks', () => {
  assert.match(wxml, /class="container profile-command-page"/)
  assert.match(wxml, /profile-command-section/)
  assert.match(wxml, /profile-command-label/)
  assert.match(wxml, /profile-logout-action/)
  assert.match(wxss, /\.profile-command-page\s+\.profile-command-label/)
  assert.match(wxss, /\.profile-command-page\s+\.profile-command-list/)
  assert.match(wxss, /\.profile-command-page\s+\.profile-logout-action/)
  assert.match(wxss, /clip-path:\s*polygon/)
  assert.match(wxss, /min-height:\s*88rpx/)
  assert.match(wxss, /env\(safe-area-inset-bottom\)/)
})
