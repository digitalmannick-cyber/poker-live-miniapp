const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')

const profile = require('../cloudfunctions/poker_social/lib/profile')

test('profile DTO never exposes owner identity or avatar file id', () => {
  const dto = profile.toProfileDto({
    _id: 'su_1',
    ownerOpenId: 'secret',
    privatePlayerId: 'PLAYER-1',
    profile: { nickname: '老王', avatarFileId: 'cloud://secret' }
  }, { avatarUrl: 'https://temp/avatar' })

  assert.deepEqual(dto, {
    socialUserId: 'su_1',
    nickname: '老王',
    avatarUrl: 'https://temp/avatar',
    avatarText: '老',
    title: '初来乍到',
    statsVisible: true,
    defaultShareScope: 'friends'
  })
  assert.doesNotMatch(JSON.stringify(dto), /ownerOpenId|privatePlayerId|avatarFileId|secret/)
})

test('profile input retains player identity privately and requires an explicit supported avatar mode', () => {
  const input = profile.normalizeProfileInput({
    playerId: ' player-7 ',
    nickname: '  阿强  ',
    avatarMode: 'wechat',
    avatarFileId: 'cloud://avatar',
    statsVisible: false,
    defaultShareScope: 'selected'
  })

  assert.deepEqual(input, {
    privatePlayerId: 'PLAYER-7',
    profile: { nickname: '阿强', avatarFileId: 'cloud://avatar', avatarText: '阿' },
    avatarMode: 'wechat',
    statsVisible: false,
    defaultShareScope: 'selected'
  })
  assert.throws(
    () => profile.normalizeProfileInput({ nickname: '阿强', avatarMode: 'silent' }),
    error => error.code === 'INVALID_PROFILE'
  )
})

test('social app persists a private profile and returns only its public DTO', async () => {
  const records = []
  const repository = {
    async find(collection, query) {
      return records.find(row => row.ownerOpenId === query.ownerOpenId) || null
    },
    async set(collection, id, value) {
      const record = Object.assign({}, value, { _id: id })
      const index = records.findIndex(row => row._id === id)
      if (index >= 0) records[index] = record
      else records.push(record)
      return record
    }
  }
  const { createSocialApp } = require('../cloudfunctions/poker_social/app')
  const app = createSocialApp({
    repository,
    identity: { resolve: () => ({ ownerOpenId: 'openid-private' }) },
    requestId: () => 'profile-request',
    avatarUrl: async fileId => 'https://temp/' + fileId
  })

  const created = await app.handle({
    action: 'initialize_social_profile',
    playerId: 'player-7',
    nickname: '阿强',
    avatarMode: 'custom',
    avatarFileId: 'avatar-file',
    defaultShareScope: 'square'
  }, {})
  const read = await app.handle({ action: 'get_my_social_profile' }, {})

  assert.equal(created.code, 0)
  assert.match(created.data.socialUserId, /^su_[0-9a-f]{32}$/)
  assert.deepEqual(read, { code: 0, data: created.data, requestId: 'profile-request' })
  assert.equal(records[0].ownerOpenId, 'openid-private')
  assert.equal(records[0].privatePlayerId, 'PLAYER-7')
  assert.equal(records[0].profile.avatarFileId, 'avatar-file')
  assert.deepEqual(Object.keys(created.data).sort(), [
    'avatarText', 'avatarUrl', 'defaultShareScope', 'nickname', 'socialUserId', 'statsVisible', 'title'
  ])
  assert.equal(Object.hasOwn(created.data, 'ownerOpenId'), false)
  assert.equal(Object.hasOwn(created.data, 'privatePlayerId'), false)
  assert.equal(Object.hasOwn(created.data, 'avatarFileId'), false)
})

test('updating public profile keeps earned title and explicit privacy choices', async () => {
  const records = [{
    _id: 'su_existing',
    ownerOpenId: 'openid-private',
    privatePlayerId: 'PLAYER-1',
    profile: { nickname: '旧昵称', avatarFileId: 'cloud://old', avatarText: '旧' },
    avatarMode: 'custom',
    title: '牌桌领航员',
    statsVisible: false,
    defaultShareScope: 'selected',
    createdAt: 100
  }]
  const repository = {
    async find(collection, query) { return records.find(row => row.ownerOpenId === query.ownerOpenId) || null },
    async set(collection, id, value) {
      const record = Object.assign({}, value, { _id: id })
      records[0] = record
      return record
    }
  }
  const { createSocialApp } = require('../cloudfunctions/poker_social/app')
  const app = createSocialApp({
    repository,
    identity: { resolve: () => ({ ownerOpenId: 'openid-private' }) },
    requestId: () => 'profile-update',
    avatarUrl: async fileId => 'https://temp/' + fileId
  })

  const result = await app.handle({
    action: 'initialize_social_profile',
    playerId: 'player-1',
    nickname: '新昵称',
    avatarMode: 'custom',
    avatarFileId: 'cloud://new',
    statsVisible: true,
    defaultShareScope: 'friends'
  }, {})

  assert.equal(result.code, 0)
  assert.equal(result.data.nickname, '新昵称')
  assert.equal(result.data.title, '牌桌领航员')
  assert.equal(result.data.statsVisible, false)
  assert.equal(result.data.defaultShareScope, 'selected')
  assert.equal(records[0].createdAt, 100)
})

test('updating public profile cannot rebind the private player identity', async () => {
  const records = [{
    _id: 'su_existing', ownerOpenId: 'openid-private', privatePlayerId: 'PLAYER-1',
    profile: { nickname: '旧昵称', avatarFileId: '', avatarText: '旧' },
    avatarMode: 'custom', state: 'active', generation: 0, createdAt: 100
  }]
  const repository = {
    async find(collection, query) { return records.find(row => row.ownerOpenId === query.ownerOpenId) || null },
    async set(collection, id, value) { records[0] = Object.assign({}, value, { _id: id }); return records[0] }
  }
  const { createSocialApp } = require('../cloudfunctions/poker_social/app')
  const app = createSocialApp({
    repository,
    identity: { resolve: () => ({ ownerOpenId: 'openid-private' }) },
    requestId: () => 'profile-rebind'
  })
  const result = await app.handle({
    action: 'initialize_social_profile', playerId: 'player-2', nickname: '新昵称', avatarMode: 'custom'
  }, {})
  assert.equal(result.code, 'SOCIAL_PROFILE_PLAYER_MISMATCH')
  assert.equal(records[0].privatePlayerId, 'PLAYER-1')
  assert.equal(records[0].profile.nickname, '旧昵称')
})

test('social service forwards only explicitly supplied profile input', async () => {
  const apiPath = require.resolve('../services/social-api')
  const servicePath = require.resolve('../services/social-service')
  const api = require(apiPath)
  const original = api.callSocialFunction
  const calls = []
  api.callSocialFunction = async (action, payload) => {
    calls.push({ action, payload })
    return { socialUserId: 'su_1' }
  }
  delete require.cache[servicePath]

  try {
    const service = require('../services/social-service')
    const input = { nickname: '用户选择的昵称', avatarMode: 'wechat', avatarFileId: 'selected-avatar' }
    assert.deepEqual(await service.initializeSocialProfile(input), { socialUserId: 'su_1' })
    assert.deepEqual(await service.getMySocialProfile(), { socialUserId: 'su_1' })
    assert.deepEqual(calls, [
      { action: 'initialize_social_profile', payload: input },
      { action: 'get_my_social_profile', payload: undefined }
    ])
  } finally {
    api.callSocialFunction = original
    delete require.cache[servicePath]
  }
})

test('CloudBase repository persists a profile and finds it by owner identity', async () => {
  const records = []
  const writes = []
  const database = {
    collection(name) {
      return {
        doc(id) {
          return {
            async get() {
              return { data: records.find(row => row._id === id) || null }
            },
            async set(input) {
              writes.push({ name, id, input })
              const record = Object.assign({}, input.data, { _id: id })
              const index = records.findIndex(row => row._id === id)
              if (index >= 0) records[index] = record
              else records.push(record)
            }
          }
        },
        where(query) {
          return {
            limit() {
              return {
                async get() {
                  return { data: records.filter(row => Object.keys(query).every(key => row[key] === query[key])) }
                }
              }
            }
          }
        }
      }
    }
  }
  const { createCloudSocialRepository } = require('../cloudfunctions/poker_social/lib/repository')
  const repository = createCloudSocialRepository(database)

  await repository.set('social_users', 'su_1', { ownerOpenId: 'openid-private', privatePlayerId: 'PLAYER-1' })

  assert.deepEqual(writes, [{
    name: 'social_users',
    id: 'su_1',
    input: { data: { ownerOpenId: 'openid-private', privatePlayerId: 'PLAYER-1' } }
  }])
  assert.deepEqual(await repository.get('social_users', 'su_1'), {
    _id: 'su_1', ownerOpenId: 'openid-private', privatePlayerId: 'PLAYER-1'
  })
  assert.deepEqual(await repository.find('social_users', { ownerOpenId: 'openid-private' }), {
    _id: 'su_1', ownerOpenId: 'openid-private', privatePlayerId: 'PLAYER-1'
  })
})

test('CloudBase repository uses the real transaction API shape and returns the callback value', async () => {
  const records = new Map()
  const database = {
    collection(name) {
      return {
        doc(id) {
          return { name, id }
        }
      }
    },
    async runTransaction(callback) {
      const transaction = {
        async get(ref) {
          const value = records.get(ref.name + '/' + ref.id)
          return { data: () => value || null }
        },
        async set(ref, data) {
          records.set(ref.name + '/' + ref.id, Object.assign({}, data))
        },
        async delete(ref) {
          records.delete(ref.name + '/' + ref.id)
        }
      }
      assert.equal(transaction.collection, undefined)
      await callback(transaction)
    }
  }
  const { createCloudSocialRepository } = require('../cloudfunctions/poker_social/lib/repository')
  const repository = createCloudSocialRepository(database)

  const result = await repository.runTransaction(async store => {
    assert.equal(await store.get('social_users', 'su_1'), null)
    await store.set('social_users', 'su_1', { nickname: 'Alice' })
    assert.deepEqual(await store.get('social_users', 'su_1'), { _id: 'su_1', nickname: 'Alice' })
    return { socialUserId: 'su_1' }
  })

  assert.deepEqual(result, { socialUserId: 'su_1' })
  assert.deepEqual(records.get('social_users/su_1'), { nickname: 'Alice' })
})

test('uninitialized profile returns the stable public initialization error', async () => {
  const { createSocialApp } = require('../cloudfunctions/poker_social/app')
  const app = createSocialApp({
    repository: { find: async () => null },
    identity: { resolve: () => ({ ownerOpenId: 'openid-private' }) },
    requestId: () => 'profile-required-request'
  })

  const result = await app.handle({ action: 'get_my_social_profile' }, {})

  assert.deepEqual(result, {
    code: 'SOCIAL_PROFILE_REQUIRED',
    data: null,
    message: 'social profile required',
    requestId: 'profile-required-request'
  })
  assert.doesNotMatch(JSON.stringify(result), /openid-private|ownerOpenId|privatePlayerId|avatarFileId/)
})

test('CloudBase entrypoint reads a profile after a cold-start reload', async () => {
  const tables = {}
  const database = {
    collection(name) {
      const records = tables[name] || (tables[name] = [])
      return {
        doc(id) {
          return {
            async get() {
              return { data: records.find(row => row._id === id) || null }
            },
            async set(input) {
              const record = Object.assign({}, input.data, { _id: id })
              const index = records.findIndex(row => row._id === id)
              if (index >= 0) records[index] = record
              else records.push(record)
            }
          }
        },
        where(query) {
          return {
            limit() {
              return {
                async get() {
                  return { data: records.filter(row => Object.keys(query).every(key => row[key] === query[key])) }
                }
              }
            }
          }
        }
      }
    }
  }
  const cloud = {
    DYNAMIC_CURRENT_ENV: 'dynamic',
    init() {},
    database: () => database,
    getWXContext: () => ({ OPENID: 'openid-persistent' }),
    getTempFileURL: async ({ fileList }) => ({ fileList: [{ tempFileURL: 'https://temp/' + fileList[0] }] })
  }
  const entryPath = path.join(__dirname, '..', 'cloudfunctions', 'poker_social', 'index.js')
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (request === 'wx-server-sdk') return cloud
    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    delete require.cache[entryPath]
    const firstEntry = require(entryPath)
    const created = await firstEntry.main({
      action: 'initialize_social_profile',
      playerId: 'player-9',
      nickname: '持久化玩家',
      avatarMode: 'custom',
      avatarFileId: 'avatar-9'
    })

    delete require.cache[entryPath]
    const secondEntry = require(entryPath)
    const read = await secondEntry.main({ action: 'get_my_social_profile' })

    assert.equal(created.code, 0)
    assert.deepEqual(read.data, created.data)
    assert.match(read.data.socialUserId, /^su_[0-9a-f]{32}$/)
    assert.equal(tables.social_users.length, 1)
  } finally {
    Module._load = originalLoad
    delete require.cache[entryPath]
  }
})
