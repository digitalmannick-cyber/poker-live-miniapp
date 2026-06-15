const STREET_LABELS = {
  preflop: '翻前',
  flop: '翻牌',
  turn: '转牌',
  river: '河牌'
}

const SUIT_SYMBOLS = {
  s: '\u2660',
  h: '\u2665',
  d: '\u2666',
  c: '\u2663',
  '\u2660': '\u2660',
  '\u2665': '\u2665',
  '\u2666': '\u2666',
  '\u2663': '\u2663'
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function formatBoardCards(value) {
  const source = String(value || '').trim()
  if (!source) return ''
  const cards = []
  source.replace(/([2-9TJQKA])\s*([shdc\u2660\u2665\u2666\u2663])/ig, function (_, rank, suit) {
    cards.push(rank.toUpperCase() + (SUIT_SYMBOLS[String(suit).toLowerCase()] || SUIT_SYMBOLS[suit] || suit))
    return ''
  })
  return cards.length ? cards.join('') : source
}

function normalizeStreetName(value) {
  const key = String(value || '').trim().toLowerCase()
  if (key === 'pf' || key === 'preflop' || key === '\u7ffb\u524d') return '翻前'
  if (key === 'f' || key === 'flop' || key === '\u7ffb\u724c') return '翻牌'
  if (key === 't' || key === 'turn' || key === '\u8f6c\u724c') return '转牌'
  if (key === 'r' || key === 'river' || key === '\u6cb3\u724c') return '河牌'
  return STREET_LABELS[key] || value
}

function normalizeActionWords(value) {
  return String(value || '')
    .replace(/\s*(?:->|=>|\u2192|；|;)\s*/g, ', ')
    .replace(/\b(?:check|checks|checked)\b/ig, 'X')
    .replace(/\b(?:call|calls|called)\b/ig, 'C')
    .replace(/\b(?:fold|folds|folded)\b/ig, 'F')
    .replace(/\b(?:all[\s-]?in|allin|jam|jams|shove|shoves)\b/ig, 'AI')
    .replace(/\b(?:cbet|donk|bet|bets|betting)\s*(1\/3|one\s*third)\b/ig, 'B33%')
    .replace(/\b(?:cbet|donk|bet|bets|betting)\s*(1\/2|half(?:\s*pot)?)\b/ig, 'B50%')
    .replace(/\b(?:cbet|donk|bet|bets|betting)\s*(2\/3|two\s*thirds?)\b/ig, 'B67%')
    .replace(/\b(?:cbet|donk|bet|bets|betting)\s*(3\/4|three\s*quarters?)\b/ig, 'B75%')
    .replace(/\b(?:cbet|donk|bet|bets|betting)\s*(pot|full\s*pot)\b/ig, 'B100%')
    .replace(/\b(?:cbet|donk|bet|bets|betting)\s*(\d+(?:\.\d+)?)\s*%\b/ig, 'B$1%')
    .replace(/\b(?:cbet|donk|bet|bets|betting)\s*(\d+(?:\.\d+)?)\b/ig, 'B$1')
    .replace(/\b(?:open|opens|raise|raises|raised)\s*(?:to\s*)?(\d+(?:\.\d+)?)(?:\s*bb)?\b/ig, 'R$1')
    .replace(/\b3\s*bet\s*(?:to\s*)?(\d+(?:\.\d+)?)?\b/ig, function (_, amount) { return '3B' + (amount || '') })
    .replace(/\b4\s*bet\s*(?:to\s*)?(\d+(?:\.\d+)?)?\b/ig, function (_, amount) { return '4B' + (amount || '') })
    .replace(/\b5\s*bet\s*(?:to\s*)?(\d+(?:\.\d+)?)?\b/ig, function (_, amount) { return '5B' + (amount || '') })
    .replace(/\s*,\s*/g, ', ')
}

function ensurePostflopPercent(value, streetKey) {
  if (String(streetKey || '').toLowerCase() === 'preflop') return value
  return String(value || '').replace(/\bB(\d{1,3})(?![\d.%])/g, function (match, amount) {
    const numeric = Number(amount)
    if (!Number.isFinite(numeric) || numeric > 200) return match
    return 'B' + amount + '%'
  })
}

function expandDisplayStreetLabels(value) {
  return String(value || '')
    .replace(/(^|\s|\/)(PF)(?=\s*:)/g, '$1翻前')
    .replace(/(^|\s|\/)(F)(?=\s*(?::|[2-9TJQKA][shdc\u2660\u2665\u2666\u2663]))/g, '$1翻牌')
    .replace(/(^|\s|\/)(T)(?=\s*(?::|[2-9TJQKA][shdc\u2660\u2665\u2666\u2663]))/g, '$1转牌')
    .replace(/(^|\s|\/)(R)(?=\s*(?::|[2-9TJQKA][shdc\u2660\u2665\u2666\u2663]))/g, '$1河牌')
}

function formatActionLine(value, streetKey) {
  const source = normalizeWhitespace(value)
  if (!source) return ''
  const compact = normalizeActionWords(source)
    .replace(/\b(preflop|\u7ffb\u524d)\b\s*[:：]?/ig, 'PF: ')
    .replace(/\b(flop|\u7ffb\u724c)\b\s*[:：]?/ig, 'F: ')
    .replace(/\b(turn|\u8f6c\u724c)\b\s*[:：]?/ig, 'T: ')
    .replace(/\b(river|\u6cb3\u724c)\b\s*[:：]?/ig, 'R: ')
    .replace(/\s*[:：]\s*/g, ': ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return expandDisplayStreetLabels(ensurePostflopPercent(compact, streetKey))
}

function formatStreetLine(streetKey, actionLine, boardCards) {
  const label = normalizeStreetName(streetKey)
  const board = formatBoardCards(boardCards)
  const action = formatActionLine(actionLine, streetKey)
  const head = board ? `${label} ${board}` : label
  return action ? `${head}: ${action}` : head
}

function formatStreetSummary(value) {
  const source = normalizeWhitespace(value)
  if (!source) return '\u6682\u65e0\u884c\u52a8\u7ebf'
  return expandDisplayStreetLabels(ensurePostflopPercent(formatActionLine(source), 'flop'))
    .replace(/(^|\s|\/)(F|T|R|翻牌|转牌|河牌)\s+((?:[2-9TJQKA]\s*[shdc\u2660\u2665\u2666\u2663]\s*){1,3})\s*:/ig, function (_, prefix, street, cards) {
      return prefix + normalizeStreetName(street) + ' ' + formatBoardCards(cards) + ':'
    })
    .replace(/\s*[；;]\s*/g, ' / ')
    .replace(/\s*\/\s*/g, ' / ')
}

module.exports = {
  formatActionLine,
  formatStreetLine,
  formatStreetSummary,
  formatBoardCards,
  normalizeStreetName,
  expandDisplayStreetLabels
}
