const dataService = require('../../services/data-service')
const aiService = require('../../services/ai-service')
const cardUi = require('../../utils/card-ui')
const tabBar = require('../../utils/tab-bar')
const display = require('../../utils/display')
const reviewTags = require('../../utils/review-tags')
const actionLine = require('../../utils/action-line')
const handDetailFields = require('../../utils/hand-detail-fields')
const handSessionContext = require('../../utils/hand-session-context')
const handReplay = require('../../utils/hand-replay')
const ledgerDerived = require('../../utils/ledger-derived-fields')
const onboardingGuide = require('../../utils/onboarding-guide')
const handExport = require('../../utils/hand-export')

const REVIEW_PENDING_FILTER_KEY = 'pokerReviewPendingFilters'
const REVIEW_PENDING_ENTRY_KEY = 'pokerReviewPendingEntry'
const ONBOARDING_REVIEW_DEMO_HAND = 'QdQs'
const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']
const SUITS = [
  { key: 's', symbol: '\u2660', className: 'spade' },
  { key: 'h', symbol: '\u2665', className: 'heart' },
  { key: 'd', symbol: '\u2666', className: 'diamond' },
  { key: 'c', symbol: '\u2663', className: 'club' }
]
const BOARD_FIELD_META = {
  flop: { label: '\u7ffb\u724c', limit: 3, emptyText: '\u9009\u62e9 3 \u5f20\u516c\u724c' },
  turn: { label: '\u8f6c\u724c', limit: 1, emptyText: '\u9009\u62e9 1 \u5f20\u516c\u724c' },
  river: { label: '\u6cb3\u724c', limit: 1, emptyText: '\u9009\u62e9 1 \u5f20\u516c\u724c' }
}
const DATE_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'last1d', label: '\u6700\u8fd1\u4e00\u5929' },
  { key: 'last7d', label: '\u6700\u8fd1\u4e03\u5929' },
  { key: 'last30d', label: '最近一个月' },
  { key: 'custom', label: '\u81ea\u5b9a\u4e49' }
]
const RESULT_FILTERS = [
  { key: 'all', label: '全部输赢' },
  { key: 'win50', label: '\u8d62 50BB+' },
  { key: 'lose50', label: '\u8f93 50BB+' },
  { key: 'win100', label: '\u8d62 100BB+' },
  { key: 'lose100', label: '\u8f93 100BB+' }
]
const SORT_OPTIONS = [
  { key: 'updatedDesc', label: '\u6700\u65b0\u8bb0\u5f55' },
  { key: 'updatedAsc', label: '\u6700\u65e9\u8bb0\u5f55' },
  { key: 'dateDesc', label: '日期降序' },
  { key: 'dateAsc', label: '日期升序' },
  { key: 'profitDesc', label: '\u8f93\u8d62\u9ad8\u5230\u4f4e' },
  { key: 'profitAsc', label: '\u8f93\u8d62\u4f4e\u5230\u9ad8' },
  { key: 'resultBbDesc', label: 'BB \u9ad8\u5230\u4f4e' },
  { key: 'resultBbAsc', label: 'BB \u4f4e\u5230\u9ad8' },
  { key: 'potDesc', label: '\u5e95\u6c60\u5927\u5230\u5c0f' },
  { key: 'potAsc', label: '\u5e95\u6c60\u5c0f\u5230\u5927' }
]
const SORT_CONTROLS = [
  { field: 'updated', label: '时间', desc: 'updatedDesc', asc: 'updatedAsc' },
  { field: 'profit', label: '输赢', desc: 'profitDesc', asc: 'profitAsc' },
  { field: 'resultBb', label: 'BB\u6570', desc: 'resultBbDesc', asc: 'resultBbAsc' }
]
const SWIPE_OPEN_DISTANCE = 72
const SWIPE_CLOSE_DISTANCE = 24
const REVIEW_PAGE_SIZE = 20
const ON_SHOW_FRESH_MS = 5000
const LOCKED_QUICK_ENTRY_FIELDS = ['heroCardsInput', 'currentProfit']
const SESSION_STATUS_OPTIONS = [
  { key: 'active', label: '\u8fdb\u884c\u4e2d' },
  { key: 'finished', label: '\u5df2\u7ed3\u675f' }
]
const VOICE_PROGRESS_STEPS = [
  '\u63d0\u53d6\u539f\u59cb\u53e3\u8ff0',
  '\u5339\u914d\u724c\u5c40\u5b57\u6bb5',
  '\u6821\u51c6\u884c\u52a8\u7ebf',
  '\u51c6\u5907\u56de\u586b\u7ed3\u679c'
]
const VOICE_PROGRESS_START_PERCENT = 4
const VOICE_PROGRESS_SOFT_CAP = 88
const VOICE_PROGRESS_HARD_CAP = 96
const VOICE_PROGRESS_SOFT_DURATION_MS = 18000
const VOICE_PROGRESS_HARD_DURATION_MS = 45000

function buildVoiceProgressSteps(percent) {
  const current = Number(percent) || 0
  return VOICE_PROGRESS_STEPS.map((label, index) => ({
    label,
    activeClass: current >= index * 25 ? 'active' : ''
  }))
}

function getVoiceProgressPercent(startedAt, now) {
  const started = Number(startedAt) || Number(now) || Date.now()
  const current = Number(now) || Date.now()
  const elapsed = Math.max(0, current - started)
  if (elapsed <= VOICE_PROGRESS_SOFT_DURATION_MS) {
    const range = VOICE_PROGRESS_SOFT_CAP - VOICE_PROGRESS_START_PERCENT
    return Math.min(
      VOICE_PROGRESS_SOFT_CAP,
      Math.round(VOICE_PROGRESS_START_PERCENT + elapsed / VOICE_PROGRESS_SOFT_DURATION_MS * range)
    )
  }
  const slowElapsed = Math.min(
    VOICE_PROGRESS_HARD_DURATION_MS - VOICE_PROGRESS_SOFT_DURATION_MS,
    elapsed - VOICE_PROGRESS_SOFT_DURATION_MS
  )
  const slowRange = VOICE_PROGRESS_HARD_CAP - VOICE_PROGRESS_SOFT_CAP
  return Math.min(
    VOICE_PROGRESS_HARD_CAP,
    Math.round(VOICE_PROGRESS_SOFT_CAP + slowElapsed / (VOICE_PROGRESS_HARD_DURATION_MS - VOICE_PROGRESS_SOFT_DURATION_MS) * slowRange)
  )
}

function hasActiveSession(sessions) {
  return (sessions || []).some(item => item && item.status === 'active')
}

function getDefaultSessionStatus(sessions) {
  return hasActiveSession(sessions) ? 'active' : 'finished'
}

function resolveSessionStatus(options) {
  const config = options || {}
  const sessions = config.sessions || []
  const legacySession = config.legacySessionId
    ? sessions.find(item => item && item._id === config.legacySessionId)
    : null
  const requested = config.requestedStatus || (legacySession && legacySession.status)
  const normalized = requested === 'active' || requested === 'finished'
    ? requested
    : getDefaultSessionStatus(sessions)
  return normalized === 'active' && !hasActiveSession(sessions) ? 'finished' : normalized
}

function buildSessionStatusOptions(status) {
  const normalized = status === 'active' ? 'active' : 'finished'
  return SESSION_STATUS_OPTIONS.map(item => Object.assign({}, item, {
    active: item.key === normalized
  }))
}

function getSessionStatusLabel(status) {
  return status === 'active' ? '进行中牌局' : '已结束牌局'
}

function readPendingFilters() {
  const filters = wx.getStorageSync(REVIEW_PENDING_FILTER_KEY)
  if (filters) {
    wx.removeStorageSync(REVIEW_PENDING_FILTER_KEY)
  }
  return filters || null
}

function buildFilterOptions(options, activeKey) {
  return options.map(item => Object.assign({}, item, {
    active: item.key === activeKey
  }))
}

function buildFilterSummary(filters, sessions) {
  const parts = []
  parts.push(getSessionStatusLabel(filters.sessionStatus))
  const dateLabel = (DATE_FILTERS.find(item => item.key === filters.dateRange) || DATE_FILTERS[0]).label
  const resultLabel = (RESULT_FILTERS.find(item => item.key === filters.resultFilter) || RESULT_FILTERS[0]).label
  const sortLabel = (SORT_OPTIONS.find(item => item.key === filters.sortBy) || SORT_OPTIONS[0]).label
  const tagOption = reviewTags.getReviewTagOptions(filters.tagFilter).find(item => item.active)
  if (dateLabel !== '全部') parts.push(dateLabel)
  if (resultLabel !== '全部输赢') parts.push(resultLabel)
  if (tagOption && tagOption.key !== 'all') parts.push(tagOption.label)
  parts.push(sortLabel)
  return parts.join(' · ')
}

function buildSortControlOptions(sortBy) {
  const current = String(sortBy || 'updatedDesc')
  return SORT_CONTROLS.map(item => {
    const active = current === item.desc || current === item.asc
    return Object.assign({}, item, {
      active,
      arrow: active ? (current === item.asc ? '\u2191' : '\u2193') : ''
    })
  })
}

function buildOpponentDisplayName(hand) {
  const name = String(hand && hand.opponentName || '').trim()
  if (name) return name
  const type = String(hand && (hand.opponentType || hand.villainType) || '').trim()
  if (!type) return ''
  if (/\u9c7c|\u677e\u5f31|\u8ddf\u6ce8\u7ad9|\u8001\u677f|\u5a31\u4e50/i.test(type)) return '\u9c7c'
  if (/常客|reg|REG/i.test(type)) return '常客'
  if (/职业|pro|PRO/i.test(type)) return '职业'
  if (/紧弱/i.test(type)) return '紧弱玩家'
  if (/\u6fc0\u8fdb/i.test(type)) return '\u6fc0\u8fdb\u73a9\u5bb6'
  return type
}

function hasReviewListDetailValue(value) {
  if (value == null) return false
  if (typeof value === 'number') return !Number.isNaN(value) && value !== 0
  return String(value).trim() !== ''
}

function hasReviewListStreetDetails(streetInputs) {
  const current = streetInputs || {}
  return ['preflop', 'flop', 'turn', 'river'].some(function (key) {
    const street = current[key] || {}
    return hasReviewListDetailValue(street.actionLine) || hasReviewListDetailValue(street.pot)
  })
}

function isReviewListQuickOnlyHand(hand) {
  const board = hand && hand.board || {}
  const hasBoard = hasReviewListDetailValue(board.flop) || hasReviewListDetailValue(board.turn) || hasReviewListDetailValue(board.river)
  const hasReviewState = !!(
    hand && (
      hand.detailBackfilled ||
      hand.aiReview ||
      hand.aiReviewStatus ||
      (hand.reviewStatus && hand.reviewStatus !== 'idle')
    )
  )
  const hasDetail = !!(
    hasBoard ||
    hasReviewListStreetDetails(hand && hand.streetInputs) ||
    hasReviewListDetailValue(hand && hand.streetSummary) ||
    hasReviewListDetailValue(hand && hand.effectiveStack) ||
    hasReviewListDetailValue(hand && hand.potSize) ||
    hasReviewListDetailValue(hand && hand.opponentName) ||
    hasReviewListDetailValue(hand && hand.showdown) ||
    hasReviewListDetailValue(hand && hand.heroQuestion) ||
    hasReviewListDetailValue(hand && hand.notes) ||
    (Array.isArray(hand && hand.tags) && hand.tags.length)
  )
  return !hasReviewState && !hasDetail
}

function buildReviewListMetaText(hand, quickOnly) {
  if (quickOnly) return ''
  const source = hand || {}
  const parts = []
  if (hasReviewListDetailValue(source.potSize)) parts.push('底池 ' + source.potSize)
  const opponent = buildOpponentDisplayName(source)
  if (opponent) parts.push(opponent)
  return parts.join(' · ')
}

function normalizeHandComments(hand) {
  const source = Array.isArray(hand && hand.handComments)
    ? hand.handComments
    : (Array.isArray(hand && hand.reviewComments) ? hand.reviewComments : [])
  return source
    .map((item, index) => {
      if (typeof item === 'string') {
        return {
          id: 'legacy_comment_' + index,
          text: item.trim(),
          createdAt: ''
        }
      }
      return {
        id: String(item && item.id || 'comment_' + index),
        text: String(item && item.text || '').trim(),
        createdAt: String(item && item.createdAt || '')
      }
    })
    .filter(item => item.text)
}

function formatHandCommentTime(value) {
  const text = String(value || '').trim()
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}:\d{2})/)
  if (match) return match[2] + '/' + match[3] + ' ' + match[4]
  const parsed = text ? new Date(text) : null
  if (parsed && !Number.isNaN(parsed.getTime())) {
    return String(parsed.getMonth() + 1).padStart(2, '0') + '/' +
      String(parsed.getDate()).padStart(2, '0') + ' ' +
      String(parsed.getHours()).padStart(2, '0') + ':' +
      String(parsed.getMinutes()).padStart(2, '0')
  }
  return ''
}

function buildHandCommentViewItems(comments) {
  return (comments || []).map(item => Object.assign({}, item, {
    timeDisplay: formatHandCommentTime(item.createdAt)
  }))
}

function buildHandCommentTimestamp() {
  const now = new Date()
  return now.getFullYear() + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0') + ' ' +
    String(now.getHours()).padStart(2, '0') + ':' +
    String(now.getMinutes()).padStart(2, '0')
}

function resolveAiReviewStatus(hand, aiReviewView) {
  if (aiReviewView && aiReviewView.visible) return 'ready'
  return String(hand && hand.aiReviewStatus || '').trim()
}

function buildReviewListHandView(item, chipUnit, swipedHandId) {
  item = ledgerDerived.withLedgerDerivedFields(item, { includeEv: false })
  const quickOnly = isReviewListQuickOnlyHand(item)
  const aiReviewView = item.aiReview && buildAiReviewView(item.aiReview, item)
  const isOnboardingReviewDemoHand = item.heroCardsInput === ONBOARDING_REVIEW_DEMO_HAND
  const heroPosition = quickOnly ? '' : String(item.heroPosition || '').trim()
  const actionText = quickOnly ? '' : buildCompactStreetSummary(item)
  const tags = reviewTags.normalizeReviewTags(item.tags)
  const metaText = buildReviewListMetaText(item, quickOnly)
  const replayData = hasCompletedReview(item) ? handReplay.buildReplayView(item) : null
  const handComments = normalizeHandComments(item)
  const completedReview = hasCompletedReview(item) && !quickOnly
  const aiReviewReady = !!(aiReviewView && aiReviewView.visible)
  const aiReviewStatus = resolveAiReviewStatus(item, aiReviewView)
  const aiReviewGenerating = aiReviewStatus === 'generating'
  const aiReviewFailed = aiReviewStatus === 'failed'
  return Object.assign({}, item, {
    aiReviewStatus,
    aiReviewView,
    aiReviewReady,
    aiReviewGenerating,
    aiReviewFailed,
    canRequestAiAdvice: completedReview && !aiReviewReady && !aiReviewGenerating && !aiReviewFailed,
    swiped: item._id === swipedHandId,
    onboardingReviewEntryTargetClass: isOnboardingReviewDemoHand ? 'onboarding-target-review-entry' : '',
    onboardingReviewSwipeTargetClass: isOnboardingReviewDemoHand ? 'onboarding-target-review-swipe-actions' : '',
    onboardingReviewDeleteTargetClass: isOnboardingReviewDemoHand ? 'onboarding-target-review-delete' : '',
    onboardingReviewAiAdviceTargetClass: isOnboardingReviewDemoHand ? 'onboarding-target-review-ai-advice' : '',
    onboardingReviewReplayTargetClass: isOnboardingReviewDemoHand ? 'onboarding-target-review-replay' : '',
    actionLine: actionText,
    showActionLine: !!String(actionText || '').trim(),
    currentProfitDisplay: display.formatAmount(item.currentProfit, chipUnit),
    heroCardsVisual: cardUi.parseHeroCardsInput(item.heroCardsInput),
    heroPosition,
    showHeroPosition: !!heroPosition,
    heroPositionClass: buildPositionClass(heroPosition),
    boardStreetVisual: quickOnly ? [] : cardUi.parseBoardStreets(item.board),
    tags,
    tagItems: tags.map(label => ({ label })),
    opponentDisplayName: quickOnly ? '' : buildOpponentDisplayName(item),
    metaText,
    hasMetaText: !!metaText,
    replayAvailable: !!(replayData && replayData.available),
    replayData,
    handComments,
    handCommentCount: handComments.length,
    hasHandComments: handComments.length > 0,
    canHandComment: completedReview
  })
}

function buildReviewListHandViews(items, chipUnit, swipedHandId) {
  return (items || []).map(item => buildReviewListHandView(item, chipUnit, swipedHandId))
}

function normalizeActiveFilterPatch(patch) {
  const source = patch || {}
  const next = {}
  if (Object.prototype.hasOwnProperty.call(source, 'selectedSessionStatus')) next.sessionStatus = source.selectedSessionStatus
  if (Object.prototype.hasOwnProperty.call(source, 'dateRange')) next.dateRange = source.dateRange
  if (Object.prototype.hasOwnProperty.call(source, 'startDate')) next.startDate = source.startDate
  if (Object.prototype.hasOwnProperty.call(source, 'endDate')) next.endDate = source.endDate
  if (Object.prototype.hasOwnProperty.call(source, 'resultFilter')) next.resultFilter = source.resultFilter
  if (Object.prototype.hasOwnProperty.call(source, 'tagFilter')) next.tagFilter = source.tagFilter
  if (Object.prototype.hasOwnProperty.call(source, 'sortBy')) next.sortBy = source.sortBy
  return next
}

function normalizeDraftFilterPatch(patch) {
  const source = patch || {}
  const next = {}
  if (Object.prototype.hasOwnProperty.call(source, 'draftSessionStatus')) next.sessionStatus = source.draftSessionStatus
  if (Object.prototype.hasOwnProperty.call(source, 'draftDateRange')) next.dateRange = source.draftDateRange
  if (Object.prototype.hasOwnProperty.call(source, 'draftStartDate')) next.startDate = source.draftStartDate
  if (Object.prototype.hasOwnProperty.call(source, 'draftEndDate')) next.endDate = source.draftEndDate
  if (Object.prototype.hasOwnProperty.call(source, 'draftResultFilter')) next.resultFilter = source.draftResultFilter
  if (Object.prototype.hasOwnProperty.call(source, 'draftTagFilter')) next.tagFilter = source.draftTagFilter
  return next
}

function formatActionLine(summary) {
  return actionLine.formatStreetSummary(summary)
}

function buildBoardVisual(board) {
  const keys = ['flop', 'turn', 'river']
  return cardUi.parseBoardStreets(board).map(function (item, index) {
    return Object.assign({ key: keys[index] }, item)
  })
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

function buildSelectorOptions(list, currentValue) {
  return (list || []).map(function (item) {
    const value = String(item || '')
    return {
      label: value,
      value,
      selected: value === String(currentValue || '')
    }
  })
}

function buildVoicePickerForm(parsedVoice) {
  const board = parsedVoice && parsedVoice.board || {}
  const showdown = parsedVoice && (parsedVoice.showdown || parsedVoice.opponentCards || parsedVoice.villainCards) || ''
  return {
    heroCardsInput: parsedVoice && parsedVoice.heroCardsInput || '',
    showdown,
    opponentCards: parsedVoice && parsedVoice.opponentCards || showdown,
    flop: board.flop || '',
    turn: board.turn || '',
    river: board.river || ''
  }
}

function buildVoiceBoardPickerDeck(parsedVoice, activeKey) {
  const form = buildVoicePickerForm(parsedVoice)
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
          token,
          rank,
          suitSymbol: suit.symbol,
          suitClass: suit.className,
          selected: activeSelected.indexOf(token) > -1,
          disabled: occupied.indexOf(token) > -1
        }
      })
    }
  })
}

function buildVoiceHeroPickerDeck(parsedVoice) {
  const form = buildVoicePickerForm(parsedVoice)
  const selected = parseHeroCardsInput(form.heroCardsInput)
    .slice(0, 2)
    .map(function (item) {
      return item[0].toUpperCase() + item[1].toLowerCase()
    })
  const occupied = Object.keys(BOARD_FIELD_META).reduce(function (list, key) {
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
      cards: RANKS.map(function (rank) {
        const token = rank + suit.key
        return {
          token,
          rank,
          suitSymbol: suit.symbol,
          suitClass: suit.className,
          selected: selected.indexOf(token) > -1,
          disabled: occupied.indexOf(token) > -1
        }
      })
    }
  })
}

function buildVoiceShowdownPickerDeck(parsedVoice) {
  const form = buildVoicePickerForm(parsedVoice)
  const selected = parseHeroCardsInput(form.showdown)
    .slice(0, 2)
    .map(function (item) {
      return item[0].toUpperCase() + item[1].toLowerCase()
    })
  const occupied = Object.keys(BOARD_FIELD_META).reduce(function (list, key) {
    const meta = BOARD_FIELD_META[key]
    return list.concat(
      cardUi.parseCardsInput(form[key], meta.limit).map(function (card) {
        return card.rank + card.suit
      })
    )
  }, []).concat(parseHeroCardsInput(form.heroCardsInput))

  return SUITS.map(function (suit) {
    return {
      key: suit.key,
      cards: RANKS.map(function (rank) {
        const token = rank + suit.key
        return {
          token,
          rank,
          suitSymbol: suit.symbol,
          suitClass: suit.className,
          selected: selected.indexOf(token) > -1,
          disabled: occupied.indexOf(token) > -1 && selected.indexOf(token) === -1
        }
      })
    }
  })
}

function buildVoiceBoardPickerPreview(parsedVoice, activeKey) {
  const form = buildVoicePickerForm(parsedVoice)
  const meta = BOARD_FIELD_META[activeKey] || BOARD_FIELD_META.flop
  return cardUi.parseCardsInput(form[activeKey], meta.limit)
}

function buildVoiceBoardPickerHint(parsedVoice, activeKey) {
  const meta = BOARD_FIELD_META[activeKey] || BOARD_FIELD_META.flop
  const count = buildVoiceBoardPickerPreview(parsedVoice, activeKey).length
  return '\u5df2\u9009 ' + count + ' / ' + meta.limit + ' \u5f20'
}

function sanitizeStringArray(list) {
  return (Array.isArray(list) ? list : [])
    .map(item => String(item || '').trim())
    .filter(Boolean)
}

function buildStreetBoardCards(board, key) {
  const current = Object.assign({ flop: '', turn: '', river: '' }, board || {})
  if (key === 'flop') return cardUi.parseCardsInput(current.flop, 3)
  if (key === 'turn') return cardUi.parseCardsInput(current.turn, 1)
  if (key === 'river') return cardUi.parseCardsInput(current.river, 1)
  return []
}

function buildStreetItems(streetInputs, board) {
  const current = streetInputs || {}
  const preflop = current.preflop || {}
  const flop = current.flop || {}
  const turn = current.turn || {}
  const river = current.river || {}
  return [
    { key: 'preflop', label: '翻前', actionLine: preflop.actionLine || '', pot: preflop.pot || '' },
    { key: 'flop', label: '翻牌', actionLine: flop.actionLine || '', pot: flop.pot || '' },
    { key: 'turn', label: '转牌', actionLine: turn.actionLine || '', pot: turn.pot || '' },
    { key: 'river', label: '河牌', actionLine: river.actionLine || '', pot: river.pot || '' }
  ].map(item => {
    const cards = buildStreetBoardCards(board, item.key)
    const boardState = Object.assign({ flop: '', turn: '', river: '' }, board || {})
    const requiredBoardCards = item.key === 'flop' ? 3 : (item.key === 'turn' || item.key === 'river' ? 1 : 0)
    const isBoardComplete = !requiredBoardCards || cards.length === requiredBoardCards
    return Object.assign({}, item, {
      label: actionLine.normalizeStreetName(item.key),
      potField: 'streetInputs.' + item.key + '.pot',
      actionField: 'streetInputs.' + item.key + '.actionLine',
      boardCards: cards,
      hasBoardCards: isBoardComplete && cards.length > 0,
      boardNeedsCompletion: !!requiredBoardCards && cards.length !== requiredBoardCards,
      boardEditText: item.key === 'preflop' ? '' : (cards.length ? '点击修改' : '点击补牌'),
      boardEditClass: !!requiredBoardCards && cards.length !== requiredBoardCards ? 'needs-completion' : '',
      displayActionLine: actionLine.formatActionLine(item.actionLine, item.key) || '-',
      compactStreetLine: actionLine.formatStreetLine(item.key, item.actionLine, boardState[item.key] || '')
    })
  })
}

function buildCompactStreetSummary(hand) {
  const source = hand || {}
  const streetItems = buildStreetItems(source.streetInputs, source.board)
    .filter(item => String(item.actionLine || '').trim())
  if (streetItems.length) {
    return streetItems.map(item => item.compactStreetLine).join(' / ')
  }
  return formatActionLine(source.streetSummary)
}

function formatSignedNumber(value) {
  if (value === '' || value == null) return ''
  const source = String(value).trim()
  if (!source) return ''
  const numeric = Number(source)
  if (Number.isNaN(numeric)) return source
  if (numeric > 0) return '+' + String(numeric)
  return String(numeric)
}

function getReliableSummaryText(parsedVoice, reviewResult) {
  return String(
    (reviewResult && reviewResult.naturalLanguageSummary) ||
    (parsedVoice && parsedVoice.naturalLanguageSummary) ||
    (parsedVoice && parsedVoice.feedbackText) ||
    (parsedVoice && parsedVoice.noteSummary) ||
    ''
  ).trim()
}

function hasLockedQuickEntryValue(value) {
  if (value === '' || value == null) return false
  if (typeof value === 'number') return !Number.isNaN(value)
  return String(value).trim() !== ''
}

function preserveLockedQuickEntryFields(parsedVoice, detailHand) {
  const next = Object.assign({}, parsedVoice || {})
  const current = detailHand || {}
  LOCKED_QUICK_ENTRY_FIELDS.forEach(function (field) {
    if (hasLockedQuickEntryValue(current[field])) {
      next[field] = current[field]
    }
  })
  return next
}

function getDefaultPlayerCount(detailHand, detailSession) {
  return handSessionContext.resolveHandSessionContext(detailHand, detailSession).tableSize
}

function getDefaultHasStraddle(detailHand, detailSession) {
  return handSessionContext.resolveHandSessionContext(detailHand, detailSession).hasStraddle
}

function getDefaultStraddleAmount(detailHand, detailSession) {
  const bigBlind = handDetailFields.getBigBlindFromLevel(
    detailHand && detailHand.stakeLevel,
    detailSession
  )
  return getDefaultHasStraddle(detailHand, detailSession) && bigBlind ? bigBlind * 2 : 0
}

function applySessionVoiceDefaults(parsedVoice, detailHand, detailSession) {
  const next = Object.assign({}, parsedVoice || {})
  if (!Number(next.playerCount)) {
    next.playerCount = getDefaultPlayerCount(detailHand, detailSession)
  }
  if (!Object.prototype.hasOwnProperty.call(next, 'hasStraddle') && getDefaultHasStraddle(detailHand, detailSession)) {
    next.hasStraddle = true
  }
  if (!Number(next.straddleAmount)) {
    const straddleAmount = getDefaultStraddleAmount(detailHand, detailSession)
    if (straddleAmount) next.straddleAmount = straddleAmount
  }
  return next
}

function cleanVoiceShowdownValue(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (/mindJourney|heroQuestion|missingFields|followUpQuestions|naturalLanguageSummary|tags/i.test(text)) {
    return ''
  }
  return text
}

function cleanOpponentCardsValue(value) {
  const text = cleanVoiceShowdownValue(value)
    .replace(/^(?:Villain|Opponent)\s+/i, '')
    .replace(/^(?:\u5bf9\u624b|\u5bf9\u65b9)\s*[:\uff1a]?\s*/i, '')
    .trim()
  return text
}

function getVoiceOpponentCards(source) {
  const data = source || {}
  return (
    resolveOpponentCardsValue(data.opponentCards, data) ||
    resolveOpponentCardsValue(data.villainCards, data) ||
    resolveOpponentCardsValue(data.opponentHand, data) ||
    resolveOpponentCardsValue(data.showdown, data)
  )
}

function cardsToInput(cards) {
  return (cards || []).map(function (card) {
    return card.rank + card.suit
  }).join('')
}

function resolveOpponentCardsValue(value, source) {
  const text = cleanOpponentCardsValue(value)
  if (!text) return ''
  const context = source || {}
  const cards = cardUi.parseOpponentCardsInput(text, {
    board: context.board,
    heroCardsInput: context.heroCardsInput
  })
  return cards.length === 2 ? cardsToInput(cards) : ''
}


const MISSING_FIELD_META = {
  playedDate: { field: 'playedDate', label: '\u65e5\u671f', hint: '\u8bf7\u8865\u5145\u8fd9\u624b\u724c\u7684\u65e5\u671f' },
  stakeLevel: { field: 'stakeLevel', label: '\u7ea7\u522b', hint: '\u8bf7\u9009\u62e9\u76f2\u6ce8\u7ea7\u522b' },
  table_size: { field: 'playerCount', label: '\u4eba\u6570', hint: '\u9ed8\u8ba4 8 \u4eba\uff0c\u5982\u679c\u53e3\u8ff0\u201c\u5269 5 \u4e2a\u4eba\u201d\u5219\u6539\u4e3a 5' },
  tableSize: { field: 'playerCount', label: '\u4eba\u6570', hint: '\u9ed8\u8ba4 8 \u4eba\uff0c\u5982\u679c\u53e3\u8ff0\u201c\u5269 5 \u4e2a\u4eba\u201d\u5219\u6539\u4e3a 5' },
  playerCount: { field: 'playerCount', label: '\u4eba\u6570', hint: '\u9ed8\u8ba4 8 \u4eba\uff0c\u5982\u679c\u53e3\u8ff0\u201c\u5269 5 \u4e2a\u4eba\u201d\u5219\u6539\u4e3a 5' },
  hasStraddle: { field: 'hasStraddle', label: '\u662f\u5426 Straddle', hint: '\u8bf7\u660e\u786e\u9009\u62e9\u201c\u662f\u201d\u6216\u201c\u5426\u201d' },
  heroPosition: { field: 'heroPosition', label: 'Hero \u4f4d\u7f6e', hint: '\u8bf7\u9009\u62e9 Hero \u4f4d\u7f6e' },
  heroCardsInput: { field: 'heroCardsInput', label: 'Hero \u624b\u724c', hint: '\u8bf7\u9009\u62e9 2 \u5f20 Hero \u624b\u724c' },
  effective_stack: { field: 'effectiveStack', label: '\u6709\u6548\u7b79\u7801', hint: '\u5f71\u54cd SPR \u548c\u4e0b\u6ce8\u5c3a\u5ea6\u5224\u65ad' },
  effectiveStack: { field: 'effectiveStack', label: '\u6709\u6548\u7b79\u7801', hint: '\u5f71\u54cd SPR \u548c\u4e0b\u6ce8\u5c3a\u5ea6\u5224\u65ad' },
  pot_size: { field: 'potSize', label: '\u5f53\u524d\u5e95\u6c60', hint: '\u5f71\u54cd\u9010\u8857 pot \u548c\u4e0b\u6ce8\u6bd4\u4f8b\u5224\u65ad' },
  potSize: { field: 'potSize', label: '\u5f53\u524d\u5e95\u6c60', hint: '\u5f71\u54cd\u9010\u8857 pot \u548c\u4e0b\u6ce8\u6bd4\u4f8b\u5224\u65ad' },
  current_profit: { field: 'currentProfit', label: '\u672c\u624b\u8f93\u8d62', hint: '\u7528\u4e8e\u7edf\u8ba1\u548c\u590d\u76d8\u7ed3\u679c' },
  currentProfit: { field: 'currentProfit', label: '\u672c\u624b\u8f93\u8d62', hint: '\u7528\u4e8e\u7edf\u8ba1\u548c\u590d\u76d8\u7ed3\u679c' },
  villain_position: { field: 'villainPosition', label: '\u5bf9\u624b\u4f4d\u7f6e', hint: '\u5f71\u54cd\u8303\u56f4\u5224\u65ad' },
  villainPosition: { field: 'villainPosition', label: '\u5bf9\u624b\u4f4d\u7f6e', hint: '\u5f71\u54cd\u8303\u56f4\u5224\u65ad' },
  opponent_type: { field: 'opponentType', label: '\u5bf9\u624b\u7c7b\u578b', hint: '\u5f71\u54cd exploit \u5efa\u8bae' },
  opponentType: { field: 'opponentType', label: '\u5bf9\u624b\u7c7b\u578b', hint: '\u5f71\u54cd exploit \u5efa\u8bae' },
  opponent_name: { field: 'opponentName', label: '\u5bf9\u624b\u6635\u79f0', hint: '\u65b9\u4fbf\u4ee5\u540e\u8bc6\u522b\u540c\u4e00\u5bf9\u624b' },
  opponentName: { field: 'opponentName', label: '\u5bf9\u624b\u6635\u79f0', hint: '\u65b9\u4fbf\u4ee5\u540e\u8bc6\u522b\u540c\u4e00\u5bf9\u624b' },
  board_flop: { field: 'board.flop', label: '\u7ffb\u724c\u516c\u724c', hint: '\u8bf7\u8865\u9f50 3 \u5f20\u7ffb\u724c\u516c\u724c' },
  board_turn: { field: 'board.turn', label: '\u8f6c\u724c\u516c\u724c', hint: '\u8bf7\u8865\u5145\u8f6c\u724c\u516c\u724c' },
  board_river: { field: 'board.river', label: '\u6cb3\u724c\u516c\u724c', hint: '\u8bf7\u8865\u5145\u6cb3\u724c\u516c\u724c' },
  preflop_pot: { field: 'streetInputs.preflop.pot', label: '\u7ffb\u524d Pot', hint: '\u8bf7\u8865\u5145\u7ffb\u524d\u5e95\u6c60' },
  flop_pot: { field: 'streetInputs.flop.pot', label: '\u7ffb\u724c Pot', hint: '\u8bf7\u8865\u5145\u7ffb\u724c\u5e95\u6c60' },
  turn_pot: { field: 'streetInputs.turn.pot', label: '\u8f6c\u724c Pot', hint: '\u8bf7\u8865\u5145\u8f6c\u724c\u5e95\u6c60' },
  river_pot: { field: 'streetInputs.river.pot', label: '\u6cb3\u724c Pot', hint: '\u8bf7\u8865\u5145\u6cb3\u724c\u5e95\u6c60' },
  preflop_action: { field: 'streetInputs.preflop.actionLine', label: '\u7ffb\u524d\u884c\u52a8', hint: '\u8c01 open\u3001\u8c01 3B\u3001\u8c01\u8ddf\u6ce8' },
  flop_action: { field: 'streetInputs.flop.actionLine', label: '\u7ffb\u724c\u884c\u52a8', hint: '\u4e0b\u6ce8\u3001\u8fc7\u724c\u3001\u8ddf\u6ce8\u3001\u5f03\u724c' },
  turn_action: { field: 'streetInputs.turn.actionLine', label: '\u8f6c\u724c\u884c\u52a8', hint: '\u4e0b\u6ce8\u3001\u52a0\u6ce8\u3001\u8ddf\u6ce8\u3001\u5f03\u724c' },
  river_action: { field: 'streetInputs.river.actionLine', label: '\u6cb3\u724c\u884c\u52a8', hint: '\u4e0b\u6ce8\u3001\u52a0\u6ce8\u3001\u8ddf\u6ce8\u3001\u5f03\u724c' }
}

function normalizeMissingFieldKey(value) {
  const source = String(value || '').trim()
  if (/table[_ ]?size|player[_ ]?count|\u684c\u578b|\u51e0\u4eba\u684c|\u4eba\u684c|\u4eba\u6570/i.test(source)) return 'table_size'
  if (/effective[_ ]?stack|\u6709\u6548\u7b79\u7801|\u6709\u6548\u540e\u624b|\u540e\u624b\u5927\u7ea6|\u540e\u624b/i.test(source)) return 'effective_stack'
  if (/pot[_ ]?size|\u5f53\u524d\u5e95\u6c60|\u5e95\u6c60/i.test(source)) return 'pot_size'
  if (/current[_ ]?profit|\u672c\u624b\u8f93\u8d62|\u8f93\u8d62/i.test(source)) return 'current_profit'
  if (/villain[_ ]?position|\u5bf9\u624b\u4f4d\u7f6e/i.test(source)) return 'villain_position'
  if (/opponent[_ ]?type|\u5bf9\u624b\u7c7b\u578b/i.test(source)) return 'opponent_type'
  if (/opponent[_ ]?name|\u5bf9\u624b\u6635\u79f0|\u5bf9\u624b\u540d\u5b57/i.test(source)) return 'opponent_name'
  if (/preflop|\u7ffb\u524d/i.test(source)) return 'preflop_action'
  if (/flop|\u7ffb\u724c/i.test(source)) return 'flop_action'
  if (/turn|\u8f6c\u724c/i.test(source)) return 'turn_action'
  if (/river|\u6cb3\u724c/i.test(source)) return 'river_action'
  return source
}

function buildMissingFieldItem(value, index) {
  const key = normalizeMissingFieldKey(value)
  const meta = MISSING_FIELD_META[key] || { field: key, label: String(value || '\u9700\u8981\u8865\u5145'), hint: '\u8865\u5145\u540e\u8bc6\u522b\u4f1a\u66f4\u51c6\u786e' }
  return {
    key: String(index) + '-' + key,
    raw: String(value || ''),
    field: meta.field,
    label: meta.label,
    hint: meta.hint,
    text: meta.label + '\u9700\u8981\u8865\u5145'
  }
}
function getParsedVoiceFieldValue(parsedVoice, field) {
  const source = parsedVoice || {}
  const path = String(field || '').split('.').filter(Boolean)
  if (!path.length) return undefined
  return path.reduce((current, key) => {
    if (current == null) return undefined
    return current[key]
  }, source)
}

function isParsedVoiceFieldFilled(parsedVoice, field) {
  if (field === 'hasStraddle') {
    return !!(parsedVoice && Object.prototype.hasOwnProperty.call(parsedVoice, 'hasStraddle'))
  }
  const value = getParsedVoiceFieldValue(parsedVoice, field)
  if (value == null) return false
  if (field === 'heroCardsInput') {
    return cardUi.parseHeroCardsInput(value).length === 2
  }
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return false
    return field === 'currentProfit' || value !== 0
  }
  const text = String(value).trim()
  if (!text) return false
  if (text === '-' || text === '\u8bf7\u9009\u62e9') return false
  if (field === 'currentProfit') return true
  return text !== '0'
}

const VOICE_REQUIRED_MAIN_FIELDS = [
  'playedDate',
  'stakeLevel',
  'playerCount',
  'hasStraddle',
  'heroPosition',
  'villainPosition',
  'heroCardsInput',
  'effectiveStack',
  'potSize',
  'currentProfit'
]

const VOICE_OPTIONAL_FIELDS = {
  opponentType: true,
  opponentName: true,
  showdown: true,
  heroQuestion: true,
  tags: true,
  mindJourney: true,
  streetSummary: true
}

const VOICE_STREET_ORDER = ['preflop', 'flop', 'turn', 'river']

function buildRequiredFieldItem(field, index) {
  const meta = Object.keys(MISSING_FIELD_META).reduce((found, key) => {
    return found || (MISSING_FIELD_META[key].field === field ? MISSING_FIELD_META[key] : null)
  }, null) || { field, label: field, hint: '\u8bf7\u8865\u5145\u8fd9\u4e2a\u5fc5\u586b\u5b57\u6bb5' }
  return {
    key: 'required-' + String(index) + '-' + field.replace(/\W+/g, '-'),
    raw: field,
    field: meta.field,
    label: meta.label,
    hint: meta.hint,
    text: meta.label + '\u9700\u8981\u586b\u5199'
  }
}

function getStreetInput(parsedVoice, street) {
  const streetInputs = parsedVoice && parsedVoice.streetInputs || {}
  return Object.assign({ pot: '', actionLine: '' }, streetInputs[street] || {})
}

function hasStreetData(parsedVoice, street) {
  const input = getStreetInput(parsedVoice, street)
  const board = parsedVoice && parsedVoice.board || {}
  return !!(
    isParsedVoiceFieldFilled(parsedVoice, 'streetInputs.' + street + '.pot') ||
    String(input.actionLine || '').trim() ||
    (street !== 'preflop' && String(board[street] || '').trim())
  )
}

function isTerminalActionLine(actionLine) {
  return /(?:\bfold\b|\bF\b|弃牌|弃了|fold掉|fold了)/i.test(String(actionLine || ''))
}

function isAllInCalloffActionLine(actionLine) {
  const source = String(actionLine || '')
  if (!source.trim()) return false
  const hasAllIn = /(?:\bAI\b|\ball[\s-]*in\b|\ballin\b|\u5168\u4e0b|\u63a8)/i.test(source)
  const hasCall = /(?:\bC\b|\bcall\b|\u8ddf|\u8ddf\u6ce8)/i.test(source)
  return hasAllIn && hasCall
}

function detectAllInCalloffStreet(streetInputs) {
  const source = streetInputs || {}
  return VOICE_STREET_ORDER.find(street => isAllInCalloffActionLine(source[street] && source[street].actionLine)) || ''
}

function getTerminalStreetFromAgent(parsedVoice) {
  const source = parsedVoice || {}
  const value = String(source.terminalStreet || source.allInStreet || '').trim().toLowerCase()
  return VOICE_STREET_ORDER.indexOf(value) > -1 ? value : ''
}

function boardAtAllInStreet(board, street) {
  const source = Object.assign({ flop: '', turn: '', river: '' }, board || {})
  if (street === 'flop') return String(source.flop || '')
  if (street === 'turn') return String(source.flop || '') + String(source.turn || '')
  if (street === 'river') return String(source.flop || '') + String(source.turn || '') + String(source.river || '')
  return ''
}

function inferHeroInvestedForAllIn(hand) {
  const source = hand || {}
  const loss = Number(source.currentProfit)
  if (loss < 0) return Math.abs(loss)
  return Number(source.effectiveStack) || 0
}

function buildVoiceAllInEvInput(hand) {
  const source = hand || {}
  const streetInputs = source.streetInputs || {}
  const allInStreet = getTerminalStreetFromAgent(source) || detectAllInCalloffStreet(streetInputs)
  if (!allInStreet) return null
  const opponentCards = resolveOpponentCardsValue(getVoiceOpponentCards(source), source)
  if (!opponentCards || !String(source.opponentCardsSource || '').trim()) return null
  const heroInvested = inferHeroInvestedForAllIn(source)
  const potSize = Number(source.potSize) || 0
  if (!heroInvested || !potSize) return null
  return {
    isAllIn: true,
    allInStreet,
    heroCardsInput: source.heroCardsInput || '',
    heroCards: source.heroCardsInput || '',
    opponentCards,
    villainCards: opponentCards,
    opponentCardsSource: source.opponentCardsSource || '',
    villainCardsSource: source.opponentCardsSource || '',
    boardAtAllIn: boardAtAllInStreet(source.board, allInStreet),
    allInBoard: boardAtAllInStreet(source.board, allInStreet),
    potSize,
    allInPot: potSize,
    heroInvested,
    currentProfit: Number(source.currentProfit) || 0
  }
}

function getRequiredStreetKeys(parsedVoice) {
  let lastIndex = 0
  const terminalStreet = getTerminalStreetFromAgent(parsedVoice)
  if (terminalStreet) {
    return VOICE_STREET_ORDER.slice(0, VOICE_STREET_ORDER.indexOf(terminalStreet) + 1)
  }
  VOICE_STREET_ORDER.forEach((street, index) => {
    if (hasStreetData(parsedVoice, street)) lastIndex = Math.max(lastIndex, index)
  })
  VOICE_STREET_ORDER.forEach((street, index) => {
    const actionLine = getStreetInput(parsedVoice, street).actionLine
    if (index < lastIndex && (isTerminalActionLine(actionLine) || isAllInCalloffActionLine(actionLine))) {
      lastIndex = Math.min(lastIndex, index)
    }
  })
  return VOICE_STREET_ORDER.slice(0, lastIndex + 1)
}

function getVoiceFieldStreet(field) {
  const value = String(field || '')
  const boardMatch = value.match(/^board\.(flop|turn|river)$/)
  if (boardMatch) return boardMatch[1]
  const streetMatch = value.match(/^streetInputs\.(preflop|flop|turn|river)\./)
  return streetMatch ? streetMatch[1] : ''
}

function isVoiceFieldRequiredForRunout(parsedVoice, field) {
  const street = getVoiceFieldStreet(field)
  if (!street) return true
  return getRequiredStreetKeys(parsedVoice).indexOf(street) > -1
}

function isBoardStreetFilled(parsedVoice, street) {
  const board = parsedVoice && parsedVoice.board || {}
  const limit = street === 'flop' ? 3 : 1
  return cardUi.parseCardsInput(board[street] || '', limit).length === limit
}

function buildVoiceRequiredMissingItems(parsedVoice) {
  const missing = []
  VOICE_REQUIRED_MAIN_FIELDS.forEach(field => {
    if (!isParsedVoiceFieldFilled(parsedVoice, field)) missing.push(field)
  })
  getRequiredStreetKeys(parsedVoice).forEach(street => {
    if (!isParsedVoiceFieldFilled(parsedVoice, 'streetInputs.' + street + '.pot')) {
      missing.push('streetInputs.' + street + '.pot')
    }
    if (!isParsedVoiceFieldFilled(parsedVoice, 'streetInputs.' + street + '.actionLine')) {
      missing.push('streetInputs.' + street + '.actionLine')
    }
    if (street !== 'preflop' && !isBoardStreetFilled(parsedVoice, street)) {
      missing.push('board.' + street)
    }
  })
  const seen = {}
  return missing
    .filter(field => {
      if (seen[field]) return false
      seen[field] = true
      return true
    })
    .map(buildRequiredFieldItem)
}

function applyParsedVoiceFocusState(parsedVoice, focusField) {
  if (!parsedVoice) return parsedVoice
  const target = String(focusField || '')
  return Object.assign({}, parsedVoice, {
    focusPlayedDate: target === 'playedDate',
    focusPlayerCount: target === 'playerCount',
    focusEffectiveStack: target === 'effectiveStack',
    focusPotSize: target === 'potSize',
    focusCurrentProfit: target === 'currentProfit',
    focusOpponentName: target === 'opponentName',
    focusHeroQuestion: target === 'heroQuestion',
    streetItems: (parsedVoice.streetItems || []).map(item => Object.assign({}, item, {
      potFocused: target === item.potField,
      actionFocused: target === item.actionField
    }))
  })
}

function buildConfirmItems(missingFields, followUpQuestions, voiceNeedsRefresh, parsedVoice) {
  const items = []
  if (voiceNeedsRefresh) {
    items.push({ field: 'voiceNote', label: '\u539f\u59cb\u53e3\u8ff0\u5df2\u4fee\u6539', hint: '\u8bf7\u91cd\u65b0\u89e3\u6790\u540e\u518d\u786e\u8ba4\u56de\u586b', text: '\u539f\u59cb\u53e3\u8ff0\u5df2\u4fee\u6539\uff0c\u8bf7\u91cd\u65b0\u89e3\u6790' })
  }
  sanitizeStringArray(missingFields).forEach(field => {
    items.push(field)
  })
  sanitizeStringArray(followUpQuestions).forEach(question => {
    items.push(question)
  })
  const seen = {}
  return items
    .map((item, index) => typeof item === 'string' ? buildMissingFieldItem(item, index) : Object.assign({ key: String(index) }, item))
    .filter(item => {
      const key = item.field || item.text
      if (VOICE_OPTIONAL_FIELDS[item.field]) return false
      if (!isVoiceFieldRequiredForRunout(parsedVoice, item.field)) return false
      if (item.field !== 'voiceNote' && isParsedVoiceFieldFilled(parsedVoice, item.field)) return false
      if (seen[key]) return false
      seen[key] = true
      return true
    })
}

function buildVoiceCorrectionText(correction, confirmItems) {
  const text = String(correction || '').trim()
  if (!text) return ''
  const editableItems = (confirmItems || []).filter(item => item && item.field && item.field !== 'voiceNote')
  if (editableItems.length === 1 && !/[:：]/.test(text)) {
    return editableItems[0].label + ': ' + text
  }
  return text
}

function collectReviewTextParts(value, parts) {
  const output = parts || []
  if (value == null) return output
  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value).trim()
    if (text && !looksLikeTagTaxonomyLeak(text)) output.push(text)
    return output
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectReviewTextParts(item, output))
    return output
  }
  if (typeof value === 'object') {
    Object.keys(value).forEach(key => {
      if (key === 'raw' || key === 'debug' || key === 'structuredHand') return
      collectReviewTextParts(value[key], output)
    })
  }
  return output
}

function looksLikeTagTaxonomyLeak(value) {
  const text = String(value || '')
  if (!text) return false
  if (/fixed\s+miniapp\s+taxonomy|For\s+tags,\s*choose\s+only|Do\s+not\s+return\s+internal\s+snake_case\s+leak\s+tags/i.test(text)) return true
  const labels = ['精彩', '可优化', '明显错误', 'Hero Call', 'Overfold', 'Bad Fold', '价值下注', '诈唬', '多人池', '深筹码', '3Bet池', '4Bet池']
  const count = labels.reduce((sum, label) => sum + (text.indexOf(label) > -1 ? 1 : 0), 0)
  return count >= 6 && /tags?|标签|taxonomy|分类|候选|固定/.test(text)
}

function inferReviewTagsFromReview(parsedVoice, aiReview) {
  const source = parsedVoice || {}
  const streetInputs = source.streetInputs || {}
  const text = collectReviewTextParts([
    source.tags,
    source.streetSummary,
    source.mindJourney,
    source.showdown,
    source.opponentType,
    source.villainType,
    streetInputs,
    aiReview
  ]).join(' ')
  const tags = []

  if (/clear[_\s-]?mistake|mistake|bad[_\s-]?play|error|明显|重大|错误|不应该|自相矛盾/i.test(text)) tags.push('mistake')
  if (/optimi[sz]e|issue|problem|建议|优化|可优化|应该|需要|替代/i.test(text)) tags.push('optimization')
  if (/good|great|nice[_\s-]?hand|打得好|精彩/i.test(text)) tags.push('good')
  if (/\bhero_call\b|bluff[_\s-]?catch|call[_\s-]?down|Hero.{0,12}(?:抓诈|抓鸡|接诈)|(?:抓诈|抓鸡|接诈).{0,12}Hero/i.test(text)) tags.push('hero_call')
  if (/over[_\s-]?fold|river[_\s-]?overfold|过度弃牌|弃太多|fold太多/i.test(text)) tags.push('overfold')
  if (/bad[_\s-]?fold|错误弃牌|弃错|fold错/i.test(text)) tags.push('bad_fold')
  if (/value[_\s-]?bet|thin[_\s-]?value|价值下注|薄价值|打价值/i.test(text)) tags.push('value_bet')
  if (/semi[_\s-]?bluff|bluff|诈唬|半诈唬|偷池|偷鸡/i.test(text)) tags.push('bluff')
  if (/multi[_\s-]?way|多人池|多人底池|三人池|四人池|3人池|4人池/i.test(text)) tags.push('multiway')
  if (/deep[_\s-]?stack|deepstack|200bb|深筹|深筹码/i.test(text)) tags.push('deep_stack')
  if (/3\s*b|3bet|3-bet|three[_\s-]?bet|三bet|三贝/i.test(text)) tags.push('3bet_pot')
  if (/4\s*b|4bet|4-bet|four[_\s-]?bet|四bet|四贝/i.test(text)) tags.push('4bet_pot')

  const effectiveStack = Number(source.effectiveStack) || 0
  const stake = String(source.stakeLevel || '')
  const blindMatch = stake.match(/(\d+)\s*\/\s*(\d+)/)
  const bigBlind = blindMatch ? Number(blindMatch[2]) : 0
  if (effectiveStack && bigBlind && effectiveStack / bigBlind >= 150) tags.push('deep_stack')

  return reviewTags.normalizeReviewTags(tags)
}

function buildParsedVoicePreview(parsedVoice, reviewResult) {
  if (!parsedVoice) return null
  const meta = reviewResult || {}
  const sourceVoice = parsedVoice || {}
  const board = Object.assign({ flop: '', turn: '', river: '' }, sourceVoice.board || {})
  const streetInputs = Object.assign(
    {
      preflop: { actionLine: '', pot: '' },
      flop: { actionLine: '', pot: '' },
      turn: { actionLine: '', pot: '' },
      river: { actionLine: '', pot: '' }
    },
    sourceVoice.streetInputs || {}
  )
  const rawOpponentCards = getVoiceOpponentCards(sourceVoice)
  const opponentCards = resolveOpponentCardsValue(rawOpponentCards, sourceVoice)
  const previewSource = Object.assign({}, sourceVoice, {
    board,
    streetInputs,
    opponentCards,
    showdown: opponentCards
  })
  const detailView = handDetailFields.buildHandDetailViewModel(previewSource, {
    mode: 'confirm',
    backfilled: true,
    positions: dataService.getAppSettings().positions || []
  })
  const provider = String(meta.provider || sourceVoice.provider || '').trim()
  const tags = reviewTags.normalizeReviewTags(sourceVoice.tags).slice(0, 3)
  const hasStraddleSelected = Object.prototype.hasOwnProperty.call(sourceVoice, 'hasStraddle')
  const missingFields = sanitizeStringArray(
    sourceVoice.missingFields || meta.missingFields
  )
  const followUpQuestions = sanitizeStringArray(
    sourceVoice.followUpQuestions || meta.followUpQuestions
  )
  const feedbackText = String(
    meta.naturalLanguageSummary ||
    sourceVoice.naturalLanguageSummary ||
    sourceVoice.noteSummary ||
    sourceVoice.mindJourney ||
    ''
  ).trim()
  return Object.assign({}, sourceVoice, {
    board,
    streetSummary: provider === 'poker-agent'
      ? buildCompactStreetSummary(previewSource)
      : buildCompactStreetSummary(previewSource),
    streetInputs,
    tags,
    tagsText: tags.join(' · '),
    tagItems: tags.map(label => ({ label })),
    opponentTypeText: sourceVoice.opponentType || '',
    villainPositionText: sourceVoice.villainPosition || '',
    hasStraddle: detailView.form.hasStraddle,
    hasStraddleSelected,
    straddleYesClass: hasStraddleSelected && detailView.form.hasStraddle ? 'active' : '',
    straddleNoClass: hasStraddleSelected && !detailView.form.hasStraddle ? 'active' : '',
    heroQuestion: detailView.form.heroQuestion,
    opponentName: detailView.form.opponentName,
    opponentCards,
    opponentCardsSource: sourceVoice.opponentCardsSource || '',
    showdown: opponentCards,
    detailRows: detailView.rows,
    missingFields,
    missingFieldsText: buildConfirmItems(missingFields, [], false, parsedVoice).map(item => item.label).join(' · '),
    followUpQuestions,
    confirmItems: buildConfirmItems(
      missingFields,
      followUpQuestions,
      !!sourceVoice.voiceNeedsRefresh,
      sourceVoice
    ),
    feedbackText,
    aiReview: meta.analysis || parsedVoice.aiReview || null,
    providerText: provider
      ? (provider === 'openai' ? 'OpenAI' : provider === 'kimi' ? 'Kimi' : provider === 'local' ? '本地兜底' : provider)
      : '本地兜底',
    confidenceText: missingFields.length ? '\u9700\u8981\u8865\u5145' : '\u53ef\u56de\u586b',
    playerCountDisplayText: Number(sourceVoice.playerCount) > 0 ? String(Number(sourceVoice.playerCount)) : '',
    currentProfitDisplayText: formatSignedNumber(sourceVoice.currentProfit),
    heroCardsVisual: cardUi.parseHeroCardsInput(sourceVoice.heroCardsInput),
    showdownText: opponentCards,
    showdownCardsVisual: cardUi.parseOpponentCardsInput(opponentCards, {
      board,
      heroCardsInput: sourceVoice.heroCardsInput
    }),
    boardVisual: buildBoardVisual(board),
    streetItems: buildStreetItems(streetInputs, board)
  })
}

function buildOnboardingParsedVoicePreview(hand, session) {
  const parsed = Object.assign({}, hand || {}, {
    provider: 'onboarding_demo',
    playedDate: (hand && hand.playedDate) || (session && session.date) || '2026-06-29',
    stakeLevel: (hand && hand.stakeLevel) || '300/600',
    playerCount: 8,
    hasStraddle: false,
    heroPosition: 'CO',
    villainPosition: 'SB',
    opponentType: '紧凶',
    heroCardsInput: ONBOARDING_REVIEW_DEMO_HAND,
    currentProfit: -42000,
    effectiveStack: 300000,
    potSize: 96000,
    board: {
      flop: 'Qd7d3c',
      turn: '8d',
      river: '2s'
    },
    opponentCards: 'AdJd',
    opponentCardsSource: 'voice',
    showdown: 'AdJd',
    streetInputs: {
      preflop: { pot: 3900, actionLine: 'Hero CO open 1500，SB call，BB fold' },
      flop: { pot: 14600, actionLine: 'Qd7d3c，SB check，Hero bet 2500，SB raise 7800，Hero call' },
      turn: { pot: 29200, actionLine: '8d，SB check，Hero check back' },
      river: { pot: 96000, actionLine: '2s，SB bet 42000，Hero call' }
    },
    tags: ['River 决策', '可优化'],
    mindJourney: '河牌觉得对手可能有错过的听牌，但忽略了转牌同花已经完成。',
    naturalLanguageSummary: '已从 QdQs 口述中识别出位置、手牌、牌面、底池、摊牌和本手亏损 -42000。',
    missingFields: [],
    followUpQuestions: []
  })
  return buildParsedVoicePreview(parsed, {
    provider: 'onboarding_demo',
    naturalLanguageSummary: parsed.naturalLanguageSummary,
    missingFields: [],
    followUpQuestions: []
  })
}

function isBlankVoiceValue(value) {
  return value === undefined || value === null || String(value).trim() === ''
}

function mergeBlankStreetInputs(primary, fallback) {
  const result = Object.assign(
    {
      preflop: { actionLine: '', pot: '' },
      flop: { actionLine: '', pot: '' },
      turn: { actionLine: '', pot: '' },
      river: { actionLine: '', pot: '' }
    },
    primary || {}
  )
  const backup = fallback || {}
  ;['preflop', 'flop', 'turn', 'river'].forEach(key => {
    const current = Object.assign({ actionLine: '', pot: '' }, result[key] || {})
    const local = Object.assign({ actionLine: '', pot: '' }, backup[key] || {})
    result[key] = {
      actionLine: isBlankVoiceValue(current.actionLine) ? local.actionLine : current.actionLine,
      pot: isBlankVoiceValue(current.pot) ? local.pot : current.pot
    }
  })
  return result
}

function normalizeParsedVoice(parsedVoice, reviewResult, voiceNote, detailHand, detailSession) {
  const provider = String((reviewResult && reviewResult.provider) || (parsedVoice && parsedVoice.provider) || '').trim()
  if (provider === 'poker-agent') {
    const rawOpponentCards = getVoiceOpponentCards(parsedVoice)
    const opponentCards = resolveOpponentCardsValue(rawOpponentCards, parsedVoice)
    const extracted = Object.assign({}, parsedVoice || {}, {
      missingFields: (reviewResult && reviewResult.missingFields) || [],
      followUpQuestions: (reviewResult && reviewResult.followUpQuestions) || [],
      naturalLanguageSummary: getReliableSummaryText(parsedVoice, reviewResult),
      aiReview: (reviewResult && reviewResult.analysis) || (parsedVoice && parsedVoice.aiReview) || null,
      opponentCards,
      opponentCardsSource: (parsedVoice && parsedVoice.opponentCardsSource) || '',
      showdown: opponentCards,
      tags: reviewTags.normalizeReviewTags(parsedVoice && parsedVoice.tags).slice(0, 3)
    })
    return applySessionVoiceDefaults(preserveLockedQuickEntryFields(extracted, detailHand), detailHand, detailSession)
  }
  const extracted = Object.assign(
    {},
    parsedVoice || {},
    {
      missingFields: (reviewResult && reviewResult.missingFields) || (parsedVoice && parsedVoice.missingFields) || [],
      followUpQuestions: (reviewResult && reviewResult.followUpQuestions) || (parsedVoice && parsedVoice.followUpQuestions) || [],
      naturalLanguageSummary: (reviewResult && reviewResult.naturalLanguageSummary) || (parsedVoice && (parsedVoice.naturalLanguageSummary || parsedVoice.feedbackText || parsedVoice.noteSummary)) || '',
      aiReview: reviewResult && reviewResult.analysis || parsedVoice && parsedVoice.aiReview || null
    }
  )
  extracted.opponentCards = resolveOpponentCardsValue(getVoiceOpponentCards(extracted), extracted)
  extracted.opponentCardsSource = extracted.opponentCardsSource || ''
  extracted.showdown = extracted.opponentCards
  extracted.tags = reviewTags.normalizeReviewTags(extracted.tags).slice(0, 3)
  return applySessionVoiceDefaults(preserveLockedQuickEntryFields(extracted, detailHand), detailHand, detailSession)
}

function buildStoredVoiceExtract(parsedVoice) {
  if (!parsedVoice) return null
  return {
    playerCount: Number(parsedVoice.playerCount) || 0,
    hasStraddle: !!parsedVoice.hasStraddle,
    playedDate: parsedVoice.playedDate || '',
    stakeLevel: parsedVoice.stakeLevel || '',
    heroPosition: parsedVoice.heroPosition || '',
    heroCardsInput: parsedVoice.heroCardsInput || '',
    effectiveStack: Number(parsedVoice.effectiveStack) || 0,
    potSize: Number(parsedVoice.potSize) || 0,
    currentProfit: Number(parsedVoice.currentProfit) || 0,
    opponentType: parsedVoice.opponentType || '',
    villainPosition: parsedVoice.villainPosition || '',
    opponentName: parsedVoice.opponentName || '',
    heroQuestion: parsedVoice.heroQuestion || '',
    board: Object.assign({ flop: '', turn: '', river: '' }, parsedVoice.board || {}),
    streetInputs: Object.assign(
      {
        preflop: { actionLine: '', pot: '' },
        flop: { actionLine: '', pot: '' },
        turn: { actionLine: '', pot: '' },
        river: { actionLine: '', pot: '' }
      },
      parsedVoice.streetInputs || {}
    ),
    streetSummary: parsedVoice.streetSummary || '',
    opponentCards: resolveOpponentCardsValue(getVoiceOpponentCards(parsedVoice), parsedVoice),
    opponentCardsSource: parsedVoice.opponentCardsSource || '',
    showdown: resolveOpponentCardsValue(getVoiceOpponentCards(parsedVoice), parsedVoice),
    mindJourney: parsedVoice.mindJourney || '',
    tags: reviewTags.normalizeReviewTags(parsedVoice.tags).slice(0, 3),
    missingFields: sanitizeStringArray(parsedVoice.missingFields),
    followUpQuestions: sanitizeStringArray(parsedVoice.followUpQuestions),
    terminalStreet: parsedVoice.terminalStreet || '',
    allInStreet: parsedVoice.allInStreet || '',
    naturalLanguageSummary: parsedVoice.feedbackText || parsedVoice.naturalLanguageSummary || '',
    aiReview: parsedVoice.aiReview || null,
    provider: parsedVoice.providerText || parsedVoice.provider || ''
  }
}

function hasUsefulVoiceFields(parsedVoice) {
  const parsed = parsedVoice || {}
  const board = parsed.board || {}
  return !!(
    parsed.playedDate ||
    parsed.stakeLevel ||
    parsed.heroPosition ||
    parsed.heroCardsInput ||
    parsed.effectiveStack ||
    parsed.potSize ||
    parsed.currentProfit ||
    parsed.opponentType ||
    parsed.opponentName ||
    board.flop ||
    board.turn ||
    board.river ||
    parsed.streetSummary ||
    parsed.mindJourney
  )
}

function buildReviewRequest(detailHand, detailSession, detailActions, voiceNote, options) {
  detailHand = ledgerDerived.withLedgerDerivedFields(detailHand)
  const recordedContext = handSessionContext.resolveHandSessionContext(detailHand, detailSession)
  const settings = dataService.getAppSettings()
  const profile = dataService.getCurrentProfile ? dataService.getCurrentProfile() : {}
  const config = options || {}
  const mode = config.mode || 'extract'
  const hasStraddle = getDefaultHasStraddle(detailHand, detailSession)
  const straddleAmount = getDefaultStraddleAmount(detailHand, detailSession)
  const handContext = {
    _id: (detailHand && detailHand._id) || '',
    playerCount: getDefaultPlayerCount(detailHand, detailSession),
    playedDate: (detailHand && detailHand.playedDate) || '',
    stakeLevel: recordedContext.stakeLevel,
    hasStraddle,
    straddleAmount,
    heroPosition: (detailHand && detailHand.heroPosition) || '',
    heroCardsInput: (detailHand && detailHand.heroCardsInput) || '',
    effectiveStack: 0,
    potSize: 0,
    currentProfit: (detailHand && detailHand.currentProfit) || 0,
    opponentType: '',
    opponentName: '',
    villainPosition: '',
    villainType: '',
    board: { flop: '', turn: '', river: '' },
    streetInputs: {},
    streetSummary: '',
    notes: (detailHand && detailHand.notes) || '',
    heroQuestion: (detailHand && detailHand.heroQuestion) || '',
    showdown: '',
    isAllIn: false,
    allInStreet: '',
    terminalStreet: '',
    handEndedStreet: '',
    postAllInRunoutOnly: false,
    analysisFocus: '',
    allInPot: 0,
    heroInvested: 0,
    rawAllInPot: 0,
    rawHeroInvested: 0,
    heroEquityPct: '',
    allInEv: '',
    allInEvStatus: '',
    allInEvSource: '',
    analysisInstruction: '',
    voiceNote: (detailHand && detailHand.voiceNote) || ''
  }
  if (mode !== 'extract') {
    Object.assign(handContext, {
      effectiveStack: (detailHand && detailHand.effectiveStack) || 0,
      potSize: (detailHand && detailHand.potSize) || 0,
      opponentType: (detailHand && detailHand.opponentType) || '',
      opponentName: (detailHand && detailHand.opponentName) || '',
      villainPosition: (detailHand && detailHand.villainPosition) || '',
      villainType: (detailHand && (detailHand.villainType || detailHand.opponentType)) || '',
      board: (detailHand && detailHand.board) || { flop: '', turn: '', river: '' },
      streetInputs: (detailHand && detailHand.streetInputs) || {},
      streetSummary: (detailHand && detailHand.streetSummary) || '',
      showdown: (detailHand && detailHand.showdown) || '',
      isAllIn: !!(detailHand && detailHand.isAllIn),
      allInStreet: (detailHand && detailHand.allInStreet) || '',
      terminalStreet: (detailHand && detailHand.terminalStreet) || '',
      handEndedStreet: (detailHand && detailHand.handEndedStreet) || '',
      postAllInRunoutOnly: !!(detailHand && detailHand.postAllInRunoutOnly),
      analysisFocus: (detailHand && detailHand.analysisFocus) || '',
      allInPot: (detailHand && detailHand.allInPot) || 0,
      heroInvested: (detailHand && detailHand.heroInvested) || 0,
      rawAllInPot: (detailHand && detailHand.rawAllInPot) || 0,
      rawHeroInvested: (detailHand && detailHand.rawHeroInvested) || 0,
      heroEquityPct: (detailHand && detailHand.heroEquityPct) || '',
      allInEv: (detailHand && detailHand.allInEv) || '',
      allInEvStatus: (detailHand && detailHand.allInEvStatus) || '',
      allInEvSource: (detailHand && detailHand.allInEvSource) || ''
    })
    if (handContext.isAllIn && handContext.allInStreet && handContext.allInStreet !== 'river') {
      handContext.analysisInstruction = '本手牌在 ' + handContext.allInStreet + ' 已经全下并终止后续决策；只分析全下前和全下决策本身，不要输出 flop/turn/river 后续行动建议。'
    }
  }
  return {
    mode,
    transcript: voiceNote,
    userId: (profile && profile.playerId) || '',
    playerId: (profile && profile.playerId) || '',
    userTerms: settings.voiceTerms || [],
    corrections: config.corrections || null,
    hand: handContext,
    session: detailSession
      ? {
          title: detailSession.title || '',
          playerCount: Number(detailSession.playerCount) || 0,
          date: detailSession.date || String(detailSession.startTime || '').split(' ')[0] || '',
          venue: detailSession.venue || '',
          smallBlind: detailSession.smallBlind || 0,
          bigBlind: detailSession.bigBlind || 0,
          tableSize: Number(detailSession.tableSize) || Number(detailSession.playerCount) || 0,
          hasStraddle: !!detailSession.hasStraddle,
          straddleAmount: detailSession.hasStraddle ? straddleAmount : 0
        }
      : null,
    actions: (detailActions || []).map(item => ({
      street: item.street,
      actorLabel: item.actorLabel,
      actionType: item.actionType,
      amount: item.amount,
      potAfter: item.potAfter
    }))
  }
}

function buildAgentCorrectionPayload(detailHand, parsedVoice, voiceNote) {
  return {
    source: 'miniapp_voice_review_confirm',
    transcript: voiceNote || '',
    originalHand: detailHand || null,
    confirmedHand: parsedVoice || null,
    confirmedAt: Date.now()
  }
}

function buildParsedVoiceCorrectionNote(parsedVoice) {
  const source = parsedVoice || {}
  const parts = []
  const add = function (label, value) {
    if (value === undefined || value === null) return
    const text = typeof value === 'string' ? value.trim() : String(value)
    if (!text) return
    parts.push(label + ':' + text)
  }
  add('日期', source.playedDate)
  add('级别', source.stakeLevel)
  add('人数', source.playerCount)
  if (Object.prototype.hasOwnProperty.call(source, 'hasStraddle')) {
    parts.push('Straddle:' + (source.hasStraddle ? '是' : '否'))
  }
  add('Hero位置', source.heroPosition)
  add('对手位置', source.villainPosition)
  add('Hero手牌', source.heroCardsInput)
  add('当前底池', source.potSize)
  add('本手输赢', source.currentProfit)
  add('对手类型', source.opponentType)
  add('对手昵称', source.opponentName)
  add('对手手牌', source.showdown || source.opponentCards)
  const board = source.board || {}
  add('翻牌', board.flop)
  add('转牌', board.turn)
  add('河牌', board.river)
  const streets = source.streetInputs || {}
  ;['preflop', 'flop', 'turn', 'river'].forEach(function (street) {
    const item = streets[street] || {}
    add(street + '底池', item.pot)
    add(street + '行动', item.actionLine)
  })
  return parts.length ? '用户已确认/补填字段：' + parts.join('；') : ''
}

function appendVoiceCorrectionNote(voiceNote, correctionNote) {
  const base = String(voiceNote || '').trim()
  const correction = String(correctionNote || '').trim()
  if (!correction) return base
  return base ? base + '\n' + correction : correction
}

function buildVoicePatch(detailHand, parsedVoice, voiceNote) {
  const current = detailHand || {}
  const lockedParsedVoice = preserveLockedQuickEntryFields(Object.assign({}, parsedVoice, {
    opponentCards: resolveOpponentCardsValue(getVoiceOpponentCards(parsedVoice), parsedVoice),
    opponentCardsSource: (parsedVoice && parsedVoice.opponentCardsSource) || '',
    showdown: resolveOpponentCardsValue(getVoiceOpponentCards(parsedVoice), parsedVoice)
  }), detailHand)
  const opponentCards = resolveOpponentCardsValue(getVoiceOpponentCards(lockedParsedVoice), lockedParsedVoice)
  const parsedBoard = lockedParsedVoice.board || {}
  const currentBoard = current.board || {}
  const baseNotes = stripAutoVoiceReviewNotes(current.notes)
  const parsedTags = reviewTags.normalizeReviewTags(lockedParsedVoice.tags).slice(0, 3)
  const tags = parsedTags.length
    ? parsedTags
    : reviewTags.normalizeReviewTags(current.tags).slice(0, 3)
  const streetInputs = mergeBlankStreetInputs(lockedParsedVoice.streetInputs, current.streetInputs)
  const hasParsedStraddle = Object.prototype.hasOwnProperty.call(lockedParsedVoice, 'hasStraddle')

  return {
    playerCount: Number(lockedParsedVoice.playerCount) || current.playerCount || 0,
    hasStraddle: hasParsedStraddle ? !!lockedParsedVoice.hasStraddle : !!current.hasStraddle,
    playedDate: lockedParsedVoice.playedDate || current.playedDate,
    stakeLevel: lockedParsedVoice.stakeLevel || current.stakeLevel,
    heroPosition: lockedParsedVoice.heroPosition || current.heroPosition,
    heroCardsInput: lockedParsedVoice.heroCardsInput || current.heroCardsInput,
    effectiveStack: Number(lockedParsedVoice.effectiveStack) || current.effectiveStack,
    potSize: Number(lockedParsedVoice.potSize) || current.potSize,
    currentProfit:
      lockedParsedVoice.currentProfit === '' || lockedParsedVoice.currentProfit == null
        ? current.currentProfit
        : (Number(lockedParsedVoice.currentProfit) || 0),
    opponentType: lockedParsedVoice.opponentType || current.opponentType,
    opponentName: lockedParsedVoice.opponentName || current.opponentName || '',
    heroQuestion: lockedParsedVoice.heroQuestion || current.heroQuestion || '',
    villainType: lockedParsedVoice.opponentType || current.villainType || current.opponentType,
    villainPosition: lockedParsedVoice.villainPosition || current.villainPosition || '',
    board: {
      flop: parsedBoard.flop || currentBoard.flop || '',
      turn: parsedBoard.turn || currentBoard.turn || '',
      river: parsedBoard.river || currentBoard.river || ''
    },
    streetInputs,
    streetSummary: lockedParsedVoice.streetSummary || current.streetSummary || '',
    opponentCards,
    opponentCardsSource: lockedParsedVoice.opponentCardsSource || current.opponentCardsSource || '',
    showdown: opponentCards,
    tags,
    mindJourney: lockedParsedVoice.mindJourney || current.mindJourney || '',
    voiceNote: voiceNote || current.voiceNote || '',
    voiceExtract: buildStoredVoiceExtract(lockedParsedVoice),
    aiReview: null,
    aiReviewStatus: 'generating',
    reviewStatus: 'extracted',
    detailBackfilled: true,
    notes: baseNotes || ''
  }
}

function extractAllInEvPatch(result) {
  const data = result && (result.data || result.raw && result.raw.data || result)
  if (!data || data.allInEvStatus !== 'calculated') return null
  return {
    allInEv: Number(data.allInEv) || 0,
    allInEvStatus: data.allInEvStatus || '',
    allInEvEligible: data.allInEvEligible === true,
    allInEvSource: data.allInEvSource || '',
    allInEvFormula: data.allInEvFormula || '',
    allInEvLuckDelta: Number(data.allInEvLuckDelta) || 0,
    heroEquityPct: Number(data.heroEquityPct) || 0
  }
}

async function maybeAttachVoiceAllInEv(voicePatch, detailSession) {
  const input = buildVoiceAllInEvInput(voicePatch)
  if (!input) return voicePatch
  try {
    const result = await aiService.calculateAllInEv(input, {
      session: detailSession || {},
      hand: input
    })
    const evPatch = extractAllInEvPatch(result)
    return evPatch ? Object.assign({}, voicePatch, evPatch) : voicePatch
  } catch (error) {
    console.warn('all-in EV calculation failed: ' + (error && (error.errMsg || error.message) || String(error)))
    return voicePatch
  }
}

function setParsedVoiceDraftField(parsedVoice, field, value) {
  const next = Object.assign({}, parsedVoice || {})
  const path = String(field || '').split('.').filter(Boolean)
  if (!path.length) return next
  if (path.length === 1) {
    next[path[0]] = value
    return next
  }
  if (path[0] === 'board') {
    next.board = Object.assign({ flop: '', turn: '', river: '' }, next.board || {})
    next.board[path[1]] = value
    return next
  }
  if (path[0] === 'streetInputs') {
    const street = path[1]
    const key = path[2]
    next.streetInputs = Object.assign({}, next.streetInputs || {})
    next.streetInputs[street] = Object.assign(
      { actionLine: '', pot: '' },
      next.streetInputs[street] || {}
    )
    next.streetInputs[street][key] = value
    return next
  }
  return next
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

function getBigBlindFromStakeLevel(value) {
  const match = String(value || '').trim().match(/^(\d+)\s*\/\s*(\d+)$/)
  return match ? Number(match[2]) || 0 : 0
}

function buildResultBbDisplay(hand) {
  const bigBlind = getBigBlindFromStakeLevel(hand && hand.stakeLevel)
  const profit = Number(hand && hand.currentProfit)
  if (!bigBlind || Number.isNaN(profit)) return '-'
  const bb = Math.round((profit / bigBlind) * 10) / 10
  const text = Number.isInteger(bb) ? String(bb) : bb.toFixed(1)
  return (bb > 0 ? '+' : '') + text + ' BB'
}

function isInternalAgentLine(line) {
  return /(?:spot_id|file=|range_gap|Imported from|local user-provided|range_not_found|UTG vs None|incomplete_hand_info|deep_stack_preflop)/i.test(String(line || ''))
}

function isLowValueAgentAdviceLine(line) {
  const text = String(line || '').trim()
  return /(?:structured hand information loaded|range_not_found|incomplete_hand_info|spot_id|file=|range_gap)/i.test(text)
}

function formatCardCodesInAdvice(value) {
  const suitMap = {
    s: '\u2660',
    h: '\u2665',
    d: '\u2666',
    c: '\u2663'
  }
  return String(value || '').replace(/\b(?:[2-9TJQKA][shdc]){1,5}\b/ig, function (match) {
    return match.replace(/([2-9TJQKA])([shdc])/ig, function (_, rank, suit) {
      return String(rank || '').toUpperCase() + suitMap[String(suit || '').toLowerCase()]
    })
  })
}

function cleanAgentAdviceText(value) {
  return formatCardCodesInAdvice(value)
    .split(/\r?\n/)
    .map(function (line) { return line.trim() })
    .filter(function (line) { return line && !isInternalAgentLine(line) && !isLowValueAgentAdviceLine(line) })
    .join('\n')
    .trim()
}

function sanitizeAgentAdviceList(list) {
  return sanitizeStringArray(Array.isArray(list) ? list : [])
    .map(cleanAgentAdviceText)
    .filter(Boolean)
}

function sanitizeAgentAdviceTags(list) {
  return sanitizeStringArray(Array.isArray(list) ? list : [])
    .filter(function (tag) { return !isInternalAgentLine(tag) })
}

function buildAgentStreetStatusClass(status) {
  const text = String(status || '').trim().toLowerCase()
  if (!text) return ''
  if (/明显错误|重大错误|错误|mistake|error|bad/.test(text)) return 'danger'
  if (/可优化|建议优化|优化|偏大|偏小|需调整|adjust|optimi[sz]e|improve/.test(text)) return 'warn'
  if (/标准|正确|合理|好|无争议|没问题|standard|correct|good|ok/.test(text)) return 'good'
  return 'neutral'
}

function buildAgentStreetBadge(statusClass) {
  if (statusClass === 'danger') return { text: '错误', className: 'error' }
  if (statusClass === 'warn') return { text: '优化', className: 'optimize' }
  return { text: '', className: '' }
}

function getAdviceHighlightTypeForStreetBadge(className) {
  if (className === 'error') return 'danger'
  if (className === 'optimize') return 'warn'
  return ''
}

function sanitizeAgentStreetBreakdown(list) {
  return (Array.isArray(list) ? list : [])
    .map(function (item, index) {
      if (typeof item === 'string') {
        const text = cleanAgentAdviceText(item)
        return text ? { key: String(index), street: '', status: '', points: [text] } : null
      }
      const source = item || {}
      const street = cleanAgentAdviceText(source.street || source.name || source.title || '')
      const status = cleanAgentAdviceText(source.status || source.verdict || '')
      const points = sanitizeAgentAdviceList(source.points || source.bullets || source.advice || source.items)
      const text = cleanAgentAdviceText(source.text || source.summary || '')
      const nextPoints = points.length ? points : (text ? [text] : [])
      if (!street && !status && !nextPoints.length) return null
      const statusClass = buildAgentStreetStatusClass(status)
      const badge = buildAgentStreetBadge(statusClass)
      const highlightType = getAdviceHighlightTypeForStreetBadge(badge.className)
      return {
        key: String(index),
        street,
        streetLabel: String(street || '').trim().toUpperCase(),
        streetDisplay: String(street || '').trim().toUpperCase() || street,
        status,
        statusClass,
        displayStatusText: badge.text,
        displayStatusClass: badge.className,
        rowClass: badge.className ? 'is-' + badge.className : '',
        hasDisplayStatus: !!badge.text,
        points: nextPoints,
        pointItems: nextPoints.map(function (point, pointIndex) {
          return {
            key: String(pointIndex),
            text: point,
            segments: buildAdviceHighlightSegments(point, highlightType)
          }
        })
      }
    })
    .filter(Boolean)
}

function normalizeAdviceStreetName(value) {
  const text = String(value || '').trim().toLowerCase()
  if (!text) return ''
  if (text === 'pre' || text === 'pf' || text === 'preflop' || text === 'pre-flop') return 'preflop'
  if (text === 'flop' || text === 'turn' || text === 'river') return text
  return text
}

function terminalStreetIndex(hand) {
  const street = normalizeAdviceStreetName(hand && (hand.terminalStreet || hand.handEndedStreet || hand.allInStreet))
  return ['preflop', 'flop', 'turn', 'river'].indexOf(street)
}

function filterStreetBreakdownByTerminalStreet(streetBreakdown, hand) {
  const terminalIndex = terminalStreetIndex(hand)
  if (terminalIndex < 0 || !(hand && hand.postAllInRunoutOnly)) return streetBreakdown
  return (streetBreakdown || []).filter(item => {
    const index = ['preflop', 'flop', 'turn', 'river'].indexOf(normalizeAdviceStreetName(item.street || item.streetLabel || item.streetDisplay))
    return index < 0 || index <= terminalIndex
  })
}

function buildAiAdviceHeroFact(streetBreakdown) {
  const streets = Array.isArray(streetBreakdown) ? streetBreakdown : []
  for (let i = 0; i < streets.length; i += 1) {
    const points = streets[i].points || []
    for (let j = 0; j < points.length; j += 1) {
      const text = String(points[j] || '').trim()
      const match = text.match(/^Hero\s*牌力[:：]\s*(.+)$/i)
      if (match && match[1]) {
        return {
          street: streets[i].streetLabel || streets[i].street || '',
          label: '牌力校验' + (streets[i].streetLabel || streets[i].street ? ' · ' + (streets[i].streetLabel || streets[i].street) : ''),
          text: match[1].trim()
        }
      }
    }
  }
  return { street: '', label: '牌力校验', text: '' }
}

function buildAiAdviceSpotMeta(hand) {
  const source = hand || {}
  const board = source.board || {}
  const runout = [board.flop, board.turn, board.river]
    .map(function (item) { return cleanAgentAdviceText(item || '') })
    .filter(Boolean)
    .join(' / ')
  const effectiveStack = Number(source.effectiveStack)
  return {
    heroHandText: cleanAgentAdviceText(source.heroCardsInput || '-'),
    positionText: cleanAgentAdviceText(source.heroPosition || '-'),
    boardText: runout || '-',
    turnText: cleanAgentAdviceText(board.turn || '-'),
    effectiveStackText: Number.isFinite(effectiveStack) && effectiveStack > 0 ? String(effectiveStack) : '-'
  }
}

function buildAiAdviceInsightCard(key, label, type, indexText, list) {
  const points = sanitizeAgentAdviceList(list)
  return points.length ? {
    key,
    label,
    type,
    indexText,
    text: points[0],
    segments: buildAdviceHighlightSegments(points[0], type),
    points
  } : null
}

function uniqueNonEmptyStrings(list) {
  const seen = {}
  return (list || [])
    .map(function (item) { return String(item || '').trim() })
    .filter(function (item) {
      if (!item || seen[item]) return false
      seen[item] = true
      return true
    })
}

function collectAdviceHighlightPhrases(text, type) {
  const source = String(text || '')
  const phrases = []
  if (type === 'danger') {
    source.replace(/(?:\u9519\u8bef\u6838\u5fc3|\u4e8b\u5b9e\u9519\u8bef|\u9519\u8bef)[:\uff1a][^\u3002\uff1b;!?\uff01\uff1f]{2,42}/ig, function (match) {
      phrases.push(match)
      return match
    })
    source.replace(/(?:\u4e0d\u80fd\u628a|\u4e0d\u5e94|Hero\s*\u4e0d\u662f|flop\s*\u4e0d\u662f)[^\uff0c,;\uff1b\u3002.!?\uff01\uff1f]{2,28}/ig, function (match) {
      phrases.push(match)
      return match
    })
    source.replace(/[^\uff0c,;\uff1b\u3002.!?\uff01\uff1f]{0,10}(?:set|\u5361\u987a|\u8fc7\u4e8e\u88ab\u52a8|\u5931\u8861|\u514d\u8d39|\u592a\u6e7f|\u592a\u7d27|\u592a\u5f31|-EV|\u8d1fEV|\u8bc8\u552c|\u65e0\u540e\u7eed\u51fa\u724c)[^\uff0c,;\uff1b\u3002.!?\uff01\uff1f]{0,16}/ig, function (match) {
      phrases.push(match)
      return match
    })
  } else if (type === 'warn') {
    source.replace(/(?:\u66f4\u4f18\u9009\u62e9\u662f|\u66ff\u4ee3\u65b9\u6848|\u9700\u660e\u786e\u8ba1\u5212|\u9700\u8981\u660e\u786e\u8ba1\u5212|\u5e94|\u5e94\u8be5|\u53ef\u4ee5|\u9700\u8981)[^\uff0c,;\uff1b\u3002.!?\uff01\uff1f]{2,36}/ig, function (match) {
      phrases.push(match)
      return match
    })
    source.replace(/[^\uff0c,;\uff1b\u3002.!?\uff01\uff1f]{0,8}(?:3bet|check\s*behind|\u9694\u79bb|\u52a0\u6ce8\u5c3a\u5ea6|river\s*\u8ba1\u5212|\u4ef7\u503c|\u4fdd\u62a4|\u65bd\u538b|\u53cd\u63a8|\u4e0b\u6ce8\u610f\u56fe|\u5e95\u6c60\u63a7\u5236)[^\uff0c,;\uff1b\u3002.!?\uff01\uff1f]{0,14}/ig, function (match) {
      phrases.push(match)
      return match
    })
  }
  return uniqueNonEmptyStrings(phrases)
    .sort(function (a, b) { return b.length - a.length })
    .slice(0, 3)
}

function buildAdviceHighlightSegments(text, type) {
  const source = String(text || '')
  const phrases = collectAdviceHighlightPhrases(source, type)
  if (!source || !phrases.length) return [{ text: source, highlight: false }]
  const ranges = []
  phrases.forEach(function (phrase) {
    const start = source.indexOf(phrase)
    if (start < 0) return
    const end = start + phrase.length
    const overlaps = ranges.some(function (range) {
      return start < range.end && end > range.start
    })
    if (!overlaps) ranges.push({ start, end })
  })
  if (!ranges.length) return [{ text: source, highlight: false }]
  ranges.sort(function (a, b) { return a.start - b.start })
  const segments = []
  let cursor = 0
  ranges.forEach(function (range) {
    if (range.start > cursor) {
      segments.push({ text: source.slice(cursor, range.start), highlight: false })
    }
    segments.push({ text: source.slice(range.start, range.end), highlight: true })
    cursor = range.end
  })
  if (cursor < source.length) segments.push({ text: source.slice(cursor), highlight: false })
  return segments
}

function buildAiAdvicePointSection(key, label, type, indexText, list) {
  const points = sanitizeAgentAdviceList(list)
  return points.length ? { key, label, type, indexText, points } : null
}

function compactAgentAdviceText(value, maxLength) {
  const source = cleanAgentAdviceText(value)
  const limit = Number(maxLength) || 120
  if (!source) return ''
  const firstPart = source
    .split(/[\n。！？]/)
    .map(function (item) { return item.trim() })
    .filter(Boolean)[0] || source
  const compact = firstPart.length <= 12 ? source : firstPart
  return compact.length > limit ? compact.slice(0, limit) + '...' : compact
}

function buildAiReviewFingerprint(hand) {
  const source = hand || {}
  const board = source.board || {}
  const streetInputs = source.streetInputs || {}
  return [
    source._id || '',
    source.stakeLevel || '',
    source.heroPosition || '',
    source.heroCardsInput || '',
    source.effectiveStack || '',
    source.potSize || '',
    board.flop || '',
    board.turn || '',
    board.river || '',
    ['preflop', 'flop', 'turn', 'river'].map(function (street) {
      const item = streetInputs[street] || {}
      return [street, item.pot || '', item.actionLine || ''].join('=')
    }).join('|')
  ].map(function (item) {
    return String(item || '').trim().toLowerCase()
  }).join('||')
}

function attachAiReviewMeta(aiReview, hand) {
  if (!aiReview) return null
  return Object.assign({}, aiReview, {
    sourceHandId: hand && hand._id || '',
    sourceFingerprint: buildAiReviewFingerprint(hand)
  })
}

function collectAiReviewText(value) {
  if (!value) return ''
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(collectAiReviewText).join(' ')
  if (typeof value === 'object') {
    return Object.keys(value)
      .filter(function (key) { return !/^source(?:HandId|Fingerprint)$/i.test(key) })
      .map(function (key) { return collectAiReviewText(value[key]) })
      .join(' ')
  }
  return ''
}

function normalizeAdviceCardToken(rank, suit) {
  const suitMap = {
    s: 's',
    h: 'h',
    d: 'd',
    c: 'c',
    '\u2660': 's',
    '\u2665': 'h',
    '\u2666': 'd',
    '\u2663': 'c'
  }
  const normalizedSuit = suitMap[String(suit || '').toLowerCase()] || ''
  return String(rank || '').toUpperCase() + normalizedSuit
}

function extractAdviceCardTokens(text) {
  const tokens = []
  String(text || '').replace(/([2-9TJQKA])([shdc\u2660\u2665\u2666\u2663])/ig, function (_, rank, suit) {
    tokens.push(normalizeAdviceCardToken(rank, suit))
    return _
  })
  return tokens
}

function aiReviewTextBoardConflictsHand(aiReview, hand) {
  const board = hand && hand.board || {}
  const flop = cardUi.parseCardsInput(board.flop, 3)
    .map(function (card) { return card.rank + card.suit })
  if (flop.length !== 3) return false
  const text = collectAiReviewText(aiReview)
  if (!/(牌面|flop|turn|river|board)/i.test(text)) return false
  const tokens = extractAdviceCardTokens(text)
  if (tokens.length < 3) return false
  const mentionedFlop = tokens.slice(0, 3).join('')
  return mentionedFlop && mentionedFlop !== flop.join('')
}

function aiReviewMatchesHand(aiReview, hand) {
  if (!aiReview || !hand) return !!aiReview
  const sourceHandId = String(aiReview.sourceHandId || '').trim()
  if (sourceHandId && hand._id) return sourceHandId === String(hand._id)
  const sourceFingerprint = String(aiReview.sourceFingerprint || '').trim()
  if (sourceFingerprint && sourceFingerprint !== buildAiReviewFingerprint(hand)) return false
  return true
}

function buildAiReviewMismatchError(hand, aiReview) {
  const handId = String(hand && hand._id || '').trim()
  const sourceHandId = String(aiReview && aiReview.sourceHandId || '').trim()
  const parts = ['AI建议已生成，但和当前手牌字段不匹配，请重新生成。']
  if (handId || sourceHandId) {
    parts.push('handId=' + (handId || '-') + ', sourceHandId=' + (sourceHandId || '-'))
  }
  return parts.join('\n')
}

function buildAiAdviceErrorText(error) {
  const raw = error && error.raw || {}
  const candidates = [
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
  const message = candidates
    .map(function (item) { return String(item || '').trim() })
    .filter(Boolean)[0] || 'EV脑出问题啦，请稍后再重新生成AI建议。'
  const meta = []
  const code = String(error && error.code || raw.code || raw.errCode || '').trim()
  const requestId = String(error && error.requestId || raw.requestId || '').trim()
  if (code) meta.push('code=' + code)
  if (requestId) meta.push('requestId=' + requestId)
  return (meta.length ? message + '\n' + meta.join('\n') : message).slice(0, 900)
}

function buildAiReviewView(aiReview) {
  const hand = arguments[1]
  if (!aiReview) return null
  if (!aiReviewMatchesHand(aiReview, hand)) return null
  const rawAnswer = cleanAgentAdviceText(aiReview.answer || aiReview.naturalLanguageSummary || '')
  const summary = cleanAgentAdviceText(aiReview.summary || '')
  const verdict = cleanAgentAdviceText(aiReview.verdict || '')
  const goodPoints = sanitizeAgentAdviceList(aiReview.goodPoints || aiReview.good_points)
  const issues = sanitizeAgentAdviceList(aiReview.issues)
  const clearMistakes = sanitizeAgentAdviceList(aiReview.clearMistakes || aiReview.clear_mistakes)
  const optimizations = sanitizeAgentAdviceList(aiReview.optimizations)
  const exploitAdjustments = sanitizeAgentAdviceList(aiReview.exploitAdjustments || aiReview.exploit_adjustments)
  const trainingPlan = sanitizeAgentAdviceList(aiReview.trainingPlan || aiReview.training_plan)
  const leakTags = sanitizeAgentAdviceTags(aiReview.leakTags || aiReview.leak_tags)
  const streetBreakdown = filterStreetBreakdownByTerminalStreet(
    sanitizeAgentStreetBreakdown(aiReview.streetBreakdown || aiReview.street_breakdown),
    hand
  )
  const keyTakeaway = cleanAgentAdviceText(aiReview.keyTakeaway || aiReview.key_takeaway || aiReview.humanRule || aiReview.human_rule || '')
  const missingFields = sanitizeStringArray(aiReview.missingFields)
  const heroFact = buildAiAdviceHeroFact(streetBreakdown)
  const spotMeta = buildAiAdviceSpotMeta(hand)
  const insightCards = [
    buildAiAdviceInsightCard('mistake', '错误', 'danger', '01', clearMistakes.length ? clearMistakes : issues),
    buildAiAdviceInsightCard('optimize', '优化', 'warn', '02', optimizations),
    buildAiAdviceInsightCard('highlight', '精彩', 'good', '03', goodPoints)
  ].filter(Boolean)
  const exploitSection = buildAiAdvicePointSection('exploit', '剥削调整', 'info', '04', exploitAdjustments)
  const trainingSection = buildAiAdvicePointSection('training', '训练计划', 'warn', '05', trainingPlan)
  const confidence = aiReview.confidence == null || aiReview.confidence === ''
    ? ''
    : String(aiReview.confidence)
  const hasStructuredAdvice = !!(
    verdict ||
    streetBreakdown.length ||
    keyTakeaway ||
    goodPoints.length ||
    issues.length ||
    clearMistakes.length ||
    optimizations.length ||
    exploitAdjustments.length
  )
  const answer = hasStructuredAdvice ? '' : compactAgentAdviceText(rawAnswer || summary, 120)
  const provider = aiReview.provider || 'poker-agent'
  return {
    provider,
    providerDisplay: formatAiProviderDisplay(provider),
    answer,
    summary,
    verdict,
    goodPoints,
    issues,
    clearMistakes,
    optimizations,
    exploitAdjustments,
    streetBreakdown,
    keyTakeaway,
    humanRule: keyTakeaway,
    heroFact,
    hasHeroFact: !!heroFact.text,
    spotMeta,
    insightCards,
    hasInsightCards: insightCards.length > 0,
    exploitSection,
    hasExploitSection: !!exploitSection,
    trainingSection,
    hasTrainingSection: !!trainingSection,
    trainingPlan,
    leakTags: [],
    missingFields,
    confidence,
    hasStructuredAdvice,
    hasStreetBreakdown: streetBreakdown.length > 0,
    hasKeyTakeaway: !!keyTakeaway,
    hasHumanRule: !!keyTakeaway,
    hasGoodPoints: goodPoints.length > 0,
    hasIssues: issues.length > 0,
    hasClearMistakes: clearMistakes.length > 0,
    hasOptimizations: optimizations.length > 0,
    hasExploitAdjustments: exploitAdjustments.length > 0,
    hasTrainingPlan: trainingPlan.length > 0,
    hasLeakTags: false,
    hasMissingFields: missingFields.length > 0,
    visible: !!(answer || verdict || streetBreakdown.length || keyTakeaway || goodPoints.length || issues.length || clearMistakes.length || optimizations.length || exploitAdjustments.length || trainingPlan.length || missingFields.length)
  }
}

function formatAiProviderDisplay(provider) {
  const value = String(provider || '').trim()
  if (value === 'poker-agent') return 'EV脑'
  if (value === 'openai') return 'OpenAI'
  if (value === 'kimi') return 'Kimi'
  if (value === 'local' || value === 'local-fallback') return '本地兜底'
  return value || 'EV脑'
}

function stripAutoVoiceReviewNotes(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map(item => item.trim())
    .filter(item => item && !/^\[(?:\u8bed\u97f3\u590d\u76d8|\u7487\uE145\u7162\u6FBE\u5D76\u6D3F)\]/.test(item))
    .join('\n')
}

function buildAllInEvDisplay(hand, chipUnit) {
  if (!hand) return ''
  if (!handDetailFields.isPreRiverAllIn(hand)) return ''
  const raw = hand.allInEv !== undefined && hand.allInEv !== null
    ? hand.allInEv
    : (hand.allInEvProfit !== undefined && hand.allInEvProfit !== null
      ? hand.allInEvProfit
      : hand.allInEvAdjustedProfit)
  if (raw === '' || raw === undefined || raw === null) return ''
  const value = Number(raw)
  if (!Number.isFinite(value)) return ''
  return display.formatAmount(value, chipUnit)
}

function buildDetailHandView(hand, chipUnit) {
  if (!hand) return null
  const detailView = handDetailFields.buildHandDetailViewModel(hand, {
    mode: 'readonly',
    backfilled: !!hand.detailBackfilled,
    positions: dataService.getAppSettings().positions || [],
    excludeRowKeys: ['heroCardsInput', 'streetSummary', 'mindJourney', 'tags']
  })
  const boardVisual = buildBoardVisual(hand.board)
  const streetItems = buildStreetItems(hand.streetInputs, hand.board)
  const resultBBDisplay = String(hand.resultBB || '').trim() || buildResultBbDisplay(hand)
  const aiReviewView = buildAiReviewView(hand.aiReview, hand)
  const aiReviewMismatch = !!(hand.aiReview && !aiReviewView && hand.aiReviewStatus === 'ready')
  const aiReviewStatus = resolveAiReviewStatus(hand, aiReviewView)
  const normalizedTags = reviewTags.normalizeReviewTags(hand.tags).slice(0, 3)
  const notesText = stripAutoVoiceReviewNotes(hand.notes)
  const allInEvDisplay = buildAllInEvDisplay(hand, chipUnit)
  const detailRows = detailView.rows.map(item => {
    if (item.key === 'currentProfit') {
      return Object.assign({}, item, {
        rowClass: '',
        displayValue: display.formatAmount(hand.currentProfit, chipUnit)
      })
    }
    if (item.key === 'playerCount') {
      return Object.assign({}, item, {
        rowClass: '',
        displayValue: Number(hand.playerCount) > 0 ? String(Number(hand.playerCount)) : '-'
      })
    }
    if (item.key === 'villainType') {
      return Object.assign({}, item, {
        rowClass: '',
        displayValue: hand.villainType || hand.opponentType || '-'
      })
    }
    if (item.key === 'showdown') {
      const showdownValue = detailView.form.opponentCards || detailView.form.showdown || hand.opponentCards || hand.showdown || ''
      const showdownCards = cardUi.parseOpponentCardsInput(showdownValue, {
        board: hand.board,
        heroCardsInput: hand.heroCardsInput
      })
      const displayValue = showdownCards.length === 2 ? cardsToInput(showdownCards) : ''
      return Object.assign({}, item, {
        rowClass: '',
        opponentCardsVisual: showdownCards.length === 2 ? showdownCards : [],
        displayValue: displayValue || '-'
      })
    }
    return Object.assign({}, item, {
      rowClass: item.key === 'heroQuestion' ? 'readonly-field-card-full' : ''
    })
  })
  return Object.assign({}, hand, {
    currentProfitDisplay: display.formatAmount(hand.currentProfit, chipUnit),
    playerCountDisplayText: Number(hand.playerCount) > 0 ? String(Number(hand.playerCount)) : '',
    resultBBDisplay,
    allInEvDisplay,
    hasAllInEvDisplay: !!allInEvDisplay,
    actionLine: buildCompactStreetSummary(hand),
    boardVisual,
    detailRows,
    shouldShowFullDetails: detailView.shouldShowFullDetails,
    hasOnlyQuickEntryDetails: detailView.hasOnlyQuickEntryDetails,
    straddleAmount: detailView.straddleAmount,
    hasStraddle: detailView.form.hasStraddle,
    heroQuestion: detailView.form.heroQuestion,
    opponentName: detailView.form.opponentName,
    showdown: detailView.form.showdown,
    streetItems,
    tags: normalizedTags,
    tagsText: normalizedTags.join(' · '),
    tagItems: normalizedTags.map(label => ({ label })),
    heroCardsVisual: cardUi.parseHeroCardsInput(hand.heroCardsInput),
    reviewStatus: hand.reviewStatus || 'idle',
    mindJourney: hand.mindJourney || '',
    notes: notesText,
    aiReviewView,
    aiReviewStatus,
    aiReviewReady: !!(aiReviewView && aiReviewView.visible),
    hasCompletedReview: hasCompletedReview(hand),
    aiReviewGenerating: aiReviewStatus === 'generating',
    aiReviewFailed: aiReviewStatus === 'failed' || aiReviewMismatch,
    aiReviewErrorText: hand.aiReviewError || (aiReviewMismatch ? buildAiReviewMismatchError(hand, hand.aiReview) : 'EV脑暂时没有生成建议，请稍后再试'),
    villainTypeText: hand.villainType || hand.opponentType || '',
    boardHasCards: boardVisual.some(item => item.cards.length),
    hasStreetItems: streetItems.some(item => item.actionLine || item.pot),
    hasReflectionContent: !!(normalizedTags.length || notesText)
  })
}

function buildPositionClass(position) {
  const key = String(position || '').trim().toUpperCase().replace(/\s+/g, '')
  const map = {
    UTG: 'pos-utg',
    'UTG+1': 'pos-utg1',
    UTG1: 'pos-utg1',
    LJ: 'pos-lj',
    HJ: 'pos-hj',
    CO: 'pos-co',
    BTN: 'pos-btn',
    SB: 'pos-sb',
    BB: 'pos-bb',
    STR: 'pos-str'
  }
  return map[key] || 'pos-unknown'
}

function hasCompletedReview(hand) {
  if (!hand) return false
  return !!(
    hand.voiceExtract ||
    String(hand.voiceNote || '').trim() ||
    String(hand.mindJourney || '').trim() ||
    sanitizeStringArray(hand.tags).length ||
    String(hand.showdown || '').trim() ||
    hand.reviewStatus === 'reviewed' ||
    hand.reviewStatus === 'extracted'
  )
}

Page({
  data: {
    agentChatReady: false,
    hands: [],
    handRenderComplete: true,
    sessions: [],
    summary: {
      totalHands: 0,
      totalProfit: 0
    },
    chipUnit: 'BB',
    loading: false,
    selectedSessionStatus: '',
    filterInitialized: false,
    dateRange: 'all',
    startDate: '',
    endDate: '',
    resultFilter: 'all',
    tagFilter: 'all',
    sortBy: 'updatedDesc',
    sessionStatusOptions: buildSessionStatusOptions('finished'),
    dateFilterOptions: buildFilterOptions(DATE_FILTERS, 'all'),
    resultFilterOptions: buildFilterOptions(RESULT_FILTERS, 'all'),
    tagFilterOptions: reviewTags.getReviewTagOptions('all'),
    sortOptions: buildFilterOptions(SORT_OPTIONS, 'updatedDesc'),
    sortControlOptions: buildSortControlOptions('updatedDesc'),
    filterSummary: '\u6700\u65b0\u8bb0\u5f55',
    filterModalVisible: false,
    defaultSessionStatus: 'finished',
    draftSessionStatus: 'finished',
    draftDateRange: 'all',
    draftStartDate: '',
    draftEndDate: '',
    draftResultFilter: 'all',
    draftTagFilter: 'all',
    draftSessionStatusOptions: buildSessionStatusOptions('finished'),
    draftDateFilterOptions: buildFilterOptions(DATE_FILTERS, 'all'),
    draftResultFilterOptions: buildFilterOptions(RESULT_FILTERS, 'all'),
    draftTagFilterOptions: reviewTags.getReviewTagOptions('all'),
    detailVisible: false,
    detailLoading: false,
    detailHand: null,
    detailSession: null,
    detailActions: [],
    detailExportVisible: false,
    detailExportText: '',
    voicePanelVisible: false,
    voiceBusy: false,
    voiceRecording: false,
    voiceStatus: '',
    voiceNote: '',
    voiceNoteHasText: false,
    voiceNoteLength: 0,
    voiceCorrectionNote: '',
    parsedVoice: null,
    parsedVoiceSourceText: '',
    voiceNeedsRefresh: false,
    voiceReviewRequestId: 0,
    voiceProgressVisible: false,
    voiceProgressPercent: 0,
    voiceProgressStep: VOICE_PROGRESS_STEPS[0],
    voiceProgressSteps: buildVoiceProgressSteps(0),
    voiceFocusField: '',
    voiceStraddleMissingClass: '',
    blindPresets: [],
    positions: [],
    opponentTypes: [],
    voiceSelectorVisible: false,
    voiceSelectorTitle: '',
    voiceSelectorKey: '',
    voiceSelectorOptions: [],
    voiceBoardPickerVisible: false,
    voiceBoardPickerKey: 'flop',
    voiceBoardPickerTitle: '翻牌',
    voiceBoardPickerHint: '',
    voiceBoardPickerPreview: [],
    voiceBoardPickerDeck: [],
    voiceBoardReplaceIndex: -1,
    voiceHeroPickerVisible: false,
    voiceHeroPickerHint: '',
    voiceHeroPickerPreview: [],
    voiceHeroPickerDeck: [],
    voiceHeroReplaceIndex: -1,
    voiceShowdownPickerVisible: false,
    voiceShowdownPickerHint: '',
    voiceShowdownPickerPreview: [],
    voiceShowdownPickerDeck: [],
    replayVisible: false,
    replayData: null,
    aiAdviceSheetVisible: false,
    aiAdviceSheetHand: null,
    aiAdviceSheetView: null,
    handCommentVisible: false,
    handCommentHandId: '',
    handCommentTitle: '',
    handCommentDraft: '',
    handCommentItems: [],
    handCommentSaving: false,
    reviewChoiceVisible: false,
    reviewChoiceHandId: '',
    swipedHandId: '',
    touchStartX: 0,
    touchStartY: 0,
    touchActiveHandId: '',
    touchMoved: false,
    onboardingGuideVisible: false,
    onboardingGuideStep: null,
    voiceShortcutExamples: [
      {
        label: '标准口述',
        text: '\u6211\u5728 CO \u62ff AhKd\uff0c\u6709\u6548\u7b79\u7801 800\uff0c\u5927\u76f2 10\uff0c\u5bf9\u624b\u662f\u677e\u5f31\uff0c\u7ffb\u724c Ts7d2c\uff0c\u8f6c\u724c Ad\uff0c\u6cb3\u724c 5h\uff0c\u6700\u540e\u8d62 320\u3002'
      },
      {
        label: '逐街行动',
        text: '\u7ffb\u524d\u6211\u5728 BTN open\uff0cSB call\u3002\u7ffb\u724c Kd9c4c \u6211 cbet\uff0c\u5bf9\u624b call\u3002\u8f6c\u724c 2d \u6211\u7ee7\u7eed\u6253\uff0c\u5bf9\u624b\u8ddf\u3002\u6cb3\u724c Jc \u5bf9\u624b lead\u3002'
      },
      {
        label: '\u8865\u5b57\u6bb5',
        text: '\u8865\u5145\u4e00\u4e0b\uff0c\u8fd9\u624b\u724c\u7ea7\u522b\u662f 5/10\uff0c\u5bf9\u624b\u662f\u8ddf\u6ce8\u7ad9\uff0cturn \u5e95\u6c60 160\uff0criver \u4ed6\u4eae\u724c AJo\u3002'
      },
      {
        label: '思路复盘',
        text: '\u6211\u7684\u60f3\u6cd5\u662f\u7ffb\u724c\u8303\u56f4\u4f18\u52bf\u4e0b\u6ce8\uff0c\u8f6c\u724c\u9876\u5bf9\u7ee7\u7eed\u4ef7\u503c\uff0c\u6cb3\u724c\u9762\u5bf9\u52a0\u6ce8\u5e94\u8be5\u63a7\u5236\u635f\u5931\u3002'
      }
    ]
  },
  async onShow() {
    tabBar.syncCustomTabBar('/pages/review-list/review-list')
    const hasPendingFilters = !!wx.getStorageSync(REVIEW_PENDING_FILTER_KEY)
    const isFresh = this.data.hands.length && !hasPendingFilters && Date.now() - Number(this.lastReviewLoadedAt || 0) < ON_SHOW_FRESH_MS
    if (!isFresh) await this.refresh()
    await this.consumePendingReviewEntry()
    this.syncOnboardingGuide()
  },
  onReady() {
    setTimeout(() => {
      if (!this.data.agentChatReady) {
        this.setData({ agentChatReady: true })
      }
    }, 240)
  },
  onHide() {
    this.clearProgressiveRenderTimer()
  },
  onUnload() {
    this.clearProgressiveRenderTimer()
  },

  syncOnboardingGuide() {
    if (dataService.refreshOnboardingGuideContext) dataService.refreshOnboardingGuideContext()
    const step = onboardingGuide.getStepForRoute('pages/review-list/review-list')
    this.setData({
      onboardingGuideVisible: !!step,
      onboardingGuideStep: step
    })
    this.ensureOnboardingReviewDemo(step)
  },

  async ensureOnboardingReviewDemo(step) {
    if (!step || ['reviewEntry', 'reviewLedgerEntry', 'reviewVoice', 'reviewParse', 'reviewApply', 'reviewAdvice', 'reviewAdviceSheet', 'reviewReplay', 'reviewDelete'].indexOf(step.key) === -1) return
    const hand = (this.data.hands || []).find(item => item && item.heroCardsInput === ONBOARDING_REVIEW_DEMO_HAND)
    if (!hand) return
    if (step.key === 'reviewEntry') {
      this.setData({
        detailVisible: false,
        voicePanelVisible: false,
        aiAdviceSheetVisible: false,
        replayVisible: false
      })
      this.updateReviewSwipeState('')
      return
    }
    if (step.key === 'reviewAdvice') {
      this.setData({
        detailVisible: false,
        voicePanelVisible: false,
        aiAdviceSheetVisible: false,
        replayVisible: false,
        touchMoved: false
      })
      this.updateReviewSwipeState('')
      return
    }
    if (step.key === 'reviewAdviceSheet') {
      this.setData({
        detailVisible: false,
        voicePanelVisible: false,
        aiAdviceSheetVisible: true,
        aiAdviceSheetHand: hand,
        aiAdviceSheetView: hand.aiReviewView || buildAiReviewView(hand.aiReview, hand),
        replayVisible: false,
        touchMoved: false
      })
      this.updateReviewSwipeState('')
      return
    }
    if (step.key === 'reviewReplay') {
      const replayData = hand.replayData || handReplay.buildReplayView(hand)
      this.setData({
        detailVisible: false,
        voicePanelVisible: false,
        aiAdviceSheetVisible: false,
        replayVisible: true,
        replayData,
        touchMoved: false
      })
      this.updateReviewSwipeState('')
      return
    }
    if (step.key === 'reviewDelete') {
      this.setData({
        detailVisible: false,
        voicePanelVisible: false,
        aiAdviceSheetVisible: false,
        replayVisible: false,
        touchMoved: false
      })
      this.updateReviewSwipeState(hand._id)
      return
    }
    if (!this.data.detailVisible || !this.data.detailHand || this.data.detailHand._id !== hand._id) {
      this.setData({
        detailVisible: true,
        detailLoading: true,
        detailHand: null,
        detailSession: null,
        detailActions: []
      })
      await this.loadHandDetail(hand._id)
    }
    if (step.key === 'reviewLedgerEntry') {
      this.setData({
        voicePanelVisible: false,
        aiAdviceSheetVisible: false,
        replayVisible: false,
        reviewChoiceVisible: false
      })
      return
    }
    this.applyOnboardingVoiceDemo(step.key)
  },

  applyOnboardingVoiceDemo(stepKey) {
    if (!this.data.detailHand) return
    const voiceNote = '我在 CO 拿 QdQs，澳门 300/600，8人桌无 Straddle。翻前 open 1500，SB call。翻牌 Qd7d3c，我下注 2500，被 SB raise 到 7800 后 call。转牌 8d，我 check back。河牌 2s，SB bet 42000，我 call，摊牌输给 AdJd 同花。'
    const parsedVoice = buildOnboardingParsedVoicePreview(this.data.detailHand, this.data.detailSession)
    this.voiceNoteDraft = voiceNote
    this.setData({
      voicePanelVisible: stepKey !== 'reviewVoice',
      voiceNote,
      voiceNoteHasText: true,
      voiceNoteLength: voiceNote.length,
      parsedVoice: stepKey === 'reviewParse' || stepKey === 'reviewApply' ? parsedVoice : null,
      parsedVoiceSourceText: voiceNote,
      voiceNeedsRefresh: false,
      voiceStatus: stepKey === 'reviewVoice'
        ? '演示口述已填入：可以用手机 AI 输入法说出这段内容。'
        : '演示解析字段已生成：检查 QdQs、位置、牌面、底池和 -42000 是否正确。'
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

  getActiveFilters() {
    return {
      sessionStatus: this.data.selectedSessionStatus,
      dateRange: this.data.dateRange,
      startDate: this.data.startDate,
      endDate: this.data.endDate,
      resultFilter: this.data.resultFilter,
      tagFilter: this.data.tagFilter,
      sortBy: this.data.sortBy
    }
  },
  getDraftFilters() {
    return {
      sessionStatus: this.data.draftSessionStatus,
      dateRange: this.data.draftDateRange,
      startDate: this.data.draftStartDate,
      endDate: this.data.draftEndDate,
      resultFilter: this.data.draftResultFilter,
      tagFilter: this.data.draftTagFilter
    }
  },
  applyFilterState(patch) {
    const next = Object.assign({}, this.getActiveFilters(), normalizeActiveFilterPatch(patch))
    this.setData(Object.assign({}, patch || {}, {
      dateFilterOptions: buildFilterOptions(DATE_FILTERS, next.dateRange),
      resultFilterOptions: buildFilterOptions(RESULT_FILTERS, next.resultFilter),
      tagFilterOptions: reviewTags.getReviewTagOptions(next.tagFilter),
      sortOptions: buildFilterOptions(SORT_OPTIONS, next.sortBy),
      sortControlOptions: buildSortControlOptions(next.sortBy),
      filterSummary: buildFilterSummary(next, this.data.sessions)
    }))
  },
  applyDraftFilterState(patch) {
    const next = Object.assign({}, this.getDraftFilters(), normalizeDraftFilterPatch(patch))
    this.setData(Object.assign({}, patch || {}, {
      draftDateFilterOptions: buildFilterOptions(DATE_FILTERS, next.dateRange),
      draftResultFilterOptions: buildFilterOptions(RESULT_FILTERS, next.resultFilter),
      draftTagFilterOptions: reviewTags.getReviewTagOptions(next.tagFilter),
      draftSessionStatusOptions: buildSessionStatusOptions(next.sessionStatus)
    }))
  },
  clearProgressiveRenderTimer() {
    if (this.reviewRenderTimer) {
      clearTimeout(this.reviewRenderTimer)
      this.reviewRenderTimer = null
    }
  },
  onReachBottom() {
    const list = Array.isArray(this.reviewHandSource) ? this.reviewHandSource : []
    const nextIndex = (this.data.hands || []).length
    if (nextIndex >= list.length) return
    const endIndex = Math.min(nextIndex + REVIEW_PAGE_SIZE, list.length)
    this.setData({
      hands: (this.data.hands || []).concat(
        buildReviewListHandViews(list.slice(nextIndex, endIndex), this.reviewChipUnit, this.data.swipedHandId)
      ),
      handRenderComplete: endIndex >= list.length
    })
  },
  async refresh() {
    const refreshToken = Date.now() + '_' + Math.floor(Math.random() * 1000000)
    this.reviewRefreshToken = refreshToken
    this.clearProgressiveRenderTimer()
    this.setData({ loading: true })
    const settings = dataService.getAppSettings()
    const chipUnit = settings.chipUnit
    const sessionData = await dataService.getSessionListData({ includeSummary: false })
    const sessions = sessionData.sessions || []
    const pendingFilters = readPendingFilters()
    let nextFilters = this.getActiveFilters()
    const defaultSessionStatus = getDefaultSessionStatus(sessions)

    if (pendingFilters) {
      nextFilters = Object.assign({}, nextFilters, pendingFilters)
    }
    nextFilters.sessionStatus = resolveSessionStatus({
      requestedStatus: this.data.filterInitialized || pendingFilters ? nextFilters.sessionStatus : '',
      legacySessionId: nextFilters.sessionId,
      sessions
    })
    delete nextFilters.sessionId

    this.applyFilterState({
      selectedSessionStatus: nextFilters.sessionStatus,
      dateRange: nextFilters.dateRange,
      startDate: nextFilters.startDate,
      endDate: nextFilters.endDate,
      resultFilter: nextFilters.resultFilter,
      tagFilter: nextFilters.tagFilter,
      sortBy: nextFilters.sortBy,
      filterInitialized: true
    })
    const data = await dataService.getReviewData(nextFilters, { sessions })
    if (this.reviewRefreshToken !== refreshToken) return
    const rawHands = data.hands || []
    this.reviewHandSource = rawHands
    this.reviewChipUnit = chipUnit
    this.lastReviewLoadedAt = Date.now()
    const initialHands = buildReviewListHandViews(
      rawHands.slice(0, REVIEW_PAGE_SIZE),
      chipUnit,
      this.data.swipedHandId
    )
    this.setData(Object.assign({}, data, {
      hands: initialHands,
      handRenderComplete: rawHands.length <= REVIEW_PAGE_SIZE,
      chipUnit,
      blindPresets: settings.blindPresets || [],
      positions: settings.positions || [],
      opponentTypes: settings.opponentTypes || [],
      defaultSessionStatus,
      sessionStatusOptions: buildSessionStatusOptions(nextFilters.sessionStatus),
      draftSessionStatus: nextFilters.sessionStatus,
      draftSessionStatusOptions: buildSessionStatusOptions(nextFilters.sessionStatus),
      sortControlOptions: buildSortControlOptions(nextFilters.sortBy),
      tagFilterOptions: reviewTags.getReviewTagOptions(nextFilters.tagFilter),
      filterSummary: buildFilterSummary(nextFilters, data.sessions || sessions),
      summary: Object.assign({}, data.summary, {
        totalProfitDisplay: display.formatAmount(data.summary.totalProfit, chipUnit)
      }),
      loading: false
    }), () => {
      this.ensureOnboardingReviewDemo(this.data.onboardingGuideStep)
    })
  },
  selectSessionStatus(e) {
    const sessionStatus = e.currentTarget.dataset.key || 'finished'
    this.applyDraftFilterState({ draftSessionStatus: sessionStatus })
  },
  selectDateRange(e) {
    const dateRange = e.currentTarget.dataset.key || 'all'
    this.applyDraftFilterState({ draftDateRange: dateRange })
  },
  onStartDateChange(e) {
    this.applyDraftFilterState({ draftStartDate: e.detail.value, draftDateRange: 'custom' })
  },
  onEndDateChange(e) {
    this.applyDraftFilterState({ draftEndDate: e.detail.value, draftDateRange: 'custom' })
  },
  selectResultFilter(e) {
    const resultFilter = e.currentTarget.dataset.key || 'all'
    this.applyDraftFilterState({ draftResultFilter: resultFilter })
  },
  selectTagFilter(e) {
    const tagFilter = e.currentTarget.dataset.key || 'all'
    this.applyDraftFilterState({ draftTagFilter: tagFilter })
  },
  resetFilters() {
    this.applyDraftFilterState({
      draftSessionStatus: this.data.defaultSessionStatus,
      draftDateRange: 'all',
      draftStartDate: '',
      draftEndDate: '',
      draftResultFilter: 'all',
      draftTagFilter: 'all'
    })
  },
  openFilterModal() {
    this.applyDraftFilterState({
      draftSessionStatus: this.data.selectedSessionStatus,
      draftDateRange: this.data.dateRange,
      draftStartDate: this.data.startDate,
      draftEndDate: this.data.endDate,
      draftResultFilter: this.data.resultFilter,
      draftTagFilter: this.data.tagFilter
    })
    this.setData({ filterModalVisible: true })
  },
  closeFilterModal() {
    this.setData({ filterModalVisible: false })
  },
  applyFilterModal() {
    const patch = {
      selectedSessionStatus: this.data.draftSessionStatus,
      dateRange: this.data.draftDateRange,
      startDate: this.data.draftStartDate,
      endDate: this.data.draftEndDate,
      resultFilter: this.data.draftResultFilter,
      tagFilter: this.data.draftTagFilter,
      filterInitialized: true,
      filterModalVisible: false
    }
    const next = Object.assign({}, this.getActiveFilters(), normalizeActiveFilterPatch(patch))
    this.setData(Object.assign({}, patch, {
      dateFilterOptions: buildFilterOptions(DATE_FILTERS, next.dateRange),
      resultFilterOptions: buildFilterOptions(RESULT_FILTERS, next.resultFilter),
      tagFilterOptions: reviewTags.getReviewTagOptions(next.tagFilter),
      sortOptions: buildFilterOptions(SORT_OPTIONS, next.sortBy),
      sortControlOptions: buildSortControlOptions(next.sortBy),
      filterSummary: buildFilterSummary(next, this.data.sessions)
    }), () => {
      this.refresh()
    })
  },
  changeSort(e) {
    const field = e.currentTarget.dataset.field || 'updated'
    const control = SORT_CONTROLS.find(item => item.field === field) || SORT_CONTROLS[0]
    const sortBy = this.data.sortBy === control.desc ? control.asc : control.desc
    const patch = {
      sortBy,
      filterInitialized: true
    }
    const next = Object.assign({}, this.getActiveFilters(), normalizeActiveFilterPatch(patch))
    this.setData(Object.assign({}, patch, {
      sortOptions: buildFilterOptions(SORT_OPTIONS, next.sortBy),
      sortControlOptions: buildSortControlOptions(next.sortBy),
      filterSummary: buildFilterSummary(next, this.data.sessions)
    }), () => {
      this.refresh()
    })
  },
  async loadHandDetail(handId) {
    const rawHand = await dataService.getHandById(handId)
    const hand = ledgerDerived.withLedgerDerivedFields(rawHand)
    if (!hand) {
      this.setData({ detailLoading: false, detailVisible: false })
      wx.showToast({ title: '未找到这手牌', icon: 'none' })
      return
    }
    this.syncAiReviewStatusFromDetailHand(hand)
    const session = await dataService.getSessionById(hand.sessionId)
    const actions = await dataService.getActionsByHandId(handId)
    const reviewed = hasCompletedReview(hand)
    const voiceNote = hand.voiceNote || ''
    this.voiceNoteDraft = voiceNote
    this.setData({
      detailLoading: false,
      detailHand: buildDetailHandView(hand, this.data.chipUnit),
      detailSession: session,
      detailActions: actions,
      detailExportVisible: false,
      detailExportText: handExport.buildPokerStarsExport(hand, { session, actions }),
      voicePanelVisible: false,
      voiceBusy: false,
      voiceRecording: false,
      voiceStatus: reviewed ? '\u5df2\u4fdd\u5b58\u8fc7\u590d\u76d8\uff0c\u53ef\u5c55\u5f00\u7ee7\u7eed\u8865\u5145' : '',
      voiceNote,
      voiceNoteHasText: !!String(voiceNote).trim(),
      voiceNoteLength: String(voiceNote).length,
      parsedVoiceSourceText: voiceNote,
      voiceNeedsRefresh: false,
      parsedVoice: hand.voiceExtract
        ? buildParsedVoicePreview(hand.voiceExtract, {
            analysis: hand.aiReview,
            provider: hand.voiceExtract.provider || hand.voiceExtract.providerText || '',
            naturalLanguageSummary: hand.voiceExtract.naturalLanguageSummary || hand.voiceExtract.feedbackText || hand.voiceExtract.noteSummary || '',
            missingFields: hand.voiceExtract.missingFields || [],
            followUpQuestions: hand.voiceExtract.followUpQuestions || []
          })
        : null
    })
  },
  syncAiReviewStatusFromDetailHand(hand) {
    if (!hand || !hand._id) return
    if (!Object.prototype.hasOwnProperty.call(hand, 'aiReviewStatus') && !Object.prototype.hasOwnProperty.call(hand, 'aiReview')) return
    this.applyAiReviewPatchToVisibleHand(hand._id, {
      aiReview: hand.aiReview || null,
      aiReviewStatus: hand.aiReviewStatus || '',
      aiReviewGeneratedAt: hand.aiReviewGeneratedAt || '',
      aiReviewError: hand.aiReviewError || ''
    })
  },
  openHandDetail(e) {
    const handId = e.currentTarget.dataset.id
    if (!handId) return
    if (this.data.touchMoved) {
      this.setData({ touchMoved: false })
      return
    }
    if (this.data.swipedHandId && this.data.swipedHandId !== handId) {
      this.closeSwipedReviewItem()
      return
    }
    const previewHand = (this.data.hands || []).find(item => item && item._id === handId)
    const previewDetailHand = previewHand
      ? buildDetailHandView(ledgerDerived.withLedgerDerivedFields(previewHand, { includeEv: false }), this.data.chipUnit)
      : null
    this.setData({
      detailVisible: true,
      detailLoading: true,
      detailHand: previewDetailHand,
      detailSession: null,
      detailActions: [],
      detailExportVisible: false,
      detailExportText: previewHand ? handExport.buildPokerStarsExport(previewHand, { actions: [] }) : '',
      voicePanelVisible: false,
      voiceBusy: false,
      voiceRecording: false
    }, () => {
      setTimeout(() => {
        this.loadHandDetail(handId).catch(error => {
          console.warn('load hand detail failed: ' + (error && (error.message || error.errMsg) || String(error)))
          this.setData({ detailLoading: false })
        })
      }, 0)
    })
  },
  async consumePendingReviewEntry() {
    let pending = null
    try {
      pending = wx.getStorageSync(REVIEW_PENDING_ENTRY_KEY)
      wx.removeStorageSync(REVIEW_PENDING_ENTRY_KEY)
    } catch (error) {
      pending = null
    }
    const handId = pending && pending.handId
    if (!handId) return
    if (pending.mode === 'ledger') {
      wx.navigateTo({ url: '/pages/hand-ledger-input/hand-ledger-input?handId=' + handId })
      return
    }
    this.setData({
      detailVisible: true,
      detailLoading: true,
      detailHand: null,
      detailSession: null,
      detailActions: [],
      touchMoved: false
    })
    await this.loadHandDetail(handId)
    if (pending.mode === 'voice') this.handleVoiceEntry()
  },
  openReviewChoice(e) {
    const handId = e.currentTarget.dataset.id
    if (!handId) return
    if (this.data.touchMoved) {
      this.setData({ touchMoved: false })
      return
    }
    if (this.data.swipedHandId && this.data.swipedHandId !== handId) {
      this.closeSwipedReviewItem()
      return
    }
    this.closeSwipedReviewItem()
    this.setData({
      reviewChoiceVisible: true,
      reviewChoiceHandId: handId
    })
  },
  closeReviewChoice() {
    this.setData({
      reviewChoiceVisible: false,
      reviewChoiceHandId: ''
    })
  },
  async chooseReviewMode(e) {
    const mode = e.currentTarget.dataset.mode
    const handId = this.data.reviewChoiceHandId
    this.setData({
      reviewChoiceVisible: false,
      reviewChoiceHandId: '',
      touchMoved: false
    })
    if (!handId) return
    if (mode === 'ledger') {
      wx.navigateTo({ url: '/pages/hand-ledger-input/hand-ledger-input?handId=' + handId })
      return
    }
    await this.openHandDetail({ currentTarget: { dataset: { id: handId } } })
  },
  updateReviewSwipeState(handId) {
    const hands = (this.data.hands || []).map(item => Object.assign({}, item, {
      swiped: item._id === handId
    }))
    this.setData({
      hands,
      swipedHandId: handId || ''
    })
  },
  closeSwipedReviewItem() {
    this.updateReviewSwipeState('')
  },
  onReviewItemTouchStart(e) {
    const touch = e.touches && e.touches[0]
    if (!touch) return
    this.setData({
      touchStartX: touch.clientX,
      touchStartY: touch.clientY,
      touchActiveHandId: e.currentTarget.dataset.id || '',
      touchMoved: false
    })
  },
  onReviewItemTouchMove(e) {
    const touch = e.touches && e.touches[0]
    if (!touch) return
    const deltaX = touch.clientX - this.data.touchStartX
    const deltaY = touch.clientY - this.data.touchStartY
    if (Math.abs(deltaX) < Math.abs(deltaY) || Math.abs(deltaX) < 12) return
    this.setData({ touchMoved: true })
  },
  onReviewItemTouchEnd(e) {
    const touch = e.changedTouches && e.changedTouches[0]
    const handId = e.currentTarget.dataset.id || this.data.touchActiveHandId
    if (!touch || !handId) return
    const deltaX = touch.clientX - this.data.touchStartX
    const deltaY = touch.clientY - this.data.touchStartY
    if (Math.abs(deltaX) > Math.abs(deltaY) && deltaX < -SWIPE_OPEN_DISTANCE) {
      this.updateReviewSwipeState(handId)
      this.setData({ touchMoved: true })
      return
    }
    if (Math.abs(deltaX) > Math.abs(deltaY) && deltaX > SWIPE_CLOSE_DISTANCE) {
      this.closeSwipedReviewItem()
      this.setData({ touchMoved: true })
      return
    }
    if (this.data.touchMoved) {
      setTimeout(() => this.setData({ touchMoved: false }), 80)
    }
  },
  editHandFromList(e) {
    const handId = e.currentTarget.dataset.id
    if (!handId) return
    this.closeSwipedReviewItem()
    wx.navigateTo({ url: '/pages/hand-detail/hand-detail?id=' + handId + '&edit=1' })
  },
  openHandReplay(e) {
    const handId = e.currentTarget.dataset.id
    if (!handId) return
    const hand = (this.data.hands || []).find(item => item && item._id === handId)
    if (!hand || !hand.replayAvailable || !hand.replayData) {
      wx.showToast({ title: '完整复盘后可播放', icon: 'none' })
      return
    }
    this.closeSwipedReviewItem()
    this.setData({
      replayVisible: true,
      replayData: hand.replayData,
      touchMoved: false
    })
  },
  async openAiAdviceSheet(e) {
    const handId = e.currentTarget.dataset.id
    if (!handId) return
    const hand = (this.data.hands || []).find(item => item && item._id === handId)
    if (!hand) return
    if (hand.aiReviewGenerating) {
      wx.showToast({ title: 'AI建议生成中', icon: 'none' })
      return
    }
    if (hand.canRequestAiAdvice) {
      this.closeSwipedReviewItem()
      await this.requestHandAiAdvice(handId)
      return
    }
    if (!hand.aiReviewReady || !hand.aiReviewView) {
      wx.showToast({ title: '暂无AI建议', icon: 'none' })
      return
    }
    this.closeSwipedReviewItem()
    this.setData({
      aiAdviceSheetVisible: true,
      aiAdviceSheetHand: hand,
      aiAdviceSheetView: hand.aiReviewView || buildAiReviewView(hand.aiReview, hand),
      touchMoved: false
    })
  },
  async requestHandAiAdvice(handId) {
    try {
      await dataService.updateHand(handId, {
        aiReview: null,
        aiReviewStatus: 'generating',
        aiReviewError: ''
      })
      await this.refresh()
      const hand = await dataService.getHandById(handId)
      if (!hand) return
      const session = hand.sessionId ? await dataService.getSessionById(hand.sessionId) : null
      const actions = await dataService.getActionsByHandId(handId)
      this.generateVoiceAdvice(handId, '', null, session, actions)
    } catch (error) {
      wx.showToast({ title: 'AI建议启动失败', icon: 'none' })
    }
  },
  closeAiAdviceSheet() {
    this.setData({
      aiAdviceSheetVisible: false,
      aiAdviceSheetHand: null,
      aiAdviceSheetView: null
    }, () => {
      this.syncOnboardingGuide()
    })
  },
  openHandComment(e) {
    const handId = e.currentTarget.dataset.id
    if (!handId) return
    const hand = (this.data.hands || []).find(item => item && item._id === handId)
    if (!hand) return
    if (!hand.canHandComment) {
      wx.showToast({ title: '\u5b8c\u6210\u590d\u76d8\u540e\u53ef\u8bc4\u8bba', icon: 'none' })
      return
    }
    const comments = normalizeHandComments(hand)
    this.closeSwipedReviewItem()
    this.setData({
      handCommentVisible: true,
      handCommentHandId: handId,
      handCommentTitle: [hand.heroCardsInput || '手牌', hand.heroPosition || ''].filter(Boolean).join(' · '),
      handCommentDraft: '',
      handCommentItems: buildHandCommentViewItems(comments),
      handCommentSaving: false,
      touchMoved: false
    })
  },
  closeHandComment() {
    if (this.data.handCommentSaving) return
    this.setData({
      handCommentVisible: false,
      handCommentHandId: '',
      handCommentTitle: '',
      handCommentDraft: '',
      handCommentItems: []
    })
  },
  onHandCommentInput(e) {
    this.setData({ handCommentDraft: e.detail.value || '' })
  },
  async saveHandComment() {
    const handId = this.data.handCommentHandId
    const text = String(this.data.handCommentDraft || '').trim()
    if (!handId) return
    if (!text) {
      wx.showToast({ title: '请输入评论内容', icon: 'none' })
      return
    }
    const hand = (this.data.hands || []).find(item => item && item._id === handId)
    if (!hand) return
    const nextComments = [{
      id: 'comment_' + Date.now(),
      text,
      createdAt: buildHandCommentTimestamp()
    }].concat(normalizeHandComments(hand))
    this.setData({ handCommentSaving: true })
    try {
      await dataService.updateHand(handId, { handComments: nextComments })
      wx.showToast({ title: '已保存评论', icon: 'success' })
      this.setData({
        handCommentVisible: false,
        handCommentHandId: '',
        handCommentTitle: '',
        handCommentDraft: '',
        handCommentItems: [],
        handCommentSaving: false
      })
      await this.refresh()
    } catch (error) {
      console.warn('save hand comment failed: ' + (error && (error.errMsg || error.message) || String(error)))
      this.setData({ handCommentSaving: false })
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
    }
  },
  closeHandReplay() {
    this.setData({
      replayVisible: false,
      replayData: null
    })
  },
  deleteHandFromList(e) {
    const handId = e.currentTarget.dataset.id
    if (!handId) return
    wx.showModal({
      title: '删除手牌',
      content: '\u5220\u9664\u540e\u672c\u624b\u724c\u548c\u76f8\u5173\u52a8\u4f5c\u8bb0\u5f55\u90fd\u4f1a\u79fb\u9664\uff0c\u662f\u5426\u7ee7\u7eed\uff1f',
      confirmText: '删除',
      confirmColor: '#dc2626',
      success: async res => {
        if (!res.confirm) return
        await dataService.deleteHand(handId)
        wx.showToast({ title: '\u5df2\u5220\u9664', icon: 'success' })
        this.closeSwipedReviewItem()
        if (this.data.detailHand && this.data.detailHand._id === handId) {
          this.closeHandDetail()
        }
        this.refresh()
      }
    })
  },
  closeHandDetail() {
    this.clearVoiceProgressTimer()
    const requestId = Number(this.data.voiceReviewRequestId || 0) + 1
    this.voiceNoteDraft = ''
    this.setData({
      detailVisible: false,
      detailLoading: false,
      detailHand: null,
      detailSession: null,
      detailActions: [],
      detailExportVisible: false,
      detailExportText: '',
      voicePanelVisible: false,
      voiceBusy: false,
      voiceRecording: false,
      voiceStatus: '',
      voiceNote: '',
      voiceNoteHasText: false,
      voiceNoteLength: 0,
      voiceCorrectionNote: '',
      parsedVoice: null,
      parsedVoiceSourceText: '',
      voiceNeedsRefresh: false,
      voiceReviewRequestId: requestId,
      voiceProgressVisible: false,
      voiceProgressPercent: 0
    })
  },
  stopModalTap() {},
  noop() {},
  getVoiceNoteDraft() {
    if (typeof this.voiceNoteDraft === 'string') return this.voiceNoteDraft
    return String(this.data.voiceNote || '')
  },
  setVoiceNoteDraft(value, extraPatch, callback) {
    const nextValue = String(value || '')
    this.voiceNoteDraft = nextValue
    this.setData(Object.assign({
      voiceNote: nextValue,
      voiceNoteHasText: !!nextValue.trim(),
      voiceNoteLength: nextValue.length
    }, extraPatch || {}), callback)
  },
  commitVoiceNoteDraft() {
    const nextValue = this.getVoiceNoteDraft()
    if (nextValue !== this.data.voiceNote) {
      this.setData({
        voiceNote: nextValue,
        voiceNoteHasText: !!nextValue.trim(),
        voiceNoteLength: nextValue.length
      })
    }
  },
  copyDetailHandId() {
    const handId = this.data.detailHand && this.data.detailHand._id
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
  openDetailExport() {
    const hand = this.data.detailHand
    if (!hand) {
      wx.showToast({ title: '没有可导出的手牌', icon: 'none' })
      return
    }
    const exportText = this.data.detailExportText || handExport.buildPokerStarsExport(hand, {
      session: this.data.detailSession,
      actions: this.data.detailActions
    })
    this.setData({
      detailExportVisible: true,
      detailExportText: exportText
    })
  },
  closeDetailExport() {
    this.setData({ detailExportVisible: false })
  },
  copyDetailExportText() {
    const text = String(this.data.detailExportText || '')
    if (!text.trim()) {
      wx.showToast({ title: '没有可复制的导出文本', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: text,
      success() {
        wx.showToast({ title: '导出文本已复制', icon: 'success' })
      }
    })
  },
  onVoiceNoteInput(e) {
    const nextValue = String(e.detail.value || '')
    this.voiceNoteDraft = nextValue
    const sourceText = String(this.data.parsedVoiceSourceText || '').trim()
    const changedAfterParse =
      !!this.data.parsedVoice && String(nextValue || '').trim() !== sourceText

    this.setData({
      voiceNoteHasText: !!nextValue.trim(),
      voiceNoteLength: nextValue.length,
      parsedVoice: changedAfterParse ? null : this.data.parsedVoice,
      parsedVoiceSourceText: changedAfterParse ? '' : this.data.parsedVoiceSourceText,
      voiceNeedsRefresh: changedAfterParse,
      voiceStatus: changedAfterParse
        ? '\u6587\u672c\u5df2\u4fee\u6539\uff0c\u8bf7\u91cd\u65b0\u53d1\u9001\u89e3\u6790\u540e\u518d\u786e\u8ba4\u56de\u586b'
        : this.data.voiceStatus
    })
  },
  handleVoiceEntry() {
    this.setData({
      voicePanelVisible: true,
      voiceRecording: false,
      voiceStatus: '\u76f4\u63a5\u70b9\u8f93\u5165\u6846\uff0c\u7528\u7cfb\u7edf\u8bed\u97f3\u8f93\u5165\u6cd5\u8bf4\u8bdd\uff0c\u770b\u5230\u6587\u5b57\u540e\u6539\u4e00\u6539\u518d\u70b9\u53d1\u9001\u89e3\u6790\u3002'
    })
  },
  openDetailLedgerReview() {
    const handId = this.data.detailHand && this.data.detailHand._id
    if (!handId) return
    this.setData({
      detailVisible: false,
      voicePanelVisible: false,
      touchMoved: false
    })
    wx.navigateTo({ url: '/pages/hand-ledger-input/hand-ledger-input?handId=' + handId })
  },
  collapseVoicePanel() {
    this.setData({
      voicePanelVisible: false,
      voiceRecording: false
    })
  },
  showVoiceInputTip() {
    this.setData({
      voicePanelVisible: true,
      voiceStatus: '\u73b0\u5728\u53ef\u4ee5\u76f4\u63a5\u7528\u7cfb\u7edf\u8bed\u97f3\u8f93\u5165\u6cd5\u8bf4\u8bdd\u3002'
    })
  },
  useVoiceShortcut(e) {
    const text = String(e.currentTarget.dataset.text || '').trim()
    if (!text) return
    const current = String(this.getVoiceNoteDraft() || '').trim()
    const nextValue = current ? `${current}\n${text}` : text
    this.setVoiceNoteDraft(nextValue, {
      voicePanelVisible: true,
      parsedVoice: null,
      parsedVoiceSourceText: '',
      voiceNeedsRefresh: false,
      voiceStatus: '\u793a\u4f8b\u5df2\u586b\u5165\uff0c\u4f60\u53ef\u4ee5\u7ee7\u7eed\u6539\u5b8c\u518d\u53d1\u9001\u89e3\u6790\u3002'
    })
  },
  clearVoiceNote() {
    this.setVoiceNoteDraft('', {
      voiceCorrectionNote: '',
      parsedVoice: null,
      parsedVoiceSourceText: '',
      voiceNeedsRefresh: false,
      voiceStatus: '\u5df2\u6e05\u7a7a\uff0c\u91cd\u65b0\u8bf4\u6216\u91cd\u65b0\u8f93\u5165\u5373\u53ef\u3002'
    })
  },
  onParsedVoiceFieldInput(e) {
    const field = e.currentTarget.dataset.field
    const value = e.detail.value
    if (!field || !this.data.parsedVoice) return
    this.pendingParsedVoiceFields = this.pendingParsedVoiceFields || {}
    this.pendingParsedVoiceFields[field] = value
  },
  clearParsedVoiceFocus() {
    if (this.voiceFocusClearTimer) {
      clearTimeout(this.voiceFocusClearTimer)
      this.voiceFocusClearTimer = null
    }
    if (!this.data.parsedVoice) return
    this.setData({
      voiceFocusField: '',
      parsedVoice: applyParsedVoiceFocusState(this.data.parsedVoice, '')
    })
  },
  scheduleClearParsedVoiceFocus(field) {
    if (this.voiceFocusClearTimer) {
      clearTimeout(this.voiceFocusClearTimer)
    }
    const target = String(field || '')
    this.voiceFocusClearTimer = setTimeout(() => {
      this.voiceFocusClearTimer = null
      if (target && this.data.voiceFocusField && this.data.voiceFocusField !== target) return
      if (!this.data.parsedVoice) return
      this.setData({
        voiceFocusField: '',
        parsedVoice: applyParsedVoiceFocusState(this.data.parsedVoice, '')
      })
    }, 120)
  },
  commitParsedVoiceFieldValue(e) {
    const field = e.currentTarget.dataset.field
    const value = e.detail.value
    if (!field || !this.data.parsedVoice) return
    this.commitParsedVoiceField(field, value)
  },
  commitParsedVoiceField(field, value) {
    if (!field || !this.data.parsedVoice) return this.data.parsedVoice
    if (this.pendingParsedVoiceFields) {
      delete this.pendingParsedVoiceFields[field]
    }
    const nextParsed = setParsedVoiceDraftField(this.data.parsedVoice, field, value)
    const parsedVoice = buildParsedVoicePreview(nextParsed, {
      provider: nextParsed.provider || nextParsed.providerText || '',
      naturalLanguageSummary: nextParsed.feedbackText || nextParsed.naturalLanguageSummary || '',
      missingFields: nextParsed.missingFields || [],
      followUpQuestions: nextParsed.followUpQuestions || []
    })
    this.setData({
      parsedVoice,
      voiceNeedsRefresh: false,
      voiceStatus: '\u5df2\u6309\u4f60\u7684\u7f16\u8f91\u66f4\u65b0\u5f85\u56de\u586b\u5b57\u6bb5\u3002'
    })
    return parsedVoice
  },
  commitPendingParsedVoiceFields() {
    const pending = this.pendingParsedVoiceFields || {}
    const fields = Object.keys(pending)
    if (!fields.length || !this.data.parsedVoice) return this.data.parsedVoice
    let nextParsed = this.data.parsedVoice
    fields.forEach(field => {
      nextParsed = setParsedVoiceDraftField(nextParsed, field, pending[field])
    })
    this.pendingParsedVoiceFields = {}
    const parsedVoice = applyParsedVoiceFocusState(buildParsedVoicePreview(nextParsed, {
      provider: nextParsed.provider || nextParsed.providerText || '',
      naturalLanguageSummary: nextParsed.feedbackText || nextParsed.naturalLanguageSummary || '',
      missingFields: nextParsed.missingFields || [],
      followUpQuestions: nextParsed.followUpQuestions || []
    }), '')
    this.clearParsedVoiceFocus()
    this.setData({
      parsedVoice,
      voiceNeedsRefresh: false,
      voiceStatus: '\u5df2\u6309\u4f60\u7684\u7f16\u8f91\u66f4\u65b0\u5f85\u56de\u586b\u5b57\u6bb5\u3002'
    })
    return parsedVoice
  },
  onParsedVoiceToggleChange(e) {
    const field = e.currentTarget.dataset.field
    if (!field || !this.data.parsedVoice) return
    const rawValue = e.detail && Array.isArray(e.detail.value)
      ? e.detail.value.indexOf('1') > -1
      : !!(e.detail && e.detail.value)
    const nextParsed = setParsedVoiceDraftField(this.data.parsedVoice, field, rawValue)
    const parsedVoice = applyParsedVoiceFocusState(buildParsedVoicePreview(nextParsed, {
      provider: nextParsed.provider || nextParsed.providerText || '',
      naturalLanguageSummary: nextParsed.feedbackText || nextParsed.naturalLanguageSummary || '',
      missingFields: nextParsed.missingFields || [],
      followUpQuestions: nextParsed.followUpQuestions || []
    }), '')
    this.clearParsedVoiceFocus()
    this.setData({
      parsedVoice,
      voiceNeedsRefresh: false,
      voiceStatus: '\u5df2\u6309\u4f60\u7684\u7f16\u8f91\u66f4\u65b0\u5f85\u56de\u586b\u5b57\u6bb5\u3002'
    })
  },
  selectVoiceStraddleOption(e) {
    if (!this.data.parsedVoice) return
    const rawValue = String(e.currentTarget.dataset.value || '') === '1'
    const nextParsed = setParsedVoiceDraftField(this.data.parsedVoice, 'hasStraddle', rawValue)
    const parsedVoice = buildParsedVoicePreview(nextParsed, {
      provider: nextParsed.provider || nextParsed.providerText || '',
      naturalLanguageSummary: nextParsed.feedbackText || nextParsed.naturalLanguageSummary || '',
      missingFields: nextParsed.missingFields || [],
      followUpQuestions: nextParsed.followUpQuestions || []
    })
    this.setData({
      parsedVoice,
      voiceNeedsRefresh: false,
      voiceStatus: '\u5df2\u9009\u62e9\u662f\u5426 Straddle\u3002'
    })
  },
  onVoiceCorrectionInput(e) {
    this.setData({ voiceCorrectionNote: e.detail.value })
  },
  focusVoiceField(field) {
    field = String(field || '').trim()
    if (!field || field === 'voiceNote') return
    const focusPatch = {
      voiceFocusField: field,
      voiceStraddleMissingClass: field === 'hasStraddle' ? 'voice-field-missing' : '',
      parsedVoice: applyParsedVoiceFocusState(this.data.parsedVoice, field)
    }
    if (field === 'stakeLevel' || field === 'heroPosition' || field === 'villainPosition' || field === 'opponentType') {
      this.setData(focusPatch)
      this.scheduleClearParsedVoiceFocus(field)
      this.openVoicePresetSelector({ currentTarget: { dataset: { field } } })
      return
    }
    if (field === 'heroCardsInput') {
      this.setData(focusPatch)
      this.scheduleClearParsedVoiceFocus(field)
      this.openVoiceHeroPicker()
      return
    }
    if (field === 'board.flop') {
      this.setData(focusPatch)
      this.scheduleClearParsedVoiceFocus(field)
      this.openVoiceBoardPicker({ currentTarget: { dataset: { key: 'flop' } } })
      return
    }
    if (field === 'board.turn') {
      this.setData(focusPatch)
      this.scheduleClearParsedVoiceFocus(field)
      this.openVoiceBoardPicker({ currentTarget: { dataset: { key: 'turn' } } })
      return
    }
    if (field === 'board.river') {
      this.setData(focusPatch)
      this.scheduleClearParsedVoiceFocus(field)
      this.openVoiceBoardPicker({ currentTarget: { dataset: { key: 'river' } } })
      return
    }
    this.setData({
      voiceFocusField: '',
      voiceStraddleMissingClass: field === 'hasStraddle' ? 'voice-field-missing' : '',
      parsedVoice: applyParsedVoiceFocusState(this.data.parsedVoice, ''),
      voiceStatus: '\u8bf7\u76f4\u63a5\u8865\u5145\u201c' + field + '\u201d\u5bf9\u5e94\u5b57\u6bb5\u3002'
    }, () => {
      this.setData({
        voiceFocusField: field,
        voiceStraddleMissingClass: field === 'hasStraddle' ? 'voice-field-missing' : '',
        parsedVoice: applyParsedVoiceFocusState(this.data.parsedVoice, field)
      })
      this.scheduleClearParsedVoiceFocus(field)
    })
  },
  focusMissingField(e) {
    this.focusVoiceField(e.currentTarget.dataset.field)
  },
  validateVoiceRequiredFields() {
    this.commitPendingParsedVoiceFields()
    const missingItems = buildVoiceRequiredMissingItems(this.data.parsedVoice)
    if (!missingItems.length) return true
    const first = missingItems[0]
    const parsedVoice = Object.assign({}, this.data.parsedVoice, {
      confirmItems: missingItems,
      missingFields: missingItems.map(item => item.label),
      missingFieldsText: missingItems.map(item => item.label).join(' \u00b7 ')
    })
    this.setData({
      parsedVoice,
      voiceStatus: '\u8bf7\u5148\u8865\u5145\u5fc5\u586b\u5b57\u6bb5\uff1a' + first.label
    }, () => {
      this.focusVoiceField(first.field)
    })
    wx.showToast({ title: '\u8bf7\u8865\u5145\uff1a' + first.label, icon: 'none' })
    return false
  },
  reparseVoiceWithCorrection() {
    const confirmedParsed = this.commitPendingParsedVoiceFields()
    const correction = String(this.data.voiceCorrectionNote || '').trim()
    if (!correction && !confirmedParsed) {
      wx.showToast({ title: '\u8bf7\u5148\u8865\u5145\u5b57\u6bb5\u6216\u8f93\u5165\u4fee\u6b63\u5185\u5bb9', icon: 'none' })
      return
    }
    const base = String(this.getVoiceNoteDraft() || '').trim()
    const correctionPayload = {
      source: 'miniapp_voice_review_text_correction',
      transcript: base,
      correctionText: buildVoiceCorrectionText(
        correction,
        confirmedParsed && confirmedParsed.confirmItems
      ),
      originalHand: this.data.detailHand || null,
      confirmedHand: confirmedParsed || null,
      confirmedAt: Date.now()
    }
    this.setData({
      voiceCorrectionNote: '',
      parsedVoice: null,
      voiceNeedsRefresh: false,
      voiceStatus: '已加入修正信息，正在重新解析...'
    }, () => {
      this.runVoiceReview({
        voiceNote: base || correction,
        displayVoiceNote: base,
        corrections: correctionPayload,
        silentSuccess: true
      })
    })
  },
  refreshParsedVoiceDraft(nextParsed, extraPatch) {
    const parsedVoice = buildParsedVoicePreview(nextParsed, {
      provider: nextParsed.provider || nextParsed.providerText || '',
      naturalLanguageSummary: nextParsed.feedbackText || nextParsed.naturalLanguageSummary || '',
      missingFields: nextParsed.missingFields || [],
      followUpQuestions: nextParsed.followUpQuestions || []
    })
    this.setData(Object.assign({
      parsedVoice,
      voiceNeedsRefresh: false,
      voiceStatus: '\u5df2\u6309\u4f60\u7684\u7f16\u8f91\u66f4\u65b0\u5f85\u56de\u586b\u5b57\u6bb5\u3002'
    }, extraPatch || {}))
  },
  openVoicePresetSelector(e) {
    const key = e.currentTarget.dataset.field
    const parsed = this.data.parsedVoice || {}
    let options = []
    let title = ''
    if (key === 'stakeLevel') {
      options = this.data.blindPresets
      title = '选择级别'
    } else if (key === 'heroPosition') {
      options = handDetailFields.getPositionOptions(this.data.positions, parsed.hasStraddle)
      title = '选择 Hero 位置'
    } else if (key === 'villainPosition') {
      options = handDetailFields.getPositionOptions(this.data.positions, parsed.hasStraddle)
      title = '选择对手位置'
    } else if (key === 'opponentType') {
      options = this.data.opponentTypes
      title = '选择对手类型'
    }
    if (!options.length) {
      wx.showToast({ title: '暂无预设选项', icon: 'none' })
      return
    }
    this.setData({
      voiceSelectorVisible: true,
      voiceSelectorTitle: title,
      voiceSelectorKey: key,
      voiceSelectorOptions: buildSelectorOptions(options, parsed[key])
    })
  },
  closeVoiceSelector() {
    this.setData({ voiceSelectorVisible: false })
  },
  selectVoicePresetOption(e) {
    const key = this.data.voiceSelectorKey
    const value = String(e.currentTarget.dataset.value || '')
    if (!key || !this.data.parsedVoice) return
    const nextParsed = setParsedVoiceDraftField(this.data.parsedVoice, key, value)
    this.refreshParsedVoiceDraft(nextParsed, { voiceSelectorVisible: false })
  },
  openVoiceHeroPicker() {
    const parsed = this.data.parsedVoice
    if (!parsed) return
    this.setData({
      voiceHeroPickerVisible: true,
      voiceHeroReplaceIndex: -1,
      voiceHeroPickerHint: '\u5df2\u9009 ' + cardUi.parseHeroCardsInput(parsed.heroCardsInput).length + ' / 2 \u5f20',
      voiceHeroPickerPreview: cardUi.parseHeroCardsInput(parsed.heroCardsInput),
      voiceHeroPickerDeck: buildVoiceHeroPickerDeck(parsed)
    })
  },
  closeVoiceHeroPicker() {
    this.setData({ voiceHeroPickerVisible: false, voiceHeroReplaceIndex: -1 })
  },
  syncVoiceHeroCards(value) {
    const normalized = parseHeroCardsInput(value)
      .slice(0, 2)
      .map(function (item) {
        return item[0].toUpperCase() + item[1].toLowerCase()
      })
      .join('')
    const nextParsed = setParsedVoiceDraftField(this.data.parsedVoice, 'heroCardsInput', normalized)
    const extraPatch = {
      voiceHeroPickerHint: '\u5df2\u9009 ' + cardUi.parseHeroCardsInput(normalized).length + ' / 2 \u5f20',
      voiceHeroPickerPreview: cardUi.parseHeroCardsInput(normalized),
      voiceHeroPickerDeck: buildVoiceHeroPickerDeck(nextParsed),
      voiceShowdownPickerDeck: buildVoiceShowdownPickerDeck(nextParsed)
    }
    if (this.data.voiceBoardPickerVisible && this.data.voiceBoardPickerKey) {
      extraPatch.voiceBoardPickerDeck = buildVoiceBoardPickerDeck(nextParsed, this.data.voiceBoardPickerKey)
      extraPatch.voiceBoardPickerHint = buildVoiceBoardPickerHint(nextParsed, this.data.voiceBoardPickerKey)
      extraPatch.voiceBoardPickerPreview = buildVoiceBoardPickerPreview(nextParsed, this.data.voiceBoardPickerKey)
    }
    this.refreshParsedVoiceDraft(nextParsed, extraPatch)
  },
  pickVoiceHeroCard(e) {
    const token = e.currentTarget.dataset.token
    const disabled = !!e.currentTarget.dataset.disabled
    if (!token || disabled || !this.data.parsedVoice) return
    const selected = parseHeroCardsInput(this.data.parsedVoice.heroCardsInput)
      .slice(0, 2)
      .map(function (item) {
        return item[0].toUpperCase() + item[1].toLowerCase()
      })
    const existsIndex = selected.indexOf(token)
    const replaceIndex = Number(this.data.voiceHeroReplaceIndex)
    let next = selected
    if (replaceIndex >= 0 && replaceIndex < 2) {
      next = replaceTokenAt(selected, replaceIndex, token, 2)
    } else {
      next = existsIndex > -1
        ? selected.filter(function (item) { return item !== token })
        : selected.concat(token).slice(0, 2)
    }
    this.syncVoiceHeroCards(next.join(''))
    if (replaceIndex >= 0 || next.length >= 2) {
      this.setData({ voiceHeroPickerVisible: false, voiceHeroReplaceIndex: -1 })
    }
  },
  selectVoiceHeroReplaceCard(e) {
    const index = Number(e.currentTarget.dataset.index)
    this.setData({
      voiceHeroReplaceIndex: Number.isNaN(index) ? -1 : index,
      voiceHeroPickerHint: '\u6b63\u5728\u66ff\u6362\u7b2c ' + (index + 1) + ' \u5f20'
    })
  },
  handleVoiceHeroPickerTool(e) {
    const action = e.currentTarget.dataset.action
    const selected = parseHeroCardsInput(this.data.parsedVoice && this.data.parsedVoice.heroCardsInput)
      .slice(0, 2)
      .map(function (item) {
        return item[0].toUpperCase() + item[1].toLowerCase()
      })
    const next = action === 'clear' ? [] : action === 'backspace' ? selected.slice(0, -1) : selected
    this.syncVoiceHeroCards(next.join(''))
  },
  openVoiceShowdownPicker() {
    const parsed = this.data.parsedVoice
    if (!parsed) return
    this.setData({
      voiceShowdownPickerVisible: true,
      voiceShowdownPickerHint: '\u5df2\u9009 ' + cardUi.parseHeroCardsInput(parsed.showdown).length + ' / 2 \u5f20',
      voiceShowdownPickerPreview: cardUi.parseOpponentCardsInput(parsed.showdown, {
        board: parsed.board,
        heroCardsInput: parsed.heroCardsInput
      }),
      voiceShowdownPickerDeck: buildVoiceShowdownPickerDeck(parsed)
    })
  },
  closeVoiceShowdownPicker() {
    this.setData({ voiceShowdownPickerVisible: false })
  },
  syncVoiceShowdownCards(value) {
    const normalized = parseHeroCardsInput(value)
      .slice(0, 2)
      .map(function (item) {
        return item[0].toUpperCase() + item[1].toLowerCase()
      })
      .join('')
    let nextParsed = setParsedVoiceDraftField(this.data.parsedVoice, 'showdown', normalized)
    nextParsed = setParsedVoiceDraftField(nextParsed, 'opponentCards', normalized)
    nextParsed = setParsedVoiceDraftField(nextParsed, 'opponentCardsSource', normalized ? 'manual' : '')
    this.refreshParsedVoiceDraft(nextParsed, {
      voiceShowdownPickerHint: '\u5df2\u9009 ' + cardUi.parseHeroCardsInput(normalized).length + ' / 2 \u5f20',
      voiceShowdownPickerPreview: cardUi.parseOpponentCardsInput(normalized, {
        board: nextParsed.board,
        heroCardsInput: nextParsed.heroCardsInput
      }),
      voiceShowdownPickerDeck: buildVoiceShowdownPickerDeck(nextParsed),
      voiceHeroPickerDeck: buildVoiceHeroPickerDeck(nextParsed)
    })
  },
  pickVoiceShowdownCard(e) {
    const token = e.currentTarget.dataset.token
    const disabled = !!e.currentTarget.dataset.disabled
    if (!token || disabled || !this.data.parsedVoice) return
    const selected = parseHeroCardsInput(this.data.parsedVoice.showdown)
      .slice(0, 2)
      .map(function (item) {
        return item[0].toUpperCase() + item[1].toLowerCase()
      })
    const existsIndex = selected.indexOf(token)
    const next = existsIndex > -1
      ? selected.filter(function (item) { return item !== token })
      : selected.concat(token).slice(0, 2)
    this.syncVoiceShowdownCards(next.join(''))
    if (next.length >= 2) {
      this.setData({ voiceShowdownPickerVisible: false })
    }
  },
  handleVoiceShowdownPickerTool(e) {
    const action = e.currentTarget.dataset.action
    const selected = parseHeroCardsInput(this.data.parsedVoice && this.data.parsedVoice.showdown)
      .slice(0, 2)
      .map(function (item) {
        return item[0].toUpperCase() + item[1].toLowerCase()
      })
    const next = action === 'clear' ? [] : action === 'backspace' ? selected.slice(0, -1) : selected
    this.syncVoiceShowdownCards(next.join(''))
  },
  openVoiceBoardPicker(e) {
    const boardKeys = ['flop', 'turn', 'river']
    const index = Number(e.currentTarget.dataset.index)
    const key = e.currentTarget.dataset.key || boardKeys[index] || 'flop'
    const meta = BOARD_FIELD_META[key]
    if (!meta || !this.data.parsedVoice) return
    const replaceIndex = Number(e.currentTarget.dataset.replaceIndex)
    const normalizedReplaceIndex = !Number.isNaN(replaceIndex) && replaceIndex >= 0 && replaceIndex < meta.limit
      ? replaceIndex
      : -1
    this.setData({
      voiceBoardPickerVisible: true,
      voiceBoardPickerKey: key,
      voiceBoardReplaceIndex: normalizedReplaceIndex,
      voiceBoardPickerTitle: meta.label,
      voiceBoardPickerHint: normalizedReplaceIndex >= 0
        ? '\u6b63\u5728\u66ff\u6362\u7b2c ' + (normalizedReplaceIndex + 1) + ' \u5f20'
        : buildVoiceBoardPickerHint(this.data.parsedVoice, key),
      voiceBoardPickerPreview: buildVoiceBoardPickerPreview(this.data.parsedVoice, key),
      voiceBoardPickerDeck: buildVoiceBoardPickerDeck(this.data.parsedVoice, key)
    })
  },
  closeVoiceBoardPicker() {
    this.setData({ voiceBoardPickerVisible: false, voiceBoardReplaceIndex: -1 })
  },
  syncVoiceBoardField(key, rawValue) {
    const meta = BOARD_FIELD_META[key]
    if (!meta || !this.data.parsedVoice) return
    const normalized = normalizeCardsValue(rawValue, meta.limit)
    const nextParsed = setParsedVoiceDraftField(this.data.parsedVoice, 'board.' + key, normalized)
    const extraPatch = {
      voiceBoardPickerHint: buildVoiceBoardPickerHint(nextParsed, key),
      voiceBoardPickerPreview: buildVoiceBoardPickerPreview(nextParsed, key),
      voiceBoardPickerDeck: buildVoiceBoardPickerDeck(nextParsed, key),
      voiceHeroPickerDeck: buildVoiceHeroPickerDeck(nextParsed),
      voiceShowdownPickerDeck: buildVoiceShowdownPickerDeck(nextParsed)
    }
    this.refreshParsedVoiceDraft(nextParsed, extraPatch)
  },
  pickVoiceBoardCard(e) {
    const token = e.currentTarget.dataset.token
    const disabled = !!e.currentTarget.dataset.disabled
    const key = this.data.voiceBoardPickerKey
    const meta = BOARD_FIELD_META[key]
    if (!token || !meta || disabled || !this.data.parsedVoice) return
    const selected = cardUi.parseCardsInput((this.data.parsedVoice.board || {})[key], meta.limit)
      .map(function (card) {
        return card.rank + card.suit
      })
    const existsIndex = selected.indexOf(token)
    const replaceIndex = Number(this.data.voiceBoardReplaceIndex)
    let next = selected
    if (replaceIndex >= 0 && replaceIndex < meta.limit) {
      next = replaceTokenAt(selected, replaceIndex, token, meta.limit)
    } else if (meta.limit === 1) {
      next = existsIndex > -1 ? [] : [token]
    } else {
      next = existsIndex > -1
        ? selected.filter(function (item) { return item !== token })
        : selected.concat(token).slice(0, meta.limit)
    }
    this.syncVoiceBoardField(key, next.join(''))
    if (replaceIndex >= 0 || next.length >= meta.limit) {
      this.setData({ voiceBoardPickerVisible: false, voiceBoardReplaceIndex: -1 })
    }
  },
  selectVoiceBoardReplaceCard(e) {
    const index = Number(e.currentTarget.dataset.index)
    this.setData({
      voiceBoardReplaceIndex: Number.isNaN(index) ? -1 : index,
      voiceBoardPickerHint: '\u6b63\u5728\u66ff\u6362\u7b2c ' + (index + 1) + ' \u5f20'
    })
  },
  handleVoiceBoardPickerTool(e) {
    const action = e.currentTarget.dataset.action
    const key = this.data.voiceBoardPickerKey
    const meta = BOARD_FIELD_META[key]
    if (!meta || !this.data.parsedVoice) return
    const selected = cardUi.parseCardsInput((this.data.parsedVoice.board || {})[key], meta.limit)
      .map(function (card) {
        return card.rank + card.suit
      })
    const next = action === 'clear' ? [] : action === 'backspace' ? selected.slice(0, -1) : selected
    this.syncVoiceBoardField(key, next.join(''))
  },
  parseVoiceNote() {
    const confirmedParsed = this.commitPendingParsedVoiceFields()
    if (confirmedParsed) {
      return this.runVoiceReview({
        voiceNote: this.getVoiceNoteDraft(),
        displayVoiceNote: this.getVoiceNoteDraft(),
        corrections: buildAgentCorrectionPayload(
          this.data.detailHand,
          confirmedParsed,
          this.getVoiceNoteDraft()
        ),
        silentSuccess: true
      })
    }
    return this.runVoiceReview()
  },
  clearVoiceProgressTimer() {
    if (this.voiceProgressTimer) {
      clearTimeout(this.voiceProgressTimer)
      this.voiceProgressTimer = null
    }
  },
  startVoiceProgress(requestId) {
    this.clearVoiceProgressTimer()
    const startedAt = Date.now()
    const percent = getVoiceProgressPercent(startedAt, startedAt)
    this.setData({
      voiceProgressVisible: true,
      voiceProgressStartedAt: startedAt,
      voiceProgressPercent: percent,
      voiceProgressStep: VOICE_PROGRESS_STEPS[0],
      voiceProgressSteps: buildVoiceProgressSteps(percent)
    })
    this.queueVoiceProgressTick(requestId)
  },
  queueVoiceProgressTick(requestId) {
    this.clearVoiceProgressTimer()
    this.voiceProgressTimer = setTimeout(() => {
      if (this.data.voiceReviewRequestId !== requestId || !this.data.voiceProgressVisible) return
      const next = getVoiceProgressPercent(this.data.voiceProgressStartedAt, Date.now())
      const stepIndex = Math.min(
        VOICE_PROGRESS_STEPS.length - 1,
        Math.floor(next / 25)
      )
      this.setData({
        voiceProgressPercent: next,
        voiceProgressStep: VOICE_PROGRESS_STEPS[stepIndex],
        voiceProgressSteps: buildVoiceProgressSteps(next)
      })
      this.queueVoiceProgressTick(requestId)
    }, 520)
  },
  finishVoiceProgress(requestId, failed) {
    this.clearVoiceProgressTimer()
    if (this.data.voiceReviewRequestId !== requestId) return Promise.resolve(false)
    const nextPercent = failed ? Math.max(Number(this.data.voiceProgressPercent || 0), 92) : 100
    this.setData({
      voiceProgressVisible: true,
      voiceProgressPercent: nextPercent,
      voiceProgressSteps: buildVoiceProgressSteps(nextPercent),
      voiceProgressStep: failed
        ? '\u89e3\u6790\u5931\u8d25\uff0c\u5df2\u505c\u6b62'
        : '\u5b8c\u6210\u8bc6\u522b\uff0c\u6b63\u5728\u5c55\u5f00\u7ed3\u679c'
    })
    return new Promise(resolve => {
      this.voiceProgressTimer = setTimeout(() => {
        if (this.data.voiceReviewRequestId !== requestId) {
          resolve(false)
          return
        }
        this.voiceProgressTimer = null
        this.setData({ voiceProgressVisible: false }, () => resolve(true))
      }, failed ? 260 : 360)
    })
  },
  async runVoiceReview(options) {
    const config = options || {}
    const voiceNote = String(
      config.voiceNote != null ? config.voiceNote : this.getVoiceNoteDraft() || ''
    ).trim()
    const displayVoiceNote = String(
      config.displayVoiceNote != null ? config.displayVoiceNote : voiceNote
    ).trim()
    if (!voiceNote) {
      wx.showToast({ title: '\u8bf7\u5148\u5f55\u97f3\u6216\u8f93\u5165\u6587\u672c', icon: 'none' })
      return
    }
    this.voiceNoteDraft = displayVoiceNote
    const requestId = Number(this.data.voiceReviewRequestId || 0) + 1
    this.setData({
      voiceReviewRequestId: requestId,
      voicePanelVisible: true,
      voiceNote: displayVoiceNote,
      voiceNoteHasText: !!displayVoiceNote,
      voiceNoteLength: displayVoiceNote.length,
      voiceBusy: true,
      parsedVoice: null,
      parsedVoiceSourceText: '',
      voiceNeedsRefresh: false,
      voiceStatus: '\u6b63\u5728\u8c03\u7528 AI \u751f\u6210\u8bed\u97f3\u590d\u76d8\u5b57\u6bb5\u5efa\u8bae...'
    })
    this.startVoiceProgress(requestId)

    try {
      const result = await aiService.reviewHandVoice(
        buildReviewRequest(
          this.data.detailHand,
          this.data.detailSession,
          this.data.detailActions,
          voiceNote,
          {
            mode: 'extract',
            corrections: config.corrections || null
          }
        )
      )
      if (this.data.voiceReviewRequestId !== requestId) return
      const parseSourceText = displayVoiceNote
      const partial = result.code && result.code !== 0
      if (partial) {
        const error = new Error(result.message || '\u4e91\u7aef\u89e3\u6790\u5931\u8d25')
        error.code = result.code
        error.raw = result
        throw error
      }
      if (!hasUsefulVoiceFields(result.extractedHand)) {
        const error = new Error('\u4e91\u7aef\u672a\u8fd4\u56de\u6709\u6548\u89e3\u6790\u5b57\u6bb5')
        error.code = 'EMPTY_AI_FIELDS'
        error.raw = result
        throw error
      }
      const parsedVoice = buildParsedVoicePreview(
        normalizeParsedVoice(result.extractedHand, result, parseSourceText, this.data.detailHand, this.data.detailSession),
        result
      )
      const cleanedText = String(result.cleanedTranscript || '').trim()
      const keptOriginalText = !!cleanedText && cleanedText !== displayVoiceNote
      const shouldApplyResult = await this.finishVoiceProgress(requestId, false)
      if (!shouldApplyResult) return
      this.voiceNoteDraft = displayVoiceNote
      this.setData({
        voiceBusy: false,
        voiceNote: displayVoiceNote,
        voiceNoteHasText: !!displayVoiceNote.trim(),
        voiceNoteLength: displayVoiceNote.length,
        parsedVoice,
        parsedVoiceSourceText: displayVoiceNote,
        voiceNeedsRefresh: false,
        voiceStatus: keptOriginalText
          ? 'AI \u5df2\u751f\u6210\u5b57\u6bb5\u5efa\u8bae\uff0c\u539f\u59cb\u53e3\u8ff0\u5df2\u4fdd\u7559\u672a\u6539\u5199'
          : 'AI \u5df2\u751f\u6210\u5b57\u6bb5\u5efa\u8bae\uff0c\u8bf7\u786e\u8ba4\u540e\u56de\u586b'
      })
      if (!config.silentSuccess) {
        wx.showToast({
          title: '\u8bed\u97f3\u590d\u76d8\u5df2\u751f\u6210',
          icon: 'success'
        })
      }
    } catch (error) {
      if (this.data.voiceReviewRequestId !== requestId) return
      console.warn('voice review failed: ' + (error && (error.errMsg || error.message) || String(error)))
      await this.finishVoiceProgress(requestId, true)
      this.setData({
        voiceBusy: false,
        voiceStatus: '\u4e91\u7aef\u89e3\u6790\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002\u539f\u59cb\u53e3\u8ff0\u5df2\u4fdd\u7559\uff0c\u4e0d\u4f1a\u81ea\u52a8\u5207\u6362\u6210\u672c\u5730\u89e3\u6790\u3002'
      })
      wx.showToast({ title: '\u4e91\u7aef\u89e3\u6790\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5', icon: 'none' })
    }
  },
  async applyVoicePatch() {
    if (!this.data.detailHand || !this.data.parsedVoice) {
      wx.showToast({ title: '\u6682\u65e0\u53ef\u56de\u586b\u5185\u5bb9', icon: 'none' })
      return
    }
    this.commitPendingParsedVoiceFields()
    if (String(this.data.voiceCorrectionNote || '').trim()) {
      this.reparseVoiceWithCorrection()
      return
    }
    if (!this.validateVoiceRequiredFields()) return
    const handId = this.data.detailHand._id
    const voiceNote = this.getVoiceNoteDraft()
    this.commitVoiceNoteDraft()
    const correction = buildAgentCorrectionPayload(this.data.detailHand, this.data.parsedVoice, voiceNote)
    this.setData({ voiceBusy: true, voiceStatus: '\u6b63\u5728\u56de\u586b\u5e76\u540c\u6b65\u8fd9\u624b\u724c...' })
    let voicePatch = buildVoicePatch(this.data.detailHand, this.data.parsedVoice, voiceNote)
    voicePatch = await maybeAttachVoiceAllInEv(voicePatch, this.data.detailSession)
    let cloudSynced = false
    let cloudSyncError = ''
    try {
      const saveResult = await dataService.updateHandWithCloudSync(
        handId,
        voicePatch,
        'sync voice backfill hand failed'
      )
      cloudSynced = !!(saveResult && saveResult.cloudSynced)
      cloudSyncError = String(saveResult && saveResult.cloudSyncError || '').trim()
    } catch (error) {
      const saveErrorText = String(error && (error.errMsg || error.message) || error || '').trim()
      console.warn('voice backfill save failed: ' + saveErrorText)
      this.setData({
        voiceBusy: false,
        voiceStatus: '\u56de\u586b\u4fdd\u5b58\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5\u3002' + (saveErrorText ? '\n' + saveErrorText.slice(0, 80) : '')
      })
      wx.showToast({
        title: saveErrorText ? ('\u4fdd\u5b58\u5931\u8d25\uff1a' + saveErrorText).slice(0, 18) : '\u4fdd\u5b58\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5',
        icon: 'none'
      })
      return
    }
    this.setData({
      voicePanelVisible: false,
      voiceBusy: false,
      voiceStatus: cloudSynced
        ? '\u8bed\u97f3\u590d\u76d8\u5df2\u4fdd\u5b58\u5e76\u540c\u6b65\uff0cEV\u8111\u6b63\u5728\u751f\u6210\u5efa\u8bae...'
        : '\u8bed\u97f3\u590d\u76d8\u5df2\u4fdd\u5b58\uff0c\u4f46\u4e91\u540c\u6b65\u672a\u786e\u8ba4\uff1a' + (cloudSyncError || '\u672a\u8fd4\u56de\u5177\u4f53\u539f\u56e0') + '\uff1bEV\u8111\u4ecd\u4f1a\u751f\u6210\u5efa\u8bae...'
    })
    wx.showToast({
      title: cloudSynced ? '\u4fdd\u5b58\u5e76\u540c\u6b65\u6210\u529f' : ('\u4e91\u540c\u6b65\u672a\u786e\u8ba4\uff1a' + (cloudSyncError || '\u672a\u8fd4\u56de\u539f\u56e0')).slice(0, 18),
      icon: 'none'
    })

    this.refresh()
      .then(() => this.loadHandDetail(handId))
      .catch(error => {
        console.warn('voice backfill refresh failed: ' + (error && (error.errMsg || error.message) || String(error)))
      })
    this.generateVoiceAdvice(handId, voiceNote, correction, this.data.detailSession, this.data.detailActions)
  },
  applyAiReviewPatchToVisibleHand(handId, patch) {
    if (!handId || !patch) return
    const chipUnit = this.data.chipUnit
    const swipedHandId = this.data.swipedHandId
    const buildPatchedHand = hand => Object.assign({}, hand || {}, patch || {})
    const hands = (this.data.hands || []).map(item => {
      if (!item || item._id !== handId) return item
      return buildReviewListHandView(buildPatchedHand(item), chipUnit, swipedHandId)
    })
    const nextData = { hands }
    if (this.data.detailHand && this.data.detailHand._id === handId) {
      nextData.detailHand = buildDetailHandView(buildPatchedHand(this.data.detailHand), chipUnit)
    }
    if (this.data.aiAdviceSheetHand && this.data.aiAdviceSheetHand._id === handId) {
      const sheetHand = buildReviewListHandView(buildPatchedHand(this.data.aiAdviceSheetHand), chipUnit, swipedHandId)
      nextData.aiAdviceSheetHand = sheetHand
      nextData.aiAdviceSheetView = sheetHand.aiReviewView || buildAiReviewView(sheetHand.aiReview, sheetHand)
    }
    this.setData(nextData)
  },
  async generateVoiceAdvice(handId, voiceNote, correction, detailSession, detailActions) {
    try {
      const savedHand = ledgerDerived.withLedgerDerivedFields(await dataService.getHandById(handId))
      const result = await aiService.reviewHandVoice(
        buildReviewRequest(
          savedHand,
          detailSession,
          detailActions,
          voiceNote,
          {
            mode: 'advice',
            corrections: correction
          }
        )
      )
      if (result.code && result.code !== 0) {
        const error = new Error(result.message || 'EV脑 advice failed')
        error.code = result.code
        error.raw = result
        error.requestId = result.requestId || ''
        throw error
      }
      const aiReview = attachAiReviewMeta(result.analysis || null, savedHand)
      const aiReviewError = result && (
        result.aiReviewError ||
        result.debugError ||
        result.message ||
        result.answer ||
        result.data && result.data.message ||
        result.data && result.data.error
      ) || 'EV脑出问题啦，请稍后再重新生成AI建议。'
      const aiReviewPatch = {
        aiReview,
        aiReviewStatus: aiReview ? 'ready' : 'failed',
        aiReviewGeneratedAt: Date.now(),
        aiReviewError: aiReview ? '' : aiReviewError
      }
      this.applyAiReviewPatchToVisibleHand(handId, aiReviewPatch)
      try {
        await dataService.updateHand(handId, aiReviewPatch)
        await this.refreshAfterAiAdvice(handId)
      } catch (saveError) {
        const saveErrorText = buildAiAdviceErrorText(saveError)
        console.warn('poker agent advice save failed: ' + saveErrorText)
        const visiblePatch = Object.assign({}, aiReviewPatch, {
          aiReviewError: aiReview
            ? ('AI建议已生成，但保存失败：' + saveErrorText)
            : (aiReviewError + '\n保存失败：' + saveErrorText)
        })
        this.applyAiReviewPatchToVisibleHand(handId, visiblePatch)
        wx.showToast({ title: aiReview ? 'AI建议已生成，保存失败' : 'AI建议保存失败', icon: 'none' })
      }
    } catch (error) {
      const errorText = buildAiAdviceErrorText(error)
      console.warn('poker agent advice failed: ' + errorText)
      const failurePatch = {
        aiReview: null,
        aiReviewStatus: 'failed',
        aiReviewError: errorText
      }
      this.applyAiReviewPatchToVisibleHand(handId, failurePatch)
      try {
        await dataService.updateHand(handId, failurePatch)
        await this.refreshAfterAiAdvice(handId)
      } catch (saveError) {
        console.warn('poker agent advice failure status save failed: ' + (saveError && (saveError.errMsg || saveError.message) || String(saveError)))
        this.applyAiReviewPatchToVisibleHand(handId, Object.assign({}, failurePatch, {
          aiReviewError: errorText + '\n失败状态保存失败：' + buildAiAdviceErrorText(saveError)
        }))
      }
    }
  },
  async refreshAfterAiAdvice(handId) {
    await this.refresh()
    const activeHand = this.data.detailHand
    const isStillViewingSameHand = !!(
      this.data.detailVisible &&
      activeHand &&
      activeHand._id === handId
    )
    const hasActiveVoiceWork = !!(this.data.voiceBusy || this.data.voiceRecording)
    if (isStillViewingSameHand && !hasActiveVoiceWork) {
      await this.loadHandDetail(handId)
    }
  },
  goHandDetailPage() {
    const sheetHand = this.data.aiAdviceSheetHand
    const handId = (this.data.detailHand && this.data.detailHand._id) || (sheetHand && sheetHand._id)
    if (!handId) return
    wx.navigateTo({ url: '/pages/hand-detail/hand-detail?id=' + handId })
  }
})
