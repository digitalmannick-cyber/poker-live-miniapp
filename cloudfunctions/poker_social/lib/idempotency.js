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

async function runIdempotent(repository, actorId, action, event, callback, options) {
  const clientMutationId = requireClientMutationId(event)
  const id = mutationRecordId(actorId, clientMutationId)
  const config = options || {}
  const hasFingerprint = Object.prototype.hasOwnProperty.call(config, 'inputFingerprint')
  const fingerprint = hasFingerprint ? String(config.inputFingerprint || '') : ''
  if (hasFingerprint && !/^[0-9a-f]{64}$/.test(fingerprint)) throw socialError('MUTATION_CONFLICT', 'mutation conflict')
  return repository.runTransaction(async store => {
    const existing = await store.get(MUTATION_COLLECTION, id)
    if (existing) {
      if (existing.actorId !== actorId || existing.action !== action) throw socialError('MUTATION_CONFLICT', 'mutation conflict')
      if (hasFingerprint && String(existing.inputFingerprint || '') !== fingerprint) throw socialError('MUTATION_CONFLICT', 'mutation conflict')
      return typeof config.restoreResult === 'function' ? config.restoreResult(existing.result, clientMutationId, store) : existing.result
    }
    const result = await callback(store)
    const persistedResult = typeof config.persistResult === 'function'
      ? await config.persistResult(result, clientMutationId)
      : result
    const record = {
      actorId,
      action,
      clientMutationId,
      result: persistedResult,
      createdAt: Date.now()
    }
    if (hasFingerprint) record.inputFingerprint = fingerprint
    await store.set(MUTATION_COLLECTION, id, record)
    return result
  })
}

async function restoreIdempotent(repository, actorId, action, event, options) {
  const clientMutationId = requireClientMutationId(event)
  const config = options || {}
  const hasFingerprint = Object.prototype.hasOwnProperty.call(config, 'inputFingerprint')
  const fingerprint = hasFingerprint ? String(config.inputFingerprint || '') : ''
  if (hasFingerprint && !/^[0-9a-f]{64}$/.test(fingerprint)) throw socialError('MUTATION_CONFLICT', 'mutation conflict')
  const existing = await repository.get(MUTATION_COLLECTION, mutationRecordId(actorId, clientMutationId))
  if (!existing) return { found: false, result: null }
  if (existing.actorId !== actorId || existing.action !== action) throw socialError('MUTATION_CONFLICT', 'mutation conflict')
  if (hasFingerprint && String(existing.inputFingerprint || '') !== fingerprint) throw socialError('MUTATION_CONFLICT', 'mutation conflict')
  return {
    found: true,
    result: typeof config.restoreResult === 'function' ? config.restoreResult(existing.result, clientMutationId) : existing.result
  }
}

module.exports = { MUTATION_COLLECTION, mutationRecordId, requireClientMutationId, runIdempotent, restoreIdempotent }
