const dataService = require('../../services/data-service')
const cardUi = require('../../utils/card-ui')
const display = require('../../utils/display')
const handReplay = require('../../utils/hand-replay')
const avatarCache = require('../../utils/player-avatar-cache')

const AVATAR_UPLOAD_MAX_BYTES = 2 * 1024 * 1024
const AVATAR_COMPRESS_QUALITIES = [82, 68, 54, 42]

function buildTypeOptions(settings, selectedType) {
  return (settings && settings.opponentTypes || []).map(type => ({
    label: type,
    active: type === selectedType
  }))
}

function buildLeakOptions(settings, selectedTags) {
  const selected = selectedTags || []
  return (settings && settings.playerLeakTags || []).map(label => ({
    label,
    active: selected.indexOf(label) > -1
  }))
}

function buildForm(note) {
  const source = note || {}
  return {
    name: source.name || '',
    avatarUrl: source.avatarUrl || '',
    avatarFileId: source.avatarFileId || '',
    avatarDisplayUrl: source.avatarDisplayUrl || avatarCache.getAvatarDisplayUrl(source.avatarFileId, source.avatarUrl),
    type: source.type || '未分类',
    leakTags: source.leakTags || [],
    note: source.note || '',
    battleHandIds: source.battleHandIds || []
  }
}

function buildHandCandidate(hand, linkedIds, chipUnit) {
  const item = hand || {}
  const linked = linkedIds.indexOf(item._id) > -1
  return {
    _id: item._id,
    linked,
    disabled: linked,
    heroCardsVisual: cardUi.parseHeroCardsInput(item.heroCardsInput),
    boardStreetVisual: cardUi.parseBoardStreets(item.board),
    heroPosition: item.heroPosition || '',
    currentProfit: Number(item.currentProfit) || 0,
    currentProfitDisplay: display.formatAmount(item.currentProfit, chipUnit || 'BB'),
    playedDate: item.playedDate || '',
    actionLine: item.actionLine || item.streetSummary || ''
  }
}

function normalizeBattleHand(item, chipUnit) {
  const source = item || {}
  return Object.assign({}, source, {
    heroCardsVisual: source.heroCardsVisual || cardUi.parseHeroCardsInput(source.heroCardsInput),
    boardStreetVisual: source.boardStreetVisual || cardUi.parseBoardStreets(source.board),
    currentProfitDisplay: source.currentProfitDisplay || display.formatAmount(source.currentProfit, chipUnit || 'BB'),
    hasActionLine: !!String(source.actionLine || '').trim()
  })
}

function chooseImageBySource(sourceType) {
  return new Promise((resolve, reject) => {
    if (wx.chooseMedia) {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: [sourceType],
        sizeType: ['compressed'],
        success: result => {
          const file = result.tempFiles && result.tempFiles[0]
          resolve(file && file.tempFilePath || '')
        },
        fail: reject
      })
      return
    }
    wx.chooseImage({
      count: 1,
      sourceType: [sourceType],
      sizeType: ['compressed'],
      success: result => resolve(result.tempFilePaths && result.tempFilePaths[0] || ''),
      fail: reject
    })
  })
}

function cropPlayerAvatar(src) {
  return new Promise(resolve => {
    if (!src || typeof wx.cropImage !== 'function') {
      resolve(src || '')
      return
    }
    wx.cropImage({
      src,
      cropScale: '1:1',
      success: result => resolve(result.tempFilePath || src),
      fail: () => resolve(src)
    })
  })
}

function getLocalFileSize(filePath) {
  return new Promise(resolve => {
    if (!filePath || typeof wx.getFileInfo !== 'function') {
      resolve(0)
      return
    }
    wx.getFileInfo({
      filePath,
      success: result => resolve(Number(result.size) || 0),
      fail: () => resolve(0)
    })
  })
}

function compressPlayerAvatar(src, quality) {
  return new Promise(resolve => {
    if (!src || typeof wx.compressImage !== 'function') {
      resolve(src || '')
      return
    }
    wx.compressImage({
      src,
      quality,
      success: result => resolve(result.tempFilePath || src),
      fail: () => resolve(src)
    })
  })
}

async function preparePlayerAvatarForUpload(src) {
  let current = src || ''
  let size = await getLocalFileSize(current)
  if (!size || size <= AVATAR_UPLOAD_MAX_BYTES) return current

  for (let i = 0; i < AVATAR_COMPRESS_QUALITIES.length; i += 1) {
    current = await compressPlayerAvatar(current, AVATAR_COMPRESS_QUALITIES[i])
    size = await getLocalFileSize(current)
    if (!size || size <= AVATAR_UPLOAD_MAX_BYTES) return current
  }

  return current
}

function uploadPlayerPhoto(localPath) {
  return getLocalFileSize(localPath).then(uploadSize => new Promise(resolve => {
    if (!localPath) {
      resolve({ avatarUrl: '', avatarFileId: '', error: 'empty' })
      return
    }
    if (uploadSize > AVATAR_UPLOAD_MAX_BYTES) {
      resolve({ avatarUrl: '', avatarFileId: '', error: 'tooLarge' })
      return
    }
    if (!wx.cloud || typeof wx.cloud.uploadFile !== 'function') {
      resolve({ avatarUrl: '', avatarFileId: '', error: 'cloudUnavailable' })
      return
    }
    const extMatch = String(localPath).match(/\.(jpg|jpeg|png|webp)$/i)
    const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg'
    wx.cloud.uploadFile({
      cloudPath: 'player-notes/avatar-' + Date.now() + '-' + Math.floor(Math.random() * 1000000) + '.' + ext,
      filePath: localPath,
      success: result => {
        const fileId = result.fileID || ''
        resolve({
          avatarUrl: fileId,
          avatarFileId: fileId,
          error: fileId ? '' : 'uploadFailed'
        })
      },
      fail: () => resolve({ avatarUrl: '', avatarFileId: '', error: 'uploadFailed' })
    })
  }))
}

async function mergePlayerLeakTagsIntoSettings(settings, tags) {
  const current = Object.assign({}, settings || {})
  const library = Array.isArray(current.playerLeakTags) ? current.playerLeakTags.slice() : []
  let changed = false
  ;(Array.isArray(tags) ? tags : []).forEach(tag => {
    const label = String(tag || '').trim()
    if (label && library.indexOf(label) === -1) {
      library.push(label)
      changed = true
    }
  })
  if (!changed) return current
  const next = dataService.updateSettings({ playerLeakTags: library }, { waitForCloud: true })
  return next && typeof next.then === 'function' ? next : Promise.resolve(next || Object.assign({}, current, { playerLeakTags: library }))
}

Page({
  data: {
    id: '',
    mode: 'view',
    editMode: false,
    note: null,
    form: buildForm(),
    settings: null,
    typeOptions: [],
    leakOptions: [],
    newLeakTag: '',
    battleHands: [],
    handPickerVisible: false,
    handCandidates: [],
    replayVisible: false,
    replayData: null,
    saving: false,
    saveError: ''
  },

  async onLoad(options) {
    const id = decodeURIComponent(options && options.id || '')
    const isNew = options && options.mode === 'new'
    this.setData({
      id,
      mode: isNew ? 'new' : 'view',
      editMode: isNew
    })
    await this.refresh()
  },

  async refresh() {
    const settings = await dataService.getAppSettings()
    const note = this.data.id ? await dataService.getPlayerNoteById(this.data.id) : null
    const viewNote = note ? Object.assign({}, note, {
      avatarDisplayUrl: avatarCache.getAvatarDisplayUrl(note.avatarFileId, note.avatarUrl)
    }) : null
    const form = this.data.editMode ? (this.data.form.name || this.data.mode === 'new' ? this.data.form : buildForm(viewNote)) : buildForm(viewNote)
    const battleHands = note && note._id ? await dataService.getPlayerNoteBattleHands(note._id) : []
    this.setData({
      note: viewNote,
      form,
      settings,
      typeOptions: buildTypeOptions(settings, form.type),
      leakOptions: buildLeakOptions(settings, form.leakTags),
      battleHands: battleHands.map(item => normalizeBattleHand(item, settings.chipUnit)),
      saveError: ''
    })
    if (note && (note.avatarFileId || note.avatarUrl)) {
      avatarCache.warmPlayerAvatar(note).then(localPath => {
        if (!localPath) return
        const avatarDisplayUrl = avatarCache.getAvatarDisplayUrl(note.avatarFileId, note.avatarUrl)
        this.setData({
          'note.avatarDisplayUrl': avatarDisplayUrl,
          'form.avatarDisplayUrl': this.data.form.avatarFileId === note.avatarFileId ? avatarDisplayUrl : this.data.form.avatarDisplayUrl
        })
      })
    }
  },

  updateOptionStates() {
    const settings = this.data.settings || {}
    this.setData({
      typeOptions: buildTypeOptions(settings, this.data.form.type),
      leakOptions: buildLeakOptions(settings, this.data.form.leakTags)
    })
  },

  goBack() {
    if (this.data.editMode) {
      this.cancelEdit()
      return
    }
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
    if (pages.length > 1) {
      wx.navigateBack()
      return
    }
    wx.switchTab({ url: '/pages/player-notes/player-notes' })
  },

  startEdit() {
    this.setData({ editMode: true, form: buildForm(this.data.note) })
    this.refresh()
  },

  cancelEdit() {
    if (this.data.mode === 'new') {
      wx.navigateBack()
      return
    }
    this.setData({ editMode: false, form: buildForm(this.data.note), saveError: '' })
    this.refresh()
  },

  onNameInput(event) {
    this.setData({ 'form.name': event.detail.value || '' })
  },

  onAvatarInput(event) {
    this.setData({ 'form.avatarUrl': event.detail.value || '' })
  },

  choosePlayerPhoto() {
    wx.showActionSheet({
      itemList: ['拍照', '从手机相册选择'],
      success: async result => {
        const sourceType = result.tapIndex === 0 ? 'camera' : 'album'
        try {
          const tempFilePath = await chooseImageBySource(sourceType)
          const croppedPath = await cropPlayerAvatar(tempFilePath)
          const uploadPath = await preparePlayerAvatarForUpload(croppedPath)
          if (uploadPath) {
            const avatar = await uploadPlayerPhoto(uploadPath)
            if (avatar.avatarFileId) {
              const avatarDisplayUrl = await avatarCache.cacheLocalAvatar(avatar.avatarFileId, uploadPath)
              this.setData({
                'form.avatarUrl': avatar.avatarUrl,
                'form.avatarFileId': avatar.avatarFileId,
                'form.avatarDisplayUrl': avatarDisplayUrl || avatar.avatarUrl
              })
              return
            }
            const title = avatar.error === 'tooLarge' ? '照片压缩后仍超过2MB' : '头像上传失败'
            wx.showToast({ title, icon: 'none' })
          }
        } catch (error) {
          if (String(error && (error.errMsg || error.message) || '').indexOf('cancel') === -1) {
            wx.showToast({ title: '照片选择失败', icon: 'none' })
          }
        }
      }
    })
  },

  clearPlayerPhoto() {
    this.setData({
      'form.avatarUrl': '',
      'form.avatarFileId': '',
      'form.avatarDisplayUrl': ''
    })
  },
  onNoteInput(event) {
    this.setData({ 'form.note': event.detail.value || '' })
  },

  selectType(event) {
    this.setData({ 'form.type': event.currentTarget.dataset.type || '未分类' })
    this.updateOptionStates()
  },

  toggleLeakTag(event) {
    const label = event.currentTarget.dataset.label
    if (!label) return
    const current = this.data.form.leakTags.slice()
    const index = current.indexOf(label)
    if (index > -1) current.splice(index, 1)
    else current.push(label)
    this.setData({ 'form.leakTags': current })
    this.updateOptionStates()
  },

  onNewLeakInput(event) {
    this.setData({ newLeakTag: event.detail.value || '' })
  },

  async addLeakTag() {
    const label = String(this.data.newLeakTag || '').trim()
    if (!label) return
    const settings = this.data.settings || await dataService.getAppSettings()
    const library = (settings.playerLeakTags || []).slice()
    let savedSettings = settings
    if (library.indexOf(label) === -1) {
      library.push(label)
      savedSettings = await mergePlayerLeakTagsIntoSettings(settings, [label])
    }
    const tags = this.data.form.leakTags.slice()
    if (tags.indexOf(label) === -1) tags.push(label)
    const nextSettings = Object.assign({}, settings, savedSettings || {}, { playerLeakTags: library })
    this.setData({
      newLeakTag: '',
      settings: nextSettings,
      'form.leakTags': tags,
      leakOptions: buildLeakOptions(nextSettings, tags)
    })
  },

  async removeLeakTag(event) {
    const label = event.currentTarget.dataset.label
    if (!label) return
    const settings = this.data.settings || await dataService.getAppSettings()
    const library = (settings.playerLeakTags || []).filter(item => item !== label)
    const tags = (this.data.form.leakTags || []).filter(item => item !== label)
    const nextSettings = await dataService.updateSettings({ playerLeakTags: library }, { waitForCloud: true })
    const mergedSettings = Object.assign({}, settings, nextSettings || {}, { playerLeakTags: library })
    this.setData({
      settings: mergedSettings,
      'form.leakTags': tags,
      leakOptions: buildLeakOptions(mergedSettings, tags)
    })
  },

  async saveNote() {
    if (this.data.saving) return
    const payload = Object.assign({}, this.data.form, {
      name: String(this.data.form.name || '').trim()
    })
    delete payload.avatarDisplayUrl
    if (!payload.name) {
      this.setData({ saveError: '请先填写玩家名字' })
      return
    }
    this.setData({ saving: true, saveError: '' })
    try {
      const settings = await mergePlayerLeakTagsIntoSettings(this.data.settings, payload.leakTags)
      this.setData({ settings })
      const saved = this.data.mode === 'new'
        ? await dataService.createPlayerNote(payload)
        : await dataService.updatePlayerNote(this.data.id, payload)
      this.setData({
        id: saved._id,
        mode: 'view',
        editMode: false,
        note: saved,
        saving: false
      })
      await this.refresh()
      wx.showToast({ title: '已保存', icon: 'success' })
    } catch (error) {
      this.setData({
        saving: false,
        saveError: error && (error.message || error.errMsg) || '保存失败'
      })
    }
  },

  async deleteNote() {
    if (!this.data.id) return
    wx.showModal({
      title: '删除玩家',
      content: '删除后本地列表不再显示这个玩家 note。',
      confirmText: '删除',
      confirmColor: '#e60012',
      success: async result => {
        if (!result.confirm) return
        await dataService.deletePlayerNote(this.data.id)
        wx.navigateBack()
      }
    })
  },

  async openHandPicker() {
    if (!this.data.id) {
      this.setData({ saveError: '请先保存玩家，再添加对战手牌' })
      return
    }
    const settings = await dataService.getAppSettings()
    const hands = await dataService.getReviewHands({})
    const linkedIds = this.data.form.battleHandIds || []
    this.setData({
      handPickerVisible: true,
      handCandidates: hands.map(item => buildHandCandidate(item, linkedIds, settings.chipUnit))
    })
  },

  closeHandPicker() {
    this.setData({ handPickerVisible: false })
  },

  async addBattleHand(event) {
    const handId = event.currentTarget.dataset.id
    if (!handId || event.currentTarget.dataset.disabled) return
    await dataService.addPlayerNoteBattleHand(this.data.id, handId)
    this.setData({ handPickerVisible: false })
    await this.refresh()
  },

  async removeBattleHand(event) {
    const handId = event.currentTarget.dataset.id
    if (!handId) return
    await dataService.removePlayerNoteBattleHand(this.data.id, handId)
    await this.refresh()
  },

  async playBattleHand(event) {
    const handId = event.currentTarget.dataset.id
    if (!handId) return
    const hand = await dataService.getHandById(handId)
    if (hand && handReplay.canReplayHand(hand)) {
      this.setData({
        replayVisible: true,
        replayData: handReplay.buildReplayView(hand)
      })
      return
    }
    wx.redirectTo({ url: '/pages/hand-detail/hand-detail?id=' + encodeURIComponent(handId) + '&from=player-notes' })
  },

  closeReplay() {
    this.setData({ replayVisible: false, replayData: null })
  },

  stopModalTap() {}
})
