const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')
const test = require('node:test')

const pagePath = path.resolve(__dirname, '../pages/profile/profile.js')
const originalLoad = Module._load

let pageDefinition = null
let updateSettingsPatch = null
let lastToast = null

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
