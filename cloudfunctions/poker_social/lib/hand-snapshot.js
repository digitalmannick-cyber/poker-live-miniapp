const { socialError } = require('./social-error')

const ACTIVE_SLOTS = Object.freeze({
  6: Object.freeze(['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO']),
  8: Object.freeze(['BTN', 'SB', 'BB', 'UTG', 'UTG1', 'MP', 'HJ', 'CO']),
  9: Object.freeze(['BTN', 'SB', 'BB', 'UTG', 'UTG1', 'MP', 'LJ', 'HJ', 'CO'])
})
const ALIASES = Object.freeze(['夜鸦', '赤狐', '黑猫', '银狼', '幻蝶', '灰隼', '绿蛇', '白鲸'])
const POSITIONS = new Set(['BTN', 'SB', 'BB', 'UTG', 'UTG1', 'MP', 'LJ', 'HJ', 'CO'])
const STREETS = Object.freeze({
  pre: 'preflop',
  preflop: 'preflop',
  flop: 'flop',
  turn: 'turn',
  river: 'river',
  showdown: 'showdown'
})
const ACTION_TYPES = new Set(['fold', 'check', 'call', 'bet', 'raise', 'all_in', 'show', 'muck'])
const LEGACY_CARD_SOURCES = new Set(['manual', 'verified'])
const CARD_PATTERN = /^(?:[2-9TJQKA][shdc])*$/

function invalidSnapshot() {
  return socialError('INVALID_HAND_SNAPSHOT', 'invalid hand snapshot')
}

function blindRequired() {
  return socialError('BLIND_REQUIRED', 'big blind required')
}

function hasOwn(value, key) {
  return !!value && Object.prototype.hasOwnProperty.call(value, key)
}

function isFiniteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function resolveBigBlind(hand, session) {
  const handSource = hand || {}
  const sessionSource = session || {}
  for (const candidate of [
    [sessionSource, 'bigBlind'],
    [handSource, 'bigBlind']
  ]) {
    if (!hasOwn(candidate[0], candidate[1]) || candidate[0][candidate[1]] === '' || candidate[0][candidate[1]] == null) continue
    const value = candidate[0][candidate[1]]
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw blindRequired()
    return value
  }

  const level = handSource.stakeLevel
  if (typeof level !== 'string') throw blindRequired()
  const match = level.match(/^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/)
  if (!match) throw blindRequired()
  const smallBlind = Number(match[1])
  const bigBlind = Number(match[2])
  if (!Number.isFinite(smallBlind) || smallBlind <= 0 || !Number.isFinite(bigBlind) || bigBlind <= 0) throw blindRequired()
  return bigBlind
}

function toBb(value, bigBlind) {
  if (typeof bigBlind !== 'number' || !Number.isFinite(bigBlind) || bigBlind <= 0) throw blindRequired()
  if (!isFiniteNonNegative(value)) throw invalidSnapshot()
  const quotient = value / bigBlind
  if (!Number.isFinite(quotient)) throw invalidSnapshot()
  const rounded = Math.round((quotient + Number.EPSILON) * 100) / 100
  if (!Number.isFinite(rounded)) throw invalidSnapshot()
  return Object.is(rounded, -0) ? 0 : rounded
}

function assignAliases(seats) {
  if (!Array.isArray(seats) || seats.length > ALIASES.length) throw invalidSnapshot()
  const sorted = seats.slice().sort((a, b) => a - b)
  const seen = new Set()
  const result = {}
  sorted.forEach((seat, index) => {
    if (!Number.isInteger(seat) || seat <= 0 || seen.has(seat)) throw invalidSnapshot()
    seen.add(seat)
    result[seat] = ALIASES[index]
  })
  return result
}

function normalizePosition(value) {
  const normalized = String(value || '').trim().toUpperCase().replace(/^UTG\+1$/, 'UTG1')
  if (!POSITIONS.has(normalized)) throw invalidSnapshot()
  return normalized
}

function normalizeSlot(value) {
  const text = String(value || '').trim()
  return text === 'UTG+1' ? 'UTG1' : text
}

function normalizePlayerCount(value, allowPersistedString) {
  if (Number.isInteger(value) && value >= 2 && value <= 9) return value
  if (allowPersistedString && typeof value === 'string' && /^[2-9]$/.test(value)) return Number(value)
  throw invalidSnapshot()
}

function normalizeStreet(value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : ''
  const street = STREETS[text]
  if (!street) throw invalidSnapshot()
  return street
}

function parseActorLabel(value) {
  const text = String(value || '').trim()
  const heroMatch = text.match(/^Hero(?:\s+(.+))?$/)
  if (heroMatch) return { hero: true, position: heroMatch[1] ? normalizePosition(heroMatch[1]) : null }
  return { hero: false, position: normalizePosition(text) }
}

function parseCards(value, expectedCounts) {
  const text = value == null ? '' : value
  if (typeof text !== 'string' || !CARD_PATTERN.test(text) || text.length % 2 !== 0) throw invalidSnapshot()
  const cards = text ? text.match(/.{2}/g) : []
  if (expectedCounts && expectedCounts.indexOf(cards.length) === -1) throw invalidSnapshot()
  return cards
}

function assertUniqueCards(groups) {
  const seen = new Set()
  groups.forEach(cards => cards.forEach(card => {
    if (seen.has(card)) throw invalidSnapshot()
    seen.add(card)
  }))
}

function buildBoard(value) {
  if (value != null && (typeof value !== 'object' || Array.isArray(value))) throw invalidSnapshot()
  const source = value || {}
  const flop = parseCards(source.flop, [0, 3])
  const turn = parseCards(source.turn, [0, 1])
  const river = parseCards(source.river, [0, 1])
  if (turn.length && flop.length !== 3) throw invalidSnapshot()
  if (river.length && turn.length !== 1) throw invalidSnapshot()
  return { flop, turn, river }
}

function readOptionalBb(source, key, bigBlind) {
  if (!hasOwn(source, key) || source[key] === '' || source[key] == null) return undefined
  return toBb(source[key], bigBlind)
}

function readSnapshotStack(snapshot, bigBlind) {
  for (const key of ['initialStack', 'stack']) {
    if (!hasOwn(snapshot, key) || snapshot[key] === '' || snapshot[key] == null) continue
    return toBb(snapshot[key], bigBlind)
  }
  return undefined
}

function validateFullSeats(hand, bigBlind, playerCount, heroSeat, heroPosition) {
  const activeSlots = ACTIVE_SLOTS[playerCount]
  if (!activeSlots || !Array.isArray(hand.playerSnapshots) || hand.playerSnapshots.length !== activeSlots.length) throw invalidSnapshot()
  const bySeat = new Map()
  const positions = new Set()
  hand.playerSnapshots.forEach(snapshot => {
    if (!snapshot || typeof snapshot !== 'object') throw invalidSnapshot()
    const seat = activeSlots.indexOf(normalizeSlot(snapshot.slot)) + 1
    if (!seat || bySeat.has(seat)) throw invalidSnapshot()
    const position = normalizePosition(snapshot.position)
    if (activeSlots.indexOf(position) === -1 || positions.has(position)) throw invalidSnapshot()
    positions.add(position)
    const stackBb = readSnapshotStack(snapshot, bigBlind)
    bySeat.set(seat, { snapshot, position, stackBb })
  })
  if (positions.size !== activeSlots.length || !bySeat.has(heroSeat) || bySeat.get(heroSeat).position !== heroPosition) throw invalidSnapshot()
  return bySeat
}

function validateActions(actions, options) {
  if (!Array.isArray(actions) || actions.length === 0) {
    throw socialError('HAND_ACTIONS_REQUIRED', 'hand actions required')
  }
  const sequenceSeen = new Set()
  const legacySeats = new Map([[options.heroSeat, options.heroPosition]])
  const normalized = actions.map(action => {
    if (!action || typeof action !== 'object') throw invalidSnapshot()
    const sequence = action.sequence
    if (!Number.isInteger(sequence) || sequence <= 0 || sequenceSeen.has(sequence)) throw invalidSnapshot()
    sequenceSeen.add(sequence)
    const street = normalizeStreet(action.street)
    const type = String(action.actionType || '').trim()
    const seat = action.actorSeat
    if (!street || !ACTION_TYPES.has(type) || !Number.isInteger(seat) || seat < 1 || seat > options.playerCount) throw invalidSnapshot()
    const actorLabel = parseActorLabel(action.actorLabel)
    const isHero = seat === options.heroSeat
    if (actorLabel.hero !== isHero) throw invalidSnapshot()
    let actorPosition = actorLabel.position
    if (!options.fullSeats && actorLabel.hero && actorPosition === null) actorPosition = options.heroPosition
    if (!actorPosition) throw invalidSnapshot()

    if (options.fullSeats) {
      const player = options.fullSeats.get(seat)
      if (!player || player.position !== actorPosition) throw invalidSnapshot()
    } else {
      if (isHero && actorPosition !== options.heroPosition) throw invalidSnapshot()
      if (legacySeats.has(seat) && legacySeats.get(seat) !== actorPosition) throw invalidSnapshot()
      for (const [otherSeat, position] of legacySeats.entries()) {
        if (otherSeat !== seat && position === actorPosition) throw invalidSnapshot()
      }
      legacySeats.set(seat, actorPosition)
    }

    const item = { sequence, seat, street, type }
    if (hasOwn(action, 'amount') && action.amount !== '' && action.amount != null) item.amountBb = toBb(action.amount, options.bigBlind)
    return item
  }).sort((a, b) => a.sequence - b.sequence)
  return { normalized, legacySeats }
}

function buildHandSnapshot(input) {
  const source = input || {}
  const hand = source.hand || {}
  const actions = source.actions
  const session = source.session || {}
  const bigBlind = resolveBigBlind(hand, session)
  if (hasOwn(hand, 'playerSnapshots') && hand.playerSnapshots != null && !Array.isArray(hand.playerSnapshots)) throw invalidSnapshot()
  const isFullLedger = Array.isArray(hand.playerSnapshots) && hand.playerSnapshots.length > 0
  const playerCount = normalizePlayerCount(hand.playerCount, !isFullLedger)
  const heroSeat = hand.heroSeat
  if (!Number.isInteger(heroSeat) || heroSeat < 1 || heroSeat > playerCount) throw invalidSnapshot()
  const heroPosition = normalizePosition(hand.heroPosition)
  const heroCards = parseCards(hand.heroCardsInput, [2])
  const board = buildBoard(hand.board)
  const fullSeats = isFullLedger ? validateFullSeats(hand, bigBlind, playerCount, heroSeat, heroPosition) : null
  const actionResult = validateActions(actions, { bigBlind, playerCount, heroSeat, heroPosition, fullSeats })
  const nonHeroSeats = fullSeats
    ? Array.from(fullSeats.keys()).filter(seat => seat !== heroSeat).sort((a, b) => a - b)
    : Array.from(actionResult.legacySeats.keys()).filter(seat => seat !== heroSeat).sort((a, b) => a - b)
  const aliases = assignAliases(nonHeroSeats)

  const hero = { label: 'Hero', seat: heroSeat, position: heroPosition, cards: heroCards }
  if (fullSeats && fullSeats.get(heroSeat).stackBb !== undefined) hero.stackBb = fullSeats.get(heroSeat).stackBb
  const players = nonHeroSeats.map(seat => {
    const position = fullSeats ? fullSeats.get(seat).position : actionResult.legacySeats.get(seat)
    const player = { seat, position, label: aliases[seat] }
    if (fullSeats && fullSeats.get(seat).stackBb !== undefined) player.stackBb = fullSeats.get(seat).stackBb
    return player
  })
  const publicActions = actionResult.normalized.map(action => {
    const item = {
      street: action.street,
      actor: action.seat === heroSeat ? 'Hero' : aliases[action.seat],
      type: action.type
    }
    if (action.amountBb !== undefined) item.amountBb = action.amountBb
    return item
  })

  const showSeats = []
  actionResult.normalized.forEach(action => {
    if (action.type === 'show' && showSeats.indexOf(action.seat) === -1) showSeats.push(action.seat)
  })
  const nonHeroShowSeats = showSeats.filter(seat => seat !== heroSeat)
  if (!fullSeats && nonHeroShowSeats.length > 1) throw invalidSnapshot()
  if (!fullSeats && nonHeroShowSeats.length === 1) {
    const showPosition = actionResult.legacySeats.get(nonHeroShowSeats[0])
    if (showPosition !== normalizePosition(hand.villainPosition) || !LEGACY_CARD_SOURCES.has(hand.opponentCardsSource)) throw invalidSnapshot()
  }
  const showdown = showSeats.map(seat => {
    if (seat === heroSeat) return { actor: 'Hero', cards: heroCards.slice() }
    const cards = fullSeats
      ? parseCards(fullSeats.get(seat).snapshot.cards, [2])
      : parseCards(hand.opponentCards, [2])
    return { actor: aliases[seat], cards }
  })

  assertUniqueCards([heroCards, board.flop, board.turn, board.river].concat(showdown.filter(item => item.actor !== 'Hero').map(item => item.cards)))

  const snapshot = { version: 1, hero, players, board, actions: publicActions }
  for (const pair of [
    ['effectiveStack', 'effectiveStackBb'],
    ['potSize', 'potBb'],
    ['allInPot', 'allInPotBb']
  ]) {
    const value = readOptionalBb(hand, pair[0], bigBlind)
    if (value !== undefined) snapshot[pair[1]] = value
  }
  snapshot.showdown = showdown
  return snapshot
}

module.exports = {
  ACTIVE_SLOTS,
  buildHandSnapshot,
  resolveBigBlind,
  toBb,
  assignAliases
}
