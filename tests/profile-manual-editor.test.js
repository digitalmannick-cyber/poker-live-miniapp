const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const wxml = fs.readFileSync(path.join(root, 'pages/profile/profile.wxml'), 'utf8')
const wxss = fs.readFileSync(path.join(root, 'pages/profile/profile.wxss'), 'utf8')
const js = fs.readFileSync(path.join(root, 'pages/profile/profile.js'), 'utf8')

assert.ok(
  wxml.includes('class="profile-avatar-edit-icon"') &&
  wxml.includes('class="icon-pencil"') &&
  wxml.includes('bindtap="openProfileEditor"') &&
  !wxml.includes('class="profile-name-edit-icon"'),
  'profile header should expose the edit affordance as a pencil badge on the avatar'
)

assert.ok(
  wxml.includes('class="profile-editor-avatar-badge"') && wxml.includes('bindtap="chooseLocalAvatar"'),
  'manual profile editor should expose a local avatar edit affordance'
)

assert.ok(
  js.includes("itemList: ['从相册选择头像', '拍照更换头像']") && js.includes('wx.chooseImage'),
  'manual avatar changes should use local album or camera'
)

assert.ok(
  /\.profile-avatar-edit-icon\s*\{[\s\S]*position:\s*absolute;[\s\S]*right:\s*-2rpx;[\s\S]*bottom:\s*-2rpx;[\s\S]*border-radius:\s*50%;/.test(wxss),
  'profile edit icon should be anchored to the avatar bottom-right corner'
)

assert.ok(
  /\.profile-hero-main\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+170rpx;/.test(wxss) &&
  /\.profile-identity\s*\{[\s\S]*max-width:\s*100%;/.test(wxss),
  'profile hero identity and stat cards should use stable constrained columns'
)

assert.ok(
  /\.profile-editor-avatar-badge\s*\{[\s\S]*position:\s*absolute;[\s\S]*border-radius:\s*50%;/.test(wxss),
  'avatar edit affordance should be a small overlay badge'
)

console.log('profile manual editor tests passed')
