const DEFAULT_STATS_PREFETCH_DELAY = 600

function scheduleStatsPrefetch(dataService, options) {
  if (!dataService || typeof dataService.prefetchStatsData !== 'function') return null
  if (typeof dataService.getCurrentPlayerId !== 'function') return null

  let playerId = ''
  let cached = null
  try {
    playerId = String(dataService.getCurrentPlayerId() || '').trim()
    cached = typeof dataService.getCachedStatsData === 'function'
      ? dataService.getCachedStatsData('all')
      : null
  } catch (error) {
    return null
  }
  if (!playerId || cached) return null

  const config = options || {}
  const schedule = typeof config.setTimeout === 'function' ? config.setTimeout : setTimeout
  const delay = Number(config.delayMs) >= 0 ? Number(config.delayMs) : DEFAULT_STATS_PREFETCH_DELAY
  return schedule(() => {
    try {
      return Promise.resolve(dataService.prefetchStatsData('all')).catch(() => null)
    } catch (error) {
      return Promise.resolve(null)
    }
  }, delay)
}

module.exports = {
  scheduleStatsPrefetch,
  DEFAULT_STATS_PREFETCH_DELAY
}
