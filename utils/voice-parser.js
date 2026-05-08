function parseVoiceText(text) {
  const raw = (text || '').trim()
  const result = {
    heroPosition: '',
    heroCardsInput: '',
    effectiveStack: '',
    potSize: '',
    currentProfit: '',
    board: {
      flop: '',
      turn: '',
      river: ''
    },
    noteSummary: raw
  }

  const posMatch = raw.match(/\b(UTG|HJ|CO|BTN|SB|BB|LJ|MP)\b/i)
  if (posMatch) result.heroPosition = posMatch[1].toUpperCase()

  const cardsMatch = raw.match(/([2-9TJQKA][shdcSHDC][2-9TJQKA][shdcSHDC])/)
  if (cardsMatch) result.heroCardsInput = cardsMatch[1]

  const stackMatch = raw.match(/有效筹码\s*(\d+)/)
  if (stackMatch) result.effectiveStack = stackMatch[1]

  const potMatch = raw.match(/底池\s*(\d+)/)
  if (potMatch) result.potSize = potMatch[1]

  const winMatch = raw.match(/赢\s*(\d+)/)
  const loseMatch = raw.match(/输\s*(\d+)/)
  if (winMatch) result.currentProfit = winMatch[1]
  if (loseMatch) result.currentProfit = '-' + loseMatch[1]

  const flopMatch = raw.match(/翻牌\s*([2-9TJQKA][shdcSHDC][2-9TJQKA][shdcSHDC][2-9TJQKA][shdcSHDC])/)
  if (flopMatch) result.board.flop = flopMatch[1]

  const turnMatch = raw.match(/转牌\s*([2-9TJQKA][shdcSHDC])/)
  if (turnMatch) result.board.turn = turnMatch[1]

  const riverMatch = raw.match(/河牌\s*([2-9TJQKA][shdcSHDC])/)
  if (riverMatch) result.board.river = riverMatch[1]

  return result
}

module.exports = {
  parseVoiceText
}
