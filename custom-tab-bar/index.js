const tabState = require('../utils/tab-state')
const socialUnreadState = require('../utils/social-unread-state')
const dataService = require('../services/data-service')

function getSocialAccountKey() {
  try {
    if (typeof dataService.isAccountLoggedOut === 'function' && dataService.isAccountLoggedOut()) return ''
    return typeof dataService.getCurrentPlayerId === 'function' ? dataService.getCurrentPlayerId() : ''
  } catch (error) {
    return ''
  }
}

Component({
  data: {
    selected: '',
    list: tabState.buildTabItems(''),
    socialUnread: false
  },
  lifetimes: {
    attached() {
      this.syncSocialAccount()
      this.subscribeSocialUnread()
      this.startRoutePolling()
    },
    detached() {
      this.unsubscribeSocialUnread()
      this.stopRoutePolling()
    }
  },
  pageLifetimes: {
    show() {
      this.syncSocialAccount()
      this.subscribeSocialUnread()
      this.startRoutePolling()
    },
    hide() {
      this.unsubscribeSocialUnread()
      this.stopRoutePolling()
    }
  },
  methods: {
    syncSocialAccount() {
      socialUnreadState.setAccountKey(getSocialAccountKey())
    },
    subscribeSocialUnread() {
      if (this._unsubscribeSocialUnread) return
      this._unsubscribeSocialUnread = socialUnreadState.subscribe(snapshot => {
        this.setData({ socialUnread: snapshot.hasUnread })
      })
    },
    unsubscribeSocialUnread() {
      if (!this._unsubscribeSocialUnread) return
      this._unsubscribeSocialUnread()
      this._unsubscribeSocialUnread = null
    },
    normalizePagePath(value) {
      return tabState.normalizePagePath(value)
    },
    setSelectedTab(pagePath) {
      const selected = tabState.getSelectedTabPath(pagePath)
      if (!selected || selected === this.data.selected) return
      this.setData({
        selected,
        list: tabState.buildTabItems(selected)
      })
    },
    syncSelectedFromRoute() {
      const pages = getCurrentPages()
      const currentPage = pages[pages.length - 1]
      const route = currentPage ? (currentPage.route || currentPage.__route__ || '') : ''
      const normalized = tabState.getSelectedTabPath(route)
      this.setSelectedTab(normalized)
    },
    safeSyncSelectedFromRoute() {
      try {
        this.syncSelectedFromRoute()
      } catch (error) {
        console.warn('[PLR_TAB] sync failed: ' + (error && (error.stack || error.message || error.errMsg) || error))
      }
    },
    scheduleRouteSync() {
      this.safeSyncSelectedFromRoute()
      ;[80, 180, 360, 720].forEach((delay) => {
        setTimeout(() => {
          this.safeSyncSelectedFromRoute()
        }, delay)
      })
    },
    startRoutePolling() {
      this.safeSyncSelectedFromRoute()
      if (this.routePollTimer) return
      this.routePollTimer = setInterval(() => {
        this.safeSyncSelectedFromRoute()
      }, 300)
    },
    stopRoutePolling() {
      if (!this.routePollTimer) return
      clearInterval(this.routePollTimer)
      this.routePollTimer = null
    },
    switchTab(event) {
      const dataset = event && event.currentTarget && event.currentTarget.dataset || {}
      const pagePath = this.normalizePagePath(dataset.path)
      const fallbackUrl = tabState.getSwitchTabUrl(pagePath)
      if (!pagePath || pagePath === this.data.selected) return
      console.info('[PLR_TAB] switchTab ' + pagePath)
      this.setSelectedTab(pagePath)
      wx.switchTab({
        url: pagePath,
        success: () => {
          this.scheduleRouteSync()
        },
        fail: (error) => {
          console.warn('[PLR_TAB] switchTab failed: ' + (error && (error.errMsg || error.message) || error))
          if (fallbackUrl && fallbackUrl !== pagePath) {
            wx.switchTab({
              url: fallbackUrl,
              success: () => {
                this.scheduleRouteSync()
              },
              fail: () => {
                this.scheduleRouteSync()
              }
            })
            return
          }
          this.scheduleRouteSync()
        }
      })
    }
  }
})
