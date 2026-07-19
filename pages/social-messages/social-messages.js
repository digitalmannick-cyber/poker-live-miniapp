const socialService = require('../../services/social-service')
const dataService = require('../../services/data-service')
const unreadState = require('../../utils/social-unread-state')
const notificationRoute = require('../../utils/social-notification-route')
const { createMutationId } = require('../../utils/social-mutation')

const PAGE_SIZE = 20
const CACHE_TTL_MS = 5 * 60 * 1000
const CACHE_PREFIX = 'socialNotificationsFirstPage:'
const ALLOWED_KINDS = new Set(['friend_request', 'friend_accepted', 'selected_hand', 'comment', 'reply', 'like_aggregate', 'player_card'])

function cacheKey() {
  const playerId = String(dataService.getCurrentPlayerId() || '').trim().toUpperCase()
  return playerId ? CACHE_PREFIX + encodeURIComponent(playerId) : ''
}

function whitelistActor(actor) {
  const source = actor || {}
  return {
    socialUserId: String(source.socialUserId || ''),
    nickname: String(source.nickname || ''),
    avatarUrl: String(source.avatarUrl || ''),
    avatarText: String(source.avatarText || '')
  }
}

function whitelistNotification(item) {
  const source = item || {}
  return {
    notificationId: String(source.notificationId || ''),
    kind: ALLOWED_KINDS.has(source.kind) ? source.kind : String(source.kind || ''),
    actor: whitelistActor(source.actor),
    targetType: String(source.targetType || ''),
    targetId: String(source.targetId || ''),
    aggregateCount: Math.max(0, Number(source.aggregateCount) || 0),
    actionState: String(source.actionState || ''),
    read: !!source.read,
    createdAt: source.createdAt
  }
}

function formatTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = number => String(number).padStart(2, '0')
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function displayCopy(item) {
  const actorName = String(item.actor && item.actor.nickname || '一位牌友')
  const copies = {
    friend_request: ['好友申请', `${actorName} 想添加你为好友`],
    friend_accepted: ['已成为好友', `${actorName} 接受了你的好友申请`],
    selected_hand: ['好友分享了手牌', `${actorName} 向你分享了一手牌`],
    comment: ['新的评论', `${actorName} 评论了你分享的手牌`],
    reply: ['新的回复', `${actorName} 回复了你的评论`],
    like_aggregate: ['收到点赞', `${actorName} 等 ${Math.max(1, item.aggregateCount || 1)} 人赞了你的手牌`],
    player_card: ['玩家名片', `${actorName} 向你分享了一张玩家名片`]
  }
  return copies[item.kind] || ['消息', '这条内容暂时无法打开']
}

function decorate(item) {
  const safe = whitelistNotification(item)
  const copy = displayCopy(safe)
  const actionLabels = { accepted: '已接受', rejected: '已拒绝', unavailable: '内容已不可访问' }
  return Object.assign(safe, {
    title: copy[0],
    summary: copy[1],
    timeLabel: formatTime(safe.createdAt),
    isFriendRequest: safe.kind === 'friend_request',
    canAct: safe.kind === 'friend_request' && safe.actionState === 'pending',
    actionLabel: actionLabels[safe.actionState] || '',
    unavailable: false,
    acting: false
  })
}

function isNetworkError(error) {
  return ['NETWORK_ERROR', 'CLOUD_UNAVAILABLE'].includes(String(error && error.code || ''))
}

function readFreshCache() {
  const key = cacheKey()
  if (!key || typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') return null
  const cached = wx.getStorageSync(key)
  if (!cached || !Array.isArray(cached.items) || Date.now() - Number(cached.savedAt || 0) > CACHE_TTL_MS) return null
  return cached.items.map(decorate)
}

function writeFirstPageCache(items) {
  const key = cacheKey()
  if (!key || typeof wx === 'undefined' || typeof wx.setStorageSync !== 'function') return
  wx.setStorageSync(key, { savedAt: Date.now(), items: (items || []).map(whitelistNotification) })
}

function mergeUnique(previous, incoming) {
  const seen = new Set()
  return (previous || []).concat(incoming || []).filter(item => {
    if (!item.notificationId || seen.has(item.notificationId)) return false
    seen.add(item.notificationId)
    return true
  })
}

Page({
  data: {
    items: [],
    unread: { count: 0, label: '', hasUnread: false },
    hasLoaded: false,
    loading: false,
    loadingMore: false,
    markingAll: false,
    nextCursor: '',
    firstError: '',
    moreError: false,
    offline: false
  },

  onLoad() {
    this._alive = true
    this._generation = 0
    this._actionFlights = Object.create(null)
    this._openFlights = Object.create(null)
    this._mutationIds = Object.create(null)
    this.bindUnread()
    unreadState.setAccountKey(dataService.getCurrentPlayerId())
    this.loadFirst()
  },

  onShow() {
    this._alive = true
    this.bindUnread()
    unreadState.setAccountKey(dataService.getCurrentPlayerId())
    unreadState.refresh().catch(() => {})
  },

  onHide() {
    this.unbindUnread()
  },

  onUnload() {
    this._alive = false
    this._generation += 1
    this.unbindUnread()
  },

  bindUnread() {
    if (this._unsubscribeUnread) return
    this._unsubscribeUnread = unreadState.subscribe(snapshot => {
      if (this._alive) this.setData({ unread: snapshot })
    })
  },

  unbindUnread() {
    if (!this._unsubscribeUnread) return
    this._unsubscribeUnread()
    this._unsubscribeUnread = null
  },

  async loadFirst() {
    if (this._firstFlight) return this._firstFlight
    const generation = ++this._generation
    this.setData({ loading: true, firstError: '', moreError: false, offline: false })
    const request = socialService.listNotifications({ cursor: '', limit: PAGE_SIZE })
      .then(result => {
        if (!this._alive || generation !== this._generation) return
        const items = (result && result.items || []).map(decorate)
        writeFirstPageCache(items)
        unreadState.applyAuthoritativeCount(result && result.unreadCount)
        this.setData({
          items,
          nextCursor: String(result && result.nextCursor || ''),
          hasLoaded: true,
          loading: false,
          offline: false,
          firstError: ''
        })
      })
      .catch(error => {
        if (!this._alive || generation !== this._generation) return
        const cached = isNetworkError(error) ? readFreshCache() : null
        if (cached) {
          this.setData({ items: cached, nextCursor: '', hasLoaded: true, loading: false, offline: true, firstError: '' })
          return
        }
        this.setData({ hasLoaded: true, loading: false, firstError: notificationRoute.describeNotificationError(error) })
      })
      .finally(() => {
        if (this._firstFlight === request) this._firstFlight = null
      })
    this._firstFlight = request
    return request
  },

  retryFirst() {
    return this.loadFirst()
  },

  async loadMore() {
    if (this.data.offline || !this.data.nextCursor || this._moreFlight) return this._moreFlight
    const generation = this._generation
    const cursor = this.data.nextCursor
    this.setData({ loadingMore: true, moreError: false })
    const request = socialService.listNotifications({ cursor, limit: PAGE_SIZE })
      .then(result => {
        if (!this._alive || generation !== this._generation) return
        this.setData({
          items: mergeUnique(this.data.items, (result && result.items || []).map(decorate)),
          nextCursor: String(result && result.nextCursor || ''),
          loadingMore: false,
          moreError: false
        })
        unreadState.applyAuthoritativeCount(result && result.unreadCount)
      })
      .catch(() => {
        if (this._alive && generation === this._generation) this.setData({ loadingMore: false, moreError: true })
      })
      .finally(() => {
        if (this._moreFlight === request) this._moreFlight = null
      })
    this._moreFlight = request
    return request
  },

  retryMore() {
    return this.loadMore()
  },

  findItem(notificationId) {
    return this.data.items.find(item => item.notificationId === notificationId)
  },

  patchItem(notificationId, patch) {
    this.setData({ items: this.data.items.map(item => item.notificationId === notificationId ? Object.assign({}, item, patch) : item) })
  },

  async actOnFriendRequest(event) {
    const dataset = event && event.currentTarget && event.currentTarget.dataset || {}
    const notificationId = String(dataset.id || '')
    const decision = dataset.decision === 'reject' ? 'reject' : 'accept'
    const item = this.findItem(notificationId)
    if (!item || !item.canAct || item.acting || this.data.offline) return
    if (this._actionFlights[notificationId]) return this._actionFlights[notificationId]
    const mutationKey = `${notificationId}:${decision}`
    const clientMutationId = this._mutationIds[mutationKey] || createMutationId('friend_request_' + decision)
    this._mutationIds[mutationKey] = clientMutationId
    this.patchItem(notificationId, { acting: true })
    const serviceMethod = decision === 'accept' ? socialService.acceptFriendRequest : socialService.rejectFriendRequest
    const request = serviceMethod({ friendshipId: item.targetId, clientMutationId })
      .then(result => {
        if (!this._alive) return
        const actionState = String(result && result.actionState || (decision === 'accept' ? 'accepted' : 'rejected'))
        unreadState.applyAuthoritativeCount(result && result.unreadCount)
        this.patchItem(notificationId, { acting: false, canAct: false, actionState, actionLabel: actionState === 'accepted' ? '已接受' : '已拒绝', read: true })
        delete this._mutationIds[mutationKey]
      })
      .catch(error => {
        if (!this._alive) return
        this.patchItem(notificationId, { acting: false })
        if (typeof wx !== 'undefined' && wx.showToast) wx.showToast({ title: notificationRoute.describeNotificationError(error), icon: 'none' })
      })
      .finally(() => { delete this._actionFlights[notificationId] })
    this._actionFlights[notificationId] = request
    return request
  },

  openNotification(event) {
    const notificationId = String(event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.id || '')
    const item = this.findItem(notificationId)
    if (!item || item.canAct || item.acting || this.data.offline) return
    if (this._openFlights[notificationId]) return this._openFlights[notificationId]
    const request = (async () => {
      if (!item.read) {
        try {
          const result = await socialService.markNotificationRead({ notificationId, clientMutationId: createMutationId('notification_read') })
          if (!this._alive) return
          unreadState.applyAuthoritativeCount(result && result.unreadCount)
          this.patchItem(notificationId, { read: true })
        } catch (error) {
          if (this._alive && typeof wx !== 'undefined' && wx.showToast) wx.showToast({ title: notificationRoute.describeNotificationError(error), icon: 'none' })
          return
        }
      }
      if (!this._alive) return
      const target = notificationRoute.resolveNotificationTarget(item)
      if (target.type === 'inline') return
      if (target.type !== 'navigate') {
        this.patchItem(notificationId, { unavailable: true, actionLabel: '内容已不可访问' })
        return
      }
      if (typeof wx !== 'undefined' && wx.navigateTo) wx.navigateTo({ url: target.url })
    })().finally(() => { delete this._openFlights[notificationId] })
    this._openFlights[notificationId] = request
    return request
  },

  async markAllRead() {
    if (this.data.offline || this.data.markingAll || !this.data.unread.hasUnread) return
    this.setData({ markingAll: true })
    try {
      const result = await socialService.markAllNotificationsRead({ clientMutationId: createMutationId('notifications_read_all') })
      if (!this._alive) return
      unreadState.applyAuthoritativeCount(result && result.unreadCount)
      this.setData({ items: this.data.items.map(item => Object.assign({}, item, { read: true })), markingAll: false })
      unreadState.refresh({ force: true }).catch(() => {})
    } catch (error) {
      if (!this._alive) return
      this.setData({ markingAll: false })
      if (typeof wx !== 'undefined' && wx.showToast) wx.showToast({ title: notificationRoute.describeNotificationError(error), icon: 'none' })
    }
  }
})
