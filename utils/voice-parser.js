const STREET_ALIASES = {
  preflop: ['preflop', '翻牌前', '翻前', '牌前', '前面', '前位'],
  flop: ['flop', '翻牌(?!前)', '牌面'],
  turn: ['turn', '转牌'],
  river: ['river', '河牌']
}

const POSITION_ALIASES = [
  ['UTG+1', /\bUTG\+?1\b/i],
  ['UTG', /\bUTG\b/i],
  ['LJ', /\bLJ\b/i],
  ['HJ', /\bHJ\b|中间位置|中位|中间位/i],
  ['CO', /\bCO\b|cutoff|枪口后/i],
  ['BTN', /\bBTN\b|button|按钮位|庄位/i],
  ['SB', /\bSB\b|小盲/i],
  ['BB', /\bBB\b|大盲/i],
  ['STR', /\bSTR\b|straddle|抓头/i]
]

const OPPONENT_ALIASES = [
  ['紧弱', /紧弱|nit|紧凶/i],
  ['松弱', /松弱|鱼|老板|娱乐玩家|松凶|松浪/i],
  ['激进', /激进|凶|reg|regular|职业/i],
  ['跟注站', /跟注站|call station|喜欢跟|一直跟|老是跟/i]
]

const MONEY_TOKEN = '[+-]?(?:\\d+(?:\\.\\d+)?(?:\\s*[万千][一二两三四五六七八九十百千万\\d]*)?|[一二两三四五六七八九十百千万]+)'

function normalizeText(text) {
  return String(text || '')
    .replace(/[，。；：！？]/g, match => ({
      '，': ',',
      '。': '.',
      '；': ';',
      '：': ':',
      '！': '!',
      '？': '?'
    })[match] || match)
    .replace(/\s+/g, ' ')
    .trim()
}

function readNumber(value) {
  const text = normalizeMoneyText(value).replace(/,/g, '')
  const match = text.match(/-?\d+(?:\.\d+)?/)
  return match ? match[0] : ''
}

function pickPlayerCount(text) {
  const source = String(text || '')
  const remaining = source.match(/(?:\u5269|\u8fd8\u5269|\u73b0\u5728|\u5f53\u65f6)\s*([2-9]|10)\s*(?:\u4e2a)?\s*\u4eba/)
  if (remaining) return Number(remaining[1]) || 8
  const direct = source.match(/(?:^|[^\d])([2-9]|10)\s*(?:\u4eba\u684c|max|handed|\u4eba\u5c40)/i)
  if (direct) return Number(direct[1]) || 8
  return 8
}

function chineseDigit(value) {
  return {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9
  }[value]
}

function parseUnderTenThousand(value) {
  const source = String(value || '')
  if (/^\d+$/.test(source)) return Number(source)
  let total = 0
  let current = 0
  const units = { 千: 1000, 百: 100, 十: 10 }
  for (let i = 0; i < source.length; i += 1) {
    const char = source.charAt(i)
    if (Object.prototype.hasOwnProperty.call(units, char)) {
      total += (current || 1) * units[char]
      current = 0
    } else {
      const digit = chineseDigit(char)
      if (digit != null) current = digit
    }
  }
  return total + current
}

function parseChineseMoney(value) {
  const source = String(value || '').trim()
  if (!source) return ''
  const normalized = source
    .replace(/点/g, '.')
    .replace(/块|元|刀|筹码/g, '')
  if (/^\d+(?:\.\d+)?$/.test(normalized)) return String(Number(normalized))
  const wanIndex = normalized.indexOf('万')
  if (wanIndex > -1) {
    const before = normalized.slice(0, wanIndex) || '一'
    const after = normalized.slice(wanIndex + 1)
    const base = parseUnderTenThousand(before) * 10000
    if (!after) return String(base)
    if (/^\d+$/.test(after)) {
      return String(base + (after.length <= 2 ? Number(after) * 1000 : Number(after)))
    }
    if (/^[一二两三四五六七八九]$/.test(after)) {
      return String(base + parseUnderTenThousand(after) * 1000)
    }
    return String(base + parseUnderTenThousand(after))
  }
  const qianIndex = normalized.indexOf('千')
  if (qianIndex > -1) {
    const before = normalized.slice(0, qianIndex) || '一'
    const after = normalized.slice(qianIndex + 1)
    return String(parseUnderTenThousand(before) * 1000 + parseUnderTenThousand(after))
  }
  const parsed = parseUnderTenThousand(normalized)
  return parsed ? String(parsed) : ''
}

function normalizeMoneyText(value) {
  return String(value || '')
    .replace(/([+-]?\d+(?:\.\d+)?)\s*万([一二两三四五六七八九十百千万\d]*)/g, function (_, num, tail) {
      const base = Number(num) * 10000
      if (!tail) return String(base)
      const extra = /^\d+$/.test(tail)
        ? (tail.length <= 2 ? Number(tail) * 1000 : Number(tail))
        : Number(parseChineseMoney(tail)) || 0
      return String(base + extra)
    })
    .replace(/([+-]?\d+(?:\.\d+)?)\s*千/g, function (_, num) {
      return String(Number(num) * 1000)
    })
    .replace(/[一二两三四五六七八九十百千万]+/g, function (match) {
      return parseChineseMoney(match) || match
    })
}

function cleanCardText(value) {
  return String(value || '')
    .replace(/红桃|红心|heart/ig, 'h')
    .replace(/黑桃|spade/ig, 's')
    .replace(/方块|方片|diamond/ig, 'd')
    .replace(/梅花|草花|club/ig, 'c')
    .replace(/十/g, 'T')
    .replace(/\s+/g, '')
}

function cleanBoardRankText(value) {
  return String(value || '')
    .replace(/10/g, 'T')
    .replace(/十/g, 'T')
    .replace(/勾|钩|杰|J/g, 'J')
    .replace(/圈|Q/g, 'Q')
    .replace(/凯|K/g, 'K')
    .replace(/尖|A/g, 'A')
    .replace(/二/g, '2')
    .replace(/三/g, '3')
    .replace(/四/g, '4')
    .replace(/五/g, '5')
    .replace(/六/g, '6')
    .replace(/七/g, '7')
    .replace(/八/g, '8')
    .replace(/九/g, '9')
    .toUpperCase()
}

function normalizeCards(value, limit) {
  const text = cleanCardText(value)
  const cards = text.match(/([2-9TJQKA])([shdc])/ig) || []
  return cards
    .slice(0, limit)
    .map(item => item.charAt(0).toUpperCase() + item.charAt(1).toLowerCase())
    .join('')
}

function inferBoardWithoutSuits(value, limit) {
  const text = cleanBoardRankText(value)
  const direct = text.match(/(?:发|出|牌面|是)\s*([2-9TJQKA]{1,3})/)
  const ranks = direct
    ? direct[1].match(/[2-9TJQKA]/g) || []
    : text.match(/[2-9TJQKA]/g) || []
  const suit = /黑桃|spade/i.test(value)
    ? 's'
    : /红桃|红心|heart/i.test(value)
      ? 'h'
      : /方块|方片|diamond/i.test(value)
        ? 'd'
        : /梅花|草花|club/i.test(value)
          ? 'c'
          : ''
  if (suit) {
    return ranks.slice(0, limit).map(function (rank) {
      return rank + suit
    }).join('')
  }
  return assignGeneratedSuits(ranks, limit)
}

function inferBoardText(value, limit) {
  const text = cleanBoardRankText(value)
  const direct = text.match(/(?:发|出|牌面|是)\s*([2-9TJQKA]{1,5})/)
  const ranks = direct
    ? direct[1].match(/[2-9TJQKA]/g) || []
    : text.match(/[2-9TJQKA]/g) || []
  return ranks.slice(0, limit).join('')
}

function assignGeneratedSuits(ranks, limit, usedCards) {
  const suits = ['s', 'h', 'd', 'c']
  const used = Object.assign({}, usedCards || {})
  return (Array.isArray(ranks) ? ranks : [])
    .slice(0, limit)
    .map(function (rank, index) {
      for (let offset = 0; offset < suits.length; offset += 1) {
        const suit = suits[(index + offset) % suits.length]
        const token = rank + suit
        if (!used[token]) {
          used[token] = true
          return token
        }
      }
      return rank + suits[index % suits.length]
    })
    .join('')
}

function matchFirst(text, patterns) {
  for (let i = 0; i < patterns.length; i += 1) {
    const match = text.match(patterns[i])
    if (match) return match
  }
  return null
}

function extractSegment(raw, startWords, endWords) {
  const starts = startWords.join('|')
  if (!endWords || !endWords.length) {
    const tailMatch = raw.match(new RegExp('(?:' + starts + ')([\\s\\S]*)$', 'i'))
    return tailMatch ? tailMatch[1].trim() : ''
  }
  const ends = endWords.join('|')
  const match = raw.match(new RegExp('(?:' + starts + ')([\\s\\S]*?)(?=' + ends + '|$)', 'i'))
  return match ? match[1].trim() : ''
}

function pickHeroPosition(raw) {
  const heroPattern = /我(?:在|是|坐在)\s*([^,.;，。]{0,24})/ig
  let heroPositionMatch = heroPattern.exec(raw)
  while (heroPositionMatch) {
    const heroPositionText = heroPositionMatch ? heroPositionMatch[1] : ''
    if (heroPositionText) {
      for (let i = 0; i < POSITION_ALIASES.length; i += 1) {
        if (POSITION_ALIASES[i][1].test(heroPositionText)) return POSITION_ALIASES[i][0]
      }
    }
    heroPositionMatch = heroPattern.exec(raw)
  }
  for (let i = 0; i < POSITION_ALIASES.length; i += 1) {
    if (POSITION_ALIASES[i][1].test(raw)) return POSITION_ALIASES[i][0]
  }
  return ''
}

function pickOpponentType(raw) {
  for (let i = 0; i < OPPONENT_ALIASES.length; i += 1) {
    if (OPPONENT_ALIASES[i][1].test(raw)) return OPPONENT_ALIASES[i][0]
  }
  return ''
}

function pickVillainPosition(raw) {
  const opponentPositionMatch = raw.match(/(?:对手|他|那个人|玩家|老板|Jason|jason|button|BTN|SB|BB|UTG|HJ|CO|LJ)(?:在|是|坐在)?\s*([^,.;，。]{0,18})/i)
  const source = opponentPositionMatch ? opponentPositionMatch[0] + opponentPositionMatch[1] : raw
  for (let i = 0; i < POSITION_ALIASES.length; i += 1) {
    if (POSITION_ALIASES[i][1].test(source)) {
      const position = POSITION_ALIASES[i][0]
      const heroPosition = pickHeroPosition(raw)
      if (position !== heroPosition || /button|BTN|对手|他|玩家|老板|Jason/i.test(source)) return position
    }
  }
  return ''
}

function pickProfit(raw) {
  const lose = matchFirst(raw, [
    new RegExp('(?:输了|输掉|亏了|亏损|本手输)\\s*(' + MONEY_TOKEN + ')', 'i'),
    new RegExp('(?:-|负)\\s*(' + MONEY_TOKEN + ')')
  ])
  if (lose) return '-' + readNumber(lose[1])

  const win = matchFirst(raw, [
    new RegExp('(?:赢了|赢到|盈利|赚了|本手赢|赢)\\s*\\+?\\s*(' + MONEY_TOKEN + ')', 'i'),
    new RegExp('\\+\\s*(' + MONEY_TOKEN + ')')
  ])
  if (win) return readNumber(win[1])
  return ''
}

function pickPot(raw) {
  const explicit = matchFirst(raw, [
    new RegExp('(?:底池|池子|pot)\\s*(?:大概|大约|是|有|到|:)?\\s*(' + MONEY_TOKEN + ')', 'i'),
    new RegExp('(' + MONEY_TOKEN + ')\\s*(?:的)?\\s*(?:pot|底池|池子)', 'i'),
    new RegExp('(?:翻牌前|翻前|牌前|preflop)[^,.;，。]{0,24}(?:加到|raise到|3bet到|4bet到|开到)\\s*(' + MONEY_TOKEN + ')', 'i')
  ])
  if (explicit) return readNumber(explicit[1])

  const bet = matchFirst(raw, [
    new RegExp('(?:bet|cbet|cb|下注|打了|我打|他打)[^,.;，。]{0,20}(?:1\\/\\d+|三分之一|四分之一|二分之一|半pot|半池|半个pot)[^0-9一二两三四五六七八九十百千万]{0,12}(' + MONEY_TOKEN + ')', 'i'),
    new RegExp('(?:bet|下注|打了|我打|他打|加到|raise到|3bet到|4bet到|开到)\\s*(?:了)?(?:个)?(?:半pot|半池|半个pot)?[^0-9一二两三四五六七八九十百千万]{0,12}(' + MONEY_TOKEN + ')', 'i')
  ])
  return bet ? readNumber(bet[1]) : ''
}

function pickEffectiveStack(raw) {
  const match = matchFirst(raw, [
    new RegExp('(?:有效筹码|有效码|有效|后手|后手码|effective)\\s*(?:大概|大约|是|有|:)?\\s*(' + MONEY_TOKEN + ')', 'i'),
    new RegExp('(' + MONEY_TOKEN + ')\\s*(?:有效|后手)')
  ])
  return match ? readNumber(match[1]) : ''
}

function pickStreetAction(raw, street) {
  const nextStreet = {
    preflop: STREET_ALIASES.flop,
    flop: STREET_ALIASES.turn,
    turn: STREET_ALIASES.river,
    river: []
  }[street] || []
  const segment = extractSegment(raw, STREET_ALIASES[street], nextStreet)
  if (!segment && street === 'preflop') {
    const flopMatch = raw.match(new RegExp('([\\s\\S]*?)(?=' + STREET_ALIASES.flop.join('|') + '|$)', 'i'))
    return flopMatch ? flopMatch[1].trim() : ''
  }
  return segment || ''
}

function extractActionAmounts(segment) {
  const source = normalizeMoneyText(segment)
    .replace(/\d+\s*分之\s*\d+/g, '')
    .replace(/\d+\s*\/\s*\d+/g, '')
    .replace(/1个/g, '个')
  const actionPattern = /(?:3B|4B|5B|3bet|4bet|open|raise|bet|cbet|cb|下注|打了|我打|他打|加到|开到|四逼|三逼|4逼|3逼)\s*(?:了)?(?:到)?(?:一个|个)?[^0-9]{0,10}([0-9]\d*(?:\.\d+)?)/ig
  const callPattern = /(?:call|靠|跟|跟注|我call|他call)\s*(?:了|一下|住|注)?\s*([0-9]\d*(?:\.\d+)?)/ig
  const amounts = []
  let match = actionPattern.exec(source)
  while (match) {
    amounts.push(Number(readNumber(match[1])) || 0)
    match = actionPattern.exec(source)
  }
  match = callPattern.exec(source)
  while (match) {
    amounts.push(Number(readNumber(match[1])) || 0)
    match = callPattern.exec(source)
  }
  return amounts.filter(Boolean)
}

function estimateStreetPot(segment, previousPot) {
  const source = normalizeMoneyText(segment)
    .replace(/\d+\s*分之\s*\d+/g, '')
    .replace(/\d+\s*\/\s*\d+/g, '')
    .replace(/1个/g, '个')
  const actionAmounts = extractActionAmounts(source)
  let pot = Number(previousPot) || 0
  actionAmounts.forEach(amount => {
    pot += amount
  })

  const raisePattern = /(?:3B|4B|5B|3bet|4bet|open|raise|加到|开到|四逼|三逼|4逼|3逼)\s*(?:了)?(?:到)?[^0-9]{0,8}([0-9]\d*(?:\.\d+)?)/ig
  let raiseMatch = raisePattern.exec(source)
  while (raiseMatch) {
    const amount = Number(readNumber(raiseMatch[1])) || 0
    const after = source.slice(raisePattern.lastIndex, raisePattern.lastIndex + 24)
    if (amount && /(?:call|靠|跟|跟注)/i.test(after)) {
      pot += amount
    }
    raiseMatch = raisePattern.exec(source)
  }

  const betPattern = /(?:bet|cbet|cb|下注|打了|我打|他打)\s*(?:了)?(?:一个|个)?[^0-9]{0,10}([0-9]\d*(?:\.\d+)?)/ig
  let betMatch = betPattern.exec(source)
  while (betMatch) {
    const amount = Number(readNumber(betMatch[1])) || 0
    const after = source.slice(betPattern.lastIndex, betPattern.lastIndex + 24)
    if (amount && /(?:call|靠|跟|跟注)/i.test(after)) {
      pot += amount
    }
    betMatch = betPattern.exec(source)
  }

  return pot ? String(pot) : ''
}

function hasStreetCue(raw, street) {
  const aliases = STREET_ALIASES[street] || []
  return aliases.some(function (alias) {
    return new RegExp(alias, 'i').test(raw)
  })
}

function getTerminalPot(actionLine, startPot) {
  if (!actionLine) return startPot ? String(startPot) : ''
  return estimateStreetPot(actionLine, startPot) || (startPot ? String(startPot) : '')
}

function buildStreetInputs(raw) {
  const preflopAction = pickStreetAction(raw, 'preflop')
  const flopAction = pickStreetAction(raw, 'flop')
  const turnAction = pickStreetAction(raw, 'turn')
  const riverAction = pickStreetAction(raw, 'river')

  const flopReached = Boolean(flopAction || hasStreetCue(raw, 'flop'))
  const turnReached = Boolean(turnAction || hasStreetCue(raw, 'turn'))
  const riverReached = Boolean(riverAction || hasStreetCue(raw, 'river'))

  const preflopTerminalPot = getTerminalPot(preflopAction, 0)
  const flopStartPot = flopReached ? preflopTerminalPot : ''
  const flopTerminalPot = flopReached ? getTerminalPot(flopAction, Number(flopStartPot) || 0) : ''
  const turnStartPot = turnReached ? (flopTerminalPot || flopStartPot) : ''
  const turnTerminalPot = turnReached ? getTerminalPot(turnAction, Number(turnStartPot) || 0) : ''
  const riverStartPot = riverReached ? (turnTerminalPot || turnStartPot) : ''
  const riverTerminalPot = riverReached ? getTerminalPot(riverAction, Number(riverStartPot) || 0) : ''

  return {
    preflop: { actionLine: preflopAction, pot: preflopTerminalPot },
    flop: { actionLine: flopAction, pot: flopReached ? (turnReached ? flopStartPot : flopTerminalPot) : '' },
    turn: { actionLine: turnAction, pot: turnReached ? (riverReached ? turnStartPot : turnTerminalPot) : '' },
    river: { actionLine: riverAction, pot: riverReached ? riverTerminalPot : '' }
  }
}

function pickBoard(raw) {
  const flopSegment = extractSegment(raw, STREET_ALIASES.flop, STREET_ALIASES.turn.concat(STREET_ALIASES.river))
  const turnSegment = extractSegment(raw, STREET_ALIASES.turn, STREET_ALIASES.river)
  const riverSegment = extractSegment(raw, STREET_ALIASES.river, [])

  const usedCards = {}
  const flopCards = normalizeCards(flopSegment, 3) || inferBoardWithoutSuits(flopSegment, 3)
  ;(flopCards.match(/([2-9TJQKA][shdc])/ig) || []).forEach(function (card) {
    usedCards[card.charAt(0).toUpperCase() + card.charAt(1).toLowerCase()] = true
  })
  const turnCards = normalizeCards(turnSegment, 1) || assignGeneratedSuits(inferBoardText(turnSegment, 1).split(''), 1, usedCards)
  ;(turnCards.match(/([2-9TJQKA][shdc])/ig) || []).forEach(function (card) {
    usedCards[card.charAt(0).toUpperCase() + card.charAt(1).toLowerCase()] = true
  })
  const riverCards = normalizeCards(riverSegment, 1) || assignGeneratedSuits(inferBoardText(riverSegment, 1).split(''), 1, usedCards)

  return {
    flop: flopCards,
    turn: turnCards,
    river: riverCards
  }
}

function pickBoardText(raw) {
  const flopSegment = extractSegment(raw, STREET_ALIASES.flop, STREET_ALIASES.turn.concat(STREET_ALIASES.river))
  const turnSegment = extractSegment(raw, STREET_ALIASES.turn, STREET_ALIASES.river)
  const riverSegment = extractSegment(raw, STREET_ALIASES.river, [])
  return {
    flop: inferBoardText(flopSegment, 3),
    turn: inferBoardText(turnSegment, 1),
    river: inferBoardText(riverSegment, 1)
  }
}

function parseVoiceText(text) {
  const raw = normalizeText(text)
  const result = {
    playedDate: '',
    playerCount: pickPlayerCount(raw),
    stakeLevel: '',
    heroPosition: '',
    heroCardsInput: '',
    effectiveStack: '',
    potSize: '',
    currentProfit: '',
    opponentType: '',
    opponentName: '',
    villainPosition: '',
    board: {
      flop: '',
      turn: '',
      river: ''
    },
    boardText: {
      flop: '',
      turn: '',
      river: ''
    },
    streetInputs: {
      preflop: { actionLine: '', pot: '' },
      flop: { actionLine: '', pot: '' },
      turn: { actionLine: '', pot: '' },
      river: { actionLine: '', pot: '' }
    },
    streetSummary: '',
    showdown: '',
    mindJourney: raw,
    tags: [],
    missingFields: [],
    followUpQuestions: [],
    noteSummary: raw
  }

  const dateMatch = raw.match(/(20\d{2})[/-](\d{1,2})[/-](\d{1,2})/)
  if (dateMatch) {
    result.playedDate = [
      dateMatch[1],
      String(dateMatch[2]).padStart(2, '0'),
      String(dateMatch[3]).padStart(2, '0')
    ].join('-')
  }

  const levelMatch = matchFirst(raw, [
    /(?:盲注|级别|前打|打|玩|是)?\s*([1-9]\d{0,4})\s*\/\s*([1-9]\d{0,5})/,
    /([1-9]\d{0,4})\s*[-比]\s*([1-9]\d{0,5})/
  ])
  if (levelMatch) result.stakeLevel = levelMatch[1] + '/' + levelMatch[2]

  result.heroPosition = pickHeroPosition(raw)
  result.villainPosition = pickVillainPosition(raw)
  result.opponentType = pickOpponentType(raw)
  result.effectiveStack = pickEffectiveStack(raw)
  result.potSize = pickPot(raw)
  result.currentProfit = pickProfit(raw)

  const heroCardsMatch = matchFirst(raw, [
    /(?:拿到|拿|手牌|hero手牌|我是)\s*([2-9TJQKA][shdc红黑方梅桃心块片花草]{1,2}\s*[2-9TJQKA][shdc红黑方梅桃心块片花草]{1,2})/i,
    /\b([2-9TJQKA][shdc][2-9TJQKA][shdc])\b/i
  ])
  if (heroCardsMatch) result.heroCardsInput = normalizeCards(heroCardsMatch[1], 2)

  result.board = pickBoard(raw)
  result.boardText = pickBoardText(raw)
  result.streetInputs = buildStreetInputs(raw)
  const estimatedPot = result.streetInputs.river.pot || result.streetInputs.turn.pot || result.streetInputs.flop.pot || result.streetInputs.preflop.pot || ''

  if (result.potSize) {
    if (result.streetInputs.flop.actionLine && !result.streetInputs.flop.pot) result.streetInputs.flop.pot = result.potSize
    else if (!result.streetInputs.preflop.pot) result.streetInputs.preflop.pot = result.potSize
    if (estimatedPot && (!/(?:底池|池子|pot)/i.test(raw) || Number(result.potSize) < Number(estimatedPot))) {
      result.potSize = estimatedPot
    }
  } else {
    result.potSize = estimatedPot
  }

  const villainNameMatch = raw.match(/(?:对手|villain|老板|玩家)\s*[: ]?\s*([A-Za-z0-9\u4e00-\u9fa5_-]{2,12})/i)
  if (villainNameMatch) result.opponentName = villainNameMatch[1]

  const showdownMatch = raw.match(/(?:showdown|摊牌|亮牌|对手亮|对手是)\s*[: ]?\s*([^,.;]+)/i)
  if (showdownMatch) result.showdown = showdownMatch[1].trim()

  result.streetSummary = raw.slice(0, 180)
  if (/bluff|诈唬|偷鸡/i.test(raw)) result.tags.push('诈唬')
  if (/薄价值|value|价值/i.test(raw)) result.tags.push('价值下注')
  if (/多人池|6人池|六人池|三个人|多人/i.test(raw)) result.tags.push('多人池')

  if (!result.heroCardsInput) result.missingFields.push('Hero 手牌')
  if (!result.currentProfit) result.missingFields.push('本手输赢')
  if (!result.board.flop) result.missingFields.push('翻牌')
  if (result.missingFields.length) {
    result.followUpQuestions = result.missingFields.map(function (field) {
      return '请补充' + field
    })
  }

  return result
}

module.exports = {
  parseVoiceText
}
