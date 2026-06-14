const tabState = require('./tab-state')

function syncCustomTabBar(pagePath) {
  let retries = 0

  const apply = () => {
    const pages = getCurrentPages()
    const currentPage = pages[pages.length - 1]
    if (!currentPage || typeof currentPage.getTabBar !== 'function') return false
    const tabBar = currentPage.getTabBar()
    if (!tabBar || typeof tabBar.setData !== 'function') return false
    if (typeof tabBar.syncSelectedFromRoute === 'function') {
      tabBar.syncSelectedFromRoute()
      return true
    }

    const normalizedRoute = tabState.getSelectedTabPath(currentPage.route || currentPage.__route__ || '')
    if (!normalizedRoute) return false
    tabBar.setData({ selected: normalizedRoute })
    return true
  }

  if (apply()) return

  ;[50, 120, 240, 480].forEach(delay => {
    setTimeout(() => {
      if (retries >= 4) return
      retries += 1
      apply()
    }, delay)
  })
}

module.exports = {
  syncCustomTabBar: syncCustomTabBar
}
