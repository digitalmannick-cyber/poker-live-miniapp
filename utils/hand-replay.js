const cardUi = require('./card-ui')

const PLAYER_POSITIONS_8_MAX = ['UTG', 'UTG+1', 'MP', 'HJ', 'CO', 'BTN', 'SB', 'BB']
const STREET_ORDER = ['preflop', 'flop', 'turn', 'river']
const STREET_LABELS = {
  preflop: 'PF',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River'
}
const ACTION_SEPARATORS = /\s*(?:->|\u2192|,|\uFF0C|;|\uFF1B)\s*/g
const PROTECTED_NUMBER_COMMA = '\u0001'
const AGGRESSIVE_ACTION_PATTERN = /(OPEN|RAISE|BET|ALLIN|AI|[2345]B|\bR\b|R(?=\d)|\bB\b|B(?=\d))/i
const ACTION_LABELS = {
  open: 'OPEN',
  raise: 'RAISE',
  bet: 'BET',
  call: 'CALL',
  check: 'CHECK',
  fold: 'FOLD',
  allin: 'ALL-IN',
  action: 'ACTION'
}

function normalizePosition(value) {
  return String(value || '').trim().toUpperCase()
}

function parseStakeLevel(value) {
  const text = String(value || '').trim()
  const match = text.match(/(\d{1,6})\s*[\/\\]\s*(\d{1,6})/)
  return {
    smallBlind: match ? Number(match[1]) || 0 : 0,
    bigBlind: match ? Number(match[2]) || 0 : 0
  }
}

function formatStackText(value) {
  const amount = Math.round(Number(value) || 0)
  return amount > 0 ? String(amount) : ''
}

function findPlayerSnapshotByPosition(hand, position, noteId) {
  const normalizedPosition = normalizePosition(position)
  const normalizedNoteId = String(noteId || '').trim()
  const snapshots = Array.isArray(hand && hand.playerSnapshots) ? hand.playerSnapshots : []
  return snapshots.find(function (snapshot) {
    if (!snapshot) return false
    const snapshotPosition = normalizePosition(snapshot.position || snapshot.pos || snapshot.slot)
    const snapshotNoteId = String(snapshot.playerNoteId || '').trim()
    return (normalizedPosition && snapshotPosition === normalizedPosition) ||
      (normalizedNoteId && snapshotNoteId === normalizedNoteId)
  }) || null
}

function buildPlayers(hand) {
  const source = hand || {}
  const heroPosition = normalizePosition(source.heroPosition) || 'BTN'
  const villainPosition = normalizePosition(source.villainPosition)
  const opponentName = String(source.opponentName || '').trim()
  const opponentPlayerNoteId = String(source.opponentPlayerNoteId || '').trim()
  const effectiveStack = Number(source.effectiveStack) || 0
  const blinds = parseStakeLevel(source.stakeLevel)
  const defaultStack = blinds.bigBlind ? blinds.bigBlind * 100 : 0
  return PLAYER_POSITIONS_8_MAX.map(function (position) {
    const isHero = position === heroPosition
    const isVillain = !!(villainPosition && position === villainPosition)
    const snapshot = findPlayerSnapshotByPosition(source, position, isVillain ? opponentPlayerNoteId : '')
    const stack = isVillain && effectiveStack ? effectiveStack : defaultStack
    const avatarDisplayUrl = String(snapshot && snapshot.avatarDisplayUrl || '').trim()
    const avatarUrl = String(snapshot && snapshot.avatarUrl || (isVillain ? source.opponentAvatarUrl : '') || '').trim()
    const avatarFileId = String(snapshot && snapshot.avatarFileId || (isVillain ? source.opponentAvatarFileId : '') || '').trim()
    const playerName = String(snapshot && snapshot.playerName || '').trim()
    return {
      id: position.toLowerCase().replace(/\W+/g, '-'),
      position,
      name: isHero ? 'Hero' : (playerName || (isVillain && opponentName ? opponentName : position)),
      stackText: formatStackText(stack),
      isHero,
      isVillain,
      isDealer: position === 'BTN',
      avatarDisplayUrl: avatarDisplayUrl || avatarUrl,
      avatarUrl,
      avatarFileId,
      hasAvatar: !!(avatarDisplayUrl || avatarUrl),
      seatClass: 'seat-' + position.toLowerCase().replace(/\+/, 'plus').replace(/\W+/g, '-')
    }
  })
}

function getBoardCardsForStreet(board, street) {
  const current = board || {}
  if (street === 'flop') return cardUi.parseCardsInput(current.flop, 3)
  if (street === 'turn') {
    return cardUi.parseCardsInput(String(current.flop || '') + String(current.turn || ''), 4)
  }
  if (street === 'river') {
    return cardUi.parseCardsInput(String(current.flop || '') + String(current.turn || '') + String(current.river || ''), 5)
  }
  return []
}

function splitActionLine(value) {
  return String(value || '')
    .replace(/(\d),(\d)/g, '$1' + PROTECTED_NUMBER_COMMA + '$2')
    .replace(/\s*\/\s*/g, ' -> ')
    .split(ACTION_SEPARATORS)
    .map(function (item) {
      return item.replace(new RegExp(PROTECTED_NUMBER_COMMA, 'g'), ',').trim()
    })
    .filter(Boolean)
}

function resolveActorPosition(actionText, heroPosition) {
  const text = String(actionText || '').toUpperCase()
  if (/\bHERO\b/.test(text)) {
    const heroMatch = text.match(/\bHERO\s+(UTG\+1|UTG|MP|HJ|CO|BTN|SB|BB)\b/)
    return heroMatch ? heroMatch[1] : heroPosition
  }
  const match = text.match(/\b(UTG\+1|UTG|MP|HJ|CO|BTN|SB|BB)\b/)
  return match ? match[1] : ''
}

function extractBetText(actionText) {
  const text = String(actionText || '').trim()
  if (!AGGRESSIVE_ACTION_PATTERN.test(text)) return ''
  const amount = extractActionAmount(text)
  return amount
}

function classifyAction(actionText) {
  const text = String(actionText || '').toUpperCase()
  if (/\b(ALL[\s-]?IN|AI)\b/.test(text)) return 'allin'
  if (/\bOPEN\b/.test(text)) return 'open'
  if (/\b(RAISE|RAISES|RAISED|R)\b|R(?=\d)|\b[2345]B(?=\d|\b)/.test(text)) return 'raise'
  if (/\b(BET|BETS|BETTED|B)\b|B(?=\d)/.test(text)) return 'bet'
  if (/\b(CALL|CALLS|CALLED|C)\b/.test(text)) return 'call'
  if (/\b(CHECK|CHECKS|CHECKED|X)\b/.test(text)) return 'check'
  if (/\b(FOLD|FOLDS|FOLDED|F)\b/.test(text)) return 'fold'
  return 'action'
}

function extractActionAmount(actionText) {
  const withoutPositions = String(actionText || '')
    .replace(/\bUTG\+1\b/gi, '')
    .replace(/\b(UTG|MP|HJ|CO|BTN|SB|BB|HERO)\b/gi, '')
    .replace(/\b[2345]B(?=\d|\b)/gi, '')
  const amounts = withoutPositions.match(/[0-9][0-9.,]*/g) || []
  if (!amounts.length) return ''
  return amounts[amounts.length - 1].replace(/,/g, '')
}

function buildActionDisplay(actionText, actorPosition) {
  const actionType = classifyAction(actionText)
  const actionLabel = ACTION_LABELS[actionType] || ACTION_LABELS.action
  const actionAmount = extractActionAmount(actionText)
  const actionChipText = actionAmount ? actionLabel + ' ' + actionAmount : actionLabel
  return {
    actionType,
    actionLabel,
    actionAmount,
    actionChipText,
    displayActionText: actorPosition ? actorPosition + ' ' + actionChipText : actionChipText
  }
}

function buildActionStepsForStreet(config) {
  const source = config || {}
  const parts = splitActionLine(source.actionText)
  if (!parts.length) return []
  return parts.map(function (part, index) {
    const actorPosition = resolveActorPosition(part, source.heroPosition)
    const display = buildActionDisplay(part, actorPosition)
    return {
      key: source.street + '-' + index,
      street: source.street,
      streetLabel: STREET_LABELS[source.street] || source.street,
      actionText: part,
      fullActionText: source.actionText,
      actorPosition,
      actionType: display.actionType,
      actionLabel: display.actionLabel,
      actionAmount: display.actionAmount,
      actionChipText: display.actionChipText,
      displayActionText: display.displayActionText,
      betText: extractBetText(part),
      potText: source.potText,
      boardCards: source.boardCards,
      progressText: ''
    }
  })
}

function buildSteps(hand) {
  const source = hand || {}
  const streetInputs = source.streetInputs || {}
  const board = source.board || {}
  const heroPosition = normalizePosition(source.heroPosition) || 'BTN'
  const steps = []

  STREET_ORDER.forEach(function (street) {
    const input = streetInputs[street] || {}
    const actionText = String(input.actionLine || '').trim()
    const boardCards = getBoardCardsForStreet(board, street)
    const potText = String(input.pot || '').trim()
    if (!actionText && !boardCards.length && !potText) return
    const actionSteps = buildActionStepsForStreet({
      street,
      actionText,
      potText: potText || (source.potSize ? String(source.potSize) : ''),
      boardCards,
      heroPosition
    })
    if (actionSteps.length) {
      actionSteps.forEach(function (step) { steps.push(step) })
      return
    }
    steps.push({
      key: street,
      street,
      streetLabel: STREET_LABELS[street] || street,
      actionText: boardCards.length ? STREET_LABELS[street] + ' Deal' : 'Action',
      fullActionText: actionText,
      actorPosition: '',
      actionType: 'action',
      actionLabel: ACTION_LABELS.action,
      actionAmount: '',
      actionChipText: '',
      displayActionText: boardCards.length ? STREET_LABELS[street] + ' Deal' : 'Action',
      betText: '',
      potText: potText || (source.potSize ? String(source.potSize) : ''),
      boardCards,
      progressText: ''
    })
  })

  return steps.map(function (step, index) {
    return Object.assign({}, step, {
      progressText: (index + 1) + ' / ' + steps.length
    })
  })
}

function canReplayHand(hand) {
  const source = hand || {}
  return !!(
    source &&
    source._id &&
    cardUi.parseHeroCardsInput(source.heroCardsInput).length === 2 &&
    buildSteps(source).length > 0
  )
}

function buildReplayView(hand) {
  const source = hand || {}
  const steps = buildSteps(source)
  return {
    handId: source._id || '',
    title: normalizePosition(source.heroPosition) || 'Hero',
    heroCards: cardUi.parseHeroCardsInput(source.heroCardsInput),
    players: buildPlayers(source),
    steps,
    stepCount: steps.length,
    available: canReplayHand(source)
  }
}

function socialCardInput(cards) {
  return (Array.isArray(cards) ? cards : []).join('')
}

function socialStackText(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0) return ''
  return String(Math.round(amount * 10) / 10) + ' BB'
}

function buildSocialPlayers(snapshot) {
  const source = snapshot || {}
  const hero = source.hero || {}
  const combined = [hero].concat(Array.isArray(source.players) ? source.players : [])
  const seen = {}
  return combined.reduce(function (players, player) {
    const position = normalizePosition(player && player.position)
    if (!position || PLAYER_POSITIONS_8_MAX.indexOf(position) < 0 || seen[position]) return players
    seen[position] = true
    const isHero = String(player && player.label || '') === 'Hero' || position === normalizePosition(hero.position)
    players.push({
      id: 'social-' + position.toLowerCase().replace(/\W+/g, '-'),
      position,
      name: isHero ? 'Hero' : String(player && player.label || position),
      stackText: socialStackText(player && player.stackBb),
      isHero,
      isVillain: !isHero,
      isDealer: position === 'BTN',
      hasAvatar: false,
      seatClass: 'seat-' + position.toLowerCase().replace(/\+/, 'plus').replace(/\W+/g, '-')
    })
    return players
  }, [])
}

function socialBoardForStreet(board, street) {
  const source = board || {}
  const flop = socialCardInput(source.flop)
  const turn = socialCardInput(source.turn)
  const river = socialCardInput(source.river)
  if (street === 'flop') return cardUi.parseCardsInput(flop, 3)
  if (street === 'turn') return cardUi.parseCardsInput(flop + turn, 4)
  if (street === 'river') return cardUi.parseCardsInput(flop + turn + river, 5)
  return []
}

function buildSocialReplayView(snapshot, handId) {
  const source = snapshot || {}
  const hero = source.hero || {}
  const players = buildSocialPlayers(source)
  const positionsByActor = {}
  players.forEach(function (player) { positionsByActor[player.name] = player.position })
  positionsByActor.Hero = normalizePosition(hero.position)
  const actions = Array.isArray(source.actions) ? source.actions : []
  const steps = actions.map(function (action, index) {
    const street = String(action && action.street || 'preflop').toLowerCase()
    const actor = String(action && action.actor || '')
    const actionType = classifyAction(action && action.type)
    const actionLabel = ACTION_LABELS[actionType] || String(action && action.type || 'ACTION').toUpperCase()
    const amount = Number(action && action.amountBb)
    const amountText = Number.isFinite(amount) && amount >= 0 ? String(Math.round(amount * 10) / 10) + ' BB' : ''
    const actionChipText = amountText ? actionLabel + ' ' + amountText : actionLabel
    return {
      key: 'social-' + index,
      street,
      streetLabel: STREET_LABELS[street] || street.toUpperCase(),
      actionText: [actor, actionLabel, amountText].filter(Boolean).join(' '),
      fullActionText: '',
      actorPosition: positionsByActor[actor] || '',
      actionType,
      actionLabel,
      actionAmount: amountText,
      actionChipText,
      displayActionText: [actor, actionLabel, amountText].filter(Boolean).join(' '),
      betText: amountText,
      potText: index === actions.length - 1 ? socialStackText(source.potBb) : '',
      boardCards: socialBoardForStreet(source.board, street),
      progressText: (index + 1) + ' / ' + actions.length
    }
  })
  return {
    handId: String(handId || ''),
    title: '匿名 · BB',
    heroCards: cardUi.parseCardsInput(socialCardInput(hero.cards), 2),
    players,
    steps,
    stepCount: steps.length,
    available: cardUi.parseCardsInput(socialCardInput(hero.cards), 2).length === 2 && steps.length > 0,
    privacyMode: true
  }
}

module.exports = {
  buildReplayView,
  buildSocialReplayView,
  canReplayHand
}
