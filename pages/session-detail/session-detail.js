const dataService = require('../../services/data-service')
const display = require('../../utils/display')
const cardUi = require('../../utils/card-ui')
const sessionDuration = require('../../utils/session-duration')
const sessionRules = require('../../utils/session-rules')
const onboardingGuide = require('../../utils/onboarding-guide')
const sessionStack = require('../../utils/session-stack')
const handEntryType = require('../../utils/hand-entry-type')

const PENDING_RECORD_SESSION_ID_KEY = 'pokerLivePendingRecordSessionId'
const OPEN_AI_REMINDER_EDITOR_KEY = 'pokerLiveOpenAiReminderEditor'
const TIMELINE_SWIPE_OPEN_DISTANCE = 72
const TIMELINE_SWIPE_CLOSE_DISTANCE = 48
const HISTORY_DRAFT_ID = 'history_session_draft'
const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']
const SUITS = [
  { key: 's', symbol: '♠', className: 'spade' },
  { key: 'h', symbol: '♥', className: 'heart' },
  { key: 'd', symbol: '♦', className: 'diamond' },
  { key: 'c', symbol: '♣', className: 'club' }
]
const POSITION_OPTIONS_BY_TABLE = {
  6: ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  8: ['UTG', 'UTG+1', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  9: ['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']
}
const SESSION_ICON_ASSETS = {
  buyin: '/assets/session-icons/p5-buyin-v251.png',
  buyin_add: '/assets/session-icons/p5-buyin-v251.png',
  cashout: '/assets/session-icons/p5-buyin-v251.png',
  comment: '/assets/session-icons/p5-comment-v251.png',
  quick: '/assets/session-icons/p5-quick-v251.png',
  full: '/assets/session-icons/p5-full-v251.png'
}
let timelineSequenceNonce = 0

function padNumber(value) {
  return String(value).padStart(2, '0')
}

function formatDatePart(date) {
  return [
    date.getFullYear(),
    padNumber(date.getMonth() + 1),
    padNumber(date.getDate())
  ].join('-')
}

function formatTimePart(date) {
  return padNumber(date.getHours()) + ':' + padNumber(date.getMinutes())
}

function getNowParts() {
  const now = new Date()
  return {
    date: formatDatePart(now),
    time: formatTimePart(now)
  }
}

function decodeDateTimeText(value) {
  let text = String(value || '').trim()
  for (let index = 0; index < 2 && /%[0-9a-f]{2}/i.test(text); index += 1) {
    try {
      text = decodeURIComponent(text)
    } catch (error) {
      break
    }
  }
  return text
}

function splitDateTime(value) {
  const text = decodeDateTimeText(value)
  if (/^\d{12,}$/.test(text)) {
    const date = new Date(Number(text))
    if (!Number.isNaN(date.getTime())) {
      return {
        date: formatDatePart(date),
        time: formatTimePart(date)
      }
    }
  }
  const parts = text.split(/\s+/)
  return {
    date: parts[0] || '',
    time: parts[1] || ''
  }
}

function combineDateTime(datePart, timePart) {
  const date = String(datePart || '').trim()
  const time = String(timePart || '').trim()
  if (!date) return ''
  if (!time) return date
  return date + ' ' + time
}

function hasTimePart(value) {
  return /\d{1,2}:\d{2}/.test(String(value || ''))
}

function parseDateTimeValue(value) {
  const text = decodeDateTimeText(value)
  if (!text) return null
  const normalized = text.replace(' ', 'T')
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

function shiftDateTime(value, minutes) {
  const date = parseDateTimeValue(value)
  if (!date) return value
  const next = new Date(date.getTime() + (Number(minutes) || 0) * 60000)
  return combineDateTime(formatDatePart(next), formatTimePart(next))
}

function diffMinutes(startValue, endValue) {
  const start = parseDateTimeValue(startValue)
  const end = parseDateTimeValue(endValue)
  if (!start || !end) return 0
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000))
}

function calculateSessionProfit(buyIn, cashOut) {
  if (String(cashOut || '').trim() === '') return null
  const buy = Number(buyIn)
  const cash = Number(cashOut)
  if (!Number.isFinite(buy) || !Number.isFinite(cash)) return null
  return cash - buy
}

function formatSessionProfit(value) {
  const amount = Number(value) || 0
  const sign = amount > 0 ? '+' : amount < 0 ? '-' : ''
  const abs = Math.abs(amount)
  return sign + abs
}

function getDisplaySessionProfit(session) {
  if (!session || session.status !== 'finished') return null
  return Number(session.totalProfit) || 0
}

function buildSessionProfitView(session) {
  const profit = getDisplaySessionProfit(session)
  if (profit == null) {
    return {
      totalProfitDisplay: '未结算',
      totalProfitTone: 'empty'
    }
  }
  return {
    totalProfitDisplay: formatSessionProfit(profit),
    totalProfitTone: profit >= 0 ? 'positive' : 'negative'
  }
}

function buildProfitDisplay(buyIn, cashOut) {
  const profit = calculateSessionProfit(buyIn, cashOut)
  return profit == null ? '' : formatSessionProfit(profit)
}

function getProfitTone(buyIn, cashOut) {
  const profit = calculateSessionProfit(buyIn, cashOut)
  if (profit == null) return 'empty'
  return profit >= 0 ? 'positive' : 'negative'
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

function getDefaultTimelineEventTime(session, form) {
  const currentSession = session || {}
  const currentForm = form || {}
  const isFinished = currentSession.status === 'finished'
  if (isFinished) {
    const startValue = combineDateTime(
      currentForm.startDate || splitDateTime(currentSession.startTime || currentSession.date).date,
      currentForm.startTime || splitDateTime(currentSession.startTime || '').time
    ) || currentSession.startTime || currentSession.date || ''
    const endValue = combineDateTime(
      currentForm.endDate || splitDateTime(currentSession.endTime || '').date,
      currentForm.endTime || splitDateTime(currentSession.endTime || '').time
    ) || currentSession.endTime || ''
    const minutes = diffMinutes(startValue, endValue)
    if (startValue) return minutes > 0 ? shiftDateTime(startValue, Math.floor(minutes / 2)) : startValue
  }
  const now = getNowParts()
  return combineDateTime(now.date, now.time)
}

function buildPresetList(list, currentValue) {
  const values = []
  const addValue = function (value) {
    const text = String(value || '').trim()
    if (text && values.indexOf(text) === -1) values.push(text)
  }
  addValue(currentValue)
  ;(list || []).forEach(addValue)
  return values
}

function buildForm(session, settings) {
  const venues = settings && settings.venues ? settings.venues : []
  const blindPresets = settings && settings.blindPresets ? settings.blindPresets : []
  const firstVenue = venues[0] || ''
  const defaultBlindPreset = (settings && settings.lastBlindPreset) || blindPresets[0] || '5/10'
  const blindParts = String(defaultBlindPreset).split('/')
  const defaultBigBlind = Number(blindParts[1]) || 10
  const now = getNowParts()
  if (!session) {
    return {
      startDate: now.date,
      startTime: now.time,
      endDate: '',
      endTime: '',
      venue: firstVenue,
      blindPreset: defaultBlindPreset,
      smallBlind: blindParts[0] || '5',
      bigBlind: blindParts[1] || '10',
      hasStraddle: false,
      tableSize: '8',
      buyIn: String(defaultBigBlind * 100),
      cashOut: '',
      breakMinutes: '',
      notes: ''
    }
  }
  const start = splitDateTime(session.startTime || session.date || '')
  const end = splitDateTime(session.endTime || '')
  return {
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    venue: session.venue,
    blindPreset: String(session.smallBlind || '') + '/' + String(session.bigBlind || ''),
    smallBlind: String(session.smallBlind || ''),
    bigBlind: String(session.bigBlind || ''),
    hasStraddle: !!session.hasStraddle,
    tableSize: String(session.tableSize || 8),
    buyIn: String(session.buyIn || ''),
    cashOut: String(session.cashOut || session.endingChips || ''),
    breakMinutes: String(session.breakMinutes || session.breakTimeMinutes || ''),
    notes: session.notes || ''
  }
}

function formatAmountNoSign(value, unit) {
  const amount = Math.max(0, Number(value) || 0)
  if (unit === 'CNY') return '¥' + amount
  if (unit === 'HKD') return 'HK$' + amount
  if (unit === 'USD') return '$' + amount
  return amount + ' BB'
}

function getEventSortMs(value) {
  const parsed = parseDateTimeValue(value)
  if (parsed) return parsed.getTime()
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function nextTimelineSequence() {
  timelineSequenceNonce += 1
  return Date.now() * 1000 + timelineSequenceNonce
}

function getSessionLevel(session) {
  return [session && session.smallBlind, session && session.bigBlind].filter(Boolean).join('/')
}

function getDateGroupKey(value) {
  const parsed = parseDateTimeValue(value) || new Date(Number(value) || Date.now())
  return formatDatePart(parsed)
}

function formatEventTime(value) {
  const parsed = parseDateTimeValue(value) || new Date(Number(value) || Date.now())
  return padNumber(parsed.getHours()) + ':' + padNumber(parsed.getMinutes())
}

function formatChineseDate(value) {
  const parsed = parseDateTimeValue(value) || new Date(Number(value) || Date.now())
  const weekdays = ['日', '一', '二', '三', '四', '五', '六']
  return parsed.getFullYear() + '年' + (parsed.getMonth() + 1) + '月' + parsed.getDate() + '日 周' + weekdays[parsed.getDay()]
}

function buildFinishedHero(session, settings) {
  if (!session) return null
  const unit = settings && settings.chipUnit || ''
  const buyIn = Number(session.buyIn) || 0
  const cashOut = Number(session.cashOut || session.endingChips) || 0
  const profit = session.status === 'finished'
    ? (Number(session.totalProfit) || cashOut - buyIn)
    : Number(session.currentProfit) || 0
  const duration = sessionDuration.buildDurationView(session)
  const hours = Math.max(0, diffMinutes(session.startTime || session.date, session.endTime || '') / 60)
  const hourly = hours > 0 ? profit / hours : 0
  const bigBlind = Number(session.bigBlind) || 0
  const bbHourly = hours > 0 && bigBlind > 0 ? hourly / bigBlind : 0
  return {
    title: [session.smallBlind, session.bigBlind].filter(Boolean).join('/') + ' @ ' + (session.venue || '--'),
    profitDisplay: display.formatAmount(profit, unit),
    profitTone: profit >= 0 ? 'positive' : 'negative',
    buyInDisplay: formatAmountNoSign(buyIn, unit),
    cashOutDisplay: cashOut ? formatAmountNoSign(cashOut, unit) : '--',
    durationDisplay: duration.display || '--',
    gameDisplay: 'Cash ' + (session.gameType || 'NLHE'),
    hourlyDisplay: display.formatAmount(Math.round(hourly), unit) + '/h',
    hourlyTone: hourly >= 0 ? 'positive' : 'negative',
    bbHourlyDisplay: bbHourly ? bbHourly.toFixed(1) + ' bb/h' : '--',
    bbHourlyTone: bbHourly >= 0 ? 'positive' : 'negative'
  }
}

function getTimelineSequence(value, fallback) {
  const matches = String(value || '').match(/\d+/g)
  if (!matches || !matches.length) return Number(fallback) || 0
  return Number(matches[matches.length - 1]) || Number(fallback) || 0
}

function getHandTimelineTime(hand, fallback) {
  if (!hand) return fallback || ''
  const exactCandidates = [
    hand.recordedAt,
    hand.playedAt,
    hand.createdAtMs,
    hand.createdAt,
    hand.updatedAtMs,
    hand.updatedAt
  ]
  for (let index = 0; index < exactCandidates.length; index += 1) {
    const value = exactCandidates[index]
    if (value !== undefined && value !== null && String(value).trim() !== '') return value
  }
  if (hasTimePart(hand.playedDate)) return hand.playedDate
  return hand.playedDate || fallback || ''
}

function buildSessionTimeline(session, hands, settings) {
  if (!session) return []
  const unit = settings && settings.chipUnit || ''
  const initialTime = session.startTime || session.date || ''
  const events = [{
    id: 'session-buyin',
    sourceId: session._id,
    type: 'buyin',
    iconAsset: SESSION_ICON_ASSETS.buyin,
    icon: '¥',
    tone: 'buyin',
    title: '买入',
    eventTime: initialTime,
    dateKey: getDateGroupKey(initialTime),
    dateLabel: formatChineseDate(initialTime),
    timeDisplay: formatEventTime(initialTime),
    sortMs: getEventSortMs(initialTime),
    sequence: 0,
    amount: Number(session.buyIn) || 0,
    amountDisplay: display.formatAmount(Number(session.buyIn) || 0, unit)
  }]
  ;(hands || []).forEach((hand, index) => {
    const eventTime = getHandTimelineTime(hand, initialTime)
    const amount = Number(hand.currentProfit) || 0
    const fullEntry = handEntryType.isFullEntryHand(hand)
    events.push({
      id: hand._id || hand.id || 'hand-' + index,
      sourceId: hand._id || hand.id || '',
      type: fullEntry ? 'full' : 'quick',
      iconAsset: fullEntry ? SESSION_ICON_ASSETS.full : SESSION_ICON_ASSETS.quick,
      icon: '⚡',
      tone: 'quick',
      hot: true,
      title: hand.heroPosition || '',
      notes: hand.notes || hand.mindJourney || '',
      heroCardsInput: hand.heroCardsInput || '',
      heroPosition: hand.heroPosition || '',
      currentProfit: amount,
      heroCardsVisual: cardUi.parseHeroCardsInput(hand.heroCardsInput),
      eventTime,
      dateKey: getDateGroupKey(eventTime),
      dateLabel: formatChineseDate(eventTime),
      timeDisplay: formatEventTime(eventTime),
      sortMs: getEventSortMs(eventTime),
      sequence: getTimelineSequence(hand.sequence || hand.createdAtMs || hand._id || hand.id, index + 1),
      amountDisplay: display.formatAmount(amount, unit),
      amountTone: amount >= 0 ? 'positive' : 'negative'
    })
  })
  ;(session.timelineEvents || []).forEach((event, index) => {
    if (event && event.type === 'stack') return
    const type = event.type || 'comment'
    const eventTime = event.createdAt || initialTime
    const amount = Number(event.amount)
    events.push({
      id: event.id || 'event-' + index,
      sourceId: event.id || '',
      type,
      iconAsset: SESSION_ICON_ASSETS[type] || SESSION_ICON_ASSETS.comment,
      icon: type === 'buyin_add' ? '¥' : 'C',
      tone: type === 'buyin_add' ? 'buyin' : 'comment',
      title: [event.title || '备注', event.text || event.sub || ''].filter(Boolean).join(' '),
      text: event.text || '',
      eventTime,
      dateKey: getDateGroupKey(eventTime),
      dateLabel: formatChineseDate(eventTime),
      timeDisplay: formatEventTime(eventTime),
      sortMs: getEventSortMs(event.createdAtMs || eventTime),
      sequence: getTimelineSequence(event.sequence || event.createdAtMs || event.id || event.createdAt, index + 1),
      amount: Number.isFinite(amount) ? amount : '',
      amountDisplay: Number.isFinite(amount) && amount !== 0 ? display.formatAmount(amount, unit) : '',
      amountTone: amount >= 0 ? 'positive' : 'negative'
    })
  })
  if (session.status === 'finished' && String(session.cashOut || session.endingChips || '').trim() !== '') {
    const cashOutTime = session.endTime || session.updatedAt || initialTime
    events.push({
      id: 'session-cashout',
      sourceId: session._id,
      type: 'cashout',
      iconAsset: SESSION_ICON_ASSETS.cashout,
      icon: '¥',
      tone: 'cashout',
      title: '结算',
      eventTime: cashOutTime,
      dateKey: getDateGroupKey(cashOutTime),
      dateLabel: formatChineseDate(cashOutTime),
      timeDisplay: formatEventTime(cashOutTime),
      sortMs: getEventSortMs(cashOutTime),
      sequence: 999999999,
      amount: Number(session.cashOut || session.endingChips) || 0,
      amountDisplay: display.formatAmount(Number(session.cashOut || session.endingChips) || 0, unit)
    })
  }
  return events.sort((a, b) => {
    if (b.sortMs !== a.sortMs) return b.sortMs - a.sortMs
    return (Number(b.sequence) || 0) - (Number(a.sequence) || 0)
  }).map((event, index, list) => Object.assign({}, event, {
    swiped: false,
    last: index === list.length - 1
  }))
}

function buildTimelineGroups(events) {
  const groups = []
  ;(events || []).forEach(event => {
    let group = groups.find(item => item.key === event.dateKey)
    if (!group) {
      group = { key: event.dateKey, label: event.dateLabel, events: [] }
      groups.push(group)
    }
    group.events.push(event)
  })
  return groups.map(group => Object.assign({}, group, {
    events: group.events.map((event, index) => Object.assign({}, event, {
      last: index === group.events.length - 1
    }))
  }))
}

function buildTimelineEditor(event) {
  const parts = splitDateTime(event && event.eventTime || '')
  const heroCardsInput = event && event.heroCardsInput || ''
  return {
    id: event && event.id || '',
    type: event && event.type || '',
    date: parts.date,
    time: parts.time,
    amount: event && (event.amount !== '' && event.amount != null ? String(event.amount) : ''),
    text: event && (event.text || event.title || ''),
    heroCardsInput,
    heroCardsVisual: cardUi.parseHeroCardsInput(heroCardsInput),
    heroPosition: event && event.heroPosition || '',
    currentProfit: event && event.currentProfit != null ? String(event.currentProfit) : '',
    notes: event && event.notes || '',
    isNew: !!(event && event.isNew)
  }
}

function buildHeroPickerDeck(value) {
  const selected = cardUi.parseHeroCardsInput(value)
    .slice(0, 2)
    .map(card => card.rank + card.suit)
  return SUITS.map(suit => ({
    key: suit.key,
    cards: RANKS.map(rank => {
      const token = rank + suit.key
      return {
        token,
        rank,
        suitSymbol: suit.symbol,
        suitClass: suit.className,
        selected: selected.indexOf(token) > -1
      }
    })
  }))
}

function getPositionOptionsForTable(tableSize) {
  const size = Number(tableSize) || 8
  return POSITION_OPTIONS_BY_TABLE[size] || POSITION_OPTIONS_BY_TABLE[8]
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
    sign,
    digits
  }
}

function buildProfitEditorValue(sign, digits) {
  const value = String(digits || '').replace(/\D/g, '')
  if (!value) return ''
  return (sign === '-' ? '-' : '+') + value
}

function shouldShowOnboardingCreateDemo() {
  const step = onboardingGuide.getActiveStep && onboardingGuide.getActiveStep()
  return !!(
    onboardingGuide.shouldAutoShowGuide &&
    onboardingGuide.shouldAutoShowGuide() &&
    step &&
    step.route === 'pages/session-detail/session-detail'
  )
}

function buildOnboardingCreateForm(form) {
  return Object.assign({}, form, {
    venue: '澳门',
    blindPreset: '300/600',
    smallBlind: '300',
    bigBlind: '600',
    hasStraddle: false,
    tableSize: '8',
    buyIn: '300000',
    cashOut: '',
    notes: '新手引导演示：澳门 300/600，买入 300000'
  })
}

function buildHistoryDraftSession(form, previous) {
  const current = previous || {}
  const now = getNowParts()
  const startDate = form.startDate || current.date || now.date
  const startTime = form.startTime || splitDateTime(current.startTime || '').time || now.time
  const endDate = form.endDate || splitDateTime(current.endTime || '').date || startDate
  const endTime = form.endTime || splitDateTime(current.endTime || '').time || startTime
  const buyIn = Number(form.buyIn || current.buyIn) || 0
  const cashOut = String(form.cashOut || current.cashOut || current.endingChips || '').trim()
  return Object.assign({}, current, {
    _id: HISTORY_DRAFT_ID,
    title: [form.blindPreset || [form.smallBlind, form.bigBlind].filter(Boolean).join('/'), form.venue].filter(Boolean).join(' @ '),
    status: 'finished',
    venue: form.venue || current.venue || '',
    smallBlind: Number(form.smallBlind) || 0,
    bigBlind: Number(form.bigBlind) || 0,
    gameType: form.gameType || current.gameType || 'NLHE',
    tableSize: Number(form.tableSize) || 8,
    hasStraddle: !!form.hasStraddle,
    buyIn,
    cashOut,
    endingChips: cashOut,
    totalProfit: calculateSessionProfit(buyIn, cashOut) || 0,
    date: startDate,
    startTime: combineDateTime(startDate, startTime),
    endTime: combineDateTime(endDate, endTime),
    breakMinutes: form.breakMinutes || current.breakMinutes || '',
    notes: form.notes || current.notes || '',
    timelineEvents: current.timelineEvents || [],
    handCount: current.handCount || 0,
    timerPausedAt: ''
  })
}

function buildSessionActionState(mode, session, editMode) {
  if (mode === 'create') {
    return {
      sessionSaveLabel: '开始牌局',
      showSessionSaveButton: true,
      showSupplementHandButton: false,
      showFinishButton: false,
      sessionActionGrid: false
    }
  }
  if (!session) {
    return {
      sessionSaveLabel: '',
      showSessionSaveButton: false,
      showSupplementHandButton: false,
      showFinishButton: false,
      sessionActionGrid: false
    }
  }
  if (session.status === 'active') {
    return {
      sessionSaveLabel: '更新牌局信息',
      showSessionSaveButton: true,
      showSupplementHandButton: false,
      showFinishButton: true,
      sessionActionGrid: true
    }
  }
  if (editMode) {
    return {
      sessionSaveLabel: '',
      showSessionSaveButton: false,
      showSupplementHandButton: false,
      showFinishButton: false,
      sessionActionGrid: false
    }
  }
  return {
    sessionSaveLabel: '',
    showSessionSaveButton: false,
    showSupplementHandButton: true,
    showFinishButton: false,
    sessionActionGrid: false
  }
}

Page({
  data: {
    mode: 'detail',
    editMode: false,
    sessionId: '',
    session: null,
    hands: [],
    form: buildForm(),
    settings: {
      venues: [],
      blindPresets: []
    },
    venueOptions: [],
    blindPresetOptions: [],
    selectorVisible: false,
    selectorTitle: '',
    selectorKey: '',
    selectorOptions: [],
    loading: false,
    profitPreviewDisplay: '0',
    profitPreviewTone: 'positive',
    durationDisplay: '--:--',
    durationLabel: 'SESSION TIME',
    sessionSaveLabel: '',
    showSessionSaveButton: false,
    showSupplementHandButton: false,
    showFinishButton: false,
    sessionActionGrid: false,
    onboardingGuideVisible: false,
    onboardingGuideStep: null,
    detailViewVisible: false,
    sessionEditVisible: false,
    sessionDetailHero: null,
    sessionTimeline: [],
    sessionTimelineGroups: [],
    historyDraftHands: [],
    historySessionSaving: false,
    sessionMoreVisible: false,
    swipedTimelineEventId: '',
    timelineTouchStartX: 0,
    timelineTouchStartY: 0,
    timelineTouchMoved: false,
    timelineEditorVisible: false,
    timelineEditor: buildTimelineEditor(),
    timelinePositionOptions: getPositionOptionsForTable(8),
    timelineHeroPickerVisible: false,
    timelineHeroPickerDeck: buildHeroPickerDeck(''),
    timelineProfitEditorVisible: false,
    timelineProfitEditorSign: '+',
    timelineProfitEditorDigits: ''
  },
  onLoad(options) {
    const mode = options.mode || 'detail'
    const sessionId = options.id || ''
    const editMode = options.edit === '1'
    this.setData({ mode, sessionId, editMode })
    this.refresh()
  },
  onShow() {
    this.refresh()
    this.syncOnboardingGuide()
  },
  guardCreateMode() {
    if (this.createGuardPromise) return this.createGuardPromise
    this.createGuardPromise = dataService.getSessionListData().then(data => {
      const activeSession = sessionRules.findActiveSession(data.sessions)
      if (!activeSession) return true
      wx.showToast({ title: sessionRules.ACTIVE_SESSION_MESSAGE, icon: 'none' })
      setTimeout(() => {
        wx.navigateBack({
          delta: 1,
          fail() {
            wx.switchTab({ url: '/pages/session-list/session-list' })
          }
        })
      }, 80)
      return false
    })
    return this.createGuardPromise
  },
  onHide() {
    this.stopDurationClock()
  },
  onUnload() {
    this.stopDurationClock()
  },
  syncOnboardingGuide() {
    if (dataService.refreshOnboardingGuideContext) dataService.refreshOnboardingGuideContext()
    const step = onboardingGuide.getStepForRoute('pages/session-detail/session-detail')
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
    const settings = dataService.getAppSettings()
    const chipUnit = settings.chipUnit
    const currentForm = this.data.form || {}
    const venueOptions = buildPresetList(settings.venues, currentForm.venue)
    const blindPresetOptions = buildPresetList(settings.blindPresets, currentForm.blindPreset || settings.lastBlindPreset)
    if (this.data.mode === 'history') {
      this.stopDurationClock()
      const baseForm = buildForm(null, settings)
      const defaultEndParts = splitDateTime(shiftDateTime(
        combineDateTime(baseForm.startDate, baseForm.startTime),
        60
      ))
      const form = Object.assign({}, baseForm, {
        endDate: defaultEndParts.date || baseForm.startDate,
        endTime: defaultEndParts.time || baseForm.startTime,
        cashOut: baseForm.buyIn
      })
      const session = buildHistoryDraftSession(form, {
        timelineEvents: [],
        handCount: 0
      })
      const timeline = buildSessionTimeline(session, [], settings)
      this.setData(Object.assign({
        session,
        hands: [],
        historyDraftHands: [],
        settings,
        venueOptions,
        blindPresetOptions,
        form,
        profitPreviewDisplay: buildProfitDisplay(form.buyIn, form.cashOut),
        profitPreviewTone: getProfitTone(form.buyIn, form.cashOut),
        loading: false,
        editMode: true,
        detailViewVisible: false,
        sessionEditVisible: true,
        sessionDetailHero: buildFinishedHero(session, settings),
        sessionTimeline: timeline,
        sessionTimelineGroups: buildTimelineGroups(timeline)
      }, buildSessionActionState(this.data.mode, session, true)))
      this.syncOnboardingGuide()
      return
    }
    if (this.data.mode === 'create') {
      const createAllowed = await this.guardCreateMode()
      if (!createAllowed) {
        this.setData({ loading: false })
        return
      }
      this.stopDurationClock()
      const form = shouldShowOnboardingCreateDemo()
        ? buildOnboardingCreateForm(buildForm(null, settings))
        : buildForm(null, settings)
      this.setData(Object.assign({
        session: null,
        hands: [],
        settings,
        venueOptions,
        blindPresetOptions,
        form: form,
        profitPreviewDisplay: buildProfitDisplay(form.buyIn, form.cashOut),
        profitPreviewTone: getProfitTone(form.buyIn, form.cashOut),
        detailViewVisible: false,
        sessionEditVisible: false,
        sessionDetailHero: null,
        sessionTimeline: [],
        sessionTimelineGroups: []
      }, buildSessionActionState(this.data.mode, null, this.data.editMode)))
      this.syncOnboardingGuide()
      return
    }
    this.setData({ loading: true })
    const detail = await dataService.getSessionDetailData(this.data.sessionId)
    if (detail.session && detail.session.venue && venueOptions.indexOf(detail.session.venue) === -1) {
      venueOptions.unshift(detail.session.venue)
    }
    const currentBlindPreset = detail.session
      ? String(detail.session.smallBlind || '') + '/' + String(detail.session.bigBlind || '')
      : ''
    if (currentBlindPreset && blindPresetOptions.indexOf(currentBlindPreset) === -1) {
      blindPresetOptions.unshift(currentBlindPreset)
    }
    const form = buildForm(detail.session, settings)
    this.setData(Object.assign({
      session: detail.session
        ? Object.assign({}, detail.session, buildSessionProfitView(detail.session))
        : null,
      hands: (detail.hands || []).map(item => Object.assign({}, item, {
        currentProfitDisplay: display.formatAmount(item.currentProfit, chipUnit),
        heroCardsVisual: cardUi.parseHeroCardsInput(item.heroCardsInput),
        boardStreetVisual: cardUi.parseBoardStreets(item.board)
      })),
      settings,
      venueOptions,
      blindPresetOptions,
      form: form,
      profitPreviewDisplay: buildProfitDisplay(form.buyIn, form.cashOut),
      profitPreviewTone: getProfitTone(form.buyIn, form.cashOut),
      loading: false,
      detailViewVisible: !!(detail.session && this.data.mode !== 'create' && !this.data.editMode),
      sessionEditVisible: !!(detail.session && this.data.mode !== 'create' && this.data.editMode),
      sessionDetailHero: buildFinishedHero(detail.session, settings),
      sessionTimeline: buildSessionTimeline(detail.session, detail.hands || [], settings),
      sessionTimelineGroups: buildTimelineGroups(buildSessionTimeline(detail.session, detail.hands || [], settings))
    }, buildSessionActionState(this.data.mode, detail.session, this.data.editMode)))
    this.startDurationClock()
  },
  refreshActionState(session) {
    this.setData(buildSessionActionState(this.data.mode, session || this.data.session, this.data.editMode))
  },
  refreshHistoryDraftView(session, hands) {
    const settings = this.data.settings || dataService.getAppSettings()
    const nextSession = Object.assign({}, session, {
      handCount: (hands || []).length
    })
    const timeline = buildSessionTimeline(nextSession, hands || [], settings)
    this.setData({
      session: nextSession,
      hands: hands || [],
      historyDraftHands: hands || [],
      sessionDetailHero: buildFinishedHero(nextSession, settings),
      sessionTimeline: timeline,
      sessionTimelineGroups: buildTimelineGroups(timeline),
      profitPreviewDisplay: buildProfitDisplay(nextSession.buyIn, nextSession.cashOut || nextSession.endingChips),
      profitPreviewTone: getProfitTone(nextSession.buyIn, nextSession.cashOut || nextSession.endingChips)
    })
  },
  syncHistoryDraftFromForm(patch) {
    if (this.data.mode !== 'history') return
    const form = Object.assign({}, this.data.form, patch || {})
    const session = buildHistoryDraftSession(form, this.data.session)
    this.refreshHistoryDraftView(session, this.data.historyDraftHands || this.data.hands || [])
  },
  refreshDurationDisplay() {
    const view = sessionDuration.buildDurationView(this.data.session)
    this.setData({
      durationDisplay: view.display,
      durationLabel: view.label
    })
  },
  startDurationClock() {
    this.stopDurationClock()
    this.refreshDurationDisplay()
    if (!this.data.session || this.data.session.status !== 'active' || this.data.session.timerPausedAt) return
    const delay = 60000 - (Date.now() % 60000) + 50
    this.durationClockTimeout = setTimeout(() => {
      this.refreshDurationDisplay()
      this.durationClockInterval = setInterval(() => this.refreshDurationDisplay(), 60000)
      this.durationClockTimeout = null
    }, delay)
  },
  stopDurationClock() {
    if (this.durationClockTimeout) clearTimeout(this.durationClockTimeout)
    if (this.durationClockInterval) clearInterval(this.durationClockInterval)
    this.durationClockTimeout = null
    this.durationClockInterval = null
  },
  onInput(e) {
    const key = e.currentTarget.dataset.key
    const value = e.detail.value
    const patch = { ['form.' + key]: value }
    if (key === 'buyIn' || key === 'cashOut') {
      const nextForm = Object.assign({}, this.data.form, { [key]: value })
      patch.profitPreviewDisplay = buildProfitDisplay(nextForm.buyIn, nextForm.cashOut)
      patch.profitPreviewTone = getProfitTone(nextForm.buyIn, nextForm.cashOut)
    }
    this.setData(patch, () => this.syncHistoryDraftFromForm({ [key]: value }))
  },
  setSessionStraddleValue(hasStraddle) {
    this.setData({ 'form.hasStraddle': !!hasStraddle }, () => this.syncHistoryDraftFromForm({ hasStraddle: !!hasStraddle }))
  },
  selectSessionStraddleOption(e) {
    const value = String(e.currentTarget.dataset.value || '') === 'true'
    this.setSessionStraddleValue(value)
  },
  selectTableSize(e) {
    const value = String(e.currentTarget.dataset.value || '')
    if (!value) return
    this.setData({ 'form.tableSize': value }, () => this.syncHistoryDraftFromForm({ tableSize: value }))
  },
  pickStartDate(e) {
    const value = e.detail.value || ''
    this.setData({ 'form.startDate': value }, () => this.syncHistoryDraftFromForm({ startDate: value }))
  },
  pickStartTime(e) {
    const value = e.detail.value || ''
    this.setData({ 'form.startTime': value }, () => this.syncHistoryDraftFromForm({ startTime: value }))
  },
  pickEndDate(e) {
    const value = e.detail.value || ''
    this.setData({ 'form.endDate': value }, () => this.syncHistoryDraftFromForm({ endDate: value }))
  },
  pickEndTime(e) {
    const value = e.detail.value || ''
    this.setData({ 'form.endTime': value }, () => this.syncHistoryDraftFromForm({ endTime: value }))
  },
  pickVenue(e) {
    const venue = this.data.venueOptions[e.detail.value] || ''
    this.setData({ 'form.venue': venue }, () => this.syncHistoryDraftFromForm({ venue }))
  },
  pickBlindPreset(e) {
    const blindPreset = this.data.blindPresetOptions[e.detail.value] || ''
    const parts = String(blindPreset).split('/')
    dataService.updateSettings({ lastBlindPreset: blindPreset })
    this.setData({
      'form.blindPreset': blindPreset,
      'form.smallBlind': parts[0] || '',
      'form.bigBlind': parts[1] || ''
    }, () => this.syncHistoryDraftFromForm({
      blindPreset,
      smallBlind: parts[0] || '',
      bigBlind: parts[1] || ''
    }))
  },
  refreshPresetOptionsFromSettings() {
    const settings = dataService.getAppSettings()
    const form = this.data.form || {}
    const venueOptions = buildPresetList(settings.venues, form.venue)
    const blindPresetOptions = buildPresetList(settings.blindPresets, form.blindPreset || settings.lastBlindPreset)
    this.setData({
      settings,
      venueOptions,
      blindPresetOptions
    })
    return { venueOptions, blindPresetOptions }
  },
  openVenueSelector() {
    const state = this.refreshPresetOptionsFromSettings()
    this.setData({
      selectorVisible: true,
      selectorTitle: '选择场地',
      selectorKey: 'venue',
      selectorOptions: buildSelectorOptions(state.venueOptions, this.data.form.venue)
    })
  },
  openBlindPresetSelector() {
    const state = this.refreshPresetOptionsFromSettings()
    this.setData({
      selectorVisible: true,
      selectorTitle: '选择级别',
      selectorKey: 'blindPreset',
      selectorOptions: buildSelectorOptions(state.blindPresetOptions, this.data.form.blindPreset)
    })
  },
  closeSelector() {
    this.setData({ selectorVisible: false })
  },
  selectPresetOption(e) {
    const key = this.data.selectorKey
    const value = String(e.currentTarget.dataset.value || '')
    if (!key || !value) return
    if (key === 'blindPreset') {
      const parts = value.split('/')
      dataService.updateSettings({ lastBlindPreset: value })
      this.setData({
        'form.blindPreset': value,
        'form.smallBlind': parts[0] || '',
        'form.bigBlind': parts[1] || '',
        selectorVisible: false
      }, () => this.syncHistoryDraftFromForm({
        blindPreset: value,
        smallBlind: parts[0] || '',
        bigBlind: parts[1] || ''
      }))
      return
    }
    this.setData({
      ['form.' + key]: value,
      selectorVisible: false
    }, () => this.syncHistoryDraftFromForm({ [key]: value }))
  },
  async saveSession(options) {
    const saveOptions = options && options.navigateToFull ? options : {}
    const form = this.data.form
    if (!form.venue || !form.buyIn) {
      wx.showToast({ title: '请先填写场地和买入', icon: 'none' })
      return
    }
    if (!form.startDate || !form.startTime) {
      wx.showToast({ title: '请先填写开始时间', icon: 'none' })
      return
    }
    const payload = Object.assign({}, form, {
      date: form.startDate,
      startTime: combineDateTime(form.startDate, form.startTime),
      endTime: combineDateTime(form.endDate, form.endTime),
      hasStraddle: !!form.hasStraddle,
      totalProfit: calculateSessionProfit(form.buyIn, form.cashOut) || 0
    })
    dataService.updateSettings({ lastBlindPreset: payload.blindPreset })
    if (this.data.mode === 'history') {
      if (this.data.historySessionSaving) return
      const buyIn = Number(payload.buyIn) || 0
      const cashOut = Number(payload.cashOut)
      if (!buyIn || !Number.isFinite(cashOut)) {
        wx.showToast({ title: '请先填写买入和总筹码', icon: 'none' })
        return
      }
      this.setData({ historySessionSaving: true })
      try {
        const sessionPayload = Object.assign({}, buildHistoryDraftSession(form, this.data.session), {
          _id: undefined,
          status: 'finished',
          buyIn,
          cashOut,
          endingChips: cashOut,
          totalProfit: cashOut - buyIn,
          handCount: (this.data.historyDraftHands || []).length,
          date: form.startDate,
          startTime: combineDateTime(form.startDate, form.startTime),
          endTime: combineDateTime(form.endDate || form.startDate, form.endTime || form.startTime),
          timerPausedAt: ''
        })
        const savedSession = await dataService.createSession(sessionPayload)
        const hands = this.data.historyDraftHands || []
        for (let index = hands.length - 1; index >= 0; index -= 1) {
          const hand = Object.assign({}, hands[index], {
            _id: undefined,
            sessionId: savedSession._id,
            sequence: hands[index].sequence || nextTimelineSequence()
          })
          await dataService.createHand(hand)
        }
        wx.showToast({ title: '已添加历史 Session', icon: 'success' })
        this.setData({ historySessionSaving: false })
        wx.redirectTo({
          url: saveOptions.navigateToFull
            ? '/pages/hand-ledger-input/hand-ledger-input?sessionId=' + savedSession._id + '&returnTo=session-edit&playedDate=' + encodeURIComponent(saveOptions.playedDate || getDefaultTimelineEventTime(sessionPayload, form))
            : '/pages/session-detail/session-detail?id=' + savedSession._id
        })
      } catch (error) {
        console.warn('save history session failed: ' + (error && (error.stack || error.message || error.errMsg) || error))
        this.setData({ historySessionSaving: false })
        wx.showToast({ title: '保存失败，请稍后重试', icon: 'none' })
      }
      return
    }
    if (this.data.mode === 'create') {
      try {
        const session = await dataService.createSession(payload)
        wx.showToast({ title: '已创建牌局', icon: 'success' })
        wx.redirectTo({ url: '/pages/session-detail/session-detail?id=' + session._id })
      } catch (error) {
        const duplicate = error && error.code === sessionRules.ACTIVE_SESSION_ERROR_CODE
        wx.showToast({
          title: duplicate ? sessionRules.ACTIVE_SESSION_MESSAGE : '创建失败，请稍后重试',
          icon: 'none'
        })
      }
      return
    }
    await dataService.updateSession(this.data.sessionId, payload)
    this.setData({ editMode: false, detailViewVisible: true, sessionEditVisible: false })
    wx.showToast({ title: '已更新牌局', icon: 'success' })
    this.refresh()
  },
  openSessionMore() {
    this.setData({ sessionMoreVisible: true })
  },
  closeSessionMore() {
    this.setData({ sessionMoreVisible: false })
  },
  enterEditMode() {
    this.setData({
      editMode: true,
      detailViewVisible: false,
      sessionEditVisible: true,
      sessionMoreVisible: false
    })
    this.refreshActionState(this.data.session)
  },
  leaveEditMode() {
    if (this.data.mode === 'history') {
      this.goBack()
      return
    }
    this.setData({
      editMode: false,
      detailViewVisible: !!this.data.session,
      sessionEditVisible: false,
      sessionMoreVisible: false
    })
    this.refreshActionState(this.data.session)
  },
  goBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => {
        wx.switchTab({ url: '/pages/session-list/session-list' })
      }
    })
  },
  switchDetailTab(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    wx.switchTab({ url })
  },
  async toggleTimerPause() {
    if (!this.data.sessionId || !this.data.session || this.data.session.status !== 'active') return
    const now = getNowParts()
    const nowText = combineDateTime(now.date, now.time)
    const session = this.data.session
    if (session.timerPausedAt) {
      const pauseMinutes = diffMinutes(session.timerPausedAt, nowText)
      const currentStartTime = combineDateTime(this.data.form.startDate, this.data.form.startTime) || session.startTime
      const nextStartTime = shiftDateTime(currentStartTime, pauseMinutes)
      const startParts = splitDateTime(nextStartTime)
      await dataService.updateSession(this.data.sessionId, {
        startTime: nextStartTime,
        date: startParts.date,
        timerPausedAt: ''
      })
      this.setData({
        'form.startDate': startParts.date,
        'form.startTime': startParts.time,
        'session.startTime': nextStartTime,
        'session.date': startParts.date,
        'session.timerPausedAt': ''
      })
      wx.showToast({ title: '已继续计时', icon: 'success' })
      this.refresh()
      return
    }
    await dataService.updateSession(this.data.sessionId, {
      timerPausedAt: nowText
    })
    this.setData({
      'session.timerPausedAt': nowText
    })
    wx.showToast({ title: '已暂停计时', icon: 'success' })
    this.refresh()
  },
  onTimelineItemTouchStart(e) {
    if (!this.data.editMode) return
    const touch = e.touches && e.touches[0]
    if (!touch) return
    this.setData({
      timelineTouchStartX: touch.clientX,
      timelineTouchStartY: touch.clientY,
      timelineTouchMoved: false
    })
  },
  onTimelineItemTouchEnd(e) {
    if (!this.data.editMode) return
    const touch = e.changedTouches && e.changedTouches[0]
    const eventId = e.currentTarget.dataset.id || ''
    if (!touch || !eventId) return
    const deltaX = touch.clientX - this.data.timelineTouchStartX
    const deltaY = touch.clientY - this.data.timelineTouchStartY
    if (Math.abs(deltaX) > Math.abs(deltaY) && deltaX < -TIMELINE_SWIPE_OPEN_DISTANCE) {
      const timeline = (this.data.sessionTimeline || []).map(item => Object.assign({}, item, {
        swiped: item.id === eventId
      }))
      this.setData({
        swipedTimelineEventId: eventId,
        sessionTimeline: timeline,
        sessionTimelineGroups: buildTimelineGroups(timeline),
        timelineTouchMoved: true
      })
      return
    }
    if (Math.abs(deltaX) > Math.abs(deltaY) && deltaX > TIMELINE_SWIPE_CLOSE_DISTANCE) {
      this.closeSwipedTimelineItem()
    }
  },
  closeSwipedTimelineItem() {
    const timeline = (this.data.sessionTimeline || []).map(item => Object.assign({}, item, { swiped: false }))
    this.setData({
      swipedTimelineEventId: '',
      sessionTimeline: timeline,
      sessionTimelineGroups: buildTimelineGroups(timeline)
    })
  },
  findTimelineEvent(eventId) {
    return (this.data.sessionTimeline || []).find(item => item.id === eventId) || null
  },
  openTimelineEdit(e) {
    if (!this.data.editMode) return
    const event = this.findTimelineEvent(e.currentTarget.dataset.id || '')
    if (!event) return
    if (event.type === 'full') {
      wx.navigateTo({
        url: '/pages/hand-ledger-input/hand-ledger-input?handId=' + event.sourceId + '&returnTo=session-edit'
      })
      this.closeSwipedTimelineItem()
      return
    }
    const editor = buildTimelineEditor(event)
    this.setData({
      timelineEditorVisible: true,
      timelineEditor: editor,
      timelinePositionOptions: getPositionOptionsForTable(this.data.session && this.data.session.tableSize),
      timelineHeroPickerVisible: false,
      timelineHeroPickerDeck: buildHeroPickerDeck(editor.heroCardsInput),
      timelineProfitEditorVisible: false
    })
    this.closeSwipedTimelineItem()
  },
  openSessionEditAction(e) {
    if (!this.data.editMode || !this.data.session) return
    const type = String(e.currentTarget.dataset.type || '')
    if (type === 'ai-reminder') {
      if (wx && wx.setStorageSync) {
        wx.setStorageSync(OPEN_AI_REMINDER_EDITOR_KEY, '1')
      }
      if (wx && wx.switchTab) {
        wx.switchTab({ url: '/pages/profile/profile' })
      }
      return
    }
    if (type === 'full') {
      this.goFullHand()
      return
    }
    const eventTime = getDefaultTimelineEventTime(this.data.session, this.data.form)
    let editorType = type
    let amount = ''
    let text = ''
    let id = ''
    if (type === 'buyin') {
      editorType = 'buyin_add'
    } else if (type === 'cashout') {
      editorType = 'cashout'
      id = 'session-cashout'
      amount = String(this.data.session.cashOut || this.data.session.endingChips || this.data.form.cashOut || '')
    } else if (type === 'comment') {
      text = ''
    } else if (type !== 'quick') {
      return
    }
    const editor = buildTimelineEditor({
      id,
      type: editorType,
      amount,
      text,
      eventTime,
      heroCardsInput: '',
      heroPosition: '',
      currentProfit: '',
      notes: '',
      isNew: true
    })
    this.setData({
      timelineEditorVisible: true,
      timelineEditor: editor,
      timelinePositionOptions: getPositionOptionsForTable(this.data.session && this.data.session.tableSize),
      timelineHeroPickerVisible: false,
      timelineHeroPickerDeck: buildHeroPickerDeck(''),
      timelineProfitEditorVisible: false
    })
    this.closeSwipedTimelineItem()
  },
  closeTimelineEditor() {
    this.setData({
      timelineEditorVisible: false,
      timelineEditor: buildTimelineEditor(),
      timelineHeroPickerVisible: false,
      timelineProfitEditorVisible: false
    })
  },
  onTimelineEditorInput(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    const patch = { ['timelineEditor.' + key]: e.detail.value }
    if (key === 'heroCardsInput') {
      patch['timelineEditor.heroCardsVisual'] = cardUi.parseHeroCardsInput(e.detail.value)
    }
    this.setData(patch)
  },
  selectTimelinePosition(e) {
    const position = String(e.currentTarget.dataset.position || '')
    if (!position) return
    this.setData({ 'timelineEditor.heroPosition': position })
  },
  openTimelineHeroPicker() {
    this.setData({
      timelineHeroPickerVisible: true,
      timelineHeroPickerDeck: buildHeroPickerDeck(this.data.timelineEditor.heroCardsInput)
    })
  },
  closeTimelineHeroPicker() {
    this.setData({ timelineHeroPickerVisible: false })
  },
  pickTimelineHeroCard(e) {
    const token = String(e.currentTarget.dataset.token || '')
    if (!token) return
    const selected = cardUi.parseHeroCardsInput(this.data.timelineEditor.heroCardsInput)
    const selectedTokens = selected.map(card => card.rank + card.suit)
    const existingIndex = selectedTokens.indexOf(token)
    if (existingIndex > -1) {
      selectedTokens.splice(existingIndex, 1)
    } else {
      if (selectedTokens.length >= 2) selectedTokens.shift()
      selectedTokens.push(token)
    }
    const normalized = selectedTokens.join('')
    this.setData({
      'timelineEditor.heroCardsInput': normalized,
      'timelineEditor.heroCardsVisual': cardUi.parseHeroCardsInput(normalized),
      timelineHeroPickerDeck: buildHeroPickerDeck(normalized),
      timelineHeroPickerVisible: selectedTokens.length < 2
    })
  },
  handleTimelineHeroPickerTool(e) {
    const action = String(e.currentTarget.dataset.action || '')
    const selectedTokens = cardUi.parseHeroCardsInput(this.data.timelineEditor.heroCardsInput)
      .map(card => card.rank + card.suit)
    if (action === 'clear') {
      selectedTokens.length = 0
    } else if (action === 'backspace') {
      selectedTokens.pop()
    }
    const normalized = selectedTokens.join('')
    this.setData({
      'timelineEditor.heroCardsInput': normalized,
      'timelineEditor.heroCardsVisual': cardUi.parseHeroCardsInput(normalized),
      timelineHeroPickerDeck: buildHeroPickerDeck(normalized)
    })
  },
  openTimelineProfitEditor() {
    const parsed = parseProfitEditorValue(this.data.timelineEditor.currentProfit)
    this.setData({
      timelineProfitEditorVisible: true,
      timelineProfitEditorSign: parsed.sign,
      timelineProfitEditorDigits: parsed.digits
    })
  },
  closeTimelineProfitEditor() {
    this.setData({ timelineProfitEditorVisible: false })
  },
  pickTimelineProfitSign(e) {
    const sign = String(e.currentTarget.dataset.sign || '+') === '-' ? '-' : '+'
    this.setData({ timelineProfitEditorSign: sign })
  },
  appendTimelineProfitDigit(e) {
    const digit = String(e.currentTarget.dataset.digit || '').replace(/\D/g, '')
    if (!digit) return
    const digits = String(this.data.timelineProfitEditorDigits || '') + digit
    this.setData({ timelineProfitEditorDigits: digits.replace(/^0+(?=\d)/, '') })
  },
  handleTimelineProfitEditorTool(e) {
    const action = String(e.currentTarget.dataset.action || '')
    const current = String(this.data.timelineProfitEditorDigits || '')
    if (action === 'clear') {
      this.setData({ timelineProfitEditorDigits: '' })
      return
    }
    if (action === 'backspace') {
      this.setData({ timelineProfitEditorDigits: current.slice(0, -1) })
    }
  },
  applyTimelineProfitEditor() {
    this.setData({
      'timelineEditor.currentProfit': buildProfitEditorValue(this.data.timelineProfitEditorSign, this.data.timelineProfitEditorDigits),
      timelineProfitEditorVisible: false
    })
  },
  pickTimelineEditorDate(e) {
    this.setData({ 'timelineEditor.date': e.detail.value || '' })
  },
  pickTimelineEditorTime(e) {
    this.setData({ 'timelineEditor.time': e.detail.value || '' })
  },
  saveHistoryTimelineEditor(editor, eventTime) {
    const session = this.data.session || {}
    const hands = (this.data.historyDraftHands || this.data.hands || []).slice()
    const timelineEvents = (session.timelineEvents || []).slice()
    const effectiveTime = eventTime || combineDateTime(getNowParts().date, getNowParts().time)
    if (editor.type === 'buyin' || editor.type === 'cashout') {
      const amount = Number(editor.amount) || 0
      if (!amount) {
        wx.showToast({ title: '请填写金额', icon: 'none' })
        return false
      }
      const patch = editor.type === 'buyin'
        ? { buyIn: String(amount), startDate: editor.date, startTime: editor.time }
        : { cashOut: String(amount), endDate: editor.date, endTime: editor.time }
      this.setData(Object.keys(patch).reduce((acc, key) => {
        acc['form.' + key] = patch[key]
        return acc
      }, {}))
      const nextForm = Object.assign({}, this.data.form, patch)
      this.refreshHistoryDraftView(buildHistoryDraftSession(nextForm, session), hands)
      return true
    }
    if (editor.type === 'quick') {
      if (cardUi.parseHeroCardsInput(editor.heroCardsInput).length !== 2) {
        wx.showToast({ title: '请选择两张手牌', icon: 'none' })
        return false
      }
      if (String(editor.currentProfit || '').trim() === '') {
        wx.showToast({ title: '请填写本手输赢', icon: 'none' })
        return false
      }
      const profit = Number(editor.currentProfit)
      if (!Number.isFinite(profit)) {
        wx.showToast({ title: '输赢金额不正确', icon: 'none' })
        return false
      }
      const createdAtMs = getEventSortMs(effectiveTime)
      const payload = {
        sessionId: HISTORY_DRAFT_ID,
        playedDate: effectiveTime,
        createdAtMs,
        sequence: editor.isNew ? nextTimelineSequence() : undefined,
        stakeLevel: getSessionLevel(session),
        heroCardsInput: editor.heroCardsInput,
        heroPosition: editor.heroPosition || '',
        effectiveStack: sessionStack.calculateSessionStackAt(session, hands, {
          cutoffMs: createdAtMs
        }),
        currentProfit: profit,
        notes: editor.notes || '',
        mindJourney: editor.notes || '',
        tableSize: session.tableSize || '',
        hasStraddle: !!session.hasStraddle,
        venue: session.venue || ''
      }
      const nextHands = editor.isNew
        ? [Object.assign({ _id: 'history_hand_' + nextTimelineSequence(), status: 'quick' }, payload)].concat(hands)
        : hands.map(hand => (hand._id || hand.id) === editor.id ? Object.assign({}, hand, payload, { sequence: hand.sequence }) : hand)
      this.refreshHistoryDraftView(buildHistoryDraftSession(this.data.form, session), nextHands)
      return true
    }
    if (editor.type === 'buyin_add') {
      const amount = Number(editor.amount) || 0
      if (!amount) {
        wx.showToast({ title: '请填写买入金额', icon: 'none' })
        return false
      }
      let previousAmount = 0
      const nextEvents = editor.isNew
        ? timelineEvents.concat({
          id: 'buyin_add_' + nextTimelineSequence(),
          type: 'buyin_add',
          title: '追加买入',
          amount,
          createdAt: effectiveTime,
          createdAtMs: getEventSortMs(effectiveTime),
          sequence: nextTimelineSequence()
        })
        : timelineEvents.map(item => {
          if (item.id !== editor.id) return item
          previousAmount = Number(item.amount) || 0
          return Object.assign({}, item, {
            amount,
            createdAt: effectiveTime,
            createdAtMs: getEventSortMs(effectiveTime)
          })
        })
      const nextSession = Object.assign({}, session, {
        buyIn: Math.max(0, (Number(session.buyIn) || 0) + (editor.isNew ? amount : amount - previousAmount)),
        timelineEvents: nextEvents
      })
      nextSession.totalProfit = calculateSessionProfit(nextSession.buyIn, nextSession.cashOut || nextSession.endingChips) || 0
      this.setData({
        'form.buyIn': String(nextSession.buyIn),
        profitPreviewDisplay: buildProfitDisplay(nextSession.buyIn, nextSession.cashOut || nextSession.endingChips),
        profitPreviewTone: getProfitTone(nextSession.buyIn, nextSession.cashOut || nextSession.endingChips)
      })
      this.refreshHistoryDraftView(nextSession, hands)
      return true
    }
    const nextEvents = editor.isNew
      ? timelineEvents.concat({
        id: 'comment_' + nextTimelineSequence(),
        type: 'comment',
        title: '备注',
        text: editor.text || '',
        createdAt: effectiveTime,
        createdAtMs: getEventSortMs(effectiveTime),
        sequence: nextTimelineSequence()
      })
      : timelineEvents.map(item => item.id === editor.id ? Object.assign({}, item, {
        text: editor.text || '',
        createdAt: effectiveTime,
        createdAtMs: getEventSortMs(effectiveTime)
      }) : item)
    this.refreshHistoryDraftView(Object.assign({}, session, { timelineEvents: nextEvents }), hands)
    return true
  },
  async saveTimelineEditor() {
    const editor = this.data.timelineEditor || {}
    const eventTime = combineDateTime(editor.date, editor.time)
    if (this.data.mode === 'history') {
      const saved = this.saveHistoryTimelineEditor(editor, eventTime)
      if (!saved) return
      wx.showToast({ title: '已保存', icon: 'success' })
      this.closeTimelineEditor()
      return
    }
    if (editor.type === 'buyin') {
      await dataService.updateSession(this.data.sessionId, {
        buyIn: Number(editor.amount) || 0,
        startTime: eventTime || this.data.session.startTime,
        date: editor.date || this.data.session.date,
        totalProfit: calculateSessionProfit(Number(editor.amount) || 0, this.data.session.cashOut || this.data.session.endingChips) || 0
      })
    } else if (editor.type === 'cashout') {
      const cashOut = Number(editor.amount) || 0
      await dataService.updateSession(this.data.sessionId, {
        cashOut,
        endingChips: cashOut,
        endTime: eventTime || this.data.session.endTime,
        totalProfit: calculateSessionProfit(this.data.session.buyIn, cashOut) || 0
      })
    } else if (editor.type === 'quick') {
      if (cardUi.parseHeroCardsInput(editor.heroCardsInput).length !== 2) {
        wx.showToast({ title: '请选择两张手牌', icon: 'none' })
        return
      }
      if (String(editor.currentProfit || '').trim() === '') {
        wx.showToast({ title: '请填写本手输赢', icon: 'none' })
        return
      }
      const profit = Number(editor.currentProfit)
      if (!Number.isFinite(profit)) {
        wx.showToast({ title: '输赢金额不正确', icon: 'none' })
        return
      }
      if (editor.isNew) {
        const playedDate = eventTime || combineDateTime(getNowParts().date, getNowParts().time)
        const createdAtMs = getEventSortMs(playedDate)
        const payload = {
          sessionId: this.data.sessionId,
          playedDate,
          createdAtMs,
          sequence: nextTimelineSequence(),
          stakeLevel: getSessionLevel(this.data.session),
          heroCardsInput: editor.heroCardsInput,
          heroPosition: editor.heroPosition || '',
          effectiveStack: sessionStack.calculateSessionStackAt(this.data.session, this.data.hands || [], {
            cutoffMs: createdAtMs
          }),
          currentProfit: profit,
          notes: editor.notes || '',
          mindJourney: editor.notes || '',
          tableSize: this.data.session.tableSize || '',
          hasStraddle: !!this.data.session.hasStraddle,
          venue: this.data.session.venue || ''
        }
        await dataService.createHand(payload)
      } else {
        await dataService.updateHand(editor.id, {
          playedDate: eventTime,
          heroCardsInput: editor.heroCardsInput,
          heroPosition: editor.heroPosition,
          currentProfit: profit,
          notes: editor.notes,
          mindJourney: editor.notes
        })
      }
    } else if (editor.type === 'buyin_add') {
      const amount = Number(editor.amount) || 0
      if (!amount) {
        wx.showToast({ title: '请填写买入金额', icon: 'none' })
        return
      }
      const currentEvents = this.data.session.timelineEvents || []
      let previousAmount = 0
      let timelineEvents
      if (editor.isNew) {
        timelineEvents = currentEvents.concat({
          id: 'buyin_add_' + nextTimelineSequence(),
          type: 'buyin_add',
          title: '追加买入',
          amount,
          createdAt: eventTime || combineDateTime(getNowParts().date, getNowParts().time),
          createdAtMs: getEventSortMs(eventTime) || Date.now(),
          sequence: nextTimelineSequence()
        })
      } else {
        timelineEvents = currentEvents.map(item => {
          if (item.id !== editor.id) return item
          previousAmount = Number(item.amount) || 0
          return Object.assign({}, item, {
            title: item.title || '追加买入',
            amount,
            createdAt: eventTime || item.createdAt,
            createdAtMs: getEventSortMs(eventTime || item.createdAt),
            sequence: item.sequence || nextTimelineSequence()
          })
        })
      }
      const nextBuyIn = Math.max(0, (Number(this.data.session.buyIn) || 0) + (editor.isNew ? amount : amount - previousAmount))
      await dataService.updateSession(this.data.sessionId, {
        buyIn: nextBuyIn,
        totalProfit: calculateSessionProfit(nextBuyIn, this.data.session.cashOut || this.data.session.endingChips) || 0,
        timelineEvents
      })
    } else {
      const currentEvents = this.data.session.timelineEvents || []
      const timelineEvents = editor.isNew
        ? currentEvents.concat({
          id: 'comment_' + nextTimelineSequence(),
          type: 'comment',
          title: '备注',
          text: editor.text || '',
          createdAt: eventTime || combineDateTime(getNowParts().date, getNowParts().time),
          createdAtMs: getEventSortMs(eventTime) || Date.now(),
          sequence: nextTimelineSequence()
        })
        : currentEvents.map(item => {
          if (item.id !== editor.id) return item
          return Object.assign({}, item, {
            text: editor.text,
            createdAt: eventTime || item.createdAt,
            createdAtMs: getEventSortMs(eventTime || item.createdAt)
          })
        })
      await dataService.updateSession(this.data.sessionId, { timelineEvents })
    }
    wx.showToast({ title: '已保存', icon: 'success' })
    this.closeTimelineEditor()
    await this.refresh()
  },
  deleteHistoryTimelineItem(event) {
    const session = this.data.session || {}
    if (event.type === 'quick') {
      const hands = (this.data.historyDraftHands || this.data.hands || []).filter(hand => (hand._id || hand.id) !== event.id)
      this.refreshHistoryDraftView(session, hands)
      return
    }
    if (event.type === 'buyin_add') {
      const nextBuyIn = Math.max(0, (Number(session.buyIn) || 0) - (Number(event.amount) || 0))
      const nextSession = Object.assign({}, session, {
        buyIn: nextBuyIn,
        timelineEvents: (session.timelineEvents || []).filter(item => item.id !== event.id)
      })
      nextSession.totalProfit = calculateSessionProfit(nextBuyIn, session.cashOut || session.endingChips) || 0
      this.setData({
        'form.buyIn': String(nextBuyIn),
        profitPreviewDisplay: buildProfitDisplay(nextBuyIn, nextSession.cashOut || nextSession.endingChips),
        profitPreviewTone: getProfitTone(nextBuyIn, nextSession.cashOut || nextSession.endingChips)
      })
      this.refreshHistoryDraftView(nextSession, this.data.historyDraftHands || this.data.hands || [])
      return
    }
    if (event.type === 'cashout') {
      const nextSession = Object.assign({}, session, {
        cashOut: '',
        endingChips: '',
        totalProfit: 0
      })
      this.setData({
        'form.cashOut': '',
        profitPreviewDisplay: '',
        profitPreviewTone: 'empty'
      })
      this.refreshHistoryDraftView(nextSession, this.data.historyDraftHands || this.data.hands || [])
      return
    }
    if (event.type === 'buyin') {
      const nextSession = Object.assign({}, session, {
        buyIn: 0,
        totalProfit: calculateSessionProfit(0, session.cashOut || session.endingChips) || 0
      })
      this.setData({ 'form.buyIn': '0' })
      this.refreshHistoryDraftView(nextSession, this.data.historyDraftHands || this.data.hands || [])
      return
    }
    this.refreshHistoryDraftView(Object.assign({}, session, {
      timelineEvents: (session.timelineEvents || []).filter(item => item.id !== event.id)
    }), this.data.historyDraftHands || this.data.hands || [])
  },
  deleteTimelineItem(e) {
    if (!this.data.editMode) return
    const event = this.findTimelineEvent(e.currentTarget.dataset.id || '')
    if (!event) return
    wx.showModal({
      title: '删除条目',
      content: '删除后无法恢复，是否继续？',
      confirmText: '删除',
      confirmColor: '#dc2626',
      success: async res => {
        if (!res.confirm) return
        if (this.data.mode === 'history') {
          this.deleteHistoryTimelineItem(event)
          this.closeSwipedTimelineItem()
          return
        }
        if (event.type === 'quick') {
          await dataService.deleteHand(event.id)
        } else if (event.type === 'buyin') {
          await dataService.updateSession(this.data.sessionId, {
            buyIn: 0,
            totalProfit: calculateSessionProfit(0, this.data.session.cashOut || this.data.session.endingChips) || 0
          })
        } else if (event.type === 'cashout') {
          await dataService.updateSession(this.data.sessionId, {
            cashOut: '',
            endingChips: '',
            endTime: '',
            totalProfit: 0
          })
        } else if (event.type === 'buyin_add') {
          const nextBuyIn = Math.max(0, (Number(this.data.session.buyIn) || 0) - (Number(event.amount) || 0))
          await dataService.updateSession(this.data.sessionId, {
            buyIn: nextBuyIn,
            totalProfit: calculateSessionProfit(nextBuyIn, this.data.session.cashOut || this.data.session.endingChips) || 0,
            timelineEvents: (this.data.session.timelineEvents || []).filter(item => item.id !== event.id)
          })
        } else {
          await dataService.updateSession(this.data.sessionId, {
            timelineEvents: (this.data.session.timelineEvents || []).filter(item => item.id !== event.id)
          })
        }
        this.closeSwipedTimelineItem()
        await this.refresh()
      }
    })
  },
  goAddHand() {
    if (!this.data.sessionId) return
    wx.setStorageSync(PENDING_RECORD_SESSION_ID_KEY, {
      sessionId: this.data.sessionId,
      allowFinished: !!(this.data.session && this.data.session.status !== 'active'),
      createdAt: Date.now()
    })
    wx.switchTab({ url: '/pages/hand-record/hand-record' })
  },
  goFullHand() {
    const playedDate = getDefaultTimelineEventTime(this.data.session, this.data.form)
    if (this.data.mode === 'history') {
      this.saveSession({ navigateToFull: true, playedDate })
      return
    }
    if (!this.data.sessionId) return
    const returnQuery = this.data.editMode ? '&returnTo=session-edit' : ''
    const playedDateQuery = this.data.editMode && playedDate ? '&playedDate=' + encodeURIComponent(playedDate) : ''
    wx.navigateTo({ url: '/pages/hand-ledger-input/hand-ledger-input?sessionId=' + this.data.sessionId + returnQuery + playedDateQuery })
  },
  goHandDetail(e) {
    wx.navigateTo({ url: '/pages/hand-detail/hand-detail?id=' + e.currentTarget.dataset.id })
  },
  finishSession() {
    if (!this.data.sessionId) return
    if (!this.data.session || this.data.session.status !== 'active') return
    const form = this.data.form
    if (!form.venue || !form.buyIn) {
      wx.showToast({ title: '请先填写场地和买入', icon: 'none' })
      return
    }
    if (!form.startDate || !form.startTime) {
      wx.showToast({ title: '请先填写开始时间', icon: 'none' })
      return
    }
    if (form.cashOut === '') {
      wx.showToast({ title: '请先填写提现', icon: 'none' })
      return
    }
    const now = getNowParts()
    const endTime = this.data.session && this.data.session.timerPausedAt
      ? this.data.session.timerPausedAt
      : combineDateTime(now.date, now.time)
    const payload = Object.assign({}, form, {
      date: form.startDate,
      startTime: combineDateTime(form.startDate, form.startTime),
      endTime: endTime,
      timerPausedAt: '',
      hasStraddle: !!form.hasStraddle,
      totalProfit: calculateSessionProfit(form.buyIn, form.cashOut) || 0
    })
    dataService.updateSettings({ lastBlindPreset: payload.blindPreset })
    dataService.updateSession(this.data.sessionId, payload).then(() => {
      return dataService.finishSession(this.data.sessionId, {
        cashOut: form.cashOut,
        endTime: endTime
      })
    }).then(() => {
      wx.showToast({ title: '本场已结束', icon: 'success' })
      this.refresh()
    })
  }
})
