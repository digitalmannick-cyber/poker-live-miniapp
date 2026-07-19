function createMemorySocialRepository(seed) {
  const tables = JSON.parse(JSON.stringify(seed || {}))
  return {
    get(collection, id) {
      return (tables[collection] || []).find(row => row._id === id) || null
    },
    set(collection, id, value) {
      const rows = tables[collection] || (tables[collection] = [])
      const index = rows.findIndex(row => row._id === id)
      const next = Object.assign({}, value, { _id: id })
      if (index >= 0) rows[index] = next
      else rows.push(next)
      return next
    },
    where(collection, predicate) {
      return (tables[collection] || []).filter(predicate)
    },
    runTransaction(callback) {
      return callback(this)
    },
    dump() {
      return JSON.parse(JSON.stringify(tables))
    }
  }
}

module.exports = { createMemorySocialRepository }
