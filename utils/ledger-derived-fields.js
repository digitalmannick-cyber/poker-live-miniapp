const cardUi = require('./card-ui')
const allInEv = require('./all-in-ev')

const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']
const SUITS = ['s', 'h', 'd', 'c']

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeStreet(value) {
  const text = String(value || '').trim().toLowerCase()
  if (!text) return ''
  if (text === 'pre' || text === 'pf' || text === 'preflop' || text === 'pre-flop') return 'preflop'
  if (text === 'flop' || text === 'turn' || text === 'river') return text
  return text
}

function parseCards(value, limit) {
  return cardUi.parseCardsInput(value || '', limit)
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
      const token = rank + suit
      if (!excluded.has(token)) deck.push({ rank, suit })
    })
  })
  return deck
}

function seededRandom(seed) {
  let value = seed >>> 0
  return function nextRandom() {
    value ^= value << 13
    value ^= value >>> 17
    value ^= value << 5
    return ((value >>> 0) / 4294967296)
  }
}

function sampleSeed(cards) {
  const text = (cards || []).map(uniqueCardKey).join('|')
  let seed = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    seed ^= text.charCodeAt(index)
    seed = Math.imul(seed, 16777619)
  }
  return seed >>> 0
}

function sampleRunout(deck, choose, random) {
  const pool = deck.slice()
  const picked = []
  for (let index = 0; index < choose; index += 1) {
    const selected = index + Math.floor(random() * (pool.length - index))
    const card = pool[selected]
    pool[selected] = pool[index]
    pool[index] = card
    picked.push(card)
  }
  return picked
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
  const maxSamples = 2500
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
    const random = seededRandom(sampleSeed(hero.concat(villain, board)))
    for (let index = 0; index < maxSamples; index += 1) {
      score(sampleRunout(deck, need, random))
    }
  }
  if (!total) return null
  return Math.round(((heroWins + ties * 0.5) / total) * 10000) / 100
}

function actionContributions(actions) {
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
}

function detectAllInStreet(actions) {
  const found = (actions || []).find(item => item && item.action === 'All-in')
  if (!found) return ''
  const street = normalizeStreet(found.street)
  return street && street !== 'river' ? street : ''
}

function primaryVillainSlot(actions, contributions, heroSlot, players) {
  const allInAction = (actions || []).slice().reverse()
    .find(item => item && item.action === 'All-in' && item.pos && item.pos !== heroSlot)
  if (allInAction && number(contributions[allInAction.pos]) > 0) return allInAction.pos
  const showdown = (actions || []).slice().reverse()
    .find(item => item && (item.action === 'Show' || item.action === 'Muck') && item.pos && item.pos !== heroSlot)
  if (showdown && number(contributions[showdown.pos]) > 0) return showdown.pos
  const candidates = Object.keys(contributions || {})
    .filter(slot => slot !== heroSlot && number(contributions[slot]) > 0 && (!players || players[slot]))
    .sort((left, right) => number(contributions[right]) - number(contributions[left]))
  return candidates[0] || ''
}

function boardCardsAtAllIn(board, street) {
  const source = board || {}
  const normalized = normalizeStreet(street)
  const flop = parseCards(source.flop, 3)
  if (normalized === 'flop') return flop
  const turn = parseCards(source.turn, 1)
  if (normalized === 'turn') return flop.concat(turn)
  if (normalized === 'river') return flop.concat(turn).concat(parseCards(source.river, 1))
  return []
}

function cappedAllInAccounting(hand, ledgerState, allInStreet) {
  const state = ledgerState || {}
  const actions = state.actions || []
  const players = state.players || {}
  const heroSlot = state.heroSlot || hand.heroPosition || ''
  const contributions = actionContributions(actions)
  const villainSlot = primaryVillainSlot(actions, contributions, heroSlot, players)
  const rawPot = Object.keys(contributions).reduce((sum, slot) => sum + number(contributions[slot]), 0)
  const heroRaw = number(contributions[heroSlot])
  const villainRaw = number(contributions[villainSlot])
  const hero = players[heroSlot] || {}
  const villain = players[villainSlot] || {}
  const heroInitial = number(hero.initialStack || heroRaw || hand.effectiveStack)
  const villainInitial = number(villain.initialStack || villainRaw || hand.effectiveStack)
  const effectiveStack = Math.min(
    heroInitial || villainInitial || heroRaw || villainRaw,
    villainInitial || heroInitial || villainRaw || heroRaw
  )
  if (!allInStreet || !heroSlot || !villainSlot || !effectiveStack) {
    return null
  }
  const heroInvested = Math.min(heroRaw, effectiveStack)
  const villainInvested = Math.min(villainRaw || effectiveStack, effectiveStack)
  const deadMoney = Object.keys(contributions)
    .filter(slot => slot !== heroSlot && slot !== villainSlot)
    .reduce((sum, slot) => sum + number(contributions[slot]), 0)
  return {
    heroSlot,
    villainSlot,
    effectiveStack,
    heroInvested,
    allInPot: heroInvested + villainInvested + deadMoney,
    rawHeroInvested: heroRaw,
    rawAllInPot: rawPot
  }
}

function resolveVillainCards(hand, ledgerState, villainSlot) {
  const state = ledgerState || {}
  const players = state.players || {}
  return String(
    (players[villainSlot] && players[villainSlot].cards) ||
    state.villainCards ||
    hand.opponentCards ||
    hand.showdown ||
    hand.villainCards ||
    ''
  )
}

function deriveLedgerHandFields(handInput, options) {
  const config = options || {}
  const hand = handInput || {}
  const ledgerState = hand.ledgerState || {}
  if (!ledgerState || !Array.isArray(ledgerState.actions)) return {}
  const allInStreet = detectAllInStreet(ledgerState.actions)
  if (!allInStreet) return {}
  const accounting = cappedAllInAccounting(hand, ledgerState, allInStreet)
  if (!accounting) return {}
  const derived = {
    isAllIn: true,
    allInStreet,
    terminalStreet: allInStreet,
    handEndedStreet: allInStreet,
    postAllInRunoutOnly: true,
    analysisFocus: allInStreet + '_all_in',
    villainPosition: hand.villainPosition || hand.opponentPosition || accounting.villainSlot,
    opponentPosition: hand.opponentPosition || hand.villainPosition || accounting.villainSlot,
    effectiveStack: accounting.effectiveStack,
    potSize: accounting.allInPot,
    allInPot: accounting.allInPot,
    heroInvested: accounting.heroInvested,
    effectiveAllInPot: accounting.allInPot,
    effectiveAllInStack: accounting.effectiveStack,
    rawAllInPot: accounting.rawAllInPot,
    rawHeroInvested: accounting.rawHeroInvested,
    heroEquityPct: hand.heroEquityPct,
    allInEvEligible: hand.allInEvEligible,
    allInEvStatus: hand.allInEvStatus,
    allInEvSource: hand.allInEvSource,
    allInEv: hand.allInEv,
    allInEvProfit: hand.allInEvProfit,
    allInEvAdjustedProfit: hand.allInEvAdjustedProfit,
    allInEvLuckDelta: hand.allInEvLuckDelta
  }
  if (config.includeEv === false) return derived
  const board = Object.assign({}, hand.board || {}, ledgerState.board || {})
  const heroCards = parseCards(ledgerState.heroCardsInput || hand.heroCardsInput, 2)
  const villainCards = parseCards(resolveVillainCards(hand, ledgerState, accounting.villainSlot), 2)
  const allInBoard = boardCardsAtAllIn(board, allInStreet)
  const heroEquityPct = estimateHeroEquityPct(heroCards, villainCards, allInBoard)
  const ev = allInEv.calculateAllInEv({
    isAllIn: true,
    allInStreet,
    heroEquityPct,
    potSize: accounting.allInPot,
    heroInvested: accounting.heroInvested,
    currentProfit: number(hand.currentProfit)
  })
  return Object.assign({}, derived, {
    heroEquityPct: heroEquityPct == null ? hand.heroEquityPct : heroEquityPct,
    allInEvEligible: ev.status === 'calculated',
    allInEvStatus: ev.status,
    allInEvSource: ev.status === 'calculated' ? (allInStreet === 'preflop' ? 'ledger_rederived_sampled' : 'ledger_rederived_exact') : (hand.allInEvSource || ''),
    allInEv: ev.status === 'calculated' ? ev.adjustedProfit : hand.allInEv,
    allInEvProfit: ev.status === 'calculated' ? ev.adjustedProfit : hand.allInEvProfit,
    allInEvAdjustedProfit: ev.status === 'calculated' ? ev.adjustedProfit : hand.allInEvAdjustedProfit,
    allInEvLuckDelta: ev.status === 'calculated' ? ev.luckDelta : hand.allInEvLuckDelta
  })
}

function withLedgerDerivedFields(hand, options) {
  if (!hand) return hand
  const derived = deriveLedgerHandFields(hand, options)
  return Object.keys(derived).length ? Object.assign({}, hand, derived) : hand
}

module.exports = {
  deriveLedgerHandFields,
  withLedgerDerivedFields,
  __test: {
    actionContributions,
    estimateHeroEquityPct,
    normalizeStreet
  }
}
