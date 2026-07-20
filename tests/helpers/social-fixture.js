function createMemorySocialRepository(seed) {
  const tables = JSON.parse(JSON.stringify(seed || {}))

  function exactOwner(row, ownerOpenId, privatePlayerId) {
    return String(row && (row.ownerOpenId || row._openid) || '') === String(ownerOpenId || '') &&
      String(row && (row.privatePlayerId || row.playerId) || '') === String(privatePlayerId || '')
  }

  function createStore(source, transactionMode) {
    const store = {
    get(collection, id) {
      return (source[collection] || []).find(row => row._id === id) || null
    },
    set(collection, id, value) {
      const rows = source[collection] || (source[collection] = [])
      const index = rows.findIndex(row => row._id === id)
      const next = Object.assign({}, value, { _id: id })
      if (index >= 0) rows[index] = next
      else rows.push(next)
      return next
    },
    find(collection, query) {
      const filters = query || {}
      return (source[collection] || []).find(row => Object.keys(filters).every(key => row[key] === filters[key])) || null
    },
    where(collection, predicate) {
      return (source[collection] || []).filter(predicate)
    },
    listNotifications(recipientId, page) {
      const cursor = page && page.cursor
      const limit = Math.min(50, Math.max(1, Number(page && page.limit) || 20))
      return (source.social_notifications || [])
        .filter(row => row.recipientId === recipientId)
        .sort((left, right) => Number(right.createdAt) - Number(left.createdAt) || String(right._id).localeCompare(String(left._id)))
        .filter(row => !cursor || Number(row.createdAt) < Number(cursor.createdAt) || (Number(row.createdAt) === Number(cursor.createdAt) && String(row._id) < String(cursor.id)))
        .slice(0, limit + 1)
    },
    findSocialUserByOpenId(ownerOpenId) {
      return (source.social_users || []).find(row => row.ownerOpenId === ownerOpenId) || null
    },
    listOwnedHandActions(ownerOpenId, privatePlayerId, handId) {
      return (source.hand_actions || [])
        .filter(row => exactOwner(row, ownerOpenId, privatePlayerId) && String(row.handId || '') === String(handId || '') &&
          true)
        .sort((left, right) => Number(left.sequence) - Number(right.sequence) || String(left._id).localeCompare(String(right._id)))
    },
    findOneAcceptedFriend(socialUserId) {
      return (source.social_friendships || []).find(row => row.status === 'accepted' &&
        (row.userA === socialUserId || row.userB === socialUserId)) || null
    },
    listNotificationOutboxesForRecipient(recipientId, limit) {
      return (source.social_notification_outbox || [])
        .filter(row => row.status === 'pending' && Array.isArray(row.targetUserIds) && row.targetUserIds.includes(recipientId))
        .sort((left, right) => Number(left.createdAt) - Number(right.createdAt) || String(left._id).localeCompare(String(right._id)))
        .slice(0, Math.max(0, Number(limit) || 0))
    },
    dump() {
      return JSON.parse(JSON.stringify(source))
    }
    }
    if (transactionMode) {
      for (const key of ['find', 'findSocialUserByOpenId', 'where', 'listNotifications', 'listOwnedHandActions', 'findOneAcceptedFriend', 'listNotificationOutboxesForRecipient', 'dump']) {
        delete store[key]
      }
    }
    return store
  }

  const repository = createStore(tables)
  let transactionTail = Promise.resolve()
  repository.runTransaction = callback => {
    const transaction = transactionTail.then(async () => {
      const draft = JSON.parse(JSON.stringify(tables))
      const result = await callback(createStore(draft, true))
      for (const key of Object.keys(tables)) delete tables[key]
      for (const [key, value] of Object.entries(draft)) tables[key] = value
      return result
    })
    transactionTail = transaction.then(() => undefined, () => undefined)
    return transaction
  }
  return repository
}

module.exports = { createMemorySocialRepository }
