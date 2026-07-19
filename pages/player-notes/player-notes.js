const dataService = require('../../services/data-service')
const tabBar = require('../../utils/tab-bar')
const avatarCache = require('../../utils/player-avatar-cache')
const onboardingGuide = require('../../utils/onboarding-guide')
const socialUnreadState = require('../../utils/social-unread-state')
const socialService = require('../../services/social-service')
const socialCache = require('../../utils/social-cache')

function getSocialAccountKey() {
  try {
    if (typeof dataService.isAccountLoggedOut === 'function' && dataService.isAccountLoggedOut()) return ''
    return typeof dataService.getCurrentPlayerId === 'function' ? dataService.getCurrentPlayerId() : ''
  } catch (error) {
    return ''
  }
}

function buildTypeFilters(settings, selectedType) {
  const types = ['全部'].concat(settings && settings.opponentTypes || [])
  const seen = {}
  return types
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .filter(item => {
      if (seen[item]) return false
      seen[item] = true
      return true
    })
    .map(item => ({
      label: item,
      value: item === '全部' ? '' : item,
      active: item === '全部' ? !selectedType : selectedType === item
    }))
}

function buildListItem(note) {
  const item = note || {}
  const battleCount = Array.isArray(item.battleHandIds) ? item.battleHandIds.length : 0
  const color = item.typeColor || '#8891a7'
  return Object.assign({}, item, {
    notePreview: item.note || '暂无 note',
    avatarDisplayUrl: avatarCache.getAvatarDisplayUrl(item.avatarFileId, item.avatarUrl),
    battleCountLabel: battleCount + ' 手对战',
    tagItems: (item.leakTags || []).slice(0, 4).map(label => ({ label })),
    cardColor: color,
    rowStyle: '--player-card-color: ' + color + '; border-color: ' + color + ';',
    colorStyle: 'background: ' + color + ';',
    typeStyle: 'background: ' + color + ';'
  })
}

Page({
  data: {
    playerSection: 'friends',
    friendSection: 'feed',
    friendsLoaded: false,
    socialUserId: '',
    query: '',
    selectedType: '',
    typeFilters: [],
    players: [],
    hasLoaded: false,
    emptyStateTitle: '还没有玩家 note',
    emptyStateText: '记录线下常遇到的玩家、leak 和你们打过的关键手牌。',
    isSearching: false,
    socialUnread: { count: 0, label: '', hasUnread: false },
    onboardingGuideVisible: false,
    onboardingGuideStep: null
  },

  async onLoad() {
    this._socialProfileAttached = true
    this.bindSocialUnread()
    const socialAccountKey = getSocialAccountKey()
    socialUnreadState.setAccountKey(socialAccountKey)
    await this.ensureSocialProfile(socialAccountKey)
    if (this.data.playerSection === 'library') await this.refresh()
  },

  async onReady() {
    this.syncOnboardingGuide()
  },

  async onShow() {
    this._socialProfileAttached = true
    this.bindSocialUnread()
    const socialAccountKey = getSocialAccountKey()
    socialUnreadState.setAccountKey(socialAccountKey)
    if (socialAccountKey) socialUnreadState.refresh().catch(() => {})
    await this.ensureSocialProfile(socialAccountKey)
    tabBar.syncCustomTabBar('/pages/player-notes/player-notes')
    if (this.data.playerSection === 'library') await this.refresh()
    if (this.data.playerSection === 'friends' && this.data.friendSection === 'friends' && this.data.friendsLoaded) {
      await this.ensureFriendsLoaded(true)
    }
    this.syncOnboardingGuide()
  },

  onHide() {
    this._socialProfileAttached = false
    this._socialProfileGeneration = (Number(this._socialProfileGeneration) || 0) + 1
    this._socialProfileFlight = null
    this.unbindSocialUnread()
  },

  onUnload() {
    this._socialProfileAttached = false
    this._socialProfileGeneration = (Number(this._socialProfileGeneration) || 0) + 1
    this._socialProfileFlight = null
    this.unbindSocialUnread()
  },

  async onPullDownRefresh() {
    try {
      if (this.data.playerSection !== 'friends' || this.data.friendSection !== 'feed') return
      const friendHub = this.selectComponent && this.selectComponent('#friendHub')
      if (friendHub && typeof friendHub.refreshFeed === 'function') await friendHub.refreshFeed()
    } finally {
      if (typeof wx !== 'undefined' && typeof wx.stopPullDownRefresh === 'function') wx.stopPullDownRefresh()
    }
  },

  ensureSocialProfile(accountKey) {
    const currentAccountKey = String(accountKey === undefined ? getSocialAccountKey() : accountKey || '')
    const previousAccountKey = String(this._socialProfileAccountKey || '')
    if (previousAccountKey !== currentAccountKey) {
      const previousSocialUserId = String(this.data.socialUserId || '')
      if (previousSocialUserId) socialCache.removeFeedFirstPage(previousSocialUserId)
      this._socialProfileAccountKey = currentAccountKey
      this._socialProfileGeneration = (Number(this._socialProfileGeneration) || 0) + 1
      this._socialProfileFlight = null
      this.setData({ socialUserId: '' })
    }
    if (!currentAccountKey || this._socialProfileAttached !== true) return Promise.resolve('')
    if (this.data.socialUserId) return Promise.resolve(this.data.socialUserId)
    if (this._socialProfileFlight) return this._socialProfileFlight
    const generation = Number(this._socialProfileGeneration) || 0
    const promise = Promise.resolve()
      .then(() => socialService.getMySocialProfile())
      .then(profile => {
        const socialUserId = String(profile && profile.socialUserId || '')
        if (this._socialProfileAttached !== true || generation !== this._socialProfileGeneration || currentAccountKey !== this._socialProfileAccountKey) return ''
        this.setData({ socialUserId })
        return socialUserId
      })
      .catch(() => {
        if (this._socialProfileAttached === true && generation === this._socialProfileGeneration && currentAccountKey === this._socialProfileAccountKey) {
          this.setData({ socialUserId: '' })
        }
        return ''
      })
    this._socialProfileFlight = promise
    promise.finally(() => {
      if (this._socialProfileFlight === promise) this._socialProfileFlight = null
    })
    return promise
  },

  bindSocialUnread() {
    if (this._unsubscribeSocialUnread) return
    this._unsubscribeSocialUnread = socialUnreadState.subscribe(snapshot => {
      this.setData({ socialUnread: snapshot })
    })
  },

  unbindSocialUnread() {
    if (!this._unsubscribeSocialUnread) return
    this._unsubscribeSocialUnread()
    this._unsubscribeSocialUnread = null
  },

  async ensureFriendsLoaded(force) {
    if (this.data.friendsLoaded && !force) return
    const friendHub = this.selectComponent && this.selectComponent('#friendHub')
    if (!friendHub || typeof friendHub.loadFriends !== 'function') return
    await friendHub.loadFriends(!!force)
    if (friendHub.data && friendHub.data.status === 'ready') this.setData({ friendsLoaded: true })
  },

  async selectPlayerSection(event) {
    const section = String(event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.section || 'friends')
    if (section !== 'friends' && section !== 'library') return
    this.setData({ playerSection: section })
    if (section === 'friends') {
      await this.ensureFriendsLoaded()
      return
    }
    await this.refresh()
  },

  selectFriendSection(event) {
    const section = String(event && event.detail && event.detail.section || 'friends')
    this.setData({ friendSection: section })
    if (section === 'friends') return this.ensureFriendsLoaded()
  },

  syncOnboardingGuide() {
    if (dataService.refreshOnboardingGuideContext) dataService.refreshOnboardingGuideContext()
    const step = onboardingGuide.getStepForRoute('pages/player-notes/player-notes')
    this.setData({
      onboardingGuideVisible: !!step,
      onboardingGuideStep: step
    })
  },

  onOnboardingNext() {
    const result = onboardingGuide.advanceGuide()
    if (result.done) {
      this.syncOnboardingGuide()
      return
    }
    if (!onboardingGuide.navigateToStep(result.step)) this.syncOnboardingGuide()
  },

  onOnboardingSkip() {
    onboardingGuide.dismissGuide()
    this.syncOnboardingGuide()
  },

  async refresh() {
    const settings = await dataService.getAppSettings()
    const notes = await dataService.getPlayerNotes({
      query: this.data.query,
      type: this.data.selectedType,
      sourceKind: 'library'
    })
    const isSearching = !!(this.data.query || this.data.selectedType)
    this.setData({
      typeFilters: buildTypeFilters(settings, this.data.selectedType),
      players: notes.map(buildListItem),
      hasLoaded: true,
      isSearching,
      emptyStateTitle: isSearching ? '没有匹配的玩家' : '还没有玩家 note',
      emptyStateText: isSearching ? '换一个关键词或玩家类型再试。' : '记录线下常遇到的玩家、leak 和你们打过的关键手牌。'
    })
    avatarCache.warmPlayerAvatars(notes, () => {
      this.setData({ players: notes.map(buildListItem) })
    })
  },

  onSearchInput(event) {
    this.setData({ query: event.detail.value || '' })
    this.refresh()
  },

  clearSearch() {
    this.setData({ query: '', selectedType: '' })
    this.refresh()
  },

  selectType(event) {
    this.setData({ selectedType: event.currentTarget.dataset.type || '' })
    this.refresh()
  },

  openCreate() {
    wx.navigateTo({ url: '/pages/player-note-detail/player-note-detail?mode=new' })
  },

  openInvite() {
    wx.navigateTo({ url: '/pages/social-invite/social-invite' })
  },

  openDetail(event) {
    const id = event.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: '/pages/player-note-detail/player-note-detail?id=' + encodeURIComponent(id) })
  },

  openFriend(event) {
    const friendUserId = String(event && event.detail && event.detail.friendUserId || '')
    if (!friendUserId) return
    wx.navigateTo({ url: '/pages/player-note-detail/player-note-detail?friendUserId=' + encodeURIComponent(friendUserId) })
  },

  openHand(event) {
    const shareId = String(event && event.detail && event.detail.shareId || '')
    if (!shareId) return
    wx.navigateTo({ url: '/pages/social-hand-detail/social-hand-detail?shareId=' + encodeURIComponent(shareId) })
  },

  openMessages() {
    if (typeof wx !== 'undefined' && wx.navigateTo) wx.navigateTo({ url: '/pages/social-messages/social-messages' })
  }
})
