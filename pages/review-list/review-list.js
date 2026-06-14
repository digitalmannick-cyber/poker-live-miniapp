const dataService = require('../../services/data-service')
const voiceParser = require('../../utils/voice-parser')
const aiService = require('../../services/ai-service')
const cardUi = require('../../utils/card-ui')
const tabBar = require('../../utils/tab-bar')
const display = require('../../utils/display')
const aiNormalizer = require('../../utils/ai-normalizer')
const reviewTags = require('../../utils/review-tags')
const actionLine = require('../../utils/action-line')
const handDetailFields = require('../../utils/hand-detail-fields')

const REVIEW_PENDING_FILTER_KEY = 'pokerReviewPendingFilters'
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
  { field: 'date', label: '时间', desc: 'dateDesc', asc: 'dateAsc' },
  { field: 'profit', label: '输赢', desc: 'profitDesc', asc: 'profitAsc' },
  { field: 'resultBb', label: 'BB\u6570', desc: 'resultBbDesc', asc: 'resultBbAsc' }
]
const SWIPE_OPEN_DISTANCE = 72
const SWIPE_CLOSE_DISTANCE = 24
const LOCKED_QUICK_ENTRY_FIELDS = ['heroCardsInput', 'currentProfit']

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

function buildSessionOptions(sessions, selectedSessionId) {
  return [{ _id: '', title: '全部牌局', active: !selectedSessionId }]
    .concat((sessions || []).map(item => Object.assign({}, item, {
      active: selectedSessionId === item._id
    })))
}

function getSessionFilterLabel(sessions, sessionId) {
  if (!sessionId) return '全部牌局'
  const session = (sessions || []).find(item => item._id === sessionId)
  return session ? session.title : '当前牌局'
}

function buildFilterSummary(filters, sessions) {
  const parts = []
  parts.push(getSessionFilterLabel(sessions, filters.sessionId))
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
  const current = String(sortBy || 'dateDesc')
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

function normalizeActiveFilterPatch(patch) {
  const source = patch || {}
  const next = {}
  if (Object.prototype.hasOwnProperty.call(source, 'selectedSessionId')) next.sessionId = source.selectedSessionId
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
  if (Object.prototype.hasOwnProperty.call(source, 'draftSelectedSessionId')) next.sessionId = source.draftSelectedSessionId
  if (Object.prototype.hasOwnProperty.call(source, 'draftDateRange')) next.dateRange = source.draftDateRange
  if (Object.prototype.hasOwnProperty.call(source, 'draftStartDate')) next.startDate = source.draftStartDate
  if (Object.prototype.hasOwnProperty.call(source, 'draftEndDate')) next.endDate = source.draftEndDate
  if (Object.prototype.hasOwnProperty.call(source, 'draftResultFilter')) next.resultFilter = source.draftResultFilter
  if (Object.prototype.hasOwnProperty.call(source, 'draftTagFilter')) next.tagFilter = source.draftTagFilter
  return next
}

function formatActionLine(summary) {
  return actionLine.formatStreetSummary(summary)
  const source = String(summary || '').trim()
  if (!source) return '\u6682\u65e0\u884c\u52a8\u7ebf'
  return source
    .replace(/翻前/gi, 'PF')
    .replace(/翻牌/gi, 'F')
    .replace(/转牌/gi, 'T')
    .replace(/河牌/gi, 'R')
    .replace(/preflop/gi, 'PF')
    .replace(/flop/gi, 'F')
    .replace(/turn/gi, 'T')
    .replace(/river/gi, 'R')
    .replace(/\s*[\uff1b;]\s*/g, '  /  ')
    .replace(/\s*,\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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
  return {
    heroCardsInput: parsedVoice && parsedVoice.heroCardsInput || '',
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
          disabled: occupied.indexOf(token) > -1
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
    return Object.assign({}, item, {
      label: actionLine.normalizeStreetName(item.key),
      boardCards: cards,
      hasBoardCards: cards.length > 0,
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


const MISSING_FIELD_META = {
  table_size: { field: 'playerCount', label: '\u4eba\u6570', hint: '\u9ed8\u8ba4 8 \u4eba\uff0c\u5982\u679c\u53e3\u8ff0\u201c\u5269 5 \u4e2a\u4eba\u201d\u5219\u6539\u4e3a 5' },
  tableSize: { field: 'playerCount', label: '\u4eba\u6570', hint: '\u9ed8\u8ba4 8 \u4eba\uff0c\u5982\u679c\u53e3\u8ff0\u201c\u5269 5 \u4e2a\u4eba\u201d\u5219\u6539\u4e3a 5' },
  playerCount: { field: 'playerCount', label: '\u4eba\u6570', hint: '\u9ed8\u8ba4 8 \u4eba\uff0c\u5982\u679c\u53e3\u8ff0\u201c\u5269 5 \u4e2a\u4eba\u201d\u5219\u6539\u4e3a 5' },
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
  preflop_action: { field: 'streetInputs.preflop.actionLine', label: '\u7ffb\u524d\u884c\u52a8', hint: '\u8c01 open\u3001\u8c01 3B\u3001\u8c01\u8ddf\u6ce8' },
  flop_action: { field: 'streetInputs.flop.actionLine', label: '\u7ffb\u724c\u884c\u52a8', hint: '\u4e0b\u6ce8\u3001\u8fc7\u724c\u3001\u8ddf\u6ce8\u3001\u5f03\u724c' },
  turn_action: { field: 'streetInputs.turn.actionLine', label: '\u8f6c\u724c\u884c\u52a8', hint: '\u4e0b\u6ce8\u3001\u52a0\u6ce8\u3001\u8ddf\u6ce8\u3001\u5f03\u724c' },
  river_action: { field: 'streetInputs.river.actionLine', label: '\u6cb3\u724c\u884c\u52a8', hint: '\u4e0b\u6ce8\u3001\u52a0\u6ce8\u3001\u8ddf\u6ce8\u3001\u5f03\u724c' }
}

function normalizeMissingFieldKey(value) {
  const source = String(value || '').trim()
  if (/table[_ ]?size|player[_ ]?count|\u684c\u578b|\u51e0\u4eba\u684c|\u4eba\u684c|\u4eba\u6570/i.test(source)) return 'table_size'
  if (/effective[_ ]?stack|\u6709\u6548\u7b79\u7801/i.test(source)) return 'effective_stack'
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
function buildConfirmItems(missingFields, followUpQuestions, voiceNeedsRefresh) {
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
      if (seen[key]) return false
      seen[key] = true
      return true
    })
}

function collectReviewTextParts(value, parts) {
  const output = parts || []
  if (value == null) return output
  if (typeof value === 'string' || typeof value === 'number') {
    const text = String(value).trim()
    if (text) output.push(text)
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
  if (/optimi[sz]e|issue|problem|建议|优化|可优化|应该|需要|替代线/i.test(text)) tags.push('optimization')
  if (/good|great|standard|correct|标准|正确|合理|打得好|精彩/i.test(text)) tags.push('good')
  if (/hero[_\s-]?call|bluff[_\s-]?catch|call[_\s-]?down|抓诈|抓鸡|接诈/i.test(text)) tags.push('hero_call')
  if (/over[_\s-]?fold|river[_\s-]?overfold|过度弃牌|弃太多|fold太多/i.test(text)) tags.push('overfold')
  if (/bad[_\s-]?fold|错误弃牌|弃错|fold错/i.test(text)) tags.push('bad_fold')
  if (/value[_\s-]?bet|thin[_\s-]?value|价值下注|薄价值|打价值/i.test(text)) tags.push('value_bet')
  if (/semi[_\s-]?bluff|bluff|诈唬|半诈唬|偷池|偷/i.test(text)) tags.push('bluff')
  if (/multi[_\s-]?way|多人池|多人底池|三人池|四人池|3人池|4人池/i.test(text)) tags.push('multiway')
  if (/deep[_\s-]?stack|deepstack|200bb|深筹|深筹码/i.test(text)) tags.push('deep_stack')
  if (/3\s*b|3bet|3-bet|three[_\s-]?bet|三bet|三逼/i.test(text)) tags.push('3bet_pot')
  if (/4\s*b|4bet|4-bet|four[_\s-]?bet|四bet|四逼/i.test(text)) tags.push('4bet_pot')

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
  const detailView = handDetailFields.buildHandDetailViewModel(parsedVoice, {
    mode: 'confirm',
    backfilled: true,
    positions: dataService.getAppSettings().positions || []
  })
  const tags = reviewTags.normalizeReviewTags([]
    .concat(Array.isArray(parsedVoice.tags) ? parsedVoice.tags : sanitizeStringArray(parsedVoice.tags))
    .concat(inferReviewTagsFromReview(parsedVoice, meta.analysis || parsedVoice.aiReview))
  )
  const missingFields = sanitizeStringArray(
    parsedVoice.missingFields || meta.missingFields
  )
  const followUpQuestions = sanitizeStringArray(
    parsedVoice.followUpQuestions || meta.followUpQuestions
  )
  const provider = String(meta.provider || parsedVoice.provider || '').trim()
  const feedbackText = String(
    meta.naturalLanguageSummary ||
    parsedVoice.naturalLanguageSummary ||
    parsedVoice.noteSummary ||
    parsedVoice.mindJourney ||
    ''
  ).trim()
  return Object.assign({}, parsedVoice, {
    board: Object.assign({ flop: '', turn: '', river: '' }, parsedVoice.board || {}),
    streetSummary: buildCompactStreetSummary(parsedVoice),
    streetInputs: Object.assign(
      {
        preflop: { actionLine: '', pot: '' },
        flop: { actionLine: '', pot: '' },
        turn: { actionLine: '', pot: '' },
        river: { actionLine: '', pot: '' }
      },
      parsedVoice.streetInputs || {}
    ),
    tags,
    tagsText: tags.join(' · '),
    tagItems: tags.map(label => ({ label })),
    opponentTypeText: parsedVoice.opponentType || '',
    villainPositionText: parsedVoice.villainPosition || '',
    hasStraddle: detailView.form.hasStraddle,
    heroQuestion: detailView.form.heroQuestion,
    opponentName: detailView.form.opponentName,
    showdown: detailView.form.showdown,
    detailRows: detailView.rows,
    missingFields,
    missingFieldsText: buildConfirmItems(missingFields, [], false).map(item => item.label).join(' · '),
    followUpQuestions,
    confirmItems: buildConfirmItems(
      missingFields,
      followUpQuestions,
      !!parsedVoice.voiceNeedsRefresh
    ),
    feedbackText,
    aiReview: meta.analysis || parsedVoice.aiReview || null,
    providerText: provider
      ? (provider === 'openai' ? 'OpenAI' : provider === 'kimi' ? 'Kimi' : provider === 'local' ? '本地兜底' : provider)
      : '本地兜底',
    confidenceText: missingFields.length ? '\u9700\u8981\u8865\u5145' : '\u53ef\u56de\u586b',
    playerCountDisplayText: Number(parsedVoice.playerCount) > 0 ? String(Number(parsedVoice.playerCount)) : '',
    currentProfitDisplayText: formatSignedNumber(parsedVoice.currentProfit),
    heroCardsVisual: cardUi.parseHeroCardsInput(parsedVoice.heroCardsInput),
    showdownCardsVisual: cardUi.parseHeroCardsInput(detailView.form.showdown),
    boardVisual: buildBoardVisual(parsedVoice.board),
    streetItems: buildStreetItems(parsedVoice.streetInputs, parsedVoice.board)
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

function mergeLocalVoiceFallback(parsedVoice, voiceNote) {
  const source = parsedVoice || {}
  const text = String(voiceNote || '').trim()
  if (!text) return source
  const local = voiceParser.parseVoiceText(text)
  const merged = Object.assign({}, source)
  ;[
    'playedDate',
    'stakeLevel',
    'heroPosition',
    'heroCardsInput',
    'effectiveStack',
    'potSize',
    'currentProfit',
    'opponentType',
    'opponentName',
    'hasStraddle',
    'heroQuestion',
    'villainPosition',
    'streetSummary',
    'showdown',
    'mindJourney'
  ].forEach(key => {
    if (isBlankVoiceValue(merged[key]) && !isBlankVoiceValue(local[key])) {
      merged[key] = local[key]
    }
  })
  merged.board = Object.assign({}, source.board || {})
  const localBoard = local.board || {}
  ;['flop', 'turn', 'river'].forEach(key => {
    if (isBlankVoiceValue(merged.board[key]) && !isBlankVoiceValue(localBoard[key])) {
      merged.board[key] = localBoard[key]
    }
  })
  merged.streetInputs = mergeBlankStreetInputs(source.streetInputs, local.streetInputs)
  if (!Array.isArray(merged.tags) || !merged.tags.length) merged.tags = local.tags || []
  merged.tags = reviewTags.normalizeReviewTags(merged.tags)
  return merged
}

function normalizeParsedVoice(parsedVoice, reviewResult, voiceNote, detailHand) {
  const mergedVoice = mergeLocalVoiceFallback(parsedVoice, voiceNote)
  const agentInferredTags = inferReviewTagsFromReview(mergedVoice, reviewResult && reviewResult.analysis)
  const processed = aiNormalizer.postProcessReviewResult(
    Object.assign({}, reviewResult || {}, { extractedHand: mergedVoice || {} }),
    voiceNote,
    detailHand
  )
  const extracted = Object.assign(
    {},
    processed.extractedHand || mergedVoice || {},
    {
      missingFields: processed.missingFields || (reviewResult && reviewResult.missingFields) || [],
      followUpQuestions: processed.followUpQuestions || (reviewResult && reviewResult.followUpQuestions) || [],
      naturalLanguageSummary: processed.naturalLanguageSummary || (reviewResult && reviewResult.naturalLanguageSummary) || '',
      aiReview: reviewResult && reviewResult.analysis || parsedVoice && parsedVoice.aiReview || null
    }
  )
  extracted.tags = reviewTags.normalizeReviewTags([]
    .concat(Array.isArray(extracted.tags) ? extracted.tags : sanitizeStringArray(extracted.tags))
    .concat(agentInferredTags)
    .concat(inferReviewTagsFromReview(extracted, extracted.aiReview))
  )
  return preserveLockedQuickEntryFields(extracted, detailHand)
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
    showdown: parsedVoice.showdown || '',
    mindJourney: parsedVoice.mindJourney || '',
    tags: reviewTags.normalizeReviewTags(parsedVoice.tags),
    missingFields: sanitizeStringArray(parsedVoice.missingFields),
    followUpQuestions: sanitizeStringArray(parsedVoice.followUpQuestions),
    naturalLanguageSummary: parsedVoice.feedbackText || parsedVoice.naturalLanguageSummary || '',
    aiReview: parsedVoice.aiReview || null,
    provider: parsedVoice.providerText || parsedVoice.provider || ''
  }
}

function buildLocalReviewFallback(detailHand, detailSession, voiceNote) {
  const settings = dataService.getAppSettings()
  const normalizedNote = aiNormalizer.applyUserTerms(voiceNote, settings.voiceTerms).text
  const parsed = aiNormalizer.postProcessReviewResult(
    voiceParser.parseVoiceText(normalizedNote),
    normalizedNote
  )
  const sessionSmallBlind = detailSession && detailSession.smallBlind
  const sessionBigBlind = detailSession && detailSession.bigBlind
  return buildParsedVoicePreview(
    Object.assign(
      {
        playedDate: (detailHand && detailHand.playedDate) || (detailSession && detailSession.date) || '',
        stakeLevel:
          (detailHand && detailHand.stakeLevel) ||
          ((sessionSmallBlind || sessionBigBlind)
            ? String(sessionSmallBlind || 0) + '/' + String(sessionBigBlind || 0)
            : ''),
        opponentType: (detailHand && detailHand.opponentType) || '',
        villainPosition: (detailHand && detailHand.villainPosition) || '',
        streetInputs: (detailHand && detailHand.streetInputs) || {}
      },
      parsed
    ),
    {
      provider: 'local',
      naturalLanguageSummary: parsed.noteSummary || normalizedNote,
      missingFields: parsed.missingFields || [],
      followUpQuestions: parsed.followUpQuestions || []
    }
  )
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
  const settings = dataService.getAppSettings()
  const profile = dataService.getCurrentProfile ? dataService.getCurrentProfile() : {}
  const config = options || {}
  const bigBlind = handDetailFields.getBigBlindFromLevel(
    detailHand && detailHand.stakeLevel,
    detailSession
  )
  const hasStraddle = !!(detailHand && detailHand.hasStraddle)
  const straddleAmount = hasStraddle ? bigBlind * 2 : 0
  return {
    mode: config.mode || 'extract',
    transcript: voiceNote,
    userId: (profile && profile.playerId) || '',
    playerId: (profile && profile.playerId) || '',
    userTerms: settings.voiceTerms || [],
    corrections: config.corrections || null,
    hand: {
      _id: (detailHand && detailHand._id) || '',
      playerCount: Number(detailHand && detailHand.playerCount) || 0,
      playedDate: (detailHand && detailHand.playedDate) || '',
      stakeLevel: (detailHand && detailHand.stakeLevel) || '',
      hasStraddle,
      straddleAmount,
      heroPosition: (detailHand && detailHand.heroPosition) || '',
      heroCardsInput: (detailHand && detailHand.heroCardsInput) || '',
      effectiveStack: (detailHand && detailHand.effectiveStack) || 0,
      potSize: (detailHand && detailHand.potSize) || 0,
      currentProfit: (detailHand && detailHand.currentProfit) || 0,
      opponentType: (detailHand && detailHand.opponentType) || '',
      opponentName: (detailHand && detailHand.opponentName) || '',
      villainPosition: (detailHand && detailHand.villainPosition) || '',
      villainType: (detailHand && (detailHand.villainType || detailHand.opponentType)) || '',
      board: (detailHand && detailHand.board) || { flop: '', turn: '', river: '' },
      streetInputs: (detailHand && detailHand.streetInputs) || {},
      streetSummary: (detailHand && detailHand.streetSummary) || '',
      notes: (detailHand && detailHand.notes) || '',
      heroQuestion: (detailHand && detailHand.heroQuestion) || '',
      showdown: (detailHand && detailHand.showdown) || '',
      voiceNote: (detailHand && detailHand.voiceNote) || ''
    },
    session: detailSession
      ? {
          title: detailSession.title || '',
          playerCount: Number(detailSession.playerCount) || 0,
          date: detailSession.date || String(detailSession.startTime || '').split(' ')[0] || '',
          venue: detailSession.venue || '',
          smallBlind: detailSession.smallBlind || 0,
          bigBlind: detailSession.bigBlind || 0
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

function learnTermsFromVoiceNote(voiceNote) {
  const settings = dataService.getAppSettings()
  const learned = aiNormalizer.extractExplicitTermDefinitions(voiceNote)
  if (!learned.length) return []
  const merged = aiNormalizer.mergeUserTerms(settings.voiceTerms || [], learned)
  dataService.updateSettings({ voiceTerms: merged })
  return learned
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

function buildVoicePatch(detailHand, parsedVoice, voiceNote) {
  const current = detailHand || {}
  const lockedParsedVoice = preserveLockedQuickEntryFields(Object.assign({}, parsedVoice), detailHand)
  const parsedBoard = lockedParsedVoice.board || {}
  const currentBoard = current.board || {}
  const baseNotes = stripAutoVoiceReviewNotes(current.notes)
  const tags = reviewTags.normalizeReviewTags([]
    .concat(Array.isArray(current.tags) ? current.tags : [])
    .concat(sanitizeStringArray(lockedParsedVoice.tags))
    .concat(inferReviewTagsFromReview(lockedParsedVoice, lockedParsedVoice.aiReview || current.aiReview))
  )
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
    showdown: lockedParsedVoice.showdown || current.showdown || '',
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
      return {
        key: String(index),
        street,
        status,
        statusClass: buildAgentStreetStatusClass(status),
        points: nextPoints
      }
    })
    .filter(Boolean)
}

function compactAgentAdviceText(value, maxLength) {
  const source = cleanAgentAdviceText(value)
  const limit = Number(maxLength) || 120
  if (!source) return ''
  const firstPart = source
    .split(/[\n。！？!?]/)
    .map(function (item) { return item.trim() })
    .filter(Boolean)[0] || source
  const compact = firstPart.length <= 12 ? source : firstPart
  return compact.length > limit ? compact.slice(0, limit) + '...' : compact
}

function buildAiReviewView(aiReview) {
  if (!aiReview) return null
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
  const streetBreakdown = sanitizeAgentStreetBreakdown(aiReview.streetBreakdown || aiReview.street_breakdown)
  const keyTakeaway = cleanAgentAdviceText(aiReview.keyTakeaway || aiReview.key_takeaway || aiReview.humanRule || aiReview.human_rule || '')
  const missingFields = sanitizeStringArray(aiReview.missingFields)
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
  return {
    provider: aiReview.provider || 'poker-agent',
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

function stripAutoVoiceReviewNotes(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map(item => item.trim())
    .filter(item => item && !/^\[(?:\u8bed\u97f3\u590d\u76d8|璇煶澶嶇洏)\]/.test(item))
    .join('\n')
}

function buildDetailHandView(hand, chipUnit) {
  if (!hand) return null
  const detailView = handDetailFields.buildHandDetailViewModel(hand, {
    mode: 'readonly',
    backfilled: !!hand.detailBackfilled,
    positions: dataService.getAppSettings().positions || [],
    excludeRowKeys: ['heroCardsInput', 'streetSummary', 'mindJourney']
  })
  const boardVisual = buildBoardVisual(hand.board)
  const streetItems = buildStreetItems(hand.streetInputs, hand.board)
  const resultBBDisplay = String(hand.resultBB || '').trim() || buildResultBbDisplay(hand)
  const aiReviewView = buildAiReviewView(hand.aiReview)
  const aiReviewStatus = hand.aiReviewStatus || (aiReviewView && aiReviewView.visible ? 'ready' : '')
  const savedTags = reviewTags.normalizeReviewTags(hand.tags)
  const displayInferredTags = inferReviewTagsFromReview(hand, hand.aiReview)
  const normalizedTags = reviewTags.normalizeReviewTags([].concat(savedTags).concat(displayInferredTags))
  const notesText = stripAutoVoiceReviewNotes(hand.notes)
  const detailRows = detailView.rows.map(item => {
    if (item.key === 'currentProfit') {
      return Object.assign({}, item, {
        displayValue: display.formatAmount(hand.currentProfit, chipUnit)
      })
    }
    if (item.key === 'playerCount') {
      return Object.assign({}, item, {
        displayValue: Number(hand.playerCount) > 0 ? String(Number(hand.playerCount)) : '-'
      })
    }
    if (item.key === 'villainType') {
      return Object.assign({}, item, {
        displayValue: hand.villainType || hand.opponentType || '-'
      })
    }
    return item
  })
  return Object.assign({}, hand, {
    currentProfitDisplay: display.formatAmount(hand.currentProfit, chipUnit),
    playerCountDisplayText: Number(hand.playerCount) > 0 ? String(Number(hand.playerCount)) : '',
    resultBBDisplay,
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
    tags: reviewTags.normalizeReviewTags([].concat(normalizedTags).concat(displayInferredTags)),
    tagsText: normalizedTags.join(' · '),
    tagItems: normalizedTags.map(label => ({ label })),
    heroCardsVisual: cardUi.parseHeroCardsInput(hand.heroCardsInput),
    reviewStatus: hand.reviewStatus || 'idle',
    mindJourney: hand.mindJourney || '',
    notes: notesText,
    aiReviewView,
    aiReviewStatus,
    aiReviewReady: !!(aiReviewView && aiReviewView.visible),
    aiReviewGenerating: aiReviewStatus === 'generating',
    aiReviewFailed: aiReviewStatus === 'failed',
    aiReviewErrorText: hand.aiReviewError || 'Poker Agent \u6682\u65f6\u6ca1\u6709\u751f\u6210\u5efa\u8bae\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002',
    villainTypeText: hand.villainType || hand.opponentType || '',
    boardHasCards: boardVisual.some(item => item.cards.length),
    hasStreetItems: streetItems.some(item => item.actionLine || item.pot),
    hasReflectionContent: !!(normalizedTags.length || String(hand.showdown || '').trim() || notesText)
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
    hands: [],
    sessions: [],
    summary: {
      totalHands: 0,
      totalProfit: 0
    },
    chipUnit: 'BB',
    loading: false,
    selectedSessionId: '',
    filterInitialized: false,
    dateRange: 'all',
    startDate: '',
    endDate: '',
    resultFilter: 'all',
    tagFilter: 'all',
    sortBy: 'dateDesc',
    sessionOptions: [],
    dateFilterOptions: buildFilterOptions(DATE_FILTERS, 'all'),
    resultFilterOptions: buildFilterOptions(RESULT_FILTERS, 'all'),
    tagFilterOptions: reviewTags.getReviewTagOptions('all'),
    sortOptions: buildFilterOptions(SORT_OPTIONS, 'dateDesc'),
    sortControlOptions: buildSortControlOptions('dateDesc'),
    filterSummary: '\u6700\u65b0\u8bb0\u5f55',
    filterModalVisible: false,
    defaultSessionId: '',
    draftSelectedSessionId: '',
    draftDateRange: 'all',
    draftStartDate: '',
    draftEndDate: '',
    draftResultFilter: 'all',
    draftTagFilter: 'all',
    draftSessionOptions: [],
    draftDateFilterOptions: buildFilterOptions(DATE_FILTERS, 'all'),
    draftResultFilterOptions: buildFilterOptions(RESULT_FILTERS, 'all'),
    draftTagFilterOptions: reviewTags.getReviewTagOptions('all'),
    detailVisible: false,
    detailLoading: false,
    detailHand: null,
    detailSession: null,
    detailActions: [],
    voicePanelVisible: false,
    voiceBusy: false,
    voiceRecording: false,
    voiceStatus: '',
    voiceNote: '',
    voiceCorrectionNote: '',
    parsedVoice: null,
    parsedVoiceSourceText: '',
    voiceNeedsRefresh: false,
    voiceFocusField: '',
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
    swipedHandId: '',
    touchStartX: 0,
    touchStartY: 0,
    touchActiveHandId: '',
    touchMoved: false,
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
  onShow() {
    tabBar.syncCustomTabBar('/pages/review-list/review-list')
    this.refresh()
  },
  getActiveFilters() {
    return {
      sessionId: this.data.selectedSessionId,
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
      sessionId: this.data.draftSelectedSessionId,
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
      draftSessionOptions: buildSessionOptions(this.data.sessions, next.sessionId)
    }))
  },
  async refresh() {
    this.setData({ loading: true })
    const settings = dataService.getAppSettings()
    const chipUnit = settings.chipUnit
    const sessionData = await dataService.getSessionListData()
    const sessions = sessionData.sessions || []
    const pendingFilters = readPendingFilters()
    let nextFilters = this.getActiveFilters()
    const activeSession = sessions.find(item => item.status === 'active')
    const defaultSessionId = activeSession ? activeSession._id : ''

    if (pendingFilters) {
      nextFilters = Object.assign({}, nextFilters, pendingFilters)
    } else if (!this.data.filterInitialized && !nextFilters.sessionId) {
      nextFilters.sessionId = defaultSessionId
    }

    this.applyFilterState({
      selectedSessionId: nextFilters.sessionId,
      dateRange: nextFilters.dateRange,
      startDate: nextFilters.startDate,
      endDate: nextFilters.endDate,
      resultFilter: nextFilters.resultFilter,
      tagFilter: nextFilters.tagFilter,
      sortBy: nextFilters.sortBy,
      filterInitialized: true
    })
    const data = await dataService.getReviewData(nextFilters)
    const hands = (data.hands || []).map(item => Object.assign({}, item, {
      aiReviewReady: !!(item.aiReview && buildAiReviewView(item.aiReview) && buildAiReviewView(item.aiReview).visible),
      aiReviewGenerating: item.aiReviewStatus === 'generating',
      aiReviewFailed: item.aiReviewStatus === 'failed',
      swiped: item._id === this.data.swipedHandId,
      actionLine: buildCompactStreetSummary(item),
      currentProfitDisplay: display.formatAmount(item.currentProfit, chipUnit),
      heroCardsVisual: cardUi.parseHeroCardsInput(item.heroCardsInput),
      heroPositionClass: buildPositionClass(item.heroPosition),
      boardStreetVisual: cardUi.parseBoardStreets(item.board),
      tags: reviewTags.normalizeReviewTags(item.tags),
      tagItems: reviewTags.normalizeReviewTags(item.tags).map(label => ({ label })),
      opponentDisplayName: buildOpponentDisplayName(item)
    }))
    this.setData(Object.assign({}, data, {
      hands,
      chipUnit,
      blindPresets: settings.blindPresets || [],
      positions: settings.positions || [],
      opponentTypes: settings.opponentTypes || [],
      defaultSessionId,
      sessionOptions: buildSessionOptions(data.sessions || sessions, nextFilters.sessionId),
      draftSessionOptions: buildSessionOptions(data.sessions || sessions, this.data.draftSelectedSessionId || nextFilters.sessionId),
      sortControlOptions: buildSortControlOptions(nextFilters.sortBy),
      tagFilterOptions: reviewTags.getReviewTagOptions(nextFilters.tagFilter),
      filterSummary: buildFilterSummary(nextFilters, data.sessions || sessions),
      summary: Object.assign({}, data.summary, {
        totalProfitDisplay: display.formatAmount(data.summary.totalProfit, chipUnit)
      }),
      loading: false
    }))
  },
  selectSession(e) {
    const sessionId = e.currentTarget.dataset.id || ''
    this.applyDraftFilterState({ draftSelectedSessionId: sessionId })
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
      draftSelectedSessionId: this.data.defaultSessionId,
      draftDateRange: 'all',
      draftStartDate: '',
      draftEndDate: '',
      draftResultFilter: 'all',
      draftTagFilter: 'all'
    })
  },
  openFilterModal() {
    this.applyDraftFilterState({
      draftSelectedSessionId: this.data.selectedSessionId,
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
      selectedSessionId: this.data.draftSelectedSessionId,
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
    const hand = await dataService.getHandById(handId)
    if (!hand) {
      this.setData({ detailLoading: false, detailVisible: false })
      wx.showToast({ title: '未找到这手牌', icon: 'none' })
      return
    }
    const session = await dataService.getSessionById(hand.sessionId)
    const actions = await dataService.getActionsByHandId(handId)
    const reviewed = hasCompletedReview(hand)
    this.setData({
      detailLoading: false,
      detailHand: buildDetailHandView(hand, this.data.chipUnit),
      detailSession: session,
      detailActions: actions,
      voicePanelVisible: !reviewed,
      voiceBusy: false,
      voiceRecording: false,
      voiceStatus: reviewed ? '\u5df2\u4fdd\u5b58\u8fc7\u590d\u76d8\uff0c\u53ef\u5c55\u5f00\u7ee7\u7eed\u8865\u5145' : '',
      voiceNote: hand.voiceNote || '',
      parsedVoiceSourceText: hand.voiceNote || '',
      voiceNeedsRefresh: false,
      parsedVoice: hand.voiceExtract
        ? buildParsedVoicePreview(hand.voiceExtract, {
            analysis: hand.aiReview,
            missingFields: hand.voiceExtract.missingFields || [],
            followUpQuestions: hand.voiceExtract.followUpQuestions || []
          })
        : null
    })
  },
  async openHandDetail(e) {
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
    this.setData({
      detailVisible: true,
      detailLoading: true,
      detailHand: null,
      detailSession: null,
      detailActions: []
    })
    await this.loadHandDetail(handId)
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
    this.setData({
      detailVisible: false,
      detailLoading: false,
      detailHand: null,
      detailSession: null,
      detailActions: [],
      voicePanelVisible: false,
      voiceBusy: false,
      voiceRecording: false,
      voiceStatus: '',
      voiceNote: '',
      voiceCorrectionNote: '',
      parsedVoice: null,
      parsedVoiceSourceText: '',
      voiceNeedsRefresh: false
    })
  },
  stopModalTap() {},
  onVoiceNoteInput(e) {
    const nextValue = e.detail.value
    const sourceText = String(this.data.parsedVoiceSourceText || '').trim()
    const changedAfterParse =
      !!this.data.parsedVoice && String(nextValue || '').trim() !== sourceText

    this.setData({
      voiceNote: nextValue,
      parsedVoice: changedAfterParse ? null : this.data.parsedVoice,
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
    const current = String(this.data.voiceNote || '').trim()
    const nextValue = current ? `${current}\n${text}` : text
    this.setData({
      voicePanelVisible: true,
      voiceNote: nextValue,
      parsedVoice: null,
      voiceNeedsRefresh: !!this.data.parsedVoiceSourceText,
      voiceStatus: '\u793a\u4f8b\u5df2\u586b\u5165\uff0c\u4f60\u53ef\u4ee5\u7ee7\u7eed\u6539\u5b8c\u518d\u53d1\u9001\u89e3\u6790\u3002'
    })
  },
  clearVoiceNote() {
    this.setData({
      voiceNote: '',
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
  },
  onParsedVoiceToggleChange(e) {
    const field = e.currentTarget.dataset.field
    if (!field || !this.data.parsedVoice) return
    const rawValue = e.detail && Array.isArray(e.detail.value)
      ? e.detail.value.indexOf('1') > -1
      : !!(e.detail && e.detail.value)
    const nextParsed = setParsedVoiceDraftField(this.data.parsedVoice, field, rawValue)
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
  },
  onVoiceCorrectionInput(e) {
    this.setData({ voiceCorrectionNote: e.detail.value })
  },
  focusMissingField(e) {
    const field = String(e.currentTarget.dataset.field || '').trim()
    if (!field || field === 'voiceNote') return
    if (field === 'stakeLevel' || field === 'heroPosition' || field === 'villainPosition' || field === 'opponentType') {
      this.openVoicePresetSelector({ currentTarget: { dataset: { field } } })
      return
    }
    if (field === 'heroCardsInput') {
      this.openVoiceHeroPicker()
      return
    }
    if (field === 'board.flop') {
      this.openVoiceBoardPicker({ currentTarget: { dataset: { key: 'flop' } } })
      return
    }
    if (field === 'board.turn') {
      this.openVoiceBoardPicker({ currentTarget: { dataset: { key: 'turn' } } })
      return
    }
    if (field === 'board.river') {
      this.openVoiceBoardPicker({ currentTarget: { dataset: { key: 'river' } } })
      return
    }
    this.setData({
      voiceFocusField: '',
      voiceStatus: '\u8bf7\u76f4\u63a5\u8865\u5145\u201c' + field + '\u201d\u5bf9\u5e94\u5b57\u6bb5\u3002'
    }, () => {
      this.setData({ voiceFocusField: field })
    })
  },
  reparseVoiceWithCorrection() {
    const correction = String(this.data.voiceCorrectionNote || '').trim()
    if (!correction) {
      wx.showToast({ title: '\u8bf7\u5148\u8f93\u5165\u786e\u8ba4\u6216\u4fee\u6b63\u5185\u5bb9', icon: 'none' })
      return
    }
    const base = String(this.data.voiceNote || '').trim()
    const nextVoiceNote = base
      ? base + '\n\u8865\u5145\u786e\u8ba4\uff1a' + correction
      : correction
    this.setData({
      voiceNote: nextVoiceNote,
      voiceCorrectionNote: '',
      parsedVoice: null,
      voiceNeedsRefresh: false,
      voiceStatus: '已加入修正信息，正在重新解析...'
    }, () => {
      this.runVoiceReview({ voiceNote: nextVoiceNote, silentSuccess: true })
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
      voiceShowdownPickerPreview: cardUi.parseHeroCardsInput(parsed.showdown),
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
    const nextParsed = setParsedVoiceDraftField(this.data.parsedVoice, 'showdown', normalized)
    this.refreshParsedVoiceDraft(nextParsed, {
      voiceShowdownPickerHint: '\u5df2\u9009 ' + cardUi.parseHeroCardsInput(normalized).length + ' / 2 \u5f20',
      voiceShowdownPickerPreview: cardUi.parseHeroCardsInput(normalized),
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
    this.runVoiceReview()
  },
  async runVoiceReview(options) {
    const config = options || {}
    const voiceNote = String(
      config.voiceNote != null ? config.voiceNote : this.data.voiceNote || ''
    ).trim()
    if (!voiceNote) {
      wx.showToast({ title: '\u8bf7\u5148\u5f55\u97f3\u6216\u8f93\u5165\u6587\u672c', icon: 'none' })
      return
    }

    this.setData({
      voicePanelVisible: true,
      voiceBusy: true,
      voiceStatus: '正在调用 AI 生成语音复盘字段建议...'
    })

    try {
      const result = await aiService.reviewHandVoice(
        buildReviewRequest(
          this.data.detailHand,
          this.data.detailSession,
          this.data.detailActions,
          voiceNote,
          { mode: 'extract' }
        )
      )
      const parseSourceText = voiceNote
      const partial = result.code && result.code !== 0
      if (partial) {
        const error = new Error(result.message || '云端解析失败')
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
        normalizeParsedVoice(result.extractedHand, result, parseSourceText, this.data.detailHand),
        result
      )
      const learnedTerms = learnTermsFromVoiceNote(voiceNote)
      const cleanedText = String(result.cleanedTranscript || '').trim()
      const keptOriginalText = !!cleanedText && cleanedText !== voiceNote
      this.setData({
        voiceBusy: false,
        voiceNote,
        parsedVoice,
        parsedVoiceSourceText: voiceNote,
        voiceNeedsRefresh: false,
        voiceStatus: keptOriginalText
          ? 'AI 已生成字段建议，原始口述已保留未改写'
          : learnedTerms.length
          ? '已学习你的说法，下次会自动识别；字段建议也已生成'
          : 'AI 已生成字段建议，请确认后回填'
      })
      if (!config.silentSuccess) {
        wx.showToast({
          title: '\u8bed\u97f3\u590d\u76d8\u5df2\u751f\u6210',
          icon: 'success'
        })
      }
    } catch (error) {
      console.warn('voice review failed: ' + (error && (error.errMsg || error.message) || String(error)))
      this.setData({
        voiceBusy: false,
        voiceStatus: '\u4e91\u7aef\u89e3\u6790\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002\u539f\u59cb\u53e3\u8ff0\u5df2\u4fdd\u7559\uff0c\u4e0d\u4f1a\u81ea\u52a8\u5207\u6362\u6210\u672c\u5730\u89e3\u6790\u3002'
      })
      wx.showToast({ title: '云端解析失败，请重试', icon: 'none' })
    }
  },
  async applyVoicePatch() {
    if (!this.data.detailHand || !this.data.parsedVoice) {
      wx.showToast({ title: '\u6682\u65e0\u53ef\u56de\u586b\u5185\u5bb9', icon: 'none' })
      return
    }
    const handId = this.data.detailHand._id
    const voiceNote = this.data.voiceNote
    const correction = buildAgentCorrectionPayload(this.data.detailHand, this.data.parsedVoice, voiceNote)
    this.setData({ voiceBusy: true, voiceStatus: '\u6b63\u5728\u56de\u586b\u8fd9\u624b\u724c...' })
    await dataService.updateHand(
      handId,
      buildVoicePatch(this.data.detailHand, this.data.parsedVoice, voiceNote)
    )
    await this.refresh()
    await this.loadHandDetail(handId)
    this.setData({
      voicePanelVisible: false,
      voiceBusy: false,
      voiceStatus: '语音复盘已保存，Poker Agent 正在生成建议...'
    })
    wx.showToast({ title: '\u590d\u76d8\u5df2\u4fdd\u5b58', icon: 'success' })

    try {
      const savedHand = await dataService.getHandById(handId)
      const result = await aiService.reviewHandVoice(
        buildReviewRequest(
          savedHand,
          this.data.detailSession,
          this.data.detailActions,
          voiceNote,
          {
            mode: 'advice',
            corrections: correction
          }
        )
      )
      if (result.code && result.code !== 0) {
        const error = new Error(result.message || 'Poker Agent advice failed')
        error.code = result.code
        throw error
      }
      await dataService.updateHand(handId, {
        aiReview: result.analysis || null,
        aiReviewStatus: result.analysis ? 'ready' : 'failed',
        aiReviewGeneratedAt: Date.now(),
        aiReviewError: result.analysis ? '' : 'Agent returned no advice'
      })
      await this.refresh()
      await this.loadHandDetail(handId)
    } catch (error) {
      console.warn('poker agent advice failed: ' + (error && (error.errMsg || error.message) || String(error)))
      await dataService.updateHand(handId, {
        aiReviewStatus: 'failed',
        aiReviewError: error && (error.message || error.errMsg) || 'Poker Agent advice failed'
      })
      await this.refresh()
      await this.loadHandDetail(handId)
    }
  },
  goHandDetailPage() {
    const handId = this.data.detailHand && this.data.detailHand._id
    if (!handId) return
    wx.navigateTo({ url: '/pages/hand-detail/hand-detail?id=' + handId })
  }
})
