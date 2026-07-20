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
    assert.equal(loaded.calls.createOptions[0].waitForCloud, true)
    assert.equal(loaded.calls.createOptions[0].accountContext.accountId, 'PLAYER-A')
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
    const pending = storage.get('playerCardImportPending:v2:PLAYER-A:pcs_1')
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
    assert.equal(loaded.calls.updateOptions[0].waitForCloud, true)
    assert.equal(loaded.calls.updateOptions[0].accountContext.accountId, 'PLAYER-A')
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
    assert.equal(storage.get('playerCardImportPending:v2:PLAYER-A:pcs_1').serverConfirmed, false)
  } finally { loaded.restore() }
})

test('unload while avatar copy is pending prevents stale state and local writes', async () => {
  const copy = deferred()
  const copyStarted = deferred()
  const loaded = loadPage({ copyAvatar: () => { copyStarted.resolve(); return copy.promise } })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'pcs_1' })
    const importing = page.importAsNew()
    await copyStarted.promise
    page.onUnload()
    const patchCount = page._patches.length
    copy.resolve({ avatarUrl: 'cloud://receiver/copied.png', avatarFileId: 'cloud://receiver/copied.png' })
    await importing
    assert.equal(loaded.calls.create.length, 0)
    assert.equal(loaded.calls.cleanupAvatar[0].avatarFileId, 'cloud://receiver/copied.png')
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
    assert.equal(storage.has('playerCardImportPending:v2:PLAYER-A:pcs_1'), false)
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

test('account switch after confirmation, receipt, or avatar invalidates the import before the next write', async () => {
  for (const stage of ['confirm', 'receipt', 'avatar']) {
    const account = { id: 'PLAYER-A', epoch: 1 }
    const switchAccount = () => { account.id = 'PLAYER-B'; account.epoch += 1 }
    const loaded = loadPage({
      account,
      confirm: stage === 'confirm' ? () => { switchAccount(); return { imported: true } } : undefined,
      beginReceipt: stage === 'receipt' ? input => { switchAccount(); return Object.assign({}, input, { status: 'pending' }) } : undefined,
      copyAvatar: stage === 'avatar' ? () => { switchAccount(); return { avatarUrl: 'cloud://receiver/copied.png', avatarFileId: 'cloud://receiver/copied.png' } } : undefined
    })
    try {
      const page = createInstance(loaded.definition)
      await page.onLoad({ shareId: 'pcs_1' })
      await page.importAsNew()
      if (stage === 'confirm') assert.deepEqual(loaded.calls.order, ['confirm'])
      if (stage === 'receipt') assert.deepEqual(loaded.calls.order, ['confirm', 'begin-receipt'])
      if (stage === 'avatar') assert.deepEqual(loaded.calls.order, ['confirm', 'begin-receipt', 'copy-avatar'])
      if (stage === 'avatar') assert.equal(loaded.calls.cleanupAvatar[0].avatarFileId, 'cloud://receiver/copied.png')
      assert.equal(loaded.calls.create.length, 0, stage + ' switch must not write a player note')
      assert.notEqual(page.data.status, 'imported')
    } finally { loaded.restore() }
  }
})

test('account ABA during confirmation invalidates the operation even when the final account id matches', async () => {
  const account = { id: 'PLAYER-A', epoch: 1 }
  const loaded = loadPage({
    account,
    confirm() {
      account.id = 'PLAYER-B'; account.epoch += 1
      account.id = 'PLAYER-A'; account.epoch += 1
      return { imported: true }
    }
  })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'pcs_1' })
    await page.importAsNew()
    assert.deepEqual(loaded.calls.order, ['confirm'])
    assert.equal(loaded.calls.beginReceipt.length, 0)
    assert.equal(loaded.calls.create.length, 0)
    assert.equal(page.data.serverConfirmed, false)
  } finally { loaded.restore() }
})

test('account switch while the player-note write resolves prevents receipt completion and stale UI backfill', async () => {
  const account = { id: 'PLAYER-A', epoch: 1 }
  const loaded = loadPage({
    account,
    createPlayerNote(payload) {
      account.id = 'PLAYER-B'; account.epoch += 1
      return Object.assign({}, payload)
    }
  })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'pcs_1' })
    await page.importAsNew()
    assert.deepEqual(loaded.calls.order, ['confirm', 'begin-receipt', 'copy-avatar', 'create'])
    assert.equal(loaded.calls.completeReceipt.length, 0)
    assert.notEqual(page.data.status, 'imported')
  } finally { loaded.restore() }
})

test('load receipt, share, and notes awaits clear stale loading state after an account switch', async () => {
  for (const stage of ['receipt', 'share', 'notes']) {
    const account = { id: 'PLAYER-A', epoch: 1 }
    const switchAccount = () => { account.id = 'PLAYER-B'; account.epoch += 1 }
    const loaded = loadPage({
      account,
      getReceipt: stage === 'receipt' ? () => { switchAccount(); return null } : undefined,
      getShare: stage === 'share' ? () => { switchAccount(); return cardShare() } : undefined,
      getPlayerNotes: stage === 'notes' ? () => { switchAccount(); return [] } : undefined
    })
    try {
      const page = createInstance(loaded.definition)
      await page.onLoad({ shareId: 'pcs_1' })
      assert.notEqual(page.data.status, 'loading', stage)
      assert.equal(page.data.importing, false, stage)
      assert.equal(page.data.share, null, stage)
      assert.equal(page.data.duplicate, null, stage)
    } finally { loaded.restore() }
  }
})

test('overwrite notes reread and update await cannot write or retain stale account UI', async () => {
  for (const stage of ['reread', 'update']) {
    const account = { id: 'PLAYER-A', epoch: 1 }
    let noteReads = 0
    const target = { _id: 'existing', sourceKind: 'library', name: '老张' }
    const loaded = loadPage({
      account,
      getPlayerNotes() {
        noteReads += 1
        if (stage === 'reread' && noteReads === 2) { account.id = 'PLAYER-B'; account.epoch += 1 }
        return [target]
      },
      updatePlayerNote(id, patch) {
        if (stage === 'update') { account.id = 'PLAYER-B'; account.epoch += 1 }
        return Object.assign({ _id: id }, patch)
      }
    })
    try {
      const page = createInstance(loaded.definition)
      await page.onLoad({ shareId: 'pcs_1' })
      await page.overwriteExisting()
      if (stage === 'reread') assert.equal(loaded.calls.update.length, 0)
      assert.equal(loaded.calls.completeReceipt.length, 0)
      assert.equal(page.data.importing, false)
      assert.equal(page.data.share, null, stage)
      assert.equal(page.data.duplicate, null, stage)
    } finally { loaded.restore() }
  }
})

test('retry notes stale never deletes an avatar already referenced by a successful local overwrite', async () => {
  const account = { id: 'PLAYER-A', epoch: 1 }
  const target = { _id: 'existing', sourceKind: 'library', name: '老张', avatarUrl: '', avatarFileId: '' }
  let noteReads = 0
  let updates = 0
  const loaded = loadPage({
    account,
    getPlayerNotes() {
      noteReads += 1
      if (noteReads === 3) { account.id = 'PLAYER-B'; account.epoch += 1 }
      return [target]
    },
    updatePlayerNote(id, patch) {
      updates += 1
      Object.assign(target, patch)
      if (updates === 1) throw new Error('cloud update failed after local success')
      return Object.assign({ _id: id }, patch)
    }
  })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'pcs_1' })
    await page.overwriteExisting()
    assert.equal(page.data.status, 'error')
    assert.equal(target.avatarFileId, 'cloud://receiver/copied.png')
    assert.equal(loaded.calls.cleanupAvatar.length, 0)

    await page.overwriteExisting()
    assert.equal(updates, 1, 'retry must become stale during its notes reread')
    assert.equal(loaded.calls.cleanupAvatar.length, 0, 'locally referenced avatar must not be compensated')
    assert.equal(target.avatarFileId, 'cloud://receiver/copied.png')
  } finally { loaded.restore() }
})

test('complete receipt await cannot backfill imported state after switching accounts', async () => {
  const account = { id: 'PLAYER-A', epoch: 1 }
  const loaded = loadPage({
    account,
    completeReceipt() {
      account.id = 'PLAYER-B'; account.epoch += 1
      return { status: 'completed', targetPlayerNoteId: 'note-a' }
    }
  })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'pcs_1' })
    await page.importAsNew()
    assert.equal(page.data.importing, false)
    assert.equal(page.data.share, null)
    assert.notEqual(page.data.status, 'imported')
  } finally { loaded.restore() }
})

test('onShow clears A-sensitive UI and safely reloads for B after A-to-B and ABA changes', async () => {
  for (const aba of [false, true]) {
    const account = { id: 'PLAYER-A', epoch: 1 }
    const reload = deferred()
    let shareReads = 0
    const loaded = loadPage({
      account,
      getShare() {
        shareReads += 1
        return shareReads === 1 ? cardShare() : reload.promise
      }
    })
    try {
      const page = createInstance(loaded.definition)
      await page.onLoad({ shareId: 'pcs_1' })
      page.setData({ importing: true, copiedAvatar: { avatarFileId: 'cloud://a/private.png' } })
      account.id = 'PLAYER-B'; account.epoch += 1
      if (aba) { account.id = 'PLAYER-A'; account.epoch += 1 }
      const showing = page.onShow()
      assert.equal(page.data.share, null)
      assert.equal(page.data.duplicate, null)
      assert.equal(page.data.importing, false)
      assert.equal(page.data.copiedAvatar, null)
      reload.resolve(Object.assign(cardShare(), { sender: { nickname: 'reloaded' } }))
      await showing
      assert.equal(page.data.status, 'ready')
      assert.equal(page.data.share.sender.nickname, 'reloaded')
    } finally { loaded.restore() }
  }
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
  const account = options.account || { id: 'PLAYER-A', epoch: 1 }
  const calls = { order: [], confirm: [], beginReceipt: [], completeReceipt: [], getReceipt: [], create: [], createOptions: [], update: [], updateOptions: [], getPlayerNotes: [], cleanupAvatar: [], navigateTo: [], modals: [] }
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (parent && /pages[\\/]social-card-preview[\\/]social-card-preview\.js$/.test(parent.filename || '')) {
      if (request === '../../services/social-service') return {
        async getPlayerCardShare() {
          if (options.getShareError) throw options.getShareError
          return options.getShare === undefined ? cardShare() : await (typeof options.getShare === 'function' ? options.getShare() : options.getShare)
        },
        async confirmPlayerCardImport(input) {
          calls.order.push('confirm')
          calls.confirm.push(input)
          if (options.confirmError) throw options.confirmError
          return options.confirm === undefined ? { imported: true } : await (typeof options.confirm === 'function' ? options.confirm(input) : options.confirm)
        }
      }
      if (request === '../../services/data-service') return {
        captureAccountContext() { return Object.freeze({ accountId: account.id, epoch: account.epoch }) },
        isAccountContextCurrent(context) { return !!context && context.accountId === account.id && context.epoch === account.epoch },
        async getPlayerNotes(input) {
          calls.getPlayerNotes.push(input)
          return options.getPlayerNotes ? options.getPlayerNotes(input) : (options.notes || [])
        },
        async getPlayerCardImportReceipt(shareId, context) {
          calls.getReceipt.push(shareId)
          if (options.receiptError) throw options.receiptError
          if (options.getReceipt) return options.getReceipt(shareId, context)
          return options.receipt === undefined ? null : options.receipt
        },
        async beginPlayerCardImportReceipt(input, context) {
          calls.order.push('begin-receipt'); calls.beginReceipt.push(input)
          if (options.beginReceiptError) throw options.beginReceiptError
          if (options.beginReceipt) return options.beginReceipt(input, context)
          return Object.assign({}, input, { status: 'pending' })
        },
        async completePlayerCardImportReceipt(input, mutationId, context) {
          calls.order.push('complete-receipt'); calls.completeReceipt.push(input)
          if (options.completeReceiptError) throw options.completeReceiptError
          if (options.completeReceipt) return options.completeReceipt(input, mutationId, context)
          return Object.assign({}, options.receipt || calls.beginReceipt[0], { status: 'completed' })
        },
        async createPlayerNote(payload, createOptions) {
          calls.order.push('create'); calls.create.push(payload); calls.createOptions.push(createOptions)
          const createError = typeof options.createError === 'function' ? options.createError(payload) : options.createError
          if (createError) throw createError
          if (options.createPlayerNote) return options.createPlayerNote(payload, createOptions)
          return Object.assign({}, payload, { _id: payload._id || 'new-player' })
        },
        async updatePlayerNote(id, patch, updateOptions) {
          calls.order.push('update'); calls.update.push({ id, patch }); calls.updateOptions.push(updateOptions)
          const updateError = typeof options.updateError === 'function' ? options.updateError(id, patch) : options.updateError
          if (updateError) throw updateError
          if (options.updatePlayerNote) return options.updatePlayerNote(id, patch, updateOptions)
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
          },
          async deleteCopiedCardAvatar(avatar) {
            calls.cleanupAvatar.push(avatar)
            return true
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
