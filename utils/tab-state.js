const TAB_ITEMS = [
  { pagePath: '/pages/session-list/session-list', text: '场次', short: 'SESS' },
  { pagePath: '/pages/review-list/review-list', text: '手牌', short: 'HANDS' },
  { pagePath: '/pages/player-notes/player-notes', text: '玩家', short: 'PLAYER' },
  { pagePath: '/pages/stats/stats', text: '统计', short: 'STATS' },
  { pagePath: '/pages/profile/profile', text: '我的', short: 'ME' }
]

function normalizePagePath(value) {
  const text = String(value || '')
  if (!text) return ''
  return text.charAt(0) === '/' ? text : '/' + text
}

function getSwitchTabUrl(value) {
  return normalizePagePath(value).replace(/^\//, '')
}

function getSelectedTabPath(route) {
  const normalized = normalizePagePath(route)
  const match = TAB_ITEMS.find(item => item.pagePath === normalized)
  return match ? match.pagePath : ''
}

function buildTabItems(selected) {
  const selectedPath = getSelectedTabPath(selected)
  return TAB_ITEMS.map(item => ({
    pagePath: item.pagePath,
    text: item.text,
    short: item.short,
    active: item.pagePath === selectedPath
  }))
}

module.exports = {
  TAB_ITEMS,
  normalizePagePath,
  getSwitchTabUrl,
  getSelectedTabPath,
  buildTabItems
}
