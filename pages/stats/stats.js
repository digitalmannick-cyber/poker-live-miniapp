const dataService = require('../../services/data-service')
const display = require('../../utils/display')
const tabBar = require('../../utils/tab-bar')

Page({
  data: {
    stats: {},
    loading: false
  },
  async onShow() {
    tabBar.syncCustomTabBar('/pages/stats/stats')
    this.setData({ loading: true })
    await dataService.bootstrapCloudSync()
    const data = await dataService.getStatsData()
    const settings = dataService.getAppSettings()
    const stats = Object.assign({}, data.stats, {
      totalProfitDisplay: display.formatAmount(data.stats.totalProfit, settings.chipUnit),
      hourlyRateDisplay: display.formatAmount(data.stats.hourlyRate, settings.chipUnit)
    })
    this.setData({ stats, loading: false })
  }
})
