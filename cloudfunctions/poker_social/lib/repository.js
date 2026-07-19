const SOCIAL_COLLECTIONS = Object.freeze({
  SOCIAL_USERS: 'social_users'
})

function isDocumentNotFound(error) {
  const code = String(error && (error.errCode || error.code) || '')
  return code === 'DATABASE_DOCUMENT_NOT_EXIST'
}

function createCloudSocialRepository(database) {
  if (!database || typeof database.collection !== 'function') {
    throw new Error('cloud database unavailable')
  }

  return {
    async get(collection, id) {
      try {
        const response = await database.collection(collection).doc(id).get()
        return response && response.data || null
      } catch (error) {
        if (isDocumentNotFound(error)) return null
        throw error
      }
    },

    async find(collection, query) {
      const response = await database.collection(collection).where(query || {}).limit(1).get()
      return response && Array.isArray(response.data) && response.data[0] || null
    },

    async set(collection, id, value) {
      const record = Object.assign({}, value, { _id: id })
      const data = Object.assign({}, record)
      delete data._id
      await database.collection(collection).doc(id).set({ data })
      return record
    }
  }
}

module.exports = { SOCIAL_COLLECTIONS, createCloudSocialRepository }
