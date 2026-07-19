const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')
const test = require('node:test')

const pagePath = path.resolve(__dirname, '../pages/profile/profile.js')
const originalLoad = Module._load

let pageDefinition = null
let updateSettingsPatch = null
let lastToast = null
let socialSettingsPatch = null
let socialProfileLoader = null
let socialSettingsSaver = null

function setByPath(target, keyPath, value) {
  const parts = String(keyPath).split('.')
  let cursor = target
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index]
    if (!cursor[key]) cursor[key] = {}
    cursor = cursor[key]
  }
  cursor[parts[parts.length - 1]] = value
}

function createPageInstance(config) {
  const page = {
    data: JSON.parse(JSON.stringify(config.data || {})),
    setData(patch, callback) {
      Object.keys(patch || {}).forEach(key => setByPath(this.data, key, patch[key]))
      if (typeof callback === 'function') callback()
    }
  }
  Object.keys(config).forEach(key => {
    if (key !== 'data') page[key] = typeof config[key] === 'function' ? config[key].bind(page) : config[key]
  })
  return page
}

function installProfilePage() {
  pageDefinition = null
  updateSettingsPatch = null
  lastToast = null
  socialSettingsPatch = null
  socialProfileLoader = null
  socialSettingsSaver = null
  global.wx = {
    showToast(options) { lastToast = options },
    showModal() {},
    getStorageSync() {},
    setStorageSync() {},
    removeStorageSync() {}
  }
  global.Page = definition => {
    pageDefinition = definition
  }
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.endsWith('../../services/data-service')) {
      return {
        getProfileStatsSnapshot() {
          return null
        },
        async updateSettings(patch) {
          updateSettingsPatch = patch
          return Object.assign({
            chipUnit: 'BB',
            venues: ['room-a', 'room-b'],
            blindPresets: ['100/200'],
            opponentTypes: ['tight']
          }, patch)
        }
      }
    }
    if (request.endsWith('../../services/social-service')) {
      return {
        async getMySocialProfile() {
          if (socialProfileLoader) return socialProfileLoader()
          return { statsVisible: true, defaultShareScope: 'friends' }
        },
        async updateSocialSettings(patch) {
          socialSettingsPatch = patch
          if (socialSettingsSaver) return socialSettingsSaver(patch)
          return { statsVisible: patch.statsVisible, defaultShareScope: patch.defaultShareScope }
        }
      }
    }
    if (request.endsWith('../../utils/tab-bar')) return { syncCustomTabBar() {} }
    if (request.endsWith('../../utils/onboarding-guide')) return { getStepForRoute() { return null } }
    return originalLoad.call(this, request, parent, isMain)
  }
  delete require.cache[pagePath]
  require(pagePath)
  Module._load = originalLoad
  if (!pageDefinition) throw new Error('profile page was not registered')
  return createPageInstance(pageDefinition)
}

test('profile settings editor saves the typed draft row even when plus was not tapped', async () => {
  const page = installProfilePage()
  page.setData({
    settings: {
      chipUnit: 'BB',
      venues: ['room-a', 'room-b'],
      blindPresets: ['100/200'],
      opponentTypes: ['tight']
    },
    stats: { totalProfit: 0 }
  })

  page.openSettingsEditor('venues', 'Edit venues', 'Example venue')
  page.onSettingsEditorNewValueInput({ detail: { value: 'room-c' } })
  await page.saveSettingsEditor()

  assert.deepEqual(updateSettingsPatch, { venues: ['room-a', 'room-b', 'room-c'] })
  assert.equal(page.data.settingsEditorVisible, false)
  assert.equal(page.data.settingsEditorNewValue, '')
  assert.equal(lastToast && lastToast.icon, 'success')
})

test('profile social privacy controls explain ranking removal and save supported defaults', async () => {
  const page = installProfilePage()
  await page.loadSocialSettings()
  assert.equal(page.data.socialSettings.statsVisible, true)

  await page.toggleSocialStatsVisible()
  assert.equal(socialSettingsPatch.statsVisible, false)
  assert.equal(socialSettingsPatch.defaultShareScope, 'friends')
  assert.match(String(socialSettingsPatch.clientMutationId), /^social_settings_/)
  assert.equal(page.data.socialSettings.statsVisible, false)

  await page.selectDefaultShareScope({ currentTarget: { dataset: { scope: 'selected' } } })
  assert.equal(socialSettingsPatch.defaultShareScope, 'selected')
  assert.equal(Object.prototype.hasOwnProperty.call(socialSettingsPatch, 'selectedFriendIds'), false)
})

test('profile markup clearly describes social privacy and all supported default scopes', () => {
  const wxml = require('node:fs').readFileSync(path.resolve(__dirname, '../pages/profile/profile.wxml'), 'utf8')
  assert.match(wxml, /好友统计可见/)
  assert.match(wxml, /退出本周、月度和累计排行榜/)
  assert.match(wxml, /广场[\s\S]*全部好友[\s\S]*指定好友/)
})

test('a stale profile GET cannot overwrite a successful privacy save and loading/saving block conflict taps', async () => {
  const page = installProfilePage()
  let resolveLoad
  let resolveSave
  let saveCalls = 0
  socialProfileLoader = () => new Promise(resolve => { resolveLoad = resolve })
  socialSettingsSaver = patch => { saveCalls += 1; return Promise.resolve({ statsVisible: patch.statsVisible, defaultShareScope: patch.defaultShareScope }) }

  const loading = page.loadSocialSettings()
  assert.equal(page.data.socialSettingsStatus, 'loading')
  assert.equal(await page.toggleSocialStatsVisible(), null, 'loading must block setting writes')
  assert.equal(saveCalls, 0)

  // Simulate the user acting after the current value is available while the older GET is still in flight.
  page.setData({ socialSettingsStatus: 'ready', socialSettings: { statsVisible: true, defaultShareScope: 'friends' } })
  socialSettingsSaver = patch => new Promise(resolve => { saveCalls += 1; resolveSave = () => resolve({ statsVisible: patch.statsVisible, defaultShareScope: patch.defaultShareScope }) })
  const saving = page.toggleSocialStatsVisible()
  assert.equal(page.data.socialSettingsSaving, true)
  assert.equal(await page.selectDefaultShareScope({ currentTarget: { dataset: { scope: 'selected' } } }), null, 'saving must block a second write')
  resolveSave()
  await saving
  assert.equal(page.data.socialSettings.statsVisible, false)

  resolveLoad({ statsVisible: true, defaultShareScope: 'square' })
  await loading
  assert.deepEqual(page.data.socialSettings, { statsVisible: false, defaultShareScope: 'friends' }, 'late GET must not reopen statistics')

  socialSettingsSaver = patch => Promise.resolve({ statsVisible: patch.statsVisible, defaultShareScope: patch.defaultShareScope })
  await page.selectDefaultShareScope({ currentTarget: { dataset: { scope: 'selected' } } })
  assert.deepEqual(page.data.socialSettings, { statsVisible: false, defaultShareScope: 'selected' })
  assert.equal(socialSettingsPatch.statsVisible, false)
})

test('social setting requests never write back after profile page unload', async () => {
  const page = installProfilePage()
  let resolveLoad
  socialProfileLoader = () => new Promise(resolve => { resolveLoad = resolve })
  const loading = page.loadSocialSettings()
  page.onUnload()
  resolveLoad({ statsVisible: false, defaultShareScope: 'selected' })
  await loading
  assert.deepEqual(page.data.socialSettings, { statsVisible: true, defaultShareScope: 'friends' })

  const savingPage = installProfilePage()
  let resolveSave
  socialSettingsSaver = patch => new Promise(resolve => { resolveSave = () => resolve({ statsVisible: patch.statsVisible, defaultShareScope: patch.defaultShareScope }) })
  savingPage.setData({ socialSettingsStatus: 'ready', socialSettings: { statsVisible: true, defaultShareScope: 'friends' } })
  const saving = savingPage.toggleSocialStatsVisible()
  savingPage.onUnload()
  resolveSave()
  await saving
  assert.deepEqual(savingPage.data.socialSettings, { statsVisible: true, defaultShareScope: 'friends' })
})

test('unknown or failed social settings are read-only until a successful reload', async () => {
  const page = installProfilePage()
  let saveCalls = 0
  socialProfileLoader = () => Promise.reject(new Error('network'))
  socialSettingsSaver = patch => { saveCalls += 1; return Promise.resolve(patch) }

  assert.equal(await page.loadSocialSettings(), null)
  assert.equal(page.data.socialSettingsStatus, 'error')
  assert.equal(await page.toggleSocialStatsVisible(), null)
  assert.equal(await page.selectDefaultShareScope({ currentTarget: { dataset: { scope: 'square' } } }), null)
  assert.equal(await page.saveSocialSettings({ statsVisible: false, defaultShareScope: 'selected' }), null)
  assert.equal(saveCalls, 0)
  assert.deepEqual(page.data.socialSettings, { statsVisible: true, defaultShareScope: 'friends' }, 'unknown server privacy must not be overwritten by local defaults')
})
