const SUIT_META = {
  s: { symbol: '♠', className: 'spade' },
  h: { symbol: '♥', className: 'heart' },
  d: { symbol: '♦', className: 'diamond' },
  c: { symbol: '♣', className: 'club' }
}

function parseCardsInput(value, limit) {
  const cards = String(value || '')
    .trim()
    .match(/([2-9TJQKA])([shdc])/ig) || []

  const parsed = cards.map(function (item) {
    const rank = item.charAt(0).toUpperCase()
    const suit = item.charAt(1).toLowerCase()
    const suitMeta = SUIT_META[suit] || SUIT_META.s
    return {
      rank: rank,
      suit: suit,
      suitSymbol: suitMeta.symbol,
      suitClass: suitMeta.className
    }
  })

  if (typeof limit === 'number') {
    return parsed.slice(0, limit)
  }
  return parsed
}

function parseHeroCardsInput(value) {
  return parseCardsInput(value, 2)
}

function parseOpponentCardsInput(value, context) {
  return parseOpponentCardsDisplay(value, context)
}

function cardToken(card) {
  return card.rank + card.suit
}

function buildOccupiedCards(context) {
  const source = context || {}
  const board = source.board || {}
  return []
    .concat(parseBoardFlat(board).map(cardToken))
    .concat(parseHeroCardsInput(source.heroCardsInput).map(cardToken))
    .concat(parseCardsInput(source.occupiedCards).map(cardToken))
}

function stableOffset(seed, size) {
  const text = String(seed || '')
  let hash = 0
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 31) + text.charCodeAt(index)) % 9973
  }
  return size ? hash % size : 0
}

function rotate(list, offset) {
  if (!list.length) return []
  const start = offset % list.length
  return list.slice(start).concat(list.slice(0, start))
}

function findCardForRank(rank, suits, occupied) {
  for (let index = 0; index < suits.length; index += 1) {
    const suit = suits[index]
    const token = rank + suit
    if (occupied.indexOf(token) === -1) {
      return token
    }
  }
  return ''
}

function parseOpponentCardsDisplay(value, context) {
  const exact = parseCardsInput(value, 2)
  if (exact.length) return exact

  const text = String(value || '').trim().toUpperCase()
  const match = text.match(/^([2-9TJQKA])([2-9TJQKA])([OS])?$/)
  if (!match) return []

  const rankA = match[1]
  const rankB = match[2]
  const suitedness = match[3] || (rankA === rankB ? '' : 'O')
  const occupied = buildOccupiedCards(context)
  const seed = text + '|' + occupied.join(',')
  const suits = rotate(['s', 'h', 'd', 'c'], stableOffset(seed, 4))
  let first = ''
  let second = ''

  if (rankA === rankB) {
    first = findCardForRank(rankA, suits, occupied)
    second = findCardForRank(rankB, suits.filter(function (suit) {
      return first !== rankB + suit
    }), occupied.concat(first))
  } else if (suitedness === 'S') {
    for (let index = 0; index < suits.length; index += 1) {
      const suit = suits[index]
      if (occupied.indexOf(rankA + suit) === -1 && occupied.indexOf(rankB + suit) === -1) {
        first = rankA + suit
        second = rankB + suit
        break
      }
    }
  } else {
    first = findCardForRank(rankA, suits, occupied)
    second = findCardForRank(rankB, suits.filter(function (suit) {
      return first.charAt(1) !== suit
    }), occupied.concat(first))
  }

  return parseCardsInput(first + second, 2)
}

function parseBoardFlat(board) {
  const current = board || {}
  return parseCardsInput(
    String(current.flop || '') +
    String(current.turn || '') +
    String(current.river || ''),
    5
  )
}

function parseBoardStreets(board) {
  const current = board || {}
  return [
    { label: '翻牌', cards: parseCardsInput(current.flop, 3) },
    { label: '转牌', cards: parseCardsInput(current.turn, 1) },
    { label: '河牌', cards: parseCardsInput(current.river, 1) }
  ]
}

module.exports = {
  parseHeroCardsInput: parseHeroCardsInput,
  parseOpponentCardsInput: parseOpponentCardsInput,
  parseOpponentCardsDisplay: parseOpponentCardsDisplay,
  parseCardsInput: parseCardsInput,
  parseBoardFlat: parseBoardFlat,
  parseBoardStreets: parseBoardStreets
}
