const { socialError } = require('./social-error')
const { requireActiveSocialUser } = require('./social-lifecycle')

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

const RANGE_KEYS = new Set(['week', 'month', 'all'])

function normalizeRangeKey(value) {
  const key = String(value || 'week').trim()
  if (!RANGE_KEYS.has(key)) throw socialError('INVALID_RANKING_RANGE', 'invalid ranking range')
  return key
}

function rangeStartDateKey(rangeKey, nowTimestamp) {
  return rangeDateWindow(rangeKey, nowTimestamp).startDateKey
}

function formatLocalDateKey(date) {
  return String(date.getUTCFullYear()) + String(date.getUTCMonth() + 1).padStart(2, '0') + String(date.getUTCDate()).padStart(2, '0')
}

function rangeDateWindow(rangeKey, nowTimestamp) {
  const key = normalizeRangeKey(rangeKey)
  if (key === 'all') return { startDateKey: '', endDateKey: '' }
  const timestamp = Number(nowTimestamp)
  const now = Number.isFinite(timestamp) ? timestamp : Date.now()
  const local = new Date(now + BEIJING_OFFSET_MINUTES * 60000)
  if (key === 'month') {
    const start = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1))
    const end = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1))
    return { startDateKey: formatLocalDateKey(start), endDateKey: formatLocalDateKey(end) }
  }
  const mondayDelta = (local.getUTCDay() + 6) % 7
  const monday = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - mondayDelta))
  const nextMonday = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate() + 7))
  return { startDateKey: formatLocalDateKey(monday), endDateKey: formatLocalDateKey(nextMonday) }
}

function aggregateDailyStats(dailyRows, socialUserIds, rangeKey, nowTimestamp) {
  const ids = Array.from(new Set((socialUserIds || []).map(value => String(value || '')).filter(Boolean)))
  const window = rangeDateWindow(rangeKey, nowTimestamp)
  const totals = new Map(ids.map(id => [id, { socialUserId: id, durationMinutes: 0, recordedHandCount: 0 }]))
  ;(Array.isArray(dailyRows) ? dailyRows : []).forEach(row => {
    const id = String(row && row.socialUserId || '')
    const dateKey = String(row && row.dateKey || '')
    const total = totals.get(id)
    if (!total || !/^\d{8}$/.test(dateKey) ||
      (window.startDateKey && dateKey < window.startDateKey) ||
      (window.endDateKey && dateKey >= window.endDateKey)) return
    total.durationMinutes += Math.max(0, Math.floor(Number(row.durationMinutes) || 0))
    total.recordedHandCount += Math.max(0, Math.floor(Number(row.recordedHandCount) || 0))
  })
  return ids.map(id => totals.get(id))
}

function rankingDto(row, rank) {
  const source = row || {}
  return {
    socialUserId: String(source.socialUserId || ''),
    nickname: String(source.nickname || ''),
    avatarUrl: String(source.avatarUrl || ''),
    avatarText: String(source.avatarText || String(source.nickname || '').slice(0, 1)),
    title: String(source.title || ''),
    durationMinutes: Math.max(0, Math.floor(Number(source.durationMinutes) || 0)),
    recordedHandCount: Math.max(0, Math.floor(Number(source.recordedHandCount) || 0)),
    rank
  }
}

function rankRows(rows, viewerId) {
  const sorted = (Array.isArray(rows) ? rows : []).filter(row => Number(row && row.durationMinutes) > 0).sort((left, right) => {
    return (Number(right.durationMinutes) || 0) - (Number(left.durationMinutes) || 0) ||
      String(left.socialUserId || '').localeCompare(String(right.socialUserId || ''))
  })
  let previousMinutes = null
  let previousRank = 0
  const ranked = sorted.map((row, index) => {
    const minutes = Math.max(0, Math.floor(Number(row.durationMinutes) || 0))
    const rank = minutes === previousMinutes ? previousRank : index + 1
    previousMinutes = minutes
    previousRank = rank
    return rankingDto(row, rank)
  })
  const top10 = ranked.slice(0, 10)
  const viewer = ranked.find(row => row.socialUserId === String(viewerId || '')) || null
  return {
    top10,
    myRank: viewer && !top10.some(row => row.socialUserId === viewer.socialUserId) ? viewer : null
  }
}

function createRankingHandlers(repository, options) {
  const config = options || {}
  const timezoneOffsetMinutes = Number(config.timezoneOffsetMinutes) || BEIJING_OFFSET_MINUTES
  const now = typeof config.now === 'function' ? config.now : Date.now

  async function listAcceptedFriendships(socialUserId) {
    const rows = []
    let offset = 0
    do {
      const page = await repository.listAcceptedFriendships(socialUserId, { offset, limit: 50 })
      rows.push.apply(rows, Array.isArray(page && page.items) ? page.items : [])
      offset = page && page.nextOffset != null ? Number(page.nextOffset) : -1
    } while (Number.isFinite(offset) && offset >= 0)
    return rows
  }

  async function rankingProfile(record) {
    const profile = record && record.profile || {}
    const nickname = String(profile.nickname || '')
    const avatarUrl = profile.avatarFileId && typeof config.avatarUrl === 'function'
      ? await config.avatarUrl(profile.avatarFileId)
      : ''
    return {
      socialUserId: String(record && record._id || ''),
      nickname,
      avatarUrl,
      avatarText: String(profile.avatarText || nickname.slice(0, 1)),
      title: String(record && record.title || '初来乍到')
    }
  }
  return {
    async sync_my_social_stats(event, actor) {
      const user = await repository.find(USER_COLLECTION, { ownerOpenId: actor.ownerOpenId })
      requireActiveSocialUser(user)
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
      const totalDurationMinutes = buckets.reduce((sum, item) => sum + item.durationMinutes, 0)
      const totalRecordedHandCount = buckets.reduce((sum, item) => sum + item.recordedHandCount, 0)
      const title = calculateTitle(totalDurationMinutes)
      const statsPatch = {
        title,
        publicStats: { durationMinutes: totalDurationMinutes, recordedHandCount: totalRecordedHandCount },
        updatedAt: Date.now()
      }
      if (typeof repository.replaceSocialStatsIfActive === 'function') {
        await repository.replaceSocialStatsIfActive(user._id, buckets, statsPatch)
      } else {
        const liveUser = typeof repository.get === 'function'
          ? await repository.get(USER_COLLECTION, user._id)
          : await repository.find(USER_COLLECTION, { _id: user._id })
        requireActiveSocialUser(liveUser)
        await repository.replaceDailyStats(user._id, buckets)
        await repository.patchSocialUserStats(user._id, statsPatch)
      }
      return { title, totalDurationMinutes, totalRecordedHandCount, syncedDayCount: buckets.length }
    },

    async list_ranking(event, actor) {
      const viewer = await repository.find(USER_COLLECTION, { ownerOpenId: actor.ownerOpenId })
      requireActiveSocialUser(viewer)
      if (typeof repository.listAcceptedFriendships !== 'function' || typeof repository.listDailyStats !== 'function') {
        throw new Error('social repository ranking support unavailable')
      }
      const rangeKey = normalizeRangeKey(event && event.rangeKey)
      const friendships = await listAcceptedFriendships(viewer._id)
      const candidateIds = Array.from(new Set([viewer._id].concat(friendships.map(row => {
        if (row.userA === viewer._id) return row.userB
        if (row.userB === viewer._id) return row.userA
        return ''
      })).filter(Boolean)))
      const users = (await Promise.all(candidateIds.map(id => repository.get(USER_COLLECTION, id))))
        .filter(user => user && user.statsVisible !== false && candidateIds.includes(user._id))
      const visibleIds = users.map(user => user._id)
      const dailyRows = await repository.listDailyStats(visibleIds)
      const totals = aggregateDailyStats(dailyRows, visibleIds, rangeKey, now())
      const profiles = await Promise.all(users.map(rankingProfile))
      const profileById = new Map(profiles.map(profile => [profile.socialUserId, profile]))
      return rankRows(totals.map(total => Object.assign({}, profileById.get(total.socialUserId), total)), viewer._id)
    }
  }
}

module.exports = {
  BEIJING_OFFSET_MINUTES,
  normalizePlayerId,
  parseTime,
  buildDailyBuckets,
  calculateTitle,
  normalizeRangeKey,
  rangeStartDateKey,
  rangeDateWindow,
  aggregateDailyStats,
  rankRows,
  createRankingHandlers
}
