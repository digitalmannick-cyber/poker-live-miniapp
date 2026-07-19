const SOCIAL_COLLECTIONS = Object.freeze({
  SOCIAL_USERS: 'social_users',
  SOCIAL_FRIENDSHIPS: 'social_friendships',
  SOCIAL_INVITES: 'social_invites',
  SOCIAL_MUTATIONS: 'social_mutations'
})

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

    async listAcceptedFriendships(socialUserId, page) {
      const offset = Math.max(0, Number(page && page.offset) || 0)
      const limit = Math.min(50, Math.max(1, Number(page && page.limit) || 20))
      const perSideLimit = offset + limit + 1
      const querySide = async key => {
        let request = client.collection(SOCIAL_COLLECTIONS.SOCIAL_FRIENDSHIPS)
          .where({ [key]: socialUserId, status: 'accepted' })
        if (typeof request.limit === 'function') request = request.limit(perSideLimit)
        const response = await request.get()
        return Array.isArray(response && response.data) ? response.data : []
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
