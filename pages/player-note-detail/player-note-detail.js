const dataService = require('../../services/data-service')
const cardUi = require('../../utils/card-ui')
const display = require('../../utils/display')
const handReplay = require('../../utils/hand-replay')
const avatarCache = require('../../utils/player-avatar-cache')
const socialService = require('../../services/social-service')
const socialMutation = require('../../utils/social-mutation')

const AVATAR_UPLOAD_MAX_BYTES = 2 * 1024 * 1024
const AVATAR_COMPRESS_QUALITIES = [82, 68, 54, 42]
const CARD_SHARE_SUCCESS_VISIBLE_MS = 600

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

function formatFriendDate(value) {
  const timestamp = Number(value) || 0
  if (!timestamp) return ''
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0')
}

function buildFriendView(remote) {
  const source = remote || {}
  const statsVisible = source.statsVisible !== false
  const durationMinutes = Math.max(0, Number(source.durationMinutes) || 0)
  return {
    friendshipId: String(source.friendshipId || ''),
    socialUserId: String(source.socialUserId || ''),
    nickname: String(source.nickname || ''),
    avatarUrl: String(source.avatarUrl || ''),
    avatarText: String(source.avatarText || source.nickname || '').slice(0, 1),
    title: String(source.title || ''),
    statsVisible,
    durationLabel: statsVisible ? (durationMinutes / 60).toFixed(1) + 'h' : '',
    recordedHandCount: statsVisible ? Math.max(0, Math.floor(Number(source.recordedHandCount) || 0)) : 0,
    friendshipDate: formatFriendDate(source.acceptedAt)
  }
}

function buildCardSharePreview(note) {
  const source = note || {}
  return {
    avatarUrl: String(source.avatarDisplayUrl || ''),
    avatarText: String(source.avatarText || source.name || '').slice(0, 1),
    name: String(source.name || ''),
    type: String(source.type || '未分类'),
    leakTags: Array.isArray(source.leakTags) ? source.leakTags.slice() : [],
    note: String(source.note || '')
  }
}

function normalizeCardFriend(remote) {
  const source = remote || {}
  const socialUserId = String(source.socialUserId || '').trim()
  if (!socialUserId || source.status && source.status !== 'accepted') return null
  return {
    socialUserId,
    nickname: String(source.nickname || '未命名好友'),
    avatarUrl: String(source.avatarUrl || ''),
    avatarText: String(source.avatarText || source.nickname || '').slice(0, 1),
    title: String(source.title || '')
  }
}

function appendUniqueCardFriends(current, incoming) {
  const result = []
  const seen = Object.create(null)
  ;[].concat(current || [], incoming || []).forEach(item => {
    const friend = normalizeCardFriend(item)
    if (!friend || seen[friend.socialUserId]) return
    seen[friend.socialUserId] = true
    result.push(friend)
  })
  return result
}

function safeDecodeQueryValue(value) {
  const source = String(value || '')
  try {
    return decodeURIComponent(source).trim()
  } catch (error) {
    return source.trim()
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
  const opponentCardsVisual = source.opponentCardsVisual || cardUi.parseOpponentCardsInput(source.opponentCards || source.showdown || source.villainCards || '', {
    board: source.board || {},
    heroCardsInput: source.heroCardsInput || ''
  })
  const versusSummary = Object.assign({
    heroPosition: source.heroPosition || '',
    heroCardsVisual: source.heroCardsVisual || cardUi.parseHeroCardsInput(source.heroCardsInput),
    opponentPosition: source.opponentPosition || source.villainPosition || '',
    opponentCardsVisual,
    hasOpponentCards: opponentCardsVisual.length === 2,
    currentProfit: Number(source.currentProfit) || 0,
    currentProfitDisplay: source.currentProfitDisplay || display.formatAmount(source.currentProfit, chipUnit || 'BB'),
    profitTone: Number(source.currentProfit) > 0 ? 'positive' : (Number(source.currentProfit) < 0 ? 'negative' : 'neutral')
  }, source.versusSummary || {})
  return Object.assign({}, source, {
    heroCardsVisual: source.heroCardsVisual || cardUi.parseHeroCardsInput(source.heroCardsInput),
    boardStreetVisual: source.boardStreetVisual || cardUi.parseBoardStreets(source.board),
    currentProfitDisplay: source.currentProfitDisplay || display.formatAmount(source.currentProfit, chipUnit || 'BB'),
    versusSummary,
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
    friendUserId: '',
    friend: null,
    detailState: 'ready',
    loadError: '',
    friendLoadedOnce: false,
    friendShownOnce: false,
    removingFriend: false,
    removeError: '',
    detachPending: false,
    detachError: '',
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
    cardShareVisible: false,
    cardShareStatus: 'idle',
    cardSharePreview: null,
    cardFriends: [],
    selectedCardFriendId: '',
    nextCardFriendOffset: null,
    cardFriendLoadingMore: false,
    cardFriendLoadMoreError: '',
    cardShareError: '',
    cardShareNeedsFriendRefresh: false,
    cardShareMutationId: '',
    saving: false,
    saveError: ''
  },

  async onLoad(options) {
    this._friendPageAttached = true
    const friendUserId = safeDecodeQueryValue(options && options.friendUserId)
    if (friendUserId) {
      this.setData({
        id: '',
        mode: 'friend',
        friendUserId,
        editMode: false,
        detailState: 'loading',
        loadError: ''
      })
      await this.loadFriendMode(friendUserId)
      return
    }
    const id = safeDecodeQueryValue(options && options.id)
    const isNew = options && options.mode === 'new'
    this.setData({
      id,
      mode: isNew ? 'new' : 'view',
      editMode: isNew
    })
    await this.refresh()
  },

  async onShow() {
    if (this.data.mode !== 'friend' || !this.data.friendUserId || !this.data.friendLoadedOnce || this.data.removingFriend) return
    if (!this.data.friendShownOnce) {
      this.setData({ friendShownOnce: true })
      return
    }
    if (this.data.mode === 'friend') {
      await this.loadFriendMode(this.data.friendUserId, { preserveEdit: true })
    }
  },

  onUnload() {
    this._friendPageAttached = false
    this.invalidateFriendRequests()
    this.invalidateCardShareRequests()
  },

  nextFriendRequest() {
    this._friendRequestSequence = (Number(this._friendRequestSequence) || 0) + 1
    return this._friendRequestSequence
  },

  invalidateFriendRequests() {
    this._friendRequestSequence = (Number(this._friendRequestSequence) || 0) + 1
  },

  isFriendRequestCurrent(sequence) {
    return this._friendPageAttached !== false && this._friendRequestSequence === sequence
  },

  nextCardFriendRequest() {
    this._cardFriendRequestSequence = (Number(this._cardFriendRequestSequence) || 0) + 1
    return this._cardFriendRequestSequence
  },

  nextCardShareSubmit() {
    this._cardShareSubmitSequence = (Number(this._cardShareSubmitSequence) || 0) + 1
    return this._cardShareSubmitSequence
  },

  invalidateCardShareRequests() {
    this.cancelCardShareSuccessTimer()
    this._cardFriendRequestSequence = (Number(this._cardFriendRequestSequence) || 0) + 1
    this._cardShareSubmitSequence = (Number(this._cardShareSubmitSequence) || 0) + 1
    this._cardShareSubmitPromise = null
  },

  setCardShareTimer(callback) {
    return setTimeout(callback, CARD_SHARE_SUCCESS_VISIBLE_MS)
  },

  clearCardShareTimer(timerId) {
    clearTimeout(timerId)
  },

  cancelCardShareSuccessTimer() {
    if (this._cardShareSuccessTimer === null || this._cardShareSuccessTimer === undefined) return
    this.clearCardShareTimer(this._cardShareSuccessTimer)
    this._cardShareSuccessTimer = null
  },

  isCardFriendRequestCurrent(sequence) {
    return this._friendPageAttached !== false && this.data.cardShareVisible && this._cardFriendRequestSequence === sequence
  },

  isCardShareSubmitCurrent(sequence) {
    return this._friendPageAttached !== false && this.data.cardShareVisible && this._cardShareSubmitSequence === sequence
  },

  async loadFriendMode(friendUserId, options) {
    const target = String(friendUserId || '').trim()
    if (!target) return
    const config = options || {}
    const requestSequence = this.nextFriendRequest()
    if (!this.isFriendRequestCurrent(requestSequence)) return
    this.setData({ detailState: 'loading', loadError: '' })
    try {
      const [localNote, remote] = await Promise.all([
        dataService.getFriendPlayerNote(target),
        socialService.getFriendDetail(target)
      ])
      if (!this.isFriendRequestCurrent(requestSequence)) return
      const note = localNote || await dataService.ensureFriendPlayerNote(remote)
      if (!this.isFriendRequestCurrent(requestSequence)) return
      const friend = buildFriendView(remote)
      const settings = await dataService.getAppSettings()
      if (!this.isFriendRequestCurrent(requestSequence)) return
      const viewNote = note ? Object.assign({}, note, {
        avatarDisplayUrl: avatarCache.getAvatarDisplayUrl(note.avatarFileId, note.avatarUrl)
      }) : null
      const form = config.preserveEdit && this.data.editMode
        ? this.data.form
        : buildForm(viewNote)
      const battleHands = note && note._id ? await dataService.getPlayerNoteBattleHands(note._id) : []
      if (!this.isFriendRequestCurrent(requestSequence)) return
      this.setData({
        id: note && note._id || '',
        note: viewNote,
        friend,
        form,
        settings,
        typeOptions: buildTypeOptions(settings, form.type),
        leakOptions: buildLeakOptions(settings, form.leakTags),
        battleHands: battleHands.map(item => normalizeBattleHand(item, settings.chipUnit)),
        detailState: 'ready',
        loadError: '',
        friendLoadedOnce: true
      })
    } catch (error) {
      if (!this.isFriendRequestCurrent(requestSequence)) return
      const code = String(error && error.code || '')
      this.setData({
        note: null,
        friend: null,
        detailState: code === 'FORBIDDEN' || code === 'FRIENDSHIP_NOT_FOUND' ? 'unavailable' : 'error',
        loadError: code === 'FORBIDDEN' || code === 'FRIENDSHIP_NOT_FOUND'
          ? '好友关系已解除或不可访问'
          : '好友资料加载失败，请检查网络后重试'
      })
    }
  },

  retryFriendLoad() {
    return this.loadFriendMode(this.data.friendUserId)
  },

  async refresh() {
    if (this.data.mode === 'friend') return this.loadFriendMode(this.data.friendUserId, { preserveEdit: true })
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
    if (this.data.detailState !== 'ready' || !this.data.note) return
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
    const isNew = this.data.mode === 'new'
    if (!isNew && (this.data.detailState !== 'ready' || !this.data.note || !this.data.id)) return
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
        mode: this.data.mode === 'friend' ? 'friend' : 'view',
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
    if (this.data.mode === 'friend') return
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

  confirmRemoveFriend() {
    if (this.data.removingFriend || this.data.detachPending || !this.data.friend) return
    wx.showModal({
      title: '解除好友',
      content: '解除后将立即失去好友资料、排行榜及好友范围分享的访问权限。本地玩家资料会保留在玩家库。',
      confirmText: '解除好友',
      confirmColor: '#e60012',
      success: result => {
        if (result && result.confirm) this.removeFriend()
      }
    })
  },

  async removeFriend() {
    if (this.data.removingFriend || this.data.detachPending) return
    const friend = this.data.friend || {}
    const friendshipId = String(friend.friendshipId || '').trim()
    const friendUserId = String(friend.socialUserId || this.data.friendUserId || '').trim()
    if (!friendshipId || !friendUserId) {
      this.setData({ detachError: '好友关系信息已失效，请返回列表刷新后重试' })
      return
    }
    this.invalidateFriendRequests()
    this.setData({ removingFriend: true, detachError: '', removeError: '' })
    try {
      await socialService.removeFriend({
        friendshipId,
        clientMutationId: socialMutation.createMutationId('remove_friend')
      })
    } catch (error) {
      this.setData({
        removingFriend: false,
        removeError: '解除好友失败，请稍后重试'
      })
      wx.showToast({ title: '解除好友失败，请稍后重试', icon: 'none' })
      return
    }
    this.invalidateFriendRequests()
    this.setData({ removingFriend: false, detachPending: true })
    await this.detachFriendNote(friendUserId)
  },

  async retryDetachFriendNote() {
    if (!this.data.detachPending) return
    await this.detachFriendNote(this.data.friendUserId)
  },

  async detachFriendNote(friendUserId) {
    try {
      await dataService.detachFriendPlayerNote(friendUserId)
      this.setData({ detachPending: false, detachError: '' })
      wx.switchTab({ url: '/pages/player-notes/player-notes' })
    } catch (error) {
      this.setData({
        detachPending: true,
        detachError: '好友关系已解除，但本地玩家资料暂未归档。请重试以保留资料。'
      })
    }
  },

  async openPlayerCardShare() {
    const note = this.data.note
    if (this.data.mode !== 'view' || this.data.editMode || this.data.detailState !== 'ready' || !this.data.id || !note || note.sourceKind === 'friend') return
    this.cancelCardShareSuccessTimer()
    const requestSequence = this.nextCardFriendRequest()
    this.nextCardShareSubmit()
    this._cardShareMutationUsed = false
    this.setData({
      cardShareVisible: true,
      cardShareStatus: 'loading',
      cardSharePreview: buildCardSharePreview(note),
      cardFriends: [],
      selectedCardFriendId: '',
      nextCardFriendOffset: null,
      cardFriendLoadingMore: false,
      cardFriendLoadMoreError: '',
      cardShareError: '',
      cardShareNeedsFriendRefresh: false,
      cardShareMutationId: socialMutation.createMutationId('share_player_card')
    })
    await this.loadCardFriendPage(0, requestSequence, false)
  },

  closePlayerCardShare() {
    if (this.data.cardShareStatus === 'sending') return
    this.invalidateCardShareRequests()
    this._cardShareMutationUsed = false
    this.setData({
      cardShareVisible: false,
      cardShareStatus: 'idle',
      cardSharePreview: null,
      cardFriends: [],
      selectedCardFriendId: '',
      nextCardFriendOffset: null,
      cardFriendLoadingMore: false,
      cardFriendLoadMoreError: '',
      cardShareError: '',
      cardShareNeedsFriendRefresh: false,
      cardShareMutationId: ''
    })
  },

  async refreshCardFriends() {
    if (!this.data.cardShareVisible || this.data.cardShareStatus === 'sending') return
    const requestSequence = this.nextCardFriendRequest()
    this.setData({
      cardShareStatus: 'loading',
      cardFriends: [],
      selectedCardFriendId: '',
      nextCardFriendOffset: null,
      cardFriendLoadingMore: false,
      cardFriendLoadMoreError: '',
      cardShareError: '',
      cardShareNeedsFriendRefresh: false
    })
    await this.loadCardFriendPage(0, requestSequence, false)
  },

  async loadMoreCardFriends() {
    const offset = this.data.nextCardFriendOffset
    if (!this.data.cardShareVisible || this.data.cardShareStatus !== 'ready' || this.data.cardFriendLoadingMore || offset === null || offset === undefined) return
    const requestSequence = this._cardFriendRequestSequence
    this.setData({ cardFriendLoadingMore: true, cardFriendLoadMoreError: '' })
    await this.loadCardFriendPage(offset, requestSequence, true)
  },

  async loadCardFriendPage(offset, requestSequence, append) {
    try {
      const result = await socialService.listFriends({ offset, limit: 20 })
      if (!this.isCardFriendRequestCurrent(requestSequence)) return
      const items = appendUniqueCardFriends(append ? this.data.cardFriends : [], result && result.items)
      const nextOffset = result && result.nextOffset !== null && result.nextOffset !== undefined
        ? Math.max(0, Number(result.nextOffset) || 0)
        : null
      this.setData({
        cardFriends: items,
        nextCardFriendOffset: nextOffset,
        cardShareStatus: items.length ? 'ready' : 'empty',
        cardFriendLoadingMore: false,
        cardFriendLoadMoreError: '',
        cardShareError: ''
      })
    } catch (error) {
      if (!this.isCardFriendRequestCurrent(requestSequence)) return
      if (append) {
        this.setData({ cardFriendLoadingMore: false, cardFriendLoadMoreError: '好友加载失败，请重试' })
        return
      }
      this.setData({
        cardShareStatus: 'error',
        cardFriendLoadingMore: false,
        cardShareError: '好友列表加载失败，请检查网络后重试'
      })
    }
  },

  selectCardFriend(event) {
    if (!this.data.cardShareVisible || this.data.cardShareStatus === 'sending') return
    const targetUserId = String(event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.id || '').trim()
    if (!targetUserId || !this.data.cardFriends.some(item => item.socialUserId === targetUserId)) return
    const previous = this.data.selectedCardFriendId
    const selectedCardFriendId = previous === targetUserId ? '' : targetUserId
    let mutationId = this.data.cardShareMutationId
    if (this._cardShareMutationUsed && selectedCardFriendId && selectedCardFriendId !== previous) {
      mutationId = socialMutation.createMutationId('share_player_card')
      this._cardShareMutationUsed = false
    }
    this.setData({
      selectedCardFriendId,
      cardShareStatus: this.data.cardFriends.length ? 'ready' : 'empty',
      cardShareError: '',
      cardShareNeedsFriendRefresh: false,
      cardShareMutationId: mutationId
    })
  },

  confirmSharePlayerCard() {
    const targetUserId = String(this.data.selectedCardFriendId || '').trim()
    if (!targetUserId) {
      if (this._friendPageAttached !== false) wx.showToast({ title: '请选择一位好友', icon: 'none' })
      return Promise.resolve()
    }
    if (this.data.cardShareStatus === 'sending' || this.data.cardShareStatus === 'success') return this._cardShareSubmitPromise || Promise.resolve()
    const clientMutationId = this.data.cardShareMutationId || socialMutation.createMutationId('share_player_card')
    const submitSequence = this.nextCardShareSubmit()
    this._cardShareMutationUsed = true
    this.setData({
      cardShareStatus: 'sending',
      cardShareError: '',
      cardShareNeedsFriendRefresh: false,
      cardShareMutationId: clientMutationId
    })
    const task = socialService.sharePlayerCard({
      playerNoteId: this.data.id,
      targetUserId,
      clientMutationId
    }).then(result => {
      if (!this.isCardShareSubmitCurrent(submitSequence)) return result
      this._cardShareMutationUsed = false
      this.setData({ cardShareStatus: 'success', cardShareError: '' }, () => {
        if (!this.isCardShareSubmitCurrent(submitSequence)) return
        this.cancelCardShareSuccessTimer()
        this._cardShareSuccessTimer = this.setCardShareTimer(() => {
          this._cardShareSuccessTimer = null
          if (!this.isCardShareSubmitCurrent(submitSequence) || this.data.cardShareStatus !== 'success') return
          this.invalidateCardShareRequests()
          this.setData({
            cardShareVisible: false,
            cardShareStatus: 'idle',
            cardSharePreview: null,
            cardFriends: [],
            selectedCardFriendId: '',
            nextCardFriendOffset: null,
            cardFriendLoadingMore: false,
            cardFriendLoadMoreError: '',
            cardShareError: '',
            cardShareNeedsFriendRefresh: false,
            cardShareMutationId: ''
          })
        })
      })
      wx.showToast({ title: '名片已分享', icon: 'success' })
      return result
    }).catch(error => {
      if (!this.isCardShareSubmitCurrent(submitSequence)) return
      const code = String(error && error.code || '')
      const relationshipLost = code === 'FRIENDSHIP_REQUIRED' || code === 'FRIENDSHIP_NOT_FOUND' || code === 'FORBIDDEN'
      this.setData({
        cardShareStatus: 'failure',
        cardShareError: relationshipLost ? '该用户已不是好友，请刷新好友列表后重新选择' : '名片分享失败，请稍后重试',
        cardShareNeedsFriendRefresh: relationshipLost
      })
    }).finally(() => {
      if (this._cardShareSubmitPromise === task) this._cardShareSubmitPromise = null
    })
    this._cardShareSubmitPromise = task
    return task
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
