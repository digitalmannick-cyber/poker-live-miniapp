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
    { label: 'F', cards: parseCardsInput(current.flop, 3) },
    { label: 'T', cards: parseCardsInput(current.turn, 1) },
    { label: 'R', cards: parseCardsInput(current.river, 1) }
  ]
}

module.exports = {
  parseHeroCardsInput: parseHeroCardsInput,
  parseCardsInput: parseCardsInput,
  parseBoardFlat: parseBoardFlat,
  parseBoardStreets: parseBoardStreets
}
