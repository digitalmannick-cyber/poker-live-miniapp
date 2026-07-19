const { socialError } = require('./social-error')

const USER_COLLECTION = 'social_users'
const BEIJING_OFFSET_MINUTES = 8 * 60

function normalizePlayerId(value) {
  return String(value || '').trim().toUpperCase()
}

function parseTime(value, timezoneOffsetMinutes) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime()
  const text = String(value || '').trim()
  if (!text) return 0
  if (/Z$|[+-]\d\d:\d\d$/.test(text)) {
    const timestamp = Date.parse(text)
    return Number.isFinite(timestamp) ? timestamp : 0
  }
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (!match) {
    const timestamp = Date.parse(text)
    return Number.isFinite(timestamp) ? timestamp : 0
  }
  const timestamp = Date.UTC(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0)
  ) - (Number(timezoneOffsetMinutes) || BEIJING_OFFSET_MINUTES) * 60000
  return Number.isFinite(timestamp) ? timestamp : 0
}

function dateKeyAt(timestamp, timezoneOffsetMinutes) {
  const local = new Date(timestamp + (Number(timezoneOffsetMinutes) || BEIJING_OFFSET_MINUTES) * 60000)
  if (Number.isNaN(local.getTime())) return ''
  return String(local.getUTCFullYear()) +
    String(local.getUTCMonth() + 1).padStart(2, '0') +
    String(local.getUTCDate()).padStart(2, '0')
}

function nextDayBoundary(timestamp, timezoneOffsetMinutes) {
  const offset = (Number(timezoneOffsetMinutes) || BEIJING_OFFSET_MINUTES) * 60000
  const local = new Date(timestamp + offset)
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1) - offset
}

function addBucket(map, dateKey, durationMinutes, recordedHandCount) {
  if (!dateKey) return
  const bucket = map[dateKey] || (map[dateKey] = { dateKey, durationMinutes: 0, recordedHandCount: 0 })
  bucket.durationMinutes += Math.max(0, Math.floor(Number(durationMinutes) || 0))
  bucket.recordedHandCount += Math.max(0, Math.floor(Number(recordedHandCount) || 0))
}

function addSessionDuration(map, session, timezoneOffsetMinutes) {
  if (!session || session.status !== 'finished') return
  const start = parseTime(session.startTime || session.startedAt, timezoneOffsetMinutes)
  const end = parseTime(session.endTime || session.endedAt || session.finishedAt, timezoneOffsetMinutes)
  if (!start || !end || end <= start) return
  let cursor = start
  while (cursor < end) {
    const boundary = nextDayBoundary(cursor, timezoneOffsetMinutes)
    const chunkEnd = Math.min(end, boundary)
    const minutes = Math.round((chunkEnd - cursor) / 60000)
    if (minutes > 0) addBucket(map, dateKeyAt(cursor, timezoneOffsetMinutes), minutes, 0)
    cursor = chunkEnd
  }
}

function handTimestamp(hand, timezoneOffsetMinutes) {
  const source = hand || {}
  const values = [source.playedDate, source.playedAt, source.handTime, source.recordedAt, source.createdAt]
  for (const value of values) {
    const timestamp = parseTime(value, timezoneOffsetMinutes)
    if (timestamp) return timestamp
  }
  return 0
}

function buildDailyBuckets(input) {
  const source = input || {}
  const timezoneOffsetMinutes = Number(source.timezoneOffsetMinutes) || BEIJING_OFFSET_MINUTES
  const buckets = Object.create(null)
  ;(Array.isArray(source.sessions) ? source.sessions : []).forEach(session => addSessionDuration(buckets, session, timezoneOffsetMinutes))
  ;(Array.isArray(source.hands) ? source.hands : []).forEach(hand => {
    const timestamp = handTimestamp(hand, timezoneOffsetMinutes)
    if (timestamp) addBucket(buckets, dateKeyAt(timestamp, timezoneOffsetMinutes), 0, 1)
  })
  return Object.keys(buckets)
    .sort()
    .map(key => buckets[key])
    .filter(item => item.durationMinutes > 0 || item.recordedHandCount > 0)
}

function calculateTitle(totalDurationMinutes) {
  const minutes = Math.max(0, Number(totalDurationMinutes) || 0)
  if (minutes >= 6000) return '深夜局观察员'
  if (minutes >= 2400) return '牌桌常客'
  if (minutes >= 600) return '夜场熟客'
  return '初来乍到'
}

function createRankingHandlers(repository, options) {
  const config = options || {}
  const timezoneOffsetMinutes = Number(config.timezoneOffsetMinutes) || BEIJING_OFFSET_MINUTES
  return {
    async sync_my_social_stats(event, actor) {
      const user = await repository.find(USER_COLLECTION, { ownerOpenId: actor.ownerOpenId })
      if (!user) throw socialError('SOCIAL_PROFILE_REQUIRED', 'social profile required')
      const playerId = normalizePlayerId(event && event.playerId)
      if (!playerId || playerId !== normalizePlayerId(user.privatePlayerId)) {
        throw socialError('FORBIDDEN', 'not allowed')
      }
      if (typeof repository.listPrivateOwned !== 'function' || typeof repository.replaceDailyStats !== 'function') {
        throw new Error('social repository stats support unavailable')
      }
      const [sessions, hands] = await Promise.all([
        repository.listPrivateOwned('sessions', actor.ownerOpenId, playerId),
        repository.listPrivateOwned('hands', actor.ownerOpenId, playerId)
      ])
      const buckets = buildDailyBuckets({ sessions, hands, timezoneOffsetMinutes })
      await repository.replaceDailyStats(user._id, buckets)
      const totalDurationMinutes = buckets.reduce((sum, item) => sum + item.durationMinutes, 0)
      const totalRecordedHandCount = buckets.reduce((sum, item) => sum + item.recordedHandCount, 0)
      const title = calculateTitle(totalDurationMinutes)
      await repository.set(USER_COLLECTION, user._id, Object.assign({}, user, {
        title,
        publicStats: { durationMinutes: totalDurationMinutes, recordedHandCount: totalRecordedHandCount },
        updatedAt: Date.now()
      }))
      return { title, totalDurationMinutes, totalRecordedHandCount, syncedDayCount: buckets.length }
    }
  }
}

module.exports = { BEIJING_OFFSET_MINUTES, normalizePlayerId, parseTime, buildDailyBuckets, calculateTitle, createRankingHandlers }
