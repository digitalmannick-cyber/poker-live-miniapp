const SESSION_STATUS_OPTIONS = [
  { key: 'active', label: '进行中' },
  { key: 'finished', label: '已结束' }
]

function normalizeSessionStatus(value) {
  return value === 'active' ? 'active' : 'finished'
}

function hasActiveSession(sessions) {
  return (sessions || []).some(item => item && item.status === 'active')
}

function getDefaultSessionStatus(sessions) {
  return hasActiveSession(sessions) ? 'active' : 'finished'
}

function resolveSessionStatus(options) {
  const config = options || {}
  const sessions = config.sessions || []
  const legacySession = config.legacySessionId
    ? sessions.find(item => item && item._id === config.legacySessionId)
    : null
  const requested = config.requestedStatus || (legacySession && legacySession.status)
  const normalized = requested === 'active' || requested === 'finished'
    ? requested
    : getDefaultSessionStatus(sessions)
  if (normalized === 'active' && !hasActiveSession(sessions)) return 'finished'
  return normalized
}

function filterHandsBySessionStatus(hands, sessions, status) {
  const normalized = normalizeSessionStatus(status)
  const allowedSessionIds = new Set(
    (sessions || [])
      .filter(item => item && item.status === normalized)
      .map(item => item._id)
  )
  return (hands || []).filter(item => item && allowedSessionIds.has(item.sessionId))
}

function buildSessionStatusOptions(status) {
  const normalized = normalizeSessionStatus(status)
  return SESSION_STATUS_OPTIONS.map(item => Object.assign({}, item, {
    active: item.key === normalized
  }))
}

function getSessionStatusLabel(status) {
  return normalizeSessionStatus(status) === 'active' ? '进行中牌局' : '已结束牌局'
}

module.exports = {
  SESSION_STATUS_OPTIONS,
  normalizeSessionStatus,
  hasActiveSession,
  getDefaultSessionStatus,
  resolveSessionStatus,
  filterHandsBySessionStatus,
  buildSessionStatusOptions,
  getSessionStatusLabel
}
