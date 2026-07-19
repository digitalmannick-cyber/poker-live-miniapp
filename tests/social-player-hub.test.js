const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const root = path.join(__dirname, '..')
const pageWxml = fs.readFileSync(path.join(root, 'pages', 'player-notes', 'player-notes.wxml'), 'utf8')

test('player tab keeps the library list and exposes the friends / library hierarchy', () => {
  const friendHubWxml = fs.readFileSync(path.join(root, 'components', 'friend-hub', 'friend-hub.wxml'), 'utf8')
  assert.match(pageWxml, /好友[\s\S]*玩家库/)
  assert.match(pageWxml, /player-notes-title">玩家<\//)
  assert.match(pageWxml, /player-list/)
  assert.match(friendHubWxml, /动态[\s\S]*好友[\s\S]*排行榜/)
  assert.match(friendHubWxml, /累计时长/)
  assert.match(friendHubWxml, /手牌数/)
  assert.match(friendHubWxml, /玩家类型/)
  assert.match(friendHubWxml, /Leak/)
  assert.match(friendHubWxml, /Note/)
})

test('friend hub merges an accepted friend snapshot with only the viewer local player note', async () => {
  let definition = null
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (parent && /components[\\/]friend-hub[\\/]friend-hub\.js$/.test(parent.filename || '')) {
      if (request === '../../services/social-service') {
        return {
          async listFriends(input) {
            assert.deepEqual(input, { offset: 0, limit: 20 })
            return {
              items: [{
                socialUserId: 'su_friend',
                nickname: 'Remote Wolf',
                avatarUrl: 'https://remote.example/wolf.png',
                avatarText: '狼',
                title: '银狼',
                statsVisible: true,
                durationMinutes: 135,
                recordedHandCount: 8,
                ownerOpenId: 'must-not-reach-ui'
              }],
              nextOffset: null
            }
          }
        }
      }
      if (request === '../../services/data-service') {
        return {
          async ensureFriendPlayerNote(snapshot) {
            assert.equal(snapshot.socialUserId, 'su_friend')
            return {
              _id: 'note_friend',
              sourceKind: 'friend',
              linkedFriendUserId: 'su_friend',
              name: '桌上银狼',
              avatarUrl: 'wxfile://local-wolf.png',
              avatarText: '银',
              type: '常客',
              typeColor: '#ffd447',
              leakTags: ['跟注过宽'],
              note: '河牌少诈唬',
              battleHandIds: ['h1', 'h2']
            }
          }
        }
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  global.Component = config => { definition = config }
  const componentPath = require.resolve('../components/friend-hub/friend-hub')
  delete require.cache[componentPath]
  try {
    require(componentPath)
  } finally {
    Module._load = originalLoad
    delete global.Component
  }

  const instance = {
    data: Object.assign({}, definition.data),
    setData(patch) { Object.assign(this.data, patch) },
    triggerEvent() {}
  }
  Object.assign(instance, definition.methods)
  await instance.loadFriends()

  assert.equal(instance.data.status, 'ready')
  assert.equal(instance.data.friends.length, 1)
  assert.deepEqual(instance.data.friends[0], {
    friendUserId: 'su_friend',
    friendshipId: '',
    name: '桌上银狼',
    avatarUrl: 'wxfile://local-wolf.png',
    avatarText: '银',
    type: '常客',
    typeColor: '#ffd447',
    leakTags: [{ label: '跟注过宽' }],
    notePreview: '河牌少诈唬',
    battleHandCount: 2,
    battleHandLabel: '2 手对战',
    title: '银狼',
    statsVisible: true,
    durationLabel: '2.3h',
    handCountLabel: '8 手',
    cardColor: '#ffd447',
    rowStyle: '--player-card-color: #ffd447; border-color: #ffd447;',
    colorStyle: 'background: #ffd447;',
    typeStyle: 'background: #ffd447;'
  })
  assert.equal(JSON.stringify(instance.data.friends).includes('ownerOpenId'), false)
})

test('friend hub appends all offset pages without duplicate friends and exposes retryable load-more state', async () => {
  let definition = null
  const requestedOffsets = []
  let failSecondPageOnce = true
  const remoteFriends = Array.from({ length: 45 }, (_, index) => ({
    socialUserId: 'su_' + String(index + 1).padStart(2, '0'),
    nickname: 'Friend ' + (index + 1),
    statsVisible: true
  }))
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (parent && /components[\\/]friend-hub[\\/]friend-hub\.js$/.test(parent.filename || '')) {
      if (request === '../../services/social-service') return {
        async listFriends(input) {
          requestedOffsets.push(input.offset)
          if (input.offset === 20 && failSecondPageOnce) {
            failSecondPageOnce = false
            throw new Error('temporary network error')
          }
          const items = remoteFriends.slice(input.offset, input.offset + input.limit)
          return { items, nextOffset: input.offset + items.length < remoteFriends.length ? input.offset + items.length : null }
        }
      }
      if (request === '../../services/data-service') return { async ensureFriendPlayerNote(remote) { return { _id: 'note_' + remote.socialUserId, name: remote.nickname, type: '未分类', typeColor: '#8891a7', leakTags: [], note: '', battleHandIds: [] } } }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  global.Component = config => { definition = config }
  const componentPath = require.resolve('../components/friend-hub/friend-hub')
  delete require.cache[componentPath]
  try { require(componentPath) } finally { Module._load = originalLoad; delete global.Component }
  assert.ok(definition.lifetimes && definition.lifetimes.attached, 'friend hub must track its attachment lifecycle')
  const instance = { data: Object.assign({}, definition.data), setData(patch) { Object.assign(this.data, patch) }, triggerEvent() {} }
  Object.assign(instance, definition.methods)
  definition.lifetimes.attached.call(instance)
  await instance.loadFriends()
  await instance.loadMoreFriends()
  await instance.loadMoreFriends()
  assert.equal(instance.data.loadMoreError, '', 'the retry should clear the recoverable load-more error')
  await instance.loadMoreFriends()
  assert.deepEqual(requestedOffsets, [0, 20, 20, 40])
  assert.equal(instance.data.friends.length, 45)
  assert.equal(new Set(instance.data.friends.map(item => item.friendUserId)).size, 45)
  assert.deepEqual(instance.data.friends.map(item => item.friendUserId), remoteFriends.map(item => item.socialUserId))
  assert.equal(instance.data.nextOffset, null)
})

test('friend hub ignores stale responses after a forced refresh and after detach', async () => {
  let definition = null
  const resolvers = []
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (parent && /components[\\/]friend-hub[\\/]friend-hub\.js$/.test(parent.filename || '')) {
      if (request === '../../services/social-service') return { listFriends() { return new Promise(resolve => resolvers.push(resolve)) } }
      if (request === '../../services/data-service') return { async ensureFriendPlayerNote(remote) { return { _id: remote.socialUserId, name: remote.nickname, type: '未分类', typeColor: '#8891a7', leakTags: [], note: '', battleHandIds: [] } } }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  global.Component = config => { definition = config }
  const componentPath = require.resolve('../components/friend-hub/friend-hub')
  delete require.cache[componentPath]
  try { require(componentPath) } finally { Module._load = originalLoad; delete global.Component }
  assert.ok(definition.lifetimes && definition.lifetimes.attached && definition.lifetimes.detached, 'friend hub must invalidate requests when detached')
  const instance = { data: Object.assign({}, definition.data), setData(patch) { Object.assign(this.data, patch) }, triggerEvent() {} }
  Object.assign(instance, definition.methods)
  definition.lifetimes.attached.call(instance)
  const first = instance.loadFriends()
  const forced = instance.loadFriends(true)
  resolvers[0]({ items: [{ socialUserId: 'su_old', nickname: 'Old', statsVisible: true }], nextOffset: null })
  resolvers[1]({ items: [{ socialUserId: 'su_new', nickname: 'New', statsVisible: true }], nextOffset: null })
  await Promise.all([first, forced])
  assert.deepEqual(instance.data.friends.map(item => item.friendUserId), ['su_new'])

  const detached = instance.loadFriends(true)
  definition.lifetimes.detached.call(instance)
  resolvers[2]({ items: [{ socialUserId: 'su_after_detach', nickname: 'Detached', statsVisible: true }], nextOffset: null })
  await detached
  assert.deepEqual(instance.data.friends.map(item => item.friendUserId), ['su_new'])
})

test('friend hub hides statistics when the friend disables visibility and emits friend/message events', async () => {
  let definition = null
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (parent && /components[\\/]friend-hub[\\/]friend-hub\.js$/.test(parent.filename || '')) {
      if (request === '../../services/social-service') return { async listFriends() { return { items: [{ socialUserId: 'su_hidden', nickname: 'Hidden', statsVisible: false, title: '隐者' }], nextOffset: null } } }
      if (request === '../../services/data-service') return { async ensureFriendPlayerNote() { return { _id: 'note_hidden', name: 'Local hidden', type: '未分类', typeColor: '#8891a7', leakTags: [], note: '', battleHandIds: [] } } }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  global.Component = config => { definition = config }
  const componentPath = require.resolve('../components/friend-hub/friend-hub')
  delete require.cache[componentPath]
  try {
    require(componentPath)
  } finally {
    Module._load = originalLoad
    delete global.Component
  }
  const events = []
  const instance = {
    data: Object.assign({}, definition.data),
    setData(patch) { Object.assign(this.data, patch) },
    triggerEvent(name, detail) { events.push({ name, detail }) }
  }
  Object.assign(instance, definition.methods)
  await instance.loadFriends()
  assert.equal(instance.data.friends[0].durationLabel, '')
  assert.equal(instance.data.friends[0].handCountLabel, '')
  instance.openFriend({ currentTarget: { dataset: { id: 'su_hidden' } } })
  instance.openMessages()
  assert.deepEqual(events, [{ name: 'openfriend', detail: { friendUserId: 'su_hidden' } }, { name: 'openmessages', detail: {} }])
})

test('friend detail only returns an accepted relationship and rejects stale access after removal', async () => {
  const { createFriendshipHandlers, getPairId } = require('../cloudfunctions/poker_social/lib/friendship')
  const { createMemorySocialRepository } = require('./helpers/social-fixture')
  const relationshipId = getPairId('su_a', 'su_b')
  const repository = createMemorySocialRepository({
    social_users: [
      { _id: 'su_a', ownerOpenId: 'openid-a', privatePlayerId: 'WX-A', profile: { nickname: 'A' } },
      { _id: 'su_b', ownerOpenId: 'openid-b', privatePlayerId: 'WX-B', profile: { nickname: 'B', avatarFileId: 'private-b' }, title: '银狼', statsVisible: true, durationMinutes: 999, recordedHandCount: 88 }
    ],
    social_friendships: [{ _id: relationshipId, userA: 'su_a', userB: 'su_b', status: 'accepted', profileSnapshots: { su_b: { nickname: 'B at acceptance', avatarFileId: 'b-snapshot' } } }]
  })
  const handlers = createFriendshipHandlers(repository, { avatarUrl: async fileId => 'https://temp/' + fileId })
  const detail = await handlers.get_friend_detail({ friendUserId: 'su_b' }, { ownerOpenId: 'openid-a' })
  assert.deepEqual(detail, {
    friendshipId: relationshipId,
    socialUserId: 'su_b',
    nickname: 'B at acceptance',
    avatarUrl: 'https://temp/b-snapshot',
    avatarText: 'B',
    title: '银狼',
    statsVisible: true,
    durationMinutes: 999,
    recordedHandCount: 88,
    acceptedAt: 0
  })
  assert.equal(JSON.stringify(detail).match(/ownerOpenId|privatePlayerId|avatarFileId|profit|currentProfit|buyIn|cashOut/), null)
  repository.set('social_users', 'su_b', {
    _id: 'su_b',
    ownerOpenId: 'openid-b',
    privatePlayerId: 'WX-B',
    profile: { nickname: 'B', avatarFileId: 'private-b' },
    title: '银狼',
    statsVisible: false,
    durationMinutes: 999,
    recordedHandCount: 88,
    currentProfit: 999999
  })
  const hiddenStats = await handlers.get_friend_detail({ friendUserId: 'su_b' }, { ownerOpenId: 'openid-a' })
  assert.equal(hiddenStats.statsVisible, false)
  assert.equal(Object.prototype.hasOwnProperty.call(hiddenStats, 'durationMinutes'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(hiddenStats, 'recordedHandCount'), false)
  assert.equal(JSON.stringify(hiddenStats).includes('currentProfit'), false)
  repository.set('social_friendships', relationshipId, { _id: relationshipId, userA: 'su_a', userB: 'su_b', status: 'removed' })
  await assert.rejects(
    handlers.get_friend_detail({ friendUserId: 'su_b' }, { ownerOpenId: 'openid-a' }),
    error => error.code === 'FORBIDDEN'
  )
})

test('player page defaults to feed, loads friends only after the secondary switch, and explicitly filters the library', async () => {
  let pageDefinition = null
  const calls = []
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (parent && /pages[\\/]player-notes[\\/]player-notes\.js$/.test(parent.filename || '')) {
      if (request === '../../services/data-service') return {
        async getAppSettings() { return { opponentTypes: [] } },
        async getPlayerNotes(input) { calls.push(input); return [] },
        refreshOnboardingGuideContext() {}
      }
      if (request === '../../utils/tab-bar') return { syncCustomTabBar() {} }
      if (request === '../../utils/player-avatar-cache') return { getAvatarDisplayUrl() { return '' }, warmPlayerAvatars() {} }
      if (request === '../../utils/onboarding-guide') return { getStepForRoute() { return null }, advanceGuide() { return { done: true } }, navigateToStep() { return false }, dismissGuide() {} }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  global.Page = config => { pageDefinition = config }
  const pagePath = require.resolve('../pages/player-notes/player-notes')
  delete require.cache[pagePath]
  try {
    require(pagePath)
  } finally {
    Module._load = originalLoad
    delete global.Page
  }
  let loaded = 0
  let firstFriendLoadFails = true
  const friendHub = {
    data: { status: 'idle' },
    async loadFriends() {
      loaded += 1
      this.data.status = firstFriendLoadFails ? 'error' : 'ready'
    }
  }
  const instance = {
    data: Object.assign({}, pageDefinition.data),
    setData(patch) { Object.assign(this.data, patch) },
    selectComponent() { return friendHub }
  }
  Object.assign(instance, pageDefinition)
  await instance.onLoad()
  assert.equal(instance.data.playerSection, 'friends')
  assert.equal(instance.data.friendSection, 'feed')
  assert.equal(loaded, 0)
  await instance.onReady()
  await instance.onShow()
  assert.equal(loaded, 0)
  await instance.selectFriendSection({ detail: { section: 'friends' } })
  assert.equal(loaded, 1)
  assert.equal(instance.data.friendsLoaded, false, 'a failed initial request must remain retryable')
  firstFriendLoadFails = false
  await instance.selectFriendSection({ detail: { section: 'friends' } })
  assert.equal(loaded, 2)
  assert.equal(instance.data.friendsLoaded, true)
  assert.equal(calls.length, 0)
  await instance.selectPlayerSection({ currentTarget: { dataset: { section: 'library' } } })
  assert.deepEqual(calls, [{ query: '', type: '', sourceKind: 'library' }])
  await instance.selectPlayerSection({ currentTarget: { dataset: { section: 'friends' } } })
  assert.equal(loaded, 2, 'already-loaded friend branch should not request again')
  await instance.onShow()
  assert.equal(loaded, 3, 'a ready friends section refreshes once on show')
})

test('player page opens the reused player detail in friend mode', () => {
  let pageDefinition = null
  global.Page = config => { pageDefinition = config }
  const pagePath = require.resolve('../pages/player-notes/player-notes')
  delete require.cache[pagePath]
  try { require(pagePath) } finally { delete global.Page }
  const calls = []
  global.wx = { navigateTo(input) { calls.push(input) } }
  try {
    pageDefinition.openFriend({ detail: { friendUserId: 'su_friend' } })
    assert.deepEqual(calls, [{ url: '/pages/player-note-detail/player-note-detail?friendUserId=su_friend' }])
  } finally {
    delete global.wx
  }
})
