const { socialError } = require('./social-error')

const USER_COLLECTION = 'social_users'
const BEIJING_OFFSET_MINUTES = 8 * 60

function normalizePlayerId(value) {
  return String(value || '').trim().toUpperCase()
}

function isValidDateTimeParts(year, month, day, hour, minute, second) {
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return false
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day <= daysInMonth
}

function millisecondsFromFraction(value) {
  const fraction = String(value || '')
  return fraction ? Number(fraction.padEnd(3, '0')) : 0
}

function parseTime(value, timezoneOffsetMinutes) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime()
  const text = String(value || '').trim()
  if (!text) return null
  const zoned = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-](\d{2}):(\d{2}))$/)
  if (zoned) {
    const year = Number(zoned[1])
    const month = Number(zoned[2])
    const day = Number(zoned[3])
    const hour = Number(zoned[4])
    const minute = Number(zoned[5])
    const second = Number(zoned[6] || 0)
    const offsetHour = Number(zoned[9] || 0)
    const offsetMinute = Number(zoned[10] || 0)
    if (!isValidDateTimeParts(year, month, day, hour, minute, second) || offsetHour > 23 || offsetMinute > 59) return null
    const timestamp = Date.parse(text)
    return Number.isFinite(timestamp) ? timestamp : null
  }
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4] || 0)
  const minute = Number(match[5] || 0)
  const second = Number(match[6] || 0)
  if (!isValidDateTimeParts(year, month, day, hour, minute, second)) return null
  const timestamp = Date.UTC(
    year, month - 1, day, hour, minute, second, millisecondsFromFraction(match[7])
  ) - (Number(timezoneOffsetMinutes) || BEIJING_OFFSET_MINUTES) * 60000
  return Number.isFinite(timestamp) ? timestamp : null
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
  if (start === null || end === null || end <= start) return
  let cursor = start
  const chunks = []
  while (cursor < end) {
    const boundary = nextDayBoundary(cursor, timezoneOffsetMinutes)
    const chunkEnd = Math.min(end, boundary)
    chunks.push({ dateKey: dateKeyAt(cursor, timezoneOffsetMinutes), milliseconds: chunkEnd - cursor })
    cursor = chunkEnd
  }
  const totalMinutes = Math.round((end - start) / 60000)
  let allocatedMinutes = 0
  chunks.forEach(chunk => {
    chunk.minutes = Math.floor(chunk.milliseconds / 60000)
    allocatedMinutes += chunk.minutes
  })
  chunks
    .map((chunk, index) => ({ chunk, index, remainder: chunk.milliseconds % 60000 }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index)
    .slice(0, Math.max(0, totalMinutes - allocatedMinutes))
    .forEach(item => { item.chunk.minutes += 1 })
  chunks.forEach(chunk => addBucket(map, chunk.dateKey, chunk.minutes, 0))
}

function handTimestamp(hand, timezoneOffsetMinutes) {
  const source = hand || {}
  const values = [source.playedDate, source.playedAt, source.handTime, source.recordedAt, source.createdAt]
  for (const value of values) {
    const timestamp = parseTime(value, timezoneOffsetMinutes)
    if (timestamp !== null) return timestamp
  }
  return null
}

function buildDailyBuckets(input) {
  const source = input || {}
  const timezoneOffsetMinutes = Number(source.timezoneOffsetMinutes) || BEIJING_OFFSET_MINUTES
  const buckets = Object.create(null)
  ;(Array.isArray(source.sessions) ? source.sessions : []).forEach(session => addSessionDuration(buckets, session, timezoneOffsetMinutes))
  ;(Array.isArray(source.hands) ? source.hands : []).forEach(hand => {
    const timestamp = handTimestamp(hand, timezoneOffsetMinutes)
    if (timestamp !== null) addBucket(buckets, dateKeyAt(timestamp, timezoneOffsetMinutes), 0, 1)
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
      if (typeof repository.listPrivateOwned !== 'function' || typeof repository.replaceDailyStats !== 'function' || typeof repository.patchSocialUserStats !== 'function') {
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
      await repository.patchSocialUserStats(user._id, {
        title,
        publicStats: { durationMinutes: totalDurationMinutes, recordedHandCount: totalRecordedHandCount },
        updatedAt: Date.now()
      })
      return { title, totalDurationMinutes, totalRecordedHandCount, syncedDayCount: buckets.length }
    }
  }
}

module.exports = { BEIJING_OFFSET_MINUTES, normalizePlayerId, parseTime, buildDailyBuckets, calculateTitle, createRankingHandlers }
