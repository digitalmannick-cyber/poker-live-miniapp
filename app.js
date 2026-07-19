require('./utils/polyfills').installPolyfills()

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
    // Let WeChat render the first page before any local-data or cloud work.
    setTimeout(() => appendLaunchTrace('app:onLaunch:ready', ''), 0)
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
