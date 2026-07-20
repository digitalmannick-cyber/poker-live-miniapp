const socialService = require('../../services/social-service')
const dataService = require('../../services/data-service')
const socialCache = require('../../utils/social-cache')

const FEED_PAGE_SIZE = 20
const SOCIAL_CACHE_SCHEMA_VERSION = socialCache.SOCIAL_CACHE_SCHEMA_VERSION || 1
const FEED_SCOPE_LABELS = Object.freeze({ square: '广场', friends: '全部好友', selected: '指定好友' })

function isNetworkError(error) {
  return !!error && (error.code === 'NETWORK_ERROR' || error.code === 'CLOUD_UNAVAILABLE')
}

function feedContractError() {
  const error = new Error('invalid feed response')
  error.code = 'SOCIAL_CONTRACT_ERROR'
  return error
}

function requireFeedResponse(response) {
  const copied = socialCache.copyFeedResponse(response)
  if (!copied) throw feedContractError()
  return copied
}

function formatFeedTime(createdAt) {
  const value = Number(createdAt)
  if (!Number.isFinite(value) || value <= 0) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const pad = number => String(number).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function decorateFeedItem(item) {
  const source = item || {}
  const summary = source.summary || {}
  const board = summary.board || {}
  const cards = value => Array.isArray(value) ? value.filter(card => typeof card === 'string').join(' ') : ''
  const boardLabel = [cards(board.flop), cards(board.turn), cards(board.river)].filter(Boolean).join('  ·  ')
  return Object.assign({}, source, {
    scopeLabel: FEED_SCOPE_LABELS[source.scope] || String(source.scopeLabel || ''),
    heroCardsLabel: cards(summary.heroCards) || '--',
    boardLabel: boardLabel || '公共牌未记录',
    potBbLabel: Number.isFinite(summary.potBb) ? `${summary.potBb} BB` : '--',
    stackBbLabel: Number.isFinite(summary.effectiveStackBb) ? `${summary.effectiveStackBb} BB` : '--',
    timeLabel: formatFeedTime(source.createdAt)
  })
}

function formatDuration(minutes) {
  const value = Number(minutes)
  if (!Number.isFinite(value) || value <= 0) return ''
  return (Math.round(value / 6) / 10).toFixed(1) + 'h'
}

function buildFriendCard(remote, localNote) {
  const profile = remote || {}
  const note = localNote || {}
  const color = note.typeColor || '#8891a7'
  const battleHandCount = Array.isArray(note.battleHandIds) ? note.battleHandIds.length : 0
  const statsVisible = profile.statsVisible !== false
  const handCount = Number(profile.recordedHandCount)

  return {
    friendUserId: String(profile.socialUserId || ''),
    friendshipId: String(profile.friendshipId || ''),
    name: String(note.name || profile.nickname || ''),
    avatarUrl: String(note.avatarUrl || profile.avatarUrl || ''),
    avatarText: String(note.avatarText || profile.avatarText || String(note.name || profile.nickname || '').slice(0, 1)),
    type: String(note.type || '未分类'),
    typeColor: color,
    leakTags: (note.leakTags || []).slice(0, 4).map(label => ({ label })),
    notePreview: String(note.note || '暂无 Note'),
    battleHandCount,
    battleHandLabel: battleHandCount + ' 手对战',
    title: String(profile.title || ''),
    statsVisible,
    durationLabel: statsVisible ? formatDuration(profile.durationMinutes) : '',
    handCountLabel: statsVisible && Number.isFinite(handCount) && handCount >= 0 ? handCount + ' 手' : '',
    cardColor: color,
    rowStyle: '--player-card-color: ' + color + '; border-color: ' + color + ';',
    colorStyle: 'background: ' + color + ';',
    typeStyle: 'background: ' + color + ';'
  }
}

function buildRankingRow(row, position) {
  const source = row || {}
  const rank = Math.max(1, Math.floor(Number(source.rank) || 1))
  return {
    socialUserId: String(source.socialUserId || ''),
    nickname: String(source.nickname || '玩家'),
    avatarUrl: String(source.avatarUrl || ''),
    avatarText: String(source.avatarText || String(source.nickname || '玩').slice(0, 1)),
    title: String(source.title || '初来乍到'),
    rank,
    rankText: String(rank).padStart(2, '0'),
    durationLabel: formatDuration(source.durationMinutes) || '0.0h',
    handCountLabel: Math.max(0, Math.floor(Number(source.recordedHandCount) || 0)) + ' 手牌',
    podiumTone: position === 0 ? 'gold' : position === 1 ? 'silver' : 'bronze'
  }
}

function copyPublicFriend(value) {
  const source = value || {}
  if (typeof source.socialUserId !== 'string' || !source.socialUserId || typeof source.nickname !== 'string') throw feedContractError()
  const copied = {
    socialUserId: source.socialUserId,
    nickname: source.nickname,
    avatarUrl: typeof source.avatarUrl === 'string' ? source.avatarUrl : '',
    avatarText: typeof source.avatarText === 'string' ? source.avatarText : '',
    title: typeof source.title === 'string' ? source.title : '',
    statsVisible: source.statsVisible !== false
  }
  if (typeof source.friendshipId === 'string') copied.friendshipId = source.friendshipId
  if (copied.statsVisible && Number.isFinite(source.durationMinutes) && source.durationMinutes >= 0) copied.durationMinutes = source.durationMinutes
  if (copied.statsVisible && Number.isSafeInteger(source.recordedHandCount) && source.recordedHandCount >= 0) copied.recordedHandCount = source.recordedHandCount
  return copied
}

function copyFriendsResponse(value) {
  const source = value || {}
  if (!Array.isArray(source.items)) throw feedContractError()
  const nextOffset = source.nextOffset
  if (nextOffset !== null && (!Number.isSafeInteger(nextOffset) || nextOffset < 0)) throw feedContractError()
  return { items: source.items.map(copyPublicFriend), nextOffset }
}

function copyPublicRankingRow(value) {
  const source = value || {}
  if (typeof source.socialUserId !== 'string' || !source.socialUserId || typeof source.nickname !== 'string' ||
    !Number.isSafeInteger(source.rank) || source.rank < 1) throw feedContractError()
  return {
    socialUserId: source.socialUserId,
    nickname: source.nickname,
    avatarUrl: typeof source.avatarUrl === 'string' ? source.avatarUrl : '',
    avatarText: typeof source.avatarText === 'string' ? source.avatarText : '',
    title: typeof source.title === 'string' ? source.title : '',
    rank: source.rank,
    durationMinutes: Number.isFinite(source.durationMinutes) && source.durationMinutes >= 0 ? source.durationMinutes : 0,
    recordedHandCount: Number.isSafeInteger(source.recordedHandCount) && source.recordedHandCount >= 0 ? source.recordedHandCount : 0
  }
}

function copyRankingResponse(value) {
  const source = value || {}
  if (!Array.isArray(source.top10) || (source.myRank !== null && (!source.myRank || typeof source.myRank !== 'object'))) throw feedContractError()
  return { top10: source.top10.map(copyPublicRankingRow), myRank: source.myRank === null ? null : copyPublicRankingRow(source.myRank) }
}

Component({
  properties: {
    activeSection: {
      type: String,
      value: 'feed',
      observer(value) {
        if (value === 'ranking' && this._friendHubAttached === true) this.loadRanking(this.data.rankingRange)
        if (value === 'feed' && this._friendHubAttached === true && this.data.socialUserId) this.loadFeed()
      }
    },
    socialUserId: {
      type: String,
      value: '',
      observer(value, oldValue) {
        const next = String(value || '')
        const previous = String(oldValue || '')
        if (next === previous) return
        this.invalidateFeed({ clear: true })
        if (this._friendHubAttached === true && this.data.activeSection === 'feed' && next) this.loadFeed()
      }
    },
    accountKey: {
      type: String,
      value: '',
      observer(value, oldValue) {
        const next = String(value || '')
        const previous = String(oldValue || '')
        if (next === previous) return
        this.invalidateAccountSurfaces()
        if (this._friendHubAttached !== true || !next) return
        if (this.data.activeSection === 'friends') this.loadFriends(true)
        if (this.data.activeSection === 'ranking') this.loadRanking(this.data.rankingRange)
      }
    }
  },

  data: {
    status: 'idle',
    errorMessage: '',
    friends: [],
    nextOffset: null,
    loadingMore: false,
    loadMoreError: '',
    friendsOffline: false,
    friendsReadOnly: false,
    rankingRange: 'week',
    rankingStatus: 'idle',
    rankingError: '',
    rankingRows: [],
    rankingPodium: [],
    rankingListRows: [],
    rankingMyRank: null,
    rankingOffline: false,
    rankingReadOnly: false,
    feedStatus: 'idle',
    feedError: '',
    feedItems: [],
    feedNextCursor: '',
    feedLoadingMore: false,
    feedMoreError: '',
    feedOffline: false,
    feedReadOnly: false
  },

  lifetimes: {
    attached() {
      this._friendHubAttached = true
      this._friendLoadSequence = Number(this._friendLoadSequence) || 0
      this._rankingLoadSequence = Number(this._rankingLoadSequence) || 0
      this._feedGeneration = Number(this._feedGeneration) || 0
      if (this.data.activeSection === 'ranking') this.loadRanking(this.data.rankingRange)
      if (this.data.activeSection === 'feed' && this.data.socialUserId) this.loadFeed()
    },

    detached() {
      this._friendHubAttached = false
      this._friendLoadSequence = (Number(this._friendLoadSequence) || 0) + 1
      this._friendLoadPromise = null
      this._friendLoadMorePromise = null
      this._rankingLoadSequence = (Number(this._rankingLoadSequence) || 0) + 1
      this.invalidateFeed({ clear: true })
    }
  },

  methods: {
    invalidateAccountSurfaces() {
      this._friendLoadSequence = (Number(this._friendLoadSequence) || 0) + 1
      this._friendLoadPromise = null
      this._friendLoadMorePromise = null
      this._rankingLoadSequence = (Number(this._rankingLoadSequence) || 0) + 1
      this.setData({
        status: 'idle', friends: [], nextOffset: null, loadingMore: false, loadMoreError: '', errorMessage: '',
        friendsOffline: false, friendsReadOnly: false,
        rankingStatus: 'idle', rankingRows: [], rankingPodium: [], rankingListRows: [], rankingMyRank: null,
        rankingError: '', rankingOffline: false, rankingReadOnly: false
      })
    },

    invalidateFeed(options) {
      const config = options || {}
      this._feedGeneration = (Number(this._feedGeneration) || 0) + 1
      this._feedFirstFlight = null
      this._feedMoreFlight = null
      if (config.clear) {
        this.setData({
          feedStatus: this.data.socialUserId ? 'idle' : 'unavailable',
          feedError: '',
          feedItems: [],
          feedNextCursor: '',
          feedLoadingMore: false,
          feedMoreError: '',
          feedOffline: false,
          feedReadOnly: false
        })
      } else {
        this.setData({ feedLoadingMore: false, feedMoreError: '' })
      }
    },

    isCurrentFeedRequest(generation, socialUserId, cursor) {
      if (this._friendHubAttached !== true || generation !== this._feedGeneration) return false
      if (String(this.data.socialUserId || '') !== socialUserId) return false
      return cursor === undefined || String(this.data.feedNextCursor || '') === cursor
    },

    mergeFeedItems(existing, incoming) {
      const merged = []
      const seen = new Set()
      ;(existing || []).concat(incoming || []).forEach(item => {
        const shareId = String(item && item.shareId || '')
        if (!shareId || seen.has(shareId)) return
        seen.add(shareId)
        merged.push(item)
      })
      return merged
    },

    requestFeedFirstPage() {
      const socialUserId = String(this.data.socialUserId || '')
      if (!socialUserId || this._friendHubAttached !== true) return Promise.resolve([])
      const generation = Number(this._feedGeneration) || 0
      this.setData({ feedStatus: 'loading', feedError: '', feedMoreError: '', feedOffline: false, feedReadOnly: false })
      let request
      try {
        request = socialService.listFeed({ cursor: '', limit: FEED_PAGE_SIZE })
      } catch (error) {
        request = Promise.reject(error)
      }
      return Promise.resolve(request)
        .then(response => {
          if (!this.isCurrentFeedRequest(generation, socialUserId)) return this.data.feedItems
          const copied = requireFeedResponse(response)
          const items = copied.items
          const nextCursor = copied.nextCursor === null ? '' : copied.nextCursor
          socialCache.writeFeedFirstPage(socialUserId, { items, nextCursor })
          if (!this.isCurrentFeedRequest(generation, socialUserId)) return this.data.feedItems
          const cards = items.map(decorateFeedItem)
          this.setData({
            feedStatus: 'ready',
            feedError: '',
            feedItems: cards,
            feedNextCursor: nextCursor,
            feedLoadingMore: false,
            feedMoreError: '',
            feedOffline: false,
            feedReadOnly: false
          })
          return cards
        })
        .catch(error => {
          if (!this.isCurrentFeedRequest(generation, socialUserId)) return this.data.feedItems
          const cached = isNetworkError(error) ? socialCache.readFeedFirstPage(socialUserId) : null
          if (cached) {
            const cards = cached.items.map(decorateFeedItem)
            this.setData({
              feedStatus: 'ready',
              feedError: '',
              feedItems: cards,
              feedNextCursor: '',
              feedLoadingMore: false,
              feedMoreError: '',
              feedOffline: true,
              feedReadOnly: true
            })
            return cards
          }
          this.setData({
            feedStatus: 'error',
            feedError: '动态暂时不可用，请稍后重试',
            feedItems: [],
            feedNextCursor: '',
            feedLoadingMore: false,
            feedMoreError: '',
            feedOffline: false,
            feedReadOnly: false
          })
          return []
        })
    },

    loadFeed(force) {
      if (force) this.invalidateFeed({ clear: false })
      if (!force && this._feedFirstFlight) return this._feedFirstFlight
      if (!force && this.data.feedStatus === 'ready') return Promise.resolve(this.data.feedItems)
      const promise = this.requestFeedFirstPage()
      this._feedFirstFlight = promise
      promise.finally(() => {
        if (this._feedFirstFlight === promise) this._feedFirstFlight = null
      })
      return promise
    },

    refreshFeed() {
      if (this._feedFirstFlight) return this._feedFirstFlight
      this.setData({ feedItems: [], feedNextCursor: '', feedStatus: 'idle', feedError: '', feedOffline: false, feedReadOnly: false })
      return this.loadFeed(true)
    },

    requestFeedMore(cursor) {
      const socialUserId = String(this.data.socialUserId || '')
      const generation = Number(this._feedGeneration) || 0
      this.setData({ feedLoadingMore: true, feedMoreError: '' })
      let request
      try {
        request = socialService.listFeed({ cursor, limit: FEED_PAGE_SIZE })
      } catch (error) {
        request = Promise.reject(error)
      }
      return Promise.resolve(request)
        .then(response => {
          if (!this.isCurrentFeedRequest(generation, socialUserId, cursor)) return this.data.feedItems
          const copied = requireFeedResponse(response)
          const incoming = copied.items.map(decorateFeedItem)
          const nextCursor = copied.nextCursor === null ? '' : copied.nextCursor
          const items = this.mergeFeedItems(this.data.feedItems, incoming)
          this.setData({ feedItems: items, feedNextCursor: nextCursor, feedLoadingMore: false, feedMoreError: '' })
          return items
        })
        .catch(() => {
          if (!this.isCurrentFeedRequest(generation, socialUserId, cursor)) return this.data.feedItems
          this.setData({ feedLoadingMore: false, feedMoreError: '加载失败，点击重试' })
          return this.data.feedItems
        })
    },

    loadMoreFeed() {
      if (this._feedMoreFlight) return this._feedMoreFlight
      const cursor = String(this.data.feedNextCursor || '')
      if (!cursor || this.data.feedOffline || this.data.feedReadOnly || this._friendHubAttached !== true) return Promise.resolve(this.data.feedItems)
      const promise = this.requestFeedMore(cursor)
      this._feedMoreFlight = promise
      promise.finally(() => {
        if (this._feedMoreFlight === promise) this._feedMoreFlight = null
      })
      return promise
    },

    openHand(event) {
      if (this._friendHubAttached !== true || this.data.feedReadOnly) return
      const dataset = event && event.currentTarget && event.currentTarget.dataset || {}
      const shareId = String(dataset.shareId || dataset.id || '')
      if (shareId) this.triggerEvent('openhand', { shareId })
    },

    openPublisher(event) {
      if (this._friendHubAttached !== true || this.data.feedReadOnly) return
      const dataset = event && event.currentTarget && event.currentTarget.dataset || {}
      const friendUserId = String(dataset.socialUserId || dataset.id || '')
      if (friendUserId) this.triggerEvent('openfriend', { friendUserId })
    },

    isCurrentLoad(sequence, accountKey) {
      return this._friendHubAttached !== false && sequence === this._friendLoadSequence &&
        String(this.data.accountKey || '') === accountKey
    },

    async buildFriendCards(remoteFriends, options) {
      const readOnly = options && options.readOnly === true
      const cards = []
      for (const remote of remoteFriends) {
        const localNote = readOnly ? null : await dataService.ensureFriendPlayerNote({
          socialUserId: remote.socialUserId,
          nickname: remote.nickname,
          avatarUrl: remote.avatarUrl,
          avatarText: remote.avatarText
        })
        cards.push(buildFriendCard(remote, localNote))
      }
      return cards
    },

    mergeFriends(existing, incoming) {
      const byId = new Map()
      ;(existing || []).concat(incoming || []).forEach(item => {
        const id = String(item && item.friendUserId || '')
        if (id && !byId.has(id)) byId.set(id, item)
      })
      return Array.from(byId.values())
    },

    async requestFriendPage(offset, options) {
      const config = options || {}
      const accountKey = String(this.data.accountKey || '')
      const sequence = (Number(this._friendLoadSequence) || 0) + 1
      this._friendLoadSequence = sequence
      if (config.append) this.setData({ loadingMore: true, loadMoreError: '' })
      else this.setData({ status: 'loading', errorMessage: '', loadMoreError: '', friendsOffline: false, friendsReadOnly: false })

      try {
        const response = copyFriendsResponse(await socialService.listFriends({ offset, limit: 20 }))
        if (!this.isCurrentLoad(sequence, accountKey)) return this.data.friends
        if (!config.append && accountKey) socialCache.writeScopedFirstPage({ namespace: 'friends', accountKey, schemaVersion: SOCIAL_CACHE_SCHEMA_VERSION, data: response })
        const cards = await this.buildFriendCards(response.items)
        if (!this.isCurrentLoad(sequence, accountKey)) return this.data.friends
        this.setData({
          status: 'ready',
          friends: config.append ? this.mergeFriends(this.data.friends, cards) : cards,
          nextOffset: response.nextOffset,
          loadingMore: false,
          loadMoreError: '',
          friendsOffline: false,
          friendsReadOnly: false
        })
        return this.data.friends
      } catch (error) {
        if (!this.isCurrentLoad(sequence, accountKey)) return this.data.friends
        if (config.append) {
          this.setData({ loadingMore: false, loadMoreError: '加载更多失败，请重试' })
          return this.data.friends
        }
        const cached = isNetworkError(error) && accountKey ? socialCache.readScopedFirstPage({ namespace: 'friends', accountKey, schemaVersion: SOCIAL_CACHE_SCHEMA_VERSION }) : null
        if (cached) {
          try {
            const response = copyFriendsResponse(cached)
            const cards = await this.buildFriendCards(response.items, { readOnly: true })
            if (!this.isCurrentLoad(sequence, accountKey)) return this.data.friends
            this.setData({
              status: 'ready', friends: cards, nextOffset: null, loadingMore: false, loadMoreError: '', errorMessage: '',
              friendsOffline: true, friendsReadOnly: true
            })
            return cards
          } catch (cacheError) {}
        }
        this.setData({
          status: 'error',
          friends: [],
          nextOffset: null,
          loadingMore: false,
          errorMessage: '好友功能暂时不可用，请稍后重试',
          friendsOffline: false,
          friendsReadOnly: false
        })
        return []
      }
    },

    loadFriends(force) {
      if (!force && this._friendLoadPromise) return this._friendLoadPromise
      if (!force && this.data.status === 'ready') return this.data.friends
      const promise = this.requestFriendPage(0, { append: false })
      this._friendLoadPromise = promise
      return promise.finally(() => {
        if (this._friendLoadPromise === promise) this._friendLoadPromise = null
      })
    },

    loadMoreFriends() {
      const offset = Number(this.data.nextOffset)
      if (!Number.isFinite(offset) || offset < 0 || this._friendLoadMorePromise || this.data.friendsReadOnly) return this.data.friends
      const promise = this.requestFriendPage(offset, { append: true })
      this._friendLoadMorePromise = promise
      return promise.finally(() => {
        if (this._friendLoadMorePromise === promise) this._friendLoadMorePromise = null
      })
    },

    async loadRanking(rangeKey) {
      const range = ['week', 'month', 'all'].includes(rangeKey) ? rangeKey : 'week'
      const accountKey = String(this.data.accountKey || '')
      const sequence = (Number(this._rankingLoadSequence) || 0) + 1
      this._rankingLoadSequence = sequence
      this.setData({ rankingRange: range, rankingStatus: 'loading', rankingError: '', rankingRows: [], rankingPodium: [], rankingListRows: [], rankingMyRank: null, rankingOffline: false, rankingReadOnly: false })
      try {
        const response = copyRankingResponse(await socialService.listRanking({ rangeKey: range }))
        if (sequence !== this._rankingLoadSequence || this._friendHubAttached === false || String(this.data.accountKey || '') !== accountKey) return []
        if (accountKey) socialCache.writeScopedFirstPage({ namespace: 'ranking:' + range, accountKey, schemaVersion: SOCIAL_CACHE_SCHEMA_VERSION, data: response })
        const rows = response.top10.map(buildRankingRow)
        const myRank = response.myRank ? buildRankingRow(response.myRank) : null
        const uniqueMyRank = myRank && !rows.some(row => row.socialUserId === myRank.socialUserId) ? myRank : null
        this.setData({
          rankingStatus: 'ready',
          rankingRows: rows,
          rankingPodium: rows.slice(0, 3),
          rankingListRows: rows.slice(3),
          rankingMyRank: uniqueMyRank,
          rankingError: '',
          rankingOffline: false,
          rankingReadOnly: false
        })
        return rows
      } catch (error) {
        if (sequence !== this._rankingLoadSequence || this._friendHubAttached === false || String(this.data.accountKey || '') !== accountKey) return []
        const cached = isNetworkError(error) && accountKey ? socialCache.readScopedFirstPage({ namespace: 'ranking:' + range, accountKey, schemaVersion: SOCIAL_CACHE_SCHEMA_VERSION }) : null
        if (cached) {
          try {
            const response = copyRankingResponse(cached)
            const rows = response.top10.map(buildRankingRow)
            const myRank = response.myRank ? buildRankingRow(response.myRank) : null
            const uniqueMyRank = myRank && !rows.some(row => row.socialUserId === myRank.socialUserId) ? myRank : null
            this.setData({ rankingStatus: 'ready', rankingRows: rows, rankingPodium: rows.slice(0, 3), rankingListRows: rows.slice(3), rankingMyRank: uniqueMyRank, rankingError: '', rankingOffline: true, rankingReadOnly: true })
            return rows
          } catch (cacheError) {}
        }
        this.setData({ rankingStatus: 'error', rankingRows: [], rankingPodium: [], rankingListRows: [], rankingMyRank: null, rankingError: '排行榜暂时不可用，请稍后重试', rankingOffline: false, rankingReadOnly: false })
        return []
      }
    },

    selectRankingRange(event) {
      const range = String(event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.range || 'week')
      return this.loadRanking(range)
    },

    retryRanking() {
      return this.loadRanking(this.data.rankingRange)
    },

    selectSection(event) {
      const section = String(event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.section || 'friends')
      this.triggerEvent('sectionchange', { section })
    },

    openFriend(event) {
      if (this.data.friendsReadOnly) return
      const friendUserId = String(event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.id || '')
      if (friendUserId) this.triggerEvent('openfriend', { friendUserId })
    },

    openMessages() {
      if (this.data.feedReadOnly || this.data.friendsReadOnly || this.data.rankingReadOnly) return
      this.triggerEvent('openmessages', {})
    }
  }
})

module.exports = { buildFriendCard, buildRankingRow, decorateFeedItem, formatDuration }
