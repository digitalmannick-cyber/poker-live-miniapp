function createMemorySocialRepository(seed) {
  const tables = JSON.parse(JSON.stringify(seed || {}))

  function createStore(source) {
    return {
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
    dump() {
      return JSON.parse(JSON.stringify(source))
    }
    }
  }

  const repository = createStore(tables)
  repository.runTransaction = async callback => {
    const draft = JSON.parse(JSON.stringify(tables))
    const result = await callback(createStore(draft))
    for (const key of Object.keys(tables)) delete tables[key]
    for (const [key, value] of Object.entries(draft)) tables[key] = value
    return result
  }
  return repository
}

module.exports = { createMemorySocialRepository }
