const crypto = require('crypto')
const { socialError } = require('./social-error')

const MUTATION_COLLECTION = 'social_mutations'

function mutationRecordId(actorId, clientMutationId) {
  return 'sm_' + crypto.createHash('sha256').update(String(actorId) + ':' + String(clientMutationId)).digest('hex')
}

function requireClientMutationId(event) {
  const value = String(event && event.clientMutationId || '').trim()
  if (!value || value.length > 128) throw socialError('INVALID_MUTATION', 'invalid mutation')
  return value
}

async function runIdempotent(repository, actorId, action, event, callback) {
  const clientMutationId = requireClientMutationId(event)
  const id = mutationRecordId(actorId, clientMutationId)
  return repository.runTransaction(async store => {
    const existing = await store.get(MUTATION_COLLECTION, id)
    if (existing) {
      if (existing.actorId !== actorId || existing.action !== action) throw socialError('MUTATION_CONFLICT', 'mutation conflict')
      return existing.result
    }
    const result = await callback(store)
    await store.set(MUTATION_COLLECTION, id, {
      actorId,
      action,
      clientMutationId,
      result,
      createdAt: Date.now()
    })
    return result
  })
}

module.exports = { MUTATION_COLLECTION, mutationRecordId, requireClientMutationId, runIdempotent }
