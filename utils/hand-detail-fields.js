const cardUi = require('./card-ui')

const EMPTY_DISPLAY = '-'

const CANONICAL_FIELD_KEYS = [
  'playedDate',
  'stakeLevel',
  'playerCount',
  'hasStraddle',
  'heroPosition',
  'villainPosition',
  'villainType',
  'effectiveStack',
  'potSize',
  'currentProfit',
  'opponentName',
  'showdown',
  'heroCardsInput',
  'streetSummary',
  'mindJourney',
  'heroQuestion',
  'streetDetails',
  'tags',
  'aiReview'
]

const FIELD_META = {
  playedDate: { label: '日期', type: 'date' },
  stakeLevel: { label: '级别', type: 'select' },
  playerCount: { label: '人数', type: 'number' },
  hasStraddle: { label: '是否 Straddle', type: 'checkbox' },
  heroPosition: { label: 'Hero 位置', type: 'select' },
  villainPosition: { label: '对手位置', type: 'select' },
  villainType: { label: '对手类型', type: 'select' },
  effectiveStack: { label: '有效筹码', type: 'number' },
  potSize: { label: '当前底池', type: 'number' },
  currentProfit: { label: '本手输赢', type: 'number' },
  opponentName: { label: '对手昵称', type: 'text' },
  showdown: { label: '对手手牌 / Showdown', type: 'text' },
  heroCardsInput: { label: 'Hero 手牌', type: 'cards' },
  streetSummary: { label: '行动线总结', type: 'textarea' },
  mindJourney: { label: '心路历程', type: 'textarea' },
  heroQuestion: { label: 'Hero 疑问点', type: 'textarea', rows: 2 },
  streetDetails: { label: '逐街详情', type: 'streetGroup' },
  tags: { label: '标签', type: 'tags' },
  aiReview: { label: 'AI 建议', type: 'aiReview' }
}

const STREET_META = [
  { key: 'preflop', label: '翻前', boardLimit: 0 },
  { key: 'flop', label: '翻牌', boardLimit: 3 },
  { key: 'turn', label: '转牌', boardLimit: 1 },
  { key: 'river', label: '河牌', boardLimit: 1 }
]

function present(value) {
  if (value == null) return false
  if (Array.isArray(value)) return value.length > 0
  return String(value).trim() !== ''
}

function displayValue(value) {
  return present(value) ? String(value) : EMPTY_DISPLAY
}

function getBigBlindFromLevel(levelText, session) {
  const text = String(levelText || '').trim()
  const match = text.match(/^(\d+)\s*\/\s*(\d+)$/)
  if (match) return Number(match[2]) || 0
  return Number(session && session.bigBlind) || 0
}

function getStraddleAmount(levelText, session) {
  const bigBlind = getBigBlindFromLevel(levelText, session)
  return bigBlind ? bigBlind * 2 : 0
}

function getPositionOptions(positions, hasStraddle) {
  const source = positions || []
  if (hasStraddle) return source.slice()
  return source.filter(item => String(item || '').toUpperCase() !== 'STR')
}

function normalizeBoolean(value) {
  return value === true || value === 1 || value === '1' || value === 'true'
}

function normalizeHandDetailForm(hand) {
  const source = hand || {}
  const board = source.board || {}
  const streetInputs = source.streetInputs || {}

  return {
    playedDate: source.playedDate || '',
    stakeLevel: source.stakeLevel || '',
    playerCount: source.playerCount || '',
    hasStraddle: normalizeBoolean(source.hasStraddle),
    heroPosition: source.heroPosition || '',
    villainPosition: source.villainPosition || '',
    villainType: source.villainType || source.opponentType || '',
    effectiveStack: source.effectiveStack || '',
    potSize: source.potSize || '',
    currentProfit: source.currentProfit === 0 ? 0 : source.currentProfit || '',
    opponentName: source.opponentName || '',
    showdown: source.showdown || source.villainCards || '',
    heroCardsInput: source.heroCardsInput || '',
    streetSummary: source.streetSummary || '',
    mindJourney: source.mindJourney || source.notes || '',
    heroQuestion: source.heroQuestion || '',
    tags: Array.isArray(source.tags) ? source.tags : [],
    aiReview: source.aiReview || null,
    board: {
      flop: board.flop || source.flop || '',
      turn: board.turn || source.turn || '',
      river: board.river || source.river || ''
    },
    streetInputs: {
      preflop: Object.assign({ pot: '', actionLine: '' }, streetInputs.preflop || {}),
      flop: Object.assign({ pot: '', actionLine: '' }, streetInputs.flop || {}),
      turn: Object.assign({ pot: '', actionLine: '' }, streetInputs.turn || {}),
      river: Object.assign({ pot: '', actionLine: '' }, streetInputs.river || {})
    }
  }
}

function hasOnlyQuickEntryDetails(hand) {
  const form = normalizeHandDetailForm(hand)
  const detailKeys = [
    'playedDate',
    'stakeLevel',
    'playerCount',
    'heroPosition',
    'villainPosition',
    'villainType',
    'effectiveStack',
    'potSize',
    'opponentName',
    'showdown',
    'streetSummary',
    'mindJourney',
    'heroQuestion'
  ]
  const hasDetailField = detailKeys.some(key => present(form[key]))
  const hasBoard = present(form.board.flop) || present(form.board.turn) || present(form.board.river)
  const hasStreetDetail = STREET_META.some(item => {
    const street = form.streetInputs[item.key] || {}
    return present(street.pot) || present(street.actionLine)
  })

  return !hasDetailField && !form.hasStraddle && !hasBoard && !hasStreetDetail && form.tags.length === 0
}

function buildRows(form, options) {
  const config = options || {}
  return CANONICAL_FIELD_KEYS
    .filter(key => key !== 'streetDetails' && key !== 'aiReview')
    .map(key => {
      const meta = FIELD_META[key]
      const rawValue = key === 'hasStraddle' ? (form.hasStraddle ? '是' : '否') : form[key]
      return {
        key,
        label: meta.label,
        type: meta.type,
        editable: config.mode !== 'readonly',
        value: form[key],
        displayValue: displayValue(rawValue)
      }
    })
}

function buildStreetItems(form) {
  const board = form.board || {}
  const streetInputs = form.streetInputs || {}

  return STREET_META.map(item => {
    const street = streetInputs[item.key] || {}
    const boardValue = item.key === 'preflop' ? '' : board[item.key] || ''
    return {
      key: item.key,
      label: item.label,
      boardValue,
      boardCards: item.boardLimit ? cardUi.parseCardsInput(boardValue, item.boardLimit) : [],
      boardDisplay: item.key === 'preflop' ? EMPTY_DISPLAY : displayValue(boardValue),
      pot: street.pot || '',
      potDisplay: displayValue(street.pot),
      actionLine: street.actionLine || '',
      actionLineDisplay: displayValue(street.actionLine)
    }
  })
}

function buildHandDetailViewModel(hand, options) {
  const config = options || {}
  const form = normalizeHandDetailForm(hand)
  const quickOnly = hasOnlyQuickEntryDetails(hand)
  const backfilled = !!config.backfilled || !!(hand && hand.detailBackfilled)
  const editable = config.mode !== 'readonly'

  return {
    mode: config.mode || 'readonly',
    editable,
    form,
    rows: buildRows(form, config),
    streetItems: buildStreetItems(form),
    positionOptions: getPositionOptions(config.positions || [], form.hasStraddle),
    straddleAmount: form.hasStraddle ? getStraddleAmount(form.stakeLevel, config.session) : 0,
    hasOnlyQuickEntryDetails: quickOnly,
    shouldShowFullDetails: editable || backfilled || !quickOnly
  }
}

module.exports = {
  EMPTY_DISPLAY,
  CANONICAL_FIELD_KEYS,
  FIELD_META,
  STREET_META,
  getBigBlindFromLevel,
  getStraddleAmount,
  getPositionOptions,
  normalizeBoolean,
  normalizeHandDetailForm,
  hasOnlyQuickEntryDetails,
  buildHandDetailViewModel
}
