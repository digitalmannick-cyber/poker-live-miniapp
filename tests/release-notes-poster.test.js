const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

const storage = new Map()

global.wx = {
  getStorageSync(key) {
    return storage.get(key)
  },
  setStorageSync(key, value) {
    storage.set(key, value)
  }
}

const appVersion = require('../config/app-version')
const releaseNotesConfig = require('../config/release-notes')
const releaseNotes = require('../utils/release-notes')

test.beforeEach(() => {
  storage.clear()
})

test('release notes config matches the app version and has concise update items', () => {
  assert.equal(releaseNotesConfig.version, appVersion.displayVersion)
  assert.ok(releaseNotesConfig.items.length >= 3)
  assert.ok(releaseNotesConfig.items.length <= 7)
  assert.equal(releaseNotes.validateReleaseNotes(releaseNotesConfig, appVersion.displayVersion).ok, true)
})

test('automatic display is scoped to logged-in account and current version', () => {
  const context = { playerId: 'wx-user-a', accountLoggedOut: false }

  assert.equal(releaseNotes.shouldShowReleaseNotes(context), true)
  assert.equal(releaseNotes.shouldShowReleaseNotes({ playerId: '', accountLoggedOut: false }), false)
  assert.equal(releaseNotes.shouldShowReleaseNotes({ playerId: 'WX-USER-A', accountLoggedOut: true }), false)

  const result = releaseNotes.acknowledgeReleaseNotes(context)
  assert.equal(result.ok, true)
  assert.equal(releaseNotes.shouldShowReleaseNotes(context), false)
  assert.equal(releaseNotes.shouldShowReleaseNotes({ playerId: 'WX-USER-B', accountLoggedOut: false }), true)
  assert.equal(releaseNotes.shouldShowReleaseNotes(Object.assign({}, context, { manual: true })), true)
})

test('failed acknowledgement keeps the poster unconfirmed', () => {
  const originalSet = wx.setStorageSync
  wx.setStorageSync = () => {
    throw new Error('storage full')
  }
  const context = { playerId: 'WX-USER-A', accountLoggedOut: false }
  const result = releaseNotes.acknowledgeReleaseNotes(context)
  wx.setStorageSync = originalSet

  assert.equal(result.ok, false)
  assert.equal(releaseNotes.shouldShowReleaseNotes(context), true)
})

test('poster component has no close action and emits only acknowledgement', () => {
  const appConfig = JSON.parse(fs.readFileSync('app.json', 'utf8'))
  const wxml = fs.readFileSync('components/release-notes-poster/index.wxml', 'utf8')
  const js = fs.readFileSync('components/release-notes-poster/index.js', 'utf8')

  assert.equal(appConfig.usingComponents['release-notes-poster'], '/components/release-notes-poster/index')
  assert.match(wxml, /我知道了/)
  assert.match(wxml, /bindtap="onAcknowledge"/)
  assert.doesNotMatch(wxml, />\s*(关闭|×|X)\s*</)
  assert.doesNotMatch(wxml, /bindtap="[^\"]*(close|dismiss)/i)
  assert.match(js, /triggerEvent\('acknowledge'/)
})

test('session and profile share the poster while profile keeps a manual entry', () => {
  const sessionWxml = fs.readFileSync('pages/session-list/session-list.wxml', 'utf8')
  const sessionJs = fs.readFileSync('pages/session-list/session-list.js', 'utf8')
  const profileWxml = fs.readFileSync('pages/profile/profile.wxml', 'utf8')
  const profileJs = fs.readFileSync('pages/profile/profile.js', 'utf8')

  assert.match(sessionWxml, /<release-notes-poster/)
  assert.match(sessionJs, /maybeShowReleaseNotes/)
  assert.match(sessionJs, /acknowledgeReleaseNotes/)
  assert.match(profileWxml, /关于与版本更新/)
  assert.doesNotMatch(profileWxml, /<view class="setting-title">版本更新<\/view>/)
  assert.doesNotMatch(profileWxml, /<view class="setting-title">关于<\/view>/)
  assert.match(profileWxml, /<release-notes-poster/)
  assert.match(profileJs, /openReleaseNotes/)
  assert.doesNotMatch(profileJs, /showAbout\(\)/)
  assert.match(profileJs, /acknowledgeReleaseNotes/)
})
