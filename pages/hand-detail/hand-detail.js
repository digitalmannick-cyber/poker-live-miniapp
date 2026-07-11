const dataService = require('../../services/data-service')
const aiService = require('../../services/ai-service')
const cardUi = require('../../utils/card-ui')
const display = require('../../utils/display')
const handDetailFields = require('../../utils/hand-detail-fields')
const reviewTags = require('../../utils/review-tags')
const handExport = require('../../utils/hand-export')

const REVIEW_PENDING_ENTRY_KEY = 'pokerReviewPendingEntry'
const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']
const SUITS = [
  { key: 's', symbol: '♠', className: 'spade' },
  { key: 'h', symbol: '♥', className: 'heart' },
  { key: 'd', symbol: '♦', className: 'diamond' },
  { key: 'c', symbol: '♣', className: 'club' }
]
const BOARD_FIELD_META = {
  flop: { label: '翻牌', shortLabel: '翻牌', limit: 3, emptyText: '选择 3 张公牌' },
  turn: { label: '转牌', shortLabel: '转牌', limit: 1, emptyText: '选择 1 张公牌' },
  river: { label: '河牌', shortLabel: '河牌', limit: 1, emptyText: '选择 1 张公牌' }
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

function buildTagOptions(tagsInput) {
  const selected = reviewTags.normalizeReviewTags(tagsInput)
  return reviewTags.REVIEW_TAG_OPTIONS.map(function (item) {
    return {
      key: item.key,
      label: item.label,
      active: selected.indexOf(item.label) > -1
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

function getEffectiveHasStraddle(hand, session) {
  return handDetailFields.normalizeBoolean(
    (session && session.hasStraddle) || (hand && hand.hasStraddle)
  )
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

function number(value) {
  return Number(value) || 0
}

function normalizeAdviceActions(actions) {
  return (actions || []).map(item => ({
    street: item.street || '',
    pos: item.pos || '',
    position: item.position || item.actorLabel || item.pos || '',
    action: item.action || item.actionType || '',
    amount: number(item.amount),
    potAfter: number(item.potAfter)
  }))
}

function buildDetailAdviceQuestion(hand) {
  const source = hand || {}
  const board = source.board || {}
  const streets = source.streetInputs || {}
  const lines = [
    '请从职业德州扑克现金局教练角度复盘这手牌。',
    '重点指出明确错误、可优化点、打得好的地方、剥削调整和训练计划。',
    '不要泛泛而谈，要围绕范围、SPR、位置、下注尺度、对手类型和逐街行动线判断。',
    'Hero: ' + [source.heroPosition, source.heroCardsInput].filter(Boolean).join(' '),
    '级别: ' + (source.stakeLevel || ''),
    '人数/straddle: ' + (source.playerCount || '') + ' / ' + (source.hasStraddle ? '是' : '否'),
    '有效筹码: ' + (source.effectiveStack || ''),
    '对手: ' + [source.villainPosition, source.villainType || source.opponentType, source.opponentName].filter(Boolean).join(' '),
    '牌面: ' + [board.flop, board.turn, board.river].filter(Boolean).join(' / '),
    '行动线: ' + (
      source.streetSummary ||
      ['preflop', 'flop', 'turn', 'river']
        .map(key => {
          const street = streets[key] || {}
          return street.actionLine ? key + ': ' + street.actionLine + (street.pot ? ' Pot ' + street.pot : '') : ''
        })
        .filter(Boolean)
        .join(' / ')
    ),
    '结果: ' + (source.currentProfit || 0)
  ]
  return lines.filter(item => String(item || '').trim()).join('\n')
}

function buildAiAdviceErrorText(error) {
  const raw = error && error.raw || {}
  return [
    error && error.aiReviewError,
    error && error.debugError,
    raw.aiReviewError,
    raw.debugError,
    raw.message,
    raw.answer,
    raw.data && raw.data.message,
    raw.data && raw.data.error,
    error && error.message,
    error && error.errMsg,
    error
  ]
    .map(item => String(item || '').trim())
    .filter(Boolean)[0] || 'EV脑出问题啦，请稍后再重新生成AI建议。'
}

Page({
  data: {
    handId: '',
    hand: null,
    session: null,
    actions: [],
    exportVisible: false,
    exportText: '',
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
      allInEv: '',
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
    showdownPickerText: '',
    showdownPickerPreview: [],
    showdownPickerDeck: [],
    boardEditorVisual: [],
    tagOptions: buildTagOptions(''),
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
    editMode: false,
    loading: false
  },
  onLoad(options) {
    this.pendingInputForm = {}
    this.setData({
      handId: options.id || '',
      editMode: options.edit === '1'
    })
    this.refresh()
  },
  onShow() {
    this.refresh()
  },
  copyHandId() {
    const handId = this.data.hand && this.data.hand._id
    if (!handId) {
      wx.showToast({ title: '\u6ca1\u6709\u53ef\u590d\u5236\u7684ID', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: String(handId),
      success() {
        wx.showToast({ title: '\u5df2\u590d\u5236ID', icon: 'success' })
      }
    })
  },
  openExport() {
    if (!this.data.exportText) {
      wx.showToast({ title: '没有可导出的手牌', icon: 'none' })
      return
    }
    this.setData({ exportVisible: true })
  },
  closeExport() {
    this.setData({ exportVisible: false })
  },
  copyExportText() {
    const exportText = this.data.exportText
    if (!exportText) {
      wx.showToast({ title: '没有可复制的导出文本', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: exportText,
      success() {
        wx.showToast({ title: '导出文本已复制', icon: 'success' })
      }
    })
  },
  startVoiceReview() {
    const handId = this.data.handId
    if (!handId) return
    wx.setStorageSync(REVIEW_PENDING_ENTRY_KEY, {
      handId,
      mode: 'voice',
      createdAt: Date.now()
    })
    wx.switchTab({ url: '/pages/review-list/review-list' })
  },
  startLedgerReview() {
    const handId = this.data.handId
    if (!handId) return
    wx.navigateTo({ url: '/pages/hand-ledger-input/hand-ledger-input?handId=' + handId })
  },
  async refresh() {
    this.pendingInputForm = {}
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
    const exportText = handExport.buildPokerStarsExport(hand, { session, actions })
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
      hasStraddle: getEffectiveHasStraddle(hand, session),
      heroPosition: hand.heroPosition || '',
      villainPosition: hand.villainPosition || '',
      villainType: hand.villainType || hand.opponentType || '',
      heroCardsInput: normalizeCardsValue(hand.heroCardsInput, 2),
      effectiveStack: String(hand.effectiveStack || ''),
      potSize: String(hand.potSize || ''),
      currentProfit: String(hand.currentProfit || 0),
      isAllIn: !!(hand.isAllIn || hand.allInEvEligible || (hand.allInStreet && String(hand.allInStreet).toLowerCase() !== 'river')),
      allInEv: hand.allInEv === 0 ? '' : String(hand.allInEv || hand.allInEvProfit || ''),
      opponentName: hand.opponentName || '',
      opponentCards: hand.opponentCards || '',
      opponentCardsSource: hand.opponentCardsSource || '',
      showdown: hand.opponentCards || hand.showdown || '',
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
      exportText,
      exportVisible: false,
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
      showdownPickerText: form.showdown,
      showdownPickerPreview: cardUi.parseOpponentCardsInput(form.showdown, {
        board: form.board,
        heroCardsInput: form.heroCardsInput
      }),
      showdownPickerDeck: buildShowdownPickerDeck(form),
      heroPickerVisible: false,
      heroPickerHint: '',
      heroPickerPreview: [],
      heroPickerDeck: [],
      showdownPickerVisible: false,
      showdownPickerHint: '',
      showdownPickerText: form.showdown,
      showdownPickerPreview: [],
      showdownPickerDeck: [],
      boardEditorVisual: buildBoardEditorVisual(form),
      tagOptions: buildTagOptions(form.tagsInput),
      boardPickerVisible: false,
      loading: false
    })
  },
  onInput(e) {
    const key = e.currentTarget.dataset.key
    const value = e.detail.value
    if (e.type === 'input') {
      this.pendingInputForm = Object.assign({}, this.pendingInputForm || {}, { [key]: value })
      return
    }
    this.commitFormInput(key, value)
  },
  commitInputValue(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    this.commitFormInput(key, e.detail.value)
  },
  commitFormInput(key, value) {
    const pending = Object.assign({}, this.pendingInputForm || {})
    delete pending[key]
    this.pendingInputForm = pending
    const nextForm = Object.assign({}, this.data.form, { [key]: value })
    const patch = { ['form.' + key]: value }
    if (key === 'tagsInput') {
      patch.tagOptions = buildTagOptions(value)
    }
    if (key === 'currentProfit' || key === 'stakeLevel') {
      patch.resultBbDisplay = formatResultBb(nextForm.currentProfit, nextForm.stakeLevel, this.data.session)
    }
    this.setData(patch)
  },
  commitPendingInputs() {
    const pending = Object.assign({}, this.pendingInputForm || {})
    const form = Object.assign({}, this.data.form, pending)
    const keys = Object.keys(pending)
    if (keys.length) {
      const patch = {}
      keys.forEach(key => {
        patch['form.' + key] = pending[key]
      })
      if (keys.indexOf('tagsInput') > -1) {
        patch.tagOptions = buildTagOptions(form.tagsInput)
      }
      if (keys.indexOf('currentProfit') > -1 || keys.indexOf('stakeLevel') > -1) {
        patch.resultBbDisplay = formatResultBb(form.currentProfit, form.stakeLevel, this.data.session)
      }
      this.setData(patch)
    }
    this.pendingInputForm = {}
    return form
  },
  toggleStraddle() {
    this.setStraddleValue(!this.data.form.hasStraddle)
  },
  onStraddleCheckboxChange(e) {
    this.setStraddleValue((e.detail.value || []).indexOf('1') > -1)
  },
  onAllInCheckboxChange(e) {
    this.commitFormInput('isAllIn', (e.detail.value || []).indexOf('1') > -1)
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
  toggleTag(e) {
    if (!this.data.editMode) return
    const label = String(e.currentTarget.dataset.label || '')
    if (!label) return
    const current = reviewTags.normalizeReviewTags(this.data.form.tagsInput)
    const index = current.indexOf(label)
    const next = index > -1
      ? current.filter(item => item !== label)
      : current.concat(label)
    const tagsInput = next.join(', ')
    this.setData({
      'form.tagsInput': tagsInput,
      tagOptions: buildTagOptions(tagsInput)
    })
  },
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
      showdownPickerText: this.data.form.showdown,
      showdownPickerPreview: cardUi.parseOpponentCardsInput(this.data.form.showdown, {
        board: this.data.form.board,
        heroCardsInput: this.data.form.heroCardsInput
      }),
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
      showdownPickerText: normalized,
      showdownPickerPreview: cardUi.parseOpponentCardsInput(normalized, {
        board: nextForm.board,
        heroCardsInput: nextForm.heroCardsInput
      }),
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
  buildAiAdviceRequest(hand, session, actions) {
    const profile = dataService.getCurrentProfile ? dataService.getCurrentProfile() : {}
    const settings = dataService.getAppSettings ? dataService.getAppSettings() : {}
    const source = hand || {}
    const sessionSource = session || {}
    const normalizedActions = normalizeAdviceActions(actions || source.actions || [])
    const structuredHand = Object.assign({}, source, {
      playerCount: Number(source.playerCount) || 0,
      effectiveStack: Number(source.effectiveStack) || 0,
      potSize: Number(source.potSize) || 0,
      currentProfit: Number(source.currentProfit) || 0,
      actions: normalizedActions
    })
    const question = buildDetailAdviceQuestion(structuredHand)
    return {
      mode: 'advice',
      question,
      transcript: question,
      userId: profile && profile.playerId || '',
      playerId: profile && profile.playerId || '',
      userTerms: settings.voiceTerms || [],
      corrections: null,
      hand: structuredHand,
      structuredHand,
      extractedHand: structuredHand,
      session: sessionSource
        ? {
          title: sessionSource.title || '',
          playerCount: Number(sessionSource.playerCount) || 0,
          date: sessionSource.date || String(sessionSource.startTime || '').split(' ')[0] || '',
          venue: sessionSource.venue || '',
          smallBlind: sessionSource.smallBlind || 0,
          bigBlind: sessionSource.bigBlind || 0,
          tableSize: Number(sessionSource.tableSize) || Number(sessionSource.playerCount) || 0,
          hasStraddle: !!sessionSource.hasStraddle
        }
        : null,
      actions: normalizedActions.map(item => ({
        street: item.street,
        actorLabel: item.position || item.pos || '',
        actionType: item.action || '',
        amount: item.amount || 0,
        potAfter: item.potAfter || 0
      }))
    }
  },
  async generateDetailAiAdvice(handId, payload) {
    if (!handId) return
    try {
      const savedHand = Object.assign({}, payload || {}, { _id: handId })
      const result = await aiService.reviewHandVoice(this.buildAiAdviceRequest(savedHand, this.data.session, this.data.actions))
      if (result.code && result.code !== 0) {
        const error = new Error(result.message || 'EV brain advice failed')
        error.code = result.code
        error.raw = result
        throw error
      }
      const aiReview = result.analysis || null
      const aiReviewError = result && (
        result.aiReviewError ||
        result.debugError ||
        result.message ||
        result.answer ||
        result.data && result.data.message ||
        result.data && result.data.error
      ) || 'EV脑出问题啦，请稍后再重新生成AI建议。'
      await dataService.updateHand(handId, {
        aiReview,
        aiReviewStatus: aiReview ? 'ready' : 'failed',
        aiReviewGeneratedAt: Date.now(),
        aiReviewError: aiReview ? '' : aiReviewError
      })
    } catch (error) {
      try {
        await dataService.updateHand(handId, {
          aiReview: null,
          aiReviewStatus: 'failed',
          aiReviewError: buildAiAdviceErrorText(error)
        })
      } catch (saveError) {
        console.warn('detail AI advice failure status save failed: ' + (saveError && (saveError.errMsg || saveError.message) || String(saveError)))
      }
    }
  },
  async saveDetail() {
    if (!this.data.editMode) {
      wx.showToast({ title: '只读模式不可编辑', icon: 'none' })
      return
    }
    const form = this.commitPendingInputs()
    this.data.form = form
    const tags = form.tagsInput
      ? form.tagsInput.split(',').map(item => item.trim()).filter(Boolean)
      : []
    const detailPatch = {
      playedDate: form.playedDate,
      stakeLevel: form.stakeLevel,
      playerCount: form.playerCount,
      hasStraddle: form.hasStraddle,
      heroPosition: form.heroPosition,
      villainPosition: form.villainPosition,
      villainType: form.villainType,
      heroCardsInput: form.heroCardsInput,
      effectiveStack: form.effectiveStack,
      potSize: form.potSize,
      currentProfit: form.currentProfit,
      isAllIn: !!form.isAllIn,
      allInEv: form.isAllIn ? this.data.form.allInEv : '',
      allInStreet: form.isAllIn ? (this.data.hand && this.data.hand.allInStreet || '') : '',
      resultBB: formatResultBb(form.currentProfit, form.stakeLevel, this.data.session),
      opponentType: form.villainType,
      opponentName: form.opponentName,
      opponentCards: form.opponentCards || form.showdown,
      opponentCardsSource: form.opponentCardsSource || '',
      showdown: form.showdown,
      streetSummary: form.streetSummary,
      streetInputs: {
        preflop: {
          board: '',
          actionLine: form.preflopActionLine,
          pot: form.preflopPot
        },
        flop: {
          board: form.flop,
          actionLine: form.flopActionLine,
          pot: form.flopPot
        },
        turn: {
          board: form.turn,
          actionLine: form.turnActionLine,
          pot: form.turnPot
        },
        river: {
          board: form.river,
          actionLine: form.riverActionLine,
          pot: form.riverPot
        }
      },
      tags,
      board: {
        flop: form.flop,
        turn: form.turn,
        river: form.river
      },
      ev: form.ev,
      notes: form.mindJourney,
      mindJourney: form.mindJourney,
      heroQuestion: form.heroQuestion,
      detailBackfilled: true,
      voiceNote: form.voiceNote,
      aiReview: null,
      aiReviewStatus: 'generating',
      aiReviewError: ''
    }
    await dataService.updateHand(this.data.handId, detailPatch)
    this.generateDetailAiAdvice(this.data.handId, detailPatch)
    wx.showToast({ title: '详情已保存', icon: 'success' })
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
