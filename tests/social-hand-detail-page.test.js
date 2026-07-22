const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const { createMemorySocialRepository } = require('./helpers/social-fixture')
const { getPairId } = require('../cloudfunctions/poker_social/lib/friendship')

const root = path.resolve(__dirname, '..')
const detailRoute = 'pages/social-hand-detail/social-hand-detail'
const detailRoot = path.join(root, 'pages', 'social-hand-detail')
const detailJs = path.join(detailRoot, 'social-hand-detail.js')
const detailWxml = path.join(detailRoot, 'social-hand-detail.wxml')
const detailWxss = path.join(detailRoot, 'social-hand-detail.wxss')

test('hand detail route and four page files are registered before navigation is possible', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  assert.equal(app.pages.filter(item => item === detailRoute).length, 1)
  ;['js', 'json', 'wxml', 'wxss'].forEach(extension => {
    assert.equal(fs.existsSync(path.join(detailRoot, `social-hand-detail.${extension}`)), true, `missing detail ${extension}`)
  })
  const pageJson = JSON.parse(fs.readFileSync(path.join(detailRoot, 'social-hand-detail.json'), 'utf8'))
  const wxml = fs.readFileSync(path.join(detailRoot, 'social-hand-detail.wxml'), 'utf8')
  assert.ok(pageJson.navigationBarTitleText)
  ;['loading', 'ready', 'unavailable', 'error'].forEach(state => assert.match(wxml, new RegExp(state)))
})

test('get_hand_share enforces the publisher, square, friend, and selected authorization matrix', async () => {
  const ctx = createDetailApp()
  await expectReadable(ctx, 'openid-publisher', 'share-own-friends', true)
  await expectReadable(ctx, 'openid-stranger', 'share-square', false)
  await expectReadable(ctx, 'openid-friend', 'share-friends', false)
  await expectReadable(ctx, 'openid-selected', 'share-selected', false)

  for (const [openId, shareId] of [
    ['openid-stranger', 'share-friends'],
    ['openid-stranger', 'share-selected'],
    ['openid-removed', 'share-friends'],
    ['openid-nonmember', 'share-selected'],
    ['openid-publisher', 'share-withdrawn'],
    ['openid-stranger', 'missing-share']
  ]) await expectUnavailable(ctx, openId, shareId)
})

test('get_hand_share accepts canonical privatePlayerId and compatible legacy playerId but rejects tuple conflicts', async () => {
  const ctx = createDetailApp()
  await expectReadable(ctx, 'openid-publisher', 'share-source-legacy-player-id', true)
  for (const shareId of [
    'share-source-missing',
    'share-source-owner-mismatch',
    'share-source-private-player-mismatch',
    'share-source-dual-player-conflict'
  ]) {
    await expectUnavailable(ctx, 'openid-publisher', shareId)
  }
})

test('detail reauthorizes after a formerly visible relationship, scope, selection, status, or source changes', async t => {
  const cases = [
    ['friend removed', 'openid-friend', 'share-friends', repository => {
      repository.set('social_friendships', getPairId('su-publisher', 'su-friend'), friendship('su-publisher', 'su-friend', 'removed'))
    }],
    ['scope changed', 'openid-stranger', 'share-square', repository => {
      repository.set('social_hand_shares', 'share-square', share('share-square', 'friends'))
    }],
    ['selected member removed', 'openid-selected', 'share-selected', repository => {
      repository.set('social_hand_shares', 'share-selected', share('share-selected', 'selected', { targetUserIds: [] }))
    }],
    ['share withdrawn', 'openid-friend', 'share-friends', repository => {
      repository.set('social_hand_shares', 'share-friends', share('share-friends', 'friends', { status: 'withdrawn' }))
    }],
    ['source deleted', 'openid-stranger', 'share-square', repository => {
      repository.set('hands', 'hand-main', { ownerOpenId: 'deleted-source', privatePlayerId: 'P5-PUBLISHER' })
    }]
  ]
  for (const [name, openId, shareId, mutate] of cases) {
    await t.test(name, async () => {
      const ctx = createDetailApp()
      await expectReadable(ctx, openId, shareId, openId === 'openid-publisher')
      mutate(ctx.repository)
      await expectUnavailable(ctx, openId, shareId)
    })
  }
})

test('detail action ignores client authority fields and recursively emits only HandShareDetailV1', async () => {
  const ctx = createDetailApp({ canaries: true })
  const result = await ctx.app.handle({
    action: 'get_hand_share',
    shareId: 'share-square',
    viewerId: 'su-publisher',
    publisherId: 'su-stranger',
    friendIds: ['su-publisher'],
    source: { ownerOpenId: 'forged' },
    likedByMe: true,
    likeCount: 999,
    commentCount: 999
  }, { openId: 'openid-stranger' })

  assert.equal(result.code, 0)
  assert.deepEqual(result.data, expectedDetail('share-square', 'square', false))
  assertExactKeys(result.data, ['shareId', 'publisher', 'scope', 'scopeLabel', 'handSnapshot', 'likedByMe', 'likeCount', 'commentCount', 'createdAt', 'isMine', 'canModerateComments'])
  assertExactKeys(result.data.publisher, ['socialUserId', 'nickname', 'avatarUrl', 'avatarText'])
  assertExactSnapshot(result.data.handSnapshot)
  const serialized = JSON.stringify(result.data)
  for (const canary of PRIVATE_CANARY_VALUES) assert.doesNotMatch(serialized, new RegExp(escapeRegExp(canary)))
})

test('detail moderation capability comes only from the injected server actor policy', async () => {
  const ctx = createDetailApp({ isAdminActor: actor => actor && actor.ownerOpenId === 'openid-stranger' })
  const admin = await ctx.app.handle({ action: 'get_hand_share', shareId: 'share-square' }, { openId: 'openid-stranger' })
  assert.equal(admin.code, 0)
  assert.equal(admin.data.canModerateComments, true)
  const forged = await ctx.app.handle({
    action: 'get_hand_share', shareId: 'share-square', canModerateComments: true, isAdmin: true, openId: 'openid-stranger'
  }, { openId: 'openid-nonmember' })
  assert.equal(forged.code, 0)
  assert.equal(forged.data.canModerateComments, false)
})

test('detail emits only a parsed https publisher avatar and strips signed cloud wrappers', async () => {
  const safe = await createDetailApp().app.handle({ action: 'get_hand_share', shareId: 'share-square' }, { openId: 'openid-stranger' })
  assert.equal(safe.code, 0)
  assert.equal(safe.data.publisher.avatarUrl, 'https://signed.example/cloud%3A%2F%2Favatar-publisher')

  const unsafe = await createDetailApp({ avatarUrl: () => 'signed:cloud://avatar-publisher' }).app.handle(
    { action: 'get_hand_share', shareId: 'share-square' },
    { openId: 'openid-stranger' }
  )
  assert.equal(unsafe.code, 0)
  assert.equal(unsafe.data.publisher.avatarUrl, '')
  assert.doesNotMatch(JSON.stringify(unsafe), /signed:cloud:\/\//)
})

test('detail page consumes only decoded shareId and trusts only the server DTO', async () => {
  const dto = expectedDetail('share/server', 'friends', false)
  const loaded = loadDetailPage({ responses: [dto] })
  try {
    const page = createInstance(loaded.definition)
    const flight = page.onLoad({
      shareId: 'share%2Fserver', snapshot: 'route-snapshot', publisherId: 'forged',
      viewerId: 'forged', canRead: 'true', source: 'private-source'
    })
    assert.equal(page.data.status, 'loading')
    await flight
    assert.deepEqual(loaded.calls.detail, ['share/server'])
    assert.equal(loaded.calls.localData, 0)
    assert.equal(page.data.status, 'ready')
    assert.deepEqual(page.data.detail, dto)
    assert.doesNotMatch(JSON.stringify(page.data), /route-snapshot|forged|private-source/)
  } finally { loaded.restore() }
})

test('detail accepts signed HTTPS avatars when the WeChat runtime has no browser URL constructor', async () => {
  const dto = expectedDetail('share-wechat-url', 'square', false)
  const loaded = loadDetailPage({ responses: [dto] })
  const originalUrl = global.URL
  try {
    global.URL = undefined
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'share-wechat-url' })
    assert.equal(page.data.status, 'ready')
    assert.equal(page.data.detail.publisher.avatarUrl, dto.publisher.avatarUrl)
  } finally {
    global.URL = originalUrl
    loaded.restore()
  }
})

test('detail page rejects every polluted HandSnapshotV1 numeric leaf without retaining canaries', async t => {
  const commonInvalid = [
    { ownerOpenId: 'CANARY_NUMERIC_LEAF' },
    'CANARY_NUMERIC_LEAF',
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -1
  ]
  const cases = [
    ['version', (snapshot, value) => { snapshot.version = value }, commonInvalid.concat([0, 1.5])],
    ['hero seat', (snapshot, value) => { snapshot.hero.seat = value }, commonInvalid.concat([1.5])],
    ['player seat', (snapshot, value) => { snapshot.players[0].seat = value }, commonInvalid.concat([1.5])],
    ['hero stackBb', (snapshot, value) => { snapshot.hero.stackBb = value }, commonInvalid],
    ['player stackBb', (snapshot, value) => { snapshot.players[0].stackBb = value }, commonInvalid],
    ['action amountBb', (snapshot, value) => { snapshot.actions[0].amountBb = value }, commonInvalid],
    ['effectiveStackBb', (snapshot, value) => { snapshot.effectiveStackBb = value }, commonInvalid],
    ['potBb', (snapshot, value) => { snapshot.potBb = value }, commonInvalid],
    ['allInPotBb', (snapshot, value) => { snapshot.allInPotBb = value }, commonInvalid]
  ]

  for (const [name, mutate, invalidValues] of cases) {
    await t.test(name, async () => {
      for (const invalidValue of invalidValues) {
        const dto = expectedDetail('share-polluted', 'square', false)
        mutate(dto.handSnapshot, invalidValue)
        const loaded = loadDetailPage({ responses: [dto] })
        try {
          const page = createInstance(loaded.definition)
          await page.onLoad({ shareId: 'share-polluted' })
          assert.doesNotMatch(JSON.stringify(page.data), /CANARY_NUMERIC_LEAF/)
          assert.equal(page.data.status, 'error')
          assert.equal(page.data.detail, null)
        } finally { loaded.restore() }
      }
    })
  }
})

test('detail page rejects every non-string protocol leaf without retaining injected values', async t => {
  const cases = [
    ['shareId', (dto, value) => { dto.shareId = value }],
    ['publisher socialUserId', (dto, value) => { dto.publisher.socialUserId = value }],
    ['publisher nickname', (dto, value) => { dto.publisher.nickname = value }],
    ['publisher avatarUrl', (dto, value) => { dto.publisher.avatarUrl = value }],
    ['publisher avatarText', (dto, value) => { dto.publisher.avatarText = value }],
    ['scope', (dto, value) => { dto.scope = value }],
    ['scopeLabel', (dto, value) => { dto.scopeLabel = value }],
    ['hero label', (dto, value) => { dto.handSnapshot.hero.label = value }],
    ['hero position', (dto, value) => { dto.handSnapshot.hero.position = value }],
    ['hero cards', (dto, value) => { dto.handSnapshot.hero.cards[0] = value }],
    ['player label', (dto, value) => { dto.handSnapshot.players[0].label = value }],
    ['player position', (dto, value) => { dto.handSnapshot.players[0].position = value }],
    ['board cards', (dto, value) => { dto.handSnapshot.board.flop[0] = value }],
    ['action street', (dto, value) => { dto.handSnapshot.actions[0].street = value }],
    ['action actor', (dto, value) => { dto.handSnapshot.actions[0].actor = value }],
    ['action type', (dto, value) => { dto.handSnapshot.actions[0].type = value }],
    ['showdown actor', (dto, value) => { dto.handSnapshot.showdown[0].actor = value }],
    ['showdown cards', (dto, value) => { dto.handSnapshot.showdown[0].cards[0] = value }]
  ]

  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      for (const invalidValue of [7, { canary: 'CANARY_STRING_LEAF' }]) {
        const dto = expectedDetail('share-string-polluted', 'square', false)
        mutate(dto, invalidValue)
        const loaded = loadDetailPage({ responses: [dto] })
        try {
          const page = createInstance(loaded.definition)
          await page.onLoad({ shareId: 'share-string-polluted' })
          assert.doesNotMatch(JSON.stringify(page.data), /CANARY_STRING_LEAF/)
          assert.equal(page.data.status, 'error')
          assert.equal(page.data.detail, null)
        } finally { loaded.restore() }
      }
    })
  }
})

test('detail page requires createdAt to be a native positive safe integer', async () => {
  const invalidValues = [
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    '123456',
    { canary: 'CANARY_CREATED_AT' }
  ]

  for (const invalidValue of invalidValues) {
    const dto = expectedDetail('share-invalid-created-at', 'square', false)
    dto.createdAt = invalidValue
    const loaded = loadDetailPage({ responses: [dto] })
    try {
      const page = createInstance(loaded.definition)
      await page.onLoad({ shareId: 'share-invalid-created-at' })
      assert.doesNotMatch(JSON.stringify(page.data), /CANARY_CREATED_AT/)
      assert.equal(page.data.status, 'error')
      assert.equal(page.data.detail, null)
    } finally { loaded.restore() }
  }
})

test('detail page has closed unavailable and retryable error states', async t => {
  await t.test('content unavailable', async () => {
    const loaded = loadDetailPage({ responses: [typedError('CONTENT_UNAVAILABLE')] })
    try {
      const page = createInstance(loaded.definition)
      await page.onLoad({ shareId: 'share-gone' })
      assert.equal(page.data.status, 'unavailable')
      assert.equal(page.data.detail, null)
    } finally { loaded.restore() }
  })
  await t.test('network error and retry', async () => {
    const loaded = loadDetailPage({ responses: [typedError('NETWORK_ERROR'), expectedDetail('share-retry', 'square', false)] })
    try {
      const page = createInstance(loaded.definition)
      await page.onLoad({ shareId: 'share-retry' })
      assert.equal(page.data.status, 'error')
      assert.equal(page.data.detail, null)
      await page.retry()
      assert.equal(page.data.status, 'ready')
      assert.deepEqual(loaded.calls.detail, ['share-retry', 'share-retry'])
    } finally { loaded.restore() }
  })
})

test('new loads and unload suppress stale detail responses and state writes', async () => {
  const old = deferred()
  const fresh = deferred()
  const loaded = loadDetailPage({ responses: [old.promise, fresh.promise] })
  try {
    const page = createInstance(loaded.definition)
    const oldFlight = page.onLoad({ shareId: 'share-old' })
    const freshFlight = page.onLoad({ shareId: 'share-fresh' })
    fresh.resolve(expectedDetail('share-fresh', 'square', false))
    await freshFlight
    old.resolve(expectedDetail('share-old', 'friends', false))
    await oldFlight
    assert.equal(page.data.detail.shareId, 'share-fresh')

    const late = deferred()
    loaded.responses.push(late.promise)
    const lateFlight = page.onLoad({ shareId: 'share-late' })
    page.onUnload()
    const patchCount = page._patches.length
    late.resolve(expectedDetail('share-late', 'square', false))
    await lateFlight
    assert.equal(page._patches.length, patchCount)
    assert.equal(loaded.calls.navigation.length, 0)
  } finally { loaded.restore() }
})

function createDetailApp(options = {}) {
  const { createSocialApp } = require('../cloudfunctions/poker_social/app')
  const users = ['publisher', 'stranger', 'friend', 'selected', 'nonmember', 'removed'].map(name => socialUser(name, options.canaries))
  const seed = {
    social_users: users,
    social_friendships: [
      friendship('su-publisher', 'su-friend'),
      friendship('su-publisher', 'su-selected'),
      friendship('su-publisher', 'su-nonmember'),
      friendship('su-publisher', 'su-removed', 'removed')
    ],
    hands: [{
      _id: 'hand-main', ownerOpenId: 'openid-publisher', privatePlayerId: 'P5-PUBLISHER',
      note: 'CANARY_HAND_NOTE', nested: { ownerOpenId: 'CANARY_HAND_OPENID' }
    }],
    social_hand_shares: [
      share('share-own-friends', 'friends', { canaries: options.canaries }),
      share('share-square', 'square', { canaries: options.canaries }),
      share('share-friends', 'friends'),
      share('share-selected', 'selected', { targetUserIds: ['su-selected'] }),
      share('share-withdrawn', 'square', { status: 'withdrawn' }),
      share('share-source-missing', 'square', { source: source('hand-missing') }),
      share('share-source-owner-mismatch', 'square', { source: Object.assign(source(), { ownerOpenId: 'openid-other' }) }),
      share('share-source-private-player-mismatch', 'square', { source: Object.assign(source(), { privatePlayerId: 'P5-OTHER' }) }),
      share('share-source-legacy-player-id', 'square', { source: legacySource() }),
      share('share-source-dual-player-conflict', 'square', {
        source: Object.assign(source(), { playerId: 'P5-OTHER' })
      })
    ]
  }
  const repository = createMemorySocialRepository(seed)
  const app = createSocialApp({
    repository,
    identity: { resolve: openId => ({ ownerOpenId: openId }) },
    isAdminActor: options.isAdminActor,
    avatarUrl: options.avatarUrl || (fileId => `https://signed.example/${encodeURIComponent(fileId)}`),
    requestId: () => 'request-detail'
  })
  return { app, repository }
}

function socialUser(name, canaries) {
  return {
    _id: `su-${name}`,
    ownerOpenId: `openid-${name}`,
    privatePlayerId: `P5-${name.toUpperCase()}`,
    profile: Object.assign({ nickname: name === 'publisher' ? '老王' : name, avatarText: name.slice(0, 1), avatarFileId: 'cloud://avatar-publisher' }, canaries ? {
      note: 'CANARY_PROFILE_NOTE', leakTags: ['CANARY_PROFILE_LEAK'], nested: { _openid: 'CANARY_PROFILE_OPENID' }
    } : {})
  }
}

function friendship(left, right, status = 'accepted') {
  const pair = [left, right].sort()
  return { _id: getPairId(left, right), userA: pair[0], userB: pair[1], status, acceptedAt: 100 }
}

function source(handId = 'hand-main') {
  return { ownerOpenId: 'openid-publisher', privatePlayerId: 'P5-PUBLISHER', handId }
}

function legacySource(handId = 'hand-main') {
  return { ownerOpenId: 'openid-publisher', playerId: 'P5-PUBLISHER', handId }
}

function share(id, scope, patch = {}) {
  const value = {
    _id: id,
    publisherId: 'su-publisher',
    source: source(),
    snapshot: approvedSnapshot(),
    status: 'active',
    scope,
    targetUserIds: [],
    likeCount: 2,
    commentCount: 3,
    createdAt: 123456
  }
  if (patch.canaries) injectCanaries(value)
  return Object.assign(value, patch, { canaries: undefined })
}

function approvedSnapshot() {
  return {
    version: 1,
    hero: { label: 'Hero', seat: 1, position: 'BTN', cards: ['As', 'Kd'], stackBb: 100 },
    players: [{ label: '夜鸦', seat: 2, position: 'BB', stackBb: 80 }],
    board: { flop: ['2c', '7d', 'Th'], turn: ['Js'], river: [] },
    actions: [{ street: 'preflop', actor: 'Hero', type: 'raise', amountBb: 2.5 }],
    effectiveStackBb: 80,
    potBb: 6.5,
    allInPotBb: 0,
    showdown: [{ actor: 'Hero', cards: ['As', 'Kd'] }]
  }
}

function injectCanaries(value) {
  value.ownerOpenId = 'CANARY_SHARE_OPENID'
  value.targetUserIds = ['CANARY_TARGET']
  value.publisherSnapshot = { nickname: '老王', avatarFileId: 'CANARY_AVATAR_FILE', note: 'CANARY_PUBLISHER_NOTE' }
  Object.assign(value.snapshot.hero, { playerName: 'CANARY_PLAYER_NAME', profit: 'CANARY_PROFIT', note: 'CANARY_HERO_NOTE' })
  Object.assign(value.snapshot.players[0], { leakTags: ['CANARY_LEAK'], currentProfit: 'CANARY_CURRENT_PROFIT' })
  Object.assign(value.snapshot.board, { sessionId: 'CANARY_SESSION' })
  Object.assign(value.snapshot.actions[0], { buyIn: 'CANARY_BUYIN', cashOut: 'CANARY_CASHOUT', venue: 'CANARY_VENUE' })
  value.snapshot.showdown[0].voiceExtract = 'CANARY_VOICE'
  value.snapshot.aiReview = 'CANARY_AI'
  value.snapshot.sourceHandId = 'CANARY_SOURCE_HAND'
}

const PRIVATE_CANARY_VALUES = [
  'CANARY_SHARE_OPENID', 'CANARY_TARGET', 'CANARY_AVATAR_FILE', 'CANARY_PUBLISHER_NOTE',
  'CANARY_PLAYER_NAME', 'CANARY_PROFIT', 'CANARY_HERO_NOTE', 'CANARY_LEAK',
  'CANARY_CURRENT_PROFIT', 'CANARY_SESSION', 'CANARY_BUYIN', 'CANARY_CASHOUT',
  'CANARY_VENUE', 'CANARY_VOICE', 'CANARY_AI', 'CANARY_SOURCE_HAND',
  'CANARY_PROFILE_NOTE', 'CANARY_PROFILE_LEAK', 'CANARY_PROFILE_OPENID',
  'CANARY_HAND_NOTE', 'CANARY_HAND_OPENID'
]

function expectedDetail(shareId, scope, isMine) {
  return {
    shareId,
    publisher: { socialUserId: 'su-publisher', nickname: '老王', avatarUrl: 'https://signed.example/cloud%3A%2F%2Favatar-publisher', avatarText: 'p' },
    scope,
    scopeLabel: { square: '广场', friends: '全部好友', selected: '指定好友' }[scope],
    handSnapshot: approvedSnapshot(),
    likedByMe: false,
    likeCount: 2,
    commentCount: 3,
    createdAt: 123456,
    isMine,
    canModerateComments: false
  }
}

async function expectReadable(ctx, openId, shareId, isMine) {
  const result = await ctx.app.handle({
    action: 'get_hand_share', shareId,
    viewerId: 'su-publisher', publisherId: 'su-stranger', friendIds: ['su-publisher']
  }, { openId })
  assert.equal(result.code, 0, `${openId} should read ${shareId}: ${JSON.stringify(result)}`)
  assert.equal(result.data.shareId, shareId)
  assert.equal(result.data.isMine, isMine)
}

async function expectUnavailable(ctx, openId, shareId) {
  const result = await ctx.app.handle({ action: 'get_hand_share', shareId }, { openId })
  assert.deepEqual(result, { code: 'CONTENT_UNAVAILABLE', data: null, message: 'content unavailable', requestId: 'request-detail' })
}

function assertExactKeys(value, keys) {
  assert.deepEqual(Object.keys(value).sort(), keys.slice().sort())
}

function assertExactSnapshot(value) {
  assertExactKeys(value, ['version', 'hero', 'players', 'board', 'actions', 'effectiveStackBb', 'potBb', 'allInPotBb', 'showdown'])
  assertExactKeys(value.hero, ['label', 'seat', 'position', 'cards', 'stackBb'])
  value.players.forEach(item => assertExactKeys(item, ['label', 'seat', 'position', 'stackBb']))
  assertExactKeys(value.board, ['flop', 'turn', 'river'])
  value.actions.forEach(item => assertExactKeys(item, ['street', 'actor', 'type', 'amountBb']))
  value.showdown.forEach(item => assertExactKeys(item, ['actor', 'cards']))
}

test('action line groups streets and exposes actor, current contribution, and exact post-action pot', async () => {
  const dto = expectedDetail('share-action-line', 'square', false)
  dto.handSnapshot.players[0].label = '银狼'
  dto.handSnapshot.actions = [
    { street: 'preflop', actor: '银狼', type: 'raise', amountBb: 2.5 },
    { street: 'preflop', actor: 'Hero', type: 'call', amountBb: 2.5 },
    { street: 'flop', actor: 'Hero', type: 'bet', amountBb: 10 },
    { street: 'flop', actor: '银狼', type: 'fold', amountBb: 0 }
  ]
  dto.handSnapshot.potBb = 16.5
  const loaded = loadDetailPage({ responses: [dto] })
  try {
    const page = createInstance(loaded.definition)
    await page.onLoad({ shareId: 'share-action-line' })
    assert.deepEqual(page.data.actionTimeline.map(item => ({
      streetStart: item.streetStart,
      streetLabel: item.streetLabel,
      actor: item.actor,
      actorPosition: item.actorPosition,
      typeLabel: item.typeLabel,
      amountLabel: item.amountLabel,
      potAfterLabel: item.potAfterLabel
    })), [
      { streetStart: true, streetLabel: '翻前', actor: '银狼', actorPosition: 'BB', typeLabel: '加注', amountLabel: '2.5 BB', potAfterLabel: '4 BB' },
      { streetStart: false, streetLabel: '翻前', actor: 'Hero', actorPosition: 'BTN', typeLabel: '跟注', amountLabel: '2.5 BB', potAfterLabel: '6.5 BB' },
      { streetStart: true, streetLabel: '翻牌', actor: 'Hero', actorPosition: 'BTN', typeLabel: '下注', amountLabel: '10 BB', potAfterLabel: '16.5 BB' },
      { streetStart: false, streetLabel: '翻牌', actor: '银狼', actorPosition: 'BB', typeLabel: '弃牌', amountLabel: '', potAfterLabel: '16.5 BB' }
    ])
    const wxml = fs.readFileSync(detailWxml, 'utf8')
    const wxss = fs.readFileSync(detailWxss, 'utf8')
    assert.match(wxml, /行动后底池/)
    assert.match(wxml, /class="action-position">\{\{item\.actorPosition\}\}<\/text>/)
    assert.match(wxml, /class="comment-action reply-action"[^>]*>回复<\/view>/)
    assert.match(wxss, /\.reply-action\s*\{[^}]*border:/s)
  } finally { loaded.restore() }
})

function loadDetailPage(options = {}) {
  assert.equal(fs.existsSync(detailJs), true, 'Task 4 detail page is not implemented')
  let definition
  const responses = (options.responses || [expectedDetail('share-default', 'square', false)]).slice()
  const calls = { detail: [], localData: 0, navigation: [], toast: [] }
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (parent && /pages[\\/]social-hand-detail[\\/]social-hand-detail\.js$/.test(parent.filename || '')) {
      if (request === '../../services/social-service') return {
        async getHandShare(shareId) {
          calls.detail.push(shareId)
          const value = responses.shift()
          if (value instanceof Error) throw value
          return await value
        },
        async getMySocialProfile() { return { socialUserId: 'su-viewer' } },
        async listComments() { return { items: [], nextCursor: null } }
      }
      if (request === '../../services/data-service' || request === '../../services/cloud-repo' || request.includes('social-cache')) {
        calls.localData += 1
        return new Proxy({}, { get() { calls.localData += 1; throw new Error('detail must not trust local poker data or feed cache') } })
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  global.Page = value => { definition = value }
  global.wx = {
    navigateTo(input) { calls.navigation.push(input) },
    showToast(input) { calls.toast.push(input) }
  }
  const resolved = require.resolve(detailJs)
  delete require.cache[resolved]
  try { require(resolved) } finally { Module._load = originalLoad; delete global.Page }
  return {
    definition, calls, responses,
    restore() { delete require.cache[resolved]; delete global.wx }
  }
}

function createInstance(definition) {
  const instance = {
    data: JSON.parse(JSON.stringify(definition.data || {})),
    _patches: [],
    setData(patch) { this._patches.push(patch); Object.assign(this.data, patch) }
  }
  Object.assign(instance, definition)
  return instance
}

function typedError(code) {
  return Object.assign(new Error(code), { code })
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
