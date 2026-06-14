const dataService = require('../../services/data-service')
const voiceParser = require('../../utils/voice-parser')
const cardUi = require('../../utils/card-ui')
const display = require('../../utils/display')
const handDetailFields = require('../../utils/hand-detail-fields')

const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']
const SUITS = [
  { key: 's', symbol: '♠', className: 'spade' },
  { key: 'h', symbol: '♥', className: 'heart' },
  { key: 'd', symbol: '♦', className: 'diamond' },
  { key: 'c', symbol: '♣', className: 'club' }
]
const BOARD_FIELD_META = {
  flop: { label: '翻牌', shortLabel: 'F', limit: 3, emptyText: '选择 3 张公牌' },
  turn: { label: '转牌', shortLabel: 'T', limit: 1, emptyText: '选择 1 张公牌' },
  river: { label: '河牌', shortLabel: 'R', limit: 1, emptyText: '选择 1 张公牌' }
}

function normalizeCardsValue(value, limit) {
  return cardUi.parseCardsInput(value, limit)
    .map(function (card) {
      return card.rank + card.suit
    })
    .join('')
}

function buildBoardVisual(board) {
  return cardUi.parseBoardStreets(board)
}

function buildParsedVoicePreview(parsedVoice) {
  if (!parsedVoice) return null
  return Object.assign({}, parsedVoice, {
    heroCardsVisual: cardUi.parseHeroCardsInput(parsedVoice.heroCardsInput),
    boardVisual: buildBoardVisual(parsedVoice.board)
  })
}

function buildBoardEditorVisual(form) {
  return Object.keys(BOARD_FIELD_META).map(function (key) {
    const meta = BOARD_FIELD_META[key]
    return {
      key: key,
      label: meta.label,
      shortLabel: meta.shortLabel,
      cards: cardUi.parseCardsInput(form[key], meta.limit),
      emptyText: meta.emptyText
    }
  })
}

function buildTwoCardPickerDeck(form, targetKey) {
  const activeKey = targetKey || 'heroCardsInput'
  const selected = cardUi.parseHeroCardsInput(form[activeKey])
    .map(function (card) {
      return card.rank + card.suit
    })

  const occupied = Object.keys(BOARD_FIELD_META)
    .reduce(function (list, key) {
      const meta = BOARD_FIELD_META[key]
      return list.concat(
        cardUi.parseCardsInput(form[key], meta.limit).map(function (card) {
          return card.rank + card.suit
        })
      )
    }, [])
    .concat(
      cardUi.parseHeroCardsInput(activeKey === 'heroCardsInput' ? form.showdown : form.heroCardsInput)
        .map(function (card) {
          return card.rank + card.suit
        })
    )

  return SUITS.map(function (suit) {
    return {
      key: suit.key,
      cards: RANKS.map(function (rank) {
        const token = rank + suit.key
        return {
          token: token,
          rank: rank,
          suitClass: suit.className,
          suitSymbol: suit.symbol,
          selected: selected.indexOf(token) > -1,
          disabled: occupied.indexOf(token) > -1
        }
      })
    }
  })
}

function buildHeroPickerDeck(form) {
  return buildTwoCardPickerDeck(form, 'heroCardsInput')
}

function buildShowdownPickerDeck(form) {
  return buildTwoCardPickerDeck(form, 'showdown')
}

function buildHeroPickerPreview(form) {
  return cardUi.parseHeroCardsInput(form.heroCardsInput)
}

function buildHeroPickerHint(form) {
  const count = cardUi.parseHeroCardsInput(form.heroCardsInput).length
  return '已选 ' + count + ' / 2 张'
}

function buildBoardPickerDeck(form, activeKey) {
  const activeMeta = BOARD_FIELD_META[activeKey] || BOARD_FIELD_META.flop
  const activeSelected = cardUi.parseCardsInput(form[activeKey], activeMeta.limit)
    .map(function (card) {
      return card.rank + card.suit
    })

  const occupied = Object.keys(BOARD_FIELD_META)
    .filter(function (key) { return key !== activeKey })
    .reduce(function (list, key) {
      const meta = BOARD_FIELD_META[key]
      return list.concat(
        cardUi.parseCardsInput(form[key], meta.limit).map(function (card) {
          return card.rank + card.suit
        })
      )
    }, [])
    .concat(
      cardUi.parseHeroCardsInput(form.heroCardsInput).map(function (card) {
        return card.rank + card.suit
      })
    )

  return SUITS.map(function (suit) {
    return {
      key: suit.key,
      cards: RANKS.map(function (rank) {
        const token = rank + suit.key
        return {
          token: token,
          rank: rank,
          suitClass: suit.className,
          suitSymbol: suit.symbol,
          selected: activeSelected.indexOf(token) > -1,
          disabled: occupied.indexOf(token) > -1
        }
      })
    }
  })
}

function buildBoardPickerPreview(form, activeKey) {
  const meta = BOARD_FIELD_META[activeKey] || BOARD_FIELD_META.flop
  return cardUi.parseCardsInput(form[activeKey], meta.limit)
}

function buildBoardPickerHint(form, activeKey) {
  const meta = BOARD_FIELD_META[activeKey] || BOARD_FIELD_META.flop
  const count = cardUi.parseCardsInput(form[activeKey], meta.limit).length
  return '已选 ' + count + ' / ' + meta.limit + ' 张'
}

function replaceTokenAt(selected, replaceIndex, token, limit) {
  const next = (selected || []).slice(0, limit)
  if (replaceIndex < 0 || replaceIndex >= limit) return next
  const existingIndex = next.indexOf(token)
  if (existingIndex > -1 && existingIndex !== replaceIndex) {
    const old = next[replaceIndex]
    next[replaceIndex] = token
    next[existingIndex] = old
    return next.filter(Boolean).slice(0, limit)
  }
  next[replaceIndex] = token
  return next.filter(Boolean).slice(0, limit)
}

function getSessionDate(session) {
  if (!session) return ''
  return session.date || String(session.startTime || '').split(' ')[0] || ''
}

function getSessionLevel(session) {
  if (!session) return ''
  if (session.smallBlind || session.bigBlind) {
    return String(session.smallBlind || 0) + '/' + String(session.bigBlind || 0)
  }
  return ''
}

function getBigBlindFromLevel(levelText, session) {
  const text = String(levelText || '').trim()
  const match = text.match(/^(\d+)\s*\/\s*(\d+)$/)
  if (match) return Number(match[2]) || 0
  return Number(session && session.bigBlind) || 0
}

function formatResultBb(value, levelText, session) {
  const amount = Number(value)
  const bigBlind = getBigBlindFromLevel(levelText, session)
  if (!bigBlind || Number.isNaN(amount)) return '-'
  const bb = amount / bigBlind
  const rounded = Math.round(bb * 10) / 10
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  return (rounded > 0 ? '+' : '') + text + ' BB'
}

function buildSelectorOptions(list, currentValue) {
  return (list || []).map(function (item) {
    const value = String(item || '')
    return {
      label: value,
      value: value,
      selected: value === String(currentValue || '')
    }
  })
}

Page({
  data: {
    handId: '',
    hand: null,
    session: null,
    actions: [],
    chipUnit: 'BB',
    positions: [],
    opponentTypes: [],
    blindPresets: [],
    form: {
      playedDate: '',
      stakeLevel: '',
      playerCount: '',
      hasStraddle: false,
      heroSeat: '',
      heroPosition: '',
      villainPosition: '',
      villainType: '',
      buttonSeat: '',
      heroCardsInput: '',
      effectiveStack: '',
      potSize: '',
      currentProfit: '',
      opponentName: '',
      showdown: '',
      streetSummary: '',
      preflopActionLine: '',
      preflopPot: '',
      flopActionLine: '',
      flopPot: '',
      turnActionLine: '',
      turnPot: '',
      riverActionLine: '',
      riverPot: '',
      tagsInput: '',
      flop: '',
      turn: '',
      river: '',
      ev: '',
      mindJourney: '',
      heroQuestion: '',
      voiceNote: ''
    },
    detailRows: [],
    detailStreetItems: [],
    positionOptions: [],
    resultBbDisplay: '-',
    heroEditorVisual: [],
    heroPickerVisible: false,
    heroPickerHint: '',
    heroPickerPreview: [],
    heroPickerDeck: [],
    showdownPickerVisible: false,
    showdownPickerHint: '',
    showdownPickerPreview: [],
    showdownPickerDeck: [],
    boardEditorVisual: [],
    boardPickerVisible: false,
    boardPickerKey: 'flop',
    boardPickerTitle: '翻牌',
    boardPickerHint: '',
    boardPickerPreview: [],
    boardPickerDeck: [],
    boardReplaceIndex: -1,
    selectorVisible: false,
    selectorTitle: '',
    selectorKey: '',
    selectorOptions: [],
    parsedVoice: null,
    editMode: false,
    loading: false
  },
  onLoad(options) {
    this.setData({
      handId: options.id || '',
      editMode: options.edit === '1'
    })
    this.refresh()
  },
  onShow() {
    this.refresh()
  },
  async refresh() {
    this.setData({ loading: true })
    const settings = dataService.getAppSettings()
    const chipUnit = settings.chipUnit
    const hand = await dataService.getHandById(this.data.handId)
    if (!hand) {
      this.setData({ loading: false })
      return
    }
    const session = await dataService.getSessionById(hand.sessionId)
    const actions = await dataService.getActionsByHandId(hand._id)
    const handBoard = hand.board || {}
    const streetInputs = hand.streetInputs || {}
    const preflopInput = streetInputs.preflop || {}
    const flopInput = streetInputs.flop || {}
    const turnInput = streetInputs.turn || {}
    const riverInput = streetInputs.river || {}
    const form = {
      playedDate: hand.playedDate || getSessionDate(session),
      stakeLevel: hand.stakeLevel || getSessionLevel(session),
      playerCount: String(hand.playerCount || ''),
      hasStraddle: handDetailFields.normalizeBoolean(hand.hasStraddle),
      heroPosition: hand.heroPosition || '',
      villainPosition: hand.villainPosition || '',
      villainType: hand.villainType || hand.opponentType || '',
      heroCardsInput: normalizeCardsValue(hand.heroCardsInput, 2),
      effectiveStack: String(hand.effectiveStack || ''),
      potSize: String(hand.potSize || ''),
      currentProfit: String(hand.currentProfit || 0),
      opponentName: hand.opponentName || '',
      showdown: hand.showdown || '',
      streetSummary: hand.streetSummary || '',
      preflopActionLine: preflopInput.actionLine || '',
      preflopPot: String(preflopInput.pot || ''),
      flopActionLine: flopInput.actionLine || '',
      flopPot: String(flopInput.pot || ''),
      turnActionLine: turnInput.actionLine || '',
      turnPot: String(turnInput.pot || ''),
      riverActionLine: riverInput.actionLine || '',
      riverPot: String(riverInput.pot || ''),
      tagsInput: (hand.tags || []).join(', '),
      flop: normalizeCardsValue(handBoard.flop, 3),
      turn: normalizeCardsValue(handBoard.turn, 1),
      river: normalizeCardsValue(handBoard.river, 1),
      ev: hand.ev || '',
      mindJourney: hand.mindJourney || hand.notes || '',
      heroQuestion: hand.heroQuestion || '',
      voiceNote: hand.voiceNote || ''
    }
    const detailView = handDetailFields.buildHandDetailViewModel(hand, {
      mode: this.data.editMode ? 'edit' : 'readonly',
      backfilled: true,
      positions: settings.positions,
      session,
      excludeRowKeys: this.data.editMode ? [] : ['heroCardsInput', 'streetSummary', 'mindJourney']
    })
    this.setData({
      hand: Object.assign({}, hand, {
        currentProfitDisplay: display.formatAmount(hand.currentProfit, chipUnit),
        playedDateDisplay: hand.playedDate || getSessionDate(session),
        stakeLevelDisplay: hand.stakeLevel || getSessionLevel(session),
        heroCardsVisual: cardUi.parseHeroCardsInput(normalizeCardsValue(hand.heroCardsInput, 2)),
        boardVisual: buildBoardVisual(handBoard)
      }),
      session,
      actions,
      chipUnit,
      positions: settings.positions,
      opponentTypes: settings.opponentTypes,
      blindPresets: settings.blindPresets,
      form: form,
      detailRows: detailView.rows,
      detailStreetItems: detailView.streetItems,
      positionOptions: detailView.positionOptions,
      resultBbDisplay: formatResultBb(form.currentProfit, form.stakeLevel, session),
      heroEditorVisual: cardUi.parseHeroCardsInput(form.heroCardsInput),
      showdownPickerHint: '已选 ' + cardUi.parseHeroCardsInput(form.showdown).length + ' / 2 张',
      showdownPickerPreview: cardUi.parseHeroCardsInput(form.showdown),
      showdownPickerDeck: buildShowdownPickerDeck(form),
      heroPickerVisible: false,
      heroPickerHint: '',
      heroPickerPreview: [],
      heroPickerDeck: [],
      showdownPickerVisible: false,
      showdownPickerHint: '',
      showdownPickerPreview: [],
      showdownPickerDeck: [],
      boardEditorVisual: buildBoardEditorVisual(form),
      boardPickerVisible: false,
      loading: false
    })
  },
  onInput(e) {
    const key = e.currentTarget.dataset.key
    const value = e.detail.value
    const nextForm = Object.assign({}, this.data.form, { [key]: value })
    const patch = { ['form.' + key]: value }
    if (key === 'currentProfit' || key === 'stakeLevel') {
      patch.resultBbDisplay = formatResultBb(nextForm.currentProfit, nextForm.stakeLevel, this.data.session)
    }
    this.setData(patch)
  },
  toggleStraddle() {
    this.setStraddleValue(!this.data.form.hasStraddle)
  },
  onStraddleCheckboxChange(e) {
    this.setStraddleValue((e.detail.value || []).indexOf('1') > -1)
  },
  setStraddleValue(hasStraddle) {
    const positionOptions = handDetailFields.getPositionOptions(this.data.positions, hasStraddle)
    const patch = {
      'form.hasStraddle': hasStraddle,
      positionOptions
    }
    if (!hasStraddle && this.data.form.heroPosition === 'STR') {
      patch['form.heroPosition'] = positionOptions[0] || ''
    }
    if (!hasStraddle && this.data.form.villainPosition === 'STR') {
      patch['form.villainPosition'] = positionOptions[positionOptions.length - 1] || ''
    }
    this.setData(patch)
  },
  noop() {},
  openHeroPicker() {
    this.setData({
      heroPickerVisible: true,
      heroPickerHint: buildHeroPickerHint(this.data.form),
      heroPickerPreview: buildHeroPickerPreview(this.data.form),
      heroPickerDeck: buildHeroPickerDeck(this.data.form)
    })
  },
  closeHeroPicker() {
    this.setData({ heroPickerVisible: false })
  },
  syncHeroField(rawValue) {
    const normalized = normalizeCardsValue(rawValue, 2)
    const nextForm = Object.assign({}, this.data.form, {
      heroCardsInput: normalized
    })
    const patch = {
      'form.heroCardsInput': normalized,
      heroEditorVisual: cardUi.parseHeroCardsInput(normalized),
      showdownPickerDeck: buildShowdownPickerDeck(nextForm)
    }
    if (this.data.hand) {
      patch['hand.heroCardsVisual'] = cardUi.parseHeroCardsInput(normalized)
    }
    if (this.data.heroPickerVisible) {
      patch.heroPickerHint = buildHeroPickerHint(nextForm)
      patch.heroPickerPreview = buildHeroPickerPreview(nextForm)
      patch.heroPickerDeck = buildHeroPickerDeck(nextForm)
    }
    if (this.data.boardPickerVisible && this.data.boardPickerKey) {
      patch.boardPickerDeck = buildBoardPickerDeck(nextForm, this.data.boardPickerKey)
    }
    this.setData(patch)
  },
  openShowdownPicker() {
    if (!this.data.editMode) return
    this.setData({
      showdownPickerVisible: true,
      showdownPickerHint: '已选 ' + cardUi.parseHeroCardsInput(this.data.form.showdown).length + ' / 2 张',
      showdownPickerPreview: cardUi.parseHeroCardsInput(this.data.form.showdown),
      showdownPickerDeck: buildShowdownPickerDeck(this.data.form)
    })
  },
  closeShowdownPicker() {
    this.setData({ showdownPickerVisible: false })
  },
  syncShowdownField(rawValue) {
    const normalized = normalizeCardsValue(rawValue, 2)
    const nextForm = Object.assign({}, this.data.form, {
      showdown: normalized
    })
    const patch = {
      'form.showdown': normalized,
      showdownPickerHint: '已选 ' + cardUi.parseHeroCardsInput(normalized).length + ' / 2 张',
      showdownPickerPreview: cardUi.parseHeroCardsInput(normalized),
      showdownPickerDeck: buildShowdownPickerDeck(nextForm),
      heroPickerDeck: buildHeroPickerDeck(nextForm)
    }
    if (this.data.boardPickerVisible && this.data.boardPickerKey) {
      patch.boardPickerDeck = buildBoardPickerDeck(nextForm, this.data.boardPickerKey)
    }
    this.setData(patch)
  },
  pickShowdownCard(e) {
    const token = e.currentTarget.dataset.token
    const disabled = !!e.currentTarget.dataset.disabled
    if (!token || disabled) return
    const selected = cardUi.parseHeroCardsInput(this.data.form.showdown)
      .map(function (card) {
        return card.rank + card.suit
      })
    const existsIndex = selected.indexOf(token)
    const next = existsIndex > -1
      ? selected.filter(function (item) { return item !== token })
      : selected.concat(token).slice(0, 2)
    this.syncShowdownField(next.join(''))
    if (next.length >= 2) {
      this.setData({ showdownPickerVisible: false })
    }
  },
  handleShowdownPickerTool(e) {
    const action = e.currentTarget.dataset.action
    const selected = cardUi.parseHeroCardsInput(this.data.form.showdown)
      .map(function (card) {
        return card.rank + card.suit
      })
    let next = selected
    if (action === 'backspace') {
      next = selected.slice(0, -1)
    }
    if (action === 'clear') {
      next = []
    }
    this.syncShowdownField(next.join(''))
  },
  pickHeroCard(e) {
    const token = e.currentTarget.dataset.token
    const disabled = !!e.currentTarget.dataset.disabled
    if (!token || disabled) return
    const selected = cardUi.parseHeroCardsInput(this.data.form.heroCardsInput)
      .map(function (card) {
        return card.rank + card.suit
      })
    const existsIndex = selected.indexOf(token)
    let next = []
    if (existsIndex > -1) {
      next = selected.filter(function (item) { return item !== token })
    } else {
      next = selected.concat(token).slice(0, 2)
    }
    this.syncHeroField(next.join(''))
    if (next.length >= 2) {
      this.setData({ heroPickerVisible: false })
    }
  },
  handleHeroPickerTool(e) {
    const action = e.currentTarget.dataset.action
    const selected = cardUi.parseHeroCardsInput(this.data.form.heroCardsInput)
      .map(function (card) {
        return card.rank + card.suit
      })
    let next = selected
    if (action === 'backspace') {
      next = selected.slice(0, -1)
    }
    if (action === 'clear') {
      next = []
    }
    this.syncHeroField(next.join(''))
  },
  openBoardPicker(e) {
    const key = e.currentTarget.dataset.key
    const meta = BOARD_FIELD_META[key]
    if (!meta) return
    const replaceIndex = Number(e.currentTarget.dataset.replaceIndex)
    const normalizedReplaceIndex = !Number.isNaN(replaceIndex) && replaceIndex >= 0 && replaceIndex < meta.limit
      ? replaceIndex
      : -1
    this.setData({
      boardPickerVisible: true,
      boardPickerKey: key,
      boardPickerTitle: meta.label,
      boardReplaceIndex: normalizedReplaceIndex,
      boardPickerHint: normalizedReplaceIndex >= 0
        ? '正在替换第 ' + (normalizedReplaceIndex + 1) + ' 张'
        : buildBoardPickerHint(this.data.form, key),
      boardPickerPreview: buildBoardPickerPreview(this.data.form, key),
      boardPickerDeck: buildBoardPickerDeck(this.data.form, key)
    })
  },
  closeBoardPicker() {
    this.setData({ boardPickerVisible: false, boardReplaceIndex: -1 })
  },
  syncBoardField(key, rawValue) {
    const meta = BOARD_FIELD_META[key]
    if (!meta) return
    const normalized = normalizeCardsValue(rawValue, meta.limit)
    const nextForm = Object.assign({}, this.data.form, {
      [key]: normalized
    })
    const patch = {
      ['form.' + key]: normalized,
      boardEditorVisual: buildBoardEditorVisual(nextForm)
    }
    if (this.data.hand) {
      patch['hand.boardVisual'] = buildBoardVisual(nextForm)
    }
    if (this.data.boardPickerVisible && this.data.boardPickerKey) {
      patch.boardPickerHint = buildBoardPickerHint(nextForm, this.data.boardPickerKey)
      patch.boardPickerPreview = buildBoardPickerPreview(nextForm, this.data.boardPickerKey)
      patch.boardPickerDeck = buildBoardPickerDeck(nextForm, this.data.boardPickerKey)
    }
    if (this.data.showdownPickerVisible) {
      patch.showdownPickerDeck = buildShowdownPickerDeck(nextForm)
    }
    this.setData(patch)
  },
  pickBoardCard(e) {
    const token = e.currentTarget.dataset.token
    const disabled = !!e.currentTarget.dataset.disabled
    const key = this.data.boardPickerKey
    const meta = BOARD_FIELD_META[key]
    if (!token || !meta || disabled) return
    const selected = cardUi.parseCardsInput(this.data.form[key], meta.limit)
      .map(function (card) {
        return card.rank + card.suit
      })
    const existsIndex = selected.indexOf(token)
    const replaceIndex = Number(this.data.boardReplaceIndex)
    let next = []
    if (replaceIndex >= 0 && replaceIndex < meta.limit) {
      next = replaceTokenAt(selected, replaceIndex, token, meta.limit)
    } else if (existsIndex > -1) {
      next = selected.filter(function (item) { return item !== token })
    } else {
      next = selected.concat(token).slice(0, meta.limit)
    }
    this.syncBoardField(key, next.join(''))
    if (replaceIndex >= 0 || next.length >= meta.limit) {
      this.setData({ boardPickerVisible: false, boardReplaceIndex: -1 })
    }
  },
  selectBoardReplaceCard(e) {
    const index = Number(e.currentTarget.dataset.index)
    this.setData({
      boardReplaceIndex: Number.isNaN(index) ? -1 : index,
      boardPickerHint: '正在替换第 ' + (index + 1) + ' 张'
    })
  },
  handleBoardPickerTool(e) {
    const action = e.currentTarget.dataset.action
    const key = this.data.boardPickerKey
    const meta = BOARD_FIELD_META[key]
    if (!meta) return
    const selected = cardUi.parseCardsInput(this.data.form[key], meta.limit)
      .map(function (card) {
        return card.rank + card.suit
      })
    let next = selected
    if (action === 'backspace') {
      next = selected.slice(0, -1)
    }
    if (action === 'clear') {
      next = []
    }
    this.syncBoardField(key, next.join(''))
  },
  pickPosition(e) {
    this.setData({ 'form.heroPosition': this.data.positionOptions[e.detail.value] })
  },
  openPositionSelector() {
    this.setData({
      selectorVisible: true,
      selectorTitle: '选择位置',
      selectorKey: 'heroPosition',
      selectorOptions: buildSelectorOptions(this.data.positionOptions, this.data.form.heroPosition)
    })
  },
  openVillainPositionSelector() {
    this.setData({
      selectorVisible: true,
      selectorTitle: '选择对手位置',
      selectorKey: 'villainPosition',
      selectorOptions: buildSelectorOptions(this.data.positionOptions, this.data.form.villainPosition)
    })
  },
  openVillainTypeSelector() {
    this.setData({
      selectorVisible: true,
      selectorTitle: '选择对手类型',
      selectorKey: 'villainType',
      selectorOptions: buildSelectorOptions(this.data.opponentTypes, this.data.form.villainType)
    })
  },
  openLevelSelector() {
    this.setData({
      selectorVisible: true,
      selectorTitle: '选择级别',
      selectorKey: 'stakeLevel',
      selectorOptions: buildSelectorOptions(this.data.blindPresets, this.data.form.stakeLevel)
    })
  },
  closeSelector() {
    this.setData({ selectorVisible: false })
  },
  selectPresetOption(e) {
    const key = this.data.selectorKey
    const value = String(e.currentTarget.dataset.value || '')
    if (!key || !value) return
    const nextForm = Object.assign({}, this.data.form, { [key]: value })
    const patch = {
      ['form.' + key]: value,
      selectorVisible: false
    }
    if (key === 'stakeLevel') {
      patch.resultBbDisplay = formatResultBb(nextForm.currentProfit, nextForm.stakeLevel, this.data.session)
    }
    this.setData(patch)
  },
  async saveDetail() {
    if (!this.data.editMode) {
      wx.showToast({ title: '只读模式不可编辑', icon: 'none' })
      return
    }
    const tags = this.data.form.tagsInput
      ? this.data.form.tagsInput.split(',').map(item => item.trim()).filter(Boolean)
      : []
    await dataService.updateHand(this.data.handId, {
      playedDate: this.data.form.playedDate,
      stakeLevel: this.data.form.stakeLevel,
      playerCount: this.data.form.playerCount,
      hasStraddle: this.data.form.hasStraddle,
      heroPosition: this.data.form.heroPosition,
      villainPosition: this.data.form.villainPosition,
      villainType: this.data.form.villainType,
      heroCardsInput: this.data.form.heroCardsInput,
      effectiveStack: this.data.form.effectiveStack,
      potSize: this.data.form.potSize,
      currentProfit: this.data.form.currentProfit,
      resultBB: formatResultBb(this.data.form.currentProfit, this.data.form.stakeLevel, this.data.session),
      opponentType: this.data.form.villainType,
      opponentName: this.data.form.opponentName,
      showdown: this.data.form.showdown,
      streetSummary: this.data.form.streetSummary,
      streetInputs: {
        preflop: {
          board: '',
          actionLine: this.data.form.preflopActionLine,
          pot: this.data.form.preflopPot
        },
        flop: {
          board: this.data.form.flop,
          actionLine: this.data.form.flopActionLine,
          pot: this.data.form.flopPot
        },
        turn: {
          board: this.data.form.turn,
          actionLine: this.data.form.turnActionLine,
          pot: this.data.form.turnPot
        },
        river: {
          board: this.data.form.river,
          actionLine: this.data.form.riverActionLine,
          pot: this.data.form.riverPot
        }
      },
      tags,
      board: {
        flop: this.data.form.flop,
        turn: this.data.form.turn,
        river: this.data.form.river
      },
      ev: this.data.form.ev,
      notes: this.data.form.mindJourney,
      mindJourney: this.data.form.mindJourney,
      heroQuestion: this.data.form.heroQuestion,
      detailBackfilled: true,
      voiceNote: this.data.form.voiceNote
    })
    wx.showToast({ title: '详情已保存', icon: 'success' })
    this.refresh()
  },
  parseVoice() {
    if (!this.data.form.voiceNote) {
      wx.showToast({ title: '请先输入口述内容', icon: 'none' })
      return
    }
    const parsedVoice = buildParsedVoicePreview(voiceParser.parseVoiceText(this.data.form.voiceNote))
    this.setData({ parsedVoice })
    wx.showToast({ title: '已生成复盘建议', icon: 'success' })
  },
  async applyVoice() {
    if (!this.data.parsedVoice) {
      wx.showToast({ title: '暂无可回填内容', icon: 'none' })
      return
    }
    const parsed = this.data.parsedVoice
    const patch = {
      heroPosition: parsed.heroPosition || this.data.hand.heroPosition,
      heroCardsInput: parsed.heroCardsInput || this.data.hand.heroCardsInput,
      effectiveStack: parsed.effectiveStack || this.data.hand.effectiveStack,
      potSize: parsed.potSize || this.data.hand.potSize,
      currentProfit: parsed.currentProfit || this.data.hand.currentProfit,
      board: {
        flop: parsed.board.flop || this.data.form.flop,
        turn: parsed.board.turn || this.data.form.turn,
        river: parsed.board.river || this.data.form.river
      },
      voiceNote: this.data.form.voiceNote,
      notes: (this.data.form.mindJourney || '') + '\n[语音复盘] ' + parsed.noteSummary,
      mindJourney: (this.data.form.mindJourney || '') + '\n[语音复盘] ' + parsed.noteSummary
    }
    await dataService.updateHand(this.data.handId, patch)
    wx.showToast({ title: '已确认回填', icon: 'success' })
    this.setData({ parsedVoice: null })
    this.refresh()
  },
  deleteHand() {
    if (!this.data.editMode) {
      wx.showToast({ title: '只读模式不可删除', icon: 'none' })
      return
    }
    wx.showModal({
      title: '删除手牌',
      content: '删除后本手动作链也会一起移除，是否继续？',
      confirmColor: '#dc2626',
      success: async res => {
        if (!res.confirm) return
        await dataService.deleteHand(this.data.handId)
        wx.showToast({ title: '已删除', icon: 'success' })
        setTimeout(() => {
          wx.navigateBack()
        }, 250)
      }
    })
  }
})
