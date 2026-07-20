const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

const root = path.join(__dirname, '..')
const pagePath = path.join(root, 'pages', 'social-hand-detail', 'social-hand-detail.js')
const pageWxml = fs.readFileSync(path.join(root, 'pages', 'social-hand-detail', 'social-hand-detail.wxml'), 'utf8')

test('publisher management UI exposes scope editing and whole-share withdrawal only for server-authorized owner state', () => {
  assert.match(pageWxml, /wx:if="\{\{detail\.isMine\}\}"[^>]*class="share-owner-tools"/)
  assert.match(pageWxml, /data-scope="square"/)
  assert.match(pageWxml, /data-scope="friends"/)
  assert.match(pageWxml, /data-scope="selected"/)
  assert.match(pageWxml, /bindtap="withdrawShare"/)
  assert.match(pageWxml, /撤回后，手牌、评论和点赞将不再展示|撤回分享/)
})

test('owner can choose selected friends, confirms the permission change, and reloads authoritative detail', async () => {
  const loaded = loadPage()
  try {
    const page = createInstance(loaded.definition)
    page._detailAttached = true
    page._detailVisible = true
    page._detailGeneration = 1
    page.setData({ status: 'ready', shareId: 'share-1', detail: detail('friends', true) })
    await page.openShareManagement()
    await page.changeManageScope({ currentTarget: { dataset: { scope: 'selected' } } })
    assert.equal(page.data.manageFriends.length, 2)
    page.toggleManageTarget({ currentTarget: { dataset: { id: 'su-a' } } })
    await page.saveShareScope()
    assert.deepEqual(loaded.calls.update[0].targetUserIds, ['su-a'])
    assert.equal(loaded.calls.update[0].scope, 'selected')
    assert.equal(loaded.calls.update[0].publicShareConfirmed, false)
    assert.equal(loaded.calls.modals[0].title, '确认修改发布范围？')
    assert.equal(page.data.detail.scope, 'selected')
  } finally { loaded.restore() }
})

test('changing a private share to square requires the explicit public warning and withdrawal closes access immediately', async () => {
  const loaded = loadPage()
  try {
    const page = createInstance(loaded.definition)
    page._detailAttached = true
    page._detailVisible = true
    page._detailGeneration = 1
    page.setData({ status: 'ready', shareId: 'share-1', detail: detail('friends', true) })
    await page.openShareManagement()
    await page.changeManageScope({ currentTarget: { dataset: { scope: 'square' } } })
    await page.saveShareScope()
    assert.equal(loaded.calls.update[0].publicShareConfirmed, true)
    assert.match(loaded.calls.modals[0].content, /非好友也可以查看、点赞和评论/)
    await page.openShareManagement()
    await page.withdrawShare()
    assert.equal(loaded.calls.withdraw[0].shareId, 'share-1')
    assert.equal(page.data.status, 'unavailable')
    assert.equal(page.data.detail, null)
  } finally { loaded.restore() }
})

test('a scope confirmation cannot write after the detail page is hidden', async () => {
  const loaded = loadPage({ deferModals: true })
  try {
    const page = createInstance(loaded.definition)
    page._detailAttached = true
    page._detailVisible = true
    page._detailGeneration = 1
    page.setData({ status: 'ready', shareId: 'share-1', detail: detail('friends', true) })
    await page.openShareManagement()
    await page.changeManageScope({ currentTarget: { dataset: { scope: 'square' } } })
    const pending = page.saveShareScope()
    page.onHide()
    loaded.calls.modals[0].success({ confirm: true, cancel: false })
    await pending
    assert.equal(loaded.calls.update.length, 0)
  } finally { loaded.restore() }
})

function detail(scope, isMine) {
  return {
    shareId: 'share-1',
    publisher: { socialUserId: 'su-owner', nickname: '老王', avatarUrl: '', avatarText: '王' },
    scope,
    scopeLabel: { square: '广场', friends: '全部好友', selected: '指定好友' }[scope],
    handSnapshot: {
      version: 1,
      hero: { label: 'Hero', seat: 1, position: 'BTN', cards: ['As', 'Kd'] },
      players: [],
      board: { flop: [], turn: [], river: [] },
      actions: [],
      showdown: []
    },
    likedByMe: false,
    likeCount: 0,
    commentCount: 0,
    createdAt: 100,
    isMine,
    canModerateComments: false
  }
}

function loadPage(options = {}) {
  let definition
  let currentScope = 'friends'
  const calls = { update: [], withdraw: [], modals: [], toasts: [] }
  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (parent && /pages[\\/]social-hand-detail[\\/]social-hand-detail\.js$/.test(parent.filename || '')) {
      if (request === '../../services/social-service') return {
        async listFriends() { return { items: [{ socialUserId: 'su-a', nickname: '甲', avatarText: '甲' }, { socialUserId: 'su-b', nickname: '乙', avatarText: '乙' }], nextOffset: null } },
        async updateHandShareScope(input) { calls.update.push(input); currentScope = input.scope; return { shareId: input.shareId, scope: input.scope } },
        async withdrawHandShare(input) { calls.withdraw.push(input); return { shareId: input.shareId, status: 'withdrawn' } },
        async getHandShare() { return detail(currentScope, true) },
        async getMySocialProfile() { return { socialUserId: 'su-owner' } },
        async listComments() { return { items: [], nextCursor: null } }
      }
      if (request === '../../utils/social-mutation') return { createMutationId(prefix) { return prefix + '-mutation' } }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  global.Page = value => { definition = value }
  global.wx = {
    showModal(input) {
      calls.modals.push(input)
      if (!options.deferModals) input.success({ confirm: true, cancel: false })
    },
    showToast(input) { calls.toasts.push(input) }
  }
  delete require.cache[require.resolve(pagePath)]
  try { require(pagePath) } finally { Module._load = originalLoad; delete global.Page }
  return { definition, calls, restore() { delete require.cache[require.resolve(pagePath)]; delete global.wx } }
}

function createInstance(definition) {
  const instance = {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch) }
  }
  Object.assign(instance, definition)
  return instance
}
