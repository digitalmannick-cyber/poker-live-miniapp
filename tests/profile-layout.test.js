const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const wxml = fs.readFileSync(path.join(__dirname, '..', 'pages', 'profile', 'profile.wxml'), 'utf8')
const js = fs.readFileSync(path.join(__dirname, '..', 'pages', 'profile', 'profile.js'), 'utf8')

function sectionMarkup(title) {
  const marker = `<view wx:if="{{!accountLoggedOut}}" class="section-label">${title}</view>`
  const fallbackMarker = `<view class="section-label">${title}</view>`
  const start = wxml.indexOf(marker) >= 0 ? wxml.indexOf(marker) : wxml.indexOf(fallbackMarker)
  if (start < 0) return ''
  const next = wxml.indexOf('<view class="section-label"', start + 1)
  const nextLoggedIn = wxml.indexOf('<view wx:if="{{!accountLoggedOut}}" class="section-label"', start + 1)
  const candidates = [next, nextLoggedIn].filter(index => index > start)
  const end = candidates.length ? Math.min(...candidates) : wxml.length
  return wxml.slice(start, end)
}

test('profile page does not expose position preset editing', () => {
  assert.doesNotMatch(wxml, /位置预设/)
  assert.doesNotMatch(wxml, /editPositions/)
  assert.doesNotMatch(wxml, /settings\.positions/)
})

test('AI auto reminder is its own profile module', () => {
  const preferences = sectionMarkup('偏好设置')
  const aiReminder = sectionMarkup('AI 自动提醒')

  assert.ok(aiReminder, 'AI 自动提醒 should have its own section label')
  assert.match(aiReminder, /openAiReminderEditor/)
  assert.match(aiReminder, /toggleAiReminderMasterSwitch/)
  assert.doesNotMatch(preferences, /AI 自动提醒/)
})

test('onboarding guide is inside account and data module', () => {
  const preferences = sectionMarkup('偏好设置')
  const account = sectionMarkup('账号与数据')

  assert.doesNotMatch(preferences, /新手引导/)
  assert.match(account, /新手引导/)
  assert.match(account, /restartOnboardingGuide/)
})

test('PBT player import lives in profile data management', () => {
  const dataManagement = sectionMarkup('数据管理')
  const playerNotes = fs.readFileSync(path.join(__dirname, '..', 'pages', 'player-notes', 'player-notes.wxml'), 'utf8')

  assert.ok(dataManagement, '数据管理 section should exist')
  assert.match(dataManagement, /导入玩家数据/)
  assert.match(dataManagement, /支持PBT玩家数据导入，请选择csv文件/)
  assert.match(dataManagement, /importPbtPlayerData/)
  assert.doesNotMatch(playerNotes, />CSV</)
  assert.doesNotMatch(playerNotes, /importPbtNotes/)
})

test('PBT bankroll import replaces clipboard session import entry', () => {
  const dataManagement = sectionMarkup('数据管理')

  assert.match(dataManagement, /导入牌局数据/)
  assert.match(dataManagement, /支持PBT牌局数据导入，请选择csv文件/)
  assert.match(dataManagement, /importPbtBankrollData/)
  assert.doesNotMatch(dataManagement, /从剪贴板导入备份 JSON/)
})

test('PBT CSV imports ask for source before opening WeChat message picker', () => {
  assert.match(js, /choosePbtCsvImportSource/)
  assert.match(js, /wx\.showActionSheet/)
  assert.match(js, /从剪贴板导入CSV/)
  assert.match(js, /从微信聊天选择CSV/)
  assert.match(js, /微信小程序只能从微信聊天或文件传输助手选择文件/)
  assert.match(js, /importPbtBankrollData\(\) \{\s*this\.choosePbtCsvImportSource\('bankroll'\)/)
  assert.match(js, /importPbtPlayerData\(\) \{[\s\S]*this\.choosePbtCsvImportSource\('player'\)/)
})

test('profile page hides test account switching entries', () => {
  assert.doesNotMatch(wxml, /switchToTestAccount/)
  assert.doesNotMatch(wxml, /exitTestAccount/)
})

test('profile cumulative hours first paint uses a trusted snapshot instead of a temporary number', () => {
  assert.match(js, /const initialProfileStats = dataService\.getProfileStatsSnapshot\(\)/)
  assert.match(js, /titleStatsReady:\s*!!initialProfileStats/)
  assert.match(js, /titleProgress:\s*playerTitle\.resolvePlayerTitle\(initialProfileStats[^)]*totalHours/)
  assert.doesNotMatch(js, /titleProgress:\s*playerTitle\.resolvePlayerTitle\(0\)/)
  assert.doesNotMatch(js, /getProfilePageData\(\{\s*preferCache:\s*true,\s*fastLocal:\s*true\s*\}\)/)
  assert.match(wxml, /wx:if="\{\{titleStatsReady\}\}" class="profile-title-hours"/)
  assert.match(wxml, /profile-title-hours-skeleton/)
})
