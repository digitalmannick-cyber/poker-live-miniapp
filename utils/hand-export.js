const cardUi = require('./card-ui')

const STREET_ORDER = ['Pre', 'Flop', 'Turn', 'River']
const STREET_TITLES = {
  Pre: 'HOLE CARDS',
  Flop: 'FLOP',
  Turn: 'TURN',
  River: 'RIVER'
}

const POSITION_ORDER = {
  6: ['CO', 'BU', 'SB', 'BB', 'UTG', 'HJ'],
  8: ['CO', 'BU', 'SB', 'BB', 'UTG', 'UTG+1', 'LJ', 'HJ'],
  9: ['CO', 'BU', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'LJ', 'HJ']
}

function numberValue(value) {
  const n = Number(String(value == null ? '' : value).replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function formatMoney(value) {
  const n = numberValue(value)
  return '$' + (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, '')
}

function formatMoneyFixed(value) {
  const n = numberValue(value)
  return '$' + (Math.round(n * 100) / 100).toFixed(2)
}

function parseLevel(level, session) {
  const text = String(level || '').replace(/NLHE|NL|HK\$|¥|\s/ig, '')
  const match = text.match(/(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)/)
  const sb = match ? numberValue(match[1]) : numberValue(session && session.smallBlind) || 200
  const bb = match ? numberValue(match[2]) : numberValue(session && session.bigBlind) || 400
  return { sb, bb }
}

function normalizePosition(position) {
  const text = String(position || '').trim().replace(/^HERO\s+/i, '').toUpperCase()
  if (text === 'BTN' || text === 'BUTTON') return 'BU'
  if (text === 'UTG1') return 'UTG+1'
  return text || ''
}

function actionPosition(action) {
  return normalizePosition(action && (action.position || action.actorLabel || action.pos))
}

function actionType(action) {
  const raw = String(action && (action.action || action.actionType) || '').trim()
  const key = raw.toLowerCase().replace(/[\s-]+/g, '_')
  const normalized = {
    fold: 'Fold',
    check: 'X',
    x: 'X',
    call: 'Call',
    bet: 'Bet',
    raise: 'Raise',
    raise_to: 'Raise',
    all_in: 'All-in',
    allin: 'All-in',
    post: 'Post',
    str: 'Str',
    straddle: 'Str',
    show: 'Show',
    muck: 'Muck',
    start: 'Start'
  }
  return normalized[key] || raw
}

function normalizeStreet(street) {
  const key = String(street || '').trim().toLowerCase()
  if (key === 'pre' || key === 'preflop') return 'Pre'
  if (key === 'flop') return 'Flop'
  if (key === 'turn') return 'Turn'
  if (key === 'river') return 'River'
  return String(street || '').trim()
}

function displayPlayerName(position, heroPosition) {
  return normalizePosition(position) === normalizePosition(heroPosition) ? 'Hero' : normalizePosition(position)
}

function cardCode(card) {
  if (!card) return ''
  return String(card.rank || '').toUpperCase() + String(card.suit || '').toLowerCase()
}

function formatCardList(cards) {
  const list = (cards || []).map(cardCode).filter(Boolean)
  return list.length ? '[' + list.join(' ') + ']' : '[]'
}

function parseCards(value, limit) {
  return cardUi.parseCardsInput(value, limit)
}

function boardCards(board, street) {
  const current = board || {}
  const flop = parseCards(current.flop, 3)
  const turn = parseCards(current.turn, 1)
  const river = parseCards(current.river, 1)
  if (street === 'Flop') return flop
  if (street === 'Turn') return flop.concat(turn)
  if (street === 'River') return flop.concat(turn).concat(river)
  return []
}

function streetBoardLine(board, street) {
  if (street === 'Flop') return formatCardList(boardCards(board, 'Flop'))
  if (street === 'Turn') return formatCardList(boardCards(board, 'Flop')) + ' ' + formatCardList(parseCards(board && board.turn, 1))
  if (street === 'River') return formatCardList(boardCards(board, 'Turn')) + ' ' + formatCardList(parseCards(board && board.river, 1))
  return ''
}

function buildSeats(hand, session) {
  const playerCount = Math.max(2, Math.min(9, numberValue(hand.playerCount || hand.tableMax || session && session.tableSize) || 8))
  const snapshots = Array.isArray(hand.playerSnapshots) ? hand.playerSnapshots : []
  const snapshotPositions = snapshots.map(item => normalizePosition(item && item.position)).filter(Boolean)
  const positions = snapshotPositions.length === playerCount
    ? snapshotPositions
    : (POSITION_ORDER[playerCount] || POSITION_ORDER[8])
  const heroPosition = normalizePosition(hand.heroPosition || 'SB')
  const heroStack = numberValue(hand.effectiveStack || hand.heroStack || hand.stackAtHand || hand.stack || session && session.currentStack) || 40000
  const defaultStack = numberValue(hand.defaultStack || hand.villainStack || hand.effectiveStack) || 40000
  return positions.map(function (position, index) {
    const normalizedPosition = normalizePosition(position)
    const snapshot = snapshots.find(item => normalizePosition(item && item.position) === normalizedPosition) || {}
    const isHero = normalizedPosition === heroPosition
    return {
      seat: index + 1,
      position: normalizedPosition,
      name: isHero ? 'Hero' : normalizedPosition,
      stack: numberValue(snapshot.initialStack || snapshot.stack) || (isHero ? heroStack : defaultStack),
      isButton: normalizedPosition === 'BU'
    }
  })
}

function streetActions(actions, street) {
  return (actions || []).filter(function (item) {
    return item && normalizeStreet(item.street) === street && actionType(item) !== 'Start'
  })
}

function isBlindAction(action) {
  const type = actionType(action)
  return action && (type === 'Post' || type === 'Str')
}

function formatAction(action, context) {
  const name = displayPlayerName(actionPosition(action), context.heroPosition)
  const type = actionType(action)
  const amount = numberValue(action.amount)
  const currentBet = context.currentBet || 0
  if (type === 'Fold') return name + ': folds'
  if (type === 'X') return name + ': checks'
  if (type === 'Call') return name + ': calls ' + formatMoney(amount)
  if (type === 'Bet') {
    context.currentBet = amount
    return name + ': bets ' + formatMoney(amount)
  }
  if (type === 'Raise') {
    const raiseBy = Math.max(0, amount - currentBet)
    context.currentBet = Math.max(currentBet, amount)
    return name + ': raises ' + formatMoney(raiseBy || amount) + ' to ' + formatMoney(amount)
  }
  if (type === 'All-in') {
    if (amount > currentBet) {
      const raiseBy = Math.max(0, amount - currentBet)
      context.currentBet = amount
      return name + ': raises ' + formatMoney(raiseBy || amount) + ' to ' + formatMoney(amount) + ' and is all-in'
    }
    return name + ': calls ' + formatMoney(amount) + ' and is all-in'
  }
  if (type === 'Show') return name + ': shows ' + formatCardList(context.showdownCardsByPosition[actionPosition(action)] || [])
  if (type === 'Muck') return name + ': mucks'
  if (!name || !type) return ''
  return amount ? name + ': ' + type + ' ' + formatMoney(amount) : name + ': ' + type
}

function collectShowdownCards(hand) {
  const hero = parseCards(hand.heroCardsInput, 2)
  const villain = cardUi.parseOpponentCardsInput(hand.opponentCards || hand.showdown || hand.villainCards || '', {
    board: hand.board,
    heroCardsInput: hand.heroCardsInput
  })
  const villainPosition = normalizePosition(hand.villainPosition || hand.opponentPosition || '')
  const map = {}
  map[normalizePosition(hand.heroPosition)] = hero
  if (villain.length === 2 && villainPosition) map[villainPosition] = villain
  return map
}

function buildSummarySeatLine(seat, hand, actions, winnerName, pot) {
  const position = normalizePosition(seat.position)
  const name = seat.name
  const folded = (actions || []).find(function (item) {
    return actionPosition(item) === position && actionType(item) === 'Fold'
  })
  const showed = (actions || []).find(function (item) {
    return actionPosition(item) === position && actionType(item) === 'Show'
  })
  if (showed && name === winnerName) return 'Seat ' + seat.seat + ': ' + name + ' showed ' + formatCardList(collectShowdownCards(hand)[position] || []) + ' and won (' + formatMoney(pot) + ')'
  if (showed) return 'Seat ' + seat.seat + ': ' + name + ' showed ' + formatCardList(collectShowdownCards(hand)[position] || [])
  if (name === winnerName) return 'Seat ' + seat.seat + ': ' + name + ' won (' + formatMoney(pot) + ')'
  if (name === 'Hero') return 'Seat ' + seat.seat + ': Hero mucked ' + formatCardList(parseCards(hand.heroCardsInput, 2))
  if (folded) return 'Seat ' + seat.seat + ': ' + name + ' folded ' + (folded.street === 'Pre' ? 'before Flop' : 'on ' + folded.street)
  return 'Seat ' + seat.seat + ': ' + name
}

function formatDateTime(hand, session) {
  const raw = hand.playedAt || hand.createdAt || hand.updatedAt || session && (session.startTime || session.date)
  const date = raw ? new Date(raw) : new Date()
  if (Number.isNaN(date.getTime())) {
    const text = String(hand.playedDate || session && session.date || '').replace(/-/g, '/')
    return (text || '2026/07/10') + ' 00:00:00'
  }
  const pad = function (n) { return String(n).padStart(2, '0') }
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('/') + ' ' + [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join(':')
}

function buildPokerStarsExport(handInput, options) {
  const hand = handInput || {}
  const config = options || {}
  const session = config.session || {}
  const actions = Array.isArray(config.actions) && config.actions.length
    ? config.actions
    : Array.isArray(hand.actions) ? hand.actions : []
  const level = parseLevel(hand.stakeLevel || session.stakeLevel || session.blindLevel, session)
  const seats = buildSeats(hand, session)
  const buttonSeat = (seats.find(item => item.isButton) || seats[1] || seats[0]).seat
  const heroPosition = normalizePosition(hand.heroPosition || 'SB')
  const tableName = String(session.venue || session.title || 'Pokerscope').replace(/\s+\d+\/\d+.*$/, '') || 'Pokerscope'
  const handId = String(hand._id || hand.id || Date.now()).replace(/^hand_/, '')
  const pot = numberValue(hand.potSize || hand.allInPot || hand.finalPot || hand.currentPot || hand.currentProfit && Math.abs(hand.currentProfit)) || 0
  const winnerName = numberValue(hand.currentProfit) >= 0 ? 'Hero' : displayPlayerName(hand.villainPosition || hand.opponentPosition || '', heroPosition)
  const showdownCardsByPosition = collectShowdownCards(hand)
  const lines = []

  lines.push('PokerStars Hand #' + handId + ': Hold\'em No Limit (' + formatMoneyFixed(level.sb) + '/' + formatMoneyFixed(level.bb) + ') - ' + formatDateTime(hand, session) + ' ET')
  lines.push("Table '" + tableName + "' " + seats.length + '-max Seat #' + buttonSeat + ' is the button')
  seats.forEach(function (seat) {
    lines.push('Seat ' + seat.seat + ': ' + seat.name + ' (' + formatMoney(seat.stack) + ' in chips)')
  })

  const blindActions = actions.filter(isBlindAction)
  if (blindActions.length) {
    blindActions.forEach(function (action) {
      const name = displayPlayerName(actionPosition(action), heroPosition)
      if (actionType(action) === 'Str') lines.push(name + ': posts straddle ' + formatMoney(action.amount))
      else if (actionPosition(action) === 'SB') lines.push(name + ': posts small blind ' + formatMoney(action.amount))
      else if (actionPosition(action) === 'BB') lines.push(name + ': posts big blind ' + formatMoney(action.amount))
      else lines.push(name + ': posts blind ' + formatMoney(action.amount))
    })
  } else {
    lines.push(displayPlayerName('SB', heroPosition) + ': posts small blind ' + formatMoney(level.sb))
    lines.push(displayPlayerName('BB', heroPosition) + ': posts big blind ' + formatMoney(level.bb))
  }

  lines.push('*** HOLE CARDS ***')
  lines.push('Dealt to Hero ' + formatCardList(parseCards(hand.heroCardsInput, 2)))

  STREET_ORDER.forEach(function (street) {
    if (street !== 'Pre') {
      const streetCards = boardCards(hand.board, street)
      if (!streetCards.length) return
      lines.push('*** ' + STREET_TITLES[street] + ' *** ' + streetBoardLine(hand.board, street))
    }
    const context = { heroPosition, currentBet: street === 'Pre' ? level.bb : 0, showdownCardsByPosition }
    streetActions(actions, street)
      .filter(function (action) { return !isBlindAction(action) && actionType(action) !== 'Show' && actionType(action) !== 'Muck' })
      .forEach(function (action) {
        const line = formatAction(action, context)
        if (line) lines.push(line)
      })
  })

  const showdownActions = actions.filter(function (item) {
    const type = actionType(item)
    return item && (type === 'Show' || type === 'Muck')
  })
  if (showdownActions.length || hand.opponentCards || hand.showdown) {
    lines.push('*** SHOW DOWN ***')
    if (parseCards(hand.heroCardsInput, 2).length === 2) lines.push('Hero: shows ' + formatCardList(parseCards(hand.heroCardsInput, 2)))
    showdownActions.forEach(function (action) {
      if (displayPlayerName(actionPosition(action), heroPosition) === 'Hero') return
      lines.push(formatAction(action, { heroPosition, currentBet: 0, showdownCardsByPosition }))
    })
    if (!showdownActions.length && (hand.opponentCards || hand.showdown)) {
      lines.push(displayPlayerName(hand.villainPosition || hand.opponentPosition || 'BU', heroPosition) + ': shows ' + formatCardList(cardUi.parseOpponentCardsInput(hand.opponentCards || hand.showdown, {
        board: hand.board,
        heroCardsInput: hand.heroCardsInput
      })))
    }
    if (winnerName) lines.push(winnerName + ' collected ' + formatMoney(pot) + ' from pot')
  }

  lines.push('*** SUMMARY ***')
  lines.push('Total pot ' + formatMoney(pot) + ' | Rake $0')
  const fullBoard = boardCards(hand.board, 'River')
  if (fullBoard.length) lines.push('Board ' + formatCardList(fullBoard))
  seats.forEach(function (seat) {
    lines.push(buildSummarySeatLine(seat, hand, actions, winnerName, pot))
  })
  return lines.join('\n')
}

module.exports = {
  buildPokerStarsExport
}
