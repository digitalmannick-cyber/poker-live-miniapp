const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')
const test = require('node:test')

const syncPath = path.resolve(__dirname, '../utils/social-profile-sync.js')
const originalLoad = Module._load

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function loadSync(options) {
  const config = options || {}
  const storage = new Map()
  const calls = { get: 0, initialize: [], upload: [] }
  global.wx = {
    getStorageSync(key) { return storage.get(key) },
    setStorageSync(key, value) { storage.set(key, value) },
    removeStorageSync(key) { storage.delete(key) },
    cloud: {
      uploadFile(input) {
        calls.upload.push(input)
        return config.upload ? config.upload(input, calls.upload.length) : Promise.resolve({ fileID: 'cloud://social/avatar.jpg' })
      }
    }
  }
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '../services/social-service' && parent && parent.filename === syncPath) {
      return {
        getMySocialProfile() {
          calls.get += 1
          return config.getProfile(calls.get)
        },
        initializeSocialProfile(input) {
          calls.initialize.push(input)
          return config.initialize ? config.initialize(input) : Promise.resolve({ socialUserId: 'su-me', nickname: input.nickname })
        }
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  delete require.cache[syncPath]
  const api = require(syncPath)
  Module._load = originalLoad
  return { api, calls, storage }
}

function missingProfile() {
  const error = new Error('social profile required')
  error.code = 'SOCIAL_PROFILE_REQUIRED'
  return Promise.reject(error)
}

test('first player entry initializes the selected nickname and uploaded avatar only once under concurrency', async () => {
  const gate = deferred()
  const loaded = loadSync({
    getProfile() { return missingProfile() },
    initialize(input) { return gate.promise.then(() => ({ socialUserId: 'su-me', nickname: input.nickname })) }
  })
  const local = { playerId: ' wx-p57 ', name: '夜鸦', avatarUrl: 'wxfile://chosen-avatar.png' }
  const first = loaded.api.syncSocialProfile(local)
  const second = loaded.api.syncSocialProfile(local)
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(first, second)
  assert.equal(loaded.calls.get, 1)
  assert.equal(loaded.calls.upload.length, 1)
  assert.equal(loaded.calls.initialize.length, 1)
  assert.deepEqual(loaded.calls.initialize[0], {
    playerId: 'WX-P57',
    nickname: '夜鸦',
    avatarMode: 'custom',
    avatarFileId: 'cloud://social/avatar.jpg',
    statsVisible: true,
    defaultShareScope: 'friends'
  })
  gate.resolve()
  assert.equal((await first).socialUserId, 'su-me')
})

test('public profile edits preserve existing privacy settings', async () => {
  const loaded = loadSync({
    getProfile() {
      return Promise.resolve({ socialUserId: 'su-me', nickname: '旧昵称', statsVisible: false, defaultShareScope: 'selected' })
    }
  })
  await loaded.api.syncSocialProfile({ playerId: 'WX-P58', name: '新昵称', avatarFileId: 'cloud://selected.png' }, { force: true })

  assert.equal(loaded.calls.upload.length, 0)
  assert.equal(loaded.calls.initialize.length, 1)
  assert.equal(loaded.calls.initialize[0].statsVisible, false)
  assert.equal(loaded.calls.initialize[0].defaultShareScope, 'selected')
  assert.equal(loaded.calls.initialize[0].nickname, '新昵称')
})

test('a failed first-time avatar upload does not block social identity creation and remains retryable', async () => {
  const loaded = loadSync({
    getProfile(attempt) {
      if (attempt === 1) return missingProfile()
      return Promise.resolve({ socialUserId: 'su-me', nickname: '银狼', statsVisible: true, defaultShareScope: 'friends' })
    },
    upload(input, attempt) {
      if (attempt === 1) return Promise.reject(new Error('offline'))
      return Promise.resolve({ fileID: 'cloud://social/recovered.jpg' })
    }
  })
  const local = { playerId: 'WX-P59', name: '银狼', avatarUrl: 'wxfile://avatar.jpg' }

  const created = await loaded.api.syncSocialProfile(local)
  assert.equal(created.socialUserId, 'su-me')
  assert.equal(loaded.calls.initialize[0].avatarFileId, '')
  const recovered = await loaded.api.syncSocialProfile(local)
  assert.equal(recovered.socialUserId, 'su-me')
  assert.equal(loaded.calls.get, 2)
  assert.equal(loaded.calls.upload.length, 2)
  assert.equal(loaded.calls.initialize.length, 2)
  assert.equal(loaded.calls.initialize[1].avatarFileId, 'cloud://social/recovered.jpg')

  await loaded.api.syncSocialProfile(local, { force: true })
  assert.equal(loaded.calls.upload.length, 2, 'a successful upload mapping avoids duplicate cloud files')
})

test('a later avatar retry failure returns the existing social identity instead of blocking friends', async () => {
  const remote = { socialUserId: 'su-existing', nickname: '银狼', statsVisible: true, defaultShareScope: 'friends' }
  const loaded = loadSync({
    getProfile() { return Promise.resolve(remote) },
    upload() { return Promise.reject(new Error('expired avatar path')) }
  })
  loaded.storage.set('pokerSocialProfilePending:WX-P59B', { fingerprint: 'pending' })

  const result = await loaded.api.syncSocialProfile({ playerId: 'WX-P59B', name: '银狼', avatarUrl: 'wxfile://expired.jpg' }, { force: true })
  assert.deepEqual(result, remote)
  assert.equal(loaded.calls.initialize.length, 0)
})

test('a cache-reset placeholder profile restores the existing cloud identity instead of overwriting it', async () => {
  const remote = {
    socialUserId: 'su-existing',
    nickname: 'HIDE1900',
    avatarUrl: 'https://example.test/avatar.jpg',
    statsVisible: true,
    defaultShareScope: 'friends'
  }
  const loaded = loadSync({ getProfile() { return Promise.resolve(remote) } })
  loaded.storage.set('pokerSocialProfilePending:WX-P59C', {
    fingerprint: 'WX-P59C|\u73a9\u5bb6|',
    updatedAt: Date.now()
  })

  const result = await loaded.api.syncSocialProfile({
    playerId: 'WX-P59C',
    name: '\u73a9\u5bb6',
    avatarUrl: ''
  }, { force: true })

  assert.deepEqual(result, remote)
  assert.equal(loaded.calls.upload.length, 0)
  assert.equal(loaded.calls.initialize.length, 0)
  assert.equal(loaded.storage.has('pokerSocialProfilePending:WX-P59C'), false)
})

test('automatic login keeps an existing cloud identity when the restored local nickname differs', async () => {
  const remote = {
    socialUserId: 'su-existing',
    nickname: '\ue035HIDE\ue0351900',
    avatarUrl: 'https://example.test/avatar.jpg',
    statsVisible: true,
    defaultShareScope: 'selected'
  }
  const loaded = loadSync({ getProfile() { return Promise.resolve(remote) } })
  loaded.storage.set('pokerSocialProfilePending:WX-P59D', {
    fingerprint: 'WX-P59D|HIDE1900|',
    updatedAt: Date.now()
  })

  const result = await loaded.api.syncSocialProfile({
    playerId: 'WX-P59D',
    name: 'HIDE1900',
    avatarUrl: ''
  })

  assert.deepEqual(result, remote)
  assert.equal(loaded.calls.upload.length, 0)
  assert.equal(loaded.calls.initialize.length, 0)
  assert.equal(loaded.storage.has('pokerSocialProfilePending:WX-P59D'), false)
})

test('anonymous and local test accounts never initialize a social identity', async () => {
  const loaded = loadSync({ getProfile() { return missingProfile() } })
  assert.deepEqual(await loaded.api.syncSocialProfile({ playerId: 'P5-LOCAL', name: '本地玩家' }), { skipped: true, socialUserId: '' })
  assert.deepEqual(await loaded.api.syncSocialProfile({ playerId: 'TEST-123', name: '测试账号' }), { skipped: true, socialUserId: '' })
  assert.equal(loaded.calls.get, 0)
  assert.equal(loaded.calls.initialize.length, 0)
})

test('an account switch after avatar upload prevents the first social binding write', async () => {
  const upload = deferred()
  let current = true
  const loaded = loadSync({
    getProfile() { return missingProfile() },
    upload() { return upload.promise }
  })
  const pending = loaded.api.syncSocialProfile(
    { playerId: 'WX-P60', name: '当前用户', avatarUrl: 'wxfile://avatar.jpg' },
    { isCurrent: () => current }
  )
  await new Promise(resolve => setImmediate(resolve))
  current = false
  upload.resolve({ fileID: 'cloud://social/stale.jpg' })
  await assert.rejects(pending, error => error && error.code === 'STALE_ACCOUNT_CONTEXT')
  assert.equal(loaded.calls.initialize.length, 0)
})
