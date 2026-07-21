const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const root = path.resolve(__dirname, '..')
const pageRoot = path.join(root, 'pages', 'social-hand-publish')
const pageJsPath = path.join(pageRoot, 'social-hand-publish.js')
const pageWxmlPath = path.join(pageRoot, 'social-hand-publish.wxml')
const pageWxssPath = path.join(pageRoot, 'social-hand-publish.wxss')
const pageJsonPath = path.join(pageRoot, 'social-hand-publish.json')

test('publish route and privacy-first template expose only the approved BB scopes', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  assert.equal(app.pages.filter(item => item === 'pages/social-hand-publish/social-hand-publish').length, 1)
  const json = JSON.parse(fs.readFileSync(pageJsonPath, 'utf8'))
  const js = fs.readFileSync(pageJsPath, 'utf8')
  const wxml = fs.readFileSync(pageWxmlPath, 'utf8')
  const wxss = fs.readFileSync(pageWxssPath, 'utf8')
  assert.ok(json.navigationBarTitleText)
  ;['广场', '全部好友', '指定好友'].forEach(label => assert.match(wxml, new RegExp(label)))
  assert.match(wxml, /BB/)
  assert.match(wxml, /公开|所有人|广场可见/)
  assert.match(wxml, /snapshot/)
  assert.match(wxss, /publish|scope|preview/i)
  assert.doesNotMatch(wxml, /人民币|现金|金额|盈亏|盈利|利润|All.?in EV|EV 开关/i)
  assert.doesNotMatch(js + wxml, /ownerOpenId|_openid|privatePlayerId|avatarFileId|services\/data-service|services\/cloud-repo|resolveBigBlind|buildHandSnapshot|anonym/i)
})

test('preview errors explain fixable blind, action and legacy snapshot failures', () => {
  const js = fs.readFileSync(pageJsPath, 'utf8')
  assert.match(js, /BLIND_REQUIRED[^\n]+大盲/)
  assert.match(js, /HAND_ACTIONS_REQUIRED[^\n]+行动记录/)
  assert.match(js, /INVALID_HAND_SNAPSHOT[^\n]+座位/)
})

test('onLoad consumes only handId and renders the exact server snapshot and hash', async () => {
  const serverSnapshot = snapshot('server-only')
  const loaded = loadPublishPage({ previews: [{ previewHash: 'hash-server', snapshot: serverSnapshot, defaultShareScope: 'friends' }] })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({
      handId: 'hand/one', snapshot: JSON.stringify(snapshot('route-injection')),
      playerId: 'PRIVATE', bigBlind: '400', ownerOpenId: 'secret'
    })
    assert.deepEqual(loaded.calls.preview, [{ handId: 'hand/one' }])
    assert.equal(loaded.calls.localData, 0)
    assert.equal(page.data.handId, 'hand/one')
    assert.equal(page.data.previewHash, 'hash-server')
    assert.deepEqual(page.data.snapshot, serverSnapshot)
    assert.doesNotMatch(JSON.stringify(page.data), /route-injection|PRIVATE|secret|400/)
  } finally { loaded.restore() }
})

test('onLoad safely decodes an encoded handId before requesting the server preview', async () => {
  const loaded = loadPublishPage()
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ handId: 'hand%2Fid' })
    assert.deepEqual(loaded.calls.preview, [{ handId: 'hand/id' }])
    assert.equal(page.data.handId, 'hand/id')
  } finally { loaded.restore() }
})

test('every preview ignores the legacy server default and requires a fresh scope choice', async t => {
  for (const serverScope of ['square', 'friends', 'selected', '', 'unknown']) {
    await t.test(String(serverScope || 'absent'), async () => {
      const loaded = loadPublishPage({ previews: [{ previewHash: 'hash', snapshot: snapshot('scope'), defaultShareScope: serverScope }] })
      try {
        const page = createInstance(loaded.definition)
        await page.onLoad({ handId: 'hand-scope' })
        assert.equal(page.data.scope, '')
        assert.equal(loaded.calls.listFriends.length, 0)
      } finally { loaded.restore() }
    })
  }
})

test('selected friend picker paginates once, deduplicates, enforces 1-50, and clears on exit', async () => {
  const pageTwo = deferred()
  const firstItems = Array.from({ length: 30 }, (_, index) => friend('su_' + index))
  const secondItems = [friend('su_29')].concat(Array.from({ length: 25 }, (_, index) => friend('su_' + (index + 30))))
  const loaded = loadPublishPage({
    previews: [{ previewHash: 'hash-selected', snapshot: snapshot('selected'), defaultShareScope: 'friends' }],
    friendPages: [{ items: firstItems, nextOffset: 30 }, pageTwo.promise]
  })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ handId: 'hand-selected' })
    await page.changeScope(scopeEvent('selected'))
    assert.deepEqual(loaded.calls.listFriends[0], { offset: 0, limit: 20 })
    await page.submitPublish()
    assert.equal(loaded.calls.publish.length, 0, 'selected must reject zero targets before calling the service')

    const firstMore = page.loadMoreFriends()
    const duplicateMore = page.loadMoreFriends()
    assert.equal(loaded.calls.listFriends.length, 2, 'load-more must be single flight')
    pageTwo.resolve({ items: secondItems, nextOffset: null })
    await Promise.all([firstMore, duplicateMore])
    assert.equal(page.data.friends.length, 55)
    assert.equal(new Set(page.data.friends.map(item => item.socialUserId)).size, 55)

    page.data.friends.slice(0, 50).forEach(item => page.toggleTarget(targetEvent(item.socialUserId)))
    assert.equal(page.data.selectedTargetUserIds.length, 50)
    page.toggleTarget(targetEvent(page.data.friends[50].socialUserId))
    assert.equal(page.data.selectedTargetUserIds.length, 50, 'a 51st selected friend must be rejected')
    await page.submitPublish()
    assert.equal(loaded.calls.publish.length, 1)
    assert.equal(loaded.calls.publish[0].targetUserIds.length, 50)

    const switchFlight = page.changeScope(scopeEvent('friends'))
    assert.deepEqual(page.data.selectedTargetUserIds, [], 'leaving selected must clear targets immediately')
    await switchFlight
  } finally { loaded.restore() }
})

test('selected friend pagination stops when the server nextOffset does not advance', async () => {
  const loaded = loadPublishPage({
    friendPages: [{ items: [friend('su_a')], nextOffset: 0 }]
  })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ handId: 'hand-non-advancing-offset' })
    await page.changeScope(scopeEvent('selected'))
    assert.equal(page.data.nextFriendOffset, null)
    await page.loadMoreFriends()
    assert.equal(loaded.calls.listFriends.length, 1, 'a non-advancing cursor must be exhausted')
  } finally { loaded.restore() }
})

test('friends and square always submit empty targets and square needs a fresh non-cancelled confirmation', async () => {
  const failure = () => Promise.reject(error('NETWORK_ERROR', 'offline'))
  const loaded = loadPublishPage({
    previews: [
      { previewHash: 'hash-public-1', snapshot: snapshot('public-1'), defaultShareScope: 'friends' },
      { previewHash: 'hash-public-2', snapshot: snapshot('public-2'), defaultShareScope: 'square' },
      { previewHash: 'hash-public-3', snapshot: snapshot('public-3'), defaultShareScope: 'square' }
    ],
    publishes: [failure, failure, failure, failure, failure],
    modalDecisions: [false, true, true]
  })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ handId: 'hand-public' })
    await page.changeScope(scopeEvent('friends'))
    page.setData({ selectedTargetUserIds: ['must-clear'] })
    await page.submitPublish()
    assert.deepEqual(loaded.calls.publish[0].targetUserIds, [])
    assert.equal(loaded.calls.publish[0].publicShareConfirmed, false)

    await page.changeScope(scopeEvent('square'))
    await page.submitPublish()
    assert.equal(loaded.calls.publish.length, 1, 'cancelling the warning must not publish or confirm')
    await page.submitPublish()
    assert.deepEqual(loaded.calls.publish[1].targetUserIds, [])
    assert.equal(loaded.calls.publish[1].publicShareConfirmed, true)

    await page.changeScope(scopeEvent('friends'))
    await page.changeScope(scopeEvent('square'))
    await page.submitPublish()
    assert.equal(loaded.calls.modals.length, 3, 'switching away must invalidate public confirmation')
    assert.equal(loaded.calls.publish[2].publicShareConfirmed, true)

    await page.retryPreview()
    await page.changeScope(scopeEvent('square'))
    await page.submitPublish()
    assert.equal(loaded.calls.modals.length, 4, 'refreshing preview must require another public confirmation')

    await page.onLoad({ handId: 'hand-public-next' })
    await page.changeScope(scopeEvent('square'))
    await page.submitPublish()
    assert.equal(loaded.calls.modals.length, 5, 'changing hand must invalidate public confirmation')
  } finally { loaded.restore() }
})

test('an unchanged square retry confirms again while reusing the failed mutation id', async () => {
  const offline = () => Promise.reject(error('NETWORK_ERROR', 'offline'))
  const loaded = loadPublishPage({
    previews: [{ previewHash: 'hash-square-retry', snapshot: snapshot('square-retry'), defaultShareScope: 'square' }],
    publishes: [offline, offline],
    modalDecisions: [true, true]
  })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ handId: 'hand-square-retry' })
    await page.changeScope(scopeEvent('square'))
    await page.submitPublish()
    await page.submitPublish()
    assert.equal(loaded.calls.modals.length, 2, 'every square publish attempt needs a fresh confirmation')
    assert.equal(loaded.calls.publish.length, 2)
    assert.equal(loaded.calls.publish[1].clientMutationId, loaded.calls.publish[0].clientMutationId)
  } finally { loaded.restore() }
})

test('double tap shares one publish flight and success trusts only the server shareId', async () => {
  const publish = deferred()
  const loaded = loadPublishPage({ publishes: [publish.promise] })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ handId: 'private-hand' })
    await page.changeScope(scopeEvent('friends'))
    const first = page.submitPublish()
    const second = page.submitPublish()
    assert.equal(loaded.calls.publish.length, 1)
    publish.resolve({ shareId: 'share/server id', status: 'active', scope: 'friends' })
    await Promise.all([first, second])
    assert.equal(page.data.status, 'success')
    assert.equal(page.data.shareId, 'share/server id')
    assert.doesNotMatch(JSON.stringify(page.data), /share-private-hand|share-hash-default/)
    if (loaded.calls.navigation.length) {
      assert.equal(loaded.calls.navigation.length, 1)
      const url = loaded.calls.navigation[0].url
      assert.match(url, /shareId=share%2Fserver%20id/)
      assert.doesNotMatch(url, /private-hand|previewHash|snapshot|playerId|ownerOpenId/)
    }
  } finally { loaded.restore() }
})

test('input invalidation cannot start a second publish until the current service call settles', async t => {
  for (const invalidation of ['scope', 'target', 'retry']) {
    await t.test(invalidation, async () => {
      const firstPublish = deferred()
      const refreshedPreview = deferred()
      const loaded = loadPublishPage({
        previews: [
          { previewHash: 'hash-flight-old', snapshot: snapshot('flight-old'), defaultShareScope: invalidation === 'target' ? 'selected' : 'friends' },
          refreshedPreview.promise
        ],
        friendPages: [{ items: [friend('su_a'), friend('su_b')], nextOffset: null }],
        publishes: [firstPublish.promise, { shareId: 'share-new', status: 'active', scope: 'friends' }]
      })
      try {
        const page = createInstance(loaded.definition)
        await page.onLoad({ handId: 'hand-flight' })
        await page.changeScope(scopeEvent(invalidation === 'target' ? 'selected' : 'friends'))
        if (invalidation === 'target') page.toggleTarget(targetEvent('su_a'))
        const firstFlight = page.submitPublish()

        let invalidationFlight = Promise.resolve()
        if (invalidation === 'scope') invalidationFlight = page.changeScope(scopeEvent('square'))
        if (invalidation === 'target') page.toggleTarget(targetEvent('su_b'))
        if (invalidation === 'retry') {
          invalidationFlight = page.retryPreview()
          refreshedPreview.resolve({ previewHash: 'hash-flight-new', snapshot: snapshot('flight-new'), defaultShareScope: 'friends' })
          await invalidationFlight
        }

        const blockedFlight = page.submitPublish()
        await Promise.resolve()
        await Promise.resolve()
        assert.equal(loaded.calls.publish.length, 1, 'only one service publish may be in flight')
        if (invalidation === 'scope') assert.equal(page.data.scope, 'friends', 'scope changes are rejected while publishing')
        if (invalidation === 'target') assert.deepEqual(page.data.selectedTargetUserIds, ['su_a'], 'target changes are rejected while publishing')

        firstPublish.reject(error('NETWORK_ERROR', 'offline'))
        await Promise.all([firstFlight, blockedFlight])

        if (invalidation === 'scope') await page.changeScope(scopeEvent('square'))
        if (invalidation === 'target') page.toggleTarget(targetEvent('su_b'))
        if (invalidation === 'retry') await page.changeScope(scopeEvent('friends'))
        await page.submitPublish()
        assert.equal(loaded.calls.publish.length, 2, 'a new input may publish after the old service call settles')
        assert.notEqual(loaded.calls.publish[1].clientMutationId, loaded.calls.publish[0].clientMutationId)
      } finally { loaded.restore() }
    })
  }
})

test('failed unchanged input reuses its mutation id while target scope hash and hand changes rotate it', async () => {
  const offline = () => Promise.reject(error('NETWORK_ERROR', 'offline'))
  const loaded = loadPublishPage({
    previews: [
      { previewHash: 'hash-1', snapshot: snapshot('one'), defaultShareScope: 'selected' },
      { previewHash: 'hash-2', snapshot: snapshot('two'), defaultShareScope: 'friends' },
      { previewHash: 'hash-hand-2', snapshot: snapshot('hand-two'), defaultShareScope: 'friends' }
    ],
    friendPages: [{ items: [friend('su_a'), friend('su_b')], nextOffset: null }],
    publishes: [offline, offline, offline, offline, offline, offline]
  })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ handId: 'hand-1' })
    await page.changeScope(scopeEvent('selected'))
    page.toggleTarget(targetEvent('su_a'))
    await page.submitPublish()
    await page.submitPublish()
    assert.equal(loaded.calls.publish[1].clientMutationId, loaded.calls.publish[0].clientMutationId)

    page.toggleTarget(targetEvent('su_b'))
    await page.submitPublish()
    assert.notEqual(loaded.calls.publish[2].clientMutationId, loaded.calls.publish[1].clientMutationId)

    await page.changeScope(scopeEvent('friends'))
    await page.submitPublish()
    assert.notEqual(loaded.calls.publish[3].clientMutationId, loaded.calls.publish[2].clientMutationId)

    await page.retryPreview()
    await page.changeScope(scopeEvent('friends'))
    await page.submitPublish()
    assert.notEqual(loaded.calls.publish[4].clientMutationId, loaded.calls.publish[3].clientMutationId)

    await page.onLoad({ handId: 'hand-2' })
    await page.changeScope(scopeEvent('friends'))
    await page.submitPublish()
    assert.notEqual(loaded.calls.publish[5].clientMutationId, loaded.calls.publish[4].clientMutationId)
  } finally { loaded.restore() }
})

test('HAND_PREVIEW_STALE clears the hash, re-previews, and never auto-publishes the replacement', async () => {
  const loaded = loadPublishPage({
    previews: [
      { previewHash: 'old-hash', snapshot: snapshot('old'), defaultShareScope: 'friends' },
      { previewHash: 'fresh-hash', snapshot: snapshot('fresh'), defaultShareScope: 'square' }
    ],
    publishes: [() => Promise.reject(error('HAND_PREVIEW_STALE', 'arbitrary localized text'))]
  })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ handId: 'hand-stale' })
    await page.changeScope(scopeEvent('friends'))
    await page.submitPublish()
    assert.equal(loaded.calls.publish.length, 1)
    assert.equal(loaded.calls.preview.length, 2)
    assert.equal(page.data.previewHash, 'fresh-hash')
    assert.deepEqual(page.data.snapshot, snapshot('fresh'))
    assert.equal(page.data.scope, '')
    assert.equal(loaded.calls.publish.length, 1, 'fresh preview must require a new user submission')
    assert.equal(loaded.calls.navigation.length, 0)
  } finally { loaded.restore() }
})

test('error decisions use code rather than message and validation remains actionable without false success', async () => {
  const loaded = loadPublishPage({
    publishes: [
      () => Promise.reject(error('NETWORK_ERROR', 'HAND_PREVIEW_STALE')),
      () => Promise.reject(error('INVALID_SHARE_SCOPE', 'network unavailable')),
      () => Promise.reject(error('CONTENT_UNAVAILABLE', 'published successfully'))
    ]
  })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ handId: 'hand-errors' })
    await page.changeScope(scopeEvent('friends'))
    await page.submitPublish()
    assert.equal(loaded.calls.preview.length, 1, 'stale-looking message must not trigger a preview refresh')
    await page.submitPublish()
    assert.equal(page.data.status === 'success', false)
    assert.equal(page.data.errorCode, 'INVALID_SHARE_SCOPE')
    await page.submitPublish()
    assert.equal(page.data.status === 'success', false)
    assert.equal(loaded.calls.navigation.length, 0)
  } finally { loaded.restore() }
})

test('preview retry hand change and unload suppress every stale preview completion', async t => {
  await t.test('retry', async () => {
    const oldPreview = deferred()
    const freshPreview = deferred()
    const loaded = loadPublishPage({ previews: [oldPreview.promise, freshPreview.promise] })
    try {
      const page = createInstance(loaded.definition)
      const oldFlight = page.onLoad({ handId: 'hand-a' })
      const retry = page.retryPreview()
      freshPreview.resolve({ previewHash: 'fresh', snapshot: snapshot('fresh'), defaultShareScope: 'friends' })
      await retry
      oldPreview.resolve({ previewHash: 'old', snapshot: snapshot('old'), defaultShareScope: 'square' })
      await oldFlight
      assert.equal(page.data.previewHash, 'fresh')
    } finally { loaded.restore() }
  })

  await t.test('hand change', async () => {
    const oldPreview = deferred()
    const newPreview = deferred()
    const loaded = loadPublishPage({ previews: [oldPreview.promise, newPreview.promise] })
    try {
      const page = createInstance(loaded.definition)
      const oldFlight = page.onLoad({ handId: 'hand-a' })
      const newFlight = page.onLoad({ handId: 'hand-b' })
      newPreview.resolve({ previewHash: 'hand-b-hash', snapshot: snapshot('hand-b'), defaultShareScope: 'friends' })
      await newFlight
      oldPreview.resolve({ previewHash: 'hand-a-hash', snapshot: snapshot('hand-a'), defaultShareScope: 'square' })
      await oldFlight
      assert.equal(page.data.handId, 'hand-b')
      assert.equal(page.data.previewHash, 'hand-b-hash')
    } finally { loaded.restore() }
  })

  await t.test('unload', async () => {
    const pending = deferred()
    const loaded = loadPublishPage({ previews: [pending.promise] })
    try {
      const page = createInstance(loaded.definition)
      const flight = page.onLoad({ handId: 'hand-unload' })
      page.onUnload()
      const patchCount = page._patches.length
      pending.resolve({ previewHash: 'late', snapshot: snapshot('late'), defaultShareScope: 'friends' })
      await flight
      assert.equal(page._patches.length, patchCount)
    } finally { loaded.restore() }
  })
})

test('preview retry hand change and unload suppress stale publish state and navigation', async t => {
  for (const invalidation of ['retry', 'hand-change', 'unload']) {
    await t.test(invalidation, async () => {
      const publish = deferred()
      const nextPreview = deferred()
      const loaded = loadPublishPage({ previews: [defaultPreview(), nextPreview.promise], publishes: [publish.promise] })
      try {
        const page = createInstance(loaded.definition)
        await page.onLoad({ handId: 'hand-old' })
        await page.changeScope(scopeEvent('friends'))
        const flight = page.submitPublish()
        let invalidationFlight = Promise.resolve()
        if (invalidation === 'retry') invalidationFlight = page.retryPreview()
        if (invalidation === 'hand-change') invalidationFlight = page.onLoad({ handId: 'hand-new' })
        if (invalidation === 'unload') page.onUnload()
        const patchCount = page._patches.length
        publish.resolve({ shareId: 'late-share', status: 'active', scope: 'friends' })
        await flight
        assert.equal(loaded.calls.navigation.length, 0)
        assert.equal(page._patches.length, patchCount)
        if (invalidation !== 'unload') {
          nextPreview.resolve({ previewHash: 'next', snapshot: snapshot('next'), defaultShareScope: 'friends' })
          await invalidationFlight
        }
      } finally { loaded.restore() }
    })
  }
})

test('page visibility lifecycle suppresses hidden work and re-previews only after a real re-show', async t => {
  await t.test('the first onShow after onLoad does not duplicate the preview', async () => {
    const loaded = loadPublishPage()
    try {
      const page = createInstance(loaded.definition)
      await page.onLoad({ handId: 'hand-first-show' })
      await page.onShow()
      assert.equal(loaded.calls.preview.length, 1)
      assert.equal(page.data.status, 'ready')
    } finally { loaded.restore() }
  })

  await t.test('a modal confirmation after onHide cannot publish and onShow fetches a fresh preview', async () => {
    const modalDecision = deferred()
    const loaded = loadPublishPage({
      previews: [
        { previewHash: 'hash-before-hide', snapshot: snapshot('before-hide'), defaultShareScope: 'square' },
        { previewHash: 'hash-after-show', snapshot: snapshot('after-show'), defaultShareScope: 'friends' }
      ],
      modalDecisions: [modalDecision.promise]
    })
    try {
      const page = createInstance(loaded.definition)
      await page.onLoad({ handId: 'hand-modal-hide' })
      await page.onShow()
      await page.changeScope(scopeEvent('square'))
      const publishFlight = page.submitPublish()
      page.onHide()
      const patchCount = page._patches.length
      modalDecision.resolve(true)
      await publishFlight
      assert.equal(loaded.calls.publish.length, 0)
      assert.equal(page._patches.length, patchCount)

      await page.onShow()
      assert.equal(loaded.calls.preview.length, 2)
      assert.equal(page.data.previewHash, 'hash-after-show')
      assert.equal(page.data.status, 'ready')
    } finally { loaded.restore() }
  })

  await t.test('hidden preview and publish completions cannot patch or overwrite the fresh visible lifecycle', async () => {
    const oldPreview = deferred()
    const freshPreview = deferred()
    const loadedPreview = loadPublishPage({ previews: [oldPreview.promise, freshPreview.promise] })
    try {
      const page = createInstance(loadedPreview.definition)
      const oldFlight = page.onLoad({ handId: 'hand-preview-hide' })
      await page.onShow()
      page.onHide()
      const hiddenPatchCount = page._patches.length
      const showFlight = page.onShow()
      freshPreview.resolve({ previewHash: 'hash-visible', snapshot: snapshot('visible'), defaultShareScope: 'friends' })
      await showFlight
      assert.equal(page.data.previewHash, 'hash-visible')
      const visiblePatchCount = page._patches.length
      oldPreview.resolve({ previewHash: 'hash-hidden-old', snapshot: snapshot('hidden-old'), defaultShareScope: 'square' })
      await oldFlight
      assert.ok(visiblePatchCount > hiddenPatchCount)
      assert.equal(page._patches.length, visiblePatchCount)
      assert.equal(page.data.previewHash, 'hash-visible')
    } finally { loadedPreview.restore() }

    const oldPublish = deferred()
    const loadedPublish = loadPublishPage({
      previews: [
        { previewHash: 'hash-publish-old', snapshot: snapshot('publish-old'), defaultShareScope: 'friends' },
        { previewHash: 'hash-publish-visible', snapshot: snapshot('publish-visible'), defaultShareScope: 'friends' }
      ],
      publishes: [oldPublish.promise]
    })
    try {
      const page = createInstance(loadedPublish.definition)
      await page.onLoad({ handId: 'hand-publish-hide' })
      await page.onShow()
      await page.changeScope(scopeEvent('friends'))
      const oldFlight = page.submitPublish()
      page.onHide()
      await page.onShow()
      assert.equal(page.data.previewHash, 'hash-publish-visible')
      const visiblePatchCount = page._patches.length
      oldPublish.resolve({ shareId: 'share-hidden', status: 'active', scope: 'friends' })
      await oldFlight
      assert.equal(page._patches.length, visiblePatchCount)
      assert.equal(page.data.status, 'ready')
      assert.equal(page.data.shareId, '')
      assert.equal(loadedPublish.calls.publish.length, 1)
    } finally { loadedPublish.restore() }
  })
})

function loadPublishPage(options = {}) {
  let definition = null
  let mutationIndex = 0
  const calls = {
    preview: [], listFriends: [], publish: [], localData: 0,
    modals: [], toasts: [], navigation: [],
    previewQueue: (options.previews || [defaultPreview()]).slice(),
    friendQueue: (options.friendPages || [{ items: [friend('su_a'), friend('su_b')], nextOffset: null }]).slice(),
    publishQueue: (options.publishes || [{ shareId: 'share-default', status: 'active', scope: 'friends' }]).slice(),
    modalQueue: (options.modalDecisions || []).slice()
  }
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (parent && /pages[\\/]social-hand-publish[\\/]social-hand-publish\.js$/.test(parent.filename || '')) {
      if (request === '../../services/social-service') return {
        async previewHandShare(input) {
          calls.preview.push(input)
          const value = calls.previewQueue.length ? calls.previewQueue.shift() : defaultPreview()
          return typeof value === 'function' ? value(input) : await value
        },
        async listFriends(input) {
          calls.listFriends.push(input)
          const value = calls.friendQueue.length ? calls.friendQueue.shift() : { items: [], nextOffset: null }
          return typeof value === 'function' ? value(input) : await value
        },
        async publishHand(input) {
          calls.publish.push(JSON.parse(JSON.stringify(input)))
          const value = calls.publishQueue.length ? calls.publishQueue.shift() : { shareId: 'share-default', status: 'active', scope: input.scope }
          return typeof value === 'function' ? value(input) : await value
        }
      }
      if (request === '../../utils/social-mutation') return {
        createMutationId(prefix) { mutationIndex += 1; return prefix + ':mutation-' + mutationIndex }
      }
      if (request === '../../services/data-service' || request === '../../services/cloud-repo') {
        calls.localData += 1
        return new Proxy({}, { get() { calls.localData += 1; throw new Error('publish page must not load local poker data') } })
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  global.Page = config => { definition = config }
  global.wx = {
    showToast(input) { calls.toasts.push(input) },
    showModal(input) {
      calls.modals.push(input)
      const decision = calls.modalQueue.length ? calls.modalQueue.shift() : true
      Promise.resolve(decision).then(confirm => input.success({ confirm: confirm === true, cancel: confirm !== true }))
    },
    navigateTo(input) { calls.navigation.push(input) },
    redirectTo(input) { calls.navigation.push(input) },
    navigateBack(input) { calls.navigation.push(Object.assign({ navigateBack: true }, input)) }
  }
  let resolvedPath = ''
  try {
    resolvedPath = require.resolve(pageJsPath)
    delete require.cache[resolvedPath]
    require(resolvedPath)
  } finally {
    Module._load = originalLoad
    delete global.Page
  }
  return {
    definition,
    calls,
    restore() {
      if (resolvedPath) delete require.cache[resolvedPath]
      delete global.wx
    }
  }
}

function createInstance(definition) {
  const instance = {
    data: JSON.parse(JSON.stringify(definition.data || {})),
    _patches: [],
    setData(patch, callback) {
      this._patches.push(patch)
      Object.keys(patch || {}).forEach(key => setByPath(this.data, key, patch[key]))
      if (typeof callback === 'function') callback()
    }
  }
  Object.assign(instance, definition)
  return instance
}

function setByPath(target, key, value) {
  const parts = String(key).split('.')
  let cursor = target
  while (parts.length > 1) {
    const part = parts.shift()
    cursor[part] = cursor[part] || {}
    cursor = cursor[part]
  }
  cursor[parts[0]] = value
}

function snapshot(label) {
  const variant = Array.from(String(label)).reduce((sum, character) => sum + character.charCodeAt(0), 0) % 100
  return {
    version: 1,
    hero: { label: 'Hero', position: 'BTN', seat: 1, cards: ['As', 'Kd'], stackBb: 101.5 },
    players: [
      { label: 'Hero', position: 'BTN', seat: 1, stackBb: 101.5 },
      { label: 'V1', position: 'BB', seat: 2, stackBb: 88 }
    ],
    board: { flop: ['2c', '7d', 'Th'], turn: ['Js'], river: [] },
    actions: [{ street: 'preflop', actor: 'Hero', type: 'raise', amountBb: 2.5 }],
    effectiveStackBb: 88,
    potBb: 6.5 + variant / 100,
    showdown: []
  }
}

function defaultPreview() {
  return { previewHash: 'hash-default', snapshot: snapshot('default'), defaultShareScope: 'friends' }
}

function friend(socialUserId) {
  return { socialUserId, nickname: socialUserId, avatarUrl: '', avatarText: '友', title: '' }
}

function scopeEvent(scope) {
  return { currentTarget: { dataset: { scope } } }
}

function targetEvent(id) {
  return { currentTarget: { dataset: { id } } }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function error(code, message) {
  return Object.assign(new Error(message || code), { code })
}
