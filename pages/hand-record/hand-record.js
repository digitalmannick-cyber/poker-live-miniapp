const dataService = require('../../services/data-service')
const sessionRules = require('../../utils/session-rules')
const cardUi = require('../../utils/card-ui')
const handDetailFields = require('../../utils/hand-detail-fields')
const reviewTags = require('../../utils/review-tags')
const tabBar = require('../../utils/tab-bar')

const REVIEW_PENDING_FILTER_KEY = 'pokerReviewPendingFilters'
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

function buildTwoCardPickerDeck(form, targetKey) {
  const activeKey = targetKey || 'heroCardsInput'
  const selected = parseHeroCardsInput(form[activeKey])
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
    .concat(
      parseHeroCardsInput(activeKey === 'heroCardsInput' ? form.showdown : form.heroCardsInput)
        .slice(0, 2)
        .map(function (item) {
          return item[0].toUpperCase() + item[1].toLowerCase()
        })
    )

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

function buildHeroPickerDeck(form) {
  return buildTwoCardPickerDeck(form, 'heroCardsInput')
}

function buildShowdownPickerDeck(form) {
  return buildTwoCardPickerDeck(form, 'showdown')
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

function getSessionUpdatedAt(session) {
  return Number(session && (session.updatedAt || session.createdAt || 0)) || 0
}

function pickRecordSession(sessions, sessionId) {
  const list = sessions || []
  if (sessionId) {
    const matched = list.find(function (item) { return item._id === sessionId })
    if (matched) return matched
  }
  const active = list.find(function (item) { return item.status === 'active' })
  if (active) return active
  const finished = list
    .filter(function (item) { return item.status === 'finished' })
    .sort(function (a, b) { return getSessionUpdatedAt(b) - getSessionUpdatedAt(a) })
  return finished[0] || list[0] || null
}

function buildSessionSelectorOptions(sessions, currentId) {
  return (sessions || []).map(function (item) {
    const level = getSessionLevel(item)
    const status = item.status === 'active' ? '进行中' : '已结束'
    const meta = [item.date, item.venue, level].filter(Boolean).join(' · ')
    return {
      label: (item.title || meta || '未命名场次') + ' · ' + status,
      value: item._id,
      selected: item._id === currentId
    }
  })
}

function buildSessionPatch(session, settings) {
  return {
    sessionId: session ? session._id : '',
    session: session || null,
    'form.playedDate': getSessionDate(session),
    'form.stakeLevel': getSessionLevel(session),
    'form.hasStraddle': false,
    'form.heroPosition': '',
    'form.opponentType': '',
    'form.villainPosition': '',
    sessionBlindDisplay: session ? [session.smallBlind, session.bigBlind].filter(Boolean).join('/') : '',
    sessionMetaText: session ? [session.date, session.venue, session.status === 'active' ? '进行中' : '已结束'].filter(Boolean).join(' · ') : '',
    resultBbDisplay: formatResultBb('', getSessionLevel(session), session)
  }
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

function getEmptyHandFormPatch(session, settings) {
  return {
    'form.playedDate': getSessionDate(session),
    'form.stakeLevel': getSessionLevel(session),
    'form.playerCount': '',
    'form.hasStraddle': false,
    'form.heroSeat': '4',
    'form.heroPosition': '',
    'form.opponentType': '',
    'form.villainPosition': '',
    'form.buttonSeat': '2',
    'form.heroCardsInput': '',
    'form.flop': '',
    'form.turn': '',
    'form.river': '',
    'form.effectiveStack': '',
    'form.potSize': '',
    'form.currentProfit': '',
    'form.streetSummary': '',
    'form.preflopActionLine': '',
    'form.preflopPot': '',
    'form.flopActionLine': '',
    'form.flopPot': '',
    'form.turnActionLine': '',
    'form.turnPot': '',
    'form.riverActionLine': '',
    'form.riverPot': '',
    'form.tagsInput': '',
    'form.notes': '',
    'form.opponentName': '',
    'form.heroQuestion': '',
    'form.showdown': '',
    actions: [],
    heroCardsVisual: [],
    showdownCardsVisual: [],
    boardEditorVisual: buildBoardEditorVisual({
      heroCardsInput: '',
      showdown: '',
      flop: '',
      turn: '',
      river: ''
    }),
    tagOptions: buildTagOptions(''),
    resultBbDisplay: '-'
  }
}

Page({
  data: {
    sessionId: '',
    session: null,
    allSessions: [],
    form: {
      playedDate: '',
      stakeLevel: '',
      playerCount: '',
      hasStraddle: false,
      heroSeat: '4',
      heroPosition: '',
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
      opponentName: '',
      heroQuestion: '',
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
    pageReady: false,
    advancedOpen: false,
    heroPickerVisible: false,
    heroPickerDeck: [],
    heroCardsVisual: [],
    showdownPickerVisible: false,
    showdownPickerDeck: [],
    showdownCardsVisual: [],
    boardEditorVisual: [],
    tagOptions: buildTagOptions(''),
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
    const settings = dataService.getAppSettings()
    const positionOptions = handDetailFields.getPositionOptions(settings.positions, false)
    this.setData({
      pageReady: true,
      positions: settings.positions,
      opponentTypes: settings.opponentTypes,
      blindPresets: settings.blindPresets
    })

    const loadSession = async () => {
      const sessionData = await dataService.getSessionListData()
      const sessions = sessionData.sessions || []
      const session = pickRecordSession(sessions, sessionId)
      const targetSessionId = session ? session._id : ''

      this.setData({
        allSessions: sessions,
        sessionId: targetSessionId,
        session,
        'form.playedDate': getSessionDate(session),
        'form.stakeLevel': getSessionLevel(session),
        'form.hasStraddle': false,
        'form.heroPosition': '',
        'form.opponentType': '',
        'form.villainPosition': '',
        sessionBlindDisplay: session ? [session.smallBlind, session.bigBlind].filter(Boolean).join('/') : '',
        sessionMetaText: session ? [session.date, session.venue].filter(Boolean).join(' · ') : '',
        resultBbDisplay: formatResultBb(this.data.form.currentProfit, getSessionLevel(session), session),
        boardEditorVisual: buildBoardEditorVisual(this.data.form)
      })
      this.syncHeroCardsState(this.data.form.heroCardsInput)
      this.syncShowdownCardsState(this.data.form.showdown)
    }

    loadSession().catch(() => {})
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
    if (key === 'tagsInput') {
      patch.tagOptions = buildTagOptions(value)
    }
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
    const positionOptions = handDetailFields.getPositionOptions(this.data.positions, this.data.form.hasStraddle)
    this.setData({
      selectorVisible: true,
      selectorTitle: '选择位置',
      selectorKey: 'heroPosition',
      selectorOptions: buildSelectorOptions(positionOptions, this.data.form.heroPosition)
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
    const positionOptions = handDetailFields.getPositionOptions(this.data.positions, this.data.form.hasStraddle)
    this.setData({
      selectorVisible: true,
      selectorTitle: '选择对手位置',
      selectorKey: 'villainPosition',
      selectorOptions: buildSelectorOptions(positionOptions, this.data.form.villainPosition)
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
  openSessionSelector() {
    if (!this.data.allSessions.length) {
      wx.showToast({ title: '暂无可选场次', icon: 'none' })
      return
    }
    this.setData({
      selectorVisible: true,
      selectorTitle: '选择目标场次',
      selectorKey: 'sessionId',
      selectorOptions: buildSessionSelectorOptions(this.data.allSessions, this.data.sessionId)
    })
  },
  closeSelector() {
    this.setData({ selectorVisible: false })
  },
  selectPresetOption(e) {
    const key = this.data.selectorKey
    const value = String(e.currentTarget.dataset.value || '')
    if (!key || !value) return
    if (key === 'sessionId') {
      const settings = dataService.getAppSettings()
      const session = (this.data.allSessions || []).find(function (item) { return item._id === value }) || null
      const patch = Object.assign(buildSessionPatch(session, settings), {
        selectorVisible: false,
        resultBbDisplay: formatResultBb(this.data.form.currentProfit, getSessionLevel(session), session)
      })
      this.setData(patch)
      return
    }
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
  toggleStraddle() {
    this.setStraddleValue(!this.data.form.hasStraddle)
  },
  onStraddleCheckboxChange(e) {
    this.setStraddleValue((e.detail.value || []).indexOf('1') > -1)
  },
  setStraddleValue(hasStraddle) {
    const positionOptions = handDetailFields.getPositionOptions(this.data.positions, hasStraddle)
    const patch = {
      'form.hasStraddle': hasStraddle
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
      const parsed = parseProfitEditorValue(this.data.form.currentProfit)
      this.setData({
        heroPickerVisible: false,
        profitEditorVisible: true,
        profitEditorSign: parsed.sign,
        profitEditorDigits: parsed.digits
      })
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
      showdownPickerDeck: buildShowdownPickerDeck(nextForm),
      boardEditorVisual: buildBoardEditorVisual(nextForm)
    }
    if (this.data.boardPickerVisible && this.data.boardPickerKey) {
      patch.boardPickerDeck = buildBoardPickerDeck(nextForm, this.data.boardPickerKey)
      patch.boardPickerHint = buildBoardPickerHint(nextForm, this.data.boardPickerKey)
      patch.boardPickerPreview = buildBoardPickerPreview(nextForm, this.data.boardPickerKey)
    }

    this.setData(patch)
  },
  openShowdownPicker() {
    this.syncShowdownCardsState(this.data.form.showdown)
    this.setData({ showdownPickerVisible: true })
  },
  closeShowdownPicker() {
    this.setData({ showdownPickerVisible: false })
  },
  syncShowdownCardsState(value) {
    const normalized = parseHeroCardsInput(value)
      .slice(0, 2)
      .map(function (item) {
        return item[0].toUpperCase() + item[1].toLowerCase()
      })
      .join('')
    const nextForm = Object.assign({}, this.data.form, { showdown: normalized })
    const patch = {
      'form.showdown': normalized,
      showdownCardsVisual: cardUi.parseHeroCardsInput(normalized),
      showdownPickerDeck: buildShowdownPickerDeck(nextForm),
      heroPickerDeck: buildHeroPickerDeck(nextForm)
    }
    if (this.data.boardPickerVisible && this.data.boardPickerKey) {
      patch.boardPickerDeck = buildBoardPickerDeck(nextForm, this.data.boardPickerKey)
      patch.boardPickerHint = buildBoardPickerHint(nextForm, this.data.boardPickerKey)
      patch.boardPickerPreview = buildBoardPickerPreview(nextForm, this.data.boardPickerKey)
    }
    this.setData(patch)
  },
  pickShowdownCard(e) {
    const token = e.currentTarget.dataset.token
    const disabled = !!e.currentTarget.dataset.disabled
    if (!token || disabled) return
    const selected = parseHeroCardsInput(this.data.form.showdown)
      .slice(0, 2)
      .map(item => item[0].toUpperCase() + item[1].toLowerCase())
    const existsIndex = selected.indexOf(token)
    const next = existsIndex > -1
      ? selected.filter(function (item) { return item !== token })
      : selected.concat(token).slice(0, 2)
    this.syncShowdownCardsState(next.join(''))
    if (next.length >= 2) {
      this.setData({ showdownPickerVisible: false })
    }
  },
  handleShowdownPickerTool(e) {
    const action = e.currentTarget.dataset.action
    const selected = parseHeroCardsInput(this.data.form.showdown)
      .slice(0, 2)
      .map(item => item[0].toUpperCase() + item[1].toLowerCase())
    let next = selected
    if (action === 'backspace') {
      next = selected.slice(0, -1)
    }
    if (action === 'clear') {
      next = []
    }
    this.syncShowdownCardsState(next.join(''))
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
  openMoreInfoFromProfit() {
    const nextValue = buildProfitEditorValue(this.data.profitEditorSign, this.data.profitEditorDigits)
    this.setData({
      'form.currentProfit': nextValue,
      resultBbDisplay: formatResultBb(nextValue, this.data.form.stakeLevel, this.data.session),
      profitEditorVisible: false,
      advancedOpen: true
    })
  },
  quickSaveFromProfit() {
    const nextValue = buildProfitEditorValue(this.data.profitEditorSign, this.data.profitEditorDigits)
    this.setData({
      'form.currentProfit': nextValue,
      resultBbDisplay: formatResultBb(nextValue, this.data.form.stakeLevel, this.data.session),
      profitEditorVisible: false
    })
    this.saveHand({ currentProfit: nextValue })
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
      heroPickerDeck: buildHeroPickerDeck(nextForm),
      showdownPickerDeck: buildShowdownPickerDeck(nextForm)
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
  async saveHand(options) {
    const override = options || {}
    const form = Object.assign({}, this.data.form, override.currentProfit != null ? {
      currentProfit: override.currentProfit
    } : {})
    if (!this.data.sessionId) {
      wx.showToast({ title: '缺少 Session', icon: 'none' })
      return
    }
    if (!form.heroCardsInput || form.currentProfit === '') {
      wx.showToast({ title: '请先填写手牌与输赢', icon: 'none' })
      return
    }
    if (hasDuplicateHeroCards(form.heroCardsInput)) {
      wx.showToast({ title: '同点数手牌不能重复花色', icon: 'none' })
      return
    }
    const tags = form.tagsInput ? form.tagsInput.split(',').map(item => item.trim()).filter(Boolean) : []
    await dataService.createHand({
      sessionId: this.data.sessionId,
      playedDate: form.playedDate,
      stakeLevel: form.stakeLevel,
      playerCount: form.playerCount,
      hasStraddle: form.hasStraddle,
      heroSeat: form.heroSeat,
      heroPosition: form.heroPosition,
      villainPosition: form.villainPosition,
      villainType: form.opponentType,
      opponentType: form.opponentType,
      buttonSeat: form.buttonSeat,
      heroCardsInput: form.heroCardsInput,
      flop: form.flop,
      turn: form.turn,
      river: form.river,
      effectiveStack: form.effectiveStack,
      potSize: form.potSize,
      currentProfit: form.currentProfit,
      resultBB: formatResultBb(form.currentProfit, form.stakeLevel, this.data.session),
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
      showdown: form.showdown,
      opponentName: form.opponentName,
      heroQuestion: form.heroQuestion,
      tags,
      notes: form.notes,
      mindJourney: form.notes,
      actions: this.data.actions
    })
    wx.showToast({ title: '手牌已保存', icon: 'success' })
    wx.setStorageSync(REVIEW_PENDING_FILTER_KEY, {
      sessionStatus: 'active',
      dateRange: 'all',
      resultFilter: 'all',
      sortBy: 'dateDesc'
    })
    const settings = dataService.getAppSettings()
    this.setData(getEmptyHandFormPatch(this.data.session, settings))
    this.syncHeroCardsState('')
    setTimeout(function () {
      wx.switchTab({ url: '/pages/review-list/review-list' })
    }, 450)
  },
  goCreateSession() {
    if (this.data.session && this.data.session.status === 'active') {
      wx.showToast({ title: sessionRules.ACTIVE_SESSION_MESSAGE, icon: 'none' })
      return
    }
    wx.navigateTo({ url: '/pages/session-detail/session-detail?mode=create' })
  },
  goSessionList() {
    wx.switchTab({ url: '/pages/session-list/session-list' })
  }
})
