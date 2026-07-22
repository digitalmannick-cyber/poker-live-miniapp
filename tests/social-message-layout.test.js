const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.join(__dirname, '..')

test('message center keeps native buttons inside their cards', () => {
  const wxss = fs.readFileSync(path.join(root, 'pages/social-messages/social-messages.wxss'), 'utf8')
  assert.match(wxss, /\.mark-all\s*\{[^}]*flex:\s*0 0 180rpx[^}]*width:\s*180rpx[^}]*box-sizing:\s*border-box/s)
  assert.match(wxss, /\.request-actions\s*\{[^}]*display:\s*flex[^}]*width:\s*100%/s)
  assert.match(wxss, /\.request-action\s*\{[^}]*flex:\s*1 1 0[^}]*width:\s*0[^}]*box-sizing:\s*border-box/s)
  assert.match(wxss, /\.request-action::after[^}]*border:\s*0/s)
  assert.doesNotMatch(wxss, /\.message-card-corner\s*\{[^}]*clip-path:/s)
})

test('player tab displays a numeric unread badge without covering its label', () => {
  const js = fs.readFileSync(path.join(root, 'custom-tab-bar/index.js'), 'utf8')
  const wxml = fs.readFileSync(path.join(root, 'custom-tab-bar/index.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(root, 'custom-tab-bar/index.wxss'), 'utf8')
  assert.match(js, /socialUnreadLabel:\s*''/)
  assert.match(js, /socialUnreadLabel:\s*snapshot\.label/)
  assert.match(wxml, /class="tab-social-badge"/)
  assert.match(wxml, />\{\{socialUnreadLabel\}\}<\/view>/)
  assert.match(wxss, /\.tab-social-badge\s*\{[^}]*top:\s*4rpx[^}]*right:\s*8rpx[^}]*min-width:\s*28rpx/s)
  assert.doesNotMatch(wxml, /tab-social-dot/)
})
