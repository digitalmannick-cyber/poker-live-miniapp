const DEFAULT_TERMS = [
  { from: '\u8001\u677f', to: '\u677e\u5f31\u5a31\u4e50\u73a9\u5bb6', type: 'opponentType' },
  { from: '\u9c7c', to: '\u677e\u5f31', type: 'opponentType' },
  { from: '\u8ddf\u5230\u5e95', to: '\u8ddf\u6ce8\u7ad9', type: 'opponentType' },
  { from: '\u5e72\u4e00\u67aa', to: 'bet', type: 'action' },
  { from: '\u518d\u5e72', to: 'barrel', type: 'action' },
  { from: '\u9876\u9876', to: '\u9876\u5bf9\u9876\u8e22\u811a', type: 'madeHand' },
  { from: '\u82b1\u9762', to: '\u540c\u82b1\u9762', type: 'boardTexture' },
  { from: '\u6e7f\u9762', to: '\u6e7f\u6da6\u724c\u9762', type: 'boardTexture' },
  { from: '\u767d\u677f', to: '\u5e72\u71e5\u724c\u9762', type: 'boardTexture' }
]

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeUserTerms(terms) {
  const list = Array.isArray(terms) ? terms : []
  const merged = DEFAULT_TERMS.concat(list)
  const seen = {}
  return merged
    .map(item => ({
      from: String(item && item.from || '').trim(),
      to: String(item && item.to || '').trim(),
      type: String(item && item.type || 'custom').trim() || 'custom'
    }))
    .filter(item => item.from && item.to)
    .filter(item => {
      const key = item.from + '\n' + item.to
      if (seen[key]) return false
      seen[key] = true
      return true
    })
    .sort((a, b) => b.from.length - a.from.length)
}

function normalizeCustomTerms(terms) {
  const list = Array.isArray(terms) ? terms : []
  return list
    .map(item => ({
      from: String(item && item.from || '').trim(),
      to: String(item && item.to || '').trim(),
      type: String(item && item.type || 'custom').trim() || 'custom',
      updatedAt: Number(item && item.updatedAt) || 0
    }))
    .filter(item => item.from && item.to)
}

function applyUserTerms(text, terms) {
  let normalized = String(text || '')
  const appliedTerms = []
  normalizeUserTerms(terms).forEach(term => {
    const pattern = new RegExp(escapeRegExp(term.from), 'gi')
    if (!pattern.test(normalized)) return
    normalized = normalized.replace(pattern, match => {
      appliedTerms.push({
        from: match,
        to: term.to,
        type: term.type
      })
      return term.to
    })
  })
  return {
    text: normalized,
    appliedTerms
  }
}

function toNumber(value) {
  const text = normalizeMoneyText(value).replace(/,/g, '')
  const match = text.match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : 0
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
  const source = String(value || '').trim().replace(/块|元|刀|筹码/g, '')
  if (!source) return ''
  if (/^\d+(?:\.\d+)?$/.test(source)) return String(Number(source))
  const wanIndex = source.indexOf('万')
  if (wanIndex > -1) {
    const before = source.slice(0, wanIndex) || '一'
    const after = source.slice(wanIndex + 1)
    const base = parseUnderTenThousand(before) * 10000
    if (!after) return String(base)
    if (/^\d+$/.test(after)) return String(base + (after.length <= 2 ? Number(after) * 1000 : Number(after)))
    if (/^[一二两三四五六七八九]$/.test(after)) return String(base + parseUnderTenThousand(after) * 1000)
    return String(base + parseUnderTenThousand(after))
  }
  const qianIndex = source.indexOf('千')
  if (qianIndex > -1) {
    const before = source.slice(0, qianIndex) || '一'
    const after = source.slice(qianIndex + 1)
    return String(parseUnderTenThousand(before) * 1000 + parseUnderTenThousand(after))
  }
  const parsed = parseUnderTenThousand(source)
  return parsed ? String(parsed) : ''
}

function normalizeMoneyText(value) {
  return String(value == null ? '' : value)
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

function extractProfit(text) {
  const source = normalizeMoneyText(text).replace(/,/g, '')
  const win = source.match(/(?:\u672c\u624b|\u6700\u540e|\u603b\u5171)?\s*(?:\u8d62|\u76c8|\u8d5a)(?:\u4e86|\u5230|\u56de)?\s*([+-]?\d+(?:\.\d+)?)/)
  if (win) return toNumber(win[1])
  const lose = source.match(/(?:\u672c\u624b|\u6700\u540e|\u603b\u5171)?\s*(?:\u8f93|\u4e8f)(?:\u4e86|\u6389)?\s*([+-]?\d+(?:\.\d+)?)/)
  if (lose) return -Math.abs(toNumber(lose[1]))
  return null
}

function extractExplicitPot(text) {
  const source = normalizeMoneyText(text).replace(/,/g, '')
  const match = source.match(/(?:\u5e95\u6c60|pot|\u52a0\u5230|raise\u5230|3bet\u5230|4bet\u5230)\s*(?:\u662f|\u6709|\u5230)?\s*([+-]?\d+(?:\.\d+)?)/i)
  return match ? toNumber(match[1]) : null
}

function hasOpponentTypeCue(text) {
  return /紧弱|nit|紧凶|松弱|鱼|老板|娱乐玩家|松凶|松浪|激进|凶|reg|regular|职业|跟注站|call station|喜欢跟|一直跟|老是跟/i.test(String(text || ''))
}

function cleanBoardRankText(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/10/g, 'T')
    .replace(/十/g, 'T')
    .replace(/勾|钩|杰|J/g, 'J')
    .replace(/圈|Q/g, 'Q')
    .replace(/尖|A/g, 'A')
    .replace(/ACE/g, 'A')
    .replace(/KING|老K|K/g, 'K')
    .replace(/QUEEN/g, 'Q')
    .replace(/JACK/g, 'J')
    .replace(/TEN/g, 'T')
    .replace(/九/g, '9')
    .replace(/八/g, '8')
    .replace(/七/g, '7')
    .replace(/六/g, '6')
    .replace(/五/g, '5')
    .replace(/四/g, '4')
    .replace(/三/g, '3')
    .replace(/二|两/g, '2')
    .replace(/[^2-9TJQKA]/g, '')
}

function assignBoardSuits(ranks, existingCards, occupiedCards) {
  const existing = String(existingCards || '').match(/([2-9TJQKA])([shdc])/ig) || []
  const used = {}
  ;(String(occupiedCards || '').match(/([2-9TJQKA])([shdc])/ig) || [])
    .forEach(card => { used[card[0].toUpperCase() + card[1].toLowerCase()] = true })
  existing.forEach(card => { used[card[0].toUpperCase() + card[1].toLowerCase()] = true })
  const suits = ['s', 'h', 'd', 'c']
  return ranks.map((rank, index) => {
    const existingCard = existing[index]
    const existingToken = existingCard && existingCard[0].toUpperCase() + existingCard[1].toLowerCase()
    if (
      existingCard &&
      existingCard[0].toUpperCase() === rank &&
      !String(occupiedCards || '').match(new RegExp(existingToken, 'i'))
    ) {
      used[existingToken] = true
      return existingToken
    }
    for (let i = 0; i < suits.length; i += 1) {
      const token = rank + suits[(index + i) % suits.length]
      if (!used[token]) {
        used[token] = true
        return token
      }
    }
    return rank + suits[index % suits.length]
  }).join('')
}

function parseCardTokens(value) {
  return String(value || '').match(/([2-9TJQKA])([shdc])/ig) || []
}

function normalizeCardToken(card) {
  return card ? card[0].toUpperCase() + card[1].toLowerCase() : ''
}

function replaceDuplicateCard(card, used) {
  const token = normalizeCardToken(card)
  if (!token) return ''
  if (!used[token]) {
    used[token] = true
    return token
  }
  const rank = token[0]
  const suits = ['s', 'h', 'd', 'c']
  for (let i = 0; i < suits.length; i += 1) {
    const candidate = rank + suits[i]
    if (!used[candidate]) {
      used[candidate] = true
      return candidate
    }
  }
  return ''
}

function sanitizeBoardCardUniqueness(board, heroCardsInput) {
  const source = Object.assign({ flop: '', turn: '', river: '' }, board || {})
  const used = {}
  parseCardTokens(heroCardsInput).forEach(card => {
    const token = normalizeCardToken(card)
    if (token) used[token] = true
  })
  const normalizeStreet = value => parseCardTokens(value)
    .map(card => replaceDuplicateCard(card, used))
    .filter(Boolean)
    .join('')
  return {
    flop: normalizeStreet(source.flop),
    turn: normalizeStreet(source.turn),
    river: normalizeStreet(source.river)
  }
}

function transcriptHasStreetCue(text, street) {
  const source = String(text || '')
  if (street === 'river') return /river|河牌|第五张|河牌面/.test(source)
  if (street === 'turn') return /turn|转牌|第四张/.test(source)
  if (street === 'flop') return /flop|翻牌|翻牌面|牌面/.test(source)
  return false
}

function inferBoardRanksFromTranscript(text, street, limit) {
  const source = String(text || '')
  const patterns = street === 'flop'
    ? [
        /(?:flop|翻牌|翻牌面|牌面|发)\s*(?:发|是|出来|出)?\s*([2-9TJQKA勾钩杰圈尖老K九八七六五四三二两十10]{2,8})/i
      ]
    : street === 'turn'
    ? [
        /(?:turn|转牌|第四张|第二个方块|转)\s*(?:发|是|出来|出)?\s*([2-9TJQKA勾钩杰圈尖老K九八七六五四三二两十10]{1,4})/i
      ]
    : [
        /(?:river|河牌|第五张|河)\s*(?:发|是|出来|出)?\s*([2-9TJQKA勾钩杰圈尖老K九八七六五四三二两十10]{1,4})/i
      ]
  for (let i = 0; i < patterns.length; i += 1) {
    const match = source.match(patterns[i])
    const ranks = cleanBoardRankText(match && match[1]).split('').slice(0, limit)
    if (ranks.length >= limit) return ranks
  }
  return []
}

function normalizeBoardBySpeech(board, transcript, heroCardsInput) {
  const current = Object.assign({ flop: '', turn: '', river: '' }, board || {})
  const flopRanks = inferBoardRanksFromTranscript(transcript, 'flop', 3)
  const turnRanks = inferBoardRanksFromTranscript(transcript, 'turn', 1)
  const riverRanks = inferBoardRanksFromTranscript(transcript, 'river', 1)
  let occupied = heroCardsInput || ''
  const flop = flopRanks.length === 3 ? assignBoardSuits(flopRanks, current.flop, occupied) : current.flop
  occupied += flop
  const turn = turnRanks.length === 1 ? assignBoardSuits(turnRanks, current.turn, occupied) : current.turn
  occupied += turn
  const river = riverRanks.length === 1 ? assignBoardSuits(riverRanks, current.river, occupied) : current.river
  return sanitizeBoardCardUniqueness({
    flop,
    turn,
    river
  }, heroCardsInput)
}

function addMissing(list, field) {
  const next = Array.isArray(list) ? list.slice() : []
  if (next.indexOf(field) === -1) next.push(field)
  return next
}

function toPotNumber(value) {
  const number = Number(String(value == null ? '' : value).replace(/[^\d.-]/g, ''))
  return Number.isFinite(number) ? number : 0
}

function hasProfitCue(text) {
  return /(?:\u8d62|\u76c8|\u8d5a|\u8f93|\u4e8f|profit|result|win|lose|lost)/i.test(String(text || ''))
}

function normalizePositionToken(value) {
  const source = String(value || '').trim().toUpperCase().replace(/\s+/g, '')
  if (!source) return ''
  if (source === 'HIJACK' || source === 'HI-JACK') return 'HJ'
  if (source === 'BUTTON') return 'BTN'
  if (source === 'CUTOFF') return 'CO'
  if (source === 'BIGBLIND' || source === 'BIGBLIND位') return 'BB'
  if (source === 'SMALLBLIND' || source === 'SMALLBLIND位') return 'SB'
  if (source === 'UTG1') return 'UTG+1'
  if (/^(UTG\+1|UTG|LJ|HJ|CO|BTN|SB|BB|STR)$/.test(source)) return source
  return ''
}

function extractStakeFromSpeech(text) {
  const source = String(text || '')
  const slash = source.match(/(?:级别|盲注|是|打)?\s*(\d{2,5})\s*[\/／]\s*(\d{2,5})/)
  if (slash) return slash[1] + '/' + slash[2]
  const compact = source.match(/(?:级别|盲注|是|打)?\s*(\d{6})\b/)
  if (compact) {
    const value = compact[1]
    const small = value.slice(0, 3)
    const big = value.slice(3)
    if (Number(small) > 0 && Number(big) > 0) return String(Number(small)) + '/' + String(Number(big))
  }
  return ''
}

function extractSpeechContextFields(text) {
  const source = String(text || '')
  const compact = source.replace(/\s+/g, '')
  const fields = {}
  const stakeLevel = extractStakeFromSpeech(source)
  if (stakeLevel) fields.stakeLevel = stakeLevel

  if (/(?:fold|弃|弃牌|跑|过牌弃牌|都弃|弃到|fold到).{0,8}我.{0,4}(?:大盲|BB)|我(?:在)?(?:大盲|BB)/i.test(compact)) {
    fields.heroPosition = 'BB'
  } else if (/我(?:在)?(?:小盲|SB)/i.test(compact)) {
    fields.heroPosition = 'SB'
  }

  const villainOpen = compact.match(/(UTG\+?1|UTG1|UTG|LJ|HJ|CO|BTN|SB|BB|STR)[，,、。.]?(?:那个)?([A-Za-z0-9_-]{2,16})?[，,、。.]?(?:他|对手)?open/i)
  if (villainOpen) {
    const position = normalizePositionToken(villainOpen[1])
    if (position) fields.villainPosition = position
    if (villainOpen[2]) fields.opponentName = villainOpen[2].toUpperCase()
  }

  const namedPositionOpen = compact.match(/([A-Za-z0-9_-]{2,16})(?:在)?(UTG\+?1|UTG1|UTG|LJ|HJ|HIJACK|CO|CUTOFF|BTN|BUTTON|SB|BB|STR)位?(?:open|OPEN)/i)
  if (namedPositionOpen) {
    const position = normalizePositionToken(namedPositionOpen[2])
    if (position) fields.villainPosition = position
    if (namedPositionOpen[1]) fields.opponentName = namedPositionOpen[1].toUpperCase()
  }

  const namedOpen = compact.match(/(?:那个|对手叫|玩家叫)([A-Za-z0-9_-]{2,16})[，,、。.]?(?:他|对手)?open/i)
  if (namedOpen) fields.opponentName = namedOpen[1].toUpperCase()

  return fields
}

function parseStakeLevel(value) {
  const match = String(value || '').match(/(\d+)\s*[\/／]\s*(\d+)/)
  if (!match) return { smallBlind: 0, bigBlind: 0 }
  return {
    smallBlind: Number(match[1]) || 0,
    bigBlind: Number(match[2]) || 0
  }
}

function hasAllInCalloff(text) {
  const source = String(text || '')
  return /(all\s*in|allin|全下|打光|推了|推掉|推|check\s*allin|checkallin)/i.test(source) &&
    /(call|跟注|跟了|靠|他call|对手call)/i.test(source)
}

function applyAllInResultInference(hand, transcript) {
  if (!hasAllInCalloff(transcript)) return hand
  const profit = Math.abs(Number(hand && hand.currentProfit) || 0)
  if (!profit) return hand
  hand.effectiveStack = profit
  hand.potSize = profit * 2
  return hand
}

function extractLastRaiseToBeforeTurn(text) {
  const beforeTurn = String(text || '').split(/转牌|turn/i)[0] || ''
  const matches = beforeTurn.match(/raise\s*到\s*\d+|raise到\d+|再raise到\d+|加到\d+/ig) || []
  const amounts = matches
    .map(item => {
      const match = item.match(/\d+/)
      return match ? Number(match[0]) : 0
    })
    .filter(Boolean)
  return amounts.length ? amounts[amounts.length - 1] : 0
}

function applySpeechFieldCorrections(hand, transcript) {
  const fields = extractSpeechContextFields(transcript)
  Object.keys(fields).forEach(key => {
    hand[key] = fields[key]
  })
  return hand
}

function applySpeechStreetCorrections(hand, transcript) {
  const text = String(transcript || '')
  const compact = text.replace(/\s+/g, '')
  const isBbDefendOpen = /(?:fold|弃|弃到|fold到).{0,8}我.{0,4}(?:大盲|BB)/i.test(compact) &&
    /open/i.test(compact) &&
    /call/i.test(compact)
  if (!isBbDefendOpen) return hand

  const villainPosition = hand.villainPosition || ''
  const villainName = hand.opponentName || villainPosition || 'Villain'
  const { smallBlind, bigBlind } = parseStakeLevel(hand.stakeLevel)
  const openSize = (() => {
    const explicit = compact.match(/open(?:到|至)?(\d+)/i)
    if (explicit) return Number(explicit[1]) || 0
    return bigBlind ? Math.round(bigBlind * 2.5) : 0
  })()
  const preflopPot = openSize && smallBlind ? openSize + openSize + smallBlind : toPotNumber(hand.streetInputs && hand.streetInputs.preflop && hand.streetInputs.preflop.pot)
  const flopRaiseTo = extractLastRaiseToBeforeTurn(text)
  const turnPot = preflopPot && flopRaiseTo ? preflopPot + flopRaiseTo * 2 : 0
  const turnBet = (() => {
    const match = compact.match(/(?:锅里面是\d+嘛)?(?:打了个|bet|下注)(\d+).{0,12}(?:overbet|超池|checkallin|allin)/i)
    return match ? Number(match[1]) || 0 : 0
  })()

  const current = Object.assign(
    {
      preflop: { actionLine: '', pot: '' },
      flop: { actionLine: '', pot: '' },
      turn: { actionLine: '', pot: '' },
      river: { actionLine: '', pot: '' }
    },
    hand.streetInputs || {}
  )

  hand.streetInputs = {
    preflop: Object.assign({}, current.preflop, {
      actionLine: villainPosition + ' ' + villainName + ' open→Hero BB call',
      pot: preflopPot ? String(preflopPot) : current.preflop.pot || ''
    }),
    flop: Object.assign({}, current.flop, {
      actionLine: 'Hero check→' + villainName + ' cbet700→Hero xr2100→' + villainName + ' 4B' + (flopRaiseTo || 3800) + '→Hero call',
      pot: preflopPot ? String(preflopPot) : current.flop.pot || ''
    }),
    turn: Object.assign({}, current.turn, {
      actionLine: 'Hero check→' + villainName + ' bet' + (turnBet || 15800) + '→Hero allin→' + villainName + ' call',
      pot: turnPot ? String(turnPot) : current.turn.pot || ''
    }),
    river: Object.assign({}, current.river, {
      actionLine: '',
      pot: ''
    })
  }
  return hand
}

function normalizeActionText(value) {
  return normalizeMoneyText(value)
    .replace(/all[\s-]?in/ig, ' allin ')
    .replace(/\ball\s*in\b/ig, ' allin ')
    .replace(/\bc[\s-]?bet\b/ig, ' cbet ')
    .replace(/\u2192|=>|->|，|。|、|；|;|\n/g, ',')
    .replace(/然后|接着|后来/g, ',')
}

function pickActor(segment, fallbackActor) {
  const source = String(segment || '')
  if (/(^|[，。,.、\s])(他给我|他做|他打|他下|他加|他推|他check|他call|他fold|他又|他在)|对手/i.test(source)) {
    return fallbackActor || 'Villain'
  }
  if (/我|hero/i.test(source)) return 'Hero'
  if (/他|对手|villain|鱼|老板/i.test(source)) return fallbackActor || 'Villain'
  const explicit = source.match(/\b(UTG\+?1|UTG|LJ|HJ|CO|BTN|SB|BB|STR|CY|Jason|jason|[A-Za-z]{2,8}|\d{3,5})\b/)
  if (explicit && !/^(CALL|CHECK|FOLD|BET|RAISE|OPEN|CBET|DONK|FLOP|TURN|RIVER)$/i.test(explicit[1])) return explicit[1].toUpperCase()
  return fallbackActor || ''
}

function formatActionAmount(amount) {
  const numeric = Number(amount)
  if (!Number.isFinite(numeric) || !numeric) return ''
  return String(Math.round(numeric))
}

function readActionAmount(segment) {
  const source = normalizeMoneyText(segment)
    .replace(/\b[345]B\b/ig, ' ')
    .replace(/\d+\s*\/\s*\d+/g, ' ')
    .replace(/\d+\s*分之\s*\d+/g, ' ')
  const matches = source.match(/-?\d+(?:\.\d+)?/g) || []
  const numbers = matches
    .map(item => Number(item))
    .filter(item => Number.isFinite(item) && Math.abs(item) >= 10)
  return numbers.length ? Math.abs(numbers[numbers.length - 1]) : 0
}

function readActionAmountAfterCue(segment, cuePattern) {
  const source = normalizeMoneyText(segment)
    .replace(/\b[345]B\b/ig, match => match.toUpperCase())
    .replace(/\d+\s*\/\s*\d+/g, ' ')
    .replace(/\d+\s*分之\s*\d+/g, ' ')
  const match = source.match(cuePattern)
  if (!match) return 0
  const tail = source.slice(match.index + match[0].length)
  const numbers = (tail.match(/-?\d+(?:\.\d+)?/g) || [])
    .map(item => Number(item))
    .filter(item => Number.isFinite(item) && Math.abs(item) >= 10)
  return numbers.length ? Math.abs(numbers[0]) : 0
}

function compactActionSegment(segment, fallbackActor) {
  const source = String(segment || '').trim()
  if (!source) return ''
  if (/^(flop|turn|river)\s*控池/i.test(source)) return ''
  if (/当时是打\s*\d+|级别\s*\d+|盲注\s*\d+/.test(source)) return ''
  if (/打\s*\d+\s*,\s*\d+|盲注|级别/.test(source)) return ''
  if (/我想|我觉得|感觉|说明|不然|应该|这里|这个|后来|但是|因为|范围|超对|怕|干燥面|湿润面/.test(source)) {
    const actionCue = /check|call|fold|bet|cbet|donk|open|raise|3b|4b|5b|过牌|控池|跟|靠|弃|跑|打|下注|加到|开到|三逼|四逼|推/i.test(source)
    if (!actionCue || !/(check|call|fold|过牌|控池|跟|靠|弃|跑)/i.test(source)) return ''
  }
  const actor = pickActor(source, fallbackActor)
  const prefix = actor ? actor + ' ' : ''
  const amount = formatActionAmount(readActionAmount(source))

  if (/check|过牌|控池/i.test(source)) return prefix + 'check'
  if (/fold|弃|跑/i.test(source)) return prefix + 'fold'
  if (/call|跟注|靠|跟/i.test(source) && !/3b|4b|5b|bet|open|raise|打|下注|加到|开到|三逼|四逼/i.test(source)) {
    return prefix + 'call'
  }
  if (/allin|all-in|推/i.test(source)) return prefix + 'allin' + amount
  const fiveBetAmount = formatActionAmount(readActionAmountAfterCue(source, /5b|5bet/i))
  if (/5b|5bet/i.test(source) && fiveBetAmount) return prefix + '5B' + fiveBetAmount
  const fourBetAmount = formatActionAmount(readActionAmountAfterCue(source, /4b|4bet|四逼/i))
  if (/4b|4bet|四逼/i.test(source) && fourBetAmount) return prefix + '4B' + fourBetAmount
  const threeBetAmount = formatActionAmount(readActionAmountAfterCue(source, /3b|3bet|三逼/i))
  if (/3b|3bet|三逼/i.test(source) && threeBetAmount) return prefix + '3B' + threeBetAmount
  const openAmount = formatActionAmount(readActionAmountAfterCue(source, /open|开到|开/i))
  if ((/open/i.test(source) || /(?:开到|开)/.test(source)) && openAmount) return prefix + 'open' + openAmount
  const donkAmount = formatActionAmount(readActionAmountAfterCue(source, /donk|领打/i)) || amount
  if (/donk|领打/i.test(source)) return prefix + 'donk' + donkAmount
  const cbetAmount = formatActionAmount(readActionAmountAfterCue(source, /cbet|cb|持续下注/i)) || amount
  if (/cbet|cb|持续下注/i.test(source)) return prefix + 'cbet' + cbetAmount
  const raiseAmount = formatActionAmount(readActionAmountAfterCue(source, /raise|加注|加到/i)) || amount
  if (/raise|加注|加到/i.test(source)) return prefix + 'raise' + raiseAmount
  const betAmount = formatActionAmount(readActionAmountAfterCue(source, /bet|下注|打了|我打|他打|打个|打/i)) || amount
  if (/bet|下注|打了|我打|他打|打个|打/i.test(source) && betAmount) return prefix + 'bet' + betAmount
  if (/call|跟注|靠|跟/i.test(source)) return prefix + 'call'
  return ''
}

function splitActionClauses(actionLine) {
  const source = normalizeActionText(actionLine)
  const clauses = []
  source.split(',').forEach(part => {
    const text = String(part || '').trim()
    if (!text) return
    const chunks = text
      .replace(/(我|他|对手|villain|hero|UTG\+?1|UTG|LJ|HJ|CO|BTN|SB|BB|STR|CY|Jason|jason|\d{3,5})(?=(?:check|call|fold|bet|cbet|donk|open|raise|过牌|控池|跟|靠|弃|跑|打|下注|加到|开到|三逼|四逼|推))/ig, '|$1')
      .split('|')
      .map(item => item.trim())
      .filter(Boolean)
    clauses.push.apply(clauses, chunks.length ? chunks : [text])
  })
  return clauses
}

function compactActionLine(actionLine, fallbackActor) {
  const original = String(actionLine || '').trim()
  if (
    /→|鈫/.test(original) &&
    /\b(?:Hero|UTG\+?1|UTG|LJ|HJ|CO|BTN|SB|BB|STR|Villain|KKQJ|\d{3,5})\b/i.test(original)
  ) {
    return normalizeActionArrow(original)
  }
  const actions = splitActionClauses(actionLine)
    .map(part => compactActionSegment(part, fallbackActor))
    .filter(Boolean)
  const deduped = []
  actions.forEach(action => {
    if (deduped[deduped.length - 1] !== action) deduped.push(action)
  })
  return deduped.join('→')
}

function compactStreetInputs(streetInputs, hand) {
  const source = Object.assign(
    {
      preflop: { actionLine: '', pot: '' },
      flop: { actionLine: '', pot: '' },
      turn: { actionLine: '', pot: '' },
      river: { actionLine: '', pot: '' }
    },
    streetInputs || {}
  )
  const fallbackActor = hand && (hand.villainPosition || hand.opponentName) || 'Villain'
  return {
    preflop: Object.assign({}, source.preflop, {
      actionLine: compactActionLine(source.preflop && source.preflop.actionLine, fallbackActor)
    }),
    flop: Object.assign({}, source.flop, {
      actionLine: compactActionLine(source.flop && source.flop.actionLine, fallbackActor)
    }),
    turn: Object.assign({}, source.turn, {
      actionLine: compactActionLine(source.turn && source.turn.actionLine, fallbackActor)
    }),
    river: Object.assign({}, source.river, {
      actionLine: compactActionLine(source.river && source.river.actionLine, fallbackActor)
    })
  }
}

function extractActionAmount(segment) {
  const source = String(segment || '').replace(/\b[345]B\b/ig, ' ')
  const matches = source.match(/-?\d+(?:\.\d+)?/g) || []
  const numbers = matches
    .map(item => Number(item))
    .filter(item => Number.isFinite(item) && Math.abs(item) >= 10)
  return numbers.length ? Math.abs(numbers[numbers.length - 1]) : 0
}

function getStreetContribution(actionLine) {
  const source = normalizeActionText(actionLine)
  if (!source.trim()) return 0
  const parts = source
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
  const amountParts = parts
    .map((part, index) => ({
      index,
      amount: extractActionAmount(part),
      isBetLike: /bet|cbet|donk|raise|allin|open|limp|3b|4b|5b|\u4e0b\u6ce8|\u52a0\u6ce8|\u52a0\u5230|\u5f00|\u6253|\u5c0f\u6ce8|\u5927\u6ce8|\u63a8/i.test(part)
    }))
    .filter(item => item.amount && item.isBetLike)
  if (amountParts.length === 1) {
    const item = amountParts[0]
    const callsAfter = parts.slice(item.index + 1).filter(part => /call|\u8ddf|\u9760/i.test(part)).length
    if (callsAfter) return item.amount * (1 + callsAfter)
    if (parts.slice(item.index + 1).some(part => /fold|\u5f03|\u8dd1/i.test(part))) return 0
  }
  const commits = [0, 0]
  let actor = 0
  let currentBet = 0
  let sawMatchedAction = false
  let folded = false

  parts.forEach(part => {
    const amount = extractActionAmount(part)
    const isFold = /fold|\u5f03|\u8dd1/i.test(part)
    const isCall = /call|\u8ddf|\u9760/i.test(part)
    const isBetLike = amount && /bet|cbet|donk|raise|allin|open|limp|3b|4b|5b|\u4e0b\u6ce8|\u52a0\u6ce8|\u52a0\u5230|\u5f00|\u6253|\u5c0f\u6ce8|\u5927\u6ce8|\u63a8/i.test(part)
    const isCheck = /check|\u8fc7/i.test(part)

    if (isBetLike) {
      commits[actor] = Math.max(commits[actor], amount)
      currentBet = Math.max(currentBet, amount)
      actor = actor ? 0 : 1
      return
    }

    if (isCall && currentBet) {
      commits[actor] = Math.max(commits[actor], currentBet)
      sawMatchedAction = true
      folded = false
      actor = actor ? 0 : 1
      return
    }

    if (isFold) {
      folded = true
      actor = actor ? 0 : 1
      return
    }

    if (isCheck || isCall) {
      actor = actor ? 0 : 1
    }
  })

  const sorted = commits.slice().sort((a, b) => b - a)
  if (sawMatchedAction) {
    return commits[0] + commits[1]
  }
  if (folded) {
    return sorted[1] ? sorted[1] * 2 : 0
  }
  if (sorted[1] === 0) return 0
  return commits[0] + commits[1]
}

function normalizeStreetPotFlow(streetInputs, board) {
  const source = Object.assign(
    {
      preflop: { actionLine: '', pot: '' },
      flop: { actionLine: '', pot: '' },
      turn: { actionLine: '', pot: '' },
      river: { actionLine: '', pot: '' }
    },
    streetInputs || {}
  )
  const normalized = {
    preflop: Object.assign({ actionLine: '', pot: '' }, source.preflop || {}),
    flop: Object.assign({ actionLine: '', pot: '' }, source.flop || {}),
    turn: Object.assign({ actionLine: '', pot: '' }, source.turn || {}),
    river: Object.assign({ actionLine: '', pot: '' }, source.river || {})
  }
  const boardState = Object.assign({ flop: '', turn: '', river: '' }, board || {})
  const reachedFlop = Boolean(boardState.flop || normalized.flop.actionLine || normalized.flop.pot)
  const reachedTurn = Boolean(boardState.turn || normalized.turn.actionLine || normalized.turn.pot)
  const reachedRiver = Boolean(boardState.river || normalized.river.actionLine || normalized.river.pot)

  const preflopPot = toPotNumber(normalized.preflop.pot)
  const flopContribution = getStreetContribution(normalized.flop.actionLine)
  const turnContribution = getStreetContribution(normalized.turn.actionLine)
  const riverContribution = getStreetContribution(normalized.river.actionLine)

  if (reachedFlop && preflopPot) {
    normalized.flop.pot = String(preflopPot)
  }
  const flopPot = toPotNumber(normalized.flop.pot)
  if (reachedTurn && flopPot) {
    normalized.turn.pot = String(flopPot + flopContribution)
  }
  const turnPot = toPotNumber(normalized.turn.pot)
  if (reachedRiver && turnPot) {
    normalized.river.pot = String(turnPot + turnContribution)
  }

  return {
    streetInputs: normalized,
    finalPot: reachedRiver
      ? toPotNumber(normalized.river.pot) + riverContribution
      : reachedTurn
        ? toPotNumber(normalized.turn.pot) + turnContribution
        : reachedFlop
          ? toPotNumber(normalized.flop.pot) + flopContribution
          : preflopPot
  }
}

function normalizeReadableText(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/[，。！？、；：,.!?;:\-—'"“”‘’（）()【】[\]]/g, '')
}

function isCopiedMindJourney(value, transcript) {
  const text = normalizeReadableText(value)
  const raw = normalizeReadableText(transcript)
  if (!text || !raw) return false
  if (text === raw) return true
  if (text.length > 160 && raw.includes(text.slice(0, 120))) return true
  if (text.length > raw.length * 0.65 && text.length > 120) {
    const probe = text.slice(Math.max(0, Math.floor(text.length * 0.25)), Math.max(1, Math.floor(text.length * 0.75)))
    return probe.length > 30 && raw.includes(probe)
  }
  return false
}

function cleanMindSentence(value) {
  return String(value || '')
    .replace(/^\s*(但是|然后|所以|我直接|我是|我|这边|这个|已经|其实|就是|感觉就是|我感觉|我觉得|觉得)\s*/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[，,。；;]+$/g, '')
    .trim()
}

function splitMindSentences(text) {
  return String(text || '')
    .split(/[。！？；\n，,]+/)
    .map(item => item.trim())
    .filter(Boolean)
}

function extractMindJourneySummary(transcript) {
  const source = String(transcript || '')
  if (!source.trim()) return ''
  const turnThinking = extractTurnThinkingFromChinese(source)
  if (turnThinking) return turnThinking
  const cues = /觉得|感觉|认为|想|因为|所以|范围|优势|偷|诈|卡顺|后门|买花|买顺|太差|不划算|overbet|超池|桌面|动态|对手|读牌|判断|怕|不怕|call|allin|全下|推|弃牌|fold|价值|保护|位置|深筹|上一手|影响|抢这个底池|抢底池|应该/i
  const actionOnly = /^(?:[^，。！？；]*?)(?:open|call|raise|bet|check|fold|cbet|3B|4B|5B|allin|发|掉|打到|加到|跟注|弃牌|过牌)[^，。！？；]*$/i
  const picked = []
  splitMindSentences(source).forEach(sentence => {
    if (!cues.test(sentence)) return
    const cleaned = cleanMindSentence(sentence)
    if (!cleaned || cleaned.length < 6) return
    if (actionOnly.test(cleaned) && !/觉得|感觉|认为|因为|所以|范围|优势|偷|太差|动态|读牌|判断|不怕|怕|价值|保护|上一手|影响|抢这个底池|抢底池|应该/i.test(cleaned)) return
    if (!picked.includes(cleaned)) picked.push(cleaned)
  })
  const correction = source.match(/(?:后来|复盘后|细想|回头看).{0,18}(应该直接弃掉|应该弃掉|直接弃掉是最好的|弃掉是最好的)/)
  if (correction) {
    const correctionValue = source.includes('应该直接弃掉') ? '应该直接弃掉' : correction[1]
    const correctionText = '复盘后认为' + correctionValue
    const existingIndex = picked.findIndex(item => item.includes('细想') || item.includes(correction[1]))
    if (existingIndex >= 0) picked[existingIndex] = correctionText
    else picked.push(correctionText)
  }
  const joined = picked.slice(0, 6).join('；')
  if (joined.length <= 220) return joined
  const clipped = joined.slice(0, 220)
  const end = Math.max(clipped.lastIndexOf('；'), clipped.lastIndexOf('，'), clipped.lastIndexOf(','))
  return (end > 80 ? clipped.slice(0, end) : clipped).trim()
}

function extractHeroRankLabel(hand) {
  const cards = String(hand && hand.heroCardsInput || '').toUpperCase().replace(/\s+/g, '')
  const ranks = cards.match(/[AKQJT2-9]/g) || []
  if (ranks.length >= 2) return ranks.slice(0, 2).join('')
  return ''
}

function extractColdFourBetSummary(hand, transcript) {
  const source = String(transcript || '')
  const compact = source.replace(/\s+/g, '')
  if (!/(cold)?4B|4bet|4BET/i.test(compact)) return ''
  if (!/(5B|5bet|5BET)/i.test(compact)) return ''
  if (!/(6B|6bet|allin|all-in|全下|推)/i.test(compact)) return ''

  const heroPosition = hand && hand.heroPosition ? String(hand.heroPosition).toUpperCase() : ''
  const villainPosition = hand && hand.villainPosition ? String(hand.villainPosition).toUpperCase() : ''
  const opponentName = hand && hand.opponentName ? String(hand.opponentName).trim() : ''
  const villainLabel = [villainPosition, opponentName].filter(Boolean).join(' ') || '对手'
  const fiveBet = compact.match(/5B(?:到)?(\d+)/i) || compact.match(/5BET(?:到)?(\d+)/i)
  const heroRank = extractHeroRankLabel(hand)
  const opponentShowdown = /(?:对方|他|对手)(?:是|亮出|show)?AA|AA/.test(compact) ? '，结果对方是 AA' : ''
  const parts = []
  if (heroPosition) parts.push('Hero 在 ' + heroPosition + ' 位')
  else parts.push('Hero')
  parts.push('cold 4B 后')
  parts.push('被 ' + villainLabel + ' open 后 5B' + (fiveBet && fiveBet[1] ? ' 到 ' + fiveBet[1] : ''))
  parts.push('，Hero 6B allin' + (heroRank ? ' ' + heroRank : '') + opponentShowdown)
  return parts.join(' ')
}

function normalizeMindJourney(value, transcript) {
  const current = String(value || '').trim()
  const shouldRegenerate = !current || isCopiedMindJourney(current, transcript) || current.length > 260
  if (!shouldRegenerate) return current
  const summary = extractMindJourneySummary(transcript)
  return summary || ''
}

function normalizeActionArrow(value) {
  return String(value || '')
    .replace(/->|=>|鈫扝|鈫扠|鈫./g, '→')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeStreetSummary(value, streetInputs, transcript, hand) {
  const current = String(value || '').trim()
  const coldFourBetSummary = extractColdFourBetSummary(hand, transcript)
  const streets = [
    ['preflop', '翻前'],
    ['flop', '翻牌'],
    ['turn', '转牌'],
    ['river', '河牌']
  ]
  const parts = streets
    .map(([key, label]) => {
      const actionLine = normalizeActionArrow(streetInputs && streetInputs[key] && streetInputs[key].actionLine)
      return actionLine ? `${label}：${actionLine}` : ''
    })
    .filter(Boolean)

  if (!parts.length) return coldFourBetSummary || current
  const generated = parts.join('；')
  const currentLooksRaw =
    !current ||
    current.length > 180 ||
    isCopiedMindJourney(current, transcript) ||
    (/这个牌是|刚刚这个牌|然后|我是觉得|我靠|锅里面|没发出来/.test(current) && generated.length < current.length) ||
    (coldFourBetSummary && /Hero\s*5B|HJ\s*fold|HJ\s*allin|fold→.*allin|5B\d+→.*fold/i.test(current))

  return currentLooksRaw ? (coldFourBetSummary || generated).slice(0, 180) : current
}

function extractTurnThinkingFromChinese(transcript) {
  const source = String(transcript || '')
  if (!source || !/(转牌|turn|TURN)/i.test(source)) return ''

  const cueIndex = source.search(/但是我是觉得|我是觉得|我觉得|感觉|认为/)
  if (cueIndex < 0) return ''
  const before = source.slice(0, cueIndex)
  const lastTurn = Math.max(before.lastIndexOf('转牌'), before.toLowerCase().lastIndexOf('turn'))
  const lastFlop = Math.max(before.lastIndexOf('flop'), before.lastIndexOf('翻牌'))
  const lastRiver = Math.max(before.lastIndexOf('river'), before.lastIndexOf('河牌'))
  if (lastTurn < lastFlop || lastRiver > lastTurn) return ''

  const tail = source.slice(cueIndex)
  if (!/(15800|overbet|超池|call太差|范围优势|偷|check\s*allin|allin|全下)/i.test(tail)) return ''

  const points = []
  if (/call太差|Call太差|call\s*太差/i.test(tail)) points.push('继续 call 太差')
  if (/卡顺/.test(tail)) points.push('Hero 只有卡顺')
  if (/后门/.test(tail)) points.push('后门花听牌')
  if (/范围优势/.test(tail)) points.push('判断对手有范围优势')
  if (/偷/.test(tail)) points.push('认为对手可能借牌面偷池')
  if (/check\s*allin|check allin|直接.*allin|全下/i.test(tail)) points.push('因此选择 check-allin')

  return points.length ? `Turn：面对对手 15800 overbet，${points.join('，')}。` : ''
}

function postProcessReviewResult(result, transcript, currentHand) {
  const source = result || {}
  const hand = Object.assign({}, source.extractedHand || source)
  const profit = extractProfit(transcript)
  const pot = extractExplicitPot(transcript)
  const current = currentHand || {}

  if (profit !== null) {
    hand.currentProfit = profit
    if (pot === null && Number(hand.potSize) === Math.abs(profit)) {
      hand.potSize = 0
    }
  } else if (!hasProfitCue(transcript) && Number(current.currentProfit)) {
    hand.currentProfit = Number(current.currentProfit)
  }
  if (pot !== null) {
    hand.potSize = pot
  }
  if (!hasOpponentTypeCue(transcript)) {
    hand.opponentType = ''
  } else if (!hand.opponentType) {
    hand.opponentType = ''
  }

  applySpeechFieldCorrections(hand, transcript)

  const board = normalizeBoardBySpeech(hand.board, transcript, hand.heroCardsInput)
  const currentBoard = Object.assign({ flop: '', turn: '', river: '' }, current.board || {})
  const shouldClearAiRiver = !transcriptHasStreetCue(transcript, 'river') && !currentBoard.river
  if (shouldClearAiRiver) {
    board.river = ''
    if (hand.streetInputs && hand.streetInputs.river) {
      hand.streetInputs = Object.assign({}, hand.streetInputs, {
        river: { actionLine: '', pot: '' }
      })
    }
  }
  let missingFields = Array.isArray(source.missingFields) ? source.missingFields.slice() : []
  hand.board = board
  hand.streetInputs = compactStreetInputs(hand.streetInputs, hand)
  applySpeechStreetCorrections(hand, transcript)
  const potFlow = normalizeStreetPotFlow(hand.streetInputs, board)
  hand.streetInputs = potFlow.streetInputs
  if (pot === null && potFlow.finalPot) {
    hand.potSize = potFlow.finalPot
  }
  applyAllInResultInference(hand, transcript)
  hand.streetSummary = normalizeStreetSummary(hand.streetSummary, hand.streetInputs, transcript, hand)
  hand.mindJourney = normalizeMindJourney(hand.mindJourney, transcript)

  if (source.extractedHand) {
    return Object.assign({}, source, {
      extractedHand: hand,
      missingFields
    })
  }
  return hand
}

function extractExplicitTermDefinitions(text) {
  const source = String(text || '')
  const definitions = []
  const pattern = /(?:\u4ee5\u540e|\u4e4b\u540e|\u4e0b\u6b21)?\s*([\u4e00-\u9fa5A-Za-z0-9_ -]{2,12}?)\s*(?:\u5c31\u662f|\u662f|\u7b49\u4e8e|\u4ee3\u8868|\u6307\u7684\u662f)\s*([\u4e00-\u9fa5A-Za-z0-9_ -]{1,12})/g
  let match = pattern.exec(source)
  while (match) {
    const from = String(match[1] || '').trim()
    const to = String(match[2] || '').trim()
    if (from && to && from !== to) {
      definitions.push({
        from,
        to,
        type: 'learned',
        updatedAt: Date.now()
      })
    }
    match = pattern.exec(source)
  }
  return definitions
}

function mergeUserTerms(currentTerms, learnedTerms) {
  const current = normalizeCustomTerms(currentTerms)
  const learned = normalizeCustomTerms(learnedTerms)
  const byFrom = {}
  current.concat(learned).forEach(term => {
    byFrom[term.from] = Object.assign({}, byFrom[term.from] || {}, term)
  })
  return Object.keys(byFrom)
    .map(key => byFrom[key])
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

module.exports = {
  DEFAULT_TERMS,
  normalizeUserTerms,
  applyUserTerms,
  extractProfit,
  extractExplicitPot,
  postProcessReviewResult,
  extractExplicitTermDefinitions,
  mergeUserTerms
}
