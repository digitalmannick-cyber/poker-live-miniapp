const dataService = require('../../services/data-service')
const tabBar = require('../../utils/tab-bar')
const avatarCache = require('../../utils/player-avatar-cache')
const onboardingGuide = require('../../utils/onboarding-guide')

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
    query: '',
    selectedType: '',
    typeFilters: [],
    players: [],
    hasLoaded: false,
    emptyStateTitle: '还没有玩家 note',
    emptyStateText: '记录线下常遇到的玩家、leak 和你们打过的关键手牌。',
    isSearching: false,
    onboardingGuideVisible: false,
    onboardingGuideStep: null
  },

  async onLoad() {
    await this.refresh()
  },

  async onShow() {
    tabBar.syncCustomTabBar('/pages/player-notes/player-notes')
    await this.refresh()
    this.syncOnboardingGuide()
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
      type: this.data.selectedType
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

  openDetail(event) {
    const id = event.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: '/pages/player-note-detail/player-note-detail?id=' + encodeURIComponent(id) })
  }
})
