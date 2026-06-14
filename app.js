require('./utils/polyfills').installPolyfills()

const store = require('./utils/store')

App({
  onLaunch() {
    try {
      store.initStore()
    } catch (error) {
      const message = error && (error.stack || error.message || error.errMsg) || String(error)
      console.warn('store init failed, resetting local store: ' + message)
      try {
        wx.removeStorageSync('pokerLiveMiniappStore')
        if (store.__test && typeof store.__test.resetCachedStoreForTest === 'function') {
          store.__test.resetCachedStoreForTest()
        }
        store.initStore()
      } catch (resetError) {
        console.warn('store reset failed: ' + (resetError && (resetError.stack || resetError.message || resetError.errMsg) || resetError))
      }
    }
  },
  onError(error) {
    const message = error && (error.stack || error.message || error.errMsg) || String(error)
    console.warn('app error: ' + message)
    try {
      wx.setStorageSync('pokerLiveLastError', message)
    } catch (storageError) {
      console.warn('save last error failed: ' + (storageError && storageError.errMsg || storageError))
    }
  },
  globalData: {
    brandName: 'Poker Live Recorder'
  }
})
