const assert = require('node:assert/strict')

const toasts = []
global.wx = {
  getStorageSync() {},
  setStorageSync() {},
  showToast(options) { toasts.push(options) },
  switchTab() {}
}

let pageConfig = null
global.Page = function Page(config) { pageConfig = config }

function setByPath(target, key, value) {
  const parts = String(key).split('.')
  let cursor = target
  for (let index = 0; index < parts.length - 1; index += 1) {
    cursor[parts[index]] = cursor[parts[index]] || {}
    cursor = cursor[parts[index]]
  }
  cursor[parts[parts.length - 1]] = value
}

function createPage() {
  const page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data || {})),
    setData(patch, callback) {
      Object.keys(patch || {}).forEach(key => setByPath(this.data, key, patch[key]))
      if (callback) callback()
    }
  })
  Object.keys(pageConfig).forEach(key => {
    if (typeof pageConfig[key] === 'function') page[key] = pageConfig[key].bind(page)
  })
  page.setData({ sessionId: 'session_1', 'form.heroCardsInput': 'AsKh' })
  return page
}

const dataService = require('../services/data-service')
const tabBar = require('../utils/tab-bar')
const onboardingGuide = require('../utils/onboarding-guide')
const saved = []
dataService.createHand = async payload => { saved.push(payload); return payload }
tabBar.syncCustomTabBar = function () {}
onboardingGuide.getActiveStep = function () { return null }
onboardingGuide.shouldAutoShowGuide = function () { return false }
onboardingGuide.getStepForRoute = function () { return null }

delete require.cache[require.resolve('../pages/hand-record/hand-record.js')]
require('../pages/hand-record/hand-record.js')

async function run() {
  for (const invalid of ['abc', 'Infinity']) {
    const page = createPage()
    page.setData({ 'form.currentProfit': invalid })
    await page.saveHand()
    assert.equal(saved.length, 0, `${invalid} must not be saved`)
    assert.equal(toasts.at(-1).title, '请输入有效的输赢金额')
  }

  for (const valid of ['-500', '0']) {
    const page = createPage()
    page.setData({ 'form.currentProfit': valid })
    await page.saveHand()
  }
  assert.deepEqual(saved.map(item => item.currentProfit), [-500, 0])
}

run().then(() => {
  console.log('hand record currentProfit validation checks passed')
}).catch(error => {
  console.error(error)
  process.exit(1)
})
