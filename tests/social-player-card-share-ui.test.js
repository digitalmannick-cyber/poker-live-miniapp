const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const root = path.join(__dirname, '..')
const detailJs = fs.readFileSync(path.join(root, 'pages', 'player-note-detail', 'player-note-detail.js'), 'utf8')
const detailWxml = fs.readFileSync(path.join(root, 'pages', 'player-note-detail', 'player-note-detail.wxml'), 'utf8')

test('share entry is library-view-only and the sheet previews only the five saved card fields', () => {
  assert.match(detailWxml, /分享玩家名片/)
  assert.match(detailWxml, /mode === 'view'/)
  assert.match(detailWxml, /!editMode/)
  assert.match(detailWxml, /note\.sourceKind !== 'friend'/)
  assert.match(detailWxml, /card-preview-avatar/)
  assert.match(detailWxml, /玩家名称/)
  assert.match(detailWxml, /玩家类型/)
  assert.match(detailWxml, /Leak 标签/)
  assert.match(detailWxml, /完整 Note/)
  const sheet = detailWxml.match(/<view wx:if="\{\{cardShareVisible\}\}"[\s\S]*?<\/view>\s*$/)
  assert.ok(sheet, 'card share sheet should be a self-contained view')
  assert.doesNotMatch(sheet[0], /alias|玩家ID|对战手牌|累计时长|记录手牌|场地/)
  assert.match(detailJs, /selectedCardFriendId/)
  assert.doesNotMatch(detailJs, /selectedCardFriendIds/)
})

test('opening the sheet uses the saved note snapshot, starts unselected, and supports exclusive selection', async () => {
  const loaded = loadDetailPage({
    pages: [{
      items: [friend('su_a', '甲'), friend('su_b', '乙')],
      nextOffset: null
    }]
  })
  try {
    const instance = createInstance(loaded.definition)
    instance._friendPageAttached = true
    instance.setData({
      id: 'note_saved',
      mode: 'view',
      editMode: false,
      detailState: 'ready',
      note: savedNote(),
      form: { name: '未保存名称', type: '未保存类型', leakTags: ['未保存标签'], note: '未保存 Note' }
    })
    await instance.openPlayerCardShare()
    assert.equal(instance.data.cardShareVisible, true)
    assert.equal(instance.data.cardShareStatus, 'ready')
    assert.equal(instance.data.selectedCardFriendId, '')
    assert.deepEqual(instance.data.cardSharePreview, {
      avatarUrl: 'wxfile://saved-avatar',
      avatarText: '老',
      name: '老王',
      type: '常客',
      leakTags: ['河牌过度跟注', '3bet 太少'],
      note: '第一行\n第二行，完整保留。'
    })
    instance.selectCardFriend({ currentTarget: { dataset: { id: 'su_a' } } })
    assert.equal(instance.data.selectedCardFriendId, 'su_a')
    instance.selectCardFriend({ currentTarget: { dataset: { id: 'su_b' } } })
    assert.equal(instance.data.selectedCardFriendId, 'su_b')
    instance.selectCardFriend({ currentTarget: { dataset: { id: 'su_b' } } })
    assert.equal(instance.data.selectedCardFriendId, '')
  } finally { loaded.restore() }
})

test('friend picker appends offset pages, deduplicates rows, and retries a failed load-more request', async () => {
  let secondPageAttempts = 0
  const firstItems = Array.from({ length: 20 }, (_, index) => friend('su_' + index, '好友' + index))
  const loaded = loadDetailPage({
    listFriends(input) {
      if (input.offset === 0) return { items: firstItems, nextOffset: 20 }
      secondPageAttempts += 1
      if (secondPageAttempts === 1) throw new Error('temporary offline')
      return { items: [friend('su_19', '重复'), friend('su_20', '第21位'), friend('su_21', '第22位')], nextOffset: null }
    }
  })
  try {
    const instance = readyLibraryInstance(loaded.definition)
    await instance.openPlayerCardShare()
    await instance.loadMoreCardFriends()
    assert.equal(instance.data.cardFriendLoadMoreError, '好友加载失败，请重试')
    assert.equal(instance.data.nextCardFriendOffset, 20)
    await instance.loadMoreCardFriends()
    assert.equal(instance.data.cardFriendLoadMoreError, '')
    assert.equal(instance.data.cardFriends.length, 22)
    assert.equal(new Set(instance.data.cardFriends.map(item => item.socialUserId)).size, 22)
    assert.equal(instance.data.cardFriends.some(item => item.socialUserId === 'su_21'), true)
    assert.deepEqual(loaded.calls.listFriends, [{ offset: 0, limit: 20 }, { offset: 20, limit: 20 }, { offset: 20, limit: 20 }])
  } finally { loaded.restore() }
})

test('refresh, close, and unload invalidate stale friend-list responses', async () => {
  const first = deferred()
  const second = deferred()
  const loaded = loadDetailPage({ listFriendsCalls: [first.promise, second.promise] })
  try {
    const instance = readyLibraryInstance(loaded.definition)
    const oldLoad = instance.openPlayerCardShare()
    const refreshed = instance.refreshCardFriends()
    second.resolve({ items: [friend('su_new', '新好友')], nextOffset: null })
    await refreshed
    first.resolve({ items: [friend('su_old', '旧好友')], nextOffset: null })
    await oldLoad
    assert.deepEqual(instance.data.cardFriends.map(item => item.socialUserId), ['su_new'])

    const closePending = deferred()
    loaded.calls.listFriendsQueue.push(closePending.promise)
    const reopened = instance.openPlayerCardShare()
    const patchCount = instance._patches.length
    instance.closePlayerCardShare()
    closePending.resolve({ items: [friend('su_after_close', '关闭后')], nextOffset: null })
    await reopened
    assert.equal(instance.data.cardShareVisible, false)
    assert.equal(instance._patches.length, patchCount + 1)

    const unloadPending = deferred()
    loaded.calls.listFriendsQueue.push(unloadPending.promise)
    const afterUnload = instance.openPlayerCardShare()
    instance.onUnload()
    const unloadPatchCount = instance._patches.length
    unloadPending.resolve({ items: [friend('su_after_unload', '卸载后')], nextOffset: null })
    await afterUnload
    assert.equal(instance._patches.length, unloadPatchCount)
  } finally { loaded.restore() }
})

test('submit blocks invalid/double actions, reuses a failed mutation id, and keeps a withdrawal control after success', async () => {
  const firstSubmit = deferred()
  const secondSubmit = deferred()
  const loaded = loadDetailPage({ shareCalls: [firstSubmit.promise, secondSubmit.promise] })
  try {
    const instance = readyLibraryInstance(loaded.definition)
    await instance.openPlayerCardShare()
    await instance.confirmSharePlayerCard()
    assert.match(loaded.calls.toasts[0].title, /请选择一位好友/)
    assert.equal(loaded.calls.sharePlayerCard.length, 0)

    instance.selectCardFriend({ currentTarget: { dataset: { id: 'su_a' } } })
    const firstAttempt = instance.confirmSharePlayerCard()
    const duplicate = instance.confirmSharePlayerCard()
    instance.closePlayerCardShare()
    assert.equal(instance.data.cardShareVisible, true, 'sending must prevent closing')
    assert.equal(loaded.calls.sharePlayerCard.length, 1, 'sending must prevent double submit')
    firstSubmit.reject(Object.assign(new Error('removed'), { code: 'FRIENDSHIP_REQUIRED' }))
    await Promise.all([firstAttempt, duplicate])
    assert.equal(instance.data.cardShareStatus, 'failure')
    assert.match(instance.data.cardShareError, /已不是好友/)
    const failedMutationId = loaded.calls.sharePlayerCard[0].clientMutationId

    const retry = instance.confirmSharePlayerCard()
    assert.equal(loaded.calls.sharePlayerCard[1].clientMutationId, failedMutationId)
    secondSubmit.resolve({ shareId: 'pcs_1' })
    await retry
    assert.equal(instance._patches.some(patch => patch.cardShareStatus === 'success'), true, 'success should have a visible state before closing')
    assert.equal(instance.data.cardShareVisible, true)
    assert.equal(instance.data.cardShareStatus, 'success')
    assert.equal(instance.data.cardShareId, 'pcs_1')
    await instance.withdrawSharedPlayerCard()
    assert.equal(instance.data.cardShareStatus, 'withdrawn')
    assert.equal(loaded.calls.withdrawPlayerCardShare[0].shareId, 'pcs_1')
    assert.equal(loaded.calls.toasts.at(-1).title, '名片分享已撤回')
  } finally { loaded.restore() }
})

test('changing recipient after a failure gets a new mutation id and submit completion cannot write after unload', async () => {
  const failed = deferred()
  const pendingAfterUnload = deferred()
  const loaded = loadDetailPage({ shareCalls: [failed.promise, pendingAfterUnload.promise] })
  try {
    const instance = readyLibraryInstance(loaded.definition)
    await instance.openPlayerCardShare()
    instance.selectCardFriend({ currentTarget: { dataset: { id: 'su_a' } } })
    const first = instance.confirmSharePlayerCard()
    failed.reject(new Error('offline'))
    await first
    const firstId = loaded.calls.sharePlayerCard[0].clientMutationId
    instance.selectCardFriend({ currentTarget: { dataset: { id: 'su_b' } } })
    const second = instance.confirmSharePlayerCard()
    assert.notEqual(loaded.calls.sharePlayerCard[1].clientMutationId, firstId)
    instance.onUnload()
    const patchCount = instance._patches.length
    const toastCount = loaded.calls.toasts.length
    pendingAfterUnload.resolve({ shareId: 'pcs_after_unload' })
    await second
    assert.equal(instance._patches.length, patchCount)
    assert.equal(loaded.calls.toasts.length, toastCount)
  } finally { loaded.restore() }
})

test('a player-card withdrawal confirmation cannot write after unload', async () => {
  const loaded = loadDetailPage({ deferModals: true })
  try {
    const instance = readyLibraryInstance(loaded.definition)
    await instance.openPlayerCardShare()
    instance.setData({ cardShareStatus: 'success', cardShareId: 'pcs_1' })
    const pending = instance.withdrawSharedPlayerCard()
    instance.onUnload()
    loaded.calls.modals[0].success({ confirm: true, cancel: false })
    await pending
    assert.equal(loaded.calls.withdrawPlayerCardShare.length, 0)
  } finally { loaded.restore() }
})

function loadDetailPage(options = {}) {
  let definition = null
  let mutationIndex = 0
  const calls = {
    listFriends: [],
    listFriendsQueue: (options.listFriendsCalls || []).slice(),
    sharePlayerCard: [],
    shareQueue: (options.shareCalls || []).slice(),
    withdrawPlayerCardShare: [],
    toasts: [],
    modals: []
  }
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (parent && /pages[\\/]player-note-detail[\\/]player-note-detail\.js$/.test(parent.filename || '')) {
      if (request === '../../services/data-service') return {}
      if (request === '../../services/social-service') return {
        async listFriends(input) {
          calls.listFriends.push(input)
          if (typeof options.listFriends === 'function') return options.listFriends(input)
          if (calls.listFriendsQueue.length) return calls.listFriendsQueue.shift()
          const page = options.pages && options.pages.shift()
          return page || { items: [friend('su_a', '甲'), friend('su_b', '乙')], nextOffset: null }
        },
        async sharePlayerCard(input) {
          calls.sharePlayerCard.push(input)
          if (calls.shareQueue.length) return calls.shareQueue.shift()
          return { shareId: 'pcs_default' }
        },
        async withdrawPlayerCardShare(input) {
          calls.withdrawPlayerCardShare.push(input)
          return { shareId: input.shareId, status: 'withdrawn' }
        }
      }
      if (request === '../../utils/social-mutation') return {
        createMutationId(prefix) {
          mutationIndex += 1
          return prefix + ':mutation-' + mutationIndex
        }
      }
      if (request === '../../utils/player-avatar-cache') return { getAvatarDisplayUrl(fileId, url) { return url || fileId || '' }, warmPlayerAvatar() { return Promise.resolve('') } }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  global.Page = config => { definition = config }
  global.wx = {
    showToast(input) { calls.toasts.push(input) },
    showModal(input) {
      calls.modals.push(input)
      if (!options.deferModals) input.success({ confirm: true, cancel: false })
    },
    navigateBack() {},
    switchTab() {}
  }
  const pagePath = require.resolve('../pages/player-note-detail/player-note-detail')
  delete require.cache[pagePath]
  try { require(pagePath) } finally { Module._load = originalLoad; delete global.Page }
  return { definition, calls, restore() { delete require.cache[pagePath]; delete global.wx } }
}

function createInstance(definition) {
  const instance = {
    data: JSON.parse(JSON.stringify(definition.data)),
    _patches: [],
    setData(patch, callback) {
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
      if (typeof callback === 'function') callback()
    }
  }
  Object.assign(instance, definition)
  return instance
}

function readyLibraryInstance(definition) {
  const instance = createInstance(definition)
  instance._friendPageAttached = true
  instance.setData({ id: 'note_saved', mode: 'view', editMode: false, detailState: 'ready', note: savedNote() })
  return instance
}

function savedNote() {
  return {
    _id: 'note_saved',
    sourceKind: 'library',
    name: '老王',
    avatarDisplayUrl: 'wxfile://saved-avatar',
    avatarUrl: 'cloud://internal-must-not-preview',
    avatarText: '老',
    type: '常客',
    leakTags: ['河牌过度跟注', '3bet 太少'],
    note: '第一行\n第二行，完整保留。',
    alias: '不分享',
    battleHandIds: ['h1']
  }
}

function friend(socialUserId, nickname) {
  return { socialUserId, nickname, avatarUrl: '', avatarText: nickname.slice(0, 1), title: '' }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject })
  return { promise, resolve, reject }
}

function installFakeCardShareTimer(instance) {
  let nextId = 0
  const pending = new Map()
  const history = new Map()
  instance.setCardShareTimer = callback => {
    nextId += 1
    pending.set(nextId, callback)
    history.set(nextId, callback)
    return nextId
  }
  instance.clearCardShareTimer = timerId => pending.delete(timerId)
  return {
    pendingIds() { return Array.from(pending.keys()) },
    fire(timerId) {
      const callback = pending.get(timerId)
      pending.delete(timerId)
      if (callback) callback()
    },
    fireEvenIfCleared(timerId) {
      const callback = history.get(timerId)
      if (callback) callback()
    }
  }
}
