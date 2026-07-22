const dataService = require('../../services/data-service')
const sessionRules = require('../../utils/session-rules')
const cardUi = require('../../utils/card-ui')
const handDetailFields = require('../../utils/hand-detail-fields')
const reviewTags = require('../../utils/review-tags')
const tabBar = require('../../utils/tab-bar')
const onboardingGuide = require('../../utils/onboarding-guide')

const PENDING_RECORD_SESSION_ID_KEY = 'pokerLivePendingRecordSessionId'
const OPEN_CREATE_SESSION_KEY = 'pokerLiveOpenCreateSession'
const REVIEW_PENDING_FILTER_KEY = 'pokerReviewPendingFilters'
const PENDING_RECORD_SESSION_MAX_AGE_MS = 2 * 60 * 1000
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

function normalizePendingRecordSessionHint(value) {
  if (!value) return null
  if (typeof value === 'string') {
    return {
      sessionId: value,
      allowFinished: false,
      legacy: true
    }
  }
  if (typeof value === 'object') {
    const createdAt = Number(value.createdAt) || 0
    const age = createdAt ? Date.now() - createdAt : Infinity
    return {
      sessionId: String(value.sessionId || ''),
      allowFinished: !!value.allowFinished && age >= 0 && age <= PENDING_RECORD_SESSION_MAX_AGE_MS,
      legacy: false
    }
  }
  return null
}

function pickRecordSession(sessions, sessionId, hint) {
  const list = sessions || []
  const active = list.find(function (item) { return item.status === 'active' })
  if (sessionId) {
    const matched = list.find(function (item) { return item._id === sessionId })
    if (matched) {
      if (matched.status === 'active') return matched
      if (hint && hint.allowFinished) return matched
      if (!active && !(hint && hint.legacy)) return matched
      if (active) return active
    }
  }
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

function shouldShowOnboardingRecordDemo() {
  const step = onboardingGuide.getActiveStep && onboardingGuide.getActiveStep()
  return !!(
    onboardingGuide.shouldAutoShowGuide &&
    onboardingGuide.shouldAutoShowGuide() &&
    step &&
    step.route === 'pages/hand-record/hand-record'
  )
}

function buildOnboardingRecordFormPatch(session) {
  return {
    heroCardsInput: 'QdQs',
    currentProfit: '-140',
    heroPosition: 'CO',
    villainPosition: 'SB',
    opponentType: '紧凶',
    playerCount: '8',
    effectiveStack: '1000',
    potSize: '320',
    tagsInput: 'River 决策,可优化',
    preflopActionLine: 'Hero CO open 5，SB call，BB fold',
    flopActionLine: 'Qd7d3c，SB check，Hero bet 8，SB raise 26，Hero call',
    turnActionLine: '8d，SB check，Hero check back',
    riverActionLine: '2s，SB bet 140，Hero call',
    notes: '新手引导演示：QdQs，结果 -140。先完成手牌和结果即可快速保存。',
    stakeLevel: getSessionLevel(session) || '1/2',
    hasStraddle: !!(session && session.hasStraddle)
  }
}

function buildSessionPatch(session, settings) {
  return {
    sessionId: session ? session._id : '',
    session: session || null,
    'form.playedDate': getSessionDate(session),
    'form.stakeLevel': getSessionLevel(session),
    'form.hasStraddle': !!(session && session.hasStraddle),
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

function buildStreetInputs(form) {
  const isPreflopAllIn = !!form.preflopAllIn
  return {
    preflop: {
      board: '',
      actionLine: form.preflopActionLine,
      pot: form.preflopPot
    },
    flop: {
      board: form.flop,
      actionLine: isPreflopAllIn ? '' : form.flopActionLine,
      pot: isPreflopAllIn ? '' : form.flopPot
    },
    turn: {
      board: form.turn,
      actionLine: isPreflopAllIn ? '' : form.turnActionLine,
      pot: isPreflopAllIn ? '' : form.turnPot
    },
    river: {
      board: form.river,
      actionLine: isPreflopAllIn ? '' : form.riverActionLine,
      pot: isPreflopAllIn ? '' : form.riverPot
    }
  }
}

function filterActionsForAllIn(actions, form) {
  if (!form.preflopAllIn) return actions
  return (actions || []).filter(function (item) {
    const street = String(item && item.street || '').toLowerCase()
    return street === 'preflop' || street === 'pre' || street === ''
  })
}

function getEmptyHandFormPatch(session, settings) {
  return {
    'form.playedDate': getSessionDate(session),
    'form.stakeLevel': getSessionLevel(session),
    'form.playerCount': '',
    'form.hasStraddle': !!(session && session.hasStraddle),
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
    'form.isAllIn': false,
    'form.allInEv': '',
    'form.preflopAllIn': false,
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
    showdownText: '',
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
    agentChatReady: false,
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
      isAllIn: false,
      allInEv: '',
      preflopAllIn: false,
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
    showdownText: '',
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
    resultBbDisplay: '-',
    savingHand: false,
    sessionLoading: false,
    onboardingGuideVisible: false,
    onboardingGuideStep: null
  },
  onLoad(options) {
    this.pendingInputForm = {}
    this.pendingSessionId = options.sessionId || ''
  },
  async onShow() {
    tabBar.syncCustomTabBar('/pages/hand-record/hand-record')
    let storedSessionHint = null
    try {
      storedSessionHint = normalizePendingRecordSessionHint(wx.getStorageSync(PENDING_RECORD_SESSION_ID_KEY))
      if (storedSessionHint && storedSessionHint.sessionId) wx.removeStorageSync(PENDING_RECORD_SESSION_ID_KEY)
    } catch (error) {
      storedSessionHint = null
    }
    const targetSessionId = this.pendingSessionId || (storedSessionHint && storedSessionHint.sessionId) || ''
    await this.initializePage(targetSessionId || '', storedSessionHint)
    this.pendingSessionId = ''
    this.syncOnboardingGuide()
  },
  onReady() {
    setTimeout(() => {
      if (!this.data.agentChatReady) {
        this.setData({ agentChatReady: true })
      }
    }, 240)
  },
  async initializePage(sessionId, sessionHint) {
    this.pendingInputForm = {}
    const loadToken = Date.now() + '_' + Math.random()
    this.sessionLoadToken = loadToken
    const settings = dataService.getAppSettings()
    this.setData({
      pageReady: true,
      sessionLoading: true,
      sessionId: '',
      session: null,
      sessionBlindDisplay: '',
      sessionMetaText: '',
      positions: settings.positions,
      opponentTypes: settings.opponentTypes,
      blindPresets: settings.blindPresets
    })

    const loadSession = async () => {
      const sessionData = await dataService.getSessionListData()
      if (this.sessionLoadToken !== loadToken) return
      const sessions = sessionData.sessions || []
      const session = pickRecordSession(sessions, sessionId, sessionHint)
      const targetSessionId = session ? session._id : ''
      const onboardingPatch = shouldShowOnboardingRecordDemo() ? buildOnboardingRecordFormPatch(session) : {}
      const nextForm = Object.assign({}, this.data.form, onboardingPatch)

      this.setData({
        allSessions: sessions,
        sessionId: targetSessionId,
        session,
        'form.playedDate': getSessionDate(session),
        'form.stakeLevel': nextForm.stakeLevel || getSessionLevel(session),
        'form.hasStraddle': !!(session && session.hasStraddle),
        'form.heroPosition': nextForm.heroPosition || '',
        'form.opponentType': nextForm.opponentType || '',
        'form.villainPosition': nextForm.villainPosition || '',
        'form.heroCardsInput': nextForm.heroCardsInput || '',
        'form.currentProfit': nextForm.currentProfit || '',
        'form.playerCount': nextForm.playerCount || '',
        'form.effectiveStack': nextForm.effectiveStack || '',
        'form.potSize': nextForm.potSize || '',
        'form.tagsInput': nextForm.tagsInput || '',
        'form.preflopActionLine': nextForm.preflopActionLine || '',
        'form.flopActionLine': nextForm.flopActionLine || '',
        'form.turnActionLine': nextForm.turnActionLine || '',
        'form.riverActionLine': nextForm.riverActionLine || '',
        'form.notes': nextForm.notes || '',
        tagOptions: buildTagOptions(nextForm.tagsInput || ''),
        sessionBlindDisplay: session ? [session.smallBlind, session.bigBlind].filter(Boolean).join('/') : '',
        sessionMetaText: session ? [session.date, session.venue].filter(Boolean).join(' · ') : '',
        resultBbDisplay: formatResultBb(nextForm.currentProfit, nextForm.stakeLevel || getSessionLevel(session), session),
        boardEditorVisual: buildBoardEditorVisual(nextForm),
        sessionLoading: false
      })
      this.syncHeroCardsState(nextForm.heroCardsInput)
      this.syncShowdownCardsState(this.data.form.showdown)
    }

    try {
      await loadSession()
    } catch (error) {
      if (this.sessionLoadToken === loadToken) {
        this.setData({ sessionLoading: false })
      }
    }
  },

  syncOnboardingGuide() {
    if (dataService.refreshOnboardingGuideContext) dataService.refreshOnboardingGuideContext()
    const step = onboardingGuide.getStepForRoute('pages/hand-record/hand-record')
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

  onInput(e) {
    const key = e.currentTarget.dataset.key
    const value = e.detail.value
    if (key === 'heroCardsInput') {
      this.syncHeroCardsState(value)
      return
    }
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
  togglePreflopAllIn(e) {
    const checked = !!(e && e.detail && e.detail.value)
    const patch = {
      'form.preflopAllIn': checked
    }
    if (checked) {
      patch['form.isAllIn'] = true
      patch['form.flopActionLine'] = ''
      patch['form.flopPot'] = ''
      patch['form.turnActionLine'] = ''
      patch['form.turnPot'] = ''
      patch['form.riverActionLine'] = ''
      patch['form.riverPot'] = ''
    }
    this.setData(patch)
  },
  toggleAllIn(e) {
    const checked = !!(e && e.detail && e.detail.value)
    const patch = {
      'form.isAllIn': checked,
      'form.allInEv': checked ? this.data.form.allInEv : ''
    }
    if (!checked) patch['form.preflopAllIn'] = false
    this.setData(patch)
  },
  commitPendingInputs(override) {
    const pending = Object.assign({}, this.pendingInputForm || {})
    const forced = override || {}
    const form = Object.assign({}, this.data.form, pending, forced)
    const keys = Object.keys(pending)
    if (keys.length || Object.keys(forced).length) {
      const patch = {}
      keys.forEach(key => {
        patch['form.' + key] = pending[key]
      })
      Object.keys(forced).forEach(key => {
        patch['form.' + key] = forced[key]
      })
      if (keys.indexOf('tagsInput') > -1 || Object.prototype.hasOwnProperty.call(forced, 'tagsInput')) {
        patch.tagOptions = buildTagOptions(form.tagsInput)
      }
      if (
        keys.indexOf('currentProfit') > -1 ||
        keys.indexOf('stakeLevel') > -1 ||
        Object.prototype.hasOwnProperty.call(forced, 'currentProfit') ||
        Object.prototype.hasOwnProperty.call(forced, 'stakeLevel')
      ) {
        patch.resultBbDisplay = formatResultBb(form.currentProfit, form.stakeLevel, this.data.session)
      }
      this.setData(patch)
    }
    this.pendingInputForm = {}
    return form
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
      showdownText: normalized,
      showdownCardsVisual: cardUi.parseOpponentCardsInput(normalized, {
        board: nextForm,
        heroCardsInput: nextForm.heroCardsInput
      }),
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
    if (this.data.savingHand) return
    if (this.data.sessionLoading) {
      wx.showToast({ title: 'Session 加载中', icon: 'none' })
      return
    }
    const override = options || {}
    const form = this.commitPendingInputs(override.currentProfit != null ? {
      currentProfit: override.currentProfit
    } : {})
    if (!this.data.sessionId) {
      wx.showToast({ title: '\u7f3a\u5c11 Session', icon: 'none' })
      return
    }
    if (!form.heroCardsInput || form.currentProfit === '') {
      wx.showToast({ title: '\u8bf7\u5148\u586b\u5199\u624b\u724c\u4e0e\u8f93\u8d62', icon: 'none' })
      return
    }
    const profit = Number(form.currentProfit)
    if (!Number.isFinite(profit)) {
      wx.showToast({ title: '请输入有效的输赢金额', icon: 'none' })
      return
    }
    if (hasDuplicateHeroCards(form.heroCardsInput)) {
      wx.showToast({ title: '\u540c\u70b9\u6570\u624b\u724c\u4e0d\u80fd\u91cd\u590d\u82b1\u8272', icon: 'none' })
      return
    }
    const tags = form.tagsInput ? form.tagsInput.split(',').map(item => item.trim()).filter(Boolean) : []
    const isPreflopAllIn = !!form.preflopAllIn
    const isAllIn = !!(form.isAllIn || isPreflopAllIn)
    const allInPot = isPreflopAllIn ? (form.preflopPot || form.potSize || '') : ''
    this.setData({ savingHand: true })
    try {
      await dataService.createHand({
        sessionId: this.data.sessionId,
        playedDate: form.playedDate,
        stakeLevel: form.stakeLevel,
        playerCount: form.playerCount,
        hasStraddle: !!(form.hasStraddle || (this.data.session && this.data.session.hasStraddle)),
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
        currentProfit: profit,
        isAllIn,
        allInEv: isAllIn ? form.allInEv : '',
        allInStreet: isPreflopAllIn ? 'preflop' : '',
        allInPot,
        resultBB: formatResultBb(form.currentProfit, form.stakeLevel, this.data.session),
        streetSummary: form.streetSummary,
        streetInputs: buildStreetInputs(form),
        opponentCards: form.showdown,
        opponentCardsSource: form.showdown ? 'manual' : '',
        showdown: form.showdown,
        opponentName: form.opponentName,
        heroQuestion: form.heroQuestion,
        tags,
        notes: form.notes,
        mindJourney: form.notes,
        actions: filterActionsForAllIn(this.data.actions, form)
      })
      wx.showToast({ title: '\u624b\u724c\u5df2\u4fdd\u5b58', icon: 'success' })
      wx.setStorageSync(REVIEW_PENDING_FILTER_KEY, {
        sessionStatus: this.data.session && this.data.session.status === 'finished' ? 'finished' : 'active',
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
    } catch (error) {
      wx.showToast({ title: '\u4fdd\u5b58\u5931\u8d25', icon: 'none' })
    } finally {
      this.setData({ savingHand: false })
    }
  },
  goCreateSession() {
    if (this.data.session && this.data.session.status === 'active') {
      wx.showToast({ title: sessionRules.ACTIVE_SESSION_MESSAGE, icon: 'none' })
      return
    }
    wx.setStorageSync(OPEN_CREATE_SESSION_KEY, true)
    wx.switchTab({ url: '/pages/session-list/session-list' })
  },
  goSessionList() {
    wx.switchTab({ url: '/pages/session-list/session-list' })
  }
})
