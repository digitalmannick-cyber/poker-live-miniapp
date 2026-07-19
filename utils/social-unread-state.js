const socialService = require('../services/social-service')

const DEFAULT_THROTTLE_MS = 30 * 1000

function normalizeCount(value) {
  return Math.max(0, Math.floor(Number(value) || 0))
}

function snapshotFor(count) {
  const normalized = normalizeCount(count)
  return {
    count: normalized,
    label: normalized > 99 ? '99+' : (normalized ? String(normalized) : ''),
    hasUnread: normalized > 0
  }
}

function createSocialUnreadState(options) {
  const source = options || {}
  const service = source.service || socialService
  const now = source.now || Date.now
  const throttleMs = source.throttleMs == null ? DEFAULT_THROTTLE_MS : Math.max(0, Number(source.throttleMs) || 0)
  let accountKey = ''
  let count = 0
  let mutationEpoch = 0
  let requestSequence = 0
  let lastRefreshAt = -Infinity
  let inFlight = null
  const listeners = new Set()

  function getSnapshot() {
    return snapshotFor(count)
  }

  function notify() {
    const snapshot = getSnapshot()
    listeners.forEach(listener => {
      try { listener(snapshot) } catch (error) { console.warn('[SOCIAL_UNREAD] listener failed', error) }
    })
  }

  function setAccountKey(value) {
    const next = String(value || '').trim().toUpperCase()
    if (next === accountKey) return
    accountKey = next
    count = 0
    mutationEpoch += 1
    requestSequence += 1
    lastRefreshAt = -Infinity
    inFlight = null
    notify()
  }

  function applyAuthoritativeCount(value) {
    count = normalizeCount(value)
    mutationEpoch += 1
    notify()
    return getSnapshot()
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {}
    listeners.add(listener)
    listener(getSnapshot())
    return () => listeners.delete(listener)
  }

  function refresh(refreshOptions) {
    const config = refreshOptions || {}
    const currentTime = Number(now()) || 0
    if (!config.force && inFlight) return inFlight
    if (!config.force && currentTime - lastRefreshAt < throttleMs) return Promise.resolve(getSnapshot())
    if (!service || typeof service.getUnreadNotificationCount !== 'function') return Promise.resolve(getSnapshot())

    const sequence = ++requestSequence
    const startedEpoch = mutationEpoch
    lastRefreshAt = currentTime
    const request = Promise.resolve()
      .then(() => service.getUnreadNotificationCount())
      .then(result => {
        if (sequence !== requestSequence || startedEpoch !== mutationEpoch) return getSnapshot()
        count = normalizeCount(result && result.unreadCount)
        notify()
        return getSnapshot()
      })
      .finally(() => {
        if (inFlight === request) inFlight = null
      })
    inFlight = request
    return request
  }

  return { getSnapshot, subscribe, setAccountKey, applyAuthoritativeCount, refresh }
}

const shared = createSocialUnreadState()

module.exports = Object.assign(shared, {
  createSocialUnreadState,
  formatUnreadCount: snapshotFor
})
