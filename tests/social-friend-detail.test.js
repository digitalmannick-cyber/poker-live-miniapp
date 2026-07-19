const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const root = path.join(__dirname, '..')
const detailJs = fs.readFileSync(path.join(root, 'pages', 'player-note-detail', 'player-note-detail.js'), 'utf8')
const detailWxml = fs.readFileSync(path.join(root, 'pages', 'player-note-detail', 'player-note-detail.wxml'), 'utf8')

test('friend detail keeps local player-note editing separate from remote social data', () => {
  assert.match(detailJs, /options\.friendUserId/)
  assert.match(detailJs, /getFriendPlayerNote/)
  assert.match(detailJs, /ensureFriendPlayerNote/)
  assert.match(detailJs, /socialService\.getFriendDetail/)
  assert.match(detailJs, /updatePlayerNote/)
  assert.doesNotMatch(detailJs, /updateFriend.*leakTags|updateFriend.*note/)
  assert.match(detailWxml, /累计时长/)
  assert.match(detailWxml, /记录手牌/)
  assert.match(detailWxml, /称号/)
  assert.match(detailWxml, /解除好友/)
})

test('friend detail DTO is accepted-only and contains only public friend fields plus friendship id', async () => {
  const { createFriendshipHandlers, getPairId } = require('../cloudfunctions/poker_social/lib/friendship')
  const { createMemorySocialRepository } = require('./helpers/social-fixture')
  const friendshipId = getPairId('su_a', 'su_b')
  const repository = createMemorySocialRepository({
    social_users: [
      { _id: 'su_a', ownerOpenId: 'openid-a', privatePlayerId: 'WX-A', profile: { nickname: 'A' } },
      { _id: 'su_b', ownerOpenId: 'openid-b', privatePlayerId: 'WX-B', profile: { nickname: 'B' }, title: '银狼', statsVisible: true, publicStats: { durationMinutes: 135, recordedHandCount: 8 }, currentProfit: 9999 }
    ],
    social_friendships: [{ _id: friendshipId, userA: 'su_a', userB: 'su_b', status: 'accepted', acceptedAt: 1710000000000, profileSnapshots: {} }]
  })
  const handlers = createFriendshipHandlers(repository)
  const detail = await handlers.get_friend_detail({ friendUserId: 'su_b' }, { ownerOpenId: 'openid-a' })
  assert.deepEqual(detail, {
    friendshipId,
    socialUserId: 'su_b',
    nickname: 'B',
    avatarUrl: '',
    avatarText: 'B',
    title: '银狼',
    statsVisible: true,
    durationMinutes: 135,
    recordedHandCount: 8,
    acceptedAt: 1710000000000
  })
  assert.equal(/ownerOpenId|privatePlayerId|avatarFileId|profit|currentProfit|buyIn|cashOut/.test(JSON.stringify(detail)), false)
})

test('friend mode loads remote data, ensures the local note, and only local edits call updatePlayerNote', async () => {
  const { definition, restore, calls } = loadDetailPage({
    localNote: null,
    remote: { friendshipId: 'fr_1', socialUserId: 'su_b', nickname: 'Remote Wolf', avatarUrl: 'https://avatar', avatarText: '狼', title: '银狼', statsVisible: false, acceptedAt: 1710000000000 },
    ensuredNote: { _id: 'note_b', sourceKind: 'friend', linkedFriendUserId: 'su_b', name: '本地备注', avatarText: '备', type: '常客', leakTags: [], note: '', battleHandIds: [] }
  })
  try {
    const instance = createInstance(definition)
    await instance.onLoad({ friendUserId: 'su_b' })
    assert.equal(instance.data.mode, 'friend')
    assert.equal(instance.data.id, 'note_b')
    assert.equal(instance.data.note.name, '本地备注')
    assert.equal(instance.data.friend.title, '银狼')
    assert.equal(instance.data.friend.statsVisible, false)
    instance.setData({ editMode: true, 'form.name': '新备注' })
    await instance.saveNote()
    assert.equal(calls.updatePlayerNote.length, 1)
    assert.equal(calls.updatePlayerNote[0].id, 'note_b')
    assert.equal(calls.updatePlayerNote[0].patch.name, '新备注')
    assert.equal(instance.data.mode, 'friend')
  } finally {
    restore()
  }
})

test('friend loading ignores stale success and failure responses and ignores completion after unload', async () => {
  const olderSuccess = deferred()
  const newerForbidden = deferred()
  const firstReplies = [olderSuccess.promise, newerForbidden.promise]
  const first = loadDetailPage({
    localNote: { _id: 'note_b', sourceKind: 'friend', linkedFriendUserId: 'su_b', name: '本地备注', type: '常客', leakTags: [], note: '', battleHandIds: [] },
    getFriendDetail() { return firstReplies.shift() }
  })
  try {
    const instance = createInstance(first.definition)
    instance.setData({ mode: 'friend', friendUserId: 'su_b' })
    const oldRequest = instance.loadFriendMode('su_b')
    const newRequest = instance.loadFriendMode('su_b')
    newerForbidden.reject(Object.assign(new Error('removed'), { code: 'FORBIDDEN' }))
    await newRequest
    olderSuccess.resolve(friendDto())
    await oldRequest
    assert.equal(instance.data.detailState, 'unavailable')
    assert.equal(instance.data.friend, null)
  } finally { first.restore() }

  const olderFailure = deferred()
  const newerSuccess = deferred()
  const secondReplies = [olderFailure.promise, newerSuccess.promise]
  const second = loadDetailPage({
    localNote: { _id: 'note_b', sourceKind: 'friend', linkedFriendUserId: 'su_b', name: '本地备注', type: '常客', leakTags: [], note: '', battleHandIds: [] },
    getFriendDetail() { return secondReplies.shift() }
  })
  try {
    const instance = createInstance(second.definition)
    instance.setData({ mode: 'friend', friendUserId: 'su_b' })
    const oldRequest = instance.loadFriendMode('su_b')
    const newRequest = instance.loadFriendMode('su_b')
    newerSuccess.resolve(friendDto())
    await newRequest
    olderFailure.reject(new Error('offline'))
    await oldRequest
    assert.equal(instance.data.detailState, 'ready')
    assert.equal(instance.data.friend.socialUserId, 'su_b')
  } finally { second.restore() }

  const pending = deferred()
  const unloaded = loadDetailPage({
    localNote: { _id: 'note_b', sourceKind: 'friend', linkedFriendUserId: 'su_b', name: '本地备注', type: '常客', leakTags: [], note: '', battleHandIds: [] },
    getFriendDetail() { return pending.promise }
  })
  try {
    const instance = createInstance(unloaded.definition)
    instance.setData({ mode: 'friend', friendUserId: 'su_b' })
    const request = instance.loadFriendMode('su_b')
    instance.onUnload()
    pending.resolve(friendDto())
    await request
    assert.equal(instance.data.note, null)
    assert.equal(instance.data.friend, null)
  } finally { unloaded.restore() }
})

test('non-ready friend states cannot enter edit or save and a cloud removal failure remains visible without detaching', async () => {
  const loaded = loadDetailPage({
    localNote: { _id: 'note_b', sourceKind: 'friend', linkedFriendUserId: 'su_b', name: '本地备注', type: '常客', leakTags: [], note: '', battleHandIds: [] },
    remote: friendDto(),
    removeError: new Error('cloud unavailable')
  })
  try {
    const instance = createInstance(loaded.definition)
    instance.setData({ mode: 'friend', friendUserId: 'su_b', detailState: 'loading', note: null, id: '' })
    instance.startEdit()
    await instance.saveNote()
    assert.equal(loaded.calls.updatePlayerNote.length, 0)
    assert.equal(instance.data.editMode, false)
    instance.setData({ detailState: 'unavailable' })
    instance.startEdit()
    await instance.saveNote()
    assert.equal(loaded.calls.updatePlayerNote.length, 0)

    await instance.onLoad({ friendUserId: 'su_b' })
    await instance.removeFriend()
    assert.equal(loaded.calls.detachFriendPlayerNote.length, 0)
    assert.match(instance.data.removeError, /解除好友失败/)
    assert.equal(loaded.calls.toasts.length, 1)
  } finally { loaded.restore() }
})

test('cloud removal invalidates an in-flight friend load before it can restore the detail state', async () => {
  const pendingLoad = deferred()
  const loaded = loadDetailPage({
    localNote: { _id: 'note_b', sourceKind: 'friend', linkedFriendUserId: 'su_b', name: '本地备注', type: '常客', leakTags: [], note: '', battleHandIds: [] },
    getFriendDetail() { return pendingLoad.promise }
  })
  try {
    const instance = createInstance(loaded.definition)
    instance.setData({
      mode: 'friend',
      friendUserId: 'su_b',
      id: 'note_b',
      detailState: 'ready',
      note: loaded.options.localNote,
      friend: friendDto()
    })
    const staleRequest = instance.loadFriendMode('su_b')
    await instance.removeFriend()
    const patchCountAfterRemoval = instance._patches.length
    pendingLoad.resolve(friendDto())
    await staleRequest
    assert.equal(instance._patches.length, patchCountAfterRemoval)
    assert.deepEqual(loaded.calls.detachFriendPlayerNote, ['su_b'])
    assert.deepEqual(loaded.calls.switchTab, [{ url: '/pages/player-notes/player-notes' }])
  } finally { loaded.restore() }
})

test('remove friend calls cloud before detaching the local note and keeps a retry when local detach fails', async () => {
  const { definition, restore, calls } = loadDetailPage({
    localNote: { _id: 'note_b', sourceKind: 'friend', linkedFriendUserId: 'su_b', name: '本地备注', type: '常客', leakTags: [], note: '', battleHandIds: [] },
    remote: { friendshipId: 'fr_1', socialUserId: 'su_b', nickname: 'Remote Wolf', avatarText: '狼', title: '银狼', statsVisible: true, durationMinutes: 30, recordedHandCount: 2 },
    detachError: new Error('local offline')
  })
  try {
    const instance = createInstance(definition)
    await instance.onLoad({ friendUserId: 'su_b' })
    await instance.removeFriend()
    assert.deepEqual(calls.removeFriend, [{ friendshipId: 'fr_1', clientMutationId: 'remove_friend:test-mutation' }])
    assert.deepEqual(calls.detachFriendPlayerNote, ['su_b'])
    assert.equal(instance.data.detachPending, true)
    assert.equal(calls.switchTab.length, 0)
    calls.detachError = null
    await instance.retryDetachFriendNote()
    assert.deepEqual(calls.detachFriendPlayerNote, ['su_b', 'su_b'])
    assert.deepEqual(calls.switchTab, [{ url: '/pages/player-notes/player-notes' }])
  } finally {
    restore()
  }
})

test('friend detail refreshes remote access on return and renders relationship loss as an unavailable state', async () => {
  const loaded = loadDetailPage({
    localNote: { _id: 'note_b', sourceKind: 'friend', linkedFriendUserId: 'su_b', name: '本地备注', type: '常客', leakTags: [], note: '', battleHandIds: [] },
    remote: { friendshipId: 'fr_1', socialUserId: 'su_b', nickname: 'Remote Wolf', avatarText: '狼', title: '银狼', statsVisible: true, durationMinutes: 30, recordedHandCount: 2, privatePlayerId: 'must-not-reach-page' }
  })
  try {
    const instance = createInstance(loaded.definition)
    await instance.onLoad({ friendUserId: 'su_b' })
    await instance.onShow()
    await instance.onShow()
    assert.equal(loaded.calls.getFriendDetail, 2)
    assert.equal(JSON.stringify(instance.data.friend).includes('privatePlayerId'), false)
  } finally {
    loaded.restore()
  }

  const rejected = loadDetailPage({ remoteError: Object.assign(new Error('removed'), { code: 'FORBIDDEN' }) })
  try {
    const instance = createInstance(rejected.definition)
    await instance.onLoad({ friendUserId: 'su_b' })
    assert.equal(instance.data.detailState, 'unavailable')
    assert.equal(instance.data.note, null)
  } finally {
    rejected.restore()
  }
})

function loadDetailPage(options) {
  let definition = null
  const calls = { updatePlayerNote: [], removeFriend: [], detachFriendPlayerNote: [], switchTab: [], detachError: options.detachError, getFriendDetail: 0, toasts: [] }
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (parent && /pages[\\/]player-note-detail[\\/]player-note-detail\.js$/.test(parent.filename || '')) {
      if (request === '../../services/data-service') return {
        async getAppSettings() { return { opponentTypes: ['常客'], playerLeakTags: [], chipUnit: 'BB' } },
        async getPlayerNoteById() { return null },
        async getFriendPlayerNote() { return typeof options.getFriendPlayerNote === 'function' ? options.getFriendPlayerNote() : options.localNote },
        async ensureFriendPlayerNote() { return options.ensuredNote },
        async getPlayerNoteBattleHands() { return [] },
        async updatePlayerNote(id, patch) { calls.updatePlayerNote.push({ id, patch }); return Object.assign({}, options.localNote || options.ensuredNote, patch) },
        async detachFriendPlayerNote(friendUserId) { calls.detachFriendPlayerNote.push(friendUserId); if (calls.detachError) throw calls.detachError; return { _id: 'note_b', sourceKind: 'library' } },
        async updateSettings() { return {} }
      }
      if (request === '../../services/social-service') return {
        async getFriendDetail() { calls.getFriendDetail += 1; if (options.remoteError) throw options.remoteError; if (typeof options.getFriendDetail === 'function') return options.getFriendDetail(); return options.remote },
        async removeFriend(input) { calls.removeFriend.push(input); if (options.removeError) throw options.removeError; return { friendshipId: input.friendshipId, status: 'removed' } }
      }
      if (request === '../../utils/social-mutation') return { createMutationId() { return 'remove_friend:test-mutation' } }
      if (request === '../../utils/player-avatar-cache') return { getAvatarDisplayUrl(fileId, url) { return url || fileId || '' }, warmPlayerAvatar() { return Promise.resolve('') } }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  global.Page = config => { definition = config }
  global.wx = { showToast(input) { calls.toasts.push(input) }, switchTab(input) { calls.switchTab.push(input) }, navigateBack() {}, showModal(input) { input.success({ confirm: true }) } }
  const pagePath = require.resolve('../pages/player-note-detail/player-note-detail')
  delete require.cache[pagePath]
  try { require(pagePath) } finally { Module._load = originalLoad; delete global.Page }
  return { definition, calls, options, restore() { delete require.cache[pagePath]; delete global.wx } }
}

function friendDto() {
  return { friendshipId: 'fr_1', socialUserId: 'su_b', nickname: 'Remote Wolf', avatarText: '狼', title: '银狼', statsVisible: true, durationMinutes: 30, recordedHandCount: 2 }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject })
  return { promise, resolve, reject }
}

function createInstance(definition) {
  const instance = {
    data: Object.assign({}, definition.data),
    _patches: [],
    setData(patch) {
      this._patches.push(patch)
      Object.keys(patch).forEach(key => {
        const segments = key.split('.')
        let target = this.data
        while (segments.length > 1) {
          const segment = segments.shift()
          target[segment] = target[segment] || {}
          target = target[segment]
        }
        target[segments[0]] = patch[key]
      })
    }
  }
  Object.assign(instance, definition)
  return instance
}
