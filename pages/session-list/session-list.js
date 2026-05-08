const dataService = require('../../services/data-service')
const display = require('../../utils/display')
const tabBar = require('../../utils/tab-bar')

Page({
  data: {
    sessions: [],
    loading: false
  },
  async onShow() {
    tabBar.syncCustomTabBar('/pages/session-list/session-list')
    this.setData({ loading: true })
    await dataService.bootstrapCloudSync()
    const data = await dataService.getSessionListData()
    const settings = dataService.getAppSettings()
    const sessions = (data.sessions || [])
      .map((item, index) => Object.assign({}, item, {
        totalProfitDisplay: display.formatAmount(item.totalProfit, settings.chipUnit),
        __sortIndex: index
      }))
      .sort((a, b) => {
        const aActive = a.status === 'active' ? 1 : 0
        const bActive = b.status === 'active' ? 1 : 0
        if (aActive !== bActive) return bActive - aActive
        return a.__sortIndex - b.__sortIndex
      })
      .map(item => {
        const next = Object.assign({}, item)
        delete next.__sortIndex
        return next
      })
    this.setData({ sessions, loading: false })
  },
  goNewSession() {
    wx.navigateTo({ url: '/pages/session-detail/session-detail?mode=create' })
  },
  goSessionDetail(e) {
    wx.navigateTo({ url: '/pages/session-detail/session-detail?id=' + e.currentTarget.dataset.id })
  }
})
