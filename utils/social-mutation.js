function createMutationId(prefix) {
  return String(prefix || 'social') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10)
}

module.exports = { createMutationId }
