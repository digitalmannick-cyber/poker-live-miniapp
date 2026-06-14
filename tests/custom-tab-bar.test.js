const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const js = fs.readFileSync(path.join(root, 'custom-tab-bar/index.js'), 'utf8')
const wxml = fs.readFileSync(path.join(root, 'custom-tab-bar/index.wxml'), 'utf8')
const util = fs.readFileSync(path.join(root, 'utils/tab-bar.js'), 'utf8')

assert.ok(
  js.includes("require('../utils/tab-state')"),
  'custom tab bar should use shared route-derived tab state'
)

assert.ok(
  js.includes('startRoutePolling') && js.includes('setInterval'),
  'custom tab bar should poll current route while visible to repair stale native state'
)

assert.ok(
  !js.includes('pendingSelected') && !wxml.includes('pendingSelected'),
  'custom tab bar should not use optimistic pending selection'
)

assert.ok(
  js.includes('setSelectedTab(pagePath)') && js.indexOf('setSelectedTab(pagePath)') < js.indexOf('wx.switchTab'),
  'custom tab bar should highlight the tapped tab before wx.switchTab finishes'
)

assert.ok(
  wxml.includes("{{item.active ? 'active' : ''}}"),
  'custom tab bar should render active state from computed tab items'
)

assert.ok(
  util.includes('getSelectedTabPath(currentPage.route'),
  'sync helper should ignore caller-provided paths and use current route'
)

console.log('custom tab bar integration tests passed')
