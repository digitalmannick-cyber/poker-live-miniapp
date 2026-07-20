const crypto = require('crypto')
const { socialError } = require('./social-error')
const { runIdempotent, restoreIdempotent, requireClientMutationId } = require('./idempotency')
const { requireReadableLiveShare, getLikeId } = require('./hand-feed')
const { createNotificationWriter } = require('./notification')
const { POKER_STICKER_IDS } = require('./poker-stickers')
const {
  normalizeId,
  normalizeCommentInput,
  normalizeLikeInput,
  consumeInteractionRate
} = require('./validation')

const COLLECTIONS = Object.freeze({
  USERS: 'social_users',
  SHARES: 'social_hand_shares',
  COMMENTS: 'social_comments',
  LIKES: 'social_likes'
})
const MAX_COMMENT_ID_LENGTH = 128
const MAX_CURSOR_LENGTH = 2048

function invalidPagination() {
  return socialError('INVALID_PAGINATION', 'invalid pagination')
}

function readLimit(value) {
  if (value === undefined) return 20
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 50) throw invalidPagination()
  return value
}

function decodeCursor(value) {
  if (value === undefined || value === '') return null
  if (typeof value !== 'string' || value.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) throw invalidPagination()
  let parsed
  try {
    const buffer = Buffer.from(value, 'base64url')
    if (!buffer.length || buffer.toString('base64url') !== value) throw invalidPagination()
    parsed = JSON.parse(buffer.toString('utf8'))
  } catch (error) {
    throw invalidPagination()
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
    JSON.stringify(Object.keys(parsed).sort()) !== JSON.stringify(['createdAt', 'id', 'v']) ||
    parsed.v !== 1 || !Number.isSafeInteger(parsed.createdAt) || parsed.createdAt <= 0 ||
    typeof parsed.id !== 'string' || parsed.id !== parsed.id.trim() || !parsed.id || parsed.id.length > MAX_COMMENT_ID_LENGTH) {
    throw invalidPagination()
  }
  return { createdAt: parsed.createdAt, id: parsed.id }
}

function encodeCursor(row) {
  return Buffer.from(JSON.stringify({ v: 1, createdAt: row.createdAt, id: row._id })).toString('base64url')
}

function fingerprint(action, input) {
  return crypto.createHash('sha256').update(JSON.stringify(Object.assign({ action }, input))).digest('hex')
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function safeHttpsUrl(value) {
  if (value === '') return ''
  try {
    const parsed = new URL(String(value || ''))
    return parsed.protocol === 'https:' ? parsed.toString() : ''
  } catch (error) {
    return ''
  }
}

function publicAuthor(snapshot) {
  const source = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : null
  const socialUserId = source && normalizeId(source.socialUserId, 128)
  const nicknameLength = source && typeof source.nickname === 'string' ? Array.from(source.nickname).length : -1
  const avatarTextLength = source && typeof source.avatarText === 'string' ? Array.from(source.avatarText).length : -1
  const avatarUrl = source && typeof source.avatarUrl === 'string' ? safeHttpsUrl(source.avatarUrl) : null
  if (!source || !socialUserId || socialUserId !== source.socialUserId || nicknameLength < 0 || nicknameLength > 24 ||
    avatarTextLength < 0 || avatarTextLength > 2 || avatarUrl === null || (source.avatarUrl && !avatarUrl)) {
    throw socialError('CONTENT_UNAVAILABLE', 'content unavailable')
  }
  return {
    socialUserId,
    nickname: source.nickname,
    avatarUrl,
    avatarText: source.avatarText
  }
}

function toCommentDto(row) {
  if (!row || typeof row._id !== 'string' || typeof row.shareId !== 'string' ||
    typeof row.parentCommentId !== 'string' || typeof row.deleted !== 'boolean' ||
    !Number.isSafeInteger(row.createdAt) || row.createdAt <= 0) {
    throw socialError('CONTENT_UNAVAILABLE', 'content unavailable')
  }
  const deleted = row.deleted === true
  if (!deleted) {
    const validText = row.kind === 'text' && typeof row.text === 'string' && row.text.trim() === row.text &&
      Array.from(row.text).length >= 1 && Array.from(row.text).length <= 300 && row.stickerId === ''
    const validSticker = row.kind === 'sticker' && row.text === '' &&
      typeof row.stickerId === 'string' && POKER_STICKER_IDS.includes(row.stickerId)
    if (!validText && !validSticker) throw socialError('CONTENT_UNAVAILABLE', 'content unavailable')
  }
  return {
    commentId: row._id,
    shareId: row.shareId,
    parentCommentId: row.parentCommentId,
    author: publicAuthor(row.authorSnapshot),
    kind: deleted ? 'text' : row.kind === 'sticker' ? 'sticker' : 'text',
    text: deleted ? '该评论已删除' : typeof row.text === 'string' ? row.text : '',
    stickerId: deleted ? '' : typeof row.stickerId === 'string' ? row.stickerId : '',
    deleted,
    createdAt: row.createdAt
  }
}

async function resolveUser(repository, actor) {
  if (!repository || typeof repository.findSocialUserByOpenId !== 'function') throw socialError('SOCIAL_PROFILE_REQUIRED', 'social profile required')
  const ownerOpenId = actor && typeof actor.ownerOpenId === 'string' ? actor.ownerOpenId.trim() : ''
  const user = ownerOpenId && await repository.findSocialUserByOpenId(ownerOpenId)
  if (!user || !normalizeId(user._id, 128)) throw socialError('SOCIAL_PROFILE_REQUIRED', 'social profile required')
  return user
}

async function buildAuthorSnapshot(user, avatarUrl) {
  const profile = user && user.profile && typeof user.profile === 'object' ? user.profile : {}
  const nickname = String(user && user.nickname || profile.nickname || '').trim().slice(0, 24)
  const avatarText = String(user && user.avatarText || profile.avatarText || nickname.slice(0, 1)).trim().slice(0, 2)
  const avatarFileId = String(user && user.avatarFileId || profile.avatarFileId || '').trim()
  const resolved = avatarFileId && typeof avatarUrl === 'function' ? safeHttpsUrl(await avatarUrl(avatarFileId)) : ''
  return { socialUserId: String(user._id), nickname, avatarUrl: resolved, avatarText }
}

function createInteractionHandlers(repository, options) {
  const config = options || {}
  const now = typeof config.now === 'function' ? config.now : () => Date.now()
  const randomCommentId = typeof config.randomCommentId === 'function'
    ? config.randomCommentId
    : () => 'sc_' + crypto.randomBytes(18).toString('hex')
  const avatarUrl = typeof config.avatarUrl === 'function' ? config.avatarUrl : async () => ''
  const notificationWriter = config.notificationWriter || createNotificationWriter({ now })

  async function createComment(event, actor) {
    const user = await resolveUser(repository, actor)
    const normalized = normalizeCommentInput(event)
    requireClientMutationId(event)
    await requireReadableLiveShare(repository, user._id, normalized.shareId)
    const inputFingerprint = fingerprint('create_comment', normalized)
    const restored = await restoreIdempotent(repository, user._id, 'create_comment', event, { inputFingerprint })
    if (restored.found) return restored.result
    const authorSnapshot = await buildAuthorSnapshot(user, avatarUrl)
    return runIdempotent(repository, user._id, 'create_comment', event, async store => {
      const transactionalUser = await store.get(COLLECTIONS.USERS, user._id)
      if (!transactionalUser || String(transactionalUser.ownerOpenId || '') !== String(actor && actor.ownerOpenId || '')) throw socialError('FORBIDDEN', 'not allowed')
      const readable = await requireReadableLiveShare(store, user._id, normalized.shareId)
      let parent = null
      if (normalized.parentCommentId) {
        parent = await store.get(COLLECTIONS.COMMENTS, normalized.parentCommentId)
        let parentAuthor = null
        try {
          parentAuthor = parent && publicAuthor(parent.authorSnapshot)
        } catch (error) {}
        if (!parent || parent._id !== normalized.parentCommentId || parent.shareId !== normalized.shareId ||
          parent.parentCommentId !== '' || parent.deleted !== false ||
          !normalizeId(parent.authorId, 128) || !parentAuthor || parent.authorId !== parentAuthor.socialUserId) {
          throw socialError('INVALID_COMMENT', 'invalid comment')
        }
      }
      const at = Number(now())
      if (!Number.isSafeInteger(at) || at <= 0) throw new Error('interaction clock unavailable')
      await consumeInteractionRate(store, user._id, 'comment', at)
      let commentId = ''
      for (let attempt = 0; attempt < 3 && !commentId; attempt += 1) {
        const candidate = normalizeId(randomCommentId(), MAX_COMMENT_ID_LENGTH)
        if (candidate && !await store.get(COLLECTIONS.COMMENTS, candidate)) commentId = candidate
      }
      if (!commentId) throw new Error('comment id unavailable')
      const comment = {
        _id: commentId,
        shareId: normalized.shareId,
        parentCommentId: normalized.parentCommentId,
        authorId: user._id,
        authorSnapshot,
        kind: normalized.kind,
        text: normalized.text,
        stickerId: normalized.stickerId,
        deleted: false,
        createdAt: at,
        updatedAt: at
      }
      const commentCount = safeCount(readable.share.commentCount) + 1
      await store.set(COLLECTIONS.COMMENTS, commentId, comment)
      await store.set(COLLECTIONS.SHARES, readable.share._id, Object.assign({}, readable.share, { commentCount, updatedAt: at }))
      const recipientId = parent ? parent.authorId : readable.share.publisherId
      const kind = parent ? 'reply' : 'comment'
      const semanticWriter = parent ? notificationWriter.writeReply : notificationWriter.writeComment
      if (typeof semanticWriter === 'function') {
        await semanticWriter.call(notificationWriter, store, {
          recipientId, shareId: readable.share._id, commentId, actor: transactionalUser, at
        })
      } else {
        await notificationWriter.write(store, {
          recipientId,
          kind,
          actor: transactionalUser,
          targetType: 'hand_share',
          targetId: readable.share._id,
          sourceEventId: `${kind}:${commentId}`,
          at
        })
      }
      return { comment: toCommentDto(comment), commentCount }
    }, { inputFingerprint })
  }

  async function deleteComment(event, actor) {
    const user = await resolveUser(repository, actor)
    const commentId = normalizeId(event && event.commentId, MAX_COMMENT_ID_LENGTH)
    if (!commentId) throw socialError('CONTENT_UNAVAILABLE', 'content unavailable')
    const inputFingerprint = fingerprint('delete_comment', { commentId })
    return runIdempotent(repository, user._id, 'delete_comment', event, async store => {
      const comment = await store.get(COLLECTIONS.COMMENTS, commentId)
      if (!comment) throw socialError('CONTENT_UNAVAILABLE', 'content unavailable')
      if (comment.authorId !== user._id) throw socialError('FORBIDDEN', 'not allowed')
      const share = await store.get(COLLECTIONS.SHARES, comment.shareId)
      if (!share) throw socialError('CONTENT_UNAVAILABLE', 'content unavailable')
      let readable = true
      try {
        await requireReadableLiveShare(store, user._id, comment.shareId)
      } catch (error) {
        if (!error || error.code !== 'CONTENT_UNAVAILABLE') throw error
        readable = false
      }
      const at = Number(now())
      if (!Number.isSafeInteger(at) || at <= 0) throw new Error('interaction clock unavailable')
      let next = comment
      let commentCount = safeCount(share.commentCount)
      if (comment.deleted !== true) {
        next = Object.assign({}, comment, { deleted: true, deletedAt: at, updatedAt: at })
        commentCount = Math.max(0, commentCount - 1)
        await store.set(COLLECTIONS.COMMENTS, commentId, next)
        await store.set(COLLECTIONS.SHARES, share._id, Object.assign({}, share, { commentCount, updatedAt: at }))
      }
      const result = { comment: toCommentDto(next) }
      if (readable) result.commentCount = commentCount
      return result
    }, {
      inputFingerprint,
      async restoreResult(_persisted, _clientMutationId, store) {
        const comment = await store.get(COLLECTIONS.COMMENTS, commentId)
        if (!comment || comment.authorId !== user._id || comment.deleted !== true) {
          throw socialError('CONTENT_UNAVAILABLE', 'content unavailable')
        }
        const share = await store.get(COLLECTIONS.SHARES, comment.shareId)
        if (!share) throw socialError('CONTENT_UNAVAILABLE', 'content unavailable')
        let readable = true
        try {
          await requireReadableLiveShare(store, user._id, comment.shareId)
        } catch (error) {
          if (!error || error.code !== 'CONTENT_UNAVAILABLE') throw error
          readable = false
        }
        const result = { comment: toCommentDto(comment) }
        if (readable) result.commentCount = safeCount(share.commentCount)
        return result
      }
    })
  }

  async function setLike(event, actor) {
    const user = await resolveUser(repository, actor)
    const normalized = normalizeLikeInput(event)
    const clientMutationId = requireClientMutationId(event)
    await requireReadableLiveShare(repository, user._id, normalized.shareId)
    const inputFingerprint = fingerprint('set_like', normalized)
    return runIdempotent(repository, user._id, 'set_like', event, async store => {
      const transactionalUser = await store.get(COLLECTIONS.USERS, user._id)
      if (!transactionalUser || String(transactionalUser.ownerOpenId || '') !== String(actor && actor.ownerOpenId || '')) throw socialError('FORBIDDEN', 'not allowed')
      const readable = await requireReadableLiveShare(store, user._id, normalized.shareId)
      const likeId = getLikeId(normalized.shareId, user._id)
      const current = await store.get(COLLECTIONS.LIKES, likeId)
      if (current && (current._id !== likeId || current.shareId !== normalized.shareId || current.actorId !== user._id ||
        typeof current.active !== 'boolean' || !Number.isSafeInteger(current.createdAt) || current.createdAt <= 0 ||
        !Number.isSafeInteger(current.updatedAt) || current.updatedAt < current.createdAt)) {
        throw socialError('CONTENT_UNAVAILABLE', 'content unavailable')
      }
      const active = !!(current && current.active === true)
      const currentCount = safeCount(readable.share.likeCount)
      if (active === normalized.liked) return { shareId: normalized.shareId, likedByMe: active, likeCount: currentCount }
      const at = Number(now())
      if (!Number.isSafeInteger(at) || at <= 0) throw new Error('interaction clock unavailable')
      await consumeInteractionRate(store, user._id, 'like', at)
      const likeCount = normalized.liked ? currentCount + 1 : Math.max(0, currentCount - 1)
      await store.set(COLLECTIONS.LIKES, likeId, {
        shareId: normalized.shareId,
        actorId: user._id,
        active: normalized.liked,
        createdAt: current && Number.isSafeInteger(current.createdAt) && current.createdAt > 0 ? current.createdAt : at,
        updatedAt: at
      })
      await store.set(COLLECTIONS.SHARES, readable.share._id, Object.assign({}, readable.share, { likeCount, updatedAt: at }))
      if (normalized.liked) {
        await notificationWriter.writeLikeAggregate(store, {
          recipientId: readable.share.publisherId,
          shareId: readable.share._id,
          actor: transactionalUser,
          sourceEventId: `like:${readable.share._id}:${user._id}:${clientMutationId}`,
          at
        })
      }
      return { shareId: normalized.shareId, likedByMe: normalized.liked, likeCount }
    }, { inputFingerprint })
  }

  return {
    async list_comments(event, actor) {
      const user = await resolveUser(repository, actor)
      const shareId = normalizeId(event && event.shareId, 128)
      if (!shareId) throw socialError('CONTENT_UNAVAILABLE', 'content unavailable')
      const limit = readLimit(event && event.limit)
      const cursor = decodeCursor(event == null ? undefined : event.cursor)
      await requireReadableLiveShare(repository, user._id, shareId)
      if (typeof repository.listComments !== 'function') throw new Error('comment query unavailable')
      const rows = await repository.listComments(shareId, { cursor, limit: limit + 1 })
      if (!Array.isArray(rows)) throw new Error('comment query unavailable')
      const page = rows.slice(0, limit)
      return {
        items: page.map(toCommentDto),
        nextCursor: rows.length > limit && page.length ? encodeCursor(page[page.length - 1]) : null
      }
    },
    create_comment: createComment,
    delete_comment: deleteComment,
    set_like: setLike
  }
}

module.exports = {
  COLLECTIONS,
  requireReadableLiveShare,
  getLikeId,
  decodeCursor,
  encodeCursor,
  toCommentDto,
  createInteractionHandlers
}
