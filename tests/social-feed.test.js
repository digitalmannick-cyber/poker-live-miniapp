const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')

const { createSocialApp } = require('../cloudfunctions/poker_social/app')
const { createCloudSocialRepository } = require('../cloudfunctions/poker_social/lib/repository')
const { getPairId } = require('../cloudfunctions/poker_social/lib/friendship')
const { canReadShare } = require('../cloudfunctions/poker_social/lib/visibility')

let handFeed = null
let handFeedLoadError = null
try {
  handFeed = require('../cloudfunctions/poker_social/lib/hand-feed')
} catch (error) {
  if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes('hand-feed')) handFeedLoadError = error
  else throw error
}

const VIEWER_ID = 'su_viewer'
const ACTOR = { ownerOpenId: 'openid-su_viewer' }
const FORBIDDEN_KEYS = new Set([
  'ownerOpenId', '_openid', 'privatePlayerId', 'playerId', 'handId', 'sourceHandId',
  'sessionId', 'targetUserIds', 'avatarFileId', 'playerName', 'note', 'leakTags',
  'profit', 'currentProfit', 'buyIn', 'cashOut', 'venue', 'voiceExtract', 'aiReview'
])

function requireHandFeed() {
  if (handFeedLoadError) assert.fail('Task 4 hand-feed module is missing')
  assert.equal(typeof handFeed.createHandFeedHandlers, 'function', 'createHandFeedHandlers capability is missing')
  return handFeed
}

function user(id, patch) {
  return Object.assign({
    _id: id,
    ownerOpenId: `openid-${id}`,
    privatePlayerId: `PLAYER-${id}`,
    nickname: `User ${id}`,
    avatarText: id.slice(-1).toUpperCase(),
    avatarFileId: `cloud://avatar-${id}`
  }, patch)
}

function accepted(left, right, patch) {
  const pair = [left, right].sort()
  return Object.assign({
    _id: getPairId(left, right),
    userA: pair[0],
    userB: pair[1],
    status: 'accepted',
    acceptedAt: 1000
  }, patch)
}

function snapshot(label) {
  return {
    version: 1,
    hero: { label: 'Hero', position: 'BTN', seat: 1, cards: ['As', 'Ks'], stackBb: 100 },
    players: [
      { label: 'Hero', position: 'BTN', seat: 1, stackBb: 100 },
      { label: 'V1', position: 'BB', seat: 2, stackBb: 88 }
    ],
    board: { flop: ['Ah', '9s', '4d'], turn: ['Kc'], river: ['2h'] },
    actions: [{ street: 'preflop', actor: 'Hero', type: 'raise', amountBb: 2.5 }],
    effectiveStackBb: 88,
    potBb: 12.5,
    showdown: [],
    injected: { ownerOpenId: `CANARY-${label}`, note: `CANARY-${label}` }
  }
}

function share(id, publisherId, scope, createdAt, patch) {
  const privatePlayerId = `PLAYER-${publisherId}`
  return Object.assign({
    _id: id,
    publisherId,
    source: {
      ownerOpenId: `openid-${publisherId}`,
      playerId: privatePlayerId,
      privatePlayerId,
      handId: `hand-${id}`,
      sessionId: `session-${id}`
    },
    snapshot: snapshot(id),
    status: 'active',
    scope,
    targetUserIds: scope === 'selected' ? [VIEWER_ID] : [],
    likeCount: 0,
    commentCount: 0,
    createdAt,
    updatedAt: createdAt,
    ownerOpenId: `CANARY-${id}`,
    note: `CANARY-${id}`
  }, patch)
}

function sourceHand(row, patch) {
  const source = row.source || {}
  return Object.assign({
    _id: source.handId,
    ownerOpenId: source.ownerOpenId,
    playerId: source.playerId || source.privatePlayerId,
    privatePlayerId: source.privatePlayerId || source.playerId
  }, patch)
}

function baseSeed(extra) {
  return Object.assign({
    social_users: [user(VIEWER_ID)],
    social_friendships: [],
    social_hand_shares: [],
    social_likes: [],
    hands: []
  }, extra)
}

function tupleDesc(left, right) {
  return Number(right.createdAt) - Number(left.createdAt) || String(right._id).localeCompare(String(left._id))
}

function afterTuple(row, cursor) {
  return !cursor || Number(row.createdAt) < Number(cursor.createdAt) ||
    (Number(row.createdAt) === Number(cursor.createdAt) && String(row._id) < String(cursor.id))
}

function pageRows(rows, page) {
  const cursor = page && page.cursor
  const limit = Math.max(1, Number(page && page.limit) || 20)
  return rows.slice().sort(tupleDesc).filter(row => afterTuple(row, cursor)).slice(0, limit)
}

function createFeedRepository(seed, options) {
  const tables = JSON.parse(JSON.stringify(seed || baseSeed()))
  const config = options || {}
  const logs = {
    square: [], self: [], friends: [], selected: [], adjacency: [], source: [], share: [], like: [],
    get: [], fullScans: 0
  }
  const overrides = config.streamOverrides || {}

  function rows(name) {
    return tables[name] || (tables[name] = [])
  }

  function stream(name, natural, page) {
    const source = Object.prototype.hasOwnProperty.call(overrides, name) ? overrides[name] : natural
    return pageRows(typeof source === 'function' ? source() : source, page)
  }

  async function beforeCandidateQuery(name) {
    if (typeof config.beforeCandidateQuery === 'function') await config.beforeCandidateQuery(name)
  }

  const repository = {
    async get(collection, id) {
      logs.get.push({ collection, id })
      return rows(collection).find(row => row._id === id) || null
    },
    async findSocialUserByOpenId(ownerOpenId) {
      return rows('social_users').find(row => row.ownerOpenId === ownerOpenId) || null
    },
    async listSquareShareCandidates(page) {
      logs.square.push(page)
      await beforeCandidateQuery('square')
      return stream('square', rows('social_hand_shares').filter(row => row.status === 'active' && row.scope === 'square'), page)
    },
    async listSelfShareCandidates(viewerId, page) {
      logs.self.push({ viewerId, page })
      await beforeCandidateQuery('self')
      return stream('self', rows('social_hand_shares').filter(row => row.status === 'active' && row.publisherId === viewerId), page)
    },
    async listFriendShareCandidates(publisherIds, page) {
      logs.friends.push({ publisherIds: publisherIds.slice(), page })
      await beforeCandidateQuery('friends')
      return stream('friends', rows('social_hand_shares').filter(row => row.status === 'active' && publisherIds.includes(row.publisherId)), page)
    },
    async listSelectedShareCandidates(viewerId, page) {
      logs.selected.push({ viewerId, page })
      await beforeCandidateQuery('selected')
      return stream('selected', rows('social_hand_shares').filter(row => row.status === 'active' && row.scope === 'selected' &&
        Array.isArray(row.targetUserIds) && row.targetUserIds.includes(viewerId)), page)
    },
    async listAcceptedFriendshipsBySideKeyset(viewerId, side, page) {
      logs.adjacency.push({ viewerId, side, page })
      const cursor = page && page.cursor
      const limit = Math.max(1, Number(page && page.limit) || 100)
      return rows('social_friendships')
        .filter(row => row.status === 'accepted' && row[side] === viewerId)
        .sort((left, right) => Number(right.acceptedAt) - Number(left.acceptedAt) || String(left._id).localeCompare(String(right._id)))
        .filter(row => !cursor || Number(row.acceptedAt) < Number(cursor.acceptedAt) ||
          (Number(row.acceptedAt) === Number(cursor.acceptedAt) && String(row._id) > String(cursor.id)))
        .slice(0, limit)
    },
    async getSourceHandById(handId) {
      logs.source.push(handId)
      if (typeof config.getSourceHandById === 'function') return config.getSourceHandById(handId, tables)
      return rows('hands').find(row => row._id === handId) || null
    },
    async getHandShareById(shareId) {
      logs.share.push(shareId)
      return rows('social_hand_shares').find(row => row._id === shareId) || null
    },
    async getLikeById(likeId) {
      logs.like.push(likeId)
      return rows('social_likes').find(row => row._id === likeId) || null
    },
    where() {
      logs.fullScans += 1
      throw new Error('collection-wide scan forbidden by feed fixture')
    },
    dump() {
      return JSON.parse(JSON.stringify(tables))
    },
    insert(collection, row) {
      rows(collection).push(JSON.parse(JSON.stringify(row)))
    }
  }
  return { repository, logs, tables }
}

function setup(seed, options) {
  const api = requireHandFeed()
  const fake = createFeedRepository(seed, options)
  const handlers = api.createHandFeedHandlers(fake.repository, {
    avatarUrl: async fileId => `https://cdn.example/${encodeURIComponent(fileId)}`,
    friendIdQueryChunkSize: options && options.friendIdQueryChunkSize
  })
  assert.equal(typeof handlers.list_feed, 'function')
  assert.equal(typeof handlers.get_hand_share, 'function')
  return Object.assign({ api, handlers }, fake)
}

function actor(id = VIEWER_ID) {
  return { ownerOpenId: `openid-${id}` }
}

function expectCode(promise, code) {
  return assert.rejects(promise, error => error && error.code === code)
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function scanForbidden(value, path = '$') {
  if (typeof value === 'string') assert.equal(value.includes('CANARY'), false, `${path} leaked a canary value`)
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    assert.equal(FORBIDDEN_KEYS.has(key), false, `${path}.${key} is private`)
    scanForbidden(child, `${path}.${key}`)
  }
}

function assertFeedItemShape(item) {
  assert.deepEqual(Object.keys(item).sort(), [
    'commentCount', 'createdAt', 'likeCount', 'likedByMe', 'publisher', 'scope', 'scopeLabel', 'shareId', 'summary'
  ].sort())
  assert.deepEqual(Object.keys(item.publisher).sort(), ['avatarText', 'avatarUrl', 'nickname', 'socialUserId'].sort())
  assert.deepEqual(Object.keys(item.summary).sort(), [
    'actionCount', 'board', 'effectiveStackBb', 'heroCards', 'playerCount', 'potBb'
  ].sort())
  assert.deepEqual(Object.keys(item.summary.board).sort(), ['flop', 'river', 'turn'])
}

test('feed fixture independently pages tuple streams and performs exact point reads', async () => {
  const first = share('sh_fixture_b', 'su_public', 'square', 100)
  const second = share('sh_fixture_a', 'su_public', 'square', 100)
  const like = { _id: 'lk_fixture', active: true }
  const fake = createFeedRepository(baseSeed({
    social_users: [user(VIEWER_ID), user('su_public')],
    social_hand_shares: [second, first],
    social_likes: [like],
    hands: [sourceHand(first), sourceHand(second)]
  }))
  assert.deepEqual((await fake.repository.listSquareShareCandidates({ cursor: null, limit: 1 })).map(row => row._id), ['sh_fixture_b'])
  assert.deepEqual((await fake.repository.listSquareShareCandidates({
    cursor: { createdAt: 100, id: 'sh_fixture_b' }, limit: 1
  })).map(row => row._id), ['sh_fixture_a'])
  assert.equal((await fake.repository.getSourceHandById(first.source.handId))._id, first.source.handId)
  assert.equal((await fake.repository.getLikeById(like._id)).active, true)
  assert.equal(fake.logs.fullScans, 0)
})

test('square self friends and selected streams each contribute independently and client identity injection is ignored', async t => {
  const cases = [
    { name: 'square', publisher: 'su_square', scope: 'square', friendship: false },
    { name: 'self without friends', publisher: VIEWER_ID, scope: 'friends', friendship: false },
    { name: 'friends', publisher: 'su_friend', scope: 'friends', friendship: true },
    { name: 'selected', publisher: 'su_selected', scope: 'selected', friendship: true }
  ]
  for (const row of cases) {
    await t.test(row.name, async () => {
      const item = share(`sh_${row.name.replaceAll(' ', '_')}`, row.publisher, row.scope, 100)
      const seed = baseSeed({
        social_users: [user(VIEWER_ID), user(row.publisher)].filter((entry, index, all) => all.findIndex(other => other._id === entry._id) === index),
        social_friendships: row.friendship ? [accepted(VIEWER_ID, row.publisher)] : [],
        social_hand_shares: [item],
        hands: [sourceHand(item)]
      })
      const ctx = setup(seed)
      const result = await ctx.handlers.list_feed({
        limit: 20,
        viewerId: 'su_attacker', publisherId: 'su_attacker', friendIds: ['su_attacker'],
        source: { handId: 'private' }, likedByMe: true, likeCount: 999
      }, ACTOR)
      assert.deepEqual(result.items.map(entry => entry.shareId), [item._id])
      assert.equal(result.items[0].publisher.socialUserId, row.publisher)
      assert.equal(ctx.logs.fullScans, 0)
    })
  }
})

test('k-way merge globally orders equal timestamps by id and deduplicates every overlapping stream', async () => {
  const duplicate = share('sh_z', 'su_friend', 'selected', 500)
  const next = share('sh_y', 'su_friend', 'friends', 500)
  const older = share('sh_x', VIEWER_ID, 'square', 499)
  const rows = [duplicate, next, older]
  const ctx = setup(baseSeed({
    social_users: [user(VIEWER_ID), user('su_friend')],
    social_friendships: [accepted(VIEWER_ID, 'su_friend')],
    social_hand_shares: rows,
    hands: rows.map(row => sourceHand(row))
  }), {
    streamOverrides: { square: rows, self: rows, friends: rows, selected: rows }
  })
  const result = await ctx.handlers.list_feed({ limit: 20 }, ACTOR)
  assert.deepEqual(result.items.map(item => item.shareId), ['sh_z', 'sh_y', 'sh_x'])
  assert.equal(new Set(result.items.map(item => item.shareId)).size, 3)
})

test('opaque tuple cursor is strict, stable across pages, and excludes newer inserts from an old traversal', async () => {
  const rows = [
    share('sh_d', 'su_public', 'square', 400),
    share('sh_c', 'su_public', 'square', 300),
    share('sh_b', 'su_public', 'square', 300),
    share('sh_a', 'su_public', 'square', 100)
  ]
  const ctx = setup(baseSeed({
    social_users: [user(VIEWER_ID), user('su_public')],
    social_hand_shares: rows,
    hands: rows.map(row => sourceHand(row))
  }))
  const first = await ctx.handlers.list_feed({ limit: 2 }, ACTOR)
  assert.deepEqual(first.items.map(item => item.shareId), ['sh_d', 'sh_c'])
  assert.equal(typeof first.nextCursor, 'string')
  const blankCursor = await ctx.handlers.list_feed({ limit: 2, cursor: '' }, ACTOR)
  assert.deepEqual(blankCursor.items.map(item => item.shareId), ['sh_d', 'sh_c'])
  const inserted = share('sh_new', 'su_public', 'square', 500)
  ctx.repository.insert('social_hand_shares', inserted)
  ctx.repository.insert('hands', sourceHand(inserted))
  const second = await ctx.handlers.list_feed({ limit: 2, cursor: first.nextCursor }, ACTOR)
  assert.deepEqual(second.items.map(item => item.shareId), ['sh_b', 'sh_a'])
  assert.equal(second.nextCursor, null)
  assert.equal(new Set(first.items.concat(second.items).map(item => item.shareId)).size, 4)

  const invalid = [
    null,
    'not+base64url',
    encodeCursor({ v: 2, createdAt: 100, id: 'sh_a' }),
    encodeCursor({ v: 1, createdAt: 100, id: 'sh_a', extra: true }),
    encodeCursor({ v: 1, createdAt: -1, id: 'sh_a' }),
    encodeCursor({ v: 1, createdAt: 100 }),
    encodeCursor({ offset: 20 }),
    'a'.repeat(4097)
  ]
  for (const cursor of invalid) await expectCode(ctx.handlers.list_feed({ cursor, limit: 2 }, ACTOR), 'INVALID_PAGINATION')
  for (const limit of [0, 51, 1.5, '20']) await expectCode(ctx.handlers.list_feed({ limit }, ACTOR), 'INVALID_PAGINATION')
})

test('candidate createdAt must be a native positive safe integer', async t => {
  const invalidValues = [0, -1, 1.5, '100', Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]
  for (const createdAt of invalidValues) {
    await t.test(String(createdAt), async () => {
      const invalid = share('sh_invalid_created_at', 'su_public', 'square', 100)
      invalid.createdAt = createdAt
      const ctx = setup(baseSeed({
        social_users: [user(VIEWER_ID), user('su_public')],
        social_hand_shares: [invalid],
        hands: [sourceHand(invalid)]
      }), { streamOverrides: { square: [invalid] } })
      await assert.rejects(ctx.handlers.list_feed({ limit: 20 }, ACTOR), /feed candidate order unavailable/)
    })
  }
})

test('filtering withdrawn removed unselected and orphan candidates refills until the real limit and exhausts to null', async () => {
  const invalid = []
  for (let index = 0; index < 5; index += 1) {
    invalid.push(share(`sh_withdrawn_${index}`, 'su_bad', 'square', 1000 - index, { status: 'withdrawn' }))
    invalid.push(share(`sh_orphan_${index}`, 'su_bad', 'square', 990 - index))
    invalid.push(share(`sh_removed_${index}`, 'su_removed', 'friends', 980 - index))
    invalid.push(share(`sh_unselected_${index}`, 'su_friend', 'selected', 970 - index, { targetUserIds: ['su_other'] }))
  }
  const valid = Array.from({ length: 20 }, (_, index) => share(`sh_valid_${String(19 - index).padStart(2, '0')}`, 'su_public', 'square', 800 - index))
  const all = invalid.concat(valid)
  const hands = invalid.filter(row => !row._id.startsWith('sh_orphan_')).concat(valid).map(row => sourceHand(row))
  const ctx = setup(baseSeed({
    social_users: [user(VIEWER_ID), user('su_bad'), user('su_removed'), user('su_friend'), user('su_public')],
    social_friendships: [accepted(VIEWER_ID, 'su_removed', { status: 'removed' }), accepted(VIEWER_ID, 'su_friend')],
    social_hand_shares: all,
    hands
  }), { streamOverrides: { square: all } })
  const result = await ctx.handlers.list_feed({ limit: 20 }, ACTOR)
  assert.equal(result.items.length, 20)
  assert.ok(result.items.every(item => item.shareId.startsWith('sh_valid_')))
  assert.equal(result.nextCursor, null)
  assert.ok(ctx.logs.square.length > 1, 'filtered first batches must be refilled')
  assert.equal(ctx.logs.fullScans, 0)
})

test('every unique candidate uses an exact source point-read and source concurrency never exceeds eight', async () => {
  const rows = Array.from({ length: 24 }, (_, index) => share(`sh_pool_${String(index).padStart(2, '0')}`, 'su_public', 'square', 1000 - index))
  let active = 0
  let peak = 0
  const ctx = setup(baseSeed({
    social_users: [user(VIEWER_ID), user('su_public')],
    social_hand_shares: rows,
    hands: rows.map(row => sourceHand(row))
  }), {
    async getSourceHandById(handId, tables) {
      active += 1
      peak = Math.max(peak, active)
      await new Promise(resolve => setImmediate(resolve))
      active -= 1
      return tables.hands.find(row => row._id === handId) || null
    }
  })
  assert.equal(ctx.api.SOURCE_READ_CONCURRENCY, 8)
  const result = await ctx.handlers.list_feed({ limit: 20 }, ACTOR)
  assert.equal(result.items.length, 20)
  assert.ok(peak <= 8, `source read peak was ${peak}`)
  assert.equal(new Set(ctx.logs.source).size, ctx.logs.source.length)
  assert.ok(ctx.logs.source.length >= 20)
  assert.equal(ctx.logs.fullScans, 0)

  const mismatchCases = [
    { name: 'id', patch: { _id: 'wrong-hand-id' }, returnDirectly: true },
    { name: 'owner', patch: { ownerOpenId: 'wrong-owner' } },
    { name: 'player', patch: { playerId: 'WRONG-PLAYER', privatePlayerId: 'WRONG-PLAYER' } }
  ]
  for (const mismatchCase of mismatchCases) {
    const mismatch = share(`sh_mismatch_${mismatchCase.name}`, 'su_public', 'square', 2000)
    const wrongHand = sourceHand(mismatch, mismatchCase.patch)
    const mismatchCtx = setup(baseSeed({
      social_users: [user(VIEWER_ID), user('su_public')],
      social_hand_shares: [mismatch],
      hands: [wrongHand]
    }), mismatchCase.returnDirectly ? { getSourceHandById: async () => wrongHand } : undefined)
    const filtered = await mismatchCtx.handlers.list_feed({ limit: 20 }, ACTOR)
    assert.deepEqual(filtered, { items: [], nextCursor: null }, `${mismatchCase.name} mismatch must be filtered`)
  }
})

test('friend adjacency merges both sides, deduplicates, chunks by the injected limit, and never uses offset or skip', async t => {
  for (const count of [1, 2, 3, 5]) {
    await t.test(`${count} friends`, async () => {
      const friendIds = Array.from({ length: count }, (_, index) => `su_friend_${index}`)
      const relationships = friendIds.map((id, index) => index % 2
        ? accepted(id, VIEWER_ID, { acceptedAt: 1000 - index })
        : accepted(VIEWER_ID, id, { acceptedAt: 1000 - index }))
      if (count) relationships.push(Object.assign({}, relationships[0]))
      const shares = friendIds.map((id, index) => share(`sh_friend_${index}`, id, 'friends', 900 - index))
      const ctx = setup(baseSeed({
        social_users: [user(VIEWER_ID)].concat(friendIds.map(id => user(id))),
        social_friendships: relationships,
        social_hand_shares: shares,
        hands: shares.map(row => sourceHand(row))
      }), { friendIdQueryChunkSize: 2 })
      const result = await ctx.handlers.list_feed({ limit: 50 }, ACTOR)
      assert.deepEqual(new Set(result.items.map(item => item.shareId)), new Set(shares.map(row => row._id)))
      assert.deepEqual(new Set(ctx.logs.adjacency.map(call => call.side)), new Set(['userA', 'userB']))
      const chunks = ctx.logs.friends.map(call => call.publisherIds)
      assert.ok(chunks.every(chunk => chunk.length >= 1 && chunk.length <= 2))
      assert.deepEqual(new Set(chunks.flat()), new Set(friendIds))
      assert.equal(chunks.flat().length, friendIds.length)
      assert.equal(ctx.logs.fullScans, 0)
    })
  }
})

test('friend chunk stream heads load with bounded candidate query concurrency and preserve global order', async () => {
  const friendIds = Array.from({ length: 24 }, (_, index) => `su_parallel_friend_${index}`)
  const relationships = friendIds.map((id, index) => accepted(VIEWER_ID, id, { acceptedAt: 2000 - index }))
  const shares = friendIds.map((id, index) => share(`sh_parallel_${String(index).padStart(2, '0')}`, id, 'friends', 1000 - index))
  let active = 0
  let peak = 0
  const ctx = setup(baseSeed({
    social_users: [user(VIEWER_ID)].concat(friendIds.map(id => user(id))),
    social_friendships: relationships,
    social_hand_shares: shares,
    hands: shares.map(row => sourceHand(row))
  }), {
    friendIdQueryChunkSize: 1,
    async beforeCandidateQuery() {
      active += 1
      peak = Math.max(peak, active)
      await new Promise(resolve => setImmediate(resolve))
      active -= 1
    }
  })

  const result = await ctx.handlers.list_feed({ limit: 20 }, ACTOR)
  assert.deepEqual(result.items.map(item => item.shareId), shares.slice(0, 20).map(row => row._id))
  assert.ok(peak <= 8, `candidate query peak was ${peak}`)
  assert.equal(ctx.api.STREAM_HEAD_CONCURRENCY, 8)
  assert.equal(ctx.logs.fullScans, 0)
})

test('selected membership uses one scalar viewer and enforces 1/50 while malformed 51 and nonmembers fail closed', async () => {
  const targets50 = [VIEWER_ID].concat(Array.from({ length: 49 }, (_, index) => `su_target_${index}`))
  const rows = [
    share('sh_selected_1', 'su_friend', 'selected', 400, { targetUserIds: [VIEWER_ID] }),
    share('sh_selected_50', 'su_friend', 'selected', 300, { targetUserIds: targets50 }),
    share('sh_selected_51', 'su_friend', 'selected', 200, { targetUserIds: targets50.concat('su_over') }),
    share('sh_selected_other', 'su_friend', 'selected', 100, { targetUserIds: ['su_other'] })
  ]
  const ctx = setup(baseSeed({
    social_users: [user(VIEWER_ID), user('su_friend')],
    social_friendships: [accepted(VIEWER_ID, 'su_friend')],
    social_hand_shares: rows,
    hands: rows.map(row => sourceHand(row))
  }), { streamOverrides: { selected: rows } })
  const result = await ctx.handlers.list_feed({ limit: 20 }, ACTOR)
  assert.deepEqual(result.items.map(item => item.shareId), ['sh_selected_1', 'sh_selected_50'])
  assert.ok(ctx.logs.selected.every(call => call.viewerId === VIEWER_ID && !Array.isArray(call.viewerId)))
})

test('feed and detail share the exact canReadShare reference and a query hit never replaces live policy', async () => {
  const api = requireHandFeed()
  assert.strictEqual(api.canReadShare, canReadShare)
  const interaction = require('../cloudfunctions/poker_social/lib/interaction')
  assert.strictEqual(interaction.requireReadableLiveShare, api.requireReadableLiveShare)
  assert.strictEqual(interaction.getLikeId, api.getLikeId)
  const privateShare = share('sh_live_policy', 'su_friend', 'friends', 100)
  const ctx = setup(baseSeed({
    social_users: [user(VIEWER_ID), user('su_friend')],
    social_friendships: [accepted(VIEWER_ID, 'su_friend', { status: 'removed' })],
    social_hand_shares: [privateShare],
    hands: [sourceHand(privateShare)]
  }), { streamOverrides: { friends: [privateShare] } })
  const feed = await ctx.handlers.list_feed({ limit: 20 }, ACTOR)
  assert.deepEqual(feed, { items: [], nextCursor: null })
  await expectCode(ctx.handlers.get_hand_share({ shareId: privateShare._id }, ACTOR), 'CONTENT_UNAVAILABLE')
})

test('detail createdAt must be a native positive safe integer or become CONTENT_UNAVAILABLE', async t => {
  const invalidValues = [0, -1, 1.5, '100', Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]
  for (const createdAt of invalidValues) {
    await t.test(String(createdAt), async () => {
      const row = share('sh_detail_invalid_created_at', 'su_public', 'square', 100)
      const ctx = setup(baseSeed({
        social_users: [user(VIEWER_ID), user('su_public')],
        social_hand_shares: [row],
        hands: [sourceHand(row)]
      }))
      ctx.tables.social_hand_shares[0].createdAt = createdAt
      await expectCode(ctx.handlers.get_hand_share({ shareId: row._id }, ACTOR), 'CONTENT_UNAVAILABLE')
    })
  }
})

test('detail rejects non-string shareId values before any share point-read', async t => {
  const row = share('sh_detail_string_id', 'su_public', 'square', 100)
  for (const shareId of [123, { value: row._id }, [row._id]]) {
    await t.test(Array.isArray(shareId) ? 'array' : typeof shareId, async () => {
      const ctx = setup(baseSeed({
        social_users: [user(VIEWER_ID), user('su_public')],
        social_hand_shares: [row],
        hands: [sourceHand(row)]
      }))
      await expectCode(ctx.handlers.get_hand_share({ shareId }, ACTOR), 'CONTENT_UNAVAILABLE')
      assert.deepEqual(ctx.logs.share, [])
    })
  }
})

test('counts come only from the share and likedByMe uses one deterministic like point-read', async () => {
  const api = requireHandFeed()
  assert.equal(typeof api.getLikeId, 'function')
  const expectedLikeId = 'lk_' + crypto.createHash('sha256').update(JSON.stringify(['sh_liked', VIEWER_ID])).digest('hex')
  assert.equal(api.getLikeId('sh_liked', VIEWER_ID), expectedLikeId)
  const liked = share('sh_liked', 'su_public', 'square', 200, {
    likeCount: 7,
    commentCount: 9,
    likedByMe: false,
    likerIds: [],
    social_likes: [{ active: false }]
  })
  const malformed = share('sh_bad_counts', 'su_public', 'square', 100, {
    likeCount: -1,
    commentCount: '12'
  })
  const rows = [liked, malformed]
  const ctx = setup(baseSeed({
    social_users: [user(VIEWER_ID), user('su_public')],
    social_hand_shares: rows,
    social_likes: [{ _id: expectedLikeId, shareId: liked._id, actorId: VIEWER_ID, active: true }],
    social_comments: Array.from({ length: 50 }, (_, index) => ({ _id: `comment_${index}`, shareId: liked._id })),
    hands: rows.map(row => sourceHand(row))
  }))
  const result = await ctx.handlers.list_feed({ limit: 20 }, ACTOR)
  const first = result.items.find(item => item.shareId === liked._id)
  const second = result.items.find(item => item.shareId === malformed._id)
  assert.equal(first.likedByMe, true)
  assert.equal(first.likeCount, 7)
  assert.equal(first.commentCount, 9)
  assert.equal(second.likeCount, 0)
  assert.equal(second.commentCount, 0)
  assert.deepEqual(ctx.logs.like.sort(), [api.getLikeId(liked._id, VIEWER_ID), api.getLikeId(malformed._id, VIEWER_ID)].sort())
  assert.equal(ctx.logs.fullScans, 0)
})

test('FeedItemV1 is an exact recursive whitelist with https avatars and no canary or unsafe number', async () => {
  const row = share('sh_dto', 'su_public', 'square', 100, {
    likeCount: Number.MAX_SAFE_INTEGER,
    commentCount: Number.MAX_SAFE_INTEGER
  })
  const publisher = user('su_public', {
    nickname: 'Public User',
    avatarText: 'P',
    nested: { privatePlayerId: 'CANARY-publisher' },
    playerName: 'CANARY-player'
  })
  const ctx = setup(baseSeed({
    social_users: [user(VIEWER_ID), publisher],
    social_hand_shares: [row],
    hands: [sourceHand(row)]
  }))
  const result = await ctx.handlers.list_feed({ limit: 20 }, ACTOR)
  assert.equal(result.items.length, 1)
  const item = result.items[0]
  assertFeedItemShape(item)
  assert.equal(item.publisher.avatarUrl.startsWith('https://cdn.example/'), true)
  assert.deepEqual(item.summary, {
    heroCards: ['As', 'Ks'],
    board: { flop: ['Ah', '9s', '4d'], turn: ['Kc'], river: ['2h'] },
    potBb: 12.5,
    effectiveStackBb: 88,
    actionCount: 1,
    playerCount: 2
  })
  scanForbidden(result)
})

test('empty and fully filtered pages return null instead of an unadvanceable cursor', async () => {
  const empty = setup(baseSeed())
  assert.deepEqual(await empty.handlers.list_feed({ limit: 20 }, ACTOR), { items: [], nextCursor: null })

  const orphan = share('sh_only_orphan', 'su_public', 'square', 100)
  const filtered = setup(baseSeed({
    social_users: [user(VIEWER_ID), user('su_public')],
    social_hand_shares: [orphan],
    hands: []
  }))
  assert.deepEqual(await filtered.handlers.list_feed({ limit: 20 }, ACTOR), { items: [], nextCursor: null })
})

test('social app exposes list_feed and get_hand_share actions with server-derived identity', async () => {
  const row = share('sh_action', 'su_public', 'square', 100)
  const fake = createFeedRepository(baseSeed({
    social_users: [user(VIEWER_ID), user('su_public')],
    social_hand_shares: [row],
    hands: [sourceHand(row)]
  }))
  const app = createSocialApp({
    repository: fake.repository,
    identity: { resolve: async () => ACTOR },
    handFeed: { avatarUrl: async () => 'https://cdn.example/action.png' },
    requestId: () => 'feed-request'
  })
  const feed = await app.handle({ action: 'list_feed', limit: 20, viewerId: 'su_attacker' }, { openId: ACTOR.ownerOpenId })
  assert.equal(feed.code, 0)
  assert.deepEqual(feed.data.items.map(item => item.shareId), [row._id])
  const detail = await app.handle({ action: 'get_hand_share', shareId: row._id, viewerId: 'su_attacker' }, { openId: ACTOR.ownerOpenId })
  assert.equal(detail.code, 0)
  assert.equal(detail.data.shareId, row._id)
})

function createQueryDatabase(options) {
  const config = options || {}
  const calls = []
  let collectionWideGets = 0
  const command = config.command === false ? {} : {
    lt: value => ({ op: 'lt', value }),
    gt: value => ({ op: 'gt', value }),
    eq: value => ({ op: 'eq', value }),
    and: values => ({ op: 'and', values }),
    or: values => ({ op: 'or', values }),
    in: values => ({ op: 'in', values })
  }

  function query(collection, where) {
    const state = { collection, where, orderBy: [], limit: null }
    return {
      orderBy(field, direction) { state.orderBy.push([field, direction]); return this },
      limit(value) { state.limit = value; return this },
      skip() { throw new Error('skip is forbidden') },
      async get() {
        calls.push(JSON.parse(JSON.stringify(state)))
        if (config.queryError) throw config.queryError
        return { data: [] }
      }
    }
  }

  return {
    database: {
      command,
      collection(name) {
        return {
          where(filters) { return query(name, filters) },
          doc(id) { return { async get() { calls.push({ collection: name, doc: id }); return { data: null } } } },
          async get() { collectionWideGets += 1; return { data: [] } }
        }
      },
      runTransaction() { throw new Error('not used') }
    },
    calls,
    collectionWideGets: () => collectionWideGets
  }
}

test('production repository exposes exact feed queries, scalar ARRAY membership, keyset ties and no skip', async () => {
  const fake = createQueryDatabase()
  const repository = createCloudSocialRepository(fake.database)
  const methods = [
    'listSquareShareCandidates', 'listSelfShareCandidates', 'listFriendShareCandidates',
    'listSelectedShareCandidates', 'listAcceptedFriendshipsBySideKeyset',
    'getSourceHandById', 'getHandShareById', 'getLikeById'
  ]
  for (const method of methods) assert.equal(typeof repository[method], 'function', `repository missing ${method}`)

  const cursor = { createdAt: 100, id: 'sh_cursor' }
  await repository.listSquareShareCandidates({ cursor, limit: 5 })
  await repository.listSelfShareCandidates(VIEWER_ID, { cursor, limit: 5 })
  await repository.listFriendShareCandidates(['su_a', 'su_b'], { cursor, limit: 5 })
  await repository.listSelectedShareCandidates(VIEWER_ID, { cursor, limit: 5 })
  await repository.listAcceptedFriendshipsBySideKeyset(VIEWER_ID, 'userA', { cursor: { acceptedAt: 100, id: 'fr_cursor' }, limit: 5 })
  await repository.getSourceHandById('hand_1')
  await repository.getHandShareById('sh_1')
  await repository.getLikeById('lk_1')

  const shareQueries = fake.calls.filter(call => call.collection === 'social_hand_shares' && call.where)
  assert.equal(shareQueries.length, 4)
  assert.ok(shareQueries.every(call => JSON.stringify(call.orderBy) === JSON.stringify([['createdAt', 'desc'], ['_id', 'desc']])))
  assert.ok(shareQueries.every(call => call.limit === 5))
  const selected = shareQueries.find(call => JSON.stringify(call.where).includes('targetUserIds'))
  assert.ok(selected)
  assert.equal(JSON.stringify(selected.where).includes(`\"targetUserIds\":\"${VIEWER_ID}\"`), true, 'ARRAY contains must receive one scalar viewer')
  const friendshipQuery = fake.calls.find(call => call.collection === 'social_friendships')
  assert.deepEqual(friendshipQuery.orderBy, [['acceptedAt', 'desc'], ['_id', 'asc']])
  assert.equal(JSON.stringify(friendshipQuery.where).includes('"op":"gt"'), true, 'ascending id tie boundary must use gt')
  assert.equal(fake.collectionWideGets(), 0)
})

test('production repository fails closed when keyset commands or indexes are unavailable', async () => {
  const missingCommand = createQueryDatabase({ command: false })
  const repositoryWithoutCommand = createCloudSocialRepository(missingCommand.database)
  assert.equal(typeof repositoryWithoutCommand.listSquareShareCandidates, 'function', 'repository missing listSquareShareCandidates')
  await assert.rejects(repositoryWithoutCommand.listSquareShareCandidates({
    cursor: { createdAt: 100, id: 'sh_cursor' }, limit: 5
  }))
  assert.equal(missingCommand.collectionWideGets(), 0)

  const indexFailure = Object.assign(new Error('missing composite index'), { code: 'MISSING_INDEX' })
  const missingIndex = createQueryDatabase({ queryError: indexFailure })
  const repositoryWithoutIndex = createCloudSocialRepository(missingIndex.database)
  await assert.rejects(repositoryWithoutIndex.listSelectedShareCandidates(VIEWER_ID, { cursor: null, limit: 5 }), error => error === indexFailure)
  assert.equal(missingIndex.collectionWideGets(), 0)
})
