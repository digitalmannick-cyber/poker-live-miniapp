const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const root = path.join(__dirname, '..')

test('preview route and UI expose all lifecycle states and explicit whole-card choices', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  const wxml = fs.readFileSync(path.join(root, 'pages/social-card-preview/social-card-preview.wxml'), 'utf8')
  assert.ok(app.pages.includes('pages/social-card-preview/social-card-preview'))
  for (const state of ['loading', 'error', 'unavailable', 'ready', 'confirming', 'importing', 'imported']) {
    assert.match(wxml, new RegExp(state))
  }
  assert.match(wxml, /整体覆盖已有玩家/)
  assert.match(wxml, /仍然新建/)
  assert.match(wxml, /替换头像、名称、玩家类型、Leak 标签和 Note/)
  assert.match(wxml, /保留玩家 ID 和对战手牌/)
  assert.doesNotMatch(wxml, /checkbox|逐字段/)
})

test('page loads share and library-only duplicates, ignoring stale load after unload', async () => {
  const pending = deferred()
  const loaded = loadPage({ getShare: pending.promise, notes: [
    { _id: 'friend', sourceKind: 'friend', name: '老张' },
    { _id: 'library', sourceKind: 'library', name: '老张', battleHandIds: ['h1'] }
  ] })
  try {
    const page = createInstance(loaded.definition)
    const loading = page.onLoad({ shareId: 'pcs%5F1' })
    page.onUnload()
    const patchCount = page._patches.length
    pending.resolve(cardShare())
    await loading
    assert.equal(page._patches.length, patchCount)
  } finally { loaded.restore() }

  const ready = loadPage({ getShare: cardShare(), notes: [
    { _id: 'friend', sourceKind: 'friend', name: '老张' },
    { _id: 'library', sourceKind: 'library', name: '老张', battleHandIds: ['h1'] }
  ] })
  try {
    const page = createInstance(ready.definition)
    await page.onLoad({ shareId: 'pcs_1' })
    assert.equal(page.data.status, 'ready')
    assert.equal(page.data.duplicate._id, 'library')
    assert.deepEqual(ready.calls.getPlayerNotes, [{ sourceKind: 'library' }])
  } finally { ready.restore() }
})

test('server authorization strictly precedes avatar copy and local create; rejection writes nothing', async () => {
  const loaded = loadPage({ confirmError: Object.assign(new Error('removed'), { code: 'FRIENDSHIP_REQUIRED' }) })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'pcs_1' })
    await page.importAsNew()
    assert.deepEqual(loaded.calls.order, ['confirm'])
    assert.equal(loaded.calls.create.length, 0)
    assert.equal(loaded.calls.update.length, 0)
    assert.equal(page.data.status, 'unavailable')
  } finally { loaded.restore() }
})

test('new import blocks double click, keeps one mutation, copies avatar, and creates one independent record', async () => {
  const confirm = deferred()
  const loaded = loadPage({ confirm: confirm.promise })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'pcs_1' })
    const first = page.importAsNew()
    const second = page.importAsNew()
    assert.equal(loaded.calls.confirm.length, 1)
    confirm.resolve({ imported: true })
    await Promise.all([first, second])
    assert.deepEqual(loaded.calls.order, ['confirm', 'begin-receipt', 'copy-avatar', 'create', 'complete-receipt'])
    assert.equal(loaded.calls.create.length, 1)
    assert.equal(loaded.calls.confirm[0].clientMutationId, page.data.importMutationId)
    assert.equal(loaded.calls.create[0].avatarUrl, 'cloud://receiver/copied.png')
    assert.equal(loaded.calls.create[0].avatarFileId, 'cloud://receiver/copied.png')
    assert.deepEqual(loaded.calls.createOptions[0], { waitForCloud: true })
    assert.equal(Object.hasOwn(loaded.calls.create[0], 'importedCardShareId'), false)
    assert.equal(Object.hasOwn(loaded.calls.create[0], 'importedCardMode'), false)
    assert.deepEqual(loaded.calls.beginReceipt[0], {
      shareId: 'pcs_1', mode: 'new', targetPlayerNoteId: loaded.calls.create[0]._id,
      clientMutationId: page.data.importMutationId + ':begin-receipt'
    })
    assert.notEqual(loaded.calls.create[0].avatarUrl, cardShare().card.avatarUrl)
    assert.equal(page.data.status, 'imported')
    assert.match(page.data.importedPlayerId, /^player_note_card_/)
  } finally { loaded.restore() }
})

test('avatar failure retries local saga without confirming twice and never writes temporary URL', async () => {
  let copyAttempt = 0
  const loaded = loadPage({ copyAvatar() {
    copyAttempt += 1
    if (copyAttempt === 1) throw Object.assign(new Error('copy failed'), { code: 'CARD_AVATAR_COPY_FAILED' })
    return { avatarUrl: 'cloud://receiver/retried.png', avatarFileId: 'cloud://receiver/retried.png' }
  } })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'pcs_1' })
    const mutationId = page.data.importMutationId
    await page.importAsNew()
    assert.equal(page.data.status, 'error')
    assert.equal(loaded.calls.create.length, 0)
    await page.importAsNew()
    assert.equal(loaded.calls.confirm.length, 1)
    assert.equal(page.data.importMutationId, mutationId)
    assert.equal(loaded.calls.create.length, 1)
    assert.equal(page.data.status, 'imported')
  } finally { loaded.restore() }
})

test('a begun receipt survives a crash and resumes on another device without confirming again', async () => {
  const storage = new Map()
  const first = loadPage({ storage, copyAvatar() {
    throw Object.assign(new Error('copy failed'), { code: 'CARD_AVATAR_COPY_FAILED' })
  } })
  try {
    const page = createInstance(first.definition)
    await page.onLoad({ shareId: 'pcs_1' })
    await page.importAsNew()
    const pending = storage.get('playerCardImportPending:pcs_1')
    assert.equal(pending.serverConfirmed, true)
    assert.equal(pending.mode, 'new')
  } finally { first.restore() }

  const reopened = loadPage({
    getShare: Object.assign(cardShare(), { imported: true }),
    receipt: { shareId: 'pcs_1', mode: 'new', targetPlayerNoteId: 'player_note_card_pcs_1', status: 'pending' }
  })
  try {
    const page = createInstance(reopened.definition)
    await page.onLoad({ shareId: 'pcs_1' })
    assert.equal(page.data.status, 'error')
    assert.equal(page.data.serverConfirmed, true)
    await page.importAsNew()
    assert.equal(reopened.calls.confirm.length, 0)
    assert.equal(reopened.calls.create.length, 1)
    assert.equal(reopened.calls.create[0]._id, 'player_note_card_pcs_1')
    assert.equal(reopened.calls.beginReceipt.length, 0)
    assert.equal(reopened.calls.completeReceipt.length, 1)
    assert.equal(page.data.status, 'imported')
  } finally { reopened.restore() }
})

test('overwrite uses one whitelist update and preserves target identity and hands', async () => {
  const target = {
    _id: 'existing', playerId: 'ME', sourceKind: 'library', name: '老张',
    battleHandIds: ['h1'], createdAt: 1, lastSeenAt: 2, lastVenue: 'club', lastStake: '2/5'
  }
  const loaded = loadPage({ notes: [target] })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'pcs_1' })
    await page.overwriteExisting()
    assert.deepEqual(loaded.calls.order, ['confirm', 'begin-receipt', 'copy-avatar', 'update', 'complete-receipt'])
    assert.equal(loaded.calls.update[0].id, 'existing')
    assert.deepEqual(Object.keys(loaded.calls.update[0].patch).sort(), ['avatarFileId', 'avatarUrl', 'leakTags', 'name', 'note', 'type'])
    assert.deepEqual(loaded.calls.beginReceipt[0], {
      shareId: 'pcs_1', mode: 'overwrite', targetPlayerNoteId: 'existing',
      clientMutationId: page.data.importMutationId + ':begin-receipt'
    })
    assert.deepEqual(loaded.calls.updateOptions[0], { waitForCloud: true })
    for (const forbidden of ['_id', 'playerId', 'sourceKind', 'battleHandIds', 'createdAt', 'lastSeenAt', 'lastVenue', 'lastStake']) {
      assert.equal(Object.hasOwn(loaded.calls.update[0].patch, forbidden), false)
    }
  } finally { loaded.restore() }
})

test('local create failure retries with the same deterministic player id and no second confirm', async () => {
  let createAttempt = 0
  const storage = new Map()
  const loaded = loadPage({ storage, createError() {
    createAttempt += 1
    return createAttempt === 1 ? new Error('local write failed') : null
  } })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'pcs_1' })
    await page.importAsNew()
    assert.equal(page.data.status, 'error')
    assert.equal(storage.has('playerCardImportCompleted:pcs_1'), false)
    const stableId = loaded.calls.create[0]._id
    await page.importAsNew()
    assert.equal(loaded.calls.confirm.length, 1)
    assert.equal(loaded.calls.create[1]._id, stableId)
    assert.equal(page.data.status, 'imported')
    assert.equal(storage.has('playerCardImportCompleted:pcs_1'), false)
    assert.equal(loaded.calls.completeReceipt.length, 1)
  } finally { loaded.restore() }
})

test('local overwrite failure retries the same target without a second confirm', async () => {
  let updateAttempt = 0
  const loaded = loadPage({
    notes: [{ _id: 'existing', sourceKind: 'library', name: '老张', battleHandIds: ['h1'] }],
    updateError() {
      updateAttempt += 1
      return updateAttempt === 1 ? new Error('local update failed') : null
    }
  })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'pcs_1' })
    await page.overwriteExisting()
    assert.equal(page.data.status, 'error')
    await page.overwriteExisting()
    assert.equal(loaded.calls.confirm.length, 1)
    assert.deepEqual(loaded.calls.update.map(call => call.id), ['existing', 'existing'])
    assert.equal(page.data.status, 'imported')
  } finally { loaded.restore() }
})

test('unload after server confirmation prevents avatar and local player writes', async () => {
  const confirm = deferred()
  const storage = new Map()
  const loaded = loadPage({ confirm: confirm.promise, storage })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'pcs_1' })
    const importing = page.importAsNew()
    page.onUnload()
    const patchCount = page._patches.length
    confirm.resolve({ imported: true })
    await importing
    assert.deepEqual(loaded.calls.order, ['confirm'])
    assert.equal(loaded.calls.create.length, 0)
    assert.equal(page._patches.length, patchCount)
    assert.equal(storage.get('playerCardImportPending:pcs_1').serverConfirmed, true)
  } finally { loaded.restore() }
})

test('unload while avatar copy is pending prevents stale state and local writes', async () => {
  const copy = deferred()
  const loaded = loadPage({ copyAvatar: () => copy.promise })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'pcs_1' })
    const importing = page.importAsNew()
    await Promise.resolve()
    page.onUnload()
    const patchCount = page._patches.length
    copy.resolve({ avatarUrl: 'cloud://receiver/copied.png', avatarFileId: 'cloud://receiver/copied.png' })
    await importing
    assert.equal(loaded.calls.create.length, 0)
    assert.equal(page._patches.length, patchCount)
  } finally { loaded.restore() }
})

test('an overwrite modal callback is stale after unload and creates no pending saga', async () => {
  const storage = new Map()
  const loaded = loadPage({
    storage,
    manualModal: true,
    notes: [{ _id: 'existing', sourceKind: 'library', name: '老张' }]
  })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'pcs_1' })
    page.requestOverwrite()
    page.onUnload()
    await page.onLoad({ shareId: 'pcs_1' })
    const patchCount = page._patches.length
    loaded.calls.modals[0].success({ confirm: true })
    await Promise.resolve()
    assert.equal(loaded.calls.confirm.length, 0)
    assert.equal(storage.has('playerCardImportPending:pcs_1'), false)
    assert.equal(page._patches.length, patchCount)
  } finally { loaded.restore() }
})

test('pending overwrite receipt is pinned to its target id and never switches to the first same-name note', async () => {
  const notes = [
    { _id: 'target-a', sourceKind: 'library', name: '老张' },
    { _id: 'target-b', sourceKind: 'library', name: '老张', battleHandIds: ['h1'] }
  ]
  const loaded = loadPage({
    getShare: Object.assign(cardShare(), { imported: true }), notes,
    receipt: { shareId: 'pcs_1', mode: 'overwrite', targetPlayerNoteId: 'target-b', status: 'pending' }
  })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'pcs_1' })
    assert.equal(page.data.duplicate._id, 'target-b')
    await page.overwriteExisting()
    assert.deepEqual(loaded.calls.update.map(item => item.id), ['target-b'])
  } finally { loaded.restore() }
})

test('a missing pending receipt target fails closed instead of silently switching', async () => {
  const loaded = loadPage({
    getShare: Object.assign(cardShare(), { imported: true }),
    receipt: { shareId: 'pcs_1', mode: 'overwrite', targetPlayerNoteId: 'missing-target', status: 'pending' },
    notes: [{ _id: 'other-same-name', sourceKind: 'library', name: '老张' }]
  })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'pcs_1' })
    assert.equal(page.data.status, 'error')
    assert.equal(page.data.overwriteTargetMissing, true)
    assert.equal(page.data.duplicate, null)
    assert.match(page.data.errorMessage, /无法继续覆盖/)
    await page.importAsNew()
    await page.overwriteExisting()
    assert.equal(loaded.calls.update.length, 0)
    assert.equal(loaded.calls.create.length, 0)
    assert.equal(loaded.calls.confirm.length, 0)
  } finally { loaded.restore() }
})

test('completed receipt and unavailable shares never write the player library', async () => {
  const imported = loadPage({
    getShare: Object.assign(cardShare(), { imported: true }),
    receipt: { shareId: 'pcs_1', mode: 'new', targetPlayerNoteId: 'saved-player', status: 'completed' }
  })
  try {
    const page = createInstance(imported.definition)
    await page.onLoad({ shareId: 'pcs_1' })
    assert.equal(page.data.status, 'imported')
    await page.importAsNew()
    assert.equal(imported.calls.confirm.length, 0)
    assert.equal(imported.calls.create.length, 0)
  } finally { imported.restore() }

  const unavailable = loadPage({ getShareError: Object.assign(new Error('expired'), { code: 'PLAYER_CARD_UNAVAILABLE' }) })
  try {
    const page = createInstance(unavailable.definition)
    await page.onLoad({ shareId: 'pcs_1' })
    assert.equal(page.data.status, 'unavailable')
    assert.match(page.data.errorMessage, /不可访问|失效/)
  } finally { unavailable.restore() }
})

test('an imported share without a private receipt can choose and finish on another device', async () => {
  const loaded = loadPage({ getShare: Object.assign(cardShare(), { imported: true }), receipt: null })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'pcs_1' })
    assert.equal(page.data.status, 'ready')
    assert.equal(page.data.serverConfirmed, true)
    await page.importAsNew()
    assert.equal(loaded.calls.confirm.length, 0)
    assert.equal(loaded.calls.create.length, 1)
    assert.match(loaded.calls.create[0]._id, /pcs_1/)
    assert.equal(page.data.status, 'imported')
  } finally { loaded.restore() }
})

test('completed private receipt prevents a second import on a device without local storage', async () => {
  const loaded = loadPage({
    getShare: Object.assign(cardShare(), { imported: true }),
    receipt: { shareId: 'pcs_1', mode: 'overwrite', targetPlayerNoteId: 'existing-overwrite', status: 'completed' }
  })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'pcs_1' })
    assert.equal(page.data.status, 'imported')
    assert.equal(page.data.importedPlayerId, 'existing-overwrite')
    await page.importAsNew()
    assert.equal(loaded.calls.create.length, 0)
  } finally { loaded.restore() }
})

test('two completed shares for the same overwritten player each reopen without creating', async () => {
  for (const shareId of ['pcs_s1', 'pcs_s2']) {
    const loaded = loadPage({
      getShare: Object.assign(cardShare(), { shareId, imported: true }),
      receipt: { shareId, mode: 'overwrite', targetPlayerNoteId: 'same-player', status: 'completed' }
    })
    try {
      const page = createInstance(loaded.definition)
      await page.onLoad({ shareId })
      assert.equal(page.data.status, 'imported')
      assert.equal(page.data.importedPlayerId, 'same-player')
      await page.importAsNew()
      assert.equal(loaded.calls.create.length, 0)
      assert.equal(loaded.calls.update.length, 0)
    } finally { loaded.restore() }
  }
})

test('failed private receipt point read fails closed and cannot create a second player', async () => {
  const loaded = loadPage({
    getShare: Object.assign(cardShare(), { imported: true }),
    receiptError: new Error('cloud unavailable')
  })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'pcs_1' })
    assert.equal(page.data.status, 'error')
    assert.equal(page.data.receiptCheckFailed, true)
    await page.importAsNew()
    assert.equal(loaded.calls.create.length, 0)
  } finally { loaded.restore() }
})

function cardShare() {
  return {
    shareId: 'pcs_1', sender: { nickname: '好友甲', avatarUrl: 'https://temp.example/sender.png', avatarText: '甲' },
    card: { avatarUrl: 'https://temp.example/card.png', name: '老张', type: '激进', leakTags: ['x', 'y'], note: '完整 Note' },
    expiresAt: Date.now() + 10000, imported: false
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function loadPage(options = {}) {
  let definition
  let mutationIndex = 0
  const calls = { order: [], confirm: [], beginReceipt: [], completeReceipt: [], getReceipt: [], create: [], createOptions: [], update: [], updateOptions: [], getPlayerNotes: [], navigateTo: [], modals: [] }
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (parent && /pages[\\/]social-card-preview[\\/]social-card-preview\.js$/.test(parent.filename || '')) {
      if (request === '../../services/social-service') return {
        async getPlayerCardShare() {
          if (options.getShareError) throw options.getShareError
          return options.getShare === undefined ? cardShare() : await options.getShare
        },
        async confirmPlayerCardImport(input) {
          calls.order.push('confirm')
          calls.confirm.push(input)
          if (options.confirmError) throw options.confirmError
          return options.confirm === undefined ? { imported: true } : await options.confirm
        }
      }
      if (request === '../../services/data-service') return {
        async getPlayerNotes(input) { calls.getPlayerNotes.push(input); return options.notes || [] },
        async getPlayerCardImportReceipt(shareId) {
          calls.getReceipt.push(shareId)
          if (options.receiptError) throw options.receiptError
          return options.receipt === undefined ? null : options.receipt
        },
        async beginPlayerCardImportReceipt(input) {
          calls.order.push('begin-receipt'); calls.beginReceipt.push(input)
          if (options.beginReceiptError) throw options.beginReceiptError
          return Object.assign({}, input, { status: 'pending' })
        },
        async completePlayerCardImportReceipt(input) {
          calls.order.push('complete-receipt'); calls.completeReceipt.push(input)
          if (options.completeReceiptError) throw options.completeReceiptError
          return Object.assign({}, options.receipt || calls.beginReceipt[0], { status: 'completed' })
        },
        async createPlayerNote(payload, createOptions) {
          calls.order.push('create'); calls.create.push(payload); calls.createOptions.push(createOptions)
          const createError = typeof options.createError === 'function' ? options.createError(payload) : options.createError
          if (createError) throw createError
          return Object.assign({}, payload, { _id: payload._id || 'new-player' })
        },
        async updatePlayerNote(id, patch, updateOptions) {
          calls.order.push('update'); calls.update.push({ id, patch }); calls.updateOptions.push(updateOptions)
          const updateError = typeof options.updateError === 'function' ? options.updateError(id, patch) : options.updateError
          if (updateError) throw updateError
          return Object.assign({ _id: id }, patch)
        }
      }
      if (request === '../../utils/player-card-import') {
        const actual = originalLoad.call(this, request, parent, isMain)
        return Object.assign({}, actual, {
          async copyCardAvatar(url, mutationId) {
            calls.order.push('copy-avatar')
            if (options.copyAvatar) return options.copyAvatar(url, mutationId)
            return { avatarUrl: 'cloud://receiver/copied.png', avatarFileId: 'cloud://receiver/copied.png' }
          }
        })
      }
      if (request === '../../utils/social-mutation') return {
        createMutationId(prefix) { mutationIndex += 1; return prefix + ':mutation-' + mutationIndex }
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  global.Page = value => { definition = value }
  global.wx = {
    getStorageSync(key) { return options.storage && options.storage.get(key) },
    setStorageSync(key, value) { if (options.storage) options.storage.set(key, value) },
    removeStorageSync(key) { if (options.storage) options.storage.delete(key) },
    showModal(input) { calls.modals.push(input); if (!options.manualModal) input.success({ confirm: true }) },
    navigateTo(input) { calls.navigateTo.push(input) },
    navigateBack() {}
  }
  const file = require.resolve('../pages/social-card-preview/social-card-preview')
  delete require.cache[file]
  try { require(file) } finally { Module._load = originalLoad; delete global.Page }
  return { definition, calls, restore() { delete require.cache[file]; delete global.wx } }
}

function createInstance(definition) {
  const instance = {
    data: JSON.parse(JSON.stringify(definition.data)),
    _patches: [],
    setData(patch) {
      this._patches.push(patch)
      Object.assign(this.data, patch)
    }
  }
  Object.assign(instance, definition)
  return instance
}
