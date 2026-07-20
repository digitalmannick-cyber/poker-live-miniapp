const crypto = require('crypto')
const { socialError } = require('./social-error')
const { POKER_STICKER_IDS } = require('./poker-stickers')

const RATE_LIMITS = Object.freeze({
  friendRequest: Object.freeze({ windowMs: 24 * 60 * 60 * 1000, max: 20 }),
  playerCard: Object.freeze({ windowMs: 24 * 60 * 60 * 1000, max: 20 }),
  comment: Object.freeze({ windowMs: 60_000, max: 10 }),
  like: Object.freeze({ windowMs: 60_000, max: 30 })
})

function rateLimitId(actorId, action) {
  return 'rl_' + crypto.createHash('sha256').update(JSON.stringify([String(actorId || ''), String(action || '')])).digest('hex')
}

function invalidComment() {
  return socialError('INVALID_COMMENT', 'invalid comment')
}

function normalizeId(value, maxLength) {
  if (typeof value !== 'string') return ''
  const result = value.trim()
  return result && result.length <= (maxLength || 128) ? result : ''
}

function normalizeCommentInput(event) {
  const source = event || {}
  const shareId = normalizeId(source.shareId, 128)
  let parentCommentId = ''
  if (source.parentCommentId !== undefined && source.parentCommentId !== '') {
    if (typeof source.parentCommentId !== 'string') throw invalidComment()
    parentCommentId = normalizeId(source.parentCommentId, 128)
    if (!parentCommentId) throw invalidComment()
  }
  const kind = typeof source.kind === 'string' ? source.kind : ''
  const rawText = typeof source.text === 'string' ? source.text : null
  const rawStickerId = typeof source.stickerId === 'string' ? source.stickerId : null
  if (!shareId || !['text', 'sticker'].includes(kind) || rawText === null || rawStickerId === null) throw invalidComment()
  const text = rawText.trim()
  const stickerId = rawStickerId.trim()
  if (kind === 'text') {
    const length = Array.from(text).length
    if (length < 1 || length > 300 || stickerId) throw invalidComment()
    return { shareId, parentCommentId, kind, text, stickerId: '' }
  }
  if (text || !POKER_STICKER_IDS.includes(stickerId)) throw invalidComment()
  return { shareId, parentCommentId, kind, text: '', stickerId }
}

function normalizeLikeInput(event) {
  const shareId = normalizeId(event && event.shareId, 128)
  if (!shareId || typeof (event && event.liked) !== 'boolean') throw socialError('INVALID_LIKE', 'invalid like')
  return { shareId, liked: event.liked }
}

async function consumeRateLimit(store, actorId, action, at) {
  const config = RATE_LIMITS[action]
  if (!config) throw new Error('social rate limit unavailable')
  if (!Number.isSafeInteger(at) || at <= 0) throw new Error('social rate limit clock unavailable')
  const id = rateLimitId(actorId, action)
  const current = await store.get('social_rate_limits', id)
  const floor = at - config.windowMs
  const occurredAt = (Array.isArray(current && current.occurredAt) ? current.occurredAt : [])
    .filter(value => Number.isSafeInteger(value) && value > floor && value <= at)
    .sort((left, right) => left - right)
  if (occurredAt.length >= config.max) throw socialError('RATE_LIMITED', 'rate limited')
  await store.set('social_rate_limits', id, {
    actorId,
    action,
    occurredAt: occurredAt.concat(at).slice(-config.max),
    updatedAt: at
  })
}

module.exports = {
  RATE_LIMITS,
  rateLimitId,
  interactionRateId: rateLimitId,
  normalizeId,
  normalizeCommentInput,
  normalizeLikeInput,
  consumeRateLimit,
  consumeInteractionRate: consumeRateLimit
}
