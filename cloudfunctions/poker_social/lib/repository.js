const { socialError } = require('./social-error')

const SOCIAL_COLLECTIONS = Object.freeze({
  SOCIAL_USERS: 'social_users',
  SOCIAL_FRIENDSHIPS: 'social_friendships',
  SOCIAL_INVITES: 'social_invites',
  SOCIAL_MUTATIONS: 'social_mutations',
  SOCIAL_DAILY_STATS: 'social_daily_stats',
  SOCIAL_PLAYER_CARD_SHARES: 'social_player_card_shares',
  SOCIAL_NOTIFICATIONS: 'social_notifications',
  SOCIAL_NOTIFICATION_STATE: 'social_notification_state',
  SOCIAL_NOTIFICATION_HEADS: 'social_notification_heads',
  SOCIAL_NOTIFICATION_ACTORS: 'social_notification_actors',
  SOCIAL_HAND_SHARES: 'social_hand_shares',
  SOCIAL_HAND_SHARE_SLOTS: 'social_hand_share_slots',
  SOCIAL_RATE_LIMITS: 'social_rate_limits',
  SOCIAL_NOTIFICATION_OUTBOX: 'social_notification_outbox',
  SOCIAL_LIKES: 'social_likes',
  SOCIAL_COMMENTS: 'social_comments'
})

const ACCOUNT_CLEAR_SOCIAL_COLLECTIONS = Object.freeze(Object.values(SOCIAL_COLLECTIONS))

const PRIVATE_PAGE_SIZE = 100
const FRIEND_ID_QUERY_CHUNK_SIZE = 10

function isDocumentNotFound(error) {
  const code = String(error && (error.errCode || error.code) || '')
  return code === 'DATABASE_DOCUMENT_NOT_EXIST'
}

function createCloudSocialRepository(database) {
  if (!database || typeof database.collection !== 'function') {
    throw new Error('cloud database unavailable')
  }

  function createStore(client, transactionMode) {
    function requireCommand(methods) {
      const command = database.command
      for (const method of methods) {
        if (!command || typeof command[method] !== 'function') throw new Error('cloud database command unavailable')
      }
      return command
    }

    function shareKeysetFilter(base, cursor) {
      if (!cursor) return base
      const command = requireCommand(['and', 'or', 'lt', 'eq'])
      return command.and([
        base,
        command.or([
          { createdAt: command.lt(Number(cursor.createdAt)) },
          command.and([
            { createdAt: command.eq(Number(cursor.createdAt)) },
            { _id: command.lt(String(cursor.id || '')) }
          ])
        ])
      ])
    }

    function commentKeysetFilter(shareId, cursor) {
      const base = { shareId: String(shareId || '') }
      if (!cursor) return base
      const command = requireCommand(['and', 'or', 'lt', 'eq'])
      return command.and([
        base,
        command.or([
          { createdAt: command.lt(Number(cursor.createdAt)) },
          command.and([
            { createdAt: command.eq(Number(cursor.createdAt)) },
            { _id: command.lt(String(cursor.id || '')) }
          ])
        ])
      ])
    }

    async function listShareCandidates(base, page) {
      const limit = Math.min(100, Math.max(1, Number(page && page.limit) || 20))
      let request = client.collection(SOCIAL_COLLECTIONS.SOCIAL_HAND_SHARES)
        .where(shareKeysetFilter(base, page && page.cursor))
      if (typeof request.orderBy !== 'function' || typeof request.limit !== 'function') throw new Error('feed share query unavailable')
      request = request.orderBy('createdAt', 'desc').orderBy('_id', 'desc').limit(limit)
      const response = await request.get()
      return Array.isArray(response && response.data) ? response.data : []
    }

    const store = {
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

    async findSocialUserByOpenId(ownerOpenId) {
      const response = await client.collection(SOCIAL_COLLECTIONS.SOCIAL_USERS)
        .where({ ownerOpenId: String(ownerOpenId || '') }).limit(1).get()
      return response && Array.isArray(response.data) && response.data[0] || null
    },

    async listOwnedHandActions(ownerOpenId, privatePlayerId, handId) {
      const queryOwnerField = async ownerField => {
        const filters = {
          [ownerField]: String(ownerOpenId || ''),
          playerId: String(privatePlayerId || ''),
          handId: String(handId || '')
        }
        const countRequest = client.collection('hand_actions').where(filters)
        if (typeof countRequest.count !== 'function') throw socialError('HAND_ACTIONS_LIMIT_EXCEEDED', 'hand actions limit exceeded')
        const countResponse = await countRequest.count()
        const total = Number(countResponse && countResponse.total)
        if (!Number.isSafeInteger(total) || total < 0 || total > PRIVATE_PAGE_SIZE) {
          throw socialError('HAND_ACTIONS_LIMIT_EXCEEDED', 'hand actions limit exceeded')
        }
        let request = client.collection('hand_actions').where(filters)
        if (typeof request.orderBy !== 'function' || typeof request.limit !== 'function') throw new Error('exact action query unavailable')
        request = request.orderBy('sequence', 'asc').orderBy('_id', 'asc').limit(PRIVATE_PAGE_SIZE)
        const response = await request.get()
        const rows = Array.isArray(response && response.data) ? response.data : []
        if (rows.length !== total) throw socialError('HAND_ACTIONS_LIMIT_EXCEEDED', 'hand actions limit exceeded')
        return rows
      }
      const modern = await queryOwnerField('ownerOpenId')
      const legacy = await queryOwnerField('_openid')
      const byId = new Map()
      modern.concat(legacy).forEach(row => byId.set(String(row && row._id || ''), row))
      const rows = Array.from(byId.values())
      if (rows.length > PRIVATE_PAGE_SIZE) throw socialError('HAND_ACTIONS_LIMIT_EXCEEDED', 'hand actions limit exceeded')
      return rows.sort((left, right) => Number(left.sequence) - Number(right.sequence) || String(left._id || '').localeCompare(String(right._id || '')))
    },

    async findOneAcceptedFriend(socialUserId) {
      const querySide = async key => {
        let request = client.collection(SOCIAL_COLLECTIONS.SOCIAL_FRIENDSHIPS)
          .where({ [key]: String(socialUserId || ''), status: 'accepted' })
        if (typeof request.orderBy !== 'function' || typeof request.limit !== 'function') throw new Error('friend witness query unavailable')
        request = request.orderBy('acceptedAt', 'desc').orderBy('_id', 'asc').limit(1)
        const response = await request.get()
        return Array.isArray(response && response.data) ? response.data[0] || null : null
      }
      const left = await querySide('userA')
      const right = await querySide('userB')
      if (!left) return right
      if (!right) return left
      return Number(left.acceptedAt || 0) >= Number(right.acceptedAt || 0) ? left : right
    },

    async listNotificationOutboxesForRecipient(recipientId, limit) {
      let request = client.collection(SOCIAL_COLLECTIONS.SOCIAL_NOTIFICATION_OUTBOX).where({
        status: 'pending', targetUserIds: String(recipientId || '')
      })
      if (typeof request.orderBy !== 'function' || typeof request.limit !== 'function') throw new Error('outbox query unavailable')
      request = request.orderBy('createdAt', 'asc').orderBy('_id', 'asc').limit(Math.min(5, Math.max(1, Number(limit) || 5)))
      const response = await request.get()
      return Array.isArray(response && response.data) ? response.data : []
    },

    async listSquareShareCandidates(page) {
      return listShareCandidates({ status: 'active', scope: 'square' }, page)
    },

    async listSelfShareCandidates(viewerId, page) {
      return listShareCandidates({ publisherId: String(viewerId || ''), status: 'active' }, page)
    },

    async listFriendShareCandidates(publisherIds, page) {
      const values = Array.from(new Set((Array.isArray(publisherIds) ? publisherIds : []).map(String).filter(Boolean)))
      if (!values.length || values.length > FRIEND_ID_QUERY_CHUNK_SIZE) throw new Error('feed friend chunk unavailable')
      const command = requireCommand(['in'])
      return listShareCandidates({ publisherId: command.in(values), status: 'active' }, page)
    },

    async listSelectedShareCandidates(viewerId, page) {
      return listShareCandidates({ targetUserIds: String(viewerId || ''), status: 'active' }, page)
    },

    async listAcceptedFriendshipsBySideKeyset(viewerId, side, page) {
      if (side !== 'userA' && side !== 'userB') throw new Error('feed friendship side unavailable')
      const cursor = page && page.cursor
      let filters = { [side]: String(viewerId || ''), status: 'accepted' }
      if (cursor) {
        const command = requireCommand(['and', 'or', 'lt', 'eq', 'gt'])
        filters = command.and([
          filters,
          command.or([
            { acceptedAt: command.lt(Number(cursor.acceptedAt)) },
            command.and([
              { acceptedAt: command.eq(Number(cursor.acceptedAt)) },
              { _id: command.gt(String(cursor.id || '')) }
            ])
          ])
        ])
      }
      const limit = Math.min(100, Math.max(1, Number(page && page.limit) || 100))
      let request = client.collection(SOCIAL_COLLECTIONS.SOCIAL_FRIENDSHIPS).where(filters)
      if (typeof request.orderBy !== 'function' || typeof request.limit !== 'function') throw new Error('feed friendship query unavailable')
      request = request.orderBy('acceptedAt', 'desc').orderBy('_id', 'asc').limit(limit)
      const response = await request.get()
      return Array.isArray(response && response.data) ? response.data : []
    },

    async getSourceHandById(handId) {
      return store.get('hands', String(handId || ''))
    },

    async getHandShareById(shareId) {
      return store.get(SOCIAL_COLLECTIONS.SOCIAL_HAND_SHARES, String(shareId || ''))
    },

    async getLikeById(likeId) {
      return store.get(SOCIAL_COLLECTIONS.SOCIAL_LIKES, String(likeId || ''))
    },

    async listComments(shareId, page) {
      const limit = Math.min(51, Math.max(1, Number(page && page.limit) || 20))
      let request = client.collection(SOCIAL_COLLECTIONS.SOCIAL_COMMENTS)
        .where(commentKeysetFilter(shareId, page && page.cursor))
      if (typeof request.orderBy !== 'function' || typeof request.limit !== 'function') throw new Error('comment query unavailable')
      request = request.orderBy('createdAt', 'desc').orderBy('_id', 'desc').limit(limit)
      const response = await request.get()
      return Array.isArray(response && response.data) ? response.data : []
    },

    async set(collection, id, value) {
      const record = Object.assign({}, value, { _id: id })
      const data = Object.assign({}, record)
      delete data._id
      await client.collection(collection).doc(id).set({ data })
      return record
    },

    async remove(collection, id) {
      await client.collection(collection).doc(id).remove()
      return true
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
    },

    async listNotifications(recipientId, page) {
      const cursor = page && page.cursor
      const limit = Math.min(50, Math.max(1, Number(page && page.limit) || 20))
      let query = { recipientId: String(recipientId || '') }
      if (cursor) {
        const command = database.command
        if (!command || typeof command.and !== 'function' || typeof command.or !== 'function' || typeof command.lt !== 'function' || typeof command.eq !== 'function') {
          throw new Error('cloud database command unavailable')
        }
        query = command.and([
          { recipientId: String(recipientId || '') },
          command.or([
            { createdAt: command.lt(Number(cursor.createdAt)) },
            command.and([
              { createdAt: command.eq(Number(cursor.createdAt)) },
              { _id: command.lt(String(cursor.id || '')) }
            ])
          ])
        ])
      }
      let request = client.collection(SOCIAL_COLLECTIONS.SOCIAL_NOTIFICATIONS).where(query)
      if (typeof request.orderBy === 'function') request = request.orderBy('createdAt', 'desc').orderBy('_id', 'desc')
      if (typeof request.limit === 'function') request = request.limit(limit + 1)
      const response = await request.get()
      return Array.isArray(response && response.data) ? response.data : []
    }
    }
    if (transactionMode) return { get: store.get, set: store.set, remove: store.remove }
    return store
  }

  const store = createStore(database)
  return Object.assign(store, {
    async runTransaction(callback) {
      if (typeof database.runTransaction !== 'function') throw new Error('cloud database transactions unavailable')
      return database.runTransaction(transaction => callback(createStore(transaction, true)))
    }
  })
}

module.exports = {
  SOCIAL_COLLECTIONS,
  ACCOUNT_CLEAR_SOCIAL_COLLECTIONS,
  FRIEND_ID_QUERY_CHUNK_SIZE,
  createCloudSocialRepository
}
