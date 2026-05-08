Component({
  data: {
    selected: '',
    list: [
      { pagePath: '/pages/session-list/session-list', text: '场次', short: 'SESS' },
      { pagePath: '/pages/hand-record/hand-record', text: '记牌', short: 'REC' },
      { pagePath: '/pages/review-list/review-list', text: '复盘', short: 'REVIEW' },
      { pagePath: '/pages/stats/stats', text: '统计', short: 'STATS' },
      { pagePath: '/pages/profile/profile', text: '我的', short: 'ME' }
    ]
  },
  methods: {
    switchTab(event) {
      const pagePath = event.currentTarget.dataset.path
      if (!pagePath || pagePath === this.data.selected) return
      wx.switchTab({ url: pagePath })
    }
  },
  pageLifetimes: {
    show() {
      const pages = getCurrentPages()
      const currentPage = pages[pages.length - 1]
      const route = currentPage ? '/' + currentPage.route : ''
      if (route && route !== this.data.selected) {
        this.setData({ selected: route })
      }
    }
  }
})
