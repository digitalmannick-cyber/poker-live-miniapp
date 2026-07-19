const test = require('node:test')
const assert = require('node:assert/strict')

const { createSocialApp } = require('../cloudfunctions/poker_social/app')
const { getPairId } = require('../cloudfunctions/poker_social/lib/friendship')

const FORBIDDEN_KEYS = new Set([
  'ownerOpenId', '_openid', 'privatePlayerId', 'avatarFileId',
  'profit', 'currentProfit', 'buyIn', 'cashOut', 'hourlyRate', 'winRate',
  'venue', 'sessionName', 'sessionId', 'sourceHandId', 'playerNoteId',
  'leakTags', 'note', 'battleHandIds'
])

const ALLOWED_KEYS = Object.freeze({
  response: new Set(['code', 'data', 'requestId']),
  myProfile: new Set(['socialUserId', 'nickname', 'avatarUrl', 'avatarText', 'title', 'statsVisible', 'defaultShareScope']),
  friendPage: new Set(['items', 'nextOffset']),
  friend: new Set(['friendshipId', 'socialUserId', 'nickname', 'avatarUrl', 'avatarText', 'title', 'statsVisible', 'durationMinutes', 'recordedHandCount']),
  friendDetail: new Set(['friendshipId', 'socialUserId', 'nickname', 'avatarUrl', 'avatarText', 'title', 'statsVisible', 'durationMinutes', 'recordedHandCount', 'acceptedAt']),
  ranking: new Set(['top10', 'myRank']),
  rankRow: new Set(['socialUserId', 'nickname', 'avatarUrl', 'avatarText', 'title', 'durationMinutes', 'recordedHandCount', 'rank'])
})

function assertNoPrivateData(value, path = '$') {
  if (typeof value === 'string') {
    assert.equal(value.includes('cloud://'), false, path + ' leaked a CloudBase file id')
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPrivateData(item, path + '[' + index + ']'))
    return
  }
  if (!value || typeof value !== 'object') return
  Object.entries(value).forEach(([key, child]) => {
    assert.equal(FORBIDDEN_KEYS.has(key), false, path + '.' + key + ' is private')
    assertNoPrivateData(child, path + '.' + key)
  })
}

function assertExactKeys(value, allowed, path) {
  assert.deepEqual(Object.keys(value).sort(), Array.from(allowed).sort(), path + ' DTO keys changed')
}

function assertAllowedKeys(value, allowed, path) {
  for (const key of Object.keys(value)) assert.equal(allowed.has(key), true, path + '.' + key + ' is not public')
}

function createSecurityFixture() {
  const users = []
  const friendships = []
  const dailyStats = []
  const secrets = {
    ownerOpenId: 'open-private',
    _openid: 'shadow-private',
    privatePlayerId: 'PLAYER-LIBRARY-ID',
    avatarFileId: 'cloud://private/root-avatar.png',
    profit: 999999,
    currentProfit: 888888,
    buyIn: 777777,
    cashOut: 666666,
    hourlyRate: 555555,
    winRate: 0.99,
    venue: 'private venue',
    sessionName: 'private session',
    sessionId: 'private-session-id',
    sourceHandId: 'private-hand-id',
    playerNoteId: 'private-note-id',
    leakTags: ['private leak'],
    note: 'private note',
    battleHandIds: ['private-battle-id']
  }
  function addUser(id, openId, options = {}) {
    users.push(Object.assign({}, secrets, {
      _id: id,
      ownerOpenId: openId,
      privatePlayerId: 'PRIVATE-' + id,
      profile: {
        nickname: options.nickname || id,
        avatarText: (options.nickname || id).slice(0, 1),
        avatarFileId: 'cloud://private/' + id + '.png',
        note: 'nested private note',
        leakTags: ['nested private leak']
      },
      title: options.title || '常客',
      statsVisible: options.statsVisible !== false,
      defaultShareScope: 'friends',
      publicStats: { durationMinutes: options.durationMinutes || 0, recordedHandCount: options.recordedHandCount || 0 }
    }))
  }
  addUser('su_me', 'open-me', { nickname: 'Hero', durationMinutes: 50, recordedHandCount: 5 })
  for (let index = 1; index <= 12; index += 1) {
    addUser('su_friend_' + index, 'open-friend-' + index, {
      nickname: 'Friend ' + index,
      durationMinutes: 130 - index * 5,
      recordedHandCount: index
    })
    friendships.push({
      _id: getPairId('su_me', 'su_friend_' + index),
      userA: 'su_me',
      userB: 'su_friend_' + index,
      status: 'accepted',
      acceptedAt: 1000 + index,
      profileSnapshots: {}
    })
  }
  addUser('su_hidden', 'open-hidden', { nickname: 'Hidden', statsVisible: false, durationMinutes: 9999, recordedHandCount: 999 })
  friendships.push({ _id: getPairId('su_me', 'su_hidden'), userA: 'su_hidden', userB: 'su_me', status: 'accepted', acceptedAt: 2000, profileSnapshots: {} })
  addUser('su_removed', 'open-removed', { nickname: 'Removed', durationMinutes: 9999, recordedHandCount: 999 })
  friendships.push({ _id: getPairId('su_me', 'su_removed'), userA: 'su_me', userB: 'su_removed', status: 'removed', acceptedAt: 3000, profileSnapshots: {} })
  addUser('su_stranger', 'open-stranger', { nickname: 'Stranger', durationMinutes: 9999, recordedHandCount: 999 })

  for (const user of users) {
    const stats = user.publicStats
    dailyStats.push({
      socialUserId: user._id,
      dateKey: '20260720',
      durationMinutes: stats.durationMinutes,
      recordedHandCount: stats.recordedHandCount,
      profit: 12345,
      venue: 'private daily venue'
    })
  }

  const repository = {
    find(collection, query) {
      const rows = collection === 'social_users' ? users : friendships
      return rows.find(row => Object.keys(query).every(key => row[key] === query[key])) || null
    },
    get(collection, id) {
      const rows = collection === 'social_users' ? users : friendships
      return rows.find(row => row._id === id) || null
    },
    set(collection, id, value) {
      const rows = collection === 'social_users' ? users : friendships
      const index = rows.findIndex(row => row._id === id)
      const next = Object.assign({}, value, { _id: id })
      if (index >= 0) rows[index] = next
      else rows.push(next)
      return next
    },
    where(collection, predicate) {
      const rows = collection === 'social_users' ? users : friendships
      return rows.filter(predicate)
    },
    runTransaction(callback) { return callback(this) },
    listAcceptedFriendships(userId, options = {}) {
      const rows = friendships.filter(row => row.status === 'accepted' && (row.userA === userId || row.userB === userId))
      const offset = Number(options.offset) || 0
      const limit = Number(options.limit) || 50
      return { items: rows.slice(offset, offset + limit), nextOffset: rows.length > offset + limit ? offset + limit : null }
    },
    listDailyStats(userIds) { return dailyStats.filter(row => userIds.includes(row.socialUserId)) }
  }
  const app = createSocialApp({
    repository,
    identity: { resolve: openId => ({ ownerOpenId: openId }) },
    avatarUrl: async () => 'https://temp.example/signed-avatar.png',
    ranking: { now: () => Date.parse('2026-07-20T04:00:00.000Z') },
    friendship: { now: () => 5000 },
    requestId: () => 'security-acceptance'
  })
  return { app, users, friendships, dailyStats }
}

test('real profile, friend list, friend detail and ranking actions emit strict public DTOs', async () => {
  const { app } = createSecurityFixture()
  const context = { openId: 'open-me' }
  const mine = await app.handle({ action: 'get_my_social_profile' }, context)
  const friends = await app.handle({ action: 'list_friends', limit: 50 }, context)
  const detail = await app.handle({ action: 'get_friend_detail', friendUserId: 'su_friend_1' }, context)
  const ranking = await app.handle({ action: 'list_ranking', rangeKey: 'week' }, context)

  for (const response of [mine, friends, detail, ranking]) {
    assert.equal(response.code, 0)
    assertExactKeys(response, ALLOWED_KEYS.response, 'response')
    assertNoPrivateData(response)
  }
  assertExactKeys(mine.data, ALLOWED_KEYS.myProfile, 'my profile')
  assertExactKeys(friends.data, ALLOWED_KEYS.friendPage, 'friend page')
  friends.data.items.forEach(item => {
    assertAllowedKeys(item, ALLOWED_KEYS.friend, 'friend item')
    for (const required of ['friendshipId', 'socialUserId', 'nickname', 'avatarUrl', 'avatarText', 'title', 'statsVisible']) {
      assert.equal(Object.hasOwn(item, required), true, 'friend item omitted ' + required)
    }
  })
  assertExactKeys(detail.data, ALLOWED_KEYS.friendDetail, 'friend detail')
  assertExactKeys(ranking.data, ALLOWED_KEYS.ranking, 'ranking')
  ranking.data.top10.forEach(item => assertExactKeys(item, ALLOWED_KEYS.rankRow, 'rank row'))
  if (ranking.data.myRank) assertExactKeys(ranking.data.myRank, ALLOWED_KEYS.rankRow, 'my rank')
})

test('hidden statistics are absent from detail and all ranking windows', async () => {
  const { app, users } = createSecurityFixture()
  const context = { openId: 'open-me' }
  const hiddenDetail = await app.handle({ action: 'get_friend_detail', friendUserId: 'su_hidden' }, context)
  assert.equal(hiddenDetail.code, 0)
  assert.equal(Object.hasOwn(hiddenDetail.data, 'durationMinutes'), false)
  assert.equal(Object.hasOwn(hiddenDetail.data, 'recordedHandCount'), false)

  for (const rangeKey of ['week', 'month', 'all']) {
    const ranking = await app.handle({ action: 'list_ranking', rangeKey }, context)
    assert.equal(ranking.code, 0)
    assert.equal(JSON.stringify(ranking.data).includes('su_hidden'), false, rangeKey + ' exposed a hidden user')
  }

  users.find(user => user._id === 'su_friend_1').statsVisible = false
  const newlyHidden = await app.handle({ action: 'get_friend_detail', friendUserId: 'su_friend_1' }, context)
  assert.equal(Object.hasOwn(newlyHidden.data, 'durationMinutes'), false)
  assert.equal(Object.hasOwn(newlyHidden.data, 'recordedHandCount'), false)
})

test('only accepted friends are readable and removal immediately revokes detail and ranking eligibility', async () => {
  const { app } = createSecurityFixture()
  const context = { openId: 'open-me' }

  for (const friendUserId of ['su_stranger', 'su_removed']) {
    const denied = await app.handle({ action: 'get_friend_detail', friendUserId }, context)
    assert.notEqual(denied.code, 0)
    assert.equal(denied.data, null)
  }
  const accepted = await app.handle({ action: 'get_friend_detail', friendUserId: 'su_friend_1' }, context)
  assert.equal(accepted.code, 0)

  const removed = await app.handle({
    action: 'remove_friend',
    friendshipId: accepted.data.friendshipId,
    clientMutationId: 'security-remove-friend-1'
  }, context)
  assert.equal(removed.code, 0)
  const afterRemoval = await app.handle({ action: 'get_friend_detail', friendUserId: 'su_friend_1' }, context)
  assert.notEqual(afterRemoval.code, 0)
  const ranking = await app.handle({ action: 'list_ranking', rangeKey: 'week' }, context)
  const rankedIds = ranking.data.top10.concat(ranking.data.myRank || []).map(row => row.socialUserId)
  assert.equal(rankedIds.includes('su_friend_1'), false)
  assert.equal(rankedIds.includes('su_removed'), false)
  assert.equal(rankedIds.includes('su_stranger'), false)
})

test('ranking returns only Top 10 plus the viewer and never exposes lower-ranked friends', async () => {
  const { app, dailyStats } = createSecurityFixture()
  const context = { openId: 'open-me' }
  const result = await app.handle({ action: 'list_ranking', rangeKey: 'week' }, context)

  assert.equal(result.code, 0)
  assert.equal(result.data.top10.length, 10)
  assert.equal(result.data.myRank.socialUserId, 'su_me')
  assert.equal(result.data.top10.some(row => row.socialUserId === 'su_me'), false)
  assert.equal(JSON.stringify(result.data).includes('su_friend_11'), false)
  assert.equal(JSON.stringify(result.data).includes('su_friend_12'), false)

  dailyStats.find(row => row.socialUserId === 'su_me').durationMinutes = 1000
  const viewerInside = await app.handle({ action: 'list_ranking', rangeKey: 'week' }, context)
  assert.equal(viewerInside.data.top10[0].socialUserId, 'su_me')
  assert.equal(viewerInside.data.myRank, null)

  dailyStats.find(row => row.socialUserId === 'su_me').durationMinutes = 0
  dailyStats.find(row => row.socialUserId === 'su_me').recordedHandCount = 999
  const zeroViewer = await app.handle({ action: 'list_ranking', rangeKey: 'week' }, context)
  assert.equal(zeroViewer.data.myRank, null)
  assert.equal(JSON.stringify(zeroViewer.data).includes('su_me'), false)
})
