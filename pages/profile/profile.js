const dataService = require('../../services/data-service')
const tabBar = require('../../utils/tab-bar')

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

Page({
  data: {
    version: 'v1.0.0',
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
      handCount: 0,
      totalProfit: 0
    },
    settingsEditorVisible: false,
    settingsEditorKey: '',
    settingsEditorTitle: '',
    settingsEditorPlaceholder: '',
    settingsEditorItems: [],
    settingsEditorNewValue: '',
    totalProfitDisplay: '0 BB',
    unitLabel: 'BB',
    unitOptions: [
      { label: 'BB', value: 'BB' },
      { label: '¥', value: 'CNY' },
      { label: 'HK$', value: 'HKD' },
      { label: '$', value: 'USD' }
    ]
  },

  onShow() {
    tabBar.syncCustomTabBar('/pages/profile/profile')
    this.refresh()
  },

  async refresh() {
    const data = await dataService.getProfilePageData()
    this.setData({
      profile: data.profile,
      settings: data.settings,
      stats: data.stats,
      totalProfitDisplay: formatProfit(data.stats.totalProfit, data.settings.chipUnit),
      unitLabel: getUnitLabel(data.settings.chipUnit)
    })
  },

  async editName() {
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

  async editTitle() {
    const res = await showEditableModal({
      title: '修改称号',
      placeholderText: '例如 怪盗团新兵',
      content: this.data.profile.title || ''
    })
    if (!res.confirm || !res.content) return
    await dataService.updateProfile({ title: res.content.trim() })
    this.refresh()
  },

  async syncWechatProfile() {
    wx.getUserProfile({
      desc: '用于同步微信头像和昵称',
      success: async res => {
        const userInfo = res.userInfo || {}
        const avatarUrl = userInfo.avatarUrl || ''
        const nickName = String(userInfo.nickName || '').trim()
        const patch = {}
        if (nickName) {
          patch.name = nickName
          patch.avatarText = nickName.slice(0, 2)
        }
        if (avatarUrl) {
          patch.avatarUrl = avatarUrl
        }
        if (!Object.keys(patch).length) {
          wx.showToast({ title: '未获取到微信资料', icon: 'none' })
          return
        }
        await dataService.updateProfile(patch)
        wx.showToast({ title: '已同步微信资料', icon: 'success' })
        this.refresh()
      },
      fail: () => {
        wx.showToast({ title: '未授权同步微信资料', icon: 'none' })
      }
    })
  },

  chooseAvatar() {
    wx.showActionSheet({
      itemList: ['同步微信头像和昵称', '从相册选择头像', '拍照更换头像'],
      success: res => {
        if (res.tapIndex === 0) {
          this.syncWechatProfile()
          return
        }
        const sourceType = res.tapIndex === 2 ? ['camera'] : ['album']
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
    const list = (this.data.settingsEditorItems || [])
      .map(item => String(item.value || '').trim())
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

  editPositions() {
    this.openSettingsEditor('positions', '编辑位置预设', '例如 UTG / UTG+1 / HJ / CO / BTN')
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

  clearData() {
    wx.showModal({
      title: '清除所有数据',
      content: '会重置资料、设置、牌局和手牌数据，是否继续？',
      confirmColor: '#e60012',
      success: async res => {
        if (!res.confirm) return
        await dataService.clearAllData()
        wx.showToast({ title: '已重置', icon: 'success' })
        this.refresh()
      }
    })
  },

  showAbout() {
    wx.showModal({
      title: '关于',
      content: 'Poker Live Recorder\n版本 v1.0.0\n本地离线原型，用于记录牌局、手牌与复盘流程。',
      showCancel: false,
      confirmText: '知道了',
      confirmColor: '#e60012'
    })
  }
})
