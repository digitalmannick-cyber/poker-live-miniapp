const dataService = require('../../services/data-service')
const tabBar = require('../../utils/tab-bar')
const playerTitle = require('../../utils/player-title')
const appVersion = require('../../config/app-version')
const { AI_REMINDER_SUBSCRIBE_TEMPLATE_ID } = require('../../config/cloud')
const onboardingGuide = require('../../utils/onboarding-guide')
const releaseNotes = require('../../utils/release-notes')

const WECHAT_PROFILE_PROMPT_SEEN_KEY = 'pokerLiveWechatProfilePromptSeen'
const OPEN_AI_REMINDER_EDITOR_KEY = 'pokerLiveOpenAiReminderEditor'
const initialProfileStats = dataService.getProfileStatsSnapshot()

function formatProfit(value, unit) {
  const amount = Number(value) || 0
  const sign = amount > 0 ? '+' : amount < 0 ? '-' : ''
  const abs = Math.abs(amount)
  if (unit === 'CNY') {
    return sign + '¥' + abs
  }
  if (unit === 'HKD') {
    return sign + 'HK$' + abs
  }
  if (unit === 'USD') {
    return sign + '$' + abs
  }
  return sign + abs + ' BB'
}

function getUnitLabel(unit) {
  if (unit === 'CNY') return '¥'
  if (unit === 'HKD') return 'HK$'
  if (unit === 'USD') return '$'
  return 'BB'
}

function createEditableItems(list) {
  return (list || []).map((value, index) => ({
    id: 'item_' + Date.now() + '_' + index + '_' + Math.floor(Math.random() * 10000),
    value: String(value || '').trim()
  }))
}

function numberValue(value) {
  const amount = Number(value)
  return Number.isFinite(amount) && amount > 0 ? amount : 0
}

function ruleSubscribeValue(rule) {
  return !!(rule && rule.subscribeMessage)
}

function isSubscribeMessageAvailable() {
  return !!String(AI_REMINDER_SUBSCRIBE_TEMPLATE_ID || '').trim()
}

function getAiReminderSubscribeRejectTitle(result) {
  const status = String(result && result.status || '').toLowerCase()
  const message = String(result && result.message || '').toLowerCase()
  if (status === 'skipped' && message.indexOf('template') > -1) {
    return '模板未配置'
  }
  if (status === 'skipped' || message.indexOf('unavailable') > -1) {
    return '请用真机授权'
  }
  if (message.indexOf('template') > -1 || message.indexOf('tmpl') > -1) {
    return '模板不可用'
  }
  if (message.indexOf('cancel') > -1 || message.indexOf('reject') > -1 || status === 'rejected') {
    return '需点击允许'
  }
  if (status === 'failed') {
    return '授权失败'
  }
  return '未授权'
}

function isAiReminderTemplateUnavailable(result) {
  const message = String(result && result.message || '').toLowerCase()
  return message.indexOf('template') > -1 || message.indexOf('tmpl') > -1 || message.indexOf('invalid') > -1 || message.indexOf('not exist') > -1
}

function showAiReminderSubscribeReject(result) {
  if (isAiReminderTemplateUnavailable(result)) {
    wx.showModal({
      title: '微信消息模板不可用',
      content: '当前模板 ID 无法用于这个小程序预览包：\n' + AI_REMINDER_SUBSCRIBE_TEMPLATE_ID + '\n\n请在微信小程序后台确认该模板已加入“我的模板”，且属于当前 AppID；如果重新选了模板，需要同步更新 config/cloud.js 和云函数环境变量。',
      showCancel: false,
      confirmText: '知道了'
    })
    return
  }
  wx.showToast({ title: getAiReminderSubscribeRejectTitle(result), icon: 'none' })
}

function getCloudSettingsSyncFailContent(error) {
  const code = String(error && (error.code || error.errCode || error.raw && error.raw.code) || '').trim()
  const message = String(error && (error.message || error.errMsg || error.raw && error.raw.message) || '').trim()
  const reason = [code, message].filter(Boolean).join('：') || '未知错误'
  return '本地配置已保存，但云端同步失败。\n\n错误：' + reason + '\n\n如果刚更新过预览，请退出小程序后重新扫码进入，再保存一次。'
}

function isStorageEntryLimitError(error) {
  const message = String(error && (error.message || error.errMsg || error.raw && error.raw.message) || '').toLowerCase()
  return message.indexOf('setstoragesync') > -1 || message.indexOf('entry size limit') > -1
}

function getSettingsSaveFailTitle(error) {
  return isStorageEntryLimitError(error) ? '本地保存失败' : '云端同步失败'
}

function getSettingsSaveFailContent(error) {
  if (!isStorageEntryLimitError(error)) return getCloudSettingsSyncFailContent(error)
  const message = String(error && (error.message || error.errMsg || error.raw && error.raw.message) || '').trim() || '本地缓存单条记录超限'
  return '配置没有保存成功。\n\n错误：' + message + '\n\n请重新进入最新预览后再保存。'
}

function showAiReminderSubscribeUnavailable() {
  wx.showModal({
    title: '微信消息未配置',
    content: '当前预览包没有拿到有效的微信消息模板 ID。请退出小程序后重新扫码进入最新预览；如果仍出现这个提示，需要检查 config/cloud.js 的模板 ID 是否随预览包生效。',
    showCancel: false,
    confirmText: '知道了'
  })
}

function buildAiReminderDraft(settings) {
  const source = (settings && settings.aiReminders) || {}
  const rules = source.rules || {}
  const subscribeMessageAvailable = isSubscribeMessageAvailable()
  return {
    enabled: source.enabled !== false,
    subscribeMessageAvailable,
    textReminders: (Array.isArray(source.textReminders) ? source.textReminders : []).map((item, index) => ({
      id: item.id || ('text_' + Date.now() + '_' + index),
      title: String(item.title || '').trim(),
      content: String(item.content || '').trim(),
      enabled: item.enabled !== false,
      evBrain: item.evBrain === true || source.openAgentOnTrigger === true,
      subscribeMessage: subscribeMessageAvailable && ruleSubscribeValue(item)
    })),
    rules: {
      profitTarget: { amount: numberValue(rules.profitTarget && rules.profitTarget.amount), evBrain: rules.profitTarget && rules.profitTarget.evBrain === true || source.openAgentOnTrigger === true, subscribeMessage: subscribeMessageAvailable && ruleSubscribeValue(rules.profitTarget) },
      lossLimit: { amount: numberValue(rules.lossLimit && rules.lossLimit.amount), evBrain: rules.lossLimit && rules.lossLimit.evBrain === true || source.openAgentOnTrigger === true, subscribeMessage: subscribeMessageAvailable && ruleSubscribeValue(rules.lossLimit) },
      trailingProfit: { percent: numberValue(rules.trailingProfit && rules.trailingProfit.percent), evBrain: rules.trailingProfit && rules.trailingProfit.evBrain === true || source.openAgentOnTrigger === true, subscribeMessage: subscribeMessageAvailable && ruleSubscribeValue(rules.trailingProfit) },
      postLossExtraRisk: { percent: numberValue(rules.postLossExtraRisk && rules.postLossExtraRisk.percent), evBrain: rules.postLossExtraRisk && rules.postLossExtraRisk.evBrain === true || source.openAgentOnTrigger === true, subscribeMessage: subscribeMessageAvailable && ruleSubscribeValue(rules.postLossExtraRisk) },
      sessionPreReminder: { hoursBefore: numberValue(rules.sessionPreReminder && rules.sessionPreReminder.hoursBefore), evBrain: rules.sessionPreReminder && rules.sessionPreReminder.evBrain === true || source.openAgentOnTrigger === true, subscribeMessage: subscribeMessageAvailable && ruleSubscribeValue(rules.sessionPreReminder) },
      sessionMaxHours: { hours: numberValue(rules.sessionMaxHours && rules.sessionMaxHours.hours), evBrain: rules.sessionMaxHours && rules.sessionMaxHours.evBrain === true || source.openAgentOnTrigger === true, subscribeMessage: subscribeMessageAvailable && ruleSubscribeValue(rules.sessionMaxHours) }
    }
  }
}

function buildAiReminderSettingsFromDraft(draft, currentSettings) {
  const current = (currentSettings && currentSettings.aiReminders) || {}
  const rules = draft.rules || {}
  const subscribeMessageAvailable = !!draft.subscribeMessageAvailable
  return Object.assign({}, current, {
    enabled: draft.enabled !== false,
    openAgentOnTrigger: false,
    extraChannels: {
      subscribeMessage: false
    },
    rules: {
      profitTarget: { amount: numberValue(rules.profitTarget && rules.profitTarget.amount), evBrain: !!(rules.profitTarget && rules.profitTarget.evBrain), subscribeMessage: subscribeMessageAvailable && ruleSubscribeValue(rules.profitTarget) },
      lossLimit: { amount: numberValue(rules.lossLimit && rules.lossLimit.amount), evBrain: !!(rules.lossLimit && rules.lossLimit.evBrain), subscribeMessage: subscribeMessageAvailable && ruleSubscribeValue(rules.lossLimit) },
      trailingProfit: { percent: numberValue(rules.trailingProfit && rules.trailingProfit.percent), evBrain: !!(rules.trailingProfit && rules.trailingProfit.evBrain), subscribeMessage: subscribeMessageAvailable && ruleSubscribeValue(rules.trailingProfit) },
      postLossExtraRisk: { percent: numberValue(rules.postLossExtraRisk && rules.postLossExtraRisk.percent), evBrain: !!(rules.postLossExtraRisk && rules.postLossExtraRisk.evBrain), subscribeMessage: subscribeMessageAvailable && ruleSubscribeValue(rules.postLossExtraRisk) },
      sessionPreReminder: { hoursBefore: numberValue(rules.sessionPreReminder && rules.sessionPreReminder.hoursBefore), evBrain: !!(rules.sessionPreReminder && rules.sessionPreReminder.evBrain), subscribeMessage: subscribeMessageAvailable && ruleSubscribeValue(rules.sessionPreReminder) },
      sessionMaxHours: { hours: numberValue(rules.sessionMaxHours && rules.sessionMaxHours.hours), evBrain: !!(rules.sessionMaxHours && rules.sessionMaxHours.evBrain), subscribeMessage: subscribeMessageAvailable && ruleSubscribeValue(rules.sessionMaxHours) }
    },
    textReminders: (Array.isArray(draft.textReminders) ? draft.textReminders : [])
      .map((item, index) => ({
        id: item.id || ('text_' + Date.now() + '_' + index),
        title: String(item.title || '').trim(),
        content: String(item.content || '').trim(),
        enabled: item.enabled !== false,
        evBrain: item.evBrain === true,
        subscribeMessage: subscribeMessageAvailable && ruleSubscribeValue(item)
      }))
      .filter(item => item.title || item.content)
  })
}

function showEditableModal(options) {
  return new Promise(resolve => {
    wx.showModal(Object.assign({}, options, {
      editable: true,
      success: resolve,
      fail: () => resolve({ confirm: false })
    }))
  })
}

function saveAvatarFile(tempFilePath) {
  return new Promise(resolve => {
    if (!tempFilePath) {
      resolve('')
      return
    }
    wx.saveFile({
      tempFilePath,
      success: res => resolve(res.savedFilePath || tempFilePath),
      fail: () => resolve(tempFilePath)
    })
  })
}

function getAvatarText(name) {
  const text = String(name || '').trim()
  return text ? text.slice(0, 2) : 'PL'
}

function isDefaultWechatName(name) {
  const text = String(name || '').trim()
  return !text || text === '\u73a9\u5bb6' || text === '\u5fae\u4fe1\u7528\u6237'
}

function getWechatDraftNickname(profile) {
  const name = String(profile && profile.name || '').trim()
  return isDefaultWechatName(name) ? '' : name
}

function isWechatProfileIncomplete(profile) {
  const name = String(profile && profile.name || '').trim()
  const avatarUrl = String(profile && profile.avatarUrl || '').trim()
  return isDefaultWechatName(name) || !avatarUrl
}

function shouldShowWechatProfilePrompt(profile) {
  if (wx.getStorageSync(WECHAT_PROFILE_PROMPT_SEEN_KEY)) {
    return false
  }
  return isWechatProfileIncomplete(profile)
}

Page({
  data: {
    agentChatReady: false,
    version: appVersion.displayVersion,
    profile: {
      name: '玩家',
      playerId: '',
      title: '怪盗团新兵',
      avatarText: 'PL',
      avatarUrl: ''
    },
    settings: {
      chipUnit: 'BB',
      venues: [],
      blindPresets: [],
      positions: [],
      opponentTypes: []
    },
    stats: {
      handCount: initialProfileStats ? initialProfileStats.handCount : 0,
      totalProfit: initialProfileStats ? initialProfileStats.totalProfit : 0,
      totalHours: initialProfileStats ? initialProfileStats.totalHours : '0.0'
    },
    titleProgress: playerTitle.resolvePlayerTitle(initialProfileStats && initialProfileStats.totalHours),
    titleStatsReady: !!initialProfileStats,
    titleStatsUnavailable: false,
    titleRouteVisible: false,
    settingsEditorVisible: false,
    settingsEditorKey: '',
    settingsEditorTitle: '',
    settingsEditorPlaceholder: '',
    settingsEditorItems: [],
    settingsEditorNewValue: '',
    aiReminderEditorVisible: false,
    aiReminderDraft: buildAiReminderDraft({}),
    profileEditorVisible: false,
    profileEditorName: '',
    accountLoggedOut: false,
    testAccountActive: false,
    importingPbtPlayerData: false,
    wechatProfilePromptVisible: false,
    wechatProfileDialogVisible: false,
    wechatDraftNickname: '',
    wechatDraftAvatarUrl: '',
    syncingWechatProfile: false,
    releaseNotesVisible: false,
    releaseNotes: releaseNotes.getCurrentReleaseNotes(),
    totalProfitDisplay: '0 BB',
    unitLabel: 'BB',
    unitOptions: [
      { label: 'BB', value: 'BB' },
      { label: '¥', value: 'CNY' },
      { label: 'HK$', value: 'HKD' },
      { label: '$', value: 'USD' }
    ]
  },

  async onShow() {
    tabBar.syncCustomTabBar('/pages/profile/profile')
    await this.refresh()
    this.consumeOpenAiReminderEditorRequest()
    this.maybeShowReleaseNotes()
  },
  onReady() {
    setTimeout(() => {
      if (!this.data.agentChatReady) {
        this.setData({ agentChatReady: true })
      }
    }, 240)
  },

  async refresh() {
    const cachedData = await dataService.getProfilePageData({ preferCache: true })
    if (!(cachedData && cachedData.stats && cachedData.stats.statsUnavailable)) {
      this.applyProfilePageData(cachedData)
    }
    dataService.getProfilePageData({ forceRefresh: true })
      .then(data => this.applyProfilePageData(data))
      .catch(error => {
        console.warn('refresh profile stats failed', error)
      })
  },

  consumeOpenAiReminderEditorRequest() {
    if (typeof wx === 'undefined' || !wx.getStorageSync) return
    let shouldOpen = false
    try {
      shouldOpen = wx.getStorageSync(OPEN_AI_REMINDER_EDITOR_KEY) === '1'
      if (shouldOpen && wx.removeStorageSync) {
        wx.removeStorageSync(OPEN_AI_REMINDER_EDITOR_KEY)
      }
    } catch (error) {
      shouldOpen = false
    }
    if (!shouldOpen) return
    setTimeout(() => {
      this.openAiReminderEditor()
    }, 180)
  },

  applyProfilePageData(data) {
    const nextView = {
      profile: data.profile,
      settings: data.settings,
      stats: data.stats,
      titleProgress: playerTitle.resolvePlayerTitle(data.stats.totalHours),
      titleStatsReady: !data.stats.statsUnavailable,
      titleStatsUnavailable: !!data.stats.statsUnavailable,
      accountLoggedOut: !!data.accountLoggedOut,
      testAccountActive: !!data.testAccountActive,
      wechatProfilePromptVisible: !data.accountLoggedOut && shouldShowWechatProfilePrompt(data.profile),
      totalProfitDisplay: formatProfit(data.stats.totalProfit, data.settings.chipUnit),
      unitLabel: getUnitLabel(data.settings.chipUnit)
    }
    const renderKey = JSON.stringify(nextView)
    if (renderKey === this.profileRenderKey) return
    this.profileRenderKey = renderKey
    this.setData(nextView)
  },

  async loginWithWechatAccount() {
    if (this.data.syncingWechatProfile) return
    this.setData({ syncingWechatProfile: true })
    wx.showLoading({ title: '登录中', mask: true })
    let ok = false
    try {
      ok = await dataService.loginWechatAccount({ manual: true })
    } catch (error) {
      ok = false
    } finally {
      wx.hideLoading()
      this.setData({ syncingWechatProfile: false })
    }
    if (!ok) {
      wx.showToast({ title: '登录失败', icon: 'none' })
      return
    }
    await this.refresh()
    wx.showToast({ title: '登录成功', icon: 'success' })
    const profile = this.data.profile || {}
    if (isWechatProfileIncomplete(profile)) {
      this.setData({
        wechatProfileDialogVisible: true,
        wechatProfilePromptVisible: false,
        wechatDraftNickname: getWechatDraftNickname(profile),
        wechatDraftAvatarUrl: profile.avatarUrl || ''
      })
      return
    }
    this.maybeShowReleaseNotes()
  },

  async logoutAccount() {
    wx.showModal({
      title: '退出登录',
      content: '只清除本机登录态和本地缓存，不删除云端历史牌局。再次使用当前微信登录后可恢复。',
      confirmText: '退出',
      confirmColor: '#e60012',
      success: async res => {
        if (!res.confirm) return
        await dataService.logoutAccount()
        wx.removeStorageSync(WECHAT_PROFILE_PROMPT_SEEN_KEY)
        wx.showToast({ title: '已退出', icon: 'success' })
        this.refresh()
      }
    })
  },

  async switchToTestAccount() {
    wx.showModal({
      title: '切换测试账号',
      content: '会先备份当前本地数据，然后切到一个空的测试账号。开发者工具微信账号不会变化，真实云端数据不会被删除。',
      confirmText: '切换',
      confirmColor: '#00d1ff',
      success: async res => {
        if (!res.confirm) return
        await dataService.switchToTestAccount()
        wx.showToast({ title: '已切到测试账号', icon: 'success' })
        this.refresh()
      }
    })
  },

  async exitTestAccount() {
    wx.showModal({
      title: '退出测试账号',
      content: '将恢复切换前备份的本地账号和数据。',
      confirmText: '恢复',
      confirmColor: '#00d1ff',
      success: async res => {
        if (!res.confirm) return
        await dataService.exitTestAccount()
        wx.showToast({ title: '已恢复原账号', icon: 'success' })
        this.refresh()
      }
    })
  },

  async editName() {
    if (this.data.accountLoggedOut) {
      this.loginWithWechatAccount()
      return
    }
    const res = await showEditableModal({
      title: '修改玩家名字',
      placeholderText: '例如 玩家 / 怪盗 Joker',
      content: this.data.profile.name || ''
    })
    if (!res.confirm || !res.content) return
    await dataService.updateProfile({
      name: res.content.trim(),
      avatarText: res.content.trim().slice(0, 2)
    })
    this.refresh()
  },

  copyPlayerId() {
    const playerId = this.data.profile.playerId || ''
    if (!playerId) return
    wx.setClipboardData({
      data: playerId,
      success: () => {
        wx.showToast({ title: 'UID 已复制', icon: 'success' })
      }
    })
  },

  openProfileEditor() {
    if (this.data.accountLoggedOut) {
      this.loginWithWechatAccount()
      return
    }
    this.setData({
      profileEditorVisible: true,
      profileEditorName: this.data.profile.name || ''
    })
  },

  closeProfileEditor() {
    this.setData({
      profileEditorVisible: false,
      profileEditorName: ''
    })
  },

  onProfileEditorNameInput(e) {
    this.setData({ profileEditorName: e.detail.value || '' })
  },

  async saveProfileEditor() {
    const name = String(this.data.profileEditorName || '').trim()
    if (!name) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' })
      return
    }
    await dataService.updateProfile({
      name,
      avatarText: getAvatarText(name)
    })
    this.closeProfileEditor()
    wx.showToast({ title: '资料已保存', icon: 'success' })
    this.refresh()
  },

  openTitleRoute() {
    if (this.data.titleStatsUnavailable) return
    this.setData({ titleRouteVisible: true })
  },

  closeTitleRoute() {
    this.setData({ titleRouteVisible: false })
  },

  syncWechatProfile() {
    wx.showModal({
      title: '同步微信资料',
      content: '微信现在需要分别授权头像和昵称：点头像选择微信头像，再点昵称输入框选择或输入微信昵称。',
      showCancel: false,
      confirmText: '知道了'
    })
  },

  openWechatProfilePrompt() {
    this.setData({
      wechatProfileDialogVisible: true
    })
  },

  closeWechatProfilePrompt() {
    wx.setStorageSync(WECHAT_PROFILE_PROMPT_SEEN_KEY, true)
    this.setData({
      wechatProfilePromptVisible: false,
      wechatProfileDialogVisible: false,
      wechatDraftNickname: '',
      wechatDraftAvatarUrl: ''
    })
    this.maybeShowReleaseNotes()
  },

  onChooseWechatAvatar(e) {
    const avatarUrl = e && e.detail && e.detail.avatarUrl || ''
    if (!avatarUrl) return
    this.setData({ wechatDraftAvatarUrl: avatarUrl })
  },

  onWechatNicknameInput(e) {
    this.setData({ wechatDraftNickname: e && e.detail && e.detail.value || '' })
  },

  async saveWechatProfileFromOfficialControls() {
    const name = String(this.data.wechatDraftNickname || '').trim()
    const avatarUrl = String(this.data.wechatDraftAvatarUrl || '').trim()
    if (!name && !avatarUrl) {
      wx.showToast({ title: '请选择头像或填写昵称', icon: 'none' })
      return
    }
    await dataService.updateProfile({
      name: name || this.data.profile.name,
      avatarText: getAvatarText(name || this.data.profile.name),
      avatarUrl: avatarUrl || this.data.profile.avatarUrl
    })
    wx.setStorageSync(WECHAT_PROFILE_PROMPT_SEEN_KEY, true)
    this.setData({
      wechatProfilePromptVisible: false,
      wechatProfileDialogVisible: false,
      wechatDraftNickname: '',
      wechatDraftAvatarUrl: ''
    })
    wx.showToast({ title: '微信资料已同步', icon: 'success' })
    this.refresh()
    this.maybeShowReleaseNotes()
  },

  maybeShowReleaseNotes(options) {
    const manual = !!(options && options.manual)
    if (!manual && (this.data.wechatProfileDialogVisible || this.data.profileEditorVisible || this.data.aiReminderEditorVisible || this.data.settingsEditorVisible)) {
      return false
    }
    const context = {
      playerId: this.data.profile && this.data.profile.playerId || dataService.getCurrentPlayerId(),
      accountLoggedOut: this.data.accountLoggedOut,
      manual
    }
    const visible = releaseNotes.shouldShowReleaseNotes(context)
    if (visible) {
      this.setData({
        releaseNotesVisible: true,
        releaseNotes: releaseNotes.getCurrentReleaseNotes()
      })
    }
    return visible
  },

  openReleaseNotes() {
    this.maybeShowReleaseNotes({ manual: true })
  },

  acknowledgeReleaseNotes() {
    const result = releaseNotes.acknowledgeReleaseNotes({
      playerId: this.data.profile && this.data.profile.playerId || dataService.getCurrentPlayerId(),
      accountLoggedOut: this.data.accountLoggedOut
    })
    if (!result.ok) {
      wx.showToast({ title: '确认失败，请重试', icon: 'none' })
      return
    }
    this.setData({ releaseNotesVisible: false })
  },

  chooseLocalAvatar() {
    wx.showActionSheet({
      itemList: ['从相册选择头像', '拍照更换头像'],
      success: res => {
        const sourceType = res.tapIndex === 1 ? ['camera'] : ['album']
        wx.chooseImage({
          count: 1,
          sizeType: ['compressed'],
          sourceType,
          success: async imageRes => {
            const tempFilePath = imageRes.tempFilePaths && imageRes.tempFilePaths[0]
            const avatarUrl = await saveAvatarFile(tempFilePath)
            if (!avatarUrl) return
            await dataService.updateProfile({ avatarUrl })
            this.refresh()
          }
        })
      }
    })
  },

  async selectChipUnit(e) {
    const value = e.currentTarget.dataset.value
    const settings = await dataService.updateSettings({ chipUnit: value })
    this.setData({
      settings,
      totalProfitDisplay: formatProfit(this.data.stats.totalProfit, settings.chipUnit),
      unitLabel: getUnitLabel(settings.chipUnit)
    })
  },

  openAiReminderEditor() {
    const aiReminderSettings = (this.data.settings && this.data.settings.aiReminders) || {}
    if (aiReminderSettings.enabled === false) {
      return
    }
    this.setData({
      aiReminderEditorVisible: true,
      aiReminderDraft: buildAiReminderDraft(this.data.settings)
    })
  },

  closeAiReminderEditor() {
    this.setData({
      aiReminderEditorVisible: false,
      aiReminderDraft: buildAiReminderDraft(this.data.settings)
    })
  },

  toggleAiReminderEnabled() {
    const draft = Object.assign({}, this.data.aiReminderDraft || {})
    draft.enabled = draft.enabled === false
    this.setData({ aiReminderDraft: draft })
  },

  toggleAiReminderRuleEvBrain(e) {
    const key = String(e.currentTarget.dataset.key || '').trim()
    const draft = JSON.parse(JSON.stringify(this.data.aiReminderDraft || buildAiReminderDraft(this.data.settings)))
    if (!draft.rules || !draft.rules[key]) return
    draft.rules[key].evBrain = draft.rules[key].evBrain !== true
    this.setData({ aiReminderDraft: draft })
  },

  toggleAiReminderTextEvBrain(e) {
    const index = Number(e.currentTarget.dataset.index)
    const draft = JSON.parse(JSON.stringify(this.data.aiReminderDraft || buildAiReminderDraft(this.data.settings)))
    const list = Array.isArray(draft.textReminders) ? draft.textReminders : []
    if (!Number.isInteger(index) || !list[index]) return
    list[index].evBrain = list[index].evBrain !== true
    draft.textReminders = list
    this.setData({ aiReminderDraft: draft })
  },

  async toggleAiReminderMasterSwitch() {
    const currentSettings = this.data.settings || {}
    const currentAiReminders = currentSettings.aiReminders || {}
    const nextEnabled = currentAiReminders.enabled === false
    const nextAiReminders = Object.assign({}, currentAiReminders, {
      enabled: nextEnabled
    })
    try {
      const settings = await dataService.updateSettings({ aiReminders: nextAiReminders })
      this.setData({
        settings,
        aiReminderDraft: buildAiReminderDraft(settings),
        aiReminderEditorVisible: nextEnabled
      })
    } catch (error) {
      const localSettings = error && error.localSettings
      if (localSettings) {
        this.setData({
          settings: localSettings,
          aiReminderDraft: buildAiReminderDraft(localSettings),
          aiReminderEditorVisible: nextEnabled
        })
      }
      wx.showModal({
        title: getSettingsSaveFailTitle(error),
        content: getSettingsSaveFailContent(error),
        showCancel: false,
        confirmText: '知道了'
      })
    }
  },

  async requestAiReminderSubscribeForDraft() {
    wx.showLoading({ title: '请求微信授权', mask: false })
    let result = null
    try {
      result = await dataService.requestAiReminderSubscribePermission(AI_REMINDER_SUBSCRIBE_TEMPLATE_ID)
      if (result && result.accepted) {
        return true
      }
    } finally {
      wx.hideLoading()
    }
    console.warn('ai reminder subscribe permission rejected', result)
    showAiReminderSubscribeReject(result)
    return false
  },

  async toggleAiReminderRuleSubscribeMessage(e) {
    if (!this.data.aiReminderDraft.subscribeMessageAvailable) {
      showAiReminderSubscribeUnavailable()
      return
    }
    const key = String(e.currentTarget.dataset.key || '').trim()
    const draft = JSON.parse(JSON.stringify(this.data.aiReminderDraft || buildAiReminderDraft(this.data.settings)))
    if (!draft.rules || !draft.rules[key]) return
    const nextValue = !draft.rules[key].subscribeMessage
    if (nextValue) {
      const canEnable = await this.requestAiReminderSubscribeForDraft()
      if (!canEnable) return
    }
    draft.rules[key].subscribeMessage = nextValue
    this.setData({ aiReminderDraft: draft })
  },

  async toggleAiReminderTextSubscribeMessage(e) {
    if (!this.data.aiReminderDraft.subscribeMessageAvailable) {
      showAiReminderSubscribeUnavailable()
      return
    }
    const index = Number(e.currentTarget.dataset.index)
    const draft = JSON.parse(JSON.stringify(this.data.aiReminderDraft || buildAiReminderDraft(this.data.settings)))
    const list = Array.isArray(draft.textReminders) ? draft.textReminders : []
    if (!Number.isInteger(index) || !list[index]) return
    const nextValue = !list[index].subscribeMessage
    if (nextValue) {
      const canEnable = await this.requestAiReminderSubscribeForDraft()
      if (!canEnable) return
    }
    list[index].subscribeMessage = nextValue
    draft.textReminders = list
    this.setData({ aiReminderDraft: draft })
  },

  onAiReminderNumberInput(e) {
    const key = String(e.currentTarget.dataset.key || '').trim()
    const value = numberValue(e.detail.value)
    const draft = JSON.parse(JSON.stringify(this.data.aiReminderDraft || buildAiReminderDraft(this.data.settings)))
    if (key === 'profitTarget') draft.rules.profitTarget.amount = value
    if (key === 'lossLimit') draft.rules.lossLimit.amount = value
    if (key === 'trailingProfit') draft.rules.trailingProfit.percent = value
    if (key === 'postLossExtraRisk') draft.rules.postLossExtraRisk.percent = value
    if (key === 'sessionPreReminder') draft.rules.sessionPreReminder.hoursBefore = value
    if (key === 'sessionMaxHours') draft.rules.sessionMaxHours.hours = value
    this.setData({ aiReminderDraft: draft })
  },

  onAiReminderTextInput(e) {
    const index = Number(e.currentTarget.dataset.index)
    const field = String(e.currentTarget.dataset.field || '').trim()
    const draft = JSON.parse(JSON.stringify(this.data.aiReminderDraft || buildAiReminderDraft(this.data.settings)))
    const list = Array.isArray(draft.textReminders) ? draft.textReminders : []
    if (!Number.isInteger(index) || !list[index] || (field !== 'title' && field !== 'content')) return
    list[index][field] = e.detail.value || ''
    draft.textReminders = list
    this.setData({ aiReminderDraft: draft })
  },

  addAiReminderTextRule() {
    const draft = JSON.parse(JSON.stringify(this.data.aiReminderDraft || buildAiReminderDraft(this.data.settings)))
    const list = Array.isArray(draft.textReminders) ? draft.textReminders : []
    list.push({
      id: 'text_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
      title: '',
      content: '',
      enabled: true,
      evBrain: false,
      subscribeMessage: false
    })
    draft.textReminders = list
    this.setData({ aiReminderDraft: draft })
  },

  removeAiReminderTextRule(e) {
    const index = Number(e.currentTarget.dataset.index)
    const draft = JSON.parse(JSON.stringify(this.data.aiReminderDraft || buildAiReminderDraft(this.data.settings)))
    const list = Array.isArray(draft.textReminders) ? draft.textReminders : []
    if (!Number.isInteger(index) || !list[index]) return
    list.splice(index, 1)
    draft.textReminders = list
    this.setData({ aiReminderDraft: draft })
  },

  async saveAiReminderSettings() {
    const aiReminders = buildAiReminderSettingsFromDraft(this.data.aiReminderDraft, this.data.settings)
    try {
      const settings = await dataService.updateSettings({ aiReminders: aiReminders })
      this.setData({
        settings,
        aiReminderEditorVisible: false,
        aiReminderDraft: buildAiReminderDraft(settings)
      })
      wx.showToast({ title: 'AI提醒已保存', icon: 'success' })
    } catch (error) {
      const localSettings = error && error.localSettings
      if (localSettings) {
        this.setData({
          settings: localSettings,
          aiReminderEditorVisible: false,
          aiReminderDraft: buildAiReminderDraft(localSettings)
        })
      }
      wx.showModal({
        title: getSettingsSaveFailTitle(error),
        content: getSettingsSaveFailContent(error),
        showCancel: false,
        confirmText: '知道了'
      })
    }
  },

  openSettingsEditor(key, title, placeholder) {
    this.setData({
      settingsEditorVisible: true,
      settingsEditorKey: key,
      settingsEditorTitle: title,
      settingsEditorPlaceholder: placeholder,
      settingsEditorItems: createEditableItems(this.data.settings[key] || []),
      settingsEditorNewValue: ''
    })
  },

  closeSettingsEditor() {
    this.setData({
      settingsEditorVisible: false,
      settingsEditorKey: '',
      settingsEditorTitle: '',
      settingsEditorPlaceholder: '',
      settingsEditorItems: [],
      settingsEditorNewValue: ''
    })
  },

  onSettingsEditorMaskTap() {
    this.closeSettingsEditor()
  },

  noop() {},

  onSettingsEditorInput(e) {
    const index = Number(e.currentTarget.dataset.index)
    const value = e.detail.value
    const items = (this.data.settingsEditorItems || []).slice()
    if (!Number.isInteger(index) || !items[index]) return
    items[index] = Object.assign({}, items[index], { value })
    this.setData({ settingsEditorItems: items })
  },

  onSettingsEditorNewValueInput(e) {
    this.setData({
      settingsEditorNewValue: e.detail.value || ''
    })
  },

  addSettingsEditorItem() {
    const value = String(this.data.settingsEditorNewValue || '').trim()
    if (!value) {
      wx.showToast({ title: '先输入内容', icon: 'none' })
      return
    }
    const exists = (this.data.settingsEditorItems || []).some(item => String(item.value || '').trim() === value)
    if (exists) {
      wx.showToast({ title: '预设已存在', icon: 'none' })
      return
    }
    const items = (this.data.settingsEditorItems || []).concat([{
      id: 'item_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
      value
    }])
    this.setData({
      settingsEditorItems: items,
      settingsEditorNewValue: ''
    })
    wx.showToast({ title: '新建成功', icon: 'success' })
  },

  removeSettingsEditorItem(e) {
    const index = Number(e.currentTarget.dataset.index)
    const items = (this.data.settingsEditorItems || []).slice()
    if (!Number.isInteger(index) || !items[index]) return
    items.splice(index, 1)
    this.setData({ settingsEditorItems: items })
  },

  async saveSettingsEditor() {
    const key = this.data.settingsEditorKey
    const draftValue = String(this.data.settingsEditorNewValue || '').trim()
    const sourceItems = (this.data.settingsEditorItems || []).map(item => item.value)
    if (draftValue) sourceItems.push(draftValue)
    const list = sourceItems
      .map(item => String(item || '').trim())
      .filter(Boolean)
      .filter((item, index, arr) => arr.indexOf(item) === index)
    if (!key) return
    if (!list.length) {
      wx.showToast({ title: '至少保留一项', icon: 'none' })
      return
    }
    const settings = await dataService.updateSettings({ [key]: list })
    this.setData({
      settings,
      totalProfitDisplay: formatProfit(this.data.stats.totalProfit, settings.chipUnit),
      unitLabel: getUnitLabel(settings.chipUnit)
    })
    wx.showToast({ title: '已保存', icon: 'success' })
    this.closeSettingsEditor()
  },

  editVenues() {
    this.openSettingsEditor('venues', '编辑场地预设', '例如 永利 / 威尼斯人 / Home Game')
  },

  editBlindPresets() {
    this.openSettingsEditor('blindPresets', '编辑盲注级别', '例如 5/10 / 10/20 / 25/50')
  },

  editOpponentTypes() {
    this.openSettingsEditor('opponentTypes', '编辑对手类型', '例如 紧弱 / 松弱 / 激进 / 跟注站')
  },

  exportBackup() {
    const text = JSON.stringify(dataService.exportBackup(), null, 2)
    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showToast({ title: '备份已复制', icon: 'success' })
      }
    })
  },

  choosePbtCsvImportSource(kind) {
    wx.showActionSheet({
      itemList: ['从剪贴板导入CSV', '从微信聊天选择CSV'],
      success: res => {
        if (res.tapIndex === 0) {
          this.importPbtCsvFromClipboard(kind)
          return
        }
        if (res.tapIndex === 1) {
          this.importPbtCsvFromWechatMessage(kind)
        }
      }
    })
  },

  importPbtCsvFromClipboard(kind) {
    wx.getClipboardData({
      success: clip => {
        const csvText = String(clip.data || '')
        if (!csvText.trim()) {
          wx.showToast({ title: '剪贴板为空', icon: 'none' })
          return
        }
        if (kind === 'bankroll') {
          this.confirmPbtBankrollImport(csvText)
        } else {
          this.confirmPbtImport(csvText)
        }
      },
      fail: () => {
        wx.showToast({ title: '读取剪贴板失败', icon: 'none' })
      }
    })
  },

  importPbtCsvFromWechatMessage(kind) {
    wx.showModal({
      title: '选择 CSV 文件',
      content: '微信小程序只能从微信聊天或文件传输助手选择文件。请先把 CSV 发到聊天里，再继续选择。',
      confirmText: '继续',
      cancelText: '取消',
      success: modalResult => {
        if (!modalResult.confirm) return
        wx.chooseMessageFile({
          count: 1,
          type: 'file',
          extension: ['csv'],
          success: result => {
            const file = result.tempFiles && result.tempFiles[0]
            if (!file || !file.path) return
            const name = String(file.name || file.path || '')
            if (!/\.csv$/i.test(name)) {
              wx.showToast({ title: '请选择 CSV 文件', icon: 'none' })
              return
            }
            if (kind === 'bankroll') {
              this.readAndImportPbtBankrollCsv(file.path)
            } else {
              this.readAndImportPbtCsv(file.path)
            }
          }
        })
      }
    })
  },

  importPbtBankrollData() {
    this.choosePbtCsvImportSource('bankroll')
  },

  readAndImportPbtBankrollCsv(path) {
    const fs = wx.getFileSystemManager && wx.getFileSystemManager()
    if (!fs || typeof fs.readFile !== 'function') {
      wx.showToast({ title: '当前微信版本不支持读文件', icon: 'none' })
      return
    }
    fs.readFile({
      filePath: path,
      encoding: 'utf8',
      success: result => {
        this.confirmPbtBankrollImport(String(result.data || ''))
      },
      fail: () => {
        wx.showToast({ title: '读取 CSV 失败', icon: 'none' })
      }
    })
  },

  async confirmPbtBankrollImport(csvText) {
    try {
      const preview = await dataService.previewPbtBankrollSessionsCsv(csvText)
      const confirmed = await new Promise(resolve => {
        wx.showModal({
          title: '导入牌局数据',
          content: [
            '识别 ' + preview.total + ' 行',
            '将新增 ' + preview.created + ' 场',
            '将更新 ' + preview.updated + ' 场',
            preview.skipped ? '异常/跳过 ' + preview.skipped + ' 行' : ''
          ].filter(Boolean).join('\n'),
          confirmText: '导入',
          cancelText: '取消',
          success: modalResult => resolve(!!modalResult.confirm),
          fail: () => resolve(false)
        })
      })
      if (!confirmed) return
      const result = await dataService.importPbtBankrollSessionsFromCsv(csvText)
      wx.showModal({
        title: '牌局数据导入',
        content: [
          '导入完成',
          '新增 ' + result.created + ' 场',
          '更新 ' + result.updated + ' 场',
          result.skipped ? '异常/跳过 ' + result.skipped + ' 行' : ''
        ].filter(Boolean).join('\n'),
        showCancel: false
      })
      this.refresh()
    } catch (error) {
      const code = String(error && (error.code || error.message) || '')
      wx.showToast({
        title: code === 'PBT_BANKROLL_CSV_HEADER_NOT_FOUND' ? '未识别 PBT CSV 表头' : '导入失败',
        icon: 'none'
      })
    }
  },

  importBackup() {
    wx.showModal({
      title: '导入牌局数据',
      content: '会从剪贴板读取备份 JSON 并覆盖当前本地数据，是否继续？',
      confirmColor: '#e60012',
      success: res => {
        if (!res.confirm) return
        wx.getClipboardData({
          success: async clip => {
            try {
              const payload = JSON.parse(clip.data || '{}')
              await dataService.importBackup(payload)
              wx.showToast({ title: '导入成功', icon: 'success' })
              this.refresh()
            } catch (error) {
              wx.showToast({ title: '剪贴板不是有效备份', icon: 'none' })
            }
          }
        })
      }
    })
  },

  importPbtPlayerData() {
    if (this.data.importingPbtPlayerData) return
    this.choosePbtCsvImportSource('player')
  },

  readAndImportPbtCsv(path) {
    const fs = wx.getFileSystemManager && wx.getFileSystemManager()
    if (!fs || typeof fs.readFile !== 'function') {
      wx.showToast({ title: '当前微信版本不支持读文件', icon: 'none' })
      return
    }
    fs.readFile({
      filePath: path,
      encoding: 'utf8',
      success: result => {
        this.confirmPbtImport(String(result.data || ''))
      },
      fail: () => {
        wx.showToast({ title: '读取 CSV 失败', icon: 'none' })
      }
    })
  },

  async confirmPbtImport(csvText) {
    this.setData({ importingPbtPlayerData: true })
    try {
      const preview = await dataService.previewPbtPlayerNotesCsv(csvText)
      const confirmed = await new Promise(resolve => {
        wx.showModal({
          title: '导入玩家数据',
          content: [
            '识别 ' + preview.total + ' 行',
            '将新增 ' + preview.created + ' 个',
            '将更新 ' + preview.updated + ' 个',
            preview.skipped ? '将跳过 ' + preview.skipped + ' 行' : ''
          ].filter(Boolean).join('\n'),
          confirmText: '导入',
          cancelText: '取消',
          success: modalResult => resolve(!!modalResult.confirm),
          fail: () => resolve(false)
        })
      })
      if (!confirmed) return
      const result = await dataService.importPbtPlayerNotesFromCsv(csvText)
      wx.showModal({
        title: '玩家数据导入',
        content: [
          '导入完成',
          '新增 ' + result.created + ' 个',
          '更新 ' + result.updated + ' 个',
          result.skipped ? '跳过 ' + result.skipped + ' 行' : ''
        ].filter(Boolean).join('\n'),
        showCancel: false
      })
      this.refresh()
    } catch (error) {
      const code = String(error && (error.code || error.message) || '')
      wx.showToast({
        title: code === 'PBT_CSV_HEADER_NOT_FOUND' ? '未识别 PBT CSV 表头' : '导入失败',
        icon: 'none'
      })
    } finally {
      this.setData({ importingPbtPlayerData: false })
    }
  },

  clearData() {
    wx.showModal({
      title: '清除所有数据',
      content: '会重置资料、设置、牌局和手牌数据，是否继续？',
      confirmColor: '#e60012',
      success: async res => {
        if (!res.confirm) return
        await dataService.clearAllData()
        wx.removeStorageSync(WECHAT_PROFILE_PROMPT_SEEN_KEY)
        wx.showToast({ title: '已重置', icon: 'success' })
        this.refresh()
      }
    })
  },

  showAbout() {
    wx.showModal({
      title: '关于',
      content: '智牌屋\n版本 ' + this.data.version + '\n用于记录牌局、手牌、统计与复盘。',
      showCancel: false,
      confirmText: '知道了',
      confirmColor: '#e60012'
    })
  },

  restartOnboardingGuide() {
    const step = onboardingGuide.resetGuide()
    wx.showToast({ title: '已重新开启新手引导', icon: 'none' })
    wx.switchTab({ url: step.url })
  }
})
