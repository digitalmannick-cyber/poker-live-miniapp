const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')

const pagePath = path.resolve(__dirname, '../pages/profile/profile.js')

function loadProfilePage(logoutError) {
  let definition
  let modal
  const calls = { remove: [], toasts: [], refresh: 0 }
  const originalLoad = Module._load
  const previousPage = global.Page
  const previousWx = global.wx
  Module._load = function patchedLoad(request, parent, isMain) {
    if (parent && /pages[\\/]profile[\\/]profile\.js$/.test(parent.filename || '')) {
      if (request === '../../services/data-service') return {
        getProfileStatsSnapshot() { return null },
        async logoutAccount() { throw logoutError }
      }
      if (request === '../../services/social-service') return {}
      if (request === '../../utils/tab-bar') return { syncCustomTabBar() {} }
      if (request === '../../utils/onboarding-guide') return { getStepForRoute() { return null } }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  global.Page = value => { definition = value }
  global.wx = {
    showModal(input) { modal = input },
    showToast(input) { calls.toasts.push(input) },
    removeStorageSync(key) { calls.remove.push(key) },
    getStorageSync() {},
    setStorageSync() {}
  }
  delete require.cache[pagePath]
  try { require(pagePath) } finally { Module._load = originalLoad; global.Page = previousPage }
  const page = Object.assign({
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch) }
  }, definition)
  page.refresh = () => { calls.refresh += 1 }
  return {
    page,
    calls,
    confirmLogout() { return modal.success({ confirm: true }) },
    restore() {
      delete require.cache[pagePath]
      if (previousWx === undefined) delete global.wx
      else global.wx = previousWx
    }
  }
}

for (const error of [
  Object.assign(new Error('private pending key'), { code: 'PENDING_IMPORT_CLEANUP_FAILED' }),
  new Error('internal logout diagnostic')
]) {
  test('profile logout exposes one retryable fixed failure without false success: ' + (error.code || 'generic'), async t => {
    const loaded = loadProfilePage(error)
    t.after(() => loaded.restore())
    loaded.page.logoutAccount()
    await loaded.confirmLogout()

    assert.deepEqual(loaded.calls.toasts, [{ title: '未完全退出，请重试', icon: 'none' }])
    assert.equal(loaded.calls.refresh, 0)
    assert.deepEqual(loaded.calls.remove, [])
    assert.doesNotMatch(JSON.stringify(loaded.calls.toasts), /private pending key|internal logout diagnostic|PENDING_IMPORT/)
  })
}
