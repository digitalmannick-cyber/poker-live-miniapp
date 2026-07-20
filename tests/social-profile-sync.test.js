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

test('failed avatar sync remains retryable and reuses the uploaded avatar after recovery', async () => {
  const loaded = loadSync({
    getProfile() { return missingProfile() },
    upload(input, attempt) {
      if (attempt === 1) return Promise.reject(new Error('offline'))
      return Promise.resolve({ fileID: 'cloud://social/recovered.jpg' })
    }
  })
  const local = { playerId: 'WX-P59', name: '银狼', avatarUrl: 'wxfile://avatar.jpg' }

  await assert.rejects(loaded.api.syncSocialProfile(local), /offline/)
  const recovered = await loaded.api.syncSocialProfile(local)
  assert.equal(recovered.socialUserId, 'su-me')
  assert.equal(loaded.calls.get, 2)
  assert.equal(loaded.calls.upload.length, 2)
  assert.equal(loaded.calls.initialize.length, 1)

  await loaded.api.syncSocialProfile(local, { force: true })
  assert.equal(loaded.calls.upload.length, 2, 'a successful upload mapping avoids duplicate cloud files')
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
