const dataService = require('../../services/data-service')
const cardUi = require('../../utils/card-ui')
const tabBar = require('../../utils/tab-bar')

const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']
const SUITS = [
  { key: 's', symbol: '♠', className: 'spade' },
  { key: 'h', symbol: '♥', className: 'heart' },
  { key: 'd', symbol: '♦', className: 'diamond' },
  { key: 'c', symbol: '♣', className: 'club' }
]
const BOARD_FIELD_META = {
  flop: { label: '翻牌', limit: 3, emptyText: '选择 3 张公牌' },
  turn: { label: '转牌', limit: 1, emptyText: '选择 1 张公牌' },
  river: { label: '河牌', limit: 1, emptyText: '选择 1 张公牌' }
}

function parseHeroCardsInput(value) {
  return String(value || '')
    .trim()
    .match(/([2-9TJQKA])([shdc])/ig) || []
}

function normalizeCardsValue(value, limit) {
  return cardUi.parseCardsInput(value, limit)
    .map(function (card) {
      return card.rank + card.suit
    })
    .join('')
}

function hasDuplicateHeroCards(value) {
  const cards = parseHeroCardsInput(value).slice(0, 2).map(item => ({
    rank: item[0].toUpperCase(),
    suit: item[1].toLowerCase()
  }))
  if (cards.length < 2) return false
  return cards[0].rank === cards[1].rank && cards[0].suit === cards[1].suit
}

function buildBoardEditorVisual(form) {
  return Object.keys(BOARD_FIELD_META).map(function (key) {
    const meta = BOARD_FIELD_META[key]
    return {
      key: key,
      label: meta.label,
      cards: cardUi.parseCardsInput(form[key], meta.limit),
      emptyText: meta.emptyText
    }
  })
}

function buildHeroPickerDeck(form) {
  const selected = parseHeroCardsInput(form.heroCardsInput)
    .slice(0, 2)
    .map(item => item[0].toUpperCase() + item[1].toLowerCase())

  const occupied = Object.keys(BOARD_FIELD_META)
    .reduce(function (list, key) {
      const meta = BOARD_FIELD_META[key]
      return list.concat(
        cardUi.parseCardsInput(form[key], meta.limit).map(function (card) {
          return card.rank + card.suit
        })
      )
    }, [])

  return SUITS.map(function (suit) {
    return {
      key: suit.key,
      symbol: suit.symbol,
      className: suit.className,
      cards: RANKS.map(function (rank) {
        const token = rank + suit.key
        return {
          token: token,
          rank: rank,
          suitSymbol: suit.symbol,
          suitClass: suit.className,
          selected: selected.indexOf(token) > -1,
          disabled: occupied.indexOf(token) > -1
        }
      })
    }
  })
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
      parseHeroCardsInput(form.heroCardsInput)
        .slice(0, 2)
        .map(function (item) {
          return item[0].toUpperCase() + item[1].toLowerCase()
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
          suitSymbol: suit.symbol,
          suitClass: suit.className,
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

function parseProfitEditorValue(value) {
  const text = String(value || '').trim()
  if (!text) {
    return {
      sign: '+',
      digits: ''
    }
  }
  const sign = text.charAt(0) === '-' ? '-' : '+'
  const digits = text.replace(/^[+-]/, '').replace(/\D/g, '')
  return {
    sign: sign,
    digits: digits
  }
}

function buildProfitEditorValue(sign, digits) {
  const value = String(digits || '').replace(/\D/g, '')
  if (!value) return ''
  return (sign === '-' ? '-' : '+') + value
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

Page({
  data: {
    sessionId: '',
    session: null,
    form: {
      playedDate: '',
      stakeLevel: '',
      heroSeat: '4',
      heroPosition: 'CO',
      opponentType: '',
      villainPosition: '',
      buttonSeat: '2',
      heroCardsInput: '',
      flop: '',
      turn: '',
      river: '',
      effectiveStack: '',
      potSize: '',
      currentProfit: '',
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
      notes: '',
      showdown: ''
    },
    draftAction: {
      street: 'preflop',
      actorSeat: '4',
      actorLabel: 'Hero',
      actionType: 'raise',
      amount: '',
      potAfter: ''
    },
    actions: [],
    positions: ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
    opponentTypes: ['紧弱', '松弱', '激进', '跟注站'],
    blindPresets: ['5/10', '10/20', '25/50'],
    streets: ['preflop', 'flop', 'turn', 'river'],
    actionTypes: ['fold', 'check', 'call', 'bet', 'raise', 'all_in'],
    loading: false,
    advancedOpen: false,
    heroPickerVisible: false,
    heroPickerDeck: [],
    heroCardsVisual: [],
    boardEditorVisual: [],
    boardPickerVisible: false,
    boardPickerKey: 'flop',
    boardPickerTitle: '翻牌',
    boardPickerHint: '',
    boardPickerPreview: [],
    boardPickerDeck: [],
    profitEditorVisible: false,
    profitEditorSign: '+',
    profitEditorDigits: '',
    selectorVisible: false,
    selectorTitle: '',
    selectorKey: '',
    selectorOptions: [],
    sessionBlindDisplay: '',
    sessionMetaText: '',
    resultBbDisplay: '-'
  },
  onLoad(options) {
    this.pendingSessionId = options.sessionId || ''
  },
  async onShow() {
    tabBar.syncCustomTabBar('/pages/hand-record/hand-record')
    await this.initializePage(this.pendingSessionId || '')
    this.pendingSessionId = ''
  },
  async initializePage(sessionId) {
    await dataService.bootstrapCloudSync()
    const settings = dataService.getAppSettings()
    this.setData({ loading: true })
    let targetSessionId = sessionId || ''
    let session = targetSessionId ? await dataService.getSessionById(targetSessionId) : null
    if (!session) {
      const dashboard = await dataService.getDashboardData()
      session = dashboard.activeSession || null
      targetSessionId = session ? session._id : ''
    }
    this.setData({
      sessionId: targetSessionId,
      session,
      positions: settings.positions,
      opponentTypes: settings.opponentTypes,
      blindPresets: settings.blindPresets,
      'form.playedDate': getSessionDate(session),
      'form.stakeLevel': getSessionLevel(session),
      'form.heroPosition': settings.positions[0] || 'CO',
      'form.opponentType': settings.opponentTypes[0] || '',
      'form.villainPosition': settings.positions[settings.positions.length - 1] || 'BB',
      sessionBlindDisplay: session ? [session.smallBlind, session.bigBlind].filter(Boolean).join('/') : '',
      sessionMetaText: session ? [session.date, session.venue].filter(Boolean).join(' · ') : '',
      resultBbDisplay: formatResultBb(this.data.form.currentProfit, getSessionLevel(session), session),
      boardEditorVisual: buildBoardEditorVisual(this.data.form),
      loading: false
    })
    this.syncHeroCardsState(this.data.form.heroCardsInput)
  },
  onInput(e) {
    const key = e.currentTarget.dataset.key
    const value = e.detail.value
    if (key === 'heroCardsInput') {
      this.syncHeroCardsState(value)
      return
    }
    const nextForm = Object.assign({}, this.data.form, { [key]: value })
    const patch = { ['form.' + key]: value }
    if (key === 'currentProfit' || key === 'stakeLevel') {
      patch.resultBbDisplay = formatResultBb(nextForm.currentProfit, nextForm.stakeLevel, this.data.session)
    }
    this.setData(patch)
  },
  onDraftInput(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ ['draftAction.' + key]: e.detail.value })
  },
  pickPosition(e) {
    this.setData({ 'form.heroPosition': this.data.positions[e.detail.value] })
  },
  pickOpponentType(e) {
    this.setData({ 'form.opponentType': this.data.opponentTypes[e.detail.value] })
  },
  openPositionSelector() {
    this.setData({
      selectorVisible: true,
      selectorTitle: '选择位置',
      selectorKey: 'heroPosition',
      selectorOptions: buildSelectorOptions(this.data.positions, this.data.form.heroPosition)
    })
  },
  openOpponentTypeSelector() {
    this.setData({
      selectorVisible: true,
      selectorTitle: '选择对手类型',
      selectorKey: 'opponentType',
      selectorOptions: buildSelectorOptions(this.data.opponentTypes, this.data.form.opponentType)
    })
  },
  openVillainPositionSelector() {
    this.setData({
      selectorVisible: true,
      selectorTitle: '选择对手位置',
      selectorKey: 'villainPosition',
      selectorOptions: buildSelectorOptions(this.data.positions, this.data.form.villainPosition)
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
  pickStreet(e) {
    this.setData({ 'draftAction.street': this.data.streets[e.detail.value] })
  },
  pickActionType(e) {
    this.setData({ 'draftAction.actionType': this.data.actionTypes[e.detail.value] })
  },
  toggleAdvanced() {
    this.setData({ advancedOpen: !this.data.advancedOpen })
  },
  noop() {},
  openHeroPicker() {
    this.syncHeroCardsState(this.data.form.heroCardsInput)
    this.setData({ heroPickerVisible: true })
  },
  closeHeroPicker() {
    this.setData({ heroPickerVisible: false })
  },
  pickHeroCard(e) {
    const token = e.currentTarget.dataset.token
    const disabled = !!e.currentTarget.dataset.disabled
    if (!token || disabled) return
    const selected = parseHeroCardsInput(this.data.form.heroCardsInput)
      .slice(0, 2)
      .map(item => item[0].toUpperCase() + item[1].toLowerCase())

    const existsIndex = selected.indexOf(token)
    let next = []
    if (existsIndex > -1) {
      next = selected.filter(function (item) { return item !== token })
    } else {
      next = selected.concat(token).slice(0, 2)
    }
    this.syncHeroCardsState(next.join(''))
    if (next.length >= 2) {
      this.setData({ heroPickerVisible: false })
    }
  },
  handleHeroPickerTool(e) {
    const action = e.currentTarget.dataset.action
    const selected = parseHeroCardsInput(this.data.form.heroCardsInput)
      .slice(0, 2)
      .map(item => item[0].toUpperCase() + item[1].toLowerCase())
    let next = selected
    if (action === 'backspace') {
      next = selected.slice(0, -1)
    }
    if (action === 'clear') {
      next = []
    }
    this.syncHeroCardsState(next.join(''))
  },
  syncHeroCardsState(value) {
    const normalized = parseHeroCardsInput(value)
      .slice(0, 2)
      .map(function (item) {
        return item[0].toUpperCase() + item[1].toLowerCase()
      })
      .join('')
    const nextForm = Object.assign({}, this.data.form, { heroCardsInput: normalized })
    const patch = {
      'form.heroCardsInput': normalized,
      heroCardsVisual: cardUi.parseHeroCardsInput(normalized),
      heroPickerDeck: buildHeroPickerDeck(nextForm),
      boardEditorVisual: buildBoardEditorVisual(nextForm)
    }
    if (this.data.boardPickerVisible && this.data.boardPickerKey) {
      patch.boardPickerDeck = buildBoardPickerDeck(nextForm, this.data.boardPickerKey)
      patch.boardPickerHint = buildBoardPickerHint(nextForm, this.data.boardPickerKey)
      patch.boardPickerPreview = buildBoardPickerPreview(nextForm, this.data.boardPickerKey)
    }

    this.setData(patch)
  },
  openBoardPicker(e) {
    const key = e.currentTarget.dataset.key
    const meta = BOARD_FIELD_META[key]
    if (!meta) return
    this.setData({
      boardPickerVisible: true,
      boardPickerKey: key,
      boardPickerTitle: meta.label,
      boardPickerHint: buildBoardPickerHint(this.data.form, key),
      boardPickerPreview: buildBoardPickerPreview(this.data.form, key),
      boardPickerDeck: buildBoardPickerDeck(this.data.form, key)
    })
  },
  closeBoardPicker() {
    this.setData({ boardPickerVisible: false })
  },
  openProfitEditor() {
    const parsed = parseProfitEditorValue(this.data.form.currentProfit)
    this.setData({
      profitEditorVisible: true,
      profitEditorSign: parsed.sign,
      profitEditorDigits: parsed.digits
    })
  },
  closeProfitEditor() {
    this.setData({ profitEditorVisible: false })
  },
  pickProfitSign(e) {
    const sign = e.currentTarget.dataset.sign === '-' ? '-' : '+'
    this.setData({ profitEditorSign: sign })
  },
  appendProfitDigit(e) {
    const digit = String(e.currentTarget.dataset.digit || '')
    if (!/^\d+$/.test(digit)) return
    const nextDigits = (this.data.profitEditorDigits || '') + digit
    const normalized = nextDigits.replace(/^0+(?=\d)/, '')
    this.setData({ profitEditorDigits: normalized })
  },
  handleProfitEditorTool(e) {
    const action = e.currentTarget.dataset.action
    const digits = String(this.data.profitEditorDigits || '')
    if (action === 'backspace') {
      this.setData({ profitEditorDigits: digits.slice(0, -1) })
      return
    }
    if (action === 'clear') {
      this.setData({ profitEditorDigits: '' })
    }
  },
  applyProfitEditor() {
    const nextValue = buildProfitEditorValue(this.data.profitEditorSign, this.data.profitEditorDigits)
    this.setData({
      'form.currentProfit': nextValue,
      resultBbDisplay: formatResultBb(nextValue, this.data.form.stakeLevel, this.data.session),
      profitEditorVisible: false
    })
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
      boardEditorVisual: buildBoardEditorVisual(nextForm),
      heroPickerDeck: buildHeroPickerDeck(nextForm)
    }
    if (this.data.boardPickerVisible && this.data.boardPickerKey) {
      patch.boardPickerHint = buildBoardPickerHint(nextForm, this.data.boardPickerKey)
      patch.boardPickerPreview = buildBoardPickerPreview(nextForm, this.data.boardPickerKey)
      patch.boardPickerDeck = buildBoardPickerDeck(nextForm, this.data.boardPickerKey)
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
    let next = []
    if (existsIndex > -1) {
      next = selected.filter(function (item) { return item !== token })
    } else {
      next = selected.concat(token).slice(0, meta.limit)
    }
    this.syncBoardField(key, next.join(''))
    if (next.length >= meta.limit) {
      this.setData({ boardPickerVisible: false })
    }
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
  addAction() {
    const item = Object.assign({}, this.data.draftAction)
    if (!item.actorLabel || !item.amount) {
      wx.showToast({ title: '请先填动作人与金额', icon: 'none' })
      return
    }
    const actions = this.data.actions.concat(item)
    this.setData({
      actions,
      draftAction: {
        street: item.street,
        actorSeat: item.actorSeat,
        actorLabel: '',
        actionType: 'call',
        amount: '',
        potAfter: item.potAfter
      }
    })
  },
  removeAction(e) {
    const index = e.currentTarget.dataset.index
    const actions = this.data.actions.slice()
    actions.splice(index, 1)
    this.setData({ actions })
  },
  async saveHand() {
    if (!this.data.sessionId) {
      wx.showToast({ title: '缺少 Session', icon: 'none' })
      return
    }
    if (!this.data.form.heroCardsInput || this.data.form.currentProfit === '') {
      wx.showToast({ title: '请先填写手牌与输赢', icon: 'none' })
      return
    }
    if (hasDuplicateHeroCards(this.data.form.heroCardsInput)) {
      wx.showToast({ title: '同点数手牌不能重复花色', icon: 'none' })
      return
    }
    const tags = this.data.form.tagsInput ? this.data.form.tagsInput.split(',').map(item => item.trim()).filter(Boolean) : []
    const hand = await dataService.createHand({
      sessionId: this.data.sessionId,
      playedDate: this.data.form.playedDate,
      stakeLevel: this.data.form.stakeLevel,
      heroSeat: this.data.form.heroSeat,
      heroPosition: this.data.form.heroPosition,
      villainPosition: this.data.form.villainPosition,
      villainType: this.data.form.opponentType,
      opponentType: this.data.form.opponentType,
      buttonSeat: this.data.form.buttonSeat,
      heroCardsInput: this.data.form.heroCardsInput,
      flop: this.data.form.flop,
      turn: this.data.form.turn,
      river: this.data.form.river,
      effectiveStack: this.data.form.effectiveStack,
      potSize: this.data.form.potSize,
      currentProfit: this.data.form.currentProfit,
      resultBB: formatResultBb(this.data.form.currentProfit, this.data.form.stakeLevel, this.data.session),
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
      showdown: this.data.form.showdown,
      tags,
      notes: this.data.form.notes,
      mindJourney: this.data.form.notes,
      actions: this.data.actions
    })
    wx.showToast({ title: '手牌已保存', icon: 'success' })
    setTimeout(() => {
      wx.redirectTo({ url: '/pages/hand-detail/hand-detail?id=' + hand._id })
    }, 250)
  },
  goCreateSession() {
    wx.navigateTo({ url: '/pages/session-detail/session-detail?mode=create' })
  },
  goSessionList() {
    wx.switchTab({ url: '/pages/session-list/session-list' })
  }
})
