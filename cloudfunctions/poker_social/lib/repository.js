const SOCIAL_COLLECTIONS = Object.freeze({
  SOCIAL_USERS: 'social_users',
  SOCIAL_FRIENDSHIPS: 'social_friendships',
  SOCIAL_INVITES: 'social_invites',
  SOCIAL_MUTATIONS: 'social_mutations',
  SOCIAL_DAILY_STATS: 'social_daily_stats',
  SOCIAL_PLAYER_CARD_SHARES: 'social_player_card_shares'
})

const PRIVATE_PAGE_SIZE = 100

function isDocumentNotFound(error) {
  const code = String(error && (error.errCode || error.code) || '')
  return code === 'DATABASE_DOCUMENT_NOT_EXIST'
}

function createCloudSocialRepository(database) {
  if (!database || typeof database.collection !== 'function') {
    throw new Error('cloud database unavailable')
  }

  function createStore(client) {
    return {
    async get(collection, id) {
      try {
        const response = await client.collection(collection).doc(id).get()
        return response && response.data || null
      } catch (error) {
        if (isDocumentNotFound(error)) return null
        throw error
      }
    },

    async find(collection, query) {
      const response = await client.collection(collection).where(query || {}).limit(1).get()
      return response && Array.isArray(response.data) && response.data[0] || null
    },

    async set(collection, id, value) {
      const record = Object.assign({}, value, { _id: id })
      const data = Object.assign({}, record)
      delete data._id
      await client.collection(collection).doc(id).set({ data })
      return record
    },

    async patchSocialUserStats(id, patch) {
      const source = patch || {}
      const data = {
        title: String(source.title || ''),
        publicStats: {
          durationMinutes: Math.max(0, Math.floor(Number(source.publicStats && source.publicStats.durationMinutes) || 0)),
          recordedHandCount: Math.max(0, Math.floor(Number(source.publicStats && source.publicStats.recordedHandCount) || 0))
        },
        updatedAt: Number(source.updatedAt) || Date.now()
      }
      await client.collection(SOCIAL_COLLECTIONS.SOCIAL_USERS).doc(id).update({ data })
      return Object.assign({ _id: id }, data)
    },

    async patchSocialSettings(id, patch) {
      const source = patch || {}
      const data = {
        statsVisible: source.statsVisible !== false,
        defaultShareScope: String(source.defaultShareScope || 'friends'),
        updatedAt: Number(source.updatedAt) || Date.now()
      }
      await client.collection(SOCIAL_COLLECTIONS.SOCIAL_USERS).doc(id).update({ data })
      return Object.assign({ _id: id }, data)
    },

    async listPrivateOwned(collection, ownerOpenId, playerId) {
      const rows = []
      let offset = 0
      while (true) {
        let request = client.collection(collection).where({ ownerOpenId, playerId })
        if (typeof request.skip === 'function') request = request.skip(offset)
        if (typeof request.limit === 'function') request = request.limit(PRIVATE_PAGE_SIZE)
        const response = await request.get()
        const batch = Array.isArray(response && response.data) ? response.data : []
        rows.push.apply(rows, batch)
        if (batch.length < PRIVATE_PAGE_SIZE) return rows
        offset += batch.length
      }
    },

    async replaceDailyStats(socialUserId, buckets) {
      const collection = client.collection(SOCIAL_COLLECTIONS.SOCIAL_DAILY_STATS)
      while (true) {
        const existing = await collection.where({ socialUserId }).limit(PRIVATE_PAGE_SIZE).get()
        const oldRows = Array.isArray(existing && existing.data) ? existing.data : []
        for (const row of oldRows) {
          await collection.doc(row._id).remove()
        }
        if (oldRows.length < PRIVATE_PAGE_SIZE) break
      }
      const next = Array.isArray(buckets) ? buckets : []
      for (const bucket of next) {
        const dateKey = String(bucket && bucket.dateKey || '')
        if (!/^\d{8}$/.test(dateKey)) continue
        await this.set(SOCIAL_COLLECTIONS.SOCIAL_DAILY_STATS, 'sd_' + socialUserId + '_' + dateKey, {
          socialUserId,
          dateKey,
          durationMinutes: Math.max(0, Math.floor(Number(bucket.durationMinutes) || 0)),
          recordedHandCount: Math.max(0, Math.floor(Number(bucket.recordedHandCount) || 0)),
          updatedAt: Date.now()
        })
      }
    },

    async listDailyStats(socialUserIds) {
      const rows = []
      for (const socialUserId of Array.from(new Set((socialUserIds || []).map(String).filter(Boolean)))) {
        let offset = 0
        while (true) {
          let request = client.collection(SOCIAL_COLLECTIONS.SOCIAL_DAILY_STATS).where({ socialUserId })
          if (typeof request.skip === 'function') request = request.skip(offset)
          if (typeof request.limit === 'function') request = request.limit(PRIVATE_PAGE_SIZE)
          const response = await request.get()
          const batch = Array.isArray(response && response.data) ? response.data : []
          rows.push.apply(rows, batch)
          if (batch.length < PRIVATE_PAGE_SIZE) break
          offset += batch.length
        }
      }
      return rows
    },

    async listAcceptedFriendships(socialUserId, page) {
      const offset = Math.max(0, Number(page && page.offset) || 0)
      const limit = Math.min(50, Math.max(1, Number(page && page.limit) || 20))
      const required = offset + limit + 1
      const querySide = async key => {
        const rows = []
        while (rows.length < required) {
          const batchSize = Math.min(100, required - rows.length)
          let request = client.collection(SOCIAL_COLLECTIONS.SOCIAL_FRIENDSHIPS)
            .where({ [key]: socialUserId, status: 'accepted' })
          if (typeof request.orderBy === 'function') {
            request = request.orderBy('acceptedAt', 'desc').orderBy('_id', 'asc')
          }
          if (typeof request.skip === 'function') request = request.skip(rows.length)
          if (typeof request.limit === 'function') request = request.limit(batchSize)
          const response = await request.get()
          const batch = Array.isArray(response && response.data) ? response.data : []
          rows.push.apply(rows, batch)
          if (batch.length < batchSize) break
        }
        return rows
      }
      const [left, right] = await Promise.all([querySide('userA'), querySide('userB')])
      const all = left.concat(right).sort((a, b) => {
        const timeDelta = Number(b.acceptedAt || b.updatedAt || 0) - Number(a.acceptedAt || a.updatedAt || 0)
        return timeDelta || String(a._id).localeCompare(String(b._id))
      })
      const items = all.slice(offset, offset + limit)
      return { items, nextOffset: all.length > offset + limit ? offset + limit : null }
    }
    }
  }

  const store = createStore(database)
  return Object.assign(store, {
    async runTransaction(callback) {
      if (typeof database.runTransaction !== 'function') return callback(store)
      return database.runTransaction(transaction => callback(createStore(transaction)))
    }
  })
}

module.exports = { SOCIAL_COLLECTIONS, createCloudSocialRepository }
