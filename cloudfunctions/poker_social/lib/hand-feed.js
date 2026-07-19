const crypto = require('crypto')
const { socialError } = require('./social-error')
const { getPairId } = require('./friendship')
const { canReadShare } = require('./visibility')
const { copyHandSnapshot, ownerIdentity, playerIdentity } = require('./hand-share')
const { FRIEND_ID_QUERY_CHUNK_SIZE } = require('./repository')

const SOURCE_READ_CONCURRENCY = 8
const STREAM_HEAD_CONCURRENCY = 8
const STREAM_BATCH_SIZE = 20
const FRIEND_ADJACENCY_PAGE_SIZE = 100
const MAX_CURSOR_LENGTH = 2048
const MAX_SHARE_ID_LENGTH = 128
const SCOPE_LABELS = Object.freeze({
  square: '广场',
  friends: '全部好友',
  selected: '指定好友'
})

function text(value) {
  return String(value || '').trim()
}

function getLikeId(shareId, viewerId) {
  return 'lk_' + crypto.createHash('sha256').update(JSON.stringify([text(shareId), text(viewerId)])).digest('hex')
}

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
  let buffer
  let parsed
  try {
    buffer = Buffer.from(value, 'base64url')
    if (!buffer.length || buffer.toString('base64url') !== value) throw invalidPagination()
    parsed = JSON.parse(buffer.toString('utf8'))
  } catch (error) {
    throw invalidPagination()
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
    JSON.stringify(Object.keys(parsed).sort()) !== JSON.stringify(['createdAt', 'id', 'v']) ||
    parsed.v !== 1 || !Number.isSafeInteger(parsed.createdAt) || parsed.createdAt <= 0 ||
    typeof parsed.id !== 'string' || parsed.id !== parsed.id.trim() || !parsed.id || parsed.id.length > MAX_SHARE_ID_LENGTH) {
    throw invalidPagination()
  }
  return { createdAt: parsed.createdAt, id: parsed.id }
}

function encodeCursor(row) {
  return Buffer.from(JSON.stringify({ v: 1, createdAt: Number(row.createdAt), id: text(row._id || row.shareId) })).toString('base64url')
}

function compareTuple(left, right) {
  return Number(right && right.createdAt) - Number(left && left.createdAt) ||
    String(right && right._id || '').localeCompare(String(left && left._id || ''))
}

function isAfterCursor(row, cursor) {
  return !cursor || Number(row && row.createdAt) < Number(cursor.createdAt) ||
    (Number(row && row.createdAt) === Number(cursor.createdAt) && text(row && row._id) < text(cursor.id))
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function optionalNumber(value) {
  return Number.isFinite(value) && value >= 0 ? value : null
}

function detailCreatedAt(value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw socialError('CONTENT_UNAVAILABLE', 'content unavailable')
  }
  return value
}

function safeHttpsUrl(value) {
  try {
    const parsed = new URL(String(value || ''))
    return parsed.protocol === 'https:' ? parsed.toString() : ''
  } catch (error) {
    return ''
  }
}

function exactSourceMatch(share, hand) {
  const source = share && share.source
  const handId = text(source && source.handId)
  const sourceOwner = ownerIdentity(source)
  const sourcePlayer = playerIdentity(source)
  const handOwner = ownerIdentity(hand)
  const handPlayer = playerIdentity(hand)
  return !!source && !!hand && !!handId && !!sourceOwner && !!sourcePlayer && !!handOwner && !!handPlayer &&
    text(hand._id) === handId && handOwner === sourceOwner && handPlayer.toUpperCase() === sourcePlayer.toUpperCase()
}

async function resolveViewer(repository, actor) {
  if (!repository || typeof repository.findSocialUserByOpenId !== 'function') throw socialError('SOCIAL_PROFILE_REQUIRED', 'social profile required')
  const ownerOpenId = text(actor && actor.ownerOpenId)
  const viewer = ownerOpenId && await repository.findSocialUserByOpenId(ownerOpenId)
  if (!viewer || !text(viewer._id)) throw socialError('SOCIAL_PROFILE_REQUIRED', 'social profile required')
  return viewer
}

async function readFriendship(repository, viewerId, share) {
  if (viewerId === text(share && share.publisherId) || share && share.scope === 'square') return null
  try {
    return await repository.get('social_friendships', getPairId(viewerId, share.publisherId))
  } catch (error) {
    return null
  }
}

async function requireReadableLiveShare(repository, viewerId, shareIdValue) {
  if (typeof shareIdValue !== 'string') throw socialError('CONTENT_UNAVAILABLE', 'content unavailable')
  const shareId = text(shareIdValue)
  if (!shareId || shareId.length > MAX_SHARE_ID_LENGTH) throw socialError('CONTENT_UNAVAILABLE', 'content unavailable')
  const share = await pointRead(repository, 'getHandShareById', 'social_hand_shares', shareId)
  const handId = text(share && share.source && share.source.handId)
  const hand = handId && await pointRead(repository, 'getSourceHandById', 'hands', handId)
  if (!exactSourceMatch(share, hand)) throw socialError('CONTENT_UNAVAILABLE', 'content unavailable')
  const friendship = await readFriendship(repository, viewerId, share)
  if (!canReadShare(viewerId, share, friendship)) throw socialError('CONTENT_UNAVAILABLE', 'content unavailable')
  return { share, hand, friendship }
}

async function pointRead(repository, method, collection, id) {
  if (repository && typeof repository[method] === 'function') return repository[method](id)
  if (repository && typeof repository.get === 'function') return repository.get(collection, id)
  throw new Error('feed point-read unavailable')
}

async function publicPublisher(repository, publisherId, avatarUrl) {
  const publisher = await repository.get('social_users', publisherId)
  if (!publisher || text(publisher._id) !== text(publisherId)) return null
  const profile = publisher.profile && typeof publisher.profile === 'object' ? publisher.profile : {}
  const avatarFileId = text(publisher.avatarFileId || profile.avatarFileId)
  let resolved = ''
  if (avatarFileId && typeof avatarUrl === 'function') resolved = safeHttpsUrl(await avatarUrl(avatarFileId))
  return {
    socialUserId: text(publisher._id),
    nickname: text(publisher.nickname || profile.nickname).slice(0, 24),
    avatarUrl: resolved,
    avatarText: text(publisher.avatarText || profile.avatarText).slice(0, 2)
  }
}

function feedSummary(snapshot) {
  const heroInPlayers = snapshot.players.some(player => player.seat === snapshot.hero.seat || player.label === 'Hero')
  return {
    heroCards: snapshot.hero.cards.slice(),
    board: {
      flop: snapshot.board.flop.slice(),
      turn: snapshot.board.turn.slice(),
      river: snapshot.board.river.slice()
    },
    potBb: optionalNumber(snapshot.potBb),
    effectiveStackBb: optionalNumber(snapshot.effectiveStackBb),
    actionCount: snapshot.actions.length,
    playerCount: snapshot.players.length + (heroInPlayers ? 0 : 1)
  }
}

async function likeState(repository, shareId, viewerId) {
  const like = await pointRead(repository, 'getLikeById', 'social_likes', getLikeId(shareId, viewerId))
  return !!(like && like.active === true)
}

async function toFeedItem(repository, viewerId, share, avatarUrl) {
  const handId = text(share && share.source && share.source.handId)
  const hand = handId && await pointRead(repository, 'getSourceHandById', 'hands', handId)
  if (!exactSourceMatch(share, hand)) return null
  const friendship = await readFriendship(repository, viewerId, share)
  if (!canReadShare(viewerId, share, friendship)) return null
  const publisher = await publicPublisher(repository, text(share.publisherId), avatarUrl)
  if (!publisher) return null
  let snapshot
  try {
    snapshot = copyHandSnapshot(share.snapshot)
  } catch (error) {
    if (error && error.code === 'INVALID_HAND_SNAPSHOT') return null
    throw error
  }
  return {
    shareId: text(share._id),
    publisher,
    scope: share.scope,
    scopeLabel: SCOPE_LABELS[share.scope],
    summary: feedSummary(snapshot),
    likedByMe: await likeState(repository, share._id, viewerId),
    likeCount: safeCount(share.likeCount),
    commentCount: safeCount(share.commentCount),
    createdAt: Number(share.createdAt)
  }
}

async function listAllFriendIds(repository, viewerId) {
  if (typeof repository.listAcceptedFriendshipsBySideKeyset !== 'function') throw new Error('feed friendship adjacency unavailable')
  const ids = new Set()
  for (const side of ['userA', 'userB']) {
    let cursor = null
    while (true) {
      const batch = await repository.listAcceptedFriendshipsBySideKeyset(viewerId, side, {
        cursor,
        limit: FRIEND_ADJACENCY_PAGE_SIZE
      })
      if (!Array.isArray(batch)) throw new Error('feed friendship adjacency unavailable')
      for (const row of batch) {
        if (!row || row.status !== 'accepted' || text(row[side]) !== viewerId) continue
        const other = text(side === 'userA' ? row.userB : row.userA)
        if (other && other !== viewerId) ids.add(other)
      }
      if (batch.length < FRIEND_ADJACENCY_PAGE_SIZE) break
      const last = batch[batch.length - 1]
      const next = { acceptedAt: Number(last.acceptedAt), id: text(last._id) }
      if (!Number.isFinite(next.acceptedAt) || !next.id || cursor && next.acceptedAt === cursor.acceptedAt && next.id === cursor.id) {
        throw new Error('feed friendship cursor did not advance')
      }
      cursor = next
    }
  }
  return Array.from(ids).sort()
}

function streamState(load, cursor) {
  return { load, cursor, rows: [], index: 0, exhausted: false }
}

async function ensureHead(state) {
  while (state.index >= state.rows.length && !state.exhausted) {
    const batch = await state.load({ cursor: state.cursor, limit: STREAM_BATCH_SIZE })
    if (!Array.isArray(batch)) throw new Error('feed candidate query unavailable')
    if (batch.some((row, index) => !row || !text(row._id) || !Number.isSafeInteger(row.createdAt) || row.createdAt <= 0 ||
      !isAfterCursor(row, state.cursor) || index > 0 && compareTuple(batch[index - 1], row) > 0)) {
      throw new Error('feed candidate order unavailable')
    }
    state.rows = batch
    state.index = 0
    state.exhausted = batch.length < STREAM_BATCH_SIZE
    if (!batch.length) state.exhausted = true
  }
  return state.index < state.rows.length ? state.rows[state.index] : null
}

async function loadStreamHeads(states) {
  const heads = new Array(states.length)
  let nextIndex = 0
  async function worker() {
    while (nextIndex < states.length) {
      const index = nextIndex
      nextIndex += 1
      heads[index] = await ensureHead(states[index])
    }
  }
  const workerCount = Math.min(STREAM_HEAD_CONCURRENCY, states.length)
  await Promise.all(Array.from({ length: workerCount }, worker))
  return heads
}

async function takeNextCandidate(states) {
  const heads = await loadStreamHeads(states)
  let chosen = -1
  for (let index = 0; index < heads.length; index += 1) {
    if (!heads[index]) continue
    if (chosen < 0 || compareTuple(heads[chosen], heads[index]) > 0) chosen = index
  }
  if (chosen < 0) return null
  const state = states[chosen]
  const row = state.rows[state.index]
  state.index += 1
  state.cursor = { createdAt: Number(row.createdAt), id: text(row._id) }
  return row
}

async function streamsExhausted(states) {
  const heads = await loadStreamHeads(states)
  return heads.every(head => !head)
}

function chunk(values, size) {
  const result = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}

function createHandFeedHandlers(repository, options) {
  const config = options || {}
  const avatarUrl = typeof config.avatarUrl === 'function' ? config.avatarUrl : async () => ''
  const configuredChunk = Number(config.friendIdQueryChunkSize)
  const friendChunkSize = Number.isInteger(configuredChunk) && configuredChunk >= 1 && configuredChunk <= FRIEND_ID_QUERY_CHUNK_SIZE
    ? configuredChunk
    : FRIEND_ID_QUERY_CHUNK_SIZE

  return {
    async list_feed(event, actor) {
      const limit = readLimit(event && event.limit)
      const publicCursor = decodeCursor(event == null ? undefined : event.cursor)
      const viewer = await resolveViewer(repository, actor)
      const viewerId = text(viewer._id)
      const friendIds = await listAllFriendIds(repository, viewerId)
      const states = [
        streamState(page => repository.listSquareShareCandidates(page), publicCursor),
        streamState(page => repository.listSelfShareCandidates(viewerId, page), publicCursor),
        streamState(page => repository.listSelectedShareCandidates(viewerId, page), publicCursor)
      ]
      for (const publisherIds of chunk(friendIds, friendChunkSize)) {
        states.push(streamState(page => repository.listFriendShareCandidates(publisherIds, page), publicCursor))
      }

      const items = []
      const seen = new Set()
      while (items.length < limit) {
        const candidates = []
        const batchLimit = Math.min(SOURCE_READ_CONCURRENCY, limit - items.length)
        while (candidates.length < batchLimit) {
          const candidate = await takeNextCandidate(states)
          if (!candidate) break
          const shareId = text(candidate._id)
          if (!shareId || seen.has(shareId)) continue
          seen.add(shareId)
          candidates.push(candidate)
        }
        if (!candidates.length) break
        const resolved = await Promise.all(candidates.map(candidate => toFeedItem(repository, viewerId, candidate, avatarUrl)))
        for (const item of resolved) if (item) items.push(item)
      }
      const exhausted = await streamsExhausted(states)
      return {
        items,
        nextCursor: items.length && !exhausted ? encodeCursor({ _id: items[items.length - 1].shareId, createdAt: items[items.length - 1].createdAt }) : null
      }
    },

    async get_hand_share(event, actor) {
      const viewer = await resolveViewer(repository, actor)
      const viewerId = text(viewer._id)
      const readable = await requireReadableLiveShare(repository, viewerId, event && event.shareId)
      const publisher = await publicPublisher(repository, readable.share.publisherId, avatarUrl)
      if (!publisher) throw socialError('CONTENT_UNAVAILABLE', 'content unavailable')
      let handSnapshot
      try {
        handSnapshot = copyHandSnapshot(readable.share.snapshot)
      } catch (error) {
        throw socialError('CONTENT_UNAVAILABLE', 'content unavailable')
      }
      return {
        shareId: text(readable.share._id),
        publisher,
        scope: readable.share.scope,
        scopeLabel: SCOPE_LABELS[readable.share.scope],
        handSnapshot,
        likedByMe: await likeState(repository, readable.share._id, viewerId),
        likeCount: safeCount(readable.share.likeCount),
        commentCount: safeCount(readable.share.commentCount),
        createdAt: detailCreatedAt(readable.share.createdAt),
        isMine: viewerId === text(readable.share.publisherId)
      }
    }
  }
}

module.exports = {
  SOURCE_READ_CONCURRENCY,
  STREAM_HEAD_CONCURRENCY,
  getLikeId,
  canReadShare,
  requireReadableLiveShare,
  createHandFeedHandlers
}
