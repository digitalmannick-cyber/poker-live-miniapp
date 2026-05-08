const store = require('./utils/store')
const cloudUtils = require('./utils/cloud')
const dataService = require('./services/data-service')

App({
  onLaunch() {
    store.initStore()
    cloudUtils.initCloud()
    dataService.bootstrapCloudSync()
  },
  globalData: {
    brandName: 'Poker Live Recorder'
  }
})
