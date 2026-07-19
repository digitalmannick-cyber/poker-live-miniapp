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
    socialUserId: 'su_b',
    nickname: 'B at acceptance',
    avatarUrl: 'https://temp/b-snapshot',
    avatarText: 'B',
    title: '银狼',
    statsVisible: true
  })
  assert.equal(JSON.stringify(detail).match(/ownerOpenId|privatePlayerId|avatarFileId|durationMinutes|recordedHandCount/), null)
  repository.set('social_friendships', relationshipId, { _id: relationshipId, userA: 'su_a', userB: 'su_b', status: 'removed' })
  await assert.rejects(
    handlers.get_friend_detail({ friendUserId: 'su_b' }, { ownerOpenId: 'openid-a' }),
    error => error.code === 'FORBIDDEN'
  )
})

test('player page defaults to friends, lazily loads that branch, and explicitly filters the library', async () => {
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
  const instance = {
    data: Object.assign({}, pageDefinition.data),
    setData(patch) { Object.assign(this.data, patch) },
    selectComponent() { return { async loadFriends() { loaded += 1 } } }
  }
  Object.assign(instance, pageDefinition)
  await instance.onLoad()
  assert.equal(instance.data.playerSection, 'friends')
  assert.equal(loaded, 0)
  await instance.onReady()
  assert.equal(loaded, 1)
  assert.equal(calls.length, 0)
  await instance.selectPlayerSection({ currentTarget: { dataset: { section: 'library' } } })
  assert.deepEqual(calls, [{ query: '', type: '', sourceKind: 'library' }])
  await instance.selectPlayerSection({ currentTarget: { dataset: { section: 'friends' } } })
  assert.equal(loaded, 1, 'already-loaded friend branch should not request again')
})
