const dataService = require('../../services/data-service')
const display = require('../../utils/display')
const cardUi = require('../../utils/card-ui')
const tabBar = require('../../utils/tab-bar')

const OPEN_CREATE_SESSION_KEY = 'pokerLiveOpenCreateSession'

Page({
  data: {
    stats: {},
    activeSession: null,
    recentHands: [],
    chipUnit: 'BB',
    loading: false
  },
  onShow() {
    tabBar.syncCustomTabBar('/pages/home/home')
    this.refresh()
  },
  async refresh() {
    this.setData({ loading: true })
    const data = await dataService.getDashboardData()
    const settings = dataService.getAppSettings()
    const chipUnit = settings.chipUnit
    const recentHands = (data.recentHands || []).map(item => Object.assign({}, item, {
      currentProfitDisplay: display.formatAmount(item.currentProfit, chipUnit),
      heroCardsVisual: cardUi.parseHeroCardsInput(item.heroCardsInput),
      boardStreetVisual: cardUi.parseBoardStreets(item.board)
    })).slice(0, 4)
    const activeSession = data.activeSession
      ? Object.assign({}, data.activeSession, {
          totalProfitDisplay: display.formatAmount(data.activeSession.totalProfit, chipUnit),
          blindDisplay: [data.activeSession.smallBlind, data.activeSession.bigBlind].filter(Boolean).join('/'),
          handCountLabel: String(data.activeSession.handCount || 0)
        })
      : null
    const stats = Object.assign({}, data.stats, {
      totalProfitDisplay: display.formatAmount(data.stats.totalProfit, chipUnit)
    })
    this.setData({
      stats,
      activeSession,
      recentHands,
      chipUnit,
      loading: false
    })
  },
  goNewSession() {
    wx.setStorageSync(OPEN_CREATE_SESSION_KEY, true)
    wx.switchTab({ url: '/pages/session-list/session-list' })
  },
  async goContinue() {
    const active = (await dataService.getDashboardData()).activeSession
    if (!active) {
      wx.showToast({ title: '暂无进行中场次', icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/session-detail/session-detail?id=' + active._id })
  },
  goQuickRecord() {
    wx.switchTab({ url: '/pages/hand-record/hand-record' })
  },
  goSessionList() {
    wx.switchTab({ url: '/pages/session-list/session-list' })
  },
  goHandDetail(e) {
    wx.navigateTo({ url: '/pages/hand-detail/hand-detail?id=' + e.currentTarget.dataset.id })
  }
})
