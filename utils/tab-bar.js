function syncCustomTabBar(pagePath) {
  const pages = getCurrentPages()
  const currentPage = pages[pages.length - 1]
  if (!currentPage || typeof currentPage.getTabBar !== 'function') return
  const tabBar = currentPage.getTabBar()
  if (!tabBar || typeof tabBar.setData !== 'function') return
  tabBar.setData({ selected: pagePath })
}

module.exports = {
  syncCustomTabBar: syncCustomTabBar
}
