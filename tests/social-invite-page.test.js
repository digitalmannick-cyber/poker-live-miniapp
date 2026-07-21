const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const appConfig = require('../app.json')
const invitePagePath = path.join(root, 'pages', 'social-invite', 'social-invite.js')
const inviteWxmlPath = path.join(root, 'pages', 'social-invite', 'social-invite.wxml')
const playerNotesPath = path.join(root, 'pages', 'player-notes', 'player-notes.js')
const playerNotesWxmlPath = path.join(root, 'pages', 'player-notes', 'player-notes.wxml')

function setByPath(target, key, value) {
  const keys = String(key).split('.')
  let cursor = target
  keys.slice(0, -1).forEach(part => {
    cursor[part] = cursor[part] || {}
    cursor = cursor[part]
  })
  cursor[keys.at(-1)] = value
}

function createPage(config) {
  const page = Object.assign({}, config, {
    data: JSON.parse(JSON.stringify(config.data || {})),
    setData(patch) {
      Object.keys(patch || {}).forEach(key => setByPath(this.data, key, patch[key]))
    }
  })
  Object.keys(config).forEach(key => {
    if (typeof config[key] === 'function') page[key] = config[key].bind(page)
  })
  return page
}

function loadInvitePage() {
  let pageConfig = null
  global.Page = config => { pageConfig = config }
  delete require.cache[require.resolve('../pages/social-invite/social-invite.js')]
  require('../pages/social-invite/social-invite.js')
  return createPage(pageConfig)
}

test('invitation route and the minimal player-library entry are registered without replacing the library structure', () => {
  const inviteJs = fs.readFileSync(invitePagePath, 'utf8')
  const inviteWxml = fs.readFileSync(inviteWxmlPath, 'utf8')
  const playerNotesJs = fs.readFileSync(playerNotesPath, 'utf8')
  const playerNotesWxml = fs.readFileSync(playerNotesWxmlPath, 'utf8')

  assert.ok(appConfig.pages.includes('pages/social-invite/social-invite'))
  assert.match(inviteJs, /onShareAppMessage/)
  assert.match(inviteJs, /sendFriendRequest/)
  assert.match(inviteJs, /searchUsers/)
  assert.match(inviteJs, /sendFriendRequestByUser/)
  assert.match(inviteWxml, /发送好友申请/)
  assert.match(inviteWxml, /个人邀请小程序码/)
  assert.match(inviteWxml, /小程序码暂不可用/)
  assert.match(inviteWxml, /<button[^>]+open-type="share"/, '微信分享入口应使用原生分享按钮')
  assert.doesNotMatch(inviteJs, /ownerOpenId|_openid|privatePlayerId|avatarFileId/)
  assert.match(playerNotesJs, /openInvite\(\)/)
  assert.match(playerNotesJs, /pages\/social-invite\/social-invite/)
  assert.match(playerNotesWxml, /bindtap="openCreate"/)
  assert.match(playerNotesWxml, /bindtap="openInvite"/)
  assert.match(playerNotesWxml, /player-list/)
})

test('my invite creates share and QR assets with object payloads, and only shares a successfully fetched token', async () => {
  const socialService = require('../services/social-service')
  const original = {
    createInvite: socialService.createInvite,
    createInviteQr: socialService.createInviteQr,
    inspectInvite: socialService.inspectInvite,
    sendFriendRequest: socialService.sendFriendRequest
  }
  const calls = []
  const menuCalls = []
  global.wx = {
    showToast() {},
    hideShareMenu() { menuCalls.push('hide') },
    showShareMenu(input) { menuCalls.push(input) }
  }
  socialService.createInvite = async input => { calls.push({ action: 'createInvite', input }); return { token: 'token_A-B', expiresAt: 1 } }
  socialService.createInviteQr = async input => { calls.push({ action: 'createInviteQr', input }); return { qrCodeUrl: 'https://temp.example/invite.png' } }
  socialService.inspectInvite = async input => { calls.push({ action: 'inspectInvite', input }); return { inviter: { nickname: '老王' } } }

  try {
    const page = loadInvitePage()
    assert.equal(page.onShareAppMessage(), undefined)
    await page.onLoad({})

    assert.equal(page.data.inviteToken, 'token_A-B')
    assert.equal(page.data.qrCodeUrl, 'https://temp.example/invite.png')
    assert.equal(page.data.status, 'ready')
    assert.deepEqual(calls.map(call => call.action), ['createInvite', 'createInviteQr'])
    assert.ok(calls.every(call => typeof call.input.clientMutationId === 'string' && call.input.clientMutationId))
    assert.equal(calls[1].input.token, 'token_A-B')
    assert.deepEqual(menuCalls, ['hide', { menus: ['shareAppMessage'] }])
    assert.deepEqual(page.onShareAppMessage(), {
      title: page.data.shareTitle,
      path: '/pages/social-invite/social-invite?token=token_A-B'
    })
    assert.doesNotMatch(page.onShareAppMessage().path, /openid|private|owner/i)
  } finally {
    Object.assign(socialService, original)
    delete global.Page
  }
})

test('native share menu stays hidden until a valid invite is ready', async () => {
  const socialService = require('../services/social-service')
  const original = { createInvite: socialService.createInvite, createInviteQr: socialService.createInviteQr, inspectInvite: socialService.inspectInvite }
  const menuCalls = []
  global.wx = {
    showToast() {},
    hideShareMenu() { menuCalls.push('hide') },
    showShareMenu(input) { menuCalls.push(input) }
  }
  socialService.createInvite = async () => {
    const error = new Error('network')
    error.code = 'NETWORK_ERROR'
    throw error
  }

  try {
    const page = loadInvitePage()
    await page.onLoad({})
    assert.deepEqual(menuCalls, ['hide'])
    assert.equal(page.onShareAppMessage(), undefined)
    assert.equal(page.data.status, 'error')
  } finally {
    Object.assign(socialService, original)
    delete global.Page
  }
})

test('failed friend request stays retryable on the landing card', async () => {
  const socialService = require('../services/social-service')
  const original = { inspectInvite: socialService.inspectInvite, sendFriendRequest: socialService.sendFriendRequest }
  const menuCalls = []
  global.wx = {
    showToast() {},
    hideShareMenu() { menuCalls.push('hide') },
    showShareMenu(input) { menuCalls.push(input) }
  }
  socialService.inspectInvite = async () => ({ inviter: { nickname: '老王' } })
  socialService.sendFriendRequest = async () => {
    const error = new Error('network')
    error.code = 'NETWORK_ERROR'
    throw error
  }

  try {
    const page = loadInvitePage()
    await page.onLoad({ token: 'token_A-B' })
    await page.sendFriendRequest()
    assert.equal(page.data.status, 'ready')
    assert.match(page.data.loginError, /未发送成功/)
    assert.notEqual(menuCalls.at(-1), 'hide')
  } finally {
    Object.assign(socialService, original)
    delete global.Page
  }
})

test('landing links decode safely, inspect before applying, and prevent duplicate friend requests', async () => {
  const socialService = require('../services/social-service')
  const original = {
    createInvite: socialService.createInvite,
    createInviteQr: socialService.createInviteQr,
    inspectInvite: socialService.inspectInvite,
    sendFriendRequest: socialService.sendFriendRequest
  }
  const calls = []
  let resolveRequest
  global.wx = { showToast() {}, hideShareMenu() {}, showShareMenu() {} }
  socialService.inspectInvite = async input => { calls.push({ action: 'inspectInvite', input }); return { inviter: { nickname: '阿强', title: '银狼' }, expiresAt: 7 } }
  socialService.sendFriendRequest = async input => {
    calls.push({ action: 'sendFriendRequest', input })
    return new Promise(resolve => { resolveRequest = resolve })
  }

  try {
    const page = loadInvitePage()
    await page.onLoad({ scene: 'token%5FA%2DB' })
    assert.equal(page.data.inviteToken, 'token_A-B')
    assert.deepEqual(calls[0], { action: 'inspectInvite', input: { token: 'token_A-B' } })
    assert.equal(page.data.inviter.nickname, '阿强')

    const first = page.sendFriendRequest()
    const second = page.sendFriendRequest()
    assert.equal(calls.filter(call => call.action === 'sendFriendRequest').length, 1)
    const request = calls.find(call => call.action === 'sendFriendRequest').input
    assert.equal(request.token, 'token_A-B')
    assert.ok(request.clientMutationId.startsWith('friend_request_'))
    resolveRequest({ friendshipId: 'fr_1', status: 'pending' })
    await Promise.all([first, second])
    assert.equal(page.data.status, 'sent')
    assert.equal(page.data.submitting, false)

    await page.onLoad({ scene: '%' })
    assert.equal(page.data.inviteToken, '%')
  } finally {
    Object.assign(socialService, original)
    delete global.Page
  }
})

test('my invite searches public nicknames and sends a direct friend request once', async () => {
  const socialService = require('../services/social-service')
  const original = {
    createInvite: socialService.createInvite,
    createInviteQr: socialService.createInviteQr,
    searchSocialUsers: socialService.searchSocialUsers,
    sendFriendRequestByUser: socialService.sendFriendRequestByUser
  }
  const calls = []
  global.wx = { showToast(input) { calls.push({ action: 'toast', input }) }, hideShareMenu() {}, showShareMenu() {} }
  socialService.createInvite = async () => ({ token: 'search-token' })
  socialService.createInviteQr = async () => ({ qrCodeUrl: 'https://temp/qr.png' })
  socialService.searchSocialUsers = async keyword => {
    calls.push({ action: 'search', keyword })
    return { items: [{ socialUserId: 'su-b', nickname: '银狼玩家', avatarText: '银', title: '牌桌常客', relationshipStatus: 'none', canRequest: true }] }
  }
  socialService.sendFriendRequestByUser = async input => {
    calls.push({ action: 'add', input })
    return { friendshipId: 'fr-ab', status: 'pending' }
  }

  try {
    const page = loadInvitePage()
    await page.onLoad({})
    page.onSearchInput({ detail: { value: '银狼' } })
    await page.searchUsers()
    assert.equal(page.data.searchResults[0].actionLabel, '添加')
    await page.addSearchedUser({ currentTarget: { dataset: { id: 'su-b' } } })
    assert.equal(page.data.searchResults[0].actionLabel, '已申请')
    assert.equal(page.data.searchResults[0].canRequest, false)
    assert.equal(calls.find(call => call.action === 'search').keyword, '银狼')
    assert.equal(calls.filter(call => call.action === 'add').length, 1)
    assert.equal(calls.find(call => call.action === 'add').input.targetUserId, 'su-b')
    assert.match(calls.find(call => call.action === 'add').input.clientMutationId, /^friend_request_search_/)
  } finally {
    Object.assign(socialService, original)
    delete global.Page
    delete global.wx
  }
})

test('a first-time invitee logs in, initializes the social profile, and continues with the same invite token', async () => {
  const socialService = require('../services/social-service')
  const dataService = require('../services/data-service')
  const socialProfileSync = require('../utils/social-profile-sync')
  const original = {
    inspectInvite: socialService.inspectInvite,
    sendFriendRequest: socialService.sendFriendRequest,
    loginWechatAccount: dataService.loginWechatAccount,
    getCurrentProfile: dataService.getCurrentProfile,
    getCurrentPlayerId: dataService.getCurrentPlayerId,
    syncSocialProfile: socialProfileSync.syncSocialProfile
  }
  const calls = []
  global.wx = { showToast() {}, hideShareMenu() {}, showShareMenu() {} }
  socialService.inspectInvite = async input => {
    calls.push({ action: 'inspect', input })
    return { inviter: { nickname: '邀请人' }, requesterProfileReady: false }
  }
  dataService.loginWechatAccount = async input => { calls.push({ action: 'login', input }); return true }
  dataService.getCurrentProfile = () => ({ playerId: 'WX-NEWUSER', name: '新玩家' })
  dataService.getCurrentPlayerId = () => 'WX-NEWUSER'
  socialProfileSync.syncSocialProfile = async (profile, options) => {
    calls.push({ action: 'profile', profile, current: options.isCurrent() })
    return { socialUserId: 'su_new' }
  }
  socialService.sendFriendRequest = async input => {
    calls.push({ action: 'request', input })
    return { friendshipId: 'fr_new', status: 'pending' }
  }

  try {
    const page = loadInvitePage()
    await page.onLoad({ token: 'first_user_token' })
    assert.equal(page.data.loginRequired, true)
    await page.sendFriendRequest()

    assert.deepEqual(calls.map(item => item.action), ['inspect', 'login', 'profile', 'request'])
    assert.deepEqual(calls[1].input, { manual: true })
    assert.equal(calls[2].current, true)
    assert.equal(calls[3].input.token, 'first_user_token')
    assert.equal(page.data.loginRequired, false)
    assert.equal(page.data.status, 'sent')
    assert.match(fs.readFileSync(inviteWxmlPath, 'utf8'), /首次使用流程[\s\S]*微信登录并发送申请/)
  } finally {
    socialService.inspectInvite = original.inspectInvite
    socialService.sendFriendRequest = original.sendFriendRequest
    dataService.loginWechatAccount = original.loginWechatAccount
    dataService.getCurrentProfile = original.getCurrentProfile
    dataService.getCurrentPlayerId = original.getCurrentPlayerId
    socialProfileSync.syncSocialProfile = original.syncSocialProfile
    delete global.Page
  }
})

test('a QR display failure keeps the invite shareable and explains the fallback', async () => {
  const socialService = require('../services/social-service')
  const original = { createInvite: socialService.createInvite, createInviteQr: socialService.createInviteQr }
  global.wx = { showToast() {}, hideShareMenu() {}, showShareMenu() {} }
  socialService.createInvite = async () => ({ token: 'share_still_ready' })
  socialService.createInviteQr = async () => {
    const error = new Error('qr unavailable')
    error.code = 'QR_UNAVAILABLE'
    throw error
  }

  try {
    const page = loadInvitePage()
    await page.onLoad({})
    assert.equal(page.data.status, 'ready')
    assert.equal(page.data.qrUnavailable, true)
    assert.match(page.onShareAppMessage().path, /token=share_still_ready/)
    assert.match(fs.readFileSync(inviteWxmlPath, 'utf8'), /小程序码暂不可用/)
  } finally {
    Object.assign(socialService, original)
    delete global.Page
  }
})

test('expired invite errors are recoverable in the page state', async () => {
  const socialService = require('../services/social-service')
  const original = socialService.inspectInvite
  global.wx = { showToast() {}, hideShareMenu() {}, showShareMenu() {} }
  socialService.inspectInvite = async () => {
    const error = new Error('expired')
    error.code = 'INVALID_INVITE'
    throw error
  }

  try {
    const page = loadInvitePage()
    await page.onLoad({ token: 'expired_token' })
    assert.equal(page.data.status, 'expired')
    assert.match(page.data.errorMessage, /失效/)
    assert.equal(page.data.loading, false)
  } finally {
    socialService.inspectInvite = original
    delete global.Page
  }
})
