const dataService = require('../../services/data-service')
const aiService = require('../../services/ai-service')
const display = require('../../utils/display')
const tabBar = require('../../utils/tab-bar')
const sessionDuration = require('../../utils/session-duration')
const sessionRules = require('../../utils/session-rules')
const onboardingGuide = require('../../utils/onboarding-guide')
const cardUi = require('../../utils/card-ui')
const sessionStack = require('../../utils/session-stack')
const reminderCards = require('../../utils/agent-reminder-cards')
const launchAnimation = require('../../utils/launch-animation')
const launchPrefetch = require('../../utils/launch-prefetch')
const releaseNotes = require('../../utils/release-notes')
const handEntryType = require('../../utils/hand-entry-type')
const { AI_REMINDER_SUBSCRIBE_TEMPLATE_ID } = require('../../config/cloud')

const SWIPE_OPEN_DISTANCE = 72
const SWIPE_CLOSE_DISTANCE = 48
const LIST_PAGE_SIZE = 20
const ON_SHOW_FRESH_MS = 5000
const PENDING_RECORD_SESSION_ID_KEY = 'pokerLivePendingRecordSessionId'
const OPEN_CREATE_SESSION_KEY = 'pokerLiveOpenCreateSession'
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
const POSITION_OPTIONS = POSITION_OPTIONS_BY_TABLE[8]
const SESSION_ICON_ASSETS = {
  buyin: '/assets/session-icons/p5-buyin-v251.png',
  buyin_add: '/assets/session-icons/p5-buyin-v251.png',
  comment: '/assets/session-icons/p5-comment-v251.png',
  quick: '/assets/session-icons/p5-quick-v251.png',
  full: '/assets/session-icons/p5-full-v251.png',
  ai_reminder: '/assets/session-icons/p5-ai-reminder-v252.png'
}
let timelineSequenceNonce = 0
const HISTORY_DRAFT_ID = 'history_session_draft'
const COMMENT_OPTIONS = {
  mood: ['平静', '急躁', '上头', '无聊'],
  status: ['Agame', 'Cgame', '生病', '疲惫']
}

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

function combineDateTime(datePart, timePart) {
  const date = String(datePart || '').trim()
  const time = String(timePart || '').trim()
  if (!date) return ''
  if (!time) return date
  return date + ' ' + time
}

function parseDateTimeValue(value) {
  const text = String(value || '').trim()
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

function splitDateTime(value) {
  const text = String(value || '').trim()
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

function getLevelParts(level) {
  const parts = String(level || '').split('/')
  return {
    smallBlind: parts[0] || '',
    bigBlind: parts[1] || ''
  }
}

function buildBlindPresetOptions(settings, currentValue) {
  const presets = []
  const addPreset = value => {
    const text = String(value || '').trim()
    if (text && presets.indexOf(text) === -1) presets.push(text)
  }
  addPreset(currentValue)
  ;((settings && settings.blindPresets) || []).forEach(addPreset)
  addPreset(settings && settings.lastBlindPreset)
  return presets.length ? presets : ['5/10']
}

function buildVenuePresetOptions(settings, currentValue) {
  const venues = []
  const addVenue = value => {
    const text = String(value || '').trim()
    if (text && venues.indexOf(text) === -1) venues.push(text)
  }
  addVenue(currentValue)
  ;((settings && settings.venues) || []).forEach(addVenue)
  return venues
}

function buildCreateForm(settings) {
  const venues = settings && settings.venues ? settings.venues : []
  const blindPresets = settings && settings.blindPresets ? settings.blindPresets : []
  const blindPreset = (settings && settings.lastBlindPreset) || blindPresets[0] || '5/10'
  const parts = getLevelParts(blindPreset)
  const bigBlind = Number(parts.bigBlind) || 10
  return {
    venue: venues[0] || '',
    blindPreset,
    smallBlind: parts.smallBlind || '5',
    bigBlind: parts.bigBlind || '10',
    gameType: 'NLHE',
    tableSize: '8',
    hasStraddle: false,
    buyIn: String(bigBlind * 100),
    notes: ''
  }
}

function buildCreateOptions(list, currentValue) {
  return (list || []).map(item => {
    const value = String(item || '')
    return {
      label: value,
      value,
      active: value === String(currentValue || '')
    }
  })
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

function buildOnboardingCreateForm(settings) {
  const sourceSettings = settings || {}
  return {
    venue: '澳门',
    blindPreset: '300/600',
    smallBlind: 300,
    bigBlind: 600,
    gameType: 'NLHE',
    tableSize: '8',
    hasStraddle: false,
    buyIn: '300000',
    notes: ''
  }
}

function getOnboardingDemoSession(sessions) {
  const list = Array.isArray(sessions) ? sessions : []
  return list.find(item => item && item.onboardingDemo) || list[0] || {
    _id: 'demo_session_macau_300_600',
    title: '澳门 300/600 试用场',
    venue: '澳门',
    smallBlind: 300,
    bigBlind: 600,
    stakeLevel: '300/600',
    status: 'active',
    date: formatDatePart(new Date()),
    startTime: combineDateTime(formatDatePart(new Date()), formatTimePart(new Date())),
    buyIn: 300000,
    cashOut: '',
    totalProfit: 0,
    handCount: 0,
    tableSize: '8',
    hasStraddle: false,
    onboardingDemo: true
  }
}

function buildOnboardingActiveSession(session) {
  const source = session || getOnboardingDemoSession([])
  return Object.assign({}, source, {
    status: 'active',
    cashOut: '',
    endTime: '',
    totalProfit: 0,
    handCount: 0,
    tableSize: source.tableSize || '8',
    hasStraddle: !!source.hasStraddle,
    onboardingDemo: true
  })
}

function buildLiveDurationDisplay(session, now) {
  const view = sessionDuration.buildDurationView(session, now || new Date())
  if (!view || view.display === '--:--') return '--'
  return view.display
}

function getRecordedProfitFromHands(hands) {
  return (hands || []).reduce((sum, hand) => sum + (Number(hand && hand.currentProfit) || 0), 0)
}

function hasClockPart(value) {
  return /\d{1,2}:\d{2}/.test(String(value || ''))
}

function resolveHandTimelineTime(hand, fallback) {
  if (!hand) return fallback
  if (hand.playedDate && hasClockPart(hand.playedDate)) return hand.playedDate
  if (hand.createdAtMs) return hand.createdAtMs
  if (hand.createdAt && hasClockPart(hand.createdAt)) return hand.createdAt
  if (hand.updatedAt && hasClockPart(hand.updatedAt)) return hand.updatedAt
  if (hand.createdAt) return hand.createdAt
  if (hand.updatedAt) return hand.updatedAt
  return hand.playedDate || fallback
}

function isFullEntryHand(hand) {
  return handEntryType.isFullEntryHand(hand)
}

function formatStackAmount(value, unit) {
  const amount = Math.max(0, Number(value) || 0)
  if (unit === 'CNY') return '¥' + amount
  if (unit === 'HKD') return 'HK$' + amount
  if (unit === 'USD') return '$' + amount
  return amount + ' BB'
}

function buildSessionFinancials(session, hands) {
  const buyIn = Number(session && session.buyIn) || 0
  const finishedProfit = Number(session && session.totalProfit) || 0
  const historyCashOut = session && session.status === 'history_edit' ? Number(session.cashOut) || 0 : 0
  const currentStack = historyCashOut || sessionStack.calculateSessionStackAt(session, hands, { cutoffMs: Date.now() })
  const stackProfit = currentStack - buyIn
  const recordedProfit = getRecordedProfitFromHands(hands)
  const currentProfit = session && session.status === 'finished'
    ? finishedProfit
    : (stackProfit === 0 && recordedProfit !== 0 ? recordedProfit : stackProfit)
  return {
    buyIn,
    currentProfit,
    currentStack: stackProfit === 0 && recordedProfit !== 0 ? buyIn + recordedProfit : currentStack
  }
}

function buildSessionView(session, settings, now, hands) {
  if (!session) return null
  const financials = buildSessionFinancials(session, hands)
  const level = [session.smallBlind, session.bigBlind].filter(Boolean).join('/')
  return Object.assign({}, session, {
    durationDisplay: buildLiveDurationDisplay(session, now),
    durationLabel: session.status === 'finished' ? 'TOTAL DURATION' : 'SESSION TIME',
    buyInDisplay: display.formatAmount(financials.buyIn, settings && settings.chipUnit || ''),
    totalProfitDisplay: display.formatAmount(financials.currentProfit, settings && settings.chipUnit || ''),
    currentStackDisplay: formatStackAmount(financials.currentStack, settings && settings.chipUnit || ''),
    profitTone: financials.currentProfit >= 0 ? 'positive' : 'negative',
    handCountLabel: String(Number(session.handCount) || 0) + '手',
    levelDisplay: level || '--',
    venueDisplay: session.venue || '--',
    paused: !!session.timerPausedAt
  })
}

function buildSessionListItem(item, settings, index, swipedSessionId) {
  const level = [item.smallBlind, item.bigBlind].filter(Boolean).join('/')
  const profit = getDisplaySessionProfit(item)
  const isActive = item.status === 'active'
  return Object.assign({}, item, {
    totalProfitDisplay: display.formatAmount(profit, settings.chipUnit),
    totalProfitTone: profit >= 0 ? 'positive' : 'negative',
    statusLabel: isActive ? '进行中' : '已结束',
    statusCode: isActive ? 'LIVE' : 'DONE',
    statusIconAsset: isActive ? SESSION_ICON_ASSETS.quick : SESSION_ICON_ASSETS.full,
    sessionMetaLine: [level || item.level, item.venue, item.gameType || 'NLHE'].filter(Boolean).join(' @ '),
    sessionSubLine: '买入 ' + display.formatAmount(Number(item.buyIn) || 0, settings.chipUnit) + ' · 手牌 ' + (Number(item.handCount) || 0),
    swiped: item._id === swipedSessionId,
    onboardingSessionSwipeTargetClass: item.onboardingDemo ? 'onboarding-target-session-swipe-actions' : '',
    onboardingSessionDeleteTargetClass: item.onboardingDemo ? 'onboarding-target-session-delete' : '',
    __sortIndex: index
  })
}

function getSessionLevel(session) {
  return [session && session.smallBlind, session && session.bigBlind].filter(Boolean).join('/')
}

function formatEventTime(value) {
  const date = parseDateTimeValue(value) || new Date(Number(value) || Date.now())
  return padNumber(date.getHours()) + ':' + padNumber(date.getMinutes())
}

function getEventSortMs(value) {
  const parsed = parseDateTimeValue(value)
  if (parsed) return parsed.getTime()
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : Date.now()
}

function getEventSequence(value, fallback) {
  const matches = String(value || '').match(/\d+/g)
  if (!matches || !matches.length) return Number(fallback) || 0
  return Number(matches[matches.length - 1]) || Number(fallback) || 0
}

function nextTimelineSequence() {
  timelineSequenceNonce += 1
  return Date.now() * 1000 + timelineSequenceNonce
}

function formatChineseDate(value) {
  const date = parseDateTimeValue(value) || new Date(Number(value) || Date.now())
  const weekdays = ['日', '一', '二', '三', '四', '五', '六']
  return date.getFullYear() + '年' + (date.getMonth() + 1) + '月' + date.getDate() + '日 周' + weekdays[date.getDay()]
}

function getDateGroupKey(value) {
  const date = parseDateTimeValue(value) || new Date(Number(value) || Date.now())
  return formatDatePart(date)
}

function buildBuyInOptions(session, settings) {
  const bigBlind = Number(session && session.bigBlind) || 0
  return [50, 100, 200].map(bb => {
    const amount = bigBlind * bb
    return {
      bb,
      label: bb + 'bb',
      amount,
      amountDisplay: display.formatAmount(amount, settings && settings.chipUnit || ''),
      active: bb === 100
    }
  })
}

function buildTableChangeState(session, settings, selectedPreset) {
  const currentLevel = getSessionLevel(session)
  const options = buildBlindPresetOptions(settings, selectedPreset || currentLevel)
  const preset = String(selectedPreset || currentLevel || options[0] || '').trim()
  const pickerIndex = Math.max(0, options.indexOf(preset))
  const parts = getLevelParts(options[pickerIndex] || preset)
  const hasStraddle = !!(session && session.hasStraddle)
  return {
    tableChangeBlindPreset: options[pickerIndex] || preset,
    tableChangeBlindOptions: options.map(item => ({ label: item, value: item })),
    tableChangeBlindPickerIndex: pickerIndex,
    tableChangeHasStraddle: hasStraddle,
    tableChangeSummary: buildTableChangeSummary(options[pickerIndex] || preset, hasStraddle, session),
    tableChangeSmallBlind: parts.smallBlind,
    tableChangeBigBlind: parts.bigBlind
  }
}

function buildTableChangeSummary(level, hasStraddle, session) {
  const previousLevel = getSessionLevel(session) || '-'
  const nextLevel = String(level || '').trim() || '-'
  const previousStraddle = session && session.hasStraddle ? '是' : '否'
  const nextStraddle = hasStraddle ? '是' : '否'
  return previousLevel + ' / Straddle ' + previousStraddle + ' → ' + nextLevel + ' / Straddle ' + nextStraddle
}

function buildTimelineEventTitle(event) {
  const parentTitle = String(event && event.title || '备注').trim()
  const childText = String(event && (event.text || event.sub) || '').trim()
  if (!childText || childText === parentTitle) return parentTitle
  return [parentTitle, childText].filter(Boolean).join(' ')
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
        selected: selected.indexOf(token) > -1,
        disabled: false
      }
    })
  }))
}

function buildAiReminderTimelineEvents(session, reminders) {
  if (!session || !session._id) return []
  return (Array.isArray(reminders) ? reminders : [])
    .filter(reminder => {
      if (!reminder || reminder.sessionId !== session._id) return false
      const channels = reminder.channels || {}
      return channels.sessionTimeline !== false
    })
    .map((reminder, index) => {
      const payload = reminderCards.buildReminderChatPayload(reminder)
      const card = reminderCards.normalizeReminderCard(Object.assign({}, payload.reminderCard, {
        acknowledged: reminder.status === 'shown' || !!reminder.shownAt
      }), reminder.type)
      if (card && card.advice === card.headline) card.advice = ''
      const eventTime = reminder.createdAt || Date.now()
      return {
        id: 'ai-reminder-' + (reminder._id || index),
        reminderId: reminder._id || '',
        type: 'ai_reminder',
        iconAsset: SESSION_ICON_ASSETS.ai_reminder,
        tone: 'ai-reminder',
        title: reminder.title || 'AI提醒',
        sub: reminder.message || '',
        reminderCard: card,
        eventTime,
        dateKey: getDateGroupKey(eventTime),
        dateLabel: formatChineseDate(eventTime),
        timeDisplay: formatEventTime(eventTime),
        sortMs: getEventSortMs(eventTime),
        sequence: getEventSequence(reminder._id || reminder.createdAt || eventTime, index + 1000),
        amountDisplay: ''
      }
    })
}

function buildTimelineEvents(session, hands, settings, reminders) {
  if (!session) return []
  const unit = settings && settings.chipUnit || ''
  const initialTime = session.startTime || session.date || ''
  const events = [{
    id: 'session-buyin',
    type: 'buyin',
    iconAsset: SESSION_ICON_ASSETS.buyin,
    tone: 'buyin',
    icon: '¥',
    title: '买入',
    sub: [session.venue, getSessionLevel(session), (session.tableSize || 8) + 'max'].filter(Boolean).join(' · '),
    eventTime: initialTime,
    dateKey: getDateGroupKey(initialTime),
    dateLabel: formatChineseDate(initialTime),
    timeDisplay: formatEventTime(initialTime),
    sortMs: getEventSortMs(initialTime),
    sequence: 0,
    amountDisplay: display.formatAmount(Number(session.buyIn) || 0, unit)
  }]

  if (session.endTime || session.status === 'history_edit') {
    const cashOut = Number(session.cashOut) || 0
    const cashOutTime = session.endTime || initialTime
    events.push({
      id: 'session-cashout',
      type: 'cashout',
      iconAsset: SESSION_ICON_ASSETS.buyin,
      tone: 'buyin',
      icon: '￥',
      title: '结算',
      sub: '',
      eventTime: cashOutTime,
      dateKey: getDateGroupKey(cashOutTime),
      dateLabel: formatChineseDate(cashOutTime),
      timeDisplay: formatEventTime(cashOutTime),
      sortMs: getEventSortMs(cashOutTime),
      sequence: 1,
      amountDisplay: cashOut ? display.formatAmount(cashOut, unit) : '',
      amountTone: cashOut >= Number(session.buyIn || 0) ? 'positive' : 'negative'
    })
  }

  ;(hands || []).forEach((hand, index) => {
    const cards = cardUi.parseHeroCardsInput(hand.heroCardsInput)
    const eventTime = resolveHandTimelineTime(hand, initialTime)
    const fullEntry = isFullEntryHand(hand)
    events.push({
      id: hand._id || hand.id || 'hand-' + index,
      type: fullEntry ? 'full' : 'quick',
      iconAsset: fullEntry ? SESSION_ICON_ASSETS.full : SESSION_ICON_ASSETS.quick,
      tone: fullEntry ? 'full' : 'quick',
      icon: '⚡',
      hot: true,
      title: hand.heroPosition || '',
      sub: '',
      tags: [],
      heroCardsVisual: cards,
      eventTime,
      dateKey: getDateGroupKey(eventTime),
      dateLabel: formatChineseDate(eventTime),
      timeDisplay: formatEventTime(eventTime),
      sortMs: getEventSortMs(hand.createdAtMs || hand.createdAt || eventTime),
      sequence: getEventSequence(hand.sequence || hand.createdAtMs || hand.createdAt || hand._id || hand.id, index + 1),
      amountDisplay: display.formatAmount(Number(hand.currentProfit) || 0, unit),
      amountTone: Number(hand.currentProfit) >= 0 ? 'positive' : 'negative'
    })
  })

  ;(session.timelineEvents || []).forEach((event, index) => {
    if (event && event.type === 'stack') return
    const amount = Number(event.amount)
    const eventTime = event.createdAt || initialTime
    const type = event.type || 'note'
    const title = buildTimelineEventTitle(event)
    events.push({
      id: event.id || 'event-' + index,
      type,
      iconAsset: SESSION_ICON_ASSETS[type] || SESSION_ICON_ASSETS.comment,
      tone: type === 'buyin_add' ? 'buyin' : type === 'comment' ? 'comment' : type,
      icon: event.icon || 'C',
      hot: event.hot,
      title,
      sub: '',
      tags: [],
      eventTime,
      dateKey: getDateGroupKey(eventTime),
      dateLabel: formatChineseDate(eventTime),
      timeDisplay: formatEventTime(eventTime),
      sortMs: getEventSortMs(event.createdAtMs || eventTime),
      sequence: getEventSequence(event.sequence || event.createdAtMs || event.id || event.createdAt, index + 1),
      amountDisplay: Number.isFinite(amount) && amount !== 0 ? display.formatAmount(amount, unit) : '',
      amountTone: amount >= 0 ? 'positive' : 'negative'
    })
  })

  buildAiReminderTimelineEvents(session, reminders).forEach(event => {
    events.push(event)
  })

  return events.sort((a, b) => {
    if (b.sortMs !== a.sortMs) return b.sortMs - a.sortMs
    return (Number(b.sequence) || 0) - (Number(a.sequence) || 0)
  })
}

function buildTimelineGroups(session, hands, settings, reminders) {
  const events = buildTimelineEvents(session, hands, settings, reminders)
  const groups = []
  events.forEach(event => {
    let group = groups.find(item => item.key === event.dateKey)
    if (!group) {
      group = {
        key: event.dateKey,
        label: event.dateLabel,
        events: []
      }
      groups.push(group)
    }
    group.events.push(event)
  })
  return groups.map(group => Object.assign({}, group, {
    events: group.events.map((event, index) => Object.assign({}, event, {
      first: index === 0,
      last: index === group.events.length - 1
    }))
  }))
}

function getPositionOptionsForTable(tableSize) {
  const size = Number(tableSize) || 8
  return POSITION_OPTIONS_BY_TABLE[size] || POSITION_OPTIONS
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

function parseSessionTimeMs(value) {
  const text = String(value || '').trim()
  if (!text) return 0
  const parsed = new Date(text.indexOf('T') > -1 ? text : text.replace(' ', 'T'))
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime()
}

function getSessionListBusinessMs(session) {
  const startMs = parseSessionTimeMs(session && session.startTime)
  if (startMs) return startMs
  const dateText = String(session && session.date || '').trim()
  if (dateText) {
    const dateMs = parseSessionTimeMs(dateText + ' 00:00')
    if (dateMs) return dateMs
  }
  return Number(session && (session.createdAt || session.updatedAt)) || 0
}

function getDisplaySessionProfit(session) {
  if (!session || session.status !== 'finished') return 0
  return Number(session.totalProfit) || 0
}

function asList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(item => String(item).trim()).filter(Boolean)
  if (!value) return []
  return [String(value).trim()].filter(Boolean)
}

function getReviewSource(hand) {
  const review = hand && hand.aiReview || {}
  return review.analysis || review.review || review
}

function buildSessionSummaryRequest(session, hands, settings) {
  const reviewedHands = (hands || []).filter(hand => hand && hand.aiReview)
  return {
    mode: 'session_summary',
    message: `${session.title || session.date || 'Session'} 总结`,
    text: `${session.title || session.date || 'Session'} 总结`,
    session,
    hands: reviewedHands.map((hand, index) => ({
      id: hand._id || hand.id || '',
      index: index + 1,
      playedDate: hand.playedDate || '',
      stakeLevel: hand.stakeLevel || '',
      heroPosition: hand.heroPosition || '',
      heroCardsInput: hand.heroCardsInput || '',
      villainPosition: hand.villainPosition || '',
      opponentType: hand.opponentType || hand.villainType || '',
      effectiveStack: Number(hand.effectiveStack) || 0,
      potSize: Number(hand.potSize) || 0,
      currentProfit: Number(hand.currentProfit) || 0,
      board: hand.board || {},
      streetSummary: hand.streetSummary || '',
      tags: hand.tags || [],
      aiReview: hand.aiReview
    })),
    settings: settings || {}
  }
}

function reviewText(hand) {
  const review = getReviewSource(hand)
  return [
    review.answer,
    review.summary,
    review.verdict,
    review.keyTakeaway,
    review.key_takeaway,
    review.humanRule,
    review.human_rule,
    asList(review.goodPoints || review.good_points).join(' '),
    asList(review.issues).join(' '),
    asList(review.clearMistakes || review.clear_mistakes).join(' '),
    asList(review.optimizations).join(' '),
    asList(review.exploitAdjustments || review.exploit_adjustments).join(' '),
    asList(review.trainingPlan || review.training_plan).join(' '),
    asList(review.leakTags || review.leak_tags).join(' ')
  ].filter(Boolean).join(' ')
}

function handLabel(hand, index, settings) {
  const profit = display.formatAmount(Number(hand && hand.currentProfit) || 0, settings && settings.chipUnit || '')
  const cards = hand && hand.heroCardsInput || `Hand ${index + 1}`
  const position = hand && hand.heroPosition ? `${hand.heroPosition} ` : ''
  return `${position}${cards}（${profit}）`
}

function firstUsefulText() {
  const values = Array.prototype.slice.call(arguments)
  for (let index = 0; index < values.length; index += 1) {
    const list = asList(values[index])
    if (list.length) return list[0]
  }
  return ''
}

function containsAny(text, words) {
  const source = String(text || '').toLowerCase()
  return words.some(word => source.indexOf(String(word).toLowerCase()) > -1)
}

function formatHandSummaryLine(hand, index, settings, fallback) {
  const review = getReviewSource(hand)
  const text = firstUsefulText(
    review.keyTakeaway,
    review.key_takeaway,
    review.humanRule,
    review.human_rule,
    review.verdict,
    review.summary,
    review.answer
  )
  return `${handLabel(hand, index, settings)}：${text || fallback || '已有 AI 建议，可作为 session 总结样本'}`
}

function buildLocalSessionSummary(session, hands, settings) {
  const reviewedHands = (hands || []).filter(hand => hand && hand.aiReview)
  const goodHands = []
  const mistakeHands = []
  const optimizationHands = []
  const handSummaries = []
  const trainingPlan = []
  const tendencySignals = []
  let explicitSizingIssueCount = 0
  let passiveLineCount = 0
  let riverCallCount = 0
  let preflopSprCount = 0

  reviewedHands.forEach((hand, index) => {
    const review = getReviewSource(hand)
    const text = reviewText(hand)
    const good = asList(review.goodPoints || review.good_points)
    const clearMistakes = asList(review.clearMistakes || review.clear_mistakes)
    const issues = asList(review.issues)
    const optimizations = asList(review.optimizations || review.exploitAdjustments || review.exploit_adjustments)
    const training = asList(review.trainingPlan || review.training_plan)
    const tags = asList(hand.tags || review.leakTags || review.leak_tags)
    handSummaries.push(formatHandSummaryLine(hand, index, settings, '复查本手的关键决策点和 AI 建议'))

    if (good.length || /精彩|正确|标准|价值|good|nice|read|读对/i.test(text) || tags.indexOf('精彩') > -1) {
      goodHands.push(`${handLabel(hand, index, settings)}：${good[0] || firstUsefulText(review.keyTakeaway, review.verdict, review.summary) || '决策质量较好'}`)
    }
    if (clearMistakes.length || /明显错误|错误|mistake|bad fold/i.test(text) || tags.indexOf('明显错误') > -1) {
      mistakeHands.push(`${handLabel(hand, index, settings)}：${clearMistakes[0] || issues[0] || firstUsefulText(review.verdict, review.keyTakeaway) || '存在明显问题'}`)
    }
    if (optimizations.length || issues.length || /优化|调整|size|尺度|check|控池|thin|可优化/i.test(text) || tags.indexOf('可优化') > -1) {
      optimizationHands.push(`${handLabel(hand, index, settings)}：${optimizations[0] || issues[0] || '有进一步优化空间'}`)
    }
    training.forEach(item => trainingPlan.push(item))

    if (containsAny(text, ['overplay', '打太大', '下注过大', '尺度过大', '过度下注', '满pot', '满 pot'])) explicitSizingIssueCount += 1
    if (containsAny(text, ['被动', 'check-call', 'check call', '跟注三条街', '失去主动', '没有主动'])) passiveLineCount += 1
    if (containsAny(text, ['河牌', 'river']) && containsAny(text, ['跟注过宽', '支付', 'call down', '抓诈'])) riverCallCount += 1
    if (containsAny(text, ['3bet', '4bet', 'spr', '翻前尺度', '压缩spr'])) preflopSprCount += 1
    if (/tilt|上头|情绪|疲劳|深夜|时长/i.test(text)) tendencySignals.push('需要警惕 on tilt、疲劳和 session 时长')
    if (/级别|straddle|盲注|升降级/i.test(text)) tendencySignals.push('级别管理和 straddle 局策略需要单独收紧')
  })

  if (!goodHands.length && reviewedHands.length) {
    goodHands.push(formatHandSummaryLine(reviewedHands[0], 0, settings, '本手已有 AI 建议，可作为正向或基准样本复查'))
  }
  if (!optimizationHands.length && reviewedHands.length) {
    reviewedHands.slice(0, 3).forEach((hand, index) => {
      optimizationHands.push(formatHandSummaryLine(hand, index, settings, '复查本手的关键街道、下注尺度和对手范围'))
    })
  }

  const totalProfit = Number(session && session.totalProfit) || 0
  if (preflopSprCount) tendencySignals.push('翻前尺度和后续SPR管理是本场最值得优先复核的主题')
  if (passiveLineCount) tendencySignals.push('翻后主动权不足是重复信号，尤其要复查湿润面是否该主动下注')
  if (riverCallCount) tendencySignals.push('河牌面对强范围下注时，需要更明确地区分价值跟注和被迫支付')
  if (explicitSizingIssueCount >= 2) tendencySignals.push('至少两手牌明确出现下注尺度偏大的证据，再标记为过度下注倾向')
  if (totalProfit > 0 && goodHands.length >= mistakeHands.length) tendencySignals.push('结果为正，仍需确认盈利来自好决策而不是单纯跑赢')
  if (totalProfit < 0 && mistakeHands.length <= goodHands.length) tendencySignals.push('结果偏差不完全等于决策差，需区分运气和执行质量')

  const uniqueTrainingPlan = Array.from(new Set(trainingPlan)).slice(0, 6)
  const defaultTraining = [
    '复盘所有 turn 继续下注的中等牌力，标记哪些是 value、哪些只是惯性下注。',
    '记录每个 session 的级别和 straddle 状态，避免不同盲注混在同一个心理锚点里。',
    '河牌下注前先写下目标跟注范围，再决定 1/2、2/3 或满 pot 尺度。'
  ]

  return {
    title: `${session && (session.title || session.date) || 'Session'} 总结`,
    overview: `总览：${reviewedHands.length}手已完成 AI 建议，${display.formatAmount(totalProfit, settings && settings.chipUnit || '')}`,
    answer: '',
    counts: {
      good: goodHands.length,
      mistakes: mistakeHands.length,
      optimizations: optimizationHands.length
    },
    goodHands,
    mistakeHands,
    optimizationHands,
    handSummaries,
    tendency: Array.from(new Set(tendencySignals)).join('；') || '本场样本暂不足以贴固定leak标签，先按每手关键决策点复核。',
    recommendations: [
      '优先复盘最大盈利手和最大亏损手，确认结果是否来自正确决策。',
      '把每手 AI 建议里的重复问题合并成一个 session 级别规则。'
    ],
    trainingPlan: uniqueTrainingPlan.length ? uniqueTrainingPlan : defaultTraining,
    oneLiner: goodHands.length >= mistakeHands.length
      ? '一句话总结：本场有可取的决策质量，但仍需要把重复漏洞收紧。'
      : '一句话总结：本场主要价值在于暴露问题，下一场先执行训练计划再放大级别。'
  }
}

function hasSessionSummaryContent(view) {
  if (!view) return false
  return !!(
    view.tendency ||
    view.oneLiner ||
    asList(view.goodHands).length ||
    asList(view.mistakeHands).length ||
    asList(view.optimizationHands).length ||
    asList(view.handSummaries).length ||
    asList(view.recommendations).length ||
    asList(view.trainingPlan).length
  )
}

function isEmptyRemoteSummaryAnswer(text) {
  const source = String(text || '').trim()
  if (!source) return true
  return /没有历史复盘|还没有历史复盘|先保存几手牌|暂无历史|没有足够|信息不足|无法生成|no history|not enough/i.test(source)
}

function isRemoteSessionSummaryUseful(view) {
  if (!view) return false
  const counts = view.counts || {}
  const countTotal = (Number(counts.good) || 0) + (Number(counts.mistakes) || 0) + (Number(counts.optimizations) || 0)
  if (countTotal > 0) return true
  if (asList(view.goodHands).length || asList(view.mistakeHands).length || asList(view.optimizationHands).length) return true
  if (asList(view.handSummaries).length) return true
  if (asList(view.trainingPlan).length || asList(view.recommendations).length) return true
  if (view.tendency || view.oneLiner) return true
  return !!(view.answer && !isEmptyRemoteSummaryAnswer(view.answer))
}

function formatSessionSummaryView(result, session, hands, settings, localFallback) {
  const summary = result && (result.summary || result.analysis || result) || {}
  const counts = summary.counts || {}
  const totalProfit = Number(session && session.totalProfit) || 0
  const chipUnit = settings && settings.chipUnit || ''
  const view = {
    title: `${session && (session.title || session.date) || 'Session'} 总结`,
    overview: summary.overview || `总览：${(hands || []).length}手，${display.formatAmount(totalProfit, chipUnit)}`,
    answer: summary.answer || result && result.answer || '',
    counts: {
      good: Number(counts.good) || asList(summary.goodHands || summary.good_hands).length,
      mistakes: Number(counts.mistakes) || asList(summary.mistakeHands || summary.mistake_hands).length,
      optimizations: Number(counts.optimizations) || asList(summary.optimizationHands || summary.optimization_hands).length
    },
    goodHands: asList(summary.goodHands || summary.good_hands),
    mistakeHands: asList(summary.mistakeHands || summary.mistake_hands),
    optimizationHands: asList(summary.optimizationHands || summary.optimization_hands),
    handSummaries: asList(summary.handSummaries || summary.hand_summaries),
    tendency: summary.tendency || '',
    recommendations: asList(summary.recommendations),
    trainingPlan: asList(summary.trainingPlan || summary.training_plan),
    oneLiner: summary.oneLiner || summary.one_liner || '',
    showAnswer: false
  }
  view.showAnswer = !!(view.answer && !hasSessionSummaryContent(view) && !isEmptyRemoteSummaryAnswer(view.answer))

  if (isRemoteSessionSummaryUseful(view)) return view
  return localFallback || buildLocalSessionSummary(session, hands, settings)
}

Page({
  data: {
    showLaunchAnimation: true,
    sessions: [],
    activeSession: null,
    activeSessionView: null,
    showActiveSessionHome: true,
    activeSessionHands: [],
    historySessionEditMode: false,
    historySessionSaving: false,
    historyDraftHands: [],
    sessionCreateChoiceVisible: false,
    sessionCreateVisible: false,
    createForm: buildCreateForm(),
    settings: {},
    venueOptions: [],
    blindPresetOptions: [],
    tableSizeOptions: [
      { label: '6max', value: '6', active: false },
      { label: '8max', value: '8', active: true },
      { label: '9max', value: '9', active: false }
    ],
    venuePickerIndex: 0,
    blindPickerIndex: 0,
    tableSizePickerIndex: 1,
    sessionActionSheetVisible: false,
    sessionActionTitle: '',
    sessionActionType: '',
    sessionActionDate: '',
    sessionActionTime: '',
    aiReminderEditorVisible: false,
    aiReminderDraft: buildAiReminderDraft({}),
    stackInput: '',
    buyInInput: '',
    buyInQuickOptions: [],
    commentMode: 'mood',
    commentText: '',
    commentOptions: COMMENT_OPTIONS,
    tableChangeBlindPreset: '',
    tableChangeBlindOptions: [],
    tableChangeBlindPickerIndex: 0,
    tableChangeHasStraddle: false,
    tableChangeSummary: '',
    quickEntryVisible: false,
    quickForm: {
      heroCardsInput: '',
      heroPosition: '',
      currentProfit: '',
      notes: '',
      date: '',
      time: ''
    },
    quickEditingHandId: '',
    profitEditorVisible: false,
    profitEditorSign: '+',
    profitEditorDigits: '',
    quickHeroCardsVisual: [],
    quickHeroPickerVisible: false,
    quickHeroPickerDeck: buildHeroPickerDeck(''),
    positionOptions: POSITION_OPTIONS,
    activeTimeline: [],
    activeTimelineGroups: [],
    cashOutVisible: false,
    cashOutInput: '',
    cashOutDate: '',
    cashOutTime: '',
    durationDisplay: '--',
    loading: false,
    agentChatReady: false,
    sessionSummaryVisible: false,
    sessionSummaryLoading: false,
    sessionSummaryError: '',
    sessionSummaryView: null,
    swipedSessionId: '',
    touchStartX: 0,
    touchStartY: 0,
    touchActiveSessionId: '',
    touchMoved: false,
    onboardingGuideVisible: false,
    onboardingGuideStep: null,
    releaseNotesVisible: false,
    releaseNotes: releaseNotes.getCurrentReleaseNotes()
  },

  onLoad() {
    if (!launchAnimation.consumeLaunchAnimation()) {
      this.setData({ showLaunchAnimation: false })
      return
    }
    this.launchAnimationTimer = setTimeout(() => {
      this.launchAnimationTimer = null
      this.setData({ showLaunchAnimation: false })
    }, launchAnimation.getLaunchAnimationDuration())
    this.launchStatsPrefetchTimer = launchPrefetch.scheduleStatsPrefetch(dataService)
  },

  async onShow() {
    tabBar.syncCustomTabBar('/pages/session-list/session-list')
    const isFresh = this.data.sessions.length && Date.now() - Number(this.lastSessionsLoadedAt || 0) < ON_SHOW_FRESH_MS
    if (!isFresh) await this.refreshSessions()
    this.startDurationClock()
    this.consumeOpenCreateSessionHint()
    this.syncOnboardingGuide()
    this.scheduleReleaseNotesCheck()
  },

  onHide() {
    this.clearReleaseNotesCheck()
    this.stopDurationClock()
  },

  onUnload() {
    if (this.launchAnimationTimer) {
      clearTimeout(this.launchAnimationTimer)
      this.launchAnimationTimer = null
    }
    if (this.launchStatsPrefetchTimer) {
      clearTimeout(this.launchStatsPrefetchTimer)
      this.launchStatsPrefetchTimer = null
    }
    this.clearReleaseNotesCheck()
    this.stopDurationClock()
  },

  clearReleaseNotesCheck() {
    if (this.releaseNotesTimer) clearTimeout(this.releaseNotesTimer)
    this.releaseNotesTimer = null
  },

  scheduleReleaseNotesCheck(delay) {
    this.clearReleaseNotesCheck()
    const wait = Number.isFinite(Number(delay))
      ? Number(delay)
      : (this.data.showLaunchAnimation ? launchAnimation.getLaunchAnimationDuration() + 80 : 80)
    this.releaseNotesTimer = setTimeout(() => {
      this.releaseNotesTimer = null
      this.maybeShowReleaseNotes()
    }, Math.max(0, wait))
  },

  maybeShowReleaseNotes() {
    if (this.data.releaseNotesVisible) return true
    const blocked = this.data.showLaunchAnimation ||
      this.data.onboardingGuideVisible ||
      this.data.sessionCreateChoiceVisible ||
      this.data.sessionCreateVisible ||
      this.data.quickEntryVisible ||
      this.data.sessionActionSheetVisible ||
      this.data.cashOutVisible ||
      this.data.sessionSummaryVisible
    if (blocked) {
      this.scheduleReleaseNotesCheck(800)
      return false
    }
    const context = {
      playerId: dataService.getCurrentPlayerId(),
      accountLoggedOut: dataService.isAccountLoggedOut()
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

  acknowledgeReleaseNotes() {
    const result = releaseNotes.acknowledgeReleaseNotes({
      playerId: dataService.getCurrentPlayerId(),
      accountLoggedOut: dataService.isAccountLoggedOut()
    })
    if (!result.ok) {
      wx.showToast({ title: '确认失败，请重试', icon: 'none' })
      return
    }
    this.setData({ releaseNotesVisible: false })
  },

  async refreshSessions() {
    if (this.data.historySessionEditMode && this.data.activeSession && this.data.activeSession._id === HISTORY_DRAFT_ID) {
      this.refreshHistoryDraftView(this.data.activeSession, this.data.historyDraftHands || [], dataService.getAppSettings())
      return
    }
    this.setData({ loading: true })
    try {
      const data = await dataService.getSessionListData()
      const settings = dataService.getAppSettings()
      const sessions = (data.sessions || [])
        .map((item, index) => buildSessionListItem(item, settings, index, this.data.swipedSessionId))
        .sort((a, b) => {
          const aActive = a.status === 'active' ? 1 : 0
          const bActive = b.status === 'active' ? 1 : 0
          if (aActive !== bActive) return bActive - aActive
          return getSessionListBusinessMs(b) - getSessionListBusinessMs(a) || a.__sortIndex - b.__sortIndex
        })
        .map(item => {
          const next = Object.assign({}, item)
          delete next.__sortIndex
          return next
        })
      const activeSession = sessionRules.findActiveSession(sessions)
      const activeSessionView = buildSessionView(activeSession, settings)
      const venueOptions = buildVenuePresetOptions(settings, this.data.createForm.venue || (settings.venues || [])[0])
      const blindPresetOptions = buildBlindPresetOptions(settings, this.data.createForm.blindPreset || settings.lastBlindPreset)
      this.sessionListSource = sessions
      this.lastSessionsLoadedAt = Date.now()
      this.setData({
        sessions: sessions.slice(0, LIST_PAGE_SIZE),
        activeSession,
        activeSessionView,
        activeSessionHands: [],
        loading: false,
        settings,
        venueOptions: buildCreateOptions(venueOptions, this.data.createForm.venue || venueOptions[0]),
        blindPresetOptions: buildCreateOptions(blindPresetOptions, this.data.createForm.blindPreset || blindPresetOptions[0]),
        durationDisplay: activeSessionView ? activeSessionView.durationDisplay : '--'
      })
      await this.refreshActiveTimeline(activeSession, settings)
    } catch (error) {
      console.warn('load session list failed: ' + (error && (error.stack || error.message || error.errMsg) || error))
      this.setData({ sessions: [], loading: false })
      wx.showToast({ title: '本地数据加载失败，已进入空列表', icon: 'none' })
    }
  },

  onReachBottom() {
    const source = Array.isArray(this.sessionListSource) ? this.sessionListSource : []
    const current = this.data.sessions || []
    if (current.length >= source.length) return
    this.setData({ sessions: current.concat(source.slice(current.length, current.length + LIST_PAGE_SIZE)) })
  },

  async refreshActiveTimeline(activeSession, settings) {
    if (this.data.historySessionEditMode && activeSession && activeSession._id === HISTORY_DRAFT_ID) {
      this.refreshHistoryDraftView(activeSession, this.data.historyDraftHands || [], settings)
      return
    }
    if (!activeSession || !activeSession._id) {
      this.setData({ activeSessionHands: [], activeTimeline: [], activeTimelineGroups: [] })
      return
    }
    let session = activeSession
    let hands = []
    if (typeof dataService.getSessionDetailData === 'function') {
      try {
        const detail = await dataService.getSessionDetailData(activeSession._id)
        session = detail && detail.session || activeSession
        hands = detail && detail.hands || []
      } catch (error) {
        console.warn('load active session timeline failed: ' + (error && (error.stack || error.message || error.errMsg) || error))
      }
    }
    let aiReminders = []
    if (typeof dataService.getAiRemindersBySessionId === 'function') {
      try {
        aiReminders = await dataService.getAiRemindersBySessionId(session._id)
      } catch (error) {
        console.warn('load session ai reminders failed: ' + (error && (error.stack || error.message || error.errMsg) || error))
      }
    } else if (typeof dataService.getPendingAiReminders === 'function') {
      try {
        const pending = await dataService.getPendingAiReminders()
        aiReminders = (Array.isArray(pending) ? pending : []).filter(reminder => reminder && reminder.sessionId === session._id)
      } catch (error) {
        console.warn('load active ai reminders failed: ' + (error && (error.stack || error.message || error.errMsg) || error))
      }
    }
    const activeSessionView = buildSessionView(session, settings || dataService.getAppSettings(), null, hands)
    this.setData({
      activeSessionHands: hands,
      activeSession: session,
      activeSessionView,
      durationDisplay: activeSessionView ? activeSessionView.durationDisplay : '--',
      activeTimeline: buildTimelineEvents(session, hands, settings || dataService.getAppSettings(), aiReminders),
      activeTimelineGroups: buildTimelineGroups(session, hands, settings || dataService.getAppSettings(), aiReminders)
    })
  },

  refreshHistoryDraftView(session, hands, settings) {
    const nextSession = Object.assign({}, session || this.data.activeSession || {})
    const nextHands = (hands || this.data.historyDraftHands || []).slice()
    const activeSessionView = buildSessionView(nextSession, settings || dataService.getAppSettings(), null, nextHands)
    this.setData({
      activeSession: nextSession,
      activeSessionHands: nextHands,
      historyDraftHands: nextHands,
      activeSessionView,
      durationDisplay: '历史',
      activeTimeline: buildTimelineEvents(nextSession, nextHands, settings || dataService.getAppSettings()),
      activeTimelineGroups: buildTimelineGroups(nextSession, nextHands, settings || dataService.getAppSettings())
    })
  },

  refreshDurationDisplay() {
    if (!this.data.activeSession) return
    const view = buildSessionView(
      this.data.activeSession,
      dataService.getAppSettings(),
      null,
      this.data.activeSessionHands || []
    )
    this.setData({
      activeSessionView: view,
      durationDisplay: view ? view.durationDisplay : '--'
    })
  },

  startDurationClock() {
    this.stopDurationClock()
    if (!this.data.activeSession || this.data.activeSession.status !== 'active') return
    this.refreshDurationDisplay()
    if (this.data.activeSession.timerPausedAt) return
    const delay = 60000 - (Date.now() % 60000) + 50
    this.durationClockTimeout = setTimeout(() => {
      this.refreshDurationDisplay()
      this.durationClockInterval = setInterval(() => this.refreshDurationDisplay(), 60000)
    }, delay)
  },

  stopDurationClock() {
    if (this.durationClockTimeout) clearTimeout(this.durationClockTimeout)
    if (this.durationClockInterval) clearInterval(this.durationClockInterval)
    this.durationClockTimeout = null
    this.durationClockInterval = null
  },

  consumeOpenCreateSessionHint() {
    let shouldOpen = false
    try {
      shouldOpen = !!wx.getStorageSync(OPEN_CREATE_SESSION_KEY)
      if (shouldOpen) wx.removeStorageSync(OPEN_CREATE_SESSION_KEY)
    } catch (error) {
      shouldOpen = false
    }
    if (!shouldOpen) return
    if (this.data.activeSession) {
      wx.showToast({ title: sessionRules.ACTIVE_SESSION_MESSAGE, icon: 'none' })
      return
    }
    this.goNewSession()
  },

  onReady() {
    setTimeout(() => {
      if (!this.data.agentChatReady) {
        this.setData({ agentChatReady: true })
      }
    }, 240)
  },

  syncOnboardingGuide() {
    if (dataService.refreshOnboardingGuideContext) dataService.refreshOnboardingGuideContext()
    const step = onboardingGuide.getStepForRoute('pages/session-list/session-list')
    this.setData({
      onboardingGuideVisible: !!step,
      onboardingGuideStep: step
    })
    this.ensureOnboardingSessionDemo(step)
  },

  ensureOnboardingSessionDemo(step) {
    const createKeys = ['sessionBuyIn', 'sessionBlind', 'sessionVenue', 'sessionStart']
    const recordKeys = ['recordSession', 'recordFullEntry', 'recordHand', 'recordProfit', 'recordSave']
    if (!step) return
    if (createKeys.indexOf(step.key) > -1) {
      const settings = this.data.settings && Object.keys(this.data.settings).length
        ? this.data.settings
        : dataService.getAppSettings()
      const createForm = buildOnboardingCreateForm(settings)
      const venues = settings.venues || []
      const blindPresets = settings.blindPresets || []
      const tableSizes = this.data.tableSizeOptions
      this.setData({
        sessionCreateVisible: true,
        sessionSummaryVisible: false,
        quickEntryVisible: false,
        sessionActionSheetVisible: false,
        createForm,
        venueOptions: buildCreateOptions(venues.indexOf('澳门') > -1 ? venues : ['澳门'].concat(venues), createForm.venue),
        blindPresetOptions: buildCreateOptions(blindPresets.indexOf('300/600') > -1 ? blindPresets : ['300/600'].concat(blindPresets), createForm.blindPreset),
        tableSizeOptions: tableSizes.map(item => Object.assign({}, item, { active: item.value === createForm.tableSize })),
        venuePickerIndex: Math.max(0, (venues.indexOf('澳门') > -1 ? venues : ['澳门'].concat(venues)).indexOf(createForm.venue)),
        blindPickerIndex: Math.max(0, (blindPresets.indexOf('300/600') > -1 ? blindPresets : ['300/600'].concat(blindPresets)).indexOf(createForm.blindPreset)),
        tableSizePickerIndex: Math.max(0, tableSizes.findIndex(item => item.value === createForm.tableSize))
      })
      this.updateSessionSwipeState('')
      return
    }
    if (recordKeys.indexOf(step.key) > -1) {
      const settings = this.data.settings && Object.keys(this.data.settings).length
        ? this.data.settings
        : dataService.getAppSettings()
      const demoSession = buildOnboardingActiveSession(getOnboardingDemoSession(this.data.sessions))
      const showQuickEntry = step.key !== 'recordSession' && step.key !== 'recordFullEntry'
      this.setData({
        sessionCreateVisible: false,
        sessionSummaryVisible: false,
        sessionActionSheetVisible: false,
        activeSession: demoSession,
        activeSessionView: buildSessionView(demoSession, settings),
        activeSessionHands: [],
        activeTimeline: [],
        activeTimelineGroups: [],
        showActiveSessionHome: true,
        durationDisplay: '00:18',
        quickEntryVisible: showQuickEntry,
        quickForm: {
          heroCardsInput: 'QdQs',
          heroPosition: 'CO',
          currentProfit: '-42000',
          notes: '示例：QdQs 河牌大注跟注，稍后进入复盘补全行动线。'
        },
        quickHeroCardsVisual: cardUi.parseHeroCardsInput('QdQs'),
        quickHeroPickerVisible: false,
        quickHeroPickerDeck: buildHeroPickerDeck('QdQs'),
        profitEditorVisible: false,
        positionOptions: getPositionOptionsForTable(demoSession.tableSize)
      })
      this.updateSessionSwipeState('')
      return
    }
    if (['sessionSummary', 'sessionSummaryOpen', 'sessionDelete'].indexOf(step.key) === -1) {
      this.setData({
        sessionCreateVisible: false,
        quickEntryVisible: false,
        profitEditorVisible: false
      })
      return
    }
    const session = (this.data.sessions || []).find(item => item && item.onboardingDemo) || (this.data.sessions || [])[0]
    if (!session) return
    this.setData({
      sessionCreateVisible: false,
      quickEntryVisible: false,
      profitEditorVisible: false
    })
    if (step.key === 'sessionDelete') {
      this.setData({ sessionSummaryVisible: false })
      this.updateSessionSwipeState(session._id)
      return
    }
    if (step.key === 'sessionSummaryOpen') {
      const settings = dataService.getAppSettings()
      const title = `${session.title || session.date || 'Session'} 总结`
      this.updateSessionSwipeState('')
      this.setData({
        sessionSummaryVisible: true,
        sessionSummaryLoading: false,
        sessionSummaryError: '',
        sessionSummaryView: {
          title,
          overview: '这一场只有一手 QdQs 示例复盘：核心学习点是河牌大注前要先拆价值组合和诈唬组合。',
          counts: { good: 0, mistakes: 1, optimizations: 1 },
          tendency: '面对强线和湿面河牌时，容易把顶暗三条的绝对牌力看得过重。',
          mistakeHands: ['QdQs：转牌同花完成后缺少范围重估，河牌跟注前没有明确组合数。'],
          optimizationHands: ['QdQs：河牌面对 42000 大注时，先列出成花、两对/暗三条、错过听牌，再决定 bluff-catch。'],
          goodHands: [],
          handSummaries: ['QdQs：CO open，翻牌顶暗三条被 check-raise 后跟注，河牌跟注输给 AdJd 同花。'],
          recommendations: ['以后遇到同花完成后的大注，先问“对手价值下注有哪些、诈唬有哪些、我需要赢多少比例”。'],
          trainingPlan: ['练习 5 手河牌大注 bluff-catch 复盘，每手写出价值组合和诈唬组合。'],
          oneLiner: `${settings.chipUnit || 'HKD'} 300/600 示例：先用结构化复盘看清决策点，再决定下一次如何调整。`,
          showAnswer: false,
          answer: ''
        }
      })
      return
    }
    this.setData({ sessionSummaryVisible: false })
    this.updateSessionSwipeState('')
  },

  onOnboardingNext() {
    const result = onboardingGuide.advanceGuide()
    if (result.done) {
      this.syncOnboardingGuide()
      this.scheduleReleaseNotesCheck(120)
      return
    }
    if (!onboardingGuide.navigateToStep(result.step)) this.syncOnboardingGuide()
  },

  onOnboardingSkip() {
    onboardingGuide.dismissGuide()
    this.syncOnboardingGuide()
    this.scheduleReleaseNotesCheck(120)
  },

  goNewSession() {
    if (this.data.activeSession) {
      wx.showToast({ title: sessionRules.ACTIVE_SESSION_MESSAGE, icon: 'none' })
      return
    }
    this.setData({ sessionCreateChoiceVisible: true })
  },

  closeCreateChoice() {
    this.setData({ sessionCreateChoiceVisible: false })
  },

  openLiveSessionCreate() {
    const settings = dataService.getAppSettings()
    const createForm = buildCreateForm(settings)
    const venues = buildVenuePresetOptions(settings, createForm.venue)
    const blindPresets = buildBlindPresetOptions(settings, createForm.blindPreset)
    const tableSizes = this.data.tableSizeOptions
    this.setData({
      sessionCreateChoiceVisible: false,
      sessionCreateVisible: true,
      createForm,
      venueOptions: buildCreateOptions(venues, createForm.venue),
      blindPresetOptions: buildCreateOptions(blindPresets, createForm.blindPreset),
      tableSizeOptions: tableSizes.map(item => Object.assign({}, item, {
        active: item.value === createForm.tableSize
      })),
      venuePickerIndex: Math.max(0, venues.indexOf(createForm.venue)),
      blindPickerIndex: Math.max(0, blindPresets.indexOf(createForm.blindPreset)),
      tableSizePickerIndex: Math.max(0, tableSizes.findIndex(item => item.value === createForm.tableSize))
    })
  },

  startHistorySessionDraft() {
    this.setData({ sessionCreateChoiceVisible: false, sessionCreateVisible: false })
    wx.navigateTo({ url: '/pages/session-detail/session-detail?mode=history&edit=1' })
  },

  closeCreateSession() {
    this.setData({ sessionCreateVisible: false, sessionCreateChoiceVisible: false })
  },

  onCreateInput(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    this.setData({ ['createForm.' + key]: e.detail.value })
  },

  applyHistoryMetaFromCreateForm() {
    if (!this.data.historySessionEditMode) return
    const form = this.data.createForm || {}
    const nextSession = Object.assign({}, this.data.activeSession || {}, {
      venue: form.venue || '',
      blindPreset: form.blindPreset || '',
      smallBlind: Number(form.smallBlind) || 0,
      bigBlind: Number(form.bigBlind) || 0,
      gameType: form.gameType || 'NLHE',
      tableSize: Number(form.tableSize) || 8,
      hasStraddle: !!form.hasStraddle
    })
    this.refreshHistoryDraftView(nextSession, this.data.historyDraftHands || [], this.data.settings)
  },

  pickCreateVenue(e) {
    const index = Number(e.detail.value) || 0
    const option = this.data.venueOptions[index] || this.data.venueOptions[0] || { value: '' }
    const venue = String(option.value || '')
    this.setData({
      'createForm.venue': venue,
      venueOptions: buildCreateOptions(this.data.venueOptions.map(item => item.value), venue),
      venuePickerIndex: index
    }, () => this.applyHistoryMetaFromCreateForm())
  },

  pickCreateBlind(e) {
    const index = Number(e.detail.value) || 0
    const option = this.data.blindPresetOptions[index] || this.data.blindPresetOptions[0] || { value: '' }
    const blindPreset = String(option.value || '')
    const parts = getLevelParts(blindPreset)
    dataService.updateSettings({ lastBlindPreset: blindPreset })
    this.setData({
      'createForm.blindPreset': blindPreset,
      'createForm.smallBlind': parts.smallBlind,
      'createForm.bigBlind': parts.bigBlind,
      blindPresetOptions: buildCreateOptions(this.data.blindPresetOptions.map(item => item.value), blindPreset),
      blindPickerIndex: index
    }, () => this.applyHistoryMetaFromCreateForm())
  },

  pickCreateTableSize(e) {
    const index = Number(e.detail.value) || 0
    const option = this.data.tableSizeOptions[index] || this.data.tableSizeOptions[0] || { value: '8' }
    const tableSize = String(option.value || '8')
    this.setData({
      'createForm.tableSize': tableSize,
      tableSizeOptions: this.data.tableSizeOptions.map(item => Object.assign({}, item, {
        active: item.value === tableSize
      })),
      tableSizePickerIndex: index
    }, () => this.applyHistoryMetaFromCreateForm())
  },

  selectCreateStraddle(e) {
    this.setData({ 'createForm.hasStraddle': String(e.currentTarget.dataset.value || '') === 'true' }, () => this.applyHistoryMetaFromCreateForm())
  },

  openHistoryMetaSheet() {
    if (!this.data.historySessionEditMode) return
    const session = this.data.activeSession || {}
    const settings = dataService.getAppSettings()
    const createForm = {
      venue: session.venue || '',
      blindPreset: getSessionLevel(session),
      smallBlind: String(session.smallBlind || ''),
      bigBlind: String(session.bigBlind || ''),
      gameType: session.gameType || 'NLHE',
      tableSize: String(session.tableSize || '8'),
      hasStraddle: !!session.hasStraddle,
      buyIn: String(session.buyIn || ''),
      notes: session.notes || ''
    }
    const venues = buildVenuePresetOptions(settings, createForm.venue)
    const blindPresets = buildBlindPresetOptions(settings, createForm.blindPreset)
    const tableSizes = this.data.tableSizeOptions
    this.setData({
      sessionCreateVisible: true,
      createForm,
      venueOptions: buildCreateOptions(venues, createForm.venue),
      blindPresetOptions: buildCreateOptions(blindPresets, createForm.blindPreset),
      tableSizeOptions: tableSizes.map(item => Object.assign({}, item, {
        active: item.value === createForm.tableSize
      })),
      venuePickerIndex: Math.max(0, venues.indexOf(createForm.venue)),
      blindPickerIndex: Math.max(0, blindPresets.indexOf(createForm.blindPreset)),
      tableSizePickerIndex: Math.max(0, tableSizes.findIndex(item => item.value === createForm.tableSize))
    })
  },

  async startSessionFromSheet() {
    const form = this.data.createForm || {}
    if (!form.venue || !form.buyIn) {
      wx.showToast({ title: '请先填写场地和买入', icon: 'none' })
      return
    }
    const now = getNowParts()
    if (this.data.historySessionEditMode) {
      const nextSession = Object.assign({}, this.data.activeSession || {}, form, {
        smallBlind: Number(form.smallBlind) || 0,
        bigBlind: Number(form.bigBlind) || 0,
        tableSize: Number(form.tableSize) || 8,
        buyIn: Number(form.buyIn) || 0,
        hasStraddle: !!form.hasStraddle
      })
      this.setData({ sessionCreateVisible: false, showActiveSessionHome: true })
      this.refreshHistoryDraftView(nextSession, this.data.historyDraftHands || [], this.data.settings)
      return
    }
    const payload = Object.assign({}, form, {
      date: now.date,
      startTime: combineDateTime(now.date, now.time),
      endTime: '',
      cashOut: '',
      hasStraddle: !!form.hasStraddle,
      notes: form.notes || ''
    })
    try {
      const session = await dataService.createSession(payload)
      dataService.updateSettings({ lastBlindPreset: payload.blindPreset })
      wx.showToast({ title: '已开始牌局', icon: 'success' })
      this.setData({ sessionCreateVisible: false, showActiveSessionHome: true })
      await this.refreshSessions()
      this.startDurationClock()
      if (session && session._id) this.closeSwipedSessionItem()
    } catch (error) {
      const duplicate = error && error.code === sessionRules.ACTIVE_SESSION_ERROR_CODE
      wx.showToast({
        title: duplicate ? sessionRules.ACTIVE_SESSION_MESSAGE : '创建失败，请稍后重试',
        icon: 'none'
      })
    }
  },

  async toggleActiveSessionTimer() {
    const session = this.data.activeSession
    if (!session || session.status !== 'active') return
    const now = getNowParts()
    const nowText = combineDateTime(now.date, now.time)
    if (session.timerPausedAt) {
      const pauseMinutes = diffMinutes(session.timerPausedAt, nowText)
      const nextStartTime = shiftDateTime(session.startTime, pauseMinutes)
      const startParts = splitDateTime(nextStartTime)
      await dataService.updateSession(session._id, {
        startTime: nextStartTime,
        date: startParts.date,
        timerPausedAt: ''
      })
      wx.showToast({ title: '已继续计时', icon: 'success' })
    } else {
      await dataService.updateSession(session._id, { timerPausedAt: nowText })
      wx.showToast({ title: '已暂停计时', icon: 'success' })
    }
    await this.refreshSessions()
    this.startDurationClock()
  },

  goActiveSessionHandRecord() {
    const session = this.data.activeSession
    if (!session || !session._id) return
    wx.navigateTo({ url: '/pages/hand-ledger-input/hand-ledger-input?sessionId=' + session._id })
  },

  openActiveAiReminderSettings() {
    this.setData({
      aiReminderEditorVisible: true,
      aiReminderDraft: buildAiReminderDraft(this.data.settings || dataService.getAppSettings())
    })
  },

  closeAiReminderEditor() {
    this.setData({
      aiReminderEditorVisible: false,
      aiReminderDraft: buildAiReminderDraft(this.data.settings || dataService.getAppSettings())
    })
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

  async requestAiReminderSubscribeForDraft() {
    if (!this.data.aiReminderDraft.subscribeMessageAvailable) {
      wx.showToast({ title: '微信消息未配置', icon: 'none' })
      return false
    }
    wx.showLoading({ title: '请求微信授权', mask: false })
    let result = null
    try {
      result = await dataService.requestAiReminderSubscribePermission(AI_REMINDER_SUBSCRIBE_TEMPLATE_ID)
    } finally {
      wx.hideLoading()
    }
    if (result && result.accepted) return true
    wx.showToast({ title: '需要允许微信消息', icon: 'none' })
    return false
  },

  async toggleAiReminderRuleSubscribeMessage(e) {
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
      const settings = await dataService.updateSettings({ aiReminders })
      this.setData({
        settings,
        aiReminderEditorVisible: false,
        aiReminderDraft: buildAiReminderDraft(settings)
      })
      wx.showToast({ title: 'AI提醒已保存', icon: 'success' })
      await this.refreshActiveTimeline(this.data.activeSession, settings)
    } catch (error) {
      console.warn('save ai reminder settings failed: ' + (error && (error.stack || error.message || error.errMsg) || error))
      const localSettings = error && error.localSettings
      if (localSettings) {
        this.setData({
          settings: localSettings,
          aiReminderEditorVisible: false,
          aiReminderDraft: buildAiReminderDraft(localSettings)
        })
      }
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
    }
  },

  async acknowledgeSessionReminder(e) {
    const reminderId = e.currentTarget.dataset.id || ''
    if (!reminderId) return
    try {
      await dataService.markAiReminderShown(reminderId)
      await this.refreshActiveTimeline(this.data.activeSession, this.data.settings || dataService.getAppSettings())
    } catch (error) {
      console.warn('acknowledge session reminder failed: ' + (error && (error.stack || error.message || error.errMsg) || error))
      wx.showToast({ title: '操作失败，请重试', icon: 'none' })
    }
  },

  async openActiveAction(e) {
    const type = e.currentTarget.dataset.type || ''
    const session = this.data.activeSession || {}
    if (type === 'quick') {
      this.openQuickEntry()
      return
    }
    if (type === 'full') {
      if (this.data.historySessionEditMode) {
        await this.saveHistorySession({ navigateToFull: true })
        return
      }
      this.goActiveSessionHandRecord()
      return
    }
    const nowParts = getNowParts()
    const titleMap = {
      stack: '筹码',
      buyin: '买入',
      comment: '备注'
    }
    this.setData({
      sessionActionSheetVisible: true,
      sessionActionType: type,
      sessionActionTitle: titleMap[type] || '快捷操作',
      sessionActionDate: nowParts.date,
      sessionActionTime: nowParts.time,
      stackInput: String((Number(session.buyIn) || 0) + (Number(session.currentProfit) || 0)),
      buyInInput: type === 'buyin' ? String((Number(session.bigBlind) || 0) * 100) : '',
      buyInQuickOptions: type === 'buyin' ? buildBuyInOptions(session, this.data.settings) : [],
      commentMode: 'mood',
      commentText: '',
      ...buildTableChangeState(session, this.data.settings),
      cashOutVisible: false
    })
  },

  closeActiveAction() {
    this.setData({
      sessionActionSheetVisible: false,
      sessionActionType: '',
      sessionActionTitle: ''
    })
  },

  openTimelineEventEditor(e) {
    if (!this.data.historySessionEditMode) return
    const id = e.currentTarget.dataset.id || ''
    const session = this.data.activeSession || {}
    if (id === 'session-buyin') {
      const parts = splitDateTime(session.startTime || '')
      this.setData({
        sessionActionSheetVisible: true,
        sessionActionType: 'history_buyin',
        sessionActionTitle: '买入',
        buyInInput: String(Number(session.buyIn) || ''),
        sessionActionDate: parts.date,
        sessionActionTime: parts.time,
        cashOutVisible: false
      })
      return
    }
    if (id === 'session-cashout') {
      const parts = splitDateTime(session.endTime || '')
      this.setData({
        cashOutVisible: true,
        cashOutInput: String(Number(session.cashOut) || ''),
        cashOutDate: parts.date,
        cashOutTime: parts.time
      })
      return
    }
    const hand = (this.data.historyDraftHands || []).find(item => (item._id || item.id) === id)
    if (hand) {
      const now = getNowParts()
      const parts = splitDateTime(hand.playedDate || hand.createdAtMs || hand.createdAt || combineDateTime(now.date, now.time))
      this.setData({
        quickEntryVisible: true,
        quickEditingHandId: hand._id || hand.id || '',
        quickForm: {
          heroCardsInput: hand.heroCardsInput || '',
          heroPosition: hand.heroPosition || '',
          currentProfit: String(Number(hand.currentProfit) || ''),
          notes: hand.notes || hand.mindJourney || '',
          date: parts.date || now.date,
          time: parts.time || now.time
        },
        quickHeroCardsVisual: cardUi.parseHeroCardsInput(hand.heroCardsInput || ''),
        quickHeroPickerVisible: false,
        quickHeroPickerDeck: buildHeroPickerDeck(hand.heroCardsInput || ''),
        profitEditorVisible: false,
        positionOptions: getPositionOptionsForTable(session.tableSize)
      })
    }
  },

  onSessionActionInput(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    this.setData({ [key]: e.detail.value })
  },

  selectBuyInQuick(e) {
    const amount = Number(e.currentTarget.dataset.amount) || 0
    this.setData({
      buyInInput: amount ? String(amount) : '',
      buyInQuickOptions: (this.data.buyInQuickOptions || []).map(item => Object.assign({}, item, {
        active: item.amount === amount
      }))
    })
  },

  async selectCommentMode(e) {
    const mode = e.currentTarget.dataset.mode || 'custom'
    if (mode === 'break') {
      await this.saveCommentText(mode, '休息')
      return
    }
    const patch = { commentMode: mode }
    if (mode === 'table_change') {
      Object.assign(patch, buildTableChangeState(this.data.activeSession, this.data.settings))
    }
    this.setData(patch)
  },

  pickTableChangeBlind(e) {
    const index = Number(e.detail && e.detail.value) || 0
    const options = this.data.tableChangeBlindOptions || []
    const selected = options[index] && options[index].value || options[index] && options[index].label || ''
    this.setData({
      tableChangeBlindPreset: selected,
      tableChangeBlindPickerIndex: index,
      tableChangeSummary: buildTableChangeSummary(selected, this.data.tableChangeHasStraddle, this.data.activeSession)
    })
  },

  selectTableChangeStraddle(e) {
    const hasStraddle = String(e.currentTarget.dataset.value) === 'true'
    this.setData({
      tableChangeHasStraddle: hasStraddle,
      tableChangeSummary: buildTableChangeSummary(this.data.tableChangeBlindPreset, hasStraddle, this.data.activeSession)
    })
  },

  async selectCommentQuick(e) {
    const text = String(e.currentTarget.dataset.text || '')
    const mode = this.data.commentMode || 'mood'
    await this.saveCommentText(mode, text)
  },

  async appendSessionTimelineEvent(event) {
    const session = this.data.activeSession
    if (!session || !session._id) return
    const now = getNowParts()
    const eventTime = combineDateTime(this.data.sessionActionDate || now.date, this.data.sessionActionTime || now.time)
    const nextEvent = Object.assign({
      id: 'event_' + Date.now(),
      createdAtMs: getEventSortMs(eventTime),
      sequence: nextTimelineSequence(),
      createdAt: eventTime
    }, event || {})
    if (this.data.historySessionEditMode) {
      const nextSession = Object.assign({}, session, {
        timelineEvents: (session.timelineEvents || []).concat(nextEvent)
      })
      this.refreshHistoryDraftView(nextSession, this.data.historyDraftHands || [], this.data.settings)
      return
    }
    const timelineEvents = (session.timelineEvents || []).concat(Object.assign({
      id: 'event_' + Date.now(),
      createdAtMs: Date.now(),
      sequence: nextTimelineSequence(),
      createdAt: combineDateTime(now.date, now.time)
    }, event || {}))
    await dataService.updateSession(session._id, { timelineEvents })
  },

  async saveActiveStack() {
    const session = this.data.activeSession
    if (!session || !session._id) return
    const stack = Number(this.data.stackInput)
    if (!Number.isFinite(stack)) {
      wx.showToast({ title: '请填写当前筹码', icon: 'none' })
      return
    }
    const currentProfit = stack - (Number(session.buyIn) || 0)
    const now = getNowParts()
    await dataService.updateSession(session._id, {
      cashOut: stack,
      currentProfit,
      totalProfit: currentProfit,
      timelineEvents: (session.timelineEvents || []).concat({
        id: 'stack_' + Date.now(),
        type: 'stack',
        icon: '▥',
        title: '筹码',
        text: '更新当前筹码',
        amount: stack,
        createdAt: combineDateTime(now.date, now.time)
      })
    })
    wx.showToast({ title: '已更新筹码', icon: 'success' })
    this.closeActiveAction()
    await this.refreshSessions()
  },

  async saveActiveBuyIn() {
    const session = this.data.activeSession
    if (!session || !session._id) return
    const addAmount = Number(this.data.buyInInput)
    if (!Number.isFinite(addAmount) || addAmount <= 0) {
      wx.showToast({ title: '请填写买入金额', icon: 'none' })
      return
    }
    const now = getNowParts()
    const eventTime = combineDateTime(this.data.sessionActionDate || now.date, this.data.sessionActionTime || now.time)
    if (this.data.historySessionEditMode && this.data.sessionActionType === 'history_buyin') {
      const nextSession = Object.assign({}, session, {
        buyIn: addAmount,
        startTime: eventTime,
        date: splitDateTime(eventTime).date
      })
      wx.showToast({ title: '已更新买入', icon: 'success' })
      this.closeActiveAction()
      this.refreshHistoryDraftView(nextSession, this.data.historyDraftHands || [], this.data.settings)
      return
    }
    if (this.data.historySessionEditMode) {
      const timelineEvents = (session.timelineEvents || []).concat({
        id: 'buyin_' + Date.now(),
        type: 'buyin_add',
        icon: '楼',
        title: '追加买入',
        text: '',
        amount: addAmount,
        createdAtMs: getEventSortMs(eventTime),
        sequence: nextTimelineSequence(),
        createdAt: eventTime
      })
      const nextSession = Object.assign({}, session, {
        buyIn: (Number(session.buyIn) || 0) + addAmount,
        timelineEvents
      })
      wx.showToast({ title: '已记录买入', icon: 'success' })
      this.closeActiveAction()
      this.refreshHistoryDraftView(nextSession, this.data.historyDraftHands || [], this.data.settings)
      return
    }
    await dataService.updateSession(session._id, {
      buyIn: (Number(session.buyIn) || 0) + addAmount,
      timelineEvents: (session.timelineEvents || []).concat({
        id: 'buyin_' + Date.now(),
        type: 'buyin_add',
        icon: '¥',
        title: '追加买入',
        text: '',
        amount: addAmount,
        createdAtMs: Date.now(),
        sequence: nextTimelineSequence(),
        createdAt: combineDateTime(now.date, now.time)
      })
    })
    wx.showToast({ title: '已记录买入', icon: 'success' })
    this.closeActiveAction()
    await this.refreshSessions()
  },

  async saveCommentText(mode, textValue) {
    const text = String(textValue || '').trim()
    if (!text) {
      wx.showToast({ title: '请填写备注', icon: 'none' })
      return
    }
    const titleMap = {
      mood: '情绪备注',
      status: '状态备注',
      table_change: '换桌',
      break: '休息',
      custom: '自定义备注'
    }
    await this.appendSessionTimelineEvent({
      type: 'comment',
      icon: 'C',
      title: titleMap[mode] || '备注',
      text,
      tags: [titleMap[mode] || '备注']
    })
    wx.showToast({ title: '已记录备注', icon: 'success' })
    this.closeActiveAction()
    await this.refreshSessions()
  },

  async saveActiveComment() {
    await this.saveCommentText(this.data.commentMode || 'custom', this.data.commentText)
  },

  async saveTableChange() {
    const session = this.data.activeSession
    if (!session || !session._id) return
    const blindPreset = String(this.data.tableChangeBlindPreset || '').trim()
    const parts = getLevelParts(blindPreset)
    if (!parts.smallBlind || !parts.bigBlind) {
      wx.showToast({ title: '请选择级别', icon: 'none' })
      return
    }
    const hasStraddle = !!this.data.tableChangeHasStraddle
    const now = getNowParts()
    const createdAt = combineDateTime(now.date, now.time)
    const previousLevel = getSessionLevel(session)
    const nextLevel = parts.smallBlind + '/' + parts.bigBlind
    const previousStraddle = !!session.hasStraddle
    const timelineEvents = (session.timelineEvents || []).concat({
      id: 'table_change_' + Date.now(),
      type: 'table_change',
      icon: 'T',
      title: '换桌',
      text: nextLevel + ' · Straddle ' + (hasStraddle ? '是' : '否'),
      previousLevel,
      nextLevel,
      previousHasStraddle: previousStraddle,
      hasStraddle,
      smallBlind: parts.smallBlind,
      bigBlind: parts.bigBlind,
      createdAtMs: Date.now(),
      sequence: nextTimelineSequence(),
      createdAt
    })
    await dataService.updateSession(session._id, {
      blindPreset,
      smallBlind: parts.smallBlind,
      bigBlind: parts.bigBlind,
      hasStraddle,
      timelineEvents
    })
    wx.showToast({ title: '已换桌', icon: 'success' })
    this.closeActiveAction()
    await this.refreshSessions()
  },

  openCashOutSheet() {
    const session = this.data.activeSession || {}
    const parts = splitDateTime(session.endTime || combineDateTime(getNowParts().date, getNowParts().time))
    this.setData({
      cashOutVisible: true,
      cashOutInput: String(session.cashOut || session.endingChips || ''),
      cashOutDate: parts.date,
      cashOutTime: parts.time
    })
  },

  closeCashOutSheet() {
    this.setData({ cashOutVisible: false })
  },

  showSessionListFromActive() {
    if (this.data.historySessionEditMode) {
      this.setData({
        historySessionEditMode: false,
        historySessionSaving: false,
        historyDraftHands: [],
        activeSession: null,
        activeSessionView: null,
        activeTimeline: [],
        activeTimelineGroups: [],
        showActiveSessionHome: false
      })
      return
    }
    this.setData({ showActiveSessionHome: false })
  },

  editActiveSession() {
    const session = this.data.activeSession
    if (!session || !session._id) return
    wx.navigateTo({ url: '/pages/session-detail/session-detail?id=' + session._id + '&edit=1' })
  },

  onCashOutInput(e) {
    this.setData({ cashOutInput: e.detail.value })
  },

  async finishActiveSession() {
    const session = this.data.activeSession
    if (!session || !session._id) return
    if (String(this.data.cashOutInput || '').trim() === '') {
      wx.showToast({ title: '请填写带出筹码', icon: 'none' })
      return
    }
    const now = getNowParts()
    const endTime = session.timerPausedAt || combineDateTime(now.date, now.time)
    if (this.data.historySessionEditMode) {
      const cashOut = Number(this.data.cashOutInput)
      const historyEndTime = combineDateTime(this.data.cashOutDate || now.date, this.data.cashOutTime || now.time)
      if (!Number.isFinite(cashOut)) {
        wx.showToast({ title: '请填写结算筹码', icon: 'none' })
        return
      }
      const nextSession = Object.assign({}, session, {
        cashOut,
        endTime: historyEndTime,
        totalProfit: cashOut - (Number(session.buyIn) || 0)
      })
      this.setData({ cashOutVisible: false })
      this.refreshHistoryDraftView(nextSession, this.data.historyDraftHands || [], this.data.settings)
      return
    }
    try {
      await dataService.finishSession(session._id, {
        cashOut: this.data.cashOutInput,
        endTime
      })
      wx.showToast({ title: '本场已结束', icon: 'success' })
      this.setData({ cashOutVisible: false })
      await this.refreshSessions()
    } catch (error) {
      console.warn('finish session failed: ' + (error && (error.stack || error.message || error.errMsg) || error))
      wx.showToast({ title: '结算失败，请稍后重试', icon: 'none' })
    }
  },

  async saveHistorySession(options) {
    const config = options || {}
    const session = this.data.activeSession
    if (!this.data.historySessionEditMode || !session || session._id !== HISTORY_DRAFT_ID) return
    if (this.data.historySessionSaving) return
    const buyIn = Number(session.buyIn) || 0
    const cashOut = Number(session.cashOut)
    if (!buyIn || !Number.isFinite(cashOut)) {
      wx.showToast({ title: '请先填写买入和结算', icon: 'none' })
      return
    }
    this.setData({ historySessionSaving: true })
    const payload = Object.assign({}, session, {
      _id: undefined,
      status: 'finished',
      cashOut,
      endingChips: cashOut,
      totalProfit: cashOut - buyIn,
      handCount: (this.data.historyDraftHands || []).length,
      date: splitDateTime(session.startTime).date,
      timerPausedAt: ''
    })
    try {
      const savedSession = await dataService.createSession(payload)
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
      this.setData({
        historySessionEditMode: false,
        historySessionSaving: false,
        historyDraftHands: [],
        activeSession: null,
        activeSessionView: null,
        showActiveSessionHome: false
      })
      await this.refreshSessions()
      if (config.navigateToFull && savedSession && savedSession._id) {
        wx.navigateTo({ url: '/pages/hand-ledger-input/hand-ledger-input?sessionId=' + savedSession._id })
      }
      return savedSession
    } catch (error) {
      console.warn('save history session failed: ' + (error && (error.stack || error.message || error.errMsg) || error))
      this.setData({ historySessionSaving: false })
      wx.showToast({ title: '保存失败，请稍后重试', icon: 'none' })
    }
  },

  openQuickEntry() {
    const session = this.data.activeSession || {}
    const now = getNowParts()
    this.setData({
      quickEntryVisible: true,
      quickForm: {
        heroCardsInput: '',
        heroPosition: '',
        currentProfit: '',
        notes: '',
        date: now.date,
        time: now.time
      },
      quickEditingHandId: '',
      quickHeroCardsVisual: [],
      quickHeroPickerVisible: false,
      quickHeroPickerDeck: buildHeroPickerDeck(''),
      profitEditorVisible: false,
      profitEditorSign: '+',
      profitEditorDigits: '',
      positionOptions: getPositionOptionsForTable(session.tableSize)
    })
  },

  closeQuickEntry() {
    this.setData({
      quickEntryVisible: false,
      quickHeroPickerVisible: false,
      profitEditorVisible: false,
      quickEditingHandId: ''
    })
  },

  noop() {},

  onQuickInput(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    this.setData({ ['quickForm.' + key]: e.detail.value })
  },

  openQuickProfitEditor() {
    const parsed = parseProfitEditorValue(this.data.quickForm.currentProfit)
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
      'quickForm.currentProfit': nextValue,
      profitEditorVisible: false
    })
  },

  quickSaveFromProfit() {
    const nextValue = buildProfitEditorValue(this.data.profitEditorSign, this.data.profitEditorDigits)
    this.setData({
      'quickForm.currentProfit': nextValue,
      profitEditorVisible: false
    }, () => {
      this.saveQuickEntry()
    })
  },

  selectQuickPosition(e) {
    const position = String(e.currentTarget.dataset.position || '')
    this.setData({ 'quickForm.heroPosition': position })
  },

  openQuickHeroPicker() {
    this.setData({
      quickHeroPickerVisible: true,
      quickHeroPickerDeck: buildHeroPickerDeck(this.data.quickForm.heroCardsInput)
    })
  },

  closeQuickHeroPicker() {
    this.setData({ quickHeroPickerVisible: false })
  },

  pickQuickHeroCard(e) {
    if (e.currentTarget.dataset.disabled) return
    const token = String(e.currentTarget.dataset.token || '')
    if (!token) return
    const selected = cardUi.parseHeroCardsInput(this.data.quickForm.heroCardsInput)
      .slice(0, 2)
      .map(card => card.rank + card.suit)
    const foundIndex = selected.indexOf(token)
    if (foundIndex > -1) {
      selected.splice(foundIndex, 1)
    } else {
      if (selected.length >= 2) selected.shift()
      selected.push(token)
    }
    const normalized = selected.join('')
    this.setData({
      'quickForm.heroCardsInput': normalized,
      quickHeroCardsVisual: cardUi.parseHeroCardsInput(normalized),
      quickHeroPickerDeck: buildHeroPickerDeck(normalized),
      quickHeroPickerVisible: selected.length < 2
    }, () => {
      if (selected.length === 2 && !String(this.data.quickForm.currentProfit || '').trim()) {
        this.openQuickProfitEditor()
      }
    })
  },

  handleQuickHeroPickerTool(e) {
    const action = e.currentTarget.dataset.action || ''
    const selected = cardUi.parseHeroCardsInput(this.data.quickForm.heroCardsInput)
      .slice(0, 2)
      .map(card => card.rank + card.suit)
    if (action === 'backspace') selected.pop()
    if (action === 'clear') selected.splice(0, selected.length)
    const normalized = selected.join('')
    this.setData({
      'quickForm.heroCardsInput': normalized,
      quickHeroCardsVisual: cardUi.parseHeroCardsInput(normalized),
      quickHeroPickerDeck: buildHeroPickerDeck(normalized)
    })
  },

  async saveQuickEntry() {
    const session = this.data.activeSession
    const form = this.data.quickForm || {}
    if (!session || !session._id) return
    if (cardUi.parseHeroCardsInput(form.heroCardsInput).length !== 2) {
      wx.showToast({ title: '请选择两张手牌', icon: 'none' })
      return
    }
    if (String(form.currentProfit || '').trim() === '') {
      wx.showToast({ title: '请填写本手输赢', icon: 'none' })
      return
    }
    const profit = Number(form.currentProfit)
    if (!Number.isFinite(profit)) {
      wx.showToast({ title: '输赢金额不正确', icon: 'none' })
      return
    }
    const now = getNowParts()
    const playedDate = combineDateTime(form.date || now.date, form.time || now.time)
    const createdAtMs = this.data.historySessionEditMode ? getEventSortMs(playedDate) : Date.now()
    const effectiveStack = sessionStack.calculateSessionStackAt(session, this.data.activeSessionHands || [], {
      cutoffMs: createdAtMs
    })
    const payload = {
      sessionId: session._id,
      playedDate,
      createdAtMs,
      sequence: nextTimelineSequence(),
      stakeLevel: getSessionLevel(session),
      heroCardsInput: form.heroCardsInput,
      heroPosition: form.heroPosition || '',
      effectiveStack,
      currentProfit: profit,
      notes: form.notes || '',
      mindJourney: form.notes || '',
      tableSize: session.tableSize || '',
      hasStraddle: !!session.hasStraddle,
      venue: session.venue || ''
    }
    if (this.data.historySessionEditMode) {
      const editingId = this.data.quickEditingHandId
      const currentHands = this.data.historyDraftHands || []
      const nextHands = editingId
        ? currentHands.map(hand => {
          if ((hand._id || hand.id) !== editingId) return hand
          return Object.assign({}, hand, payload, {
            _id: hand._id || editingId,
            status: hand.status || 'quick'
          })
        })
        : [Object.assign({
          _id: 'history_hand_' + Date.now(),
          status: 'quick'
        }, payload)].concat(currentHands)
      const nextSession = Object.assign({}, session, {
        handCount: nextHands.length
      })
      wx.showToast({ title: '已保存速记', icon: 'success' })
      this.closeQuickEntry()
      this.refreshHistoryDraftView(nextSession, nextHands, this.data.settings)
      return
    }
    await dataService.createHand(payload)
    wx.showToast({ title: '已保存速记', icon: 'success' })
    this.closeQuickEntry()
    await this.refreshSessions()
  },

  goSessionDetail(e) {
    const sessionId = e.currentTarget.dataset.id
    if (!sessionId) return
    if (this.data.touchMoved) {
      this.setData({ touchMoved: false })
      return
    }
    if (this.data.swipedSessionId && this.data.swipedSessionId !== sessionId) {
      this.closeSwipedSessionItem()
      return
    }
    const session = (this.data.sessions || []).find(item => item._id === sessionId)
    if (session && session.status === 'active') {
      this.closeSwipedSessionItem()
      this.setData({ showActiveSessionHome: true })
      this.refreshActiveTimeline(session, this.data.settings || dataService.getAppSettings())
      if (wx.pageScrollTo) wx.pageScrollTo({ scrollTop: 0, duration: 120 })
      return
    }
    wx.navigateTo({ url: '/pages/session-detail/session-detail?id=' + sessionId })
  },

  updateSessionSwipeState(sessionId) {
    const sessions = (this.data.sessions || []).map(item => Object.assign({}, item, {
      swiped: item._id === sessionId
    }))
    this.setData({
      sessions,
      swipedSessionId: sessionId || ''
    })
  },

  closeSwipedSessionItem() {
    this.updateSessionSwipeState('')
  },

  onSessionItemTouchStart(e) {
    const touch = e.touches && e.touches[0]
    if (!touch) return
    this.setData({
      touchStartX: touch.clientX,
      touchStartY: touch.clientY,
      touchActiveSessionId: e.currentTarget.dataset.id || '',
      touchMoved: false
    })
  },

  onSessionItemTouchMove(e) {
    const touch = e.touches && e.touches[0]
    if (!touch) return
    const deltaX = touch.clientX - this.data.touchStartX
    const deltaY = touch.clientY - this.data.touchStartY
    if (Math.abs(deltaX) < Math.abs(deltaY) || Math.abs(deltaX) < 12) return
    this.setData({ touchMoved: true })
  },

  onSessionItemTouchEnd(e) {
    const touch = e.changedTouches && e.changedTouches[0]
    const sessionId = e.currentTarget.dataset.id || this.data.touchActiveSessionId
    if (!touch || !sessionId) return
    const deltaX = touch.clientX - this.data.touchStartX
    const deltaY = touch.clientY - this.data.touchStartY
    if (Math.abs(deltaX) > Math.abs(deltaY) && deltaX < -SWIPE_OPEN_DISTANCE) {
      this.updateSessionSwipeState(sessionId)
      this.setData({ touchMoved: true })
      return
    }
    if (Math.abs(deltaX) > Math.abs(deltaY) && deltaX > SWIPE_CLOSE_DISTANCE) {
      this.closeSwipedSessionItem()
      this.setData({ touchMoved: true })
      return
    }
    if (this.data.touchMoved) {
      setTimeout(() => this.setData({ touchMoved: false }), 80)
    }
  },

  editSessionFromList(e) {
    const sessionId = e.currentTarget.dataset.id
    if (!sessionId) return
    this.closeSwipedSessionItem()
    wx.navigateTo({ url: '/pages/session-detail/session-detail?id=' + sessionId + '&edit=1' })
  },

  deleteSessionFromList(e) {
    const sessionId = e.currentTarget.dataset.id
    if (!sessionId) return
    wx.showModal({
      title: '删除 Session',
      content: '删除后，该 Session、该场全部手牌、行动记录及结算记录都会永久删除且无法恢复。是否继续？',
      confirmText: '删除',
      confirmColor: '#dc2626',
      success: async res => {
        if (!res.confirm) return
        try {
          await dataService.deleteSession(sessionId)
          this.closeSwipedSessionItem()
          await this.refreshSessions()
          wx.showToast({ title: '已删除', icon: 'success' })
        } catch (error) {
          console.warn('delete session failed: ' + (error && (error.stack || error.message || error.errMsg) || error))
          const message = String(error && (error.message || error.errMsg) || '')
          const title = message.indexOf('SESSION_NOT_FOUND') > -1
            ? '当前账号无权删除或缓存已过期'
            : '删除失败，请稍后重试'
          wx.showToast({ title, icon: 'none' })
        }
      }
    })
  },

  closeSessionSummary() {
    this.setData({
      sessionSummaryVisible: false,
      sessionSummaryLoading: false,
      sessionSummaryError: '',
      sessionSummaryView: null
    }, () => {
      this.syncOnboardingGuide()
    })
  },

  async openSessionSummary(e) {
    const sessionId = e.currentTarget.dataset.id
    const session = this.data.sessions.find(item => item._id === sessionId)
    if (!session || !session.summaryEligible) return
    const settings = dataService.getAppSettings()
    this.setData({
      sessionSummaryVisible: true,
      sessionSummaryLoading: true,
      sessionSummaryError: '',
      sessionSummaryView: {
        title: `${session.title || session.date || 'Session'} 总结`,
        overview: 'EV脑 正在汇总本场所有已复盘手牌...',
        counts: { good: 0, mistakes: 0, optimizations: 0 },
        goodHands: [],
        mistakeHands: [],
        optimizationHands: [],
        handSummaries: [],
        tendency: '',
        recommendations: [],
        trainingPlan: [],
        oneLiner: '',
        showAnswer: false
      }
    })

    try {
      const detail = await dataService.getSessionDetailData(sessionId)
      const hands = detail.hands || []
      const baseSession = detail.session || session
      const localSummary = buildLocalSessionSummary(baseSession, hands, settings)
      this.setData({ sessionSummaryView: localSummary })

      const result = await Promise.race([
        aiService.summarizeSession(buildSessionSummaryRequest(baseSession, hands, settings)),
        new Promise(resolve => setTimeout(() => resolve({ code: 'SESSION_SUMMARY_TIMEOUT', summary: localSummary }), 12000))
      ])
      if (result.code === 'SESSION_SUMMARY_TIMEOUT') {
        this.setData({ sessionSummaryLoading: false })
        return
      }
      if (result.code && result.code !== 0) {
        throw new Error(result.message || 'Session summary failed')
      }
      this.setData({
        sessionSummaryLoading: false,
        sessionSummaryView: formatSessionSummaryView(result, baseSession, hands, settings, localSummary)
      })
    } catch (error) {
      this.setData({
        sessionSummaryLoading: false,
        sessionSummaryError: error && (error.message || error.errMsg) || 'EV脑 暂时无法生成 Session 总结'
      })
    }
  }
})
