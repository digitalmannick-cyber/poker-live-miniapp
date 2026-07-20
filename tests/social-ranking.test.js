const test = require('node:test')
const assert = require('node:assert/strict')

const ranking = require('../cloudfunctions/poker_social/lib/ranking')
const { createSocialApp } = require('../cloudfunctions/poker_social/app')

test('rankRows uses duration-only competition ranks and returns an outside viewer once', () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    socialUserId: 'su_' + String(index + 1).padStart(2, '0'),
    nickname: 'Player ' + (index + 1),
    durationMinutes: 1200 - index * 50,
    recordedHandCount: index
  }))
  rows[2].durationMinutes = rows[1].durationMinutes
  rows[2].recordedHandCount = 9999
  const output = ranking.rankRows(rows, 'su_12')

  assert.equal(output.top10.length, 10)
  assert.equal(output.top10[1].rank, 2)
  assert.equal(output.top10[2].rank, 2)
  assert.equal(output.top10[3].rank, 4)
  assert.equal(output.myRank.socialUserId, 'su_12')
  assert.equal(output.myRank.rank, 12)
  assert.equal(output.top10.some(row => row.socialUserId === output.myRank.socialUserId), false)
  assert.doesNotMatch(JSON.stringify(output), /profit|buyIn|cashOut|ownerOpenId|privatePlayerId|venue/)

  const inside = ranking.rankRows(rows, 'su_01')
  assert.equal(inside.myRank, null)
})

test('Beijing week and month boundaries include only the requested daily buckets', () => {
  const now = Date.parse('2026-07-19T16:30:00.000Z') // Monday 00:30 in Beijing
  assert.equal(ranking.rangeStartDateKey('week', now), '20260720')
  assert.equal(ranking.rangeStartDateKey('month', now), '20260701')
  assert.equal(ranking.rangeStartDateKey('all', now), '')
  assert.deepEqual(ranking.rangeDateWindow('week', now), { startDateKey: '20260720', endDateKey: '20260727' })
  assert.deepEqual(ranking.rangeDateWindow('month', now), { startDateKey: '20260701', endDateKey: '20260801' })
  assert.deepEqual(ranking.rangeDateWindow('all', now), { startDateKey: '', endDateKey: '' })
  const weekRows = ranking.aggregateDailyStats([
    { socialUserId: 'su_a', dateKey: '20260719', durationMinutes: 90, recordedHandCount: 9 },
    { socialUserId: 'su_a', dateKey: '20260720', durationMinutes: 60, recordedHandCount: 3 },
    { socialUserId: 'su_a', dateKey: '20260727', durationMinutes: 600, recordedHandCount: 30 }
  ], ['su_a'], 'week', now)
  assert.deepEqual(weekRows, [{ socialUserId: 'su_a', durationMinutes: 60, recordedHandCount: 3 }])
  const monthRows = ranking.aggregateDailyStats([
    { socialUserId: 'su_a', dateKey: '20260731', durationMinutes: 40, recordedHandCount: 2 },
    { socialUserId: 'su_a', dateKey: '20260801', durationMinutes: 400, recordedHandCount: 20 }
  ], ['su_a'], 'month', now)
  assert.deepEqual(monthRows, [{ socialUserId: 'su_a', durationMinutes: 40, recordedHandCount: 2 }])
  const allRows = ranking.aggregateDailyStats([
    { socialUserId: 'su_a', dateKey: '20300101', durationMinutes: 15, recordedHandCount: 1 }
  ], ['su_a'], 'all', now)
  assert.deepEqual(allRows, [{ socialUserId: 'su_a', durationMinutes: 15, recordedHandCount: 1 }])
})

test('zero-duration users do not qualify through hand count and a zero viewer has no rank', () => {
  const output = ranking.rankRows([
    { socialUserId: 'su_zero', nickname: 'Many hands', durationMinutes: 0, recordedHandCount: 999 },
    { socialUserId: 'su_negative', nickname: 'Bad data', durationMinutes: -10, recordedHandCount: 999 },
    { socialUserId: 'su_friend', nickname: 'Played', durationMinutes: 1, recordedHandCount: 0 }
  ], 'su_zero')
  assert.deepEqual(output.top10.map(row => row.socialUserId), ['su_friend'])
  assert.equal(output.myRank, null)
  assert.deepEqual(ranking.rankRows([{ socialUserId: 'su_zero', durationMinutes: 0, recordedHandCount: 10 }], 'su_zero'), { top10: [], myRank: null })
})

test('ranking action is authenticated, friend-scoped, privacy filtered and never leaks records', async () => {
  const records = {
    social_users: [
      { _id: 'su_me', ownerOpenId: 'open-me', profile: { nickname: 'Me', avatarFileId: 'me-file' }, title: '常客', statsVisible: true },
      { _id: 'su_friend', ownerOpenId: 'open-f', profile: { nickname: 'Friend', avatarFileId: 'friend-file' }, title: '银狼', statsVisible: true, profit: 999 },
      { _id: 'su_hidden', ownerOpenId: 'open-h', profile: { nickname: 'Hidden' }, statsVisible: false },
      { _id: 'su_stranger', ownerOpenId: 'open-s', profile: { nickname: 'Stranger' }, statsVisible: true }
    ],
    social_friendships: [
      { _id: 'sf_1', userA: 'su_me', userB: 'su_friend', status: 'accepted' },
      { _id: 'sf_2', userA: 'su_me', userB: 'su_hidden', status: 'accepted' },
      { _id: 'sf_3', userA: 'su_me', userB: 'su_stranger', status: 'removed' }
    ],
    social_daily_stats: [
      { socialUserId: 'su_me', dateKey: '20260720', durationMinutes: 30, recordedHandCount: 1 },
      { socialUserId: 'su_friend', dateKey: '20260720', durationMinutes: 90, recordedHandCount: 4 },
      { socialUserId: 'su_hidden', dateKey: '20260720', durationMinutes: 999, recordedHandCount: 99 },
      { socialUserId: 'su_stranger', dateKey: '20260720', durationMinutes: 9999, recordedHandCount: 999 }
    ]
  }
  const repository = {
    async find(collection, query) { return records[collection].find(row => Object.keys(query).every(key => row[key] === query[key])) || null },
    async get(collection, id) { return records[collection].find(row => row._id === id) || null },
    async listAcceptedFriendships(userId) { return { items: records.social_friendships.filter(row => row.status === 'accepted' && (row.userA === userId || row.userB === userId)), nextOffset: null } },
    async listDailyStats(userIds) { return records.social_daily_stats.filter(row => userIds.includes(row.socialUserId)) }
  }
  const app = createSocialApp({
    repository,
    identity: { resolve: () => ({ ownerOpenId: 'open-me' }) },
    ranking: { now: () => Date.parse('2026-07-20T02:00:00.000Z'), avatarUrl: fileId => 'https://temp/' + fileId },
    requestId: () => 'rank-request'
  })
  const result = await app.handle({ action: 'list_ranking', rangeKey: 'week' }, {})

  assert.equal(result.code, 0)
  assert.deepEqual(result.data.top10.map(row => row.socialUserId), ['su_friend', 'su_me'])
  assert.equal(result.data.myRank, null)
  assert.equal(JSON.stringify(result).includes('su_hidden'), false)
  assert.equal(JSON.stringify(result).includes('su_stranger'), false)
  assert.doesNotMatch(JSON.stringify(result), /ownerOpenId|privatePlayerId|profit|buyIn|cashOut|venue|avatarFileId/)

  records.social_users[0].statsVisible = false
  const viewerHidden = await app.handle({ action: 'list_ranking', rangeKey: 'week' }, {})
  assert.deepEqual(viewerHidden.data.top10.map(row => row.socialUserId), ['su_friend'])
  assert.equal(viewerHidden.data.myRank, null)
  assert.equal(JSON.stringify(viewerHidden).includes('su_me'), false)

  records.social_users[0].statsVisible = true
  records.social_users[2].statsVisible = false
  records.social_daily_stats.forEach(row => {
    if (row.socialUserId === 'su_me' || row.socialUserId === 'su_friend') {
      row.durationMinutes = 0
      row.recordedHandCount = 999
    }
  })
  const handOnly = await app.handle({ action: 'list_ranking', rangeKey: 'week' }, {})
  assert.deepEqual(handOnly.data, { top10: [], myRank: null })
})

test('settings action applies an idempotent field patch and preserves concurrent profile and stats fields', async () => {
  const users = [{
    _id: 'su_me', ownerOpenId: 'open-me', profile: { nickname: 'Kept' }, title: 'Kept title',
    publicStats: { durationMinutes: 500, recordedHandCount: 7 }, statsVisible: true, defaultShareScope: 'friends'
  }]
  const mutations = []
  const repository = {
    find(collection, query) { return users.find(row => Object.keys(query).every(key => row[key] === query[key])) || null },
    get(collection, id) { return collection === 'social_mutations' ? mutations.find(row => row._id === id) || null : users.find(row => row._id === id) || null },
    set(collection, id, value) { const row = Object.assign({}, value, { _id: id }); mutations.push(row); return row },
    runTransaction(callback) { return callback(this) },
    patchSocialSettings(id, patch) { Object.assign(users.find(row => row._id === id), patch); return users.find(row => row._id === id) }
  }
  const app = createSocialApp({ repository, identity: { resolve: () => ({ ownerOpenId: 'open-me' }) }, requestId: () => 'settings-request' })
  const event = { action: 'update_social_settings', statsVisible: false, defaultShareScope: 'selected', clientMutationId: 'mut-1' }
  const first = await app.handle(event, {})
  const repeated = await app.handle(event, {})

  assert.equal(first.code, 0)
  assert.deepEqual(repeated.data, first.data)
  assert.deepEqual(users[0].profile, { nickname: 'Kept' })
  assert.equal(users[0].title, 'Kept title')
  assert.deepEqual(users[0].publicStats, { durationMinutes: 500, recordedHandCount: 7 })
  assert.equal(users[0].statsVisible, false)
  assert.equal(users[0].defaultShareScope, 'selected')
  assert.equal(mutations.length, 1)

  const invalid = await app.handle({ action: 'update_social_settings', defaultShareScope: 'everyone', clientMutationId: 'mut-2' }, {})
  assert.notEqual(invalid.code, 0)
})

test('CloudBase social settings update is a field patch, not a profile replacement', async () => {
  const original = {
    _id: 'su_me', ownerOpenId: 'private', profile: { nickname: 'Keep me', avatarFileId: 'keep-file' },
    title: 'Keep title', publicStats: { durationMinutes: 300, recordedHandCount: 5 }, statsVisible: true, defaultShareScope: 'friends'
  }
  let updateInput
  const database = {
    collection() {
      return {
        doc() {
          return {
            async update(input) { updateInput = input; Object.assign(original, input.data) }
          }
        }
      }
    }
  }
  const { createCloudSocialRepository } = require('../cloudfunctions/poker_social/lib/repository')
  const repository = createCloudSocialRepository(database)
  await repository.patchSocialSettings('su_me', { statsVisible: false, defaultShareScope: 'selected', updatedAt: 123 })

  assert.deepEqual(updateInput, { data: { statsVisible: false, defaultShareScope: 'selected', updatedAt: 123 } })
  assert.deepEqual(original.profile, { nickname: 'Keep me', avatarFileId: 'keep-file' })
  assert.equal(original.title, 'Keep title')
  assert.deepEqual(original.publicStats, { durationMinutes: 300, recordedHandCount: 5 })
})
