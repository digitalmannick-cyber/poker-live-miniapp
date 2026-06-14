const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const wxml = fs.readFileSync(path.join(root, 'pages/profile/profile.wxml'), 'utf8')
const wxss = fs.readFileSync(path.join(root, 'pages/profile/profile.wxss'), 'utf8')
const js = fs.readFileSync(path.join(root, 'pages/profile/profile.js'), 'utf8')

const dialogStart = wxml.indexOf('wechatProfileDialogVisible')
assert.ok(dialogStart > -1, 'sync dialog should exist')
const dialogMarkup = wxml.slice(dialogStart, wxml.indexOf('settingsEditorVisible'))

assert.ok(
  !dialogMarkup.includes('open-type="chooseAvatar"') && !dialogMarkup.includes('type="nickname"'),
  'first sync dialog should not embed native avatar or nickname controls in custom layout'
)

assert.ok(
  dialogMarkup.includes('bindtap="syncWechatProfileByFramework"'),
  'first sync should be triggered by a normal framework sync action'
)

assert.ok(
  js.includes('wx.getUserProfile'),
  'framework sync should use wx.getUserProfile for one-time WeChat profile sync'
)

assert.ok(
  !/profile-editor-avatar[\s\S]*open-type="chooseAvatar"/.test(wxml),
  'manual profile editor should not use WeChat avatar native control'
)

assert.ok(
  wxml.includes('bindtap="chooseLocalAvatar"'),
  'manual profile editor should choose avatar from local album or camera'
)

assert.ok(
  /\.wechat-sync-preview\s*\{[\s\S]*grid-template-columns:\s*112rpx\s+minmax\(0,\s*1fr\);/.test(wxss),
  'profile preview should keep avatar and name in a compact stable grid'
)

assert.ok(
  /\.wechat-profile-actions\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*1fr\);/.test(wxss),
  'sync dialog actions should use two stable equal columns'
)

console.log('profile wechat dialog tests passed')
