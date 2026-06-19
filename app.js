require('./utils/polyfills').installPolyfills()

const store = require('./utils/store')
const LAUNCH_TRACE_KEY = 'pokerLiveLaunchTrace'

function appendLaunchTrace(step, detail) {
  try {
    const current = wx.getStorageSync(LAUNCH_TRACE_KEY)
    const list = Array.isArray(current) ? current : []
    list.push({
      step: String(step || '').trim(),
      detail: String(detail || '').trim(),
      at: Date.now()
    })
    wx.setStorageSync(LAUNCH_TRACE_KEY, list.slice(-40))
  } catch (error) {
    console.warn('append launch trace failed: ' + (error && (error.stack || error.message || error.errMsg) || error))
  }
}

App({
  onLaunch() {
    appendLaunchTrace('app:onLaunch:start', '')
    try {
      store.initStore()
      appendLaunchTrace('app:onLaunch:store-ready', '')
    } catch (error) {
      const message = error && (error.stack || error.message || error.errMsg) || String(error)
      appendLaunchTrace('app:onLaunch:store-failed', message)
      console.warn('store init failed, resetting local store: ' + message)
      try {
        wx.removeStorageSync('pokerLiveMiniappStore')
        if (store.__test && typeof store.__test.resetCachedStoreForTest === 'function') {
          store.__test.resetCachedStoreForTest()
        }
        store.initStore()
        appendLaunchTrace('app:onLaunch:store-reset-ready', '')
      } catch (resetError) {
        appendLaunchTrace('app:onLaunch:store-reset-failed', resetError && (resetError.stack || resetError.message || resetError.errMsg) || String(resetError))
        console.warn('store reset failed: ' + (resetError && (resetError.stack || resetError.message || resetError.errMsg) || resetError))
      }
    }
  },
  onError(error) {
    const message = error && (error.stack || error.message || error.errMsg) || String(error)
    appendLaunchTrace('app:onError', message)
    console.warn('app error: ' + message)
    try {
      wx.setStorageSync('pokerLiveLastError', message)
    } catch (storageError) {
      console.warn('save last error failed: ' + (storageError && storageError.errMsg || storageError))
    }
  },
  globalData: {
    brandName: '智牌屋'
  }
})
