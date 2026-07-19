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

Component({
  properties: {
    activeSection: {
      type: String,
      value: 'friends'
    }
  },

  data: {
    status: 'idle',
    errorMessage: '',
    friends: [],
    nextOffset: null
  },

  methods: {
    async loadFriends(force) {
      if (this._friendLoadPromise) return this._friendLoadPromise
      if (!force && this.data.status === 'ready') return this.data.friends

      this.setData({ status: 'loading', errorMessage: '' })
      this._friendLoadPromise = (async () => {
        try {
          const response = await socialService.listFriends({ offset: 0, limit: 20 })
          const remoteFriends = Array.isArray(response && response.items) ? response.items : []
          const friends = []
          for (const remote of remoteFriends) {
            const localNote = await dataService.ensureFriendPlayerNote({
              socialUserId: remote.socialUserId,
              nickname: remote.nickname,
              avatarUrl: remote.avatarUrl,
              avatarText: remote.avatarText
            })
            friends.push(buildFriendCard(remote, localNote))
          }
          this.setData({
            status: 'ready',
            friends,
            nextOffset: response && response.nextOffset != null ? response.nextOffset : null
          })
          return friends
        } catch (error) {
          this.setData({
            status: 'error',
            friends: [],
            nextOffset: null,
            errorMessage: '好友功能暂时不可用，请稍后重试'
          })
          return []
        } finally {
          this._friendLoadPromise = null
        }
      })()
      return this._friendLoadPromise
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

module.exports = { buildFriendCard, formatDuration }
