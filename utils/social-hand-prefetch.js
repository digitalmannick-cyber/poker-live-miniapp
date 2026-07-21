const MAX_AGE_MS = 30000
const entries = new Map()

function keyOf(shareId) {
  return String(shareId || '').trim()
}

function prefetch(shareId, loader) {
  const key = keyOf(shareId)
  if (!key || typeof loader !== 'function') return Promise.reject(new Error('invalid hand prefetch'))
  const current = entries.get(key)
  if (current && current.promise) return current.promise
  const promise = Promise.resolve().then(loader).then(value => {
    entries.set(key, { value, updatedAt: Date.now() })
    return value
  }, error => {
    entries.delete(key)
    throw error
  })
  entries.set(key, { promise, updatedAt: Date.now() })
  return promise
}

function consume(shareId) {
  const key = keyOf(shareId)
  const entry = key ? entries.get(key) : null
  if (key) entries.delete(key)
  if (!entry || !entry.value || Date.now() - Number(entry.updatedAt || 0) > MAX_AGE_MS) return null
  return entry.value
}

function clearForTest() {
  entries.clear()
}

module.exports = { prefetch, consume, __test: { clearForTest } }
