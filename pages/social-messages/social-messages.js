const socialService = require('../../services/social-service')
const dataService = require('../../services/data-service')
const unreadState = require('../../utils/social-unread-state')
const notificationRoute = require('../../utils/social-notification-route')
const { createMutationId } = require('../../utils/social-mutation')

const PAGE_SIZE = 20
const CACHE_TTL_MS = 5 * 60 * 1000
const CACHE_PREFIX = 'socialNotificationsFirstPage:'
const ALLOWED_KINDS = new Set(['friend_request', 'friend_accepted', 'selected_hand', 'comment', 'reply', 'like_aggregate', 'player_card'])
const DTO_KEYS = ['actionState', 'actor', 'aggregateCount', 'createdAt', 'kind', 'notificationId', 'read', 'targetId', 'targetType']
const ACTOR_KEYS = ['avatarText', 'avatarUrl', 'nickname', 'socialUserId']
const TERMINAL_ACTION_STATES = new Set(['accepted', 'rejected', 'unavailable'])

function serviceContractError() {
  return Object.assign(new Error('invalid social notification response'), { code: 'SOCIAL_ERROR' })
}

function invokeAsPromise(operation) {
  try { return Promise.resolve(operation()) } catch (error) { return Promise.reject(error) }
}

function isValidUnreadCount(value) {
  return Number.isFinite(value) && Number.isInteger(value) && value >= 0
}

function requireUnreadCount(result) {
  const value = result && result.unreadCount
  if (!isValidUnreadCount(value)) throw serviceContractError()
  return value
}

function getActiveAccountKey() {
  try {
    if (typeof dataService.isAccountLoggedOut === 'function' && dataService.isAccountLoggedOut()) return ''
    if (typeof dataService.getCurrentPlayerId !== 'function') return ''
    return String(dataService.getCurrentPlayerId() || '').trim().toUpperCase()
  } catch (error) {
    return ''
  }
}

function cacheKey(accountId) {
  const normalized = String(accountId || '').trim().toUpperCase()
  return normalized ? CACHE_PREFIX + encodeURIComponent(normalized) : ''
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

function hasExactKeys(value, keys) {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys)
}

function isValidNotificationDto(item) {
  if (!hasExactKeys(item, DTO_KEYS) || !hasExactKeys(item.actor, ACTOR_KEYS)) return false
  if (!item.notificationId || !ALLOWED_KINDS.has(item.kind)) return false
  if (typeof item.targetType !== 'string' || typeof item.targetId !== 'string') return false
  if (!Number.isFinite(item.aggregateCount) || item.aggregateCount < 0 || typeof item.actionState !== 'string' || typeof item.read !== 'boolean') return false
  if (!ACTOR_KEYS.every(key => typeof item.actor[key] === 'string')) return false
  if (!['string', 'number'].includes(typeof item.createdAt) || Number.isNaN(new Date(item.createdAt).getTime())) return false
  return true
}

function normalizeListResult(result) {
  if (!result || !Array.isArray(result.items) || typeof result.nextCursor !== 'string') throw serviceContractError()
  const unreadCount = requireUnreadCount(result)
  const items = result.items.map(whitelistNotification)
  if (!items.every(isValidNotificationDto)) throw serviceContractError()
  return { items, nextCursor: result.nextCursor, unreadCount }
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
  const isFriendRequest = safe.kind === 'friend_request'
  return Object.assign(safe, {
    title: copy[0],
    summary: copy[1],
    timeLabel: formatTime(safe.createdAt),
    isFriendRequest,
    canAct: isFriendRequest && safe.targetType === 'friendship' && !!safe.targetId && safe.actionState === 'pending',
    actionLabel: actionLabels[safe.actionState] || '',
    unavailable: false,
    acting: false
  })
}

function isNetworkError(error) {
  return ['NETWORK_ERROR', 'CLOUD_UNAVAILABLE'].includes(String(error && error.code || ''))
}

function readFreshCache(accountId) {
  const key = cacheKey(accountId)
  if (!key || typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') return null
  try {
    const cached = wx.getStorageSync(key)
    const now = Date.now()
    if (!hasExactKeys(cached, ['accountId', 'items', 'nextCursor', 'savedAt', 'unreadCount'])) return null
    if (cached.accountId !== accountId || !Number.isFinite(cached.savedAt) || cached.savedAt <= 0 || cached.savedAt > now || now - cached.savedAt > CACHE_TTL_MS) return null
    if (!Array.isArray(cached.items) || !cached.items.every(isValidNotificationDto) || typeof cached.nextCursor !== 'string' || !isValidUnreadCount(cached.unreadCount)) return null
    return {
      accountId: cached.accountId,
      items: cached.items.map(decorate),
      nextCursor: cached.nextCursor,
      unreadCount: cached.unreadCount,
      savedAt: cached.savedAt
    }
  } catch (error) {
    return null
  }
}

function writeFirstPageCache(accountId, result) {
  const key = cacheKey(accountId)
  if (!key || typeof wx === 'undefined' || typeof wx.setStorageSync !== 'function') return
  const cached = {
    accountId,
    items: result.items.map(whitelistNotification),
    nextCursor: result.nextCursor,
    unreadCount: result.unreadCount,
    savedAt: Date.now()
  }
  try { wx.setStorageSync(key, cached) } catch (error) {}
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
    this._hidden = false
    this._generation = 0
    this._accountKey = getActiveAccountKey()
    this.resetRequestMaps()
    this.bindUnread()
    unreadState.setAccountKey(this._accountKey)
    if (this._accountKey) this.loadFirst()
    else this.showUnavailableAccount()
  },

  onShow() {
    const wasHidden = !!this._hidden
    const nextAccountKey = getActiveAccountKey()
    const accountChanged = nextAccountKey !== this._accountKey
    this._alive = true
    this._hidden = false
    this.bindUnread()
    if (accountChanged) {
      this.invalidateAsyncWork(true)
      this._accountKey = nextAccountKey
      this.setData({
        items: [],
        hasLoaded: false,
        loading: false,
        loadingMore: false,
        markingAll: false,
        nextCursor: '',
        firstError: '',
        moreError: false,
        offline: false
      })
    }
    unreadState.setAccountKey(nextAccountKey)
    if (!nextAccountKey) {
      this.showUnavailableAccount()
      return
    }
    if (wasHidden || accountChanged) this.loadFirst()
    else if (!this._firstFlight && !this.data.hasLoaded) this.loadFirst()
    unreadState.refresh().catch(() => {})
  },

  onHide() {
    this._alive = false
    this._hidden = true
    this.invalidateAsyncWork(true)
    this.unbindUnread()
  },

  onUnload() {
    this._alive = false
    this._hidden = true
    this.invalidateAsyncWork(true)
    this.unbindUnread()
  },

  resetRequestMaps() {
    this._actionFlights = Object.create(null)
    this._openFlights = Object.create(null)
    this._friendMutationIds = Object.create(null)
    this._readMutationIds = Object.create(null)
    this._markAllMutationId = ''
  },

  invalidateAsyncWork(resetMutations) {
    this._generation += 1
    this._firstFlight = null
    this._moreFlight = null
    this._actionFlights = Object.create(null)
    this._openFlights = Object.create(null)
    if (resetMutations) {
      this._friendMutationIds = Object.create(null)
      this._readMutationIds = Object.create(null)
      this._markAllMutationId = ''
    }
  },

  isRequestCurrent(generation, accountKey) {
    return !!this._alive && generation === this._generation && accountKey === this._accountKey && accountKey === getActiveAccountKey()
  },

  showUnavailableAccount() {
    if (!this._alive) return
    this.setData({
      items: [],
      hasLoaded: true,
      loading: false,
      loadingMore: false,
      markingAll: false,
      nextCursor: '',
      firstError: '好友功能暂时不可用',
      moreError: false,
      offline: false
    })
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

  loadFirst() {
    if (!this._alive) return Promise.resolve()
    const accountKey = getActiveAccountKey()
    if (!accountKey || accountKey !== this._accountKey) {
      this._accountKey = accountKey
      unreadState.setAccountKey(accountKey)
      this.invalidateAsyncWork(true)
      this.showUnavailableAccount()
      return Promise.resolve()
    }
    if (this._firstFlight) return this._firstFlight
    const generation = ++this._generation
    this._moreFlight = null
    this.setData({ loading: true, loadingMore: false, markingAll: false, firstError: '', moreError: false, offline: false })
    const request = invokeAsPromise(() => socialService.listNotifications({ cursor: '', limit: PAGE_SIZE }))
      .then(rawResult => {
        if (!this.isRequestCurrent(generation, accountKey)) return
        const result = normalizeListResult(rawResult)
        if (!this.isRequestCurrent(generation, accountKey)) return
        writeFirstPageCache(accountKey, result)
        unreadState.applyAuthoritativeCount(result.unreadCount)
        this.setData({
          items: result.items.map(decorate),
          nextCursor: result.nextCursor,
          hasLoaded: true,
          loading: false,
          loadingMore: false,
          offline: false,
          firstError: '',
          moreError: false
        })
      })
      .catch(error => {
        if (!this.isRequestCurrent(generation, accountKey)) return
        const cached = isNetworkError(error) ? readFreshCache(accountKey) : null
        if (cached) {
          unreadState.applyAuthoritativeCount(cached.unreadCount)
          this.setData({ items: cached.items, nextCursor: '', hasLoaded: true, loading: false, loadingMore: false, offline: true, firstError: '', moreError: false })
          return
        }
        this.setData({ hasLoaded: true, loading: false, loadingMore: false, firstError: notificationRoute.describeNotificationError(error), moreError: false })
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

  loadMore() {
    if (!this._alive || this.data.offline || !this.data.nextCursor || this._moreFlight) return this._moreFlight
    const generation = this._generation
    const accountKey = this._accountKey
    const cursor = this.data.nextCursor
    this.setData({ loadingMore: true, moreError: false })
    const request = invokeAsPromise(() => socialService.listNotifications({ cursor, limit: PAGE_SIZE }))
      .then(rawResult => {
        if (!this.isRequestCurrent(generation, accountKey)) return
        const result = normalizeListResult(rawResult)
        this.setData({
          items: mergeUnique(this.data.items, result.items.map(decorate)),
          nextCursor: result.nextCursor,
          loadingMore: false,
          moreError: false
        })
        unreadState.applyAuthoritativeCount(result.unreadCount)
      })
      .catch(() => {
        if (this.isRequestCurrent(generation, accountKey)) this.setData({ loadingMore: false, moreError: true })
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
    if (!this._alive) return
    this.setData({ items: this.data.items.map(item => item.notificationId === notificationId ? Object.assign({}, item, patch) : item) })
  },

  actOnFriendRequest(event) {
    const dataset = event && event.currentTarget && event.currentTarget.dataset || {}
    const notificationId = String(dataset.id || '')
    const decision = dataset.decision === 'reject' ? 'reject' : 'accept'
    if (this._actionFlights[notificationId]) return this._actionFlights[notificationId]
    const item = this.findItem(notificationId)
    if (!this._alive || !item || !item.canAct || item.acting || this.data.offline || item.kind !== 'friend_request' || item.targetType !== 'friendship' || !item.targetId || item.actionState !== 'pending') return
    const generation = this._generation
    const accountKey = this._accountKey
    const mutationKey = `${notificationId}:${decision}`
    const clientMutationId = this._friendMutationIds[mutationKey] || createMutationId('friend_request_' + decision)
    this._friendMutationIds[mutationKey] = clientMutationId
    this.patchItem(notificationId, { acting: true })
    const serviceMethod = decision === 'accept' ? socialService.acceptFriendRequest : socialService.rejectFriendRequest
    const request = invokeAsPromise(() => serviceMethod({ friendshipId: item.targetId, clientMutationId }))
      .then(result => {
        if (!this.isRequestCurrent(generation, accountKey)) return
        const actionState = String(result && result.actionState || '')
        const unreadCount = requireUnreadCount(result)
        if (!TERMINAL_ACTION_STATES.has(actionState)) throw serviceContractError()
        unreadState.applyAuthoritativeCount(unreadCount)
        const labels = { accepted: '已接受', rejected: '已拒绝', unavailable: '内容已不可访问' }
        this.patchItem(notificationId, { acting: false, canAct: false, actionState, actionLabel: labels[actionState] })
        delete this._friendMutationIds[mutationKey]
      })
      .catch(error => {
        if (!this.isRequestCurrent(generation, accountKey)) return
        this.patchItem(notificationId, { acting: false })
        if (typeof wx !== 'undefined' && wx.showToast) wx.showToast({ title: notificationRoute.describeNotificationError(error), icon: 'none' })
      })
      .finally(() => {
        if (this._actionFlights[notificationId] === request) delete this._actionFlights[notificationId]
      })
    this._actionFlights[notificationId] = request
    return request
  },

  openNotification(event) {
    const notificationId = String(event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.id || '')
    if (this._openFlights[notificationId]) return this._openFlights[notificationId]
    const item = this.findItem(notificationId)
    if (!this._alive || !item || item.canAct || item.acting || this.data.offline) return
    const generation = this._generation
    const accountKey = this._accountKey
    const request = (async () => {
      if (!item.read) {
        const clientMutationId = this._readMutationIds[notificationId] || createMutationId('notification_read')
        this._readMutationIds[notificationId] = clientMutationId
        try {
          const result = await socialService.markNotificationRead({ notificationId, clientMutationId })
          if (!this.isRequestCurrent(generation, accountKey)) return
          const unreadCount = requireUnreadCount(result)
          unreadState.applyAuthoritativeCount(unreadCount)
          this.patchItem(notificationId, { read: true })
          delete this._readMutationIds[notificationId]
        } catch (error) {
          if (this.isRequestCurrent(generation, accountKey) && typeof wx !== 'undefined' && wx.showToast) wx.showToast({ title: notificationRoute.describeNotificationError(error), icon: 'none' })
          return
        }
      }
      if (!this.isRequestCurrent(generation, accountKey)) return
      const target = notificationRoute.resolveNotificationTarget(item)
      if (target.type === 'inline') return
      if (target.type !== 'navigate') {
        this.patchItem(notificationId, { unavailable: true, actionLabel: '内容已不可访问' })
        return
      }
      if (typeof wx !== 'undefined' && wx.navigateTo) wx.navigateTo({ url: target.url })
    })().finally(() => {
      if (this._openFlights[notificationId] === request) delete this._openFlights[notificationId]
    })
    this._openFlights[notificationId] = request
    return request
  },

  async markAllRead() {
    if (!this._alive || this.data.offline || this.data.markingAll || !this.data.unread.hasUnread) return
    const generation = this._generation
    const accountKey = this._accountKey
    const clientMutationId = this._markAllMutationId || createMutationId('notifications_read_all')
    this._markAllMutationId = clientMutationId
    this.setData({ markingAll: true })
    try {
      const result = await socialService.markAllNotificationsRead({ clientMutationId })
      if (!this.isRequestCurrent(generation, accountKey)) return
      const unreadCount = requireUnreadCount(result)
      unreadState.applyAuthoritativeCount(unreadCount)
      this._markAllMutationId = ''
      this.setData({ items: this.data.items.map(item => Object.assign({}, item, { read: true })), markingAll: false })
      unreadState.refresh({ force: true }).catch(() => {})
    } catch (error) {
      if (!this.isRequestCurrent(generation, accountKey)) return
      this.setData({ markingAll: false })
      if (typeof wx !== 'undefined' && wx.showToast) wx.showToast({ title: notificationRoute.describeNotificationError(error), icon: 'none' })
    }
  }
})
