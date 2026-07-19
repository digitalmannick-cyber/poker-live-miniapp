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

function cssBlock(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = wxss.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))
  assert.ok(match, `${selector} should exist`)
  return match[1]
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
      `\\s*<view class="profile-command-list(?: [^"]*)?">`
    )
    assert.match(wxml, modulePattern, `${title} should keep a guarded label, section, and command list`)
  }

  assert.equal((wxml.match(/class="section-label profile-command-label"/g) || []).length, 5)
  assert.equal((wxml.match(/class="profile-command-section(?: [^"]*)?"/g) || []).length, 5)
  assert.equal((wxml.match(/class="profile-command-list(?: [^"]*)?"/g) || []).length, 5)
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

test('logged-out profile keeps one login hero and one release utility without logged-in commands', () => {
  assert.match(wxml, /<view wx:if="\{\{accountLoggedOut\}\}" class="profile-login-hero" bindtap="loginWithWechatAccount">/)
  assert.equal((wxml.match(/bindtap="loginWithWechatAccount"/g) || []).length, 1)
  assert.equal((wxml.match(/wx:if="\{\{accountLoggedOut\}\}" class="profile-login-hero"/g) || []).length, 1)
  assert.equal((wxml.match(/wx:if="\{\{accountLoggedOut\}\}" class="profile-logged-out-utility"/g) || []).length, 1)
  assert.equal((wxml.match(/class="profile-logged-out-utility-row"/g) || []).length, 1)

  const utilityMarkup = wxml.match(
    /<view wx:if="\{\{accountLoggedOut\}\}" class="profile-logged-out-utility">[\s\S]*?<view class="profile-logged-out-utility-row" bindtap="openReleaseNotes">[\s\S]*?<view class="profile-logged-out-utility-title">关于与版本更新<\/view>[\s\S]*?<view class="profile-logged-out-utility-desc">当前版本 \{\{version\}\} · 查看更新内容<\/view>[\s\S]*?<\/view>[\s\S]*?<\/view>/
  )

  assert.ok(utilityMarkup, 'logged-out release utility should exist')
  assert.doesNotMatch(utilityMarkup[0], /open-type="contact"|restartOnboardingGuide|selectChipUnit|importPbt|openAiReminderEditor|copyPlayerId|clearData|logoutAccount/)
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

  assert.match(cssBlock('.profile-command-page'), /padding-bottom:\s*calc\(190rpx \+ env\(safe-area-inset-bottom\)\)/)
  assert.match(cssBlock('.profile-command-page .profile-hero'), /clip-path:\s*polygon\(0 0, 100% 0, 96% 90%, 5% 100%\)/)
  assert.match(cssBlock('.profile-command-page .profile-command-label'), /clip-path:\s*polygon\(0 0, 100% 0, 92% 100%, 6% 88%\)/)
  assert.match(cssBlock('.profile-command-page .profile-command-list .setting-row'), /min-height:\s*88rpx/)
  assert.match(cssBlock('.profile-command-page .profile-logout-action'), /min-height:\s*88rpx/)
  assert.match(cssBlock('.profile-command-page .segment-hit'), /min-height:\s*88rpx/)
  assert.match(cssBlock('.profile-command-page .segment-item'), /min-height:\s*60rpx/)
  assert.match(cssBlock('.profile-command-page .profile-action-hit'), /min-height:\s*88rpx/)
  assert.match(cssBlock('.profile-command-page .profile-action.compact'), /min-height:\s*56rpx/)
  assert.match(cssBlock('.profile-command-page .profile-logged-out-utility-row'), /min-height:\s*88rpx/)
})

test('preference controls separate compact visuals from 88rpx hit targets', () => {
  const segmentHits = wxml.match(
    /<view class="segment-hit" data-value="(?:BB|CNY|HKD|USD)" bindtap="selectChipUnit">\s*<view class="segment-item \{\{settings\.chipUnit === '[A-Z]+' \? 'active' : ''\}\}">(?:BB|¥|HK\$|\$)<\/view>\s*<\/view>/g
  ) || []
  const actionHits = wxml.match(
    /<view class="profile-action-hit" bindtap="(?:editVenues|editBlindPresets|editOpponentTypes)">\s*<view class="profile-action compact">编辑<\/view>\s*<\/view>/g
  ) || []

  assert.equal(segmentHits.length, 4)
  assert.equal(actionHits.length, 3)

  const segmentHit = cssBlock('.profile-command-page .segment-hit')
  const segmentVisual = cssBlock('.profile-command-page .segment-item')
  const actionHit = cssBlock('.profile-command-page .profile-action-hit')
  const actionVisual = cssBlock('.profile-command-page .profile-action.compact')

  assert.match(segmentHit, /min-height:\s*88rpx/)
  assert.match(segmentVisual, /height:\s*60rpx/)
  assert.match(segmentVisual, /min-height:\s*60rpx/)
  assert.doesNotMatch(segmentVisual, /min-height:\s*88rpx/)
  assert.match(actionHit, /min-width:\s*88rpx/)
  assert.match(actionHit, /min-height:\s*88rpx/)
  assert.match(actionVisual, /height:\s*56rpx/)
  assert.match(actionVisual, /min-height:\s*56rpx/)
  assert.doesNotMatch(actionVisual, /min-height:\s*88rpx/)
})

test('all command-list arrows use one chevron and a stable loading glyph', () => {
  assert.match(wxml, /<view class="setting-arrow">\{\{importingPbtPlayerData \? '…' : '›'\}\}<\/view>/)
  assert.equal((wxml.match(/<view class="setting-arrow">›<\/view>/g) || []).length, 7)
  assert.doesNotMatch(wxml, /<view class="setting-arrow">><\/view>/)
  assert.doesNotMatch(wxml, /importingPbtPlayerData \? '\.\.\.' : '>'/)

  const arrow = cssBlock('.setting-arrow')
  assert.match(arrow, /width:\s*44rpx/)
  assert.match(arrow, /height:\s*44rpx/)
  assert.match(arrow, /display:\s*inline-flex/)
  assert.match(arrow, /align-items:\s*center/)
  assert.match(arrow, /justify-content:\s*center/)
})

test('hero stats use layered wine surfaces instead of black command panels', () => {
  const shared = cssBlock('.profile-command-page .profile-hero-chip')
  const hands = cssBlock('.profile-command-page .profile-hero-chip-hands')
  const profit = cssBlock('.profile-command-page .profile-hero-chip-profit')

  assert.doesNotMatch(shared, /var\(--profile-panel\)/)
  assert.match(shared, /border-left:\s*6rpx solid rgba\(255, 255, 255, 0\.22\)/)
  assert.match(hands, /linear-gradient\(135deg, rgba\(112, 20, 38, 0\.88\), rgba\(72, 8, 24, 0\.84\)\)/)
  assert.match(profit, /linear-gradient\(135deg, rgba\(82, 14, 42, 0\.88\), rgba\(52, 7, 28, 0\.84\)\)/)
  assert.doesNotMatch(hands, /#(?:000|000000)|rgba\(0,\s*0,\s*0/)
  assert.doesNotMatch(profit, /#(?:000|000000)|rgba\(0,\s*0,\s*0/)
})

test('preference blocks use command-row dots and a shared content inset', () => {
  const preferences = commandModuleMarkup('偏好设置')
  const block = cssBlock('.profile-command-page .profile-preference-list .setting-block')
  const dot = cssBlock('.profile-command-page .profile-preference-list .setting-block::before')

  assert.match(preferences, /class="profile-command-list profile-preference-list"/)
  assert.equal((preferences.match(/class="setting-block"/g) || []).length, 4)
  assert.match(block, /padding:\s*20rpx 0 20rpx 54rpx/)
  assert.match(dot, /content:\s*''/)
  assert.match(dot, /position:\s*absolute/)
  assert.match(dot, /left:\s*22rpx/)
  assert.match(dot, /top:\s*50%/)
  assert.match(dot, /transform:\s*translateY\(-50%\)/)
  assert.match(dot, /width:\s*10rpx/)
  assert.match(dot, /height:\s*10rpx/)
  assert.match(dot, /border-radius:\s*50%/)
  assert.match(dot, /background:\s*rgba\(255,\s*255,\s*255,\s*0\.22\)/)
  assert.match(dot, /box-shadow:\s*0 0 0 8rpx rgba\(255,\s*255,\s*255,\s*0\.03\)/)
  assert.match(cssBlock('.setting-block'), /border-bottom:\s*1rpx solid rgba\(255,255,255,0\.08\)/)
  assert.match(cssBlock('.profile-command-page .profile-action-hit'), /min-height:\s*88rpx/)
})
