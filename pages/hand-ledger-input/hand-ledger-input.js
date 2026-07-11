const dataService = require('../../services/data-service')
const aiService = require('../../services/ai-service')
const cardUi = require('../../utils/card-ui')
const allInEv = require('../../utils/all-in-ev')
const sessionStack = require('../../utils/session-stack')

const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']
const SUITS = [
  { key: 's', symbol: '\u2660', suitClass: 'spade' },
  { key: 'h', symbol: '\u2665', suitClass: 'heart' },
  { key: 'd', symbol: '\u2666', suitClass: 'diamond' },
  { key: 'c', symbol: '\u2663', suitClass: 'club' }
]

const TABLE_OPTIONS = ['6', '8', '9']
const LEVEL_OPTIONS = ['200/400', '300/600', '500/1000', '1000/2000']
const GAME_OPTIONS = ['NLHE']
const POSITION_WHEELS = {
  6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'],
  8: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'HJ', 'CO'],
  9: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO']
}
const VISUAL_SLOTS = {
  6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'],
  8: ['BTN', 'SB', 'BB', 'UTG', 'UTG1', 'MP', 'HJ', 'CO'],
  9: ['BTN', 'SB', 'BB', 'UTG', 'UTG1', 'MP', 'LJ', 'HJ', 'CO']
}
const ACTION_ORDER = {
  6: ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  8: ['UTG', 'UTG+1', 'MP', 'HJ', 'CO', 'BTN', 'SB', 'BB'],
  9: ['UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']
}
const STREET_LABELS = {
  Pre: 'Pre',
  Flop: 'Flop',
  Turn: 'Turn',
  River: 'River'
}

function nowDateText() {
  const now = new Date()
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-')
}

function number(value) {
  return Number(value) || 0
}

function getChipUnitLabel(unit) {
  if (unit === 'CNY') return '\u00A5'
  if (unit === 'HKD') return 'HK$'
  if (unit === 'USD') return '$'
  if (unit === 'BB') return 'BB'
  return unit || '\u00A5'
}

function decodeQueryValue(value) {
  let text = String(value || '')
  for (let index = 0; index < 2 && /%[0-9a-f]{2}/i.test(text); index += 1) {
    try {
      text = decodeURIComponent(text)
    } catch (error) {
      break
    }
  }
  return text
}

function formatMoney(value, unit) {
  const label = getChipUnitLabel(unit)
  const amount = number(value).toLocaleString('zh-CN')
  if (label === 'BB') return amount + ' BB'
  return label + amount
}

function stackText(value) {
  const amount = number(value)
  if (!amount) return '0'
  if (amount >= 1000) {
    const k = amount / 1000
    return (Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)) + 'k'
  }
  return String(amount)
}

function parseLevel(levelText) {
  const parts = String(levelText || '').split('/')
  const sb = Number(parts[0]) || 200
  const bb = Number(parts[1]) || 400
  return { sb, bb, straddle: bb * 2 }
}

function sessionCurrentStack(session, hands, hand) {
  const handId = hand && (hand._id || hand.id)
  const handCutoff = hand && (hand.createdAtMs || hand.createdAt || hand.playedDate || hand.updatedAt)
  return sessionStack.calculateSessionStackAt(session, hands, {
    cutoffTime: handCutoff,
    cutoffMs: handCutoff ? 0 : Date.now(),
    excludeHandId: handId
  })
}

function normalizeCardToken(token) {
  const text = String(token || '')
  if (text.length < 2) return ''
  return text.charAt(0).toUpperCase() + text.charAt(1).toLowerCase()
}

function parseCards(value, limit) {
  return cardUi.parseCardsInput(value, limit)
}

function cardTokens(value, limit) {
  return parseCards(value, limit).map(card => card.rank + card.suit)
}

function cardLabelText(value, limit) {
  return parseCards(value, limit).map(card => card.rank + (card.suitSymbol || '')).join('')
}

function cardRankText(value, limit) {
  const parsed = parseCards(value, limit)
  if (parsed.length) return parsed.map(card => card.rank).join('')
  const text = String(value || '').toUpperCase().replace(/10/g, 'T')
  const ranks = text.match(/[AKQJT2-9]/g) || []
  return ranks.slice(0, limit || ranks.length).join('')
}

function rankValue(rank) {
  return ({ A: 14, K: 13, Q: 12, J: 11, T: 10 })[rank] || Number(rank) || 0
}

function compareScore(a, b) {
  const left = a || []
  const right = b || []
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const diff = number(left[index]) - number(right[index])
    if (diff) return diff
  }
  return 0
}

function combinations(list, choose) {
  const result = []
  function walk(start, picked) {
    if (picked.length === choose) {
      result.push(picked.slice())
      return
    }
    for (let index = start; index <= list.length - (choose - picked.length); index += 1) {
      picked.push(list[index])
      walk(index + 1, picked)
      picked.pop()
    }
  }
  walk(0, [])
  return result
}

function evaluateFive(cards) {
  const ranks = cards.map(card => rankValue(card.rank)).sort((a, b) => b - a)
  const suits = cards.map(card => card.suit)
  const flush = suits.every(suit => suit === suits[0])
  const uniqueRanks = Array.from(new Set(ranks)).sort((a, b) => b - a)
  const wheel = uniqueRanks.join(',') === '14,5,4,3,2'
  const straightHigh = wheel
    ? 5
    : uniqueRanks.length === 5 && uniqueRanks[0] - uniqueRanks[4] === 4
      ? uniqueRanks[0]
      : 0
  const groups = uniqueRanks
    .map(rank => ({ rank, count: ranks.filter(item => item === rank).length }))
    .sort((a, b) => b.count - a.count || b.rank - a.rank)
  if (flush && straightHigh) return [8, straightHigh]
  if (groups[0].count === 4) return [7, groups[0].rank, groups[1].rank]
  if (groups[0].count === 3 && groups[1].count === 2) return [6, groups[0].rank, groups[1].rank]
  if (flush) return [5].concat(ranks)
  if (straightHigh) return [4, straightHigh]
  if (groups[0].count === 3) return [3, groups[0].rank].concat(groups.slice(1).map(group => group.rank))
  if (groups[0].count === 2 && groups[1].count === 2) return [2, groups[0].rank, groups[1].rank, groups[2].rank]
  if (groups[0].count === 2) return [1, groups[0].rank].concat(groups.slice(1).map(group => group.rank))
  return [0].concat(ranks)
}

function bestScore(cards) {
  if (!cards || cards.length < 5) return null
  return combinations(cards, 5).reduce((best, combo) => {
    const score = evaluateFive(combo)
    return !best || compareScore(score, best) > 0 ? score : best
  }, null)
}

function compareHoldemHands(heroCards, villainCards, boardCards) {
  const heroScore = bestScore((heroCards || []).concat(boardCards || []))
  const villainScore = bestScore((villainCards || []).concat(boardCards || []))
  if (!heroScore || !villainScore) return 0
  return compareScore(heroScore, villainScore)
}

function uniqueCardKey(card) {
  return card && card.rank && card.suit ? card.rank + card.suit : ''
}

function remainingDeck(excludedCards) {
  const excluded = new Set((excludedCards || []).map(uniqueCardKey).filter(Boolean))
  const deck = []
  SUITS.forEach(suit => {
    RANKS.forEach(rank => {
      const token = rank + suit.key
      if (!excluded.has(token)) {
        deck.push({ rank, suit: suit.key, suitSymbol: suit.symbol, suitClass: suit.suitClass })
      }
    })
  })
  return deck
}

function boardCardsAtAllIn(board, street) {
  const normalized = String(street || '').toLowerCase()
  const flop = parseCards(board && board.flop, 3)
  if (normalized === 'flop') return flop
  const turn = parseCards(board && board.turn, 1)
  if (normalized === 'turn') return flop.concat(turn)
  if (normalized === 'river') return flop.concat(turn).concat(parseCards(board && board.river, 1))
  return []
}

function estimateHeroEquityPct(heroCards, villainCards, knownBoard) {
  const hero = heroCards || []
  const villain = villainCards || []
  const board = knownBoard || []
  if (hero.length !== 2 || villain.length !== 2) return null
  const need = Math.max(0, 5 - board.length)
  const deck = remainingDeck(hero.concat(villain, board))
  let total = 0
  let heroWins = 0
  let ties = 0
  const maxSamples = 6000
  function score(runout) {
    const diff = compareHoldemHands(hero, villain, board.concat(runout))
    total += 1
    if (diff > 0) heroWins += 1
    else if (diff === 0) ties += 1
  }
  if (need === 0) {
    score([])
  } else if (need <= 2) {
    combinations(deck, need).forEach(score)
  } else {
    const combos = combinations(deck, need)
    const step = Math.max(1, Math.floor(combos.length / maxSamples))
    for (let index = 0; index < combos.length && total < maxSamples; index += step) {
      score(combos[index])
    }
  }
  if (!total) return null
  return Math.round(((heroWins + ties * 0.5) / total) * 10000) / 100
}

function buildPotChipStacks(pot, levelText) {
  const bb = parseLevel(levelText).bb || 400
  const count = Math.max(4, Math.min(18, Math.ceil(number(pot) / bb)))
  const stackCount = Math.min(5, Math.max(3, Math.ceil(count / 4)))
  const stacks = Array.from({ length: stackCount }).map((_, stackIndex) => ({
    key: 'stack-' + stackIndex,
    chips: []
  }))
  for (let index = 0; index < count; index += 1) {
    const stack = stacks[index % stackCount]
    stack.chips.push({
      key: 'chip-' + index,
      tone: index % 5
    })
  }
  return stacks
}

function showActionLine(actor, cards) {
  const shown = cardRankText(cards, 2)
  return [actor, 'show', shown].filter(Boolean).join(' ')
}

function buildStreetLine(items, street, showdownCards) {
  return (items || [])
    .filter(item => item.street === street && !['Post', 'Start'].includes(item.action))
    .filter(item => !(street === 'Pre' && item.action === 'Fold'))
    .map(item => {
      const actor = item.position || item.pos
      if (item.action === 'Fold') return actor + ' F'
      if (item.action === 'X') return actor + ' check'
      if (item.action === 'Call') return actor + ' call ' + item.amount
      if (item.action === 'Bet') return actor + ' bet ' + item.amount
      if (item.action === 'Raise') return actor + ' raise ' + item.amount
      if (item.action === 'All-in') return actor + ' all-in ' + item.amount
      if (item.action === 'Show') return showActionLine(actor, item.cards || item.showdown || showdownCards)
      if (item.action === 'Muck') return 'muck'
      return [actor, item.action, item.amount].filter(Boolean).join(' ')
    })
    .join(', ')
}

function actionActorLabel(item, heroPosition) {
  const actor = item && (item.position || item.pos) || ''
  if (!actor) return ''
  return actor === heroPosition ? 'Hero ' + actor : actor
}

function buildStreetLineWithHero(items, street, heroPosition, showdownCards) {
  return (items || [])
    .filter(item => item.street === street && !['Post', 'Start'].includes(item.action))
    .filter(item => !(street === 'Pre' && item.action === 'Fold'))
    .map(item => {
      const actor = actionActorLabel(item, heroPosition)
      if (item.action === 'Fold') return actor + ' F'
      if (item.action === 'X') return actor + ' check'
      if (item.action === 'Call') return actor + ' call ' + item.amount
      if (item.action === 'Bet') return actor + ' bet ' + item.amount
      if (item.action === 'Raise') return actor + ' raise ' + item.amount
      if (item.action === 'All-in') return actor + ' all-in ' + item.amount
      if (item.action === 'Show') return showActionLine(actor, item.cards || item.showdown || showdownCards)
      if (item.action === 'Muck') return 'muck'
      return [actor, item.action, item.amount].filter(Boolean).join(' ')
    })
    .join(', ')
}

function buildStructuredActionSummary(actions, heroPosition) {
  const lines = ['Pre', 'Flop', 'Turn', 'River']
    .map(street => {
      const line = buildStreetLineWithHero(actions, street, heroPosition)
      return line ? street + ': ' + line : ''
    })
    .filter(Boolean)
  return lines.join(' / ')
}

function buildPlayerLibraryOption(note, selectedId) {
  const source = note || {}
  const leakTags = Array.isArray(source.leakTags) ? source.leakTags : []
  const alias = Array.isArray(source.alias) ? source.alias : []
  return {
    _id: source._id || '',
    name: source.name || '',
    alias,
    type: source.type || '',
    note: source.note || '',
    leakTags,
    leakText: leakTags.slice(0, 2).join(' / '),
    active: !!source._id && source._id === selectedId
  }
}

function filterPlayerLibraryOptions(options, query) {
  const keyword = String(query || '').trim().toLowerCase()
  if (!keyword) return []
  return (options || []).filter(item => {
    const aliasText = (item.alias || []).join(' ')
    return [
      item.name,
      aliasText
    ].some(value => String(value || '').toLowerCase().indexOf(keyword) > -1)
  })
}

function buildPlayerTypeOptions(types, selectedType) {
  return (types || []).map(item => {
    const type = typeof item === 'string' ? item : item.type
    return {
      type,
      active: !!type && type === selectedType
    }
  })
}

function buildLedgerAdviceQuestion(hand) {
  const source = hand || {}
  const parts = [
    '请基于结构化手牌字段给出德州扑克复盘建议。',
    '不要重新解析自然语言；以 structuredHand/extractedHand 中的字段为准。'
  ]
  if (source.isAllIn && source.allInStreet && source.allInStreet !== 'river') {
    parts.push('本手牌在 ' + source.allInStreet + ' 已经发生全下并终止后续决策，之后公共牌只是 runout。')
    parts.push('AI建议只分析全下发生前和全下决策本身，不要给 flop/turn/river 后续行动建议。')
  }
  if (source.heroPosition) parts.push('Hero 位置：' + source.heroPosition + '。')
  if (source.heroCardsInput) parts.push('Hero 手牌：' + source.heroCardsInput + '。')
  if (source.effectiveStack) parts.push('有效筹码：' + source.effectiveStack + '。')
  if (source.potSize) parts.push('记录底池：' + source.potSize + '。')
  if (source.allInPot) parts.push('All-in 底池：' + source.allInPot + '。')
  if (source.heroInvested) parts.push('Hero all-in 有效投入：' + source.heroInvested + '。')
  if (source.allInEv !== '' && source.allInEv !== undefined) parts.push('All-in EV：' + source.allInEv + '。')
  if (source.allInEvStatus) parts.push('All-in EV 状态：' + source.allInEvStatus + '。')
  if (source.showdown) parts.push('对手摊牌：' + source.showdown + '。')
  const structuredActionSummary = source.actionSummary || buildStructuredActionSummary(source.actions, source.heroPosition)
  if (structuredActionSummary) parts.push('结构化行动线：' + structuredActionSummary)
  if (source.streetSummary) parts.push('行动线：' + source.streetSummary)
  return parts.join('\n')
}

function normalizeHeadsUpAllInState(playersInput, potInput, lastRaiseInput) {
  const players = Object.assign({}, playersInput || {})
  const live = Object.keys(players).filter(slot => players[slot] && players[slot].live)
  if (live.length !== 2) return { players, pot: number(potInput), lastRaise: number(lastRaiseInput), changed: false }
  if (!live.some(slot => players[slot] && players[slot].allIn)) {
    return { players, pot: number(potInput), lastRaise: number(lastRaiseInput), changed: false }
  }
  const paidValues = live
    .map(slot => number(players[slot] && players[slot].paid))
    .filter(amount => amount > 0)
  if (paidValues.length !== 2) return { players, pot: number(potInput), lastRaise: number(lastRaiseInput), changed: false }
  const effectivePaid = Math.min.apply(null, paidValues)
  if (!effectivePaid) return { players, pot: number(potInput), lastRaise: number(lastRaiseInput), changed: false }
  let refundTotal = 0
  let stackChanged = false
  live.forEach(slot => {
    const player = Object.assign({}, players[slot])
    const paid = number(player.paid)
    if (paid > effectivePaid) {
      const refund = paid - effectivePaid
      const initialStack = number(player.initialStack)
      refundTotal += refund
      player.paid = effectivePaid
      player.stack = initialStack > 0
        ? Math.max(0, initialStack - effectivePaid)
        : number(player.stack) + refund
      if (player.stack > 0) player.allIn = false
      players[slot] = player
    }
    if (players[slot] && players[slot].allIn && number(players[slot].stack) !== 0) {
      players[slot] = Object.assign({}, players[slot], { stack: 0 })
      stackChanged = true
    }
  })
  return {
    players,
    pot: Math.max(0, number(potInput) - refundTotal),
    lastRaise: refundTotal ? effectivePaid : number(lastRaiseInput),
    changed: refundTotal > 0 || stackChanged
  }
}

function headsUpAllInReadyToNormalize(playersInput, lastRaiseInput) {
  const players = playersInput || {}
  const live = Object.keys(players).filter(slot => players[slot] && players[slot].live)
  if (live.length !== 2) return false
  if (!live.some(slot => players[slot].allIn || number(players[slot].stack) === 0)) return false
  const lastRaiseAmount = number(lastRaiseInput)
  return live.every(slot => {
    const player = players[slot] || {}
    return player.allIn || number(player.stack) === 0 || number(player.paid) === lastRaiseAmount
  })
}

function clampPoint(point, bounds) {
  const safeBounds = bounds || {}
  return {
    x: Math.max(safeBounds.minX == null ? 7 : safeBounds.minX, Math.min(safeBounds.maxX == null ? 93 : safeBounds.maxX, point.x)),
    y: Math.max(safeBounds.minY == null ? 5 : safeBounds.minY, Math.min(safeBounds.maxY == null ? 95 : safeBounds.maxY, point.y))
  }
}

function tablePoint(slot, slots, scale, bounds) {
  const activeSlots = slots || []
  const index = activeSlots.indexOf(slot)
  const count = activeSlots.length || 8
  const normalizedIndex = index >= 0 ? index : 0
  const angle = (-45 + normalizedIndex * (360 / count)) * Math.PI / 180
  const distance = scale == null ? 1 : scale
  const centerX = 50
  const centerY = 50
  const radiusX = 40.8
  const radiusY = 44.4
  return clampPoint({
    x: centerX + Math.cos(angle) * radiusX * distance,
    y: centerY + Math.sin(angle) * radiusY * distance
  }, bounds)
}

function seatPoint(slot, slots) {
  return tablePoint(slot, slots, 1, { minX: 8.5, maxX: 91.5, minY: 6.5, maxY: 93.5 })
}

function betPoint(slot, slots) {
  return tablePoint(slot, slots, 0.74, { minX: 14, maxX: 86, minY: 13, maxY: 87 })
}

function cardPoint(slot, slots) {
  const seat = seatPoint(slot, slots)
  const centerX = 50
  const centerY = 50
  const dx = seat.x - centerX
  const dy = seat.y - centerY
  if (dy > 27) {
    return clampPoint({ x: seat.x, y: seat.y - 9.5 }, { minX: 9, maxX: 91, minY: 8, maxY: 84 })
  }
  if (dy < -27) {
    return clampPoint({ x: seat.x, y: seat.y + 9.5 }, { minX: 9, maxX: 91, minY: 12, maxY: 92 })
  }
  const verticalDirection = seat.y < centerY ? 1 : -1
  return clampPoint({ x: seat.x, y: seat.y + verticalDirection * 9.5 }, { minX: 9, maxX: 91, minY: 8, maxY: 92 })
}

function cardPlacement(slot, slots) {
  const seat = seatPoint(slot, slots)
  if (seat.y < 23) return 'below'
  if (seat.y > 77) return 'above'
  return seat.y < 50 ? 'below' : 'above'
}

function pointStyle(point) {
  return 'left:' + point.x.toFixed(2) + '%;top:' + point.y.toFixed(2) + '%;'
}

function offsetPointFromCenter(point, distance) {
  const centerX = 50
  const centerY = 50
  const dx = point.x - centerX
  const dy = point.y - centerY
  const length = Math.sqrt(dx * dx + dy * dy) || 1
  const nextX = point.x + (dx / length) * distance
  const nextY = point.y + (dy / length) * distance
  return {
    x: Math.max(6, Math.min(94, nextX)),
    y: Math.max(5, Math.min(95, nextY))
  }
}

Page({
  data: {
    mode: 'create',
    sessionId: '',
    handId: '',
    returnTo: '',
    playedDateOverride: '',
    session: null,
    tableOptions: TABLE_OPTIONS.map(item => item + 'max'),
    tableIndex: 1,
    tableMax: '8',
    levelOptions: LEVEL_OPTIONS,
    levelIndex: 0,
    levelText: '200/400',
    gameOptions: GAME_OPTIONS,
    hasStraddle: false,
    chipUnit: '\u00A5',
    chipUnitValue: 'CNY',
    phase: 'setup',
    street: 'Pre',
    phaseText: '璁剧疆妗屽瓙',
    streetTabs: [],
    dealerSlot: 'BTN',
    heroSlot: 'HJ',
    heroPosition: 'HJ',
    activeSlot: 'UTG1',
    activeLabel: 'UTG+1',
    pot: 600,
    potDisplay: '\u00A5600',
    potChipRows: [1, 2, 3],
    potChipStacks: buildPotChipStacks(600, '200/400'),
    chipPulse: false,
    chipFlights: [],
    chipCollects: [],
    lastChipFlight: null,
    lastChipCollect: null,
    lastDealAnimation: null,
    dealStreet: '',
    turnFlowStyle: '',
    seats: [],
    players: {},
    defaultStack: 40000,
    defaultOpponentStack: 40000,
    heroCardsInput: '',
    heroCardsVisual: [],
    board: { flop: '', turn: '', river: '' },
    boardSlots: [],
    actions: [],
    trail: [],
    trailScrollLeft: 0,
    timelineActions: null,
    selectedTrailIndex: -1,
    actionOptions: [],
    lastRaise: 400,
    amountSheetVisible: false,
    amountAction: '',
    amountActionLabel: '',
    amountInput: '',
    amountInputFocus: false,
    amountPresets: [],
    maxStack: 40000,
    cardPickerVisible: false,
    cardPickerTarget: '',
    cardPickerSeatSlot: '',
    cardPickerTitle: '',
    pickedTokens: [],
    pickedPreview: [],
    cardDeck: [],
    resultSheetVisible: false,
    profitSign: '+',
    profitDigits: '',
    autoProfit: 0,
    autoProfitDisplay: '\u00A50',
    showdownResult: '',
    showdownMode: false,
    villainCards: '',
    seatMenuVisible: false,
    seatMenuSlot: '',
    seatMenuLabel: '',
    stackSheetVisible: false,
    stackEffectiveInput: '',
    playerSheetVisible: false,
    playerNameInput: '',
    playerNoteInput: '',
    selectedPlayerNoteId: '',
    selectedPlayerType: '',
    selectedPlayerLeakTags: [],
    playerTypeOptions: [],
    playerLibraryQuery: '',
    playerLibraryAllOptions: [],
    playerLibraryOptions: [],
    playerLibraryLoading: false,
    saved: false,
    saving: false,
    history: []
  },

  async onLoad(options) {
    const sessionId = String(options.sessionId || '')
    const handId = String(options.handId || '')
    const returnTo = String(options.returnTo || '')
    const playedDateOverride = decodeQueryValue(options.playedDate)
    const tableMax = String(options.tableMax || '8').replace(/\D/g, '') || '8'
    const tableIndex = Math.max(0, TABLE_OPTIONS.indexOf(tableMax))
    this.setData({
      sessionId,
      handId,
      returnTo,
      playedDateOverride,
      mode: handId ? 'edit' : 'create',
      tableMax,
      tableIndex: tableIndex >= 0 ? tableIndex : 1
    })
    await this.loadInitialData()
  },

  async loadInitialData() {
    const settings = dataService.getAppSettings ? await dataService.getAppSettings() : {}
    const chipUnitValue = settings.chipUnit || 'CNY'
    const chipUnit = getChipUnitLabel(chipUnitValue)
    let session = null
    let hand = null
    let sessionHands = []
    if (this.data.handId) {
      hand = await dataService.getHandById(this.data.handId)
      if (hand) session = await dataService.getSessionById(hand.sessionId)
    }
    if (!session && this.data.sessionId) {
      if (typeof dataService.getSessionDetailData === 'function') {
        const detail = await dataService.getSessionDetailData(this.data.sessionId)
        session = detail && detail.session || null
        sessionHands = detail && detail.hands || []
      }
      if (!session) session = await dataService.getSessionById(this.data.sessionId)
    } else if (session && typeof dataService.getSessionDetailData === 'function') {
      const detail = await dataService.getSessionDetailData(session._id || hand.sessionId)
      session = detail && detail.session || session
      sessionHands = detail && detail.hands || []
    }
    const levelText = session && session.smallBlind && session.bigBlind
      ? String(session.smallBlind) + '/' + String(session.bigBlind)
      : this.data.levelText
    const nextTableMax = String((session && session.tableSize) || this.data.tableMax || '8').replace(/\D/g, '') || '8'
    const tableIndex = Math.max(0, TABLE_OPTIONS.indexOf(nextTableMax))
    const levelIndex = Math.max(0, LEVEL_OPTIONS.indexOf(levelText))
    const patch = {
      session,
      sessionId: session && session._id || this.data.sessionId,
      tableMax: nextTableMax,
      tableIndex: tableIndex >= 0 ? tableIndex : 1,
      levelText,
      levelIndex: levelIndex >= 0 ? levelIndex : 0,
      chipUnit,
      chipUnitValue,
      playerTypeOptions: (settings.opponentTypes || []).map(type => ({
        type,
        active: false
      })),
      hasStraddle: !!(session && session.hasStraddle),
      defaultStack: sessionCurrentStack(session, sessionHands, hand) || this.data.defaultStack,
      defaultOpponentStack: parseLevel(levelText).bb * 100,
      heroCardsInput: hand && hand.heroCardsInput || this.data.heroCardsInput,
      board: hand && hand.board ? hand.board : this.data.board,
      profitDigits: hand && hand.currentProfit ? String(Math.abs(Number(hand.currentProfit) || 0)) : '',
      profitSign: hand && Number(hand.currentProfit) < 0 ? '-' : '+'
    }
    this.setData(patch)
    if (hand && hand.ledgerState) {
      this.restoreLedgerState(hand.ledgerState)
    } else {
      this.resetHandState()
    }
    this.updateAll()
  },

  activeSlots() {
    return VISUAL_SLOTS[this.data.tableMax] || VISUAL_SLOTS[8]
  },

  positionWheel() {
    return POSITION_WHEELS[this.data.tableMax] || POSITION_WHEELS[8]
  },

  actionPositions() {
    return ACTION_ORDER[this.data.tableMax] || ACTION_ORDER[8]
  },

  buildSeatLabels() {
    const slots = this.activeSlots()
    const wheel = this.positionWheel()
    let dealerSlot = this.data.dealerSlot
    if (slots.indexOf(dealerSlot) === -1) dealerSlot = slots[0]
    const dealerIndex = slots.indexOf(dealerSlot)
    const labels = {}
    slots.forEach((slot, index) => {
      const offset = (index - dealerIndex + slots.length) % slots.length
      labels[slot] = wheel[offset] || slot
    })
    return labels
  },

  slotForPosition(position) {
    const labels = this.buildSeatLabels()
    return Object.keys(labels).find(slot => labels[slot] === position) || position.replace('+', '')
  },

  displayLabel(slot) {
    return this.buildSeatLabels()[slot] || slot
  },

  buildInitialLedgerState() {
    const slots = this.activeSlots()
    const blinds = parseLevel(this.data.levelText)
    const currentPlayers = this.data.players || {}
    const players = {}
    ;['BTN', 'SB', 'BB', 'UTG', 'UTG1', 'MP', 'LJ', 'HJ', 'CO'].forEach(slot => {
      const current = currentPlayers[slot] || {}
      const defaultStack = slot === this.data.heroSlot
        ? number(this.data.defaultStack) || 40000
        : number(this.data.defaultOpponentStack) || (blinds.bb * 100) || 40000
      const initialStack = number(current.initialStack) || defaultStack
      players[slot] = {
        live: slots.indexOf(slot) > -1,
        paid: 0,
        allIn: false,
        initialStack,
        stack: initialStack,
        animating: false,
        betLand: false,
        cards: current.cards || '',
        playerNoteId: current.playerNoteId || '',
        playerName: current.playerName || '',
        playerType: current.playerType || '',
        playerNote: current.playerNote || '',
        playerLeakTags: current.playerLeakTags || []
      }
    })
    const sbSlot = this.slotForPosition('SB')
    const bbSlot = this.slotForPosition('BB')
    const strSlot = this.slotForPosition('UTG')
    players[sbSlot].paid = blinds.sb
    players[bbSlot].paid = blinds.bb
    if (this.data.hasStraddle) players[strSlot].paid = blinds.straddle
    const actions = [
      { street: 'Pre', pos: sbSlot, position: 'SB', action: 'Post', amount: blinds.sb },
      { street: 'Pre', pos: bbSlot, position: 'BB', action: 'Post', amount: blinds.bb }
    ]
    if (this.data.hasStraddle) {
      actions.push({ street: 'Pre', pos: strSlot, position: 'UTG', action: 'Str', amount: blinds.straddle })
    }
    const activeSlot = this.slotForPosition(this.data.hasStraddle ? 'UTG+1' : 'UTG')
    return {
      players,
      activeSlot,
      activeLabel: this.displayLabel(activeSlot),
      street: 'Pre',
      pot: blinds.sb + blinds.bb + (this.data.hasStraddle ? blinds.straddle : 0),
      lastRaise: this.data.hasStraddle ? blinds.straddle : blinds.bb,
      actions
    }
  },

  resetHandState() {
    const initial = this.buildInitialLedgerState()
    this.setData({
      players: initial.players,
      activeSlot: initial.activeSlot,
      activeLabel: initial.activeLabel,
      street: initial.street,
      pot: initial.pot,
      lastRaise: initial.lastRaise,
      actions: initial.actions,
      saved: false
    })
  },

  restoreLedgerState(state) {
    const source = state || {}
    const tableMax = String(source.tableMax || this.data.tableMax || '8')
    const tableIndex = Math.max(0, TABLE_OPTIONS.indexOf(tableMax))
    const levelText = source.levelText || this.data.levelText
    const levelIndex = Math.max(0, LEVEL_OPTIONS.indexOf(levelText))
    this.setData({
      tableMax,
      tableIndex: tableIndex >= 0 ? tableIndex : this.data.tableIndex,
      levelText,
      levelIndex: levelIndex >= 0 ? levelIndex : this.data.levelIndex,
      hasStraddle: !!source.hasStraddle,
      dealerSlot: source.dealerSlot || this.data.dealerSlot,
      heroSlot: source.heroSlot || this.data.heroSlot,
      heroPosition: source.heroPosition || this.data.heroPosition,
      heroCardsInput: source.heroCardsInput || this.data.heroCardsInput,
      villainCards: source.villainCards || '',
      showdownResult: source.showdownResult || '',
      board: Object.assign({ flop: '', turn: '', river: '' }, source.board || {}),
      profitSign: source.profitSign || this.data.profitSign,
      profitDigits: source.profitDigits || this.data.profitDigits,
      autoProfit: number(source.autoProfit)
    })
    const base = this.buildInitialLedgerState()
    const restoredPlayers = Object.assign({}, base.players)
    Object.keys(source.players || {}).forEach(slot => {
      restoredPlayers[slot] = Object.assign({}, restoredPlayers[slot] || {}, source.players[slot] || {})
    })
    const actions = Array.isArray(source.actions) && source.actions.length ? source.actions.map(item => Object.assign({}, item)) : base.actions
    if (source.villainCards && !Object.keys(restoredPlayers).some(slot => restoredPlayers[slot] && restoredPlayers[slot].cards === source.villainCards)) {
      const showdownAction = (actions || []).slice().reverse().find(item => item && (item.action === 'Show' || item.action === 'Muck') && item.pos)
      const villainSlot = (showdownAction && showdownAction.pos)
        || source.villainSlot
        || source.opponentSlot
        || Object.keys(restoredPlayers).find(slot => slot !== (source.heroSlot || this.data.heroSlot) && restoredPlayers[slot] && restoredPlayers[slot].live)
      if (villainSlot && restoredPlayers[villainSlot]) {
        restoredPlayers[villainSlot] = Object.assign({}, restoredPlayers[villainSlot], { cards: source.villainCards })
      }
    }
    this.setData({ players: restoredPlayers })
    const replay = this.replayActions(actions)
    this.setData({
      phase: 'play',
      actions,
      players: replay.players,
      pot: Number.isFinite(Number(source.pot)) ? number(source.pot) : replay.pot,
      lastRaise: replay.lastRaise,
      street: source.street || replay.street,
      activeSlot: source.activeSlot || replay.activeSlot,
      showdownMode: !!source.showdownMode,
      saved: false
    })
  },

  pushHistory() {
    this.data.history.push(JSON.parse(JSON.stringify({
      phase: this.data.phase,
      street: this.data.street,
      dealerSlot: this.data.dealerSlot,
      heroSlot: this.data.heroSlot,
      activeSlot: this.data.activeSlot,
      pot: this.data.pot,
      lastRaise: this.data.lastRaise,
      players: this.data.players,
      actions: this.data.actions,
      timelineActions: this.data.timelineActions,
      selectedTrailIndex: this.data.selectedTrailIndex,
      board: this.data.board,
      heroCardsInput: this.data.heroCardsInput,
      saved: this.data.saved
    })))
  },

  undo() {
    const snapshot = this.data.history.pop()
    if (!snapshot) return
    this.setData(snapshot)
    this.updateAll()
  },

  updateAll(extra) {
    const labels = this.buildSeatLabels()
    const players = this.data.players || {}
    const heroCardsVisual = parseCards(this.data.heroCardsInput, 2)
    const activeSlots = this.activeSlots()
    const seats = ['BTN', 'SB', 'BB', 'UTG', 'UTG1', 'MP', 'LJ', 'HJ', 'CO'].map(slot => {
      const player = players[slot] || {}
      const active = activeSlots.indexOf(slot) > -1
      const seat = seatPoint(slot, activeSlots)
      const bet = betPoint(slot, activeSlots)
      const cards = cardPoint(slot, activeSlots)
      return {
        slot,
        active,
        label: labels[slot] || slot,
        seatStyle: pointStyle(seat),
        betStyle: pointStyle(bet),
        cardsStyle: pointStyle(cards),
        cardPlacement: cardPlacement(slot, activeSlots),
        stackText: stackText(player.stack == null ? 40000 : player.stack),
        paidText: active && player.paid ? formatMoney(player.paid, this.data.chipUnitValue) : '',
        hero: slot === this.data.heroSlot,
        dealer: slot === this.data.dealerSlot,
        current: slot === this.data.activeSlot && this.data.phase === 'play' && !this.data.saved,
        folded: active && !player.live,
        allIn: !!player.allIn,
        animating: !!player.animating,
        betLand: !!player.betLand,
        playerName: player.playerName || '',
        cardsVisual: parseCards(player.cards || '', 2)
      }
    })
    const heroPosition = labels[this.data.heroSlot] || ''
    const heroCardsStyle = pointStyle(cardPoint(this.data.heroSlot, activeSlots))
    const heroCardPlacement = cardPlacement(this.data.heroSlot, activeSlots)
    const turnFlowStyle = pointStyle(seatPoint(this.data.activeSlot, activeSlots))
    const streetTabs = ['Pre', 'Flop', 'Turn', 'River'].map(key => ({
      key,
      label: STREET_LABELS[key],
      active: key === this.data.street
    }))
    const boardSlots = this.buildBoardSlots()
    const trail = this.buildTrail()
    const actionOptions = this.buildActionOptions()
    const phaseText = this.data.phase === 'setup'
      ? '\u8bbe\u7f6e\u684c\u5b50'
      : this.data.phase === 'moveButton'
        ? '\u79fb\u52a8\u6309\u94ae'
        : this.data.phase === 'heroCards'
          ? '\u9009\u62e9\u6211\u4eec\u7684\u624b\u724c'
          : (this.data.street === 'Pre' ? 'Preflop' : this.data.street) + ' · ' + (this.data.saved ? '\u5df2\u4fdd\u5b58' : '\u7b49\u5f85 ' + (labels[this.data.activeSlot] || this.data.activeSlot))
    this.setData(Object.assign({
      seats,
      heroPosition,
      activeLabel: labels[this.data.activeSlot] || this.data.activeSlot,
      streetTabs,
      boardSlots,
      trail,
      trailScrollLeft: Math.max(0, trail.length * 162),
      actionOptions,
      heroCardsVisual,
      heroCardsStyle,
      heroCardPlacement,
      turnFlowStyle,
      potDisplay: formatMoney(this.data.pot, this.data.chipUnitValue),
      autoProfitDisplay: formatMoney(Math.abs(number(this.data.autoProfit)), this.data.chipUnitValue),
      potChipRows: Array.from({ length: Math.max(2, Math.min(16, Math.ceil(number(this.data.pot) / parseLevel(this.data.levelText).bb))) }).map((_, index) => index),
      potChipStacks: buildPotChipStacks(this.data.pot, this.data.levelText),
      phaseText
    }, extra || {}))
  },

  buildBoardSlots() {
    const street = this.data.street
    const flop = parseCards(this.data.board.flop, 3)
    const turn = parseCards(this.data.board.turn, 1)
    const river = parseCards(this.data.board.river, 1)
    const all = [flop[0], flop[1], flop[2], turn[0], river[0]]
    return all.map((card, index) => Object.assign({
      gap: index === 3 || index === 4,
      dim: (index === 3 && street === 'Flop') || (index === 4 && (street === 'Flop' || street === 'Turn')),
      dealing: !!card && (
        (this.data.dealStreet === 'Flop' && index < 3) ||
        (this.data.dealStreet === 'Turn' && index === 3) ||
        (this.data.dealStreet === 'River' && index === 4)
      ),
      card: !!card
    }, card || {}))
  },

  buildTrail() {
    const visible = (this.timelineSourceActions() || [])
      .filter(item => item.action !== 'Post' && item.action !== 'Str')
    return visible.map((item, index) => {
        const amountText = item.amount ? ' ' + Number(item.amount).toLocaleString('zh-CN') : ''
        let main = item.action === 'X' ? 'X' : item.action + amountText
        if (item.action === 'Start') main = this.streetTrailMain(item.street)
        const toneMap = {
          Fold: 'fold',
          Call: 'call',
          Raise: 'raise',
          Bet: 'bet',
          'All-in': 'allin',
          X: 'check',
          Show: 'show',
          Muck: 'muck',
          Start: 'street'
        }
        return {
          main,
          sub: item.position || item.pos,
          tone: toneMap[item.action] || 'street',
          active: this.data.selectedTrailIndex >= 0 ? index === this.data.selectedTrailIndex : index === visible.length - 1
        }
      })
  },

  timelineSourceActions() {
    return Array.isArray(this.data.timelineActions) && this.data.timelineActions.length
      ? this.data.timelineActions
      : (this.data.actions || [])
  },

  streetTrailMain(street) {
    if (street === 'Flop') return cardLabelText(this.data.board.flop, 3) || 'Flop'
    if (street === 'Turn') return cardLabelText(this.data.board.turn, 1) || 'Turn'
    if (street === 'River') return cardLabelText(this.data.board.river, 1) || 'River'
    return street || 'Start'
  },

  buildActionOptions() {
    if (this.data.phase !== 'play' || this.data.saved) return []
    if (this.data.showdownMode) {
      return [
        { action: 'MUCK', label: 'Muck', tone: 'muck' },
        { action: 'SHOW', label: 'Show...', tone: 'show' }
      ]
    }
    const player = this.data.players[this.data.activeSlot] || {}
    if (!player.live || player.allIn) return []
    const toCall = Math.max(0, number(this.data.lastRaise) - number(player.paid))
    const allInAmount = number(player.stack) || 40000
    if (toCall > 0) {
      return [
        { action: 'F', label: 'Fold', tone: 'fold' },
        { action: 'C', label: 'Call ' + number(toCall).toLocaleString('zh-CN'), tone: 'call' },
        { action: 'R', label: 'Raise...', tone: 'raise' },
        { action: 'AI', label: 'All-in ' + formatMoney(allInAmount, this.data.chipUnitValue), tone: 'allin' }
      ]
    }
    return [
      { action: 'X', label: 'Check', tone: 'check' },
      { action: 'B', label: 'Bet...', tone: 'bet' },
      { action: 'AI', label: 'All-in ' + formatMoney(allInAmount, this.data.chipUnitValue), tone: 'allin' }
    ]
  },

  changeTableMax(e) {
    const value = TABLE_OPTIONS[Number(e.detail.value)] || '8'
    this.pushHistory()
    this.setData({ tableMax: value, tableIndex: Number(e.detail.value) || 1 })
    if (this.activeSlots().indexOf(this.data.heroSlot) === -1) this.setData({ heroSlot: this.activeSlots()[0] })
    if (this.activeSlots().indexOf(this.data.dealerSlot) === -1) this.setData({ dealerSlot: this.activeSlots()[0] })
    this.resetHandState()
    this.updateAll()
  },

  changeLevel(e) {
    const value = LEVEL_OPTIONS[Number(e.detail.value)] || LEVEL_OPTIONS[0]
    this.pushHistory()
    this.setData({
      levelText: value,
      levelIndex: Number(e.detail.value) || 0,
      defaultOpponentStack: parseLevel(value).bb * 100
    })
    this.resetHandState()
    this.updateAll()
  },

  setStraddle(e) {
    this.pushHistory()
    this.setData({ hasStraddle: !!e.currentTarget.dataset.value })
    this.resetHandState()
    this.updateAll()
  },

  applyDefaultStacksForHero(nextHeroSlot, previousHeroSlot) {
    const players = Object.assign({}, this.data.players)
    const heroStack = number(this.data.defaultStack) || 40000
    const opponentStack = number(this.data.defaultOpponentStack) || (parseLevel(this.data.levelText).bb * 100) || 40000
    if (previousHeroSlot && players[previousHeroSlot]) {
      players[previousHeroSlot] = Object.assign({}, players[previousHeroSlot], {
        initialStack: opponentStack,
        stack: opponentStack
      })
    }
    if (nextHeroSlot && players[nextHeroSlot]) {
      players[nextHeroSlot] = Object.assign({}, players[nextHeroSlot], {
        initialStack: heroStack,
        stack: heroStack
      })
    }
    this.setData({ players })
  },

  nextSetup() {
    if (this.data.phase === 'setup') {
      this.pushHistory()
      this.setData({ phase: 'moveButton' })
      this.updateAll()
      return
    }
    if (this.data.phase === 'moveButton') {
      this.pushHistory()
      this.setData({ phase: 'heroCards' })
      this.openHeroPicker()
      this.updateAll()
    }
  },

  tapSeat(e) {
    const slot = e.currentTarget.dataset.slot
    if (!slot) return
    if (this.data.phase === 'setup') {
      this.openSeatMenu(slot)
      return
    }
    if (this.data.phase === 'moveButton') {
      this.pushHistory()
      this.setData({ dealerSlot: slot })
      this.resetHandState()
      this.animateSeats()
      this.updateAll()
      return
    }
    if (this.data.phase === 'heroCards') {
      this.pushHistory()
      const previousHeroSlot = this.data.heroSlot
      this.setData({ heroSlot: slot })
      this.applyDefaultStacksForHero(slot, previousHeroSlot)
      this.openHeroPicker()
      this.updateAll()
      return
    }
    if (this.data.phase !== 'play' || this.data.saved) return
    if (this.data.cardPickerVisible || !this.streetBoardReady(this.data.street)) return
    if (!this.data.players[slot] || !this.data.players[slot].live) return
    if (slot === this.data.activeSlot) {
      this.openSeatMenu(slot)
      return
    }
    this.pushHistory()
    this.autoFoldTo(slot)
    this.setData({ activeSlot: slot })
    this.animateSeats()
    this.updateAll()
  },

  longPressSeat(e) {
    const slot = e.currentTarget.dataset.slot
    if (!slot) return
    this.openSeatMenu(slot)
  },

  buildSeatMenuItems(slot) {
    const player = this.data.players[slot] || {}
    const isHero = slot === this.data.heroSlot
    const items = []
    if (this.data.phase === 'setup' && !isHero) {
      items.push({ action: 'sit', label: '入座' })
    }
    items.push({ action: 'stack', label: '有效筹码' })
    items.push({ action: 'cards', label: '设置手牌' })
    if (!isHero && player.live) {
      items.push({ action: 'player', label: '设置玩家' })
    }
    return items
  },

  openSeatMenu(slot) {
    if (!this.data.players[slot]) return
    this.setData({
      seatMenuVisible: true,
      seatMenuSlot: slot,
      seatMenuLabel: this.displayLabel(slot),
      seatMenuItems: this.buildSeatMenuItems(slot)
    })
  },

  closeSeatMenu() {
    this.setData({
      seatMenuVisible: false,
      seatMenuSlot: '',
      seatMenuLabel: '',
      seatMenuItems: []
    })
  },

  pickSeatMenu(e) {
    const action = String(e.currentTarget.dataset.action || '')
    const slot = this.data.seatMenuSlot
    if (!slot || !this.data.players[slot]) return
    if (action === 'sit') {
      const previousHeroSlot = this.data.heroSlot
      const players = Object.assign({}, this.data.players)
      players[slot] = Object.assign({}, players[slot], { live: true })
      this.setData({
        players,
        heroSlot: slot,
        seatMenuVisible: false
      })
      this.applyDefaultStacksForHero(slot, previousHeroSlot)
      this.updateAll()
      return
    }
    if (action === 'stack') {
      const player = this.data.players[slot] || {}
      this.setData({
        seatMenuVisible: false,
        stackSheetVisible: true,
        stackEffectiveInput: String(player.initialStack || player.stack || 40000)
      })
      return
    }
    if (action === 'cards') {
      this.setData({ seatMenuVisible: false })
      if (slot === this.data.heroSlot) {
        this.openHeroPicker()
      } else {
        this.openSeatCardsPicker(slot)
      }
      return
    }
    if (action === 'player') {
      const player = this.data.players[slot] || {}
      this.setData({
        seatMenuVisible: false,
        playerSheetVisible: true,
        selectedPlayerNoteId: player.playerNoteId || '',
        selectedPlayerType: player.playerType || '',
        selectedPlayerLeakTags: player.playerLeakTags || [],
        playerTypeOptions: buildPlayerTypeOptions(this.data.playerTypeOptions, player.playerType || ''),
        playerNameInput: player.playerName || '',
        playerNoteInput: player.playerNote || '',
        playerLibraryQuery: '',
        playerLibraryAllOptions: [],
        playerLibraryOptions: [],
        playerLibraryLoading: true
      })
      this.loadPlayerLibraryOptions(player.playerNoteId || '')
    }
  },

  closeStackSheet() {
    this.setData({ stackSheetVisible: false })
  },

  onStackInput(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    this.setData({ [key]: e.detail.value })
  },

  onStackSlider(e) {
    this.setData({ stackEffectiveInput: String(Math.round(number(e.detail.value))) })
  },

  unsetStack() {
    this.setData({
      stackEffectiveInput: ''
    })
  },

  setAllStacks() {
    const current = String(this.data.stackEffectiveInput || '40000')
    const effectiveStack = number(current)
    const players = Object.assign({}, this.data.players)
    Object.keys(players).forEach(slot => {
      if (slot === this.data.heroSlot) return
      players[slot] = Object.assign({}, players[slot], {
        initialStack: effectiveStack,
        stack: effectiveStack
      })
    })
    this.setData({ players, stackSheetVisible: false })
    this.updateAll()
  },

  saveStackSheet() {
    const slot = this.data.seatMenuSlot
    if (!slot || !this.data.players[slot]) return
    const players = Object.assign({}, this.data.players)
    const effectiveStack = number(this.data.stackEffectiveInput)
    players[slot] = Object.assign({}, players[slot], {
      initialStack: effectiveStack,
      stack: effectiveStack
    })
    this.setData({ players, stackSheetVisible: false })
    this.updateAll()
  },

  closePlayerSheet() {
    this.setData({ playerSheetVisible: false })
  },

  async loadPlayerLibraryOptions(selectedId) {
    try {
      const notes = await dataService.getPlayerNotes({})
      const selected = selectedId || this.data.selectedPlayerNoteId || ''
      const options = (notes || []).map(note => buildPlayerLibraryOption(note, selected))
      this.setData({
        playerLibraryAllOptions: options,
        playerLibraryOptions: filterPlayerLibraryOptions(options, this.data.playerLibraryQuery),
        playerLibraryLoading: false
      })
    } catch (error) {
      console.warn('load player library failed: ' + (error && (error.message || error.errMsg) || String(error)))
      this.setData({
        playerLibraryOptions: [],
        playerLibraryAllOptions: [],
        playerLibraryLoading: false
      })
    }
  },

  onPlayerLibrarySearchInput(e) {
    const query = e.detail.value || ''
    this.setData({
      playerLibraryQuery: query,
      playerLibraryOptions: filterPlayerLibraryOptions(this.data.playerLibraryAllOptions, query)
    })
  },

  selectPlayerType(e) {
    const type = String(e.currentTarget.dataset.type || '')
    this.setData({
      selectedPlayerType: type,
      playerTypeOptions: buildPlayerTypeOptions(this.data.playerTypeOptions, type)
    })
  },

  onPlayerInput(e) {
    const key = e.currentTarget.dataset.key
    if (!key) return
    this.setData({ [key]: e.detail.value })
  },

  selectPlayerLibraryNote(e) {
    const id = String(e.currentTarget.dataset.id || '')
    if (!id) return
    const note = (this.data.playerLibraryAllOptions || this.data.playerLibraryOptions || []).find(item => item._id === id)
    if (!note) return
    const allOptions = (this.data.playerLibraryAllOptions || []).map(item => Object.assign({}, item, {
      active: item._id === id
    }))
    this.setData({
      selectedPlayerNoteId: note._id,
      selectedPlayerType: note.type || '',
      selectedPlayerLeakTags: note.leakTags || [],
      playerTypeOptions: buildPlayerTypeOptions(this.data.playerTypeOptions, note.type || ''),
      playerNameInput: note.name || '',
      playerNoteInput: note.note || '',
      playerLibraryAllOptions: allOptions,
      playerLibraryOptions: filterPlayerLibraryOptions(allOptions, this.data.playerLibraryQuery)
    })
  },

  unlinkPlayer() {
    const slot = this.data.seatMenuSlot
    if (!slot || !this.data.players[slot]) return
    const players = Object.assign({}, this.data.players)
    players[slot] = Object.assign({}, players[slot], {
      playerNoteId: '',
      playerName: '',
      playerType: '',
      playerNote: '',
      playerLeakTags: []
    })
    this.setData({
      players,
      playerSheetVisible: false,
      selectedPlayerNoteId: '',
      selectedPlayerType: '',
      selectedPlayerLeakTags: [],
      playerTypeOptions: buildPlayerTypeOptions(this.data.playerTypeOptions, ''),
      playerNameInput: '',
      playerNoteInput: ''
    })
    this.updateAll()
  },

  applyPlayerSheetToSeat(playerPatch) {
    const slot = this.data.seatMenuSlot
    if (!slot || !this.data.players[slot]) return false
    const players = Object.assign({}, this.data.players)
    players[slot] = Object.assign({}, players[slot], playerPatch)
    this.setData({ players, playerSheetVisible: false })
    this.updateAll()
    return true
  },

  async savePlayerSheet() {
    if (!this.data.selectedPlayerNoteId && String(this.data.playerNameInput || '').trim()) {
      await this.createAndBindPlayerNote()
      return
    }
    this.applyPlayerSheetToSeat({
      playerNoteId: this.data.selectedPlayerNoteId,
      playerName: this.data.playerNameInput,
      playerType: this.data.selectedPlayerType,
      playerNote: this.data.playerNoteInput,
      playerLeakTags: this.data.selectedPlayerLeakTags || []
    })
  },

  async createAndBindPlayerNote() {
    const name = String(this.data.playerNameInput || '').trim()
    if (!name) {
      wx.showToast({ title: '请先填写玩家名字', icon: 'none' })
      return
    }
    const noteText = String(this.data.playerNoteInput || '').trim()
    try {
      const saved = await dataService.createPlayerNote({
        name,
        note: noteText,
        type: this.data.selectedPlayerType || '未分类',
        leakTags: []
      })
      const playerPatch = {
        playerNoteId: saved && saved._id || '',
        playerName: saved && saved.name || name,
        playerType: saved && saved.type || '未分类',
        playerNote: saved && saved.note || noteText,
        playerLeakTags: saved && saved.leakTags || []
      }
      this.setData({
        selectedPlayerNoteId: playerPatch.playerNoteId,
        selectedPlayerType: playerPatch.playerType,
        selectedPlayerLeakTags: playerPatch.playerLeakTags,
        playerTypeOptions: buildPlayerTypeOptions(this.data.playerTypeOptions, playerPatch.playerType),
        playerNameInput: playerPatch.playerName,
        playerNoteInput: playerPatch.playerNote
      })
      this.applyPlayerSheetToSeat(playerPatch)
    } catch (error) {
      wx.showToast({ title: '新增玩家失败', icon: 'none' })
    }
  },

  animateSeats() {
    const players = Object.assign({}, this.data.players)
    Object.keys(players).forEach(slot => { players[slot] = Object.assign({}, players[slot], { animating: true }) })
    this.setData({ players })
    setTimeout(() => {
      const next = Object.assign({}, this.data.players)
      Object.keys(next).forEach(slot => { next[slot] = Object.assign({}, next[slot], { animating: false }) })
      this.setData({ players: next })
      this.updateAll()
    }, 280)
  },

  actionOrderSlots() {
    return this.actionPositions().map(pos => this.slotForPosition(pos)).filter(slot => this.activeSlots().indexOf(slot) > -1)
  },

  actionDistance(from, to) {
    const order = this.actionOrderSlots()
    const a = order.indexOf(from)
    const b = order.indexOf(to)
    if (a < 0 || b < 0) return 0
    return (b - a + order.length) % order.length
  },

  nextActionAfter(slot) {
    return this.nextActionAfterInPlayers(slot, this.data.players)
  },

  nextActionAfterInPlayers(slot, players) {
    const order = this.actionOrderSlots()
    const start = order.indexOf(slot)
    for (let index = 1; index <= order.length; index += 1) {
      const next = order[(start + index) % order.length]
      const player = players[next]
      if (player && player.live && !player.allIn) return next
    }
    return slot
  },

  autoFoldTo(target) {
    if (target === this.data.activeSlot) return
    const distance = this.actionDistance(this.data.activeSlot, target)
    if (!distance || distance > this.activeSlots().length - 2) return
    const players = Object.assign({}, this.data.players)
    const actions = this.data.actions.slice()
    let cursor = this.data.activeSlot
    while (cursor !== target) {
      if (players[cursor] && players[cursor].live) {
        players[cursor] = Object.assign({}, players[cursor], { live: false, animating: true })
        actions.push({
          street: this.data.street,
          pos: cursor,
          position: this.displayLabel(cursor),
          action: 'Fold'
        })
      }
      cursor = this.nextActionAfterInPlayers(cursor, players)
      if (!cursor) break
    }
    this.setData({ players, actions })
  },

  buildChipFlight(slot, amount) {
    const point = betPoint(slot, this.activeSlots())
    return {
      key: String(Date.now()) + '-' + slot + '-' + String(amount),
      amountText: formatMoney(amount, this.data.chipUnitValue),
      style: pointStyle(point),
      chips: [0, 1, 2, 3, 4]
    }
  },

  buildChipCollects(playersInput) {
    const players = playersInput || this.data.players || {}
    return Object.keys(players)
      .filter(slot => players[slot] && number(players[slot].paid) > 0)
      .map((slot, index) => {
        const point = betPoint(slot, this.activeSlots())
        return {
          key: 'collect-' + Date.now() + '-' + slot + '-' + index,
          style: pointStyle(point),
          chips: [0, 1, 2, 3, 4]
        }
      })
  },

  triggerDealAnimation(street) {
    if (!street || street === 'Pre') return
    const animation = {
      key: 'deal-' + Date.now() + '-' + street,
      street
    }
    this.setData({
      dealStreet: street,
      lastDealAnimation: animation
    })
    setTimeout(() => {
      this.setData({ dealStreet: '' })
      this.updateAll()
    }, 620)
  },

  tapAction(e) {
    const action = e.currentTarget.dataset.action
    if (!action) return
    if (action === 'R' || action === 'B') {
      this.openAmountSheet(action)
      return
    }
    if (action === 'AI') {
      this.pushHistory()
      const player = this.data.players[this.data.activeSlot] || {}
      const allInAmount = number(player.paid) + (number(player.stack) || 40000)
      this.commitAction(action, allInAmount)
      return
    }
    if (action === 'SHOW') {
      if (!this.ensureShowdownBoardReady('SHOW')) return
      this.openVillainPicker()
      return
    }
    if (action === 'MUCK') {
      if (!this.ensureShowdownBoardReady('MUCK')) return
      this.pushHistory()
      return this.commitShowdown('Muck')
    }
    this.pushHistory()
    this.commitAction(action)
  },

  openAmountSheet(action) {
    const blinds = parseLevel(this.data.levelText)
    const pot = number(this.data.pot)
    const isPre = this.data.street === 'Pre'
    const presets = isPre
      ? [
          { label: '2.5bb', value: Math.round(blinds.bb * 2.5) },
          { label: '3bb', value: blinds.bb * 3 },
          { label: '5bb', value: blinds.bb * 5 },
          { label: '6bb', value: blinds.bb * 6 }
        ]
      : [
          { label: '25%', value: Math.round(pot * 0.25) },
          { label: '33%', value: Math.round(pot * 0.33) },
          { label: '50%', value: Math.round(pot * 0.5) },
          { label: '75%', value: Math.round(pot * 0.75) },
          { label: 'Pot', value: pot },
          { label: '150%', value: Math.round(pot * 1.5) },
          {
            label: 'AI',
            value: number(this.data.players[this.data.activeSlot].paid) + (number(this.data.players[this.data.activeSlot].stack) || 40000)
          }
        ]
    presets.push({ label: '\u81ea\u5b9a\u4e49', custom: true })
    this.setData({
      amountSheetVisible: true,
      amountAction: action,
      amountActionLabel: action === 'R' ? 'Raise' : 'Bet',
      amountInput: '0',
      amountInputFocus: false,
      amountPresets: presets,
      maxStack: number(this.data.players[this.data.activeSlot].stack) || 40000
    })
  },

  closeAmountSheet() {
    this.setData({ amountSheetVisible: false, amountInputFocus: false })
  },

  onAmountInput(e) {
    this.setData({ amountInput: e.detail.value })
  },

  onAmountSlider(e) {
    this.setData({ amountInput: String(Math.round(number(e.detail.value))) })
  },

  pickAmountPreset(e) {
    if (e.currentTarget.dataset.custom) {
      this.setData({ amountInput: '', amountInputFocus: false })
      return
    }
    this.setData({ amountInput: String(e.currentTarget.dataset.value || ''), amountInputFocus: false })
  },

  appendAmountDigit(e) {
    const digit = String(e.currentTarget.dataset.digit || '')
    if (!/^\d$/.test(digit)) return
    const current = String(this.data.amountInput || '')
    const next = current === '0' ? digit : current + digit
    this.setData({ amountInput: next })
  },

  handleAmountKeyTool(e) {
    const action = e.currentTarget.dataset.action || ''
    const current = String(this.data.amountInput || '')
    if (action === 'clear') {
      this.setData({ amountInput: '' })
      return
    }
    if (action === 'backspace') {
      this.setData({ amountInput: current.slice(0, -1) })
    }
  },

  submitAmount() {
    const amount = number(this.data.amountInput)
    if (!amount) {
      wx.showToast({ title: '\u8bf7\u8f93\u5165\u91d1\u989d', icon: 'none' })
      return
    }
    this.pushHistory()
    this.setData({ amountSheetVisible: false, amountInputFocus: false })
    this.commitAction(this.data.amountAction, amount)
  },

  commitAction(action, explicitAmount) {
    const active = this.data.activeSlot
    const players = Object.assign({}, this.data.players)
    const player = Object.assign({}, players[active])
    const actions = this.data.actions.slice()
    let pot = number(this.data.pot)
    let lastRaise = number(this.data.lastRaise)
    let invested = 0
    const position = this.displayLabel(active)
    if (action === 'F') {
      player.live = false
      actions.push({ street: this.data.street, pos: active, position, action: 'Fold' })
    } else if (action === 'X') {
      actions.push({ street: this.data.street, pos: active, position, action: 'X' })
    } else if (action === 'C') {
      invested = Math.min(number(player.stack), Math.max(0, lastRaise - number(player.paid)))
      player.paid += invested
      pot += invested
      if (invested >= number(player.stack)) player.allIn = true
      actions.push({ street: this.data.street, pos: active, position, action: 'Call', amount: invested })
    } else {
      const rawAmount = number(explicitAmount)
      const amount = action === 'AI' && rawAmount <= number(player.stack)
        ? number(player.paid) + rawAmount
        : rawAmount
      invested = Math.max(0, amount - number(player.paid))
      const isAllIn = action === 'AI' || invested >= number(player.stack)
      player.paid = amount
      pot += invested
      lastRaise = amount
      const actionName = isAllIn ? 'All-in' : action === 'B' ? 'Bet' : 'Raise'
      if (isAllIn) player.allIn = true
      actions.push({ street: this.data.street, pos: active, position, action: actionName, amount })
    }
    player.stack = Math.max(0, number(player.stack) - invested)
    player.betLand = invested > 0
    players[active] = player
    let next = this.nextActionAfter(active)
    const nextPatch = {
      players,
      actions,
      pot,
      lastRaise,
      activeSlot: next,
      chipPulse: invested > 0,
      timelineActions: null,
      selectedTrailIndex: -1
    }
    if (invested > 0) {
      const flight = this.buildChipFlight(active, invested)
      nextPatch.chipFlights = [flight]
      nextPatch.lastChipFlight = flight
    }
    this.setData(nextPatch)
    if (invested > 0) {
      setTimeout(() => {
        const current = Object.assign({}, this.data.players)
        if (current[active]) current[active] = Object.assign({}, current[active], { betLand: false })
        this.setData({ players: current, chipPulse: false, chipFlights: [] })
        this.updateAll()
      }, 780)
    }
    const afterResult = this.afterAction(next)
    this.updateAll()
    return afterResult
  },

  livePlayers() {
    return Object.keys(this.data.players).filter(slot => {
      const p = this.data.players[slot]
      return p && p.live
    })
  },

  actionablePlayers() {
    return this.livePlayers().filter(slot => !this.data.players[slot].allIn)
  },

  actedSlotsOnStreet() {
    const street = this.data.street
    const ignored = ['Post', 'Str', 'Start']
    return new Set((this.data.actions || [])
      .filter(item => item.street === street && ignored.indexOf(item.action) === -1)
      .map(item => item.pos)
      .filter(Boolean))
  },

  streetSettled() {
    const live = this.livePlayers()
    if (live.length <= 1) return true
    const actionable = this.actionablePlayers()
    if (!actionable.length) return true
    const acted = this.actedSlotsOnStreet()
    const allPaid = live.every(slot => {
      const player = this.data.players[slot]
      return player.allIn || number(player.paid) === number(this.data.lastRaise)
    })
    const allActionableActed = actionable.every(slot => acted.has(slot))
    return allPaid && allActionableActed
  },

  restoreSettledCallParticipants() {
    const actions = this.data.actions || []
    const last = actions[actions.length - 1]
    if (!last || last.action !== 'Call' || last.street !== this.data.street) return false
    const players = Object.assign({}, this.data.players)
    const caller = players[last.pos] || {}
    if (caller.allIn || number(caller.paid) !== number(this.data.lastRaise)) return false
    const participants = Object.keys(players).filter(slot => {
      const player = players[slot] || {}
      return !player.allIn && number(player.paid) === number(this.data.lastRaise) && number(player.paid) > 0
    })
    if (participants.length < 2) return false
    let changed = false
    participants.forEach(slot => {
      if (!players[slot].live) {
        players[slot] = Object.assign({}, players[slot], { live: true })
        changed = true
      }
    })
    if (changed) this.setData({ players })
    return true
  },

  afterAction(next) {
    if (this.restoreSettledCallParticipants() && this.streetSettled()) {
      this.advanceStreetAuto()
      return
    }
    if (this.livePlayers().length <= 1) {
      return this.completeHandByWinner(this.livePlayers()[0])
    }
    if (this.isHeadsUpAllInSettled()) {
      this.normalizeHeadsUpAllInTableState()
      this.enterShowdown()
      return
    }
    if (this.streetSettled()) {
      this.advanceStreetAuto()
      return
    }
    this.setData({ activeSlot: next })
  },

  isHeadsUpAllInSettled() {
    const live = this.livePlayers()
    if (live.length !== 2) return false
    if (!live.some(slot => this.data.players[slot].allIn)) return false
    return live.every(slot => this.data.players[slot].paid === this.data.lastRaise || this.data.players[slot].allIn)
  },

  normalizeHeadsUpAllInTableState() {
    const normalized = normalizeHeadsUpAllInState(this.data.players, this.data.pot, this.data.lastRaise)
    if (!normalized.changed) return
    this.setData({
      players: normalized.players,
      pot: normalized.pot,
      lastRaise: normalized.lastRaise
    })
  },

  firstPostflopActor() {
    return this.nextActionAfter(this.slotForPosition('BTN'))
  },

  advanceStreetAuto() {
    const nextStreet = this.data.street === 'Pre'
      ? 'Flop'
      : this.data.street === 'Flop'
        ? 'Turn'
        : this.data.street === 'Turn'
          ? 'River'
          : ''
    if (!nextStreet) {
      this.enterShowdown()
      return
    }
    const chipCollects = this.buildChipCollects(this.data.players)
    const collectPatch = chipCollects.length
      ? {
          chipCollects,
          lastChipCollect: { key: 'collect-' + Date.now(), street: this.data.street, count: chipCollects.length }
        }
      : {}
    this.setData(Object.assign({ street: nextStreet }, collectPatch))
    this.resetStreetContributions()
    if (!this.streetBoardReady(nextStreet)) {
      this.openBoardPicker()
    } else {
      this.triggerDealAnimation(nextStreet)
    }
    if (chipCollects.length) {
      setTimeout(() => {
        this.setData({ chipCollects: [] })
        this.updateAll()
      }, 760)
    }
    this.updateAll()
  },

  streetBoardReady(street) {
    if (street === 'Flop') return cardTokens(this.data.board.flop, 3).length >= 3
    if (street === 'Turn') return cardTokens(this.data.board.turn, 1).length >= 1
    if (street === 'River') return cardTokens(this.data.board.river, 1).length >= 1
    return true
  },

  manualNextStreet() {
    if (this.data.saved) return
    this.pushHistory()
    this.advanceStreetAuto()
  },

  resetStreetContributions() {
    const players = Object.assign({}, this.data.players)
    Object.keys(players).forEach(slot => {
      players[slot] = Object.assign({}, players[slot], { paid: 0, betLand: false })
    })
    const activeSlot = this.firstPostflopActor()
    const actions = this.data.actions.concat({
      street: this.data.street,
      pos: this.data.street,
      position: this.data.street,
      action: 'Start'
    })
    this.setData({ players, activeSlot, lastRaise: 0, actions })
  },

  enterShowdown() {
    const target = this.livePlayers().find(slot => slot !== this.data.heroSlot) || this.data.activeSlot
    this.setData({ showdownMode: true, activeSlot: target })
    this.updateAll()
  },

  completeHandByWinner(winnerSlot) {
    const winner = winnerSlot === this.data.heroSlot ? 'hero' : 'villain'
    const result = this.calculateAutoProfit('', this.data.actions, winner)
    this.setData({
      autoProfit: result.currentProfit,
      profitDigits: String(Math.abs(result.currentProfit)),
      profitSign: result.currentProfit < 0 ? '-' : '+',
      showdownResult: result.winner,
      resultSheetVisible: false
    })
    this.updateAll()
    return this.saveHand()
  },

  commitShowdown(action) {
    const players = this.data.players || {}
    const activePlayer = players[this.data.activeSlot] || {}
    const shownCards = action === 'Show' ? (this.data.villainCards || activePlayer.cards || '') : ''
    const showdownAction = {
      street: this.data.street,
      pos: this.data.activeSlot,
      position: this.displayLabel(this.data.activeSlot),
      action
    }
    if (shownCards) showdownAction.cards = shownCards
    const actionKey = String(action || '').toLowerCase()
    const actions = (this.data.actions || [])
      .filter(item => !(
        item &&
        item.street === showdownAction.street &&
        item.pos === showdownAction.pos &&
        String(item.action || '').toLowerCase() === actionKey
      ))
      .concat(showdownAction)
    const result = this.calculateAutoProfit(action, actions)
    this.setData({
      actions,
      autoProfit: result.currentProfit,
      profitDigits: String(Math.abs(result.currentProfit)),
      profitSign: result.currentProfit < 0 ? '-' : '+',
      showdownResult: result.winner,
      resultSheetVisible: false
    })
    this.updateAll()
    return this.saveHand()
  },

  openHeroPicker() {
    this.openCardPicker('hero')
  },

  openVillainPicker() {
    this.openCardPicker('villain')
  },

  openSeatCardsPicker(slot) {
    this.setData({ cardPickerSeatSlot: slot })
    this.openCardPicker('seat')
  },

  openBoardPicker() {
    if (this.data.phase === 'setup' || this.data.phase === 'moveButton') return
    this.openCardPicker('board')
  },

  closeCardPicker() {
    this.setData({ cardPickerVisible: false })
  },

  showSavingFeedback() {
    if (wx.showLoading) wx.showLoading({ title: '保存中', mask: true })
  },

  openCardPicker(target) {
    let tokens = []
    let title = ''
    if (target === 'hero') {
      tokens = cardTokens(this.data.heroCardsInput, 2)
      title = '\u6211\u4eec\u7684\u624b\u724c'
    } else if (target === 'villain') {
      tokens = cardTokens(this.data.villainCards || '', 2)
      title = this.displayLabel(this.data.activeSlot) + ' 鎵嬬墝'
    } else if (target === 'seat') {
      const slot = this.data.cardPickerSeatSlot
      const player = this.data.players[slot] || {}
      tokens = cardTokens(player.cards || '', 2)
      title = this.displayLabel(slot) + ' 鎵嬬墝'
    } else {
      tokens = cardTokens(this.data.board.flop, 3)
        .concat(cardTokens(this.data.board.turn, 1))
        .concat(cardTokens(this.data.board.river, 1))
      title = this.data.street === 'Flop' ? '\u516c\u5171\u724c · \u53ef\u9009 3 \u5f20\u6216 5 \u5f20' : '\u516c\u5171\u724c'
    }
    this.setData({
      cardPickerVisible: true,
      cardPickerTarget: target,
      cardPickerTitle: title,
      pickedTokens: tokens
    })
    this.refreshCardPicker()
  },

  pickerLimit() {
    if (this.data.cardPickerTarget === 'board') return 5
    return 2
  },

  occupiedTokens() {
    const occupied = []
    if (this.data.cardPickerTarget !== 'hero') occupied.push.apply(occupied, cardTokens(this.data.heroCardsInput, 2))
    Object.keys(this.data.players || {}).forEach(slot => {
      if (this.data.cardPickerTarget === 'seat' && slot === this.data.cardPickerSeatSlot) return
      occupied.push.apply(occupied, cardTokens(this.data.players[slot].cards || '', 2))
    })
    if (this.data.cardPickerTarget !== 'villain') occupied.push.apply(occupied, cardTokens(this.data.villainCards || '', 2))
    const boardTokens = cardTokens(this.data.board.flop, 3).concat(cardTokens(this.data.board.turn, 1)).concat(cardTokens(this.data.board.river, 1))
    if (this.data.cardPickerTarget !== 'board') occupied.push.apply(occupied, boardTokens)
    return occupied
  },

  refreshCardPicker() {
    const selected = this.data.pickedTokens || []
    const occupied = this.occupiedTokens()
    const rows = SUITS.map(suit => ({
      suit: suit.key,
      suitClass: suit.suitClass,
      suitSymbol: suit.symbol,
      cards: RANKS.map(rank => {
        const token = rank + suit.key
        return {
          token,
          rank,
          selected: selected.indexOf(token) > -1,
          disabled: occupied.indexOf(token) > -1
        }
      })
    }))
    this.setData({
      cardDeck: rows,
      pickedPreview: this.buildPickedPreview(selected)
    })
  },

  buildPickedPreview(tokens) {
    const limit = this.pickerLimit()
    const padded = []
    for (let index = 0; index < limit; index += 1) {
      const token = tokens[index]
      const parsed = token ? parseCards(token, 1)[0] : null
      padded.push(Object.assign({ card: !!parsed, gap: this.data.cardPickerTarget === 'board' && (index === 3 || index === 4) }, parsed || {}))
    }
    return padded
  },

  pickCard(e) {
    const token = normalizeCardToken(e.currentTarget.dataset.token)
    const disabled = !!e.currentTarget.dataset.disabled
    if (!token || disabled) return
    let selected = (this.data.pickedTokens || []).slice()
    const index = selected.indexOf(token)
    if (index > -1) selected.splice(index, 1)
    else selected = selected.concat(token).slice(0, this.pickerLimit())
    this.setData({ pickedTokens: selected })
    this.refreshCardPicker()
    const target = this.data.cardPickerTarget
    if (target !== 'board' && selected.length >= 2) this.doneCards()
    if (target === 'board' && selected.length === 5) this.doneCards()
    if (target === 'board' && selected.length === 3 && this.data.street !== 'Flop' && !this.boardPickerRequiresFullBoard()) this.doneCards()
  },

  backspaceCard() {
    this.setData({ pickedTokens: (this.data.pickedTokens || []).slice(0, -1) })
    this.refreshCardPicker()
  },

  clearCards() {
    this.setData({ pickedTokens: [] })
    this.refreshCardPicker()
  },

  doneCards() {
    const tokens = this.data.pickedTokens || []
    const target = this.data.cardPickerTarget
    if (target === 'board' && this.boardPickerRequiresFullBoard() && tokens.length < 5) {
      wx.showToast({ title: '请补全5张公共牌', icon: 'none' })
      return
    }
    if (target === 'hero') {
      this.setData({
        heroCardsInput: tokens.slice(0, 2).join(''),
        phase: this.data.phase === 'heroCards' ? 'play' : this.data.phase,
        cardPickerVisible: false
      })
    } else if (target === 'villain') {
      const villainCards = tokens.slice(0, 2).join('')
      const slot = this.data.cardPickerSeatSlot || this.data.activeSlot
      const players = Object.assign({}, this.data.players)
      if (slot && players[slot]) {
        players[slot] = Object.assign({}, players[slot], { cards: villainCards })
      }
      this.showSavingFeedback()
      this.setData({ villainCards, players, cardPickerVisible: false, cardPickerSeatSlot: '' })
      return this.commitShowdown('Show')
    } else if (target === 'seat') {
      const slot = this.data.cardPickerSeatSlot
      const players = Object.assign({}, this.data.players)
      if (slot && players[slot]) {
        players[slot] = Object.assign({}, players[slot], { cards: tokens.slice(0, 2).join('') })
      }
      this.setData({
        players,
        cardPickerVisible: false,
        cardPickerSeatSlot: ''
      })
    } else {
      const board = {
        flop: tokens.slice(0, 3).join(''),
        turn: tokens[3] || '',
        river: tokens[4] || ''
      }
      const pendingShowdownAction = this.data.pendingShowdownAction || ''
      this.setData({ board, cardPickerVisible: false, pendingShowdownAction: '' })
      this.triggerDealAnimation(this.data.street)
      this.updateAll()
      if (pendingShowdownAction === 'SHOW') {
        this.openVillainPicker()
        return
      }
      if (pendingShowdownAction === 'MUCK') {
        this.pushHistory()
        return this.commitShowdown('Muck')
      }
    }
    this.updateAll()
  },

  actionSliceForTrailIndex(index) {
    const actions = this.timelineSourceActions()
    let visibleIndex = -1
    for (let rawIndex = 0; rawIndex < actions.length; rawIndex += 1) {
      const action = actions[rawIndex]
      if (action.action === 'Post' || action.action === 'Str') continue
      visibleIndex += 1
      if (visibleIndex === index) return actions.slice(0, rawIndex + 1)
    }
    return actions.slice()
  },

  actionEditContextForTrailIndex(index) {
    const actions = this.timelineSourceActions()
    let visibleIndex = -1
    for (let rawIndex = 0; rawIndex < actions.length; rawIndex += 1) {
      const action = actions[rawIndex]
      if (!action || action.action === 'Post' || action.action === 'Str') continue
      visibleIndex += 1
      if (visibleIndex === index) {
        const includeSelected = action.action === 'Start'
        return {
          source: action,
          rawIndex,
          timelineActions: actions.slice(),
          actions: actions.slice(0, includeSelected ? rawIndex + 1 : rawIndex)
        }
      }
    }
    return {
      source: actions[actions.length - 1],
      rawIndex: actions.length - 1,
      timelineActions: actions.slice(),
      actions: actions.slice()
    }
  },

  replayActions(actions) {
    const initial = this.buildInitialLedgerState()
    let players = initial.players
    let pot = number(initial.pot)
    let lastRaise = number(initial.lastRaise)
    let street = 'Pre'
    let activeSlot = initial.activeSlot
    ;(actions || []).forEach(item => {
      if (!item || item.action === 'Post' || item.action === 'Str') return
      if (item.action === 'Start') {
        street = item.street || street
        Object.keys(players).forEach(slot => {
          players[slot] = Object.assign({}, players[slot], { paid: 0, betLand: false })
        })
        lastRaise = 0
        activeSlot = this.nextActionAfterInPlayers(this.slotForPosition('BTN'), players)
        return
      }
      const slot = item.pos
      if (!slot || !players[slot]) return
      const player = Object.assign({}, players[slot])
      let invested = 0
      if (item.action === 'Fold') {
        player.live = false
      } else if (item.action === 'Call') {
        invested = number(item.amount)
        player.paid += invested
        pot += invested
      } else if (item.action === 'Bet' || item.action === 'Raise' || item.action === 'All-in') {
        const amount = number(item.amount)
        invested = Math.max(0, amount - number(player.paid))
        player.paid = amount
        pot += invested
        lastRaise = amount
        if (item.action === 'All-in') player.allIn = true
      }
      player.stack = Math.max(0, number(player.stack) - invested)
      player.betLand = false
      players[slot] = player
      if (headsUpAllInReadyToNormalize(players, lastRaise)) {
        const normalized = normalizeHeadsUpAllInState(players, pot, lastRaise)
        if (normalized.changed) {
          players = normalized.players
          pot = normalized.pot
          lastRaise = normalized.lastRaise
        }
      }
      activeSlot = this.nextActionAfterInPlayers(slot, players)
      street = item.street || street
    })
    return { players, pot, lastRaise, street, activeSlot }
  },

  jumpToAction(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (Number.isNaN(index)) return
    const item = this.data.trail[index]
    if (!item) return
    const context = this.actionEditContextForTrailIndex(index)
    const actions = context.actions
    const source = context.source
    if (!source) return
    const replay = this.replayActions(actions)
    this.pushHistory()
    this.setData({
      phase: 'play',
      actions,
      timelineActions: context.timelineActions || null,
      selectedTrailIndex: index,
      players: replay.players,
      pot: replay.pot,
      lastRaise: replay.lastRaise,
      street: source.street || replay.street,
      activeSlot: source.action === 'Start' ? replay.activeSlot : (source.pos || replay.activeSlot),
      showdownMode: false,
      resultSheetVisible: false,
      amountSheetVisible: false,
      cardPickerVisible: false,
      saved: false
    })
    this.animateSeats()
    this.updateAll({ trailScrollLeft: Math.max(0, index * 156) })
  },

  setProfitSign(e) {
    this.setData({ profitSign: e.currentTarget.dataset.sign === '-' ? '-' : '+' })
  },

  onProfitInput(e) {
    this.setData({ profitDigits: String(e.detail.value || '').replace(/\D/g, '') })
  },

  confirmProfitAndSave() {
    this.saveHand()
  },

  actionContributions(actions) {
    const totals = {}
    const streetPaid = {}
    ;(actions || []).forEach(item => {
      if (!item || !item.pos) return
      const slot = item.pos
      if (item.action === 'Start') {
        Object.keys(streetPaid).forEach(key => { streetPaid[key] = 0 })
        return
      }
      let invested = 0
      if (item.action === 'Post' || item.action === 'Str') {
        invested = number(item.amount)
        streetPaid[slot] = number(streetPaid[slot]) + invested
      } else if (item.action === 'Call') {
        invested = number(item.amount)
        streetPaid[slot] = number(streetPaid[slot]) + invested
      } else if (item.action === 'Bet' || item.action === 'Raise' || item.action === 'All-in') {
        invested = Math.max(0, number(item.amount) - number(streetPaid[slot]))
        streetPaid[slot] = number(item.amount)
      }
      if (invested > 0) totals[slot] = number(totals[slot]) + invested
    })
    return totals
  },

  boardCardsForShowdown() {
    return parseCards(this.data.board.flop, 3)
      .concat(parseCards(this.data.board.turn, 1))
      .concat(parseCards(this.data.board.river, 1))
  },

  showdownWinner(action) {
    if (action === 'Muck') return 'hero'
    const board = this.boardCardsForShowdown()
    const heroCards = parseCards(this.data.heroCardsInput, 2)
    const villainCards = parseCards(this.data.villainCards || '', 2)
    const diff = compareHoldemHands(heroCards, villainCards, board)
    if (diff > 0) return 'hero'
    if (diff < 0) return 'villain'
    return 'tie'
  },

  effectiveAllInCap(contributions) {
    const actions = this.data.actions || []
    if (!actions.some(item => item.action === 'All-in')) return 0
    const heroSlot = this.data.heroSlot
    const players = this.data.players || {}
    const heroInitial = number(players[heroSlot] && players[heroSlot].initialStack)
    const villainCaps = Object.keys(contributions || {})
      .filter(slot => slot !== heroSlot && number(contributions[slot]) > 0 && players[slot] && players[slot].live)
      .map(slot => number(players[slot] && players[slot].initialStack) || number(contributions[slot]))
      .filter(Boolean)
    if (!heroInitial || !villainCaps.length) return 0
    if (villainCaps.length === 1) return Math.min(heroInitial, villainCaps[0])
    return villainCaps.reduce((sum, value) => sum + Math.min(heroInitial, value), 0)
  },

  calculateAutoProfit(showdownAction, actionsInput, winnerOverride) {
    const actions = actionsInput || this.data.actions || []
    const contributions = this.actionContributions(actions)
    const heroSlot = this.data.heroSlot
    const heroContribution = number(contributions[heroSlot])
    const totalPot = Object.keys(contributions).reduce((sum, slot) => sum + number(contributions[slot]), 0)
    const winner = winnerOverride || this.showdownWinner(showdownAction)
    let currentProfit = 0
    if (winner === 'hero') currentProfit = totalPot - heroContribution
    else if (winner === 'villain') currentProfit = -heroContribution
    const cap = this.effectiveAllInCap(contributions)
    if (cap > 0) {
      if (currentProfit > 0) currentProfit = Math.min(currentProfit, cap)
      if (currentProfit < 0) currentProfit = -Math.min(Math.abs(currentProfit), cap)
    }
    return {
      winner,
      currentProfit
    }
  },

  detectPreRiverAllInStreet(actions) {
    const found = (actions || []).find(item => item && item.action === 'All-in')
    if (!found) return ''
    const street = String(found.street || '').toLowerCase()
    if (street === 'river') return ''
    if (street === 'pre') return 'preflop'
    if (street === 'flop' || street === 'turn') return street
    return ''
  },

  boardCompleteForShowdown() {
    return cardTokens(this.data.board && this.data.board.flop, 3).length >= 3 &&
      cardTokens(this.data.board && this.data.board.turn, 1).length >= 1 &&
      cardTokens(this.data.board && this.data.board.river, 1).length >= 1
  },

  boardPickerRequiresFullBoard() {
    return !!this.detectPreRiverAllInStreet(this.data.actions)
  },

  ensureShowdownBoardReady(action) {
    if (!this.detectPreRiverAllInStreet(this.data.actions) || this.boardCompleteForShowdown()) return true
    wx.showToast({ title: '请先录入完整公共牌', icon: 'none' })
    this.setData({ pendingShowdownAction: action || '' })
    this.openBoardPicker()
    return false
  },

  primaryVillainSlot(contributions) {
    const heroSlot = this.data.heroSlot
    const allInAction = (this.data.actions || []).slice().reverse()
      .find(item => item && item.action === 'All-in' && item.pos && item.pos !== heroSlot)
    if (allInAction && number(contributions && contributions[allInAction.pos]) > 0) return allInAction.pos
    const active = this.data.activeSlot
    if (active && active !== heroSlot && number(contributions && contributions[active]) > 0) return active
    const players = this.data.players || {}
    const candidates = Object.keys(contributions || {})
      .filter(slot => slot !== heroSlot && number(contributions[slot]) > 0 && players[slot])
      .sort((left, right) => number(contributions[right]) - number(contributions[left]))
    if (candidates.length) return candidates[0]
    return this.livePlayers().find(slot => slot !== heroSlot) || ''
  },

  cappedAllInAccounting(contributions, villainSlot) {
    const heroSlot = this.data.heroSlot
    const players = this.data.players || {}
    const source = contributions || {}
    const rawPot = Object.keys(source).reduce((sum, slot) => sum + number(source[slot]), 0)
    const heroRaw = number(source[heroSlot])
    if (!villainSlot || villainSlot === heroSlot || !players[villainSlot]) {
      return {
        allInPot: rawPot,
        heroInvested: heroRaw,
        effectiveStack: this.effectiveStackForSave(source, villainSlot),
        capped: false
      }
    }

    const hero = players[heroSlot] || {}
    const villain = players[villainSlot] || {}
    const villainRaw = number(source[villainSlot])
    const heroInitial = number(hero.initialStack || hero.stack || heroRaw || this.data.defaultStack)
    const villainInitial = number(villain.initialStack || villain.stack || villainRaw)
    const effectiveStack = Math.min(
      heroInitial || villainInitial || heroRaw || villainRaw,
      villainInitial || heroInitial || villainRaw || heroRaw
    )
    if (!effectiveStack) {
      return {
        allInPot: rawPot,
        heroInvested: heroRaw,
        effectiveStack: 0,
        capped: false
      }
    }

    const heroInvested = Math.min(heroRaw, effectiveStack)
    const villainInvested = Math.min(villainRaw || effectiveStack, effectiveStack)
    const deadMoney = Object.keys(source)
      .filter(slot => slot !== heroSlot && slot !== villainSlot)
      .reduce((sum, slot) => sum + number(source[slot]), 0)
    return {
      allInPot: heroInvested + villainInvested + deadMoney,
      heroInvested,
      effectiveStack,
      capped: true,
      rawAllInPot: rawPot,
      rawHeroInvested: heroRaw
    }
  },

  buildAllInEvFields(allInStreet, contributions, result, villainSlot) {
    if (!allInStreet) {
      return {
        isAllIn: false,
        allInStreet: '',
        allInEvEligible: false,
        allInEvStatus: 'not_all_in'
      }
    }
    const heroSlot = this.data.heroSlot
    const heroCards = parseCards(this.data.heroCardsInput, 2)
    const players = this.data.players || {}
    const villain = players[villainSlot] || {}
    const villainCards = parseCards(this.data.villainCards || villain.cards || '', 2)
    const allInBoard = boardCardsAtAllIn(this.data.board, allInStreet)
    const allInAccounting = this.cappedAllInAccounting(contributions, villainSlot)
    const allInPot = allInAccounting.allInPot
    const heroInvested = allInAccounting.heroInvested
    const heroEquityPct = estimateHeroEquityPct(heroCards, villainCards, allInBoard)
    if (heroEquityPct == null) {
      return {
        isAllIn: true,
        allInStreet,
        allInEvEligible: false,
        allInEvStatus: 'missing_equity',
        allInEvSource: '',
        allInPot,
        heroInvested,
        effectiveAllInPot: allInPot,
        effectiveAllInStack: allInAccounting.effectiveStack || '',
        rawAllInPot: allInAccounting.rawAllInPot || allInPot,
        rawHeroInvested: allInAccounting.rawHeroInvested || heroInvested,
        heroEquityPct: '',
        allInBoard: cardLabelText((allInBoard || []).map(card => card.rank + card.suit).join(''), allInBoard.length)
      }
    }
    const ev = allInEv.calculateAllInEv({
      isAllIn: true,
      allInStreet,
      heroEquityPct,
      potSize: allInPot,
      heroInvested,
      currentProfit: result
    })
    return {
      isAllIn: true,
      allInStreet,
      allInEvEligible: ev.status === 'calculated',
      allInEvStatus: ev.status,
      allInEvSource: allInStreet === 'preflop' ? 'ledger_sampled' : 'ledger_exact',
      allInPot,
      heroInvested,
      effectiveAllInPot: allInPot,
      effectiveAllInStack: allInAccounting.effectiveStack || '',
      rawAllInPot: allInAccounting.rawAllInPot || allInPot,
      rawHeroInvested: allInAccounting.rawHeroInvested || heroInvested,
      heroEquityPct,
      allInEv: ev.adjustedProfit,
      allInEvProfit: ev.adjustedProfit,
      allInEvAdjustedProfit: ev.adjustedProfit,
      allInEvLuckDelta: ev.luckDelta,
      allInBoard: cardLabelText((allInBoard || []).map(card => card.rank + card.suit).join(''), allInBoard.length)
    }
  },

  buildSavePayload() {
    const level = this.data.levelText
    const board = this.data.board
    const contributions = this.actionContributions(this.data.actions)
    const allInStreet = this.detectPreRiverAllInStreet(this.data.actions)
    const result = this.data.profitDigits
      ? number(this.data.profitDigits) * (this.data.profitSign === '-' ? -1 : 1)
      : number(this.data.autoProfit)
    const villainSlot = this.primaryVillainSlot(contributions)
    const villainPosition = villainSlot ? this.displayLabel(villainSlot) : ''
    const villainPlayer = villainSlot && this.data.players ? (this.data.players[villainSlot] || {}) : {}
    const linkedPlayerNoteIds = this.getLinkedPlayerNoteIds()
    const allInFields = this.buildAllInEvFields(allInStreet, contributions, result, villainSlot)
    const displayPotSize = allInStreet && allInFields.allInPot ? allInFields.allInPot : this.data.pot
    const heroPosition = this.data.heroPosition
    const showdownCards = this.data.villainCards || villainPlayer.cards || ''
    const streetInputs = {
      preflop: {
        board: '',
        actionLine: buildStreetLineWithHero(this.data.actions, 'Pre', heroPosition, showdownCards),
        pot: this.streetPot('Pre')
      },
      flop: {
        board: board.flop || '',
        actionLine: buildStreetLineWithHero(this.data.actions, 'Flop', heroPosition, showdownCards),
        pot: this.streetPot('Flop')
      },
      turn: {
        board: board.turn || '',
        actionLine: buildStreetLineWithHero(this.data.actions, 'Turn', heroPosition, showdownCards),
        pot: this.streetPot('Turn')
      },
      river: {
        board: board.river || '',
        actionLine: buildStreetLineWithHero(this.data.actions, 'River', heroPosition, showdownCards),
        pot: this.streetPot('River')
      }
    }
    return {
      sessionId: this.data.sessionId,
      playedDate: this.data.playedDateOverride || this.data.session && (this.data.session.date || String(this.data.session.startTime || '').split(' ')[0]) || nowDateText(),
      recordedAt: this.data.playedDateOverride || undefined,
      createdAtMs: this.data.playedDateOverride
        ? new Date(this.data.playedDateOverride.replace(' ', 'T')).getTime()
        : undefined,
      stakeLevel: level,
      playerCount: this.data.tableMax,
      hasStraddle: !!this.data.hasStraddle,
      heroPosition: this.data.heroPosition,
      villainPosition,
      opponentPosition: villainPosition,
      opponentPlayerNoteId: villainPlayer.playerNoteId || '',
      opponentName: villainPlayer.playerName || '',
      opponentType: villainPlayer.playerType || '',
      opponentNote: villainPlayer.playerNote || '',
      opponentLeakTags: villainPlayer.playerLeakTags || [],
      playerNoteIds: linkedPlayerNoteIds,
      buttonSeat: this.activeSlots().indexOf(this.data.dealerSlot) + 1,
      heroSeat: this.activeSlots().indexOf(this.data.heroSlot) + 1,
      heroCardsInput: this.data.heroCardsInput,
      flop: board.flop || '',
      turn: board.turn || '',
      river: board.river || '',
      board: {
        flop: board.flop || '',
        turn: board.turn || '',
        river: board.river || ''
      },
      effectiveStack: this.effectiveStackForSave(contributions, villainSlot),
      potSize: displayPotSize,
      rawPotSize: this.data.pot,
      currentProfit: result,
      isAllIn: allInFields.isAllIn,
      allInStreet: allInFields.allInStreet,
      terminalStreet: allInFields.allInStreet || '',
      handEndedStreet: allInFields.allInStreet || '',
      postAllInRunoutOnly: !!allInFields.allInStreet,
      analysisFocus: allInFields.allInStreet ? (allInFields.allInStreet + '_all_in') : '',
      allInEvEligible: allInFields.allInEvEligible,
      allInEvStatus: allInFields.allInEvStatus,
      allInEvSource: allInFields.allInEvSource || '',
      allInPot: allInFields.allInPot || 0,
      heroInvested: allInFields.heroInvested || 0,
      effectiveAllInPot: allInFields.effectiveAllInPot || 0,
      effectiveAllInStack: allInFields.effectiveAllInStack || '',
      rawAllInPot: allInFields.rawAllInPot || 0,
      rawHeroInvested: allInFields.rawHeroInvested || 0,
      heroEquityPct: allInFields.heroEquityPct,
      allInEv: allInFields.allInEv,
      allInEvProfit: allInFields.allInEvProfit,
      allInEvAdjustedProfit: allInFields.allInEvAdjustedProfit,
      allInEvLuckDelta: allInFields.allInEvLuckDelta,
      allInBoard: allInFields.allInBoard || '',
      resultBB: this.formatResultBb(result),
      streetSummary: [
        streetInputs.preflop.actionLine && 'Preflop: ' + streetInputs.preflop.actionLine,
        streetInputs.flop.actionLine && 'Flop: ' + streetInputs.flop.actionLine,
        streetInputs.turn.actionLine && 'Turn: ' + streetInputs.turn.actionLine,
        streetInputs.river.actionLine && 'River: ' + streetInputs.river.actionLine
      ].filter(Boolean).join('; '),
      streetInputs,
      opponentCards: this.data.villainCards || '',
      opponentCardsSource: this.data.villainCards ? 'manual' : '',
      showdown: this.data.villainCards || '',
      showdownType: this.data.villainCards ? 'show' : '',
      showdownReason: this.data.showdownResult || '',
      detailBackfilled: true,
      reviewStatus: 'reviewed',
      aiReview: null,
      aiReviewStatus: 'generating',
      aiReviewError: '',
      inputMode: 'ledger_full',
      reviewSource: 'ledger_full',
      ledgerState: this.buildLedgerStateSnapshot(),
      tags: ['\u7cbe\u51c6\u5f55\u5165'],
      playerSnapshots: Object.keys(this.data.players || {}).map(slot => {
        const player = this.data.players[slot] || {}
        return {
          slot,
          position: this.displayLabel(slot),
          playerNoteId: player.playerNoteId || '',
          playerName: player.playerName || '',
          playerType: player.playerType || '',
          playerNote: player.playerNote || '',
          playerLeakTags: player.playerLeakTags || [],
          stack: player.stack || 0,
          initialStack: player.initialStack || player.stack || 0,
          cards: player.cards || ''
        }
      }),
      notes: '',
      mindJourney: '',
      actions: this.data.actions
        .filter(item => item.action !== 'Post' && item.action !== 'Str' && item.action !== 'Start')
        .map((item, index) => ({
          street: item.street,
          actorSeat: this.activeSlots().indexOf(item.pos) + 1 || index + 1,
          actorLabel: actionActorLabel(item, this.data.heroPosition),
          actionType: item.action === 'X' ? 'check' : String(item.action || '').toLowerCase().replace('-', '_'),
          amount: item.amount || 0,
          potAfter: this.data.pot
        }))
    }
  },

  buildLedgerStateSnapshot() {
    return {
      version: 1,
      tableMax: this.data.tableMax,
      levelText: this.data.levelText,
      hasStraddle: !!this.data.hasStraddle,
      dealerSlot: this.data.dealerSlot,
      heroSlot: this.data.heroSlot,
      heroPosition: this.data.heroPosition,
      heroCardsInput: this.data.heroCardsInput,
      villainCards: this.data.villainCards || '',
      showdownResult: this.data.showdownResult || '',
      board: Object.assign({}, this.data.board || {}),
      actions: (this.data.actions || []).map(item => Object.assign({}, item)),
      players: Object.keys(this.data.players || {}).reduce((acc, slot) => {
        acc[slot] = Object.assign({}, this.data.players[slot] || {})
        return acc
      }, {}),
      pot: number(this.data.pot),
      street: this.data.street,
      activeSlot: this.data.activeSlot,
      profitSign: this.data.profitSign,
      profitDigits: this.data.profitDigits,
      autoProfit: number(this.data.autoProfit)
    }
  },

  effectiveStackForSave(contributions, villainSlotInput) {
    const heroSlot = this.data.heroSlot
    const players = this.data.players || {}
    const hero = players[heroSlot] || {}
    const heroInitial = number(hero.initialStack || hero.stack || this.data.defaultStack)
    const villainSlot = villainSlotInput || this.primaryVillainSlot(contributions)
    if (villainSlot && villainSlot !== heroSlot && players[villainSlot]) {
      const villain = players[villainSlot] || {}
      const villainInitial = number(villain.initialStack || villain.stack || contributions[villainSlot])
      return villainInitial ? Math.min(heroInitial || villainInitial, villainInitial) : heroInitial
    }
    const opponentSlots = Object.keys(contributions || {})
      .filter(slot => slot !== heroSlot && number(contributions[slot]) > 0 && players[slot])
    if (opponentSlots.length === 1) {
      const opponent = players[opponentSlots[0]] || {}
      const opponentInitial = number(opponent.initialStack || opponent.stack)
      return opponentInitial ? Math.min(heroInitial || opponentInitial, opponentInitial) : heroInitial
    }
    return heroInitial
  },

  streetPot(street) {
    const actions = this.data.actions || []
    const order = ['Pre', 'Flop', 'Turn', 'River']
    const streetIndex = order.indexOf(street)
    if (streetIndex < 0) return ''
    const nextStreet = order[streetIndex + 1]
    let cutIndex = actions.length
    if (nextStreet) {
      const startIndex = actions.findIndex(item => item && item.action === 'Start' && item.street === nextStreet)
      if (startIndex >= 0) cutIndex = startIndex
    }
    const hasStreetAction = actions.slice(0, cutIndex).some(item => item && item.street === street)
    if (!hasStreetAction && street !== 'Pre') return ''
    return this.replayActions(actions.slice(0, cutIndex)).pot
  },

  formatResultBb(value) {
    const bb = parseLevel(this.data.levelText).bb
    if (!bb) return ''
    const result = Math.round((number(value) / bb) * 10) / 10
    return (result > 0 ? '+' : '') + result + ' BB'
  },

  buildAiAdviceRequest(hand, session, actions) {
    const profile = dataService.getCurrentProfile ? dataService.getCurrentProfile() : {}
    const settings = dataService.getAppSettings ? dataService.getAppSettings() : {}
    const source = hand || {}
    const sessionSource = session || this.data.session || {}
    const handActions = actions || source.actions || []
    const normalizedActions = (handActions || []).map(item => ({
      street: item.street,
      pos: item.pos || '',
      position: item.position || item.actorLabel || item.pos || '',
      action: item.action || item.actionType || '',
      amount: item.amount || 0,
      potAfter: item.potAfter || 0
    }))
    const structuredHand = {
      _id: source._id || this.data.handId || '',
      playerCount: Number(source.playerCount || this.data.tableMax) || 0,
      playedDate: source.playedDate || '',
      stakeLevel: source.stakeLevel || this.data.levelText || '',
      hasStraddle: !!source.hasStraddle,
      straddleAmount: source.hasStraddle ? parseLevel(source.stakeLevel || this.data.levelText).straddle : 0,
      heroPosition: source.heroPosition || '',
      heroCardsInput: source.heroCardsInput || '',
      effectiveStack: Number(source.effectiveStack) || 0,
      potSize: Number(source.potSize) || 0,
      rawPotSize: Number(source.rawPotSize) || 0,
      currentProfit: Number(source.currentProfit) || 0,
      isAllIn: !!source.isAllIn,
      allInStreet: source.allInStreet || '',
      terminalStreet: source.terminalStreet || source.handEndedStreet || source.allInStreet || '',
      handEndedStreet: source.handEndedStreet || source.terminalStreet || source.allInStreet || '',
      postAllInRunoutOnly: !!source.postAllInRunoutOnly,
      analysisFocus: source.analysisFocus || '',
      allInEvEligible: !!source.allInEvEligible,
      allInEvStatus: source.allInEvStatus || '',
      allInEvSource: source.allInEvSource || '',
      allInPot: Number(source.allInPot) || 0,
      heroInvested: Number(source.heroInvested) || 0,
      effectiveAllInPot: Number(source.effectiveAllInPot) || 0,
      effectiveAllInStack: Number(source.effectiveAllInStack) || 0,
      rawAllInPot: Number(source.rawAllInPot) || 0,
      rawHeroInvested: Number(source.rawHeroInvested) || 0,
      heroEquityPct: source.heroEquityPct === '' || source.heroEquityPct === undefined ? '' : Number(source.heroEquityPct),
      allInEv: source.allInEv === undefined ? '' : Number(source.allInEv),
      allInEvProfit: source.allInEvProfit === undefined ? '' : Number(source.allInEvProfit),
      allInEvAdjustedProfit: source.allInEvAdjustedProfit === undefined ? '' : Number(source.allInEvAdjustedProfit),
      allInEvLuckDelta: source.allInEvLuckDelta === undefined ? '' : Number(source.allInEvLuckDelta),
      opponentType: source.opponentType || '',
      opponentName: source.opponentName || '',
      villainPosition: source.villainPosition || '',
      villainType: source.villainType || source.opponentType || '',
      board: source.board || {
        flop: source.flop || '',
        turn: source.turn || '',
        river: source.river || ''
      },
      actions: normalizedActions,
      actionSummary: buildStructuredActionSummary(normalizedActions, source.heroPosition || ''),
      streetInputs: source.streetInputs || {},
      streetSummary: source.streetSummary || '',
      notes: source.notes || '',
      heroQuestion: source.heroQuestion || '',
      showdown: source.showdown || source.opponentCards || '',
      voiceNote: source.voiceNote || ''
    }
    return {
      mode: 'advice',
      question: buildLedgerAdviceQuestion(structuredHand),
      transcript: buildLedgerAdviceQuestion(structuredHand),
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
          hasStraddle: !!sessionSource.hasStraddle,
          straddleAmount: sessionSource.hasStraddle ? parseLevel(source.stakeLevel || this.data.levelText).straddle : 0
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

  async generateLedgerAiAdvice(handId, payload) {
    if (!handId) return
    try {
      const savedHand = Object.assign({}, payload || {}, { _id: handId })
      const result = await aiService.reviewHandVoice(this.buildAiAdviceRequest(savedHand, this.data.session, payload && payload.actions))
      if (result.code && result.code !== 0) {
        const error = new Error(result.message || 'EV brain advice failed')
        error.code = result.code
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
          aiReviewError: error && (
            error.aiReviewError ||
            error.debugError ||
            error.raw && (error.raw.aiReviewError || error.raw.debugError) ||
            error.message ||
            error.errMsg
          ) || 'EV脑出问题啦，请稍后再重新生成AI建议。'
        })
      } catch (saveError) {
        console.warn('ledger AI advice failure status save failed: ' + (saveError && (saveError.errMsg || saveError.message) || String(saveError)))
      }
    }
  },

  getLinkedPlayerNoteIds() {
    const seen = {}
    return Object.keys(this.data.players || {})
      .map(slot => String(this.data.players[slot] && this.data.players[slot].playerNoteId || '').trim())
      .filter(id => {
        if (!id || seen[id]) return false
        seen[id] = true
        return true
      })
  },

  async syncPlayerNoteBattleHands(handId) {
    const targetHandId = String(handId || '').trim()
    if (!targetHandId) return
    const noteIds = this.getLinkedPlayerNoteIds()
    for (let i = 0; i < noteIds.length; i += 1) {
      try {
        await dataService.addPlayerNoteBattleHand(noteIds[i], targetHandId)
      } catch (error) {
        console.warn('sync player note battle hand failed: ' + (error && (error.message || error.errMsg) || String(error)))
      }
    }
  },

  async saveHand() {
    if (this.data.saving || this.data.saved) return
    if (!this.data.sessionId) {
      wx.showToast({ title: '\u7f3a\u5c11 Session', icon: 'none' })
      return
    }
    if (!parseCards(this.data.heroCardsInput, 2).length || parseCards(this.data.heroCardsInput, 2).length < 2) {
      wx.showToast({ title: '\u8bf7\u5148\u9009\u62e9\u6211\u4eec\u7684\u624b\u724c', icon: 'none' })
      this.openHeroPicker()
      return
    }
    const payload = this.buildSavePayload()
    this.setData({ saving: true })
    this.showSavingFeedback()
    try {
      let savedHandId = this.data.handId
      if (this.data.handId) {
        await dataService.updateHandWithCloudSync(this.data.handId, payload, 'sync ledger hand failed')
      } else {
        const hand = await dataService.createHand(payload)
        savedHandId = hand && hand._id || ''
        this.setData({ handId: savedHandId })
      }
      await this.syncPlayerNoteBattleHands(savedHandId)
      this.generateLedgerAiAdvice(savedHandId, payload)
      this.setData({ saving: false, saved: true, resultSheetVisible: false })
      if (wx.hideLoading) wx.hideLoading()
      wx.showToast({ title: '\u624b\u724c\u5df2\u4fdd\u5b58', icon: 'success' })
      setTimeout(() => {
        if (this.data.returnTo === 'session-edit') {
          wx.redirectTo({
            url: '/pages/session-detail/session-detail?id=' + this.data.sessionId + '&edit=1'
          })
          return
        }
        wx.navigateBack({
          delta: 1,
          fail() {
            wx.switchTab({ url: '/pages/review-list/review-list' })
          }
        })
      }, 450)
    } catch (error) {
      this.setData({ saving: false })
      if (wx.hideLoading) wx.hideLoading()
      wx.showToast({ title: '淇濆瓨澶辫触锛岃閲嶈瘯', icon: 'none' })
    }
  },

  goBack() {
    wx.navigateBack({
      delta: 1,
      fail() {
        wx.switchTab({ url: '/pages/session-list/session-list' })
      }
    })
  },

  noop() {}
})
