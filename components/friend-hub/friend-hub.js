const socialService = require('../../services/social-service')
const dataService = require('../../services/data-service')

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

Component({
  properties: {
    activeSection: {
      type: String,
      value: 'feed',
      observer(value) {
        if (value === 'ranking' && this._friendHubAttached === true) this.loadRanking(this.data.rankingRange)
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
    rankingRange: 'week',
    rankingStatus: 'idle',
    rankingError: '',
    rankingRows: [],
    rankingPodium: [],
    rankingListRows: [],
    rankingMyRank: null
  },

  lifetimes: {
    attached() {
      this._friendHubAttached = true
      this._friendLoadSequence = Number(this._friendLoadSequence) || 0
      this._rankingLoadSequence = Number(this._rankingLoadSequence) || 0
      if (this.data.activeSection === 'ranking') this.loadRanking(this.data.rankingRange)
    },

    detached() {
      this._friendHubAttached = false
      this._friendLoadSequence = (Number(this._friendLoadSequence) || 0) + 1
      this._friendLoadPromise = null
      this._friendLoadMorePromise = null
      this._rankingLoadSequence = (Number(this._rankingLoadSequence) || 0) + 1
    }
  },

  methods: {
    isCurrentLoad(sequence) {
      return this._friendHubAttached !== false && sequence === this._friendLoadSequence
    },

    async buildFriendCards(remoteFriends) {
      const cards = []
      for (const remote of remoteFriends) {
        const localNote = await dataService.ensureFriendPlayerNote({
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
      const sequence = (Number(this._friendLoadSequence) || 0) + 1
      this._friendLoadSequence = sequence
      if (config.append) this.setData({ loadingMore: true, loadMoreError: '' })
      else this.setData({ status: 'loading', errorMessage: '', loadMoreError: '' })

      try {
        const response = await socialService.listFriends({ offset, limit: 20 })
        const remoteFriends = Array.isArray(response && response.items) ? response.items : []
        const cards = await this.buildFriendCards(remoteFriends)
        if (!this.isCurrentLoad(sequence)) return this.data.friends
        this.setData({
          status: 'ready',
          friends: config.append ? this.mergeFriends(this.data.friends, cards) : cards,
          nextOffset: response && response.nextOffset != null ? response.nextOffset : null,
          loadingMore: false,
          loadMoreError: ''
        })
        return this.data.friends
      } catch (error) {
        if (!this.isCurrentLoad(sequence)) return this.data.friends
        if (config.append) {
          this.setData({ loadingMore: false, loadMoreError: '加载更多失败，请重试' })
          return this.data.friends
        }
        this.setData({
          status: 'error',
          friends: [],
          nextOffset: null,
          loadingMore: false,
          errorMessage: '好友功能暂时不可用，请稍后重试'
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
      if (!Number.isFinite(offset) || offset < 0 || this._friendLoadMorePromise) return this.data.friends
      const promise = this.requestFriendPage(offset, { append: true })
      this._friendLoadMorePromise = promise
      return promise.finally(() => {
        if (this._friendLoadMorePromise === promise) this._friendLoadMorePromise = null
      })
    },

    async loadRanking(rangeKey) {
      const range = ['week', 'month', 'all'].includes(rangeKey) ? rangeKey : 'week'
      const sequence = (Number(this._rankingLoadSequence) || 0) + 1
      this._rankingLoadSequence = sequence
      this.setData({ rankingRange: range, rankingStatus: 'loading', rankingError: '', rankingRows: [], rankingPodium: [], rankingListRows: [], rankingMyRank: null })
      try {
        const response = await socialService.listRanking({ rangeKey: range })
        if (sequence !== this._rankingLoadSequence || this._friendHubAttached === false) return []
        const rows = (Array.isArray(response && response.top10) ? response.top10 : []).map(buildRankingRow)
        const myRank = response && response.myRank ? buildRankingRow(response.myRank) : null
        const uniqueMyRank = myRank && !rows.some(row => row.socialUserId === myRank.socialUserId) ? myRank : null
        this.setData({
          rankingStatus: 'ready',
          rankingRows: rows,
          rankingPodium: rows.slice(0, 3),
          rankingListRows: rows.slice(3),
          rankingMyRank: uniqueMyRank,
          rankingError: ''
        })
        return rows
      } catch (error) {
        if (sequence !== this._rankingLoadSequence || this._friendHubAttached === false) return []
        this.setData({ rankingStatus: 'error', rankingRows: [], rankingPodium: [], rankingListRows: [], rankingMyRank: null, rankingError: '排行榜暂时不可用，请稍后重试' })
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
      const friendUserId = String(event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.id || '')
      if (friendUserId) this.triggerEvent('openfriend', { friendUserId })
    },

    openMessages() {
      this.triggerEvent('openmessages', {})
    }
  }
})

module.exports = { buildFriendCard, buildRankingRow, formatDuration }
