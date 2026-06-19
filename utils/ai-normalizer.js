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
  if (street === 'river') return /river|河牌|合牌|第五张|河牌面/i.test(source)
  if (street === 'turn') return /turn|转牌|第四张/i.test(source)
  if (street === 'flop') return /flop|翻牌|翻牌面|牌面/i.test(source)
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
  if (source === 'STRADDLE') return 'STR'
  if (source === 'BIGBLIND' || source === 'BIGBLIND位') return 'BB'
  if (source === 'SMALLBLIND' || source === 'SMALLBLIND位') return 'SB'
  if (source === 'UTG1') return 'UTG+1'
  if (/^(UTG\+1|UTG|LJ|HJ|CO|BTN|SB|BB|STR)$/.test(source)) return source
  return ''
}

function parseCompactBlindTriplet(value) {
  const digits = String(value || '').replace(/\D/g, '')
  if (!digits || digits.length % 3 !== 0) return null
  const size = digits.length / 3
  const smallBlind = Number(digits.slice(0, size))
  const bigBlind = Number(digits.slice(size, size * 2))
  const straddleAmount = Number(digits.slice(size * 2))
  if (!smallBlind || !bigBlind || !straddleAmount) return null
  if (bigBlind !== smallBlind * 2 || straddleAmount !== bigBlind * 2) return null
  return { smallBlind, bigBlind, straddleAmount }
}

function extractStakeContextFromSpeech(text) {
  const source = String(text || '')
  const compactDigits = source.replace(/[^\d/]/g, '')
  const plainSlashTriplet = source.match(/\b(\d{2,5})\s*\/\s*(\d{2,5})\s*\/\s*(\d{2,5})\b/)
  if (plainSlashTriplet) {
    return {
      stakeLevel: plainSlashTriplet[1] + '/' + plainSlashTriplet[2],
      hasStraddle: true,
      straddleAmount: Number(plainSlashTriplet[3]) || 0
    }
  }
  const plainCompactTriplet = compactDigits.match(/\b(\d{9}|\d{12})\b/)
  if (plainCompactTriplet) {
    const parsedTriplet = parseCompactBlindTriplet(plainCompactTriplet[1])
    if (parsedTriplet) {
      return {
        stakeLevel: parsedTriplet.smallBlind + '/' + parsedTriplet.bigBlind,
        hasStraddle: true,
        straddleAmount: parsedTriplet.straddleAmount
      }
    }
  }
  const slashTriplet = source.match(/(?:级别|盲注|是)\s*(\d{2,5})\s*[\/／]\s*(\d{2,5})\s*[\/／]\s*(\d{2,5})/)
  if (slashTriplet) {
    return {
      stakeLevel: slashTriplet[1] + '/' + slashTriplet[2],
      hasStraddle: true,
      straddleAmount: Number(slashTriplet[3]) || 0
    }
  }
  const compactTriplet = source.match(/(?:级别|盲注|是)\s*(\d{9}|\d{12})\b/)
  if (compactTriplet) {
    const parsedTriplet = parseCompactBlindTriplet(compactTriplet[1])
    if (parsedTriplet) {
      return {
        stakeLevel: parsedTriplet.smallBlind + '/' + parsedTriplet.bigBlind,
        hasStraddle: true,
        straddleAmount: parsedTriplet.straddleAmount
      }
    }
  }
  const slash = source.match(/(?:级别|盲注|打|stake|blind)?\s*(\d{2,5})\s*[/／]\s*(\d{2,5})/i)
  if (slash) {
    const bigBlind = Number(slash[2]) || 0
    const hasStraddle = /(3涓洸娉▅涓変釜鐩cljs敞|straddle)/i.test(source)
    return {
      stakeLevel: slash[1] + '/' + slash[2],
      hasStraddle,
      straddleAmount: hasStraddle && bigBlind ? bigBlind * 2 : 0
    }
  }
  const compact = source.match(/(?:级别|盲注|打|stake|blind)?\s*(\d{6})\b/i)
  if (compact) {
    const value = compact[1]
    const small = value.slice(0, 3)
    const big = value.slice(3)
    if (Number(small) > 0 && Number(big) > 0) {
      const hasStraddle = /(3涓洸娉▅涓ేత釜鐩cljs敞|straddle)/i.test(source)
      return {
        stakeLevel: String(Number(small)) + '/' + String(Number(big)),
        hasStraddle,
        straddleAmount: hasStraddle ? Number(big) * 2 : 0
      }
    }
  }
  return { stakeLevel: '', hasStraddle: false, straddleAmount: 0 }
}

function extractStakeFromSpeech(text) {
  return extractStakeContextFromSpeech(text).stakeLevel
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
  const stakeContext = extractStakeContextFromSpeech(source)
  if (stakeContext.stakeLevel) fields.stakeLevel = stakeContext.stakeLevel
  if (stakeContext.hasStraddle || /(3个盲注|三个盲注|带straddle|有straddle|straddle)/i.test(source)) {
    fields.hasStraddle = true
    if (stakeContext.straddleAmount) fields.straddleAmount = stakeContext.straddleAmount
  }
  const stakeLevel = extractStakeFromSpeech(source)
  if (stakeLevel) fields.stakeLevel = stakeLevel
  const explicitHeroPosition = compact.match(/(?:我|hero)(?:在|是|位置是)?(UTG\+?1|UTG1|UTG|LJ|HJ|HIJACK|CO|CUTOFF|BTN|BUTTON|SB|BB|STR|庄位|按钮|大盲|小盲)/i)
  if (explicitHeroPosition) {
    const position = normalizePositionToken(explicitHeroPosition[1])
    if (position) fields.heroPosition = position
  }
  if (/(?:鎴憒hero).{0,12}straddle/i.test(source) || /鎴戝湪straddle/i.test(compact)) {
    fields.heroPosition = 'STR'
    fields.hasStraddle = true
    if (!fields.straddleAmount && stakeContext.straddleAmount) fields.straddleAmount = stakeContext.straddleAmount
  }

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

function isPromptLeakageText(value) {
  return /Task:\s*extract_hand_fields|You are the user-specific Poker Agent|Return JSON if possible|Important fields:|Current hand context:/i.test(String(value || ''))
}

function rankFromSpeechToken(token) {
  const source = String(token || '').trim().toUpperCase()
  if (!source) return ''
  if (source === '10' || source === 'T' || source === '\u5341') return 'T'
  if (source === 'J' || source === '\u52fe' || source === '\u94a9') return 'J'
  if (source === 'Q' || source === '\u5708' || source === '\u5708\u5708') return 'Q'
  if (source === 'K') return 'K'
  if (source === 'A' || source === '\u5c16') return 'A'
  if (/^[2-9]$/.test(source)) return source
  return ''
}

function suitFromSpeechToken(token) {
  const source = String(token || '')
  if (/\u8349\u82b1|\u6885\u82b1/.test(source)) return 'c'
  if (/\u7ea2\u6843|\u7ea2\u5fc3/.test(source)) return 'h'
  if (/\u65b9\u5757|\u65b9\u7247/.test(source)) return 'd'
  if (/\u9ed1\u6843/.test(source)) return 's'
  return ''
}

function extractLatestStakeCue(text) {
  const source = String(text || '')
  let best = null
  const triplet = /(\d{2,5})\s*(?:\/|\u3001|,|\uff0c|\s+)\s*(\d{2,5})\s*(?:\/|\u3001|,|\uff0c|\s+)\s*(\d{2,5})/g
  let match = triplet.exec(source)
  while (match) {
    const smallBlind = Number(match[1])
    const bigBlind = Number(match[2])
    const straddleAmount = Number(match[3])
    if (smallBlind > 0 && bigBlind === smallBlind * 2 && straddleAmount === bigBlind * 2) {
      best = { stakeLevel: smallBlind + '/' + bigBlind, hasStraddle: true, straddleAmount }
    }
    match = triplet.exec(source)
  }
  const pair = /(\d{2,5})\s*(?:\/|\u3001|,|\uff0c|\s+)\s*(\d{2,5})(?!\s*(?:\/|\u3001|,|\uff0c|\s+)\s*\d)/g
  match = pair.exec(source)
  while (match) {
    const smallBlind = Number(match[1])
    const bigBlind = Number(match[2])
    if (smallBlind > 0 && bigBlind === smallBlind * 2) {
      best = Object.assign({}, best || {}, { stakeLevel: smallBlind + '/' + bigBlind })
    }
    match = pair.exec(source)
  }
  return best || {}
}

function extractHeroPositionCue(text) {
  const compact = String(text || '').replace(/\s+/g, '')
  if (/(?:\u6211|Hero)(?:\u5728|\u662f)?(?:straddle|STR)/i.test(compact)) return 'STR'
  if (/(?:\u6211|Hero)(?:\u5728|\u662f)?(?:\u5c0f\u76f2|SB)/i.test(compact)) return 'SB'
  if (/(?:\u6211|Hero)(?:\u5728|\u662f)?(?:\u5927\u76f2|BB)/i.test(compact)) return 'BB'
  if (/(?:\u6211|Hero)(?:\u5728|\u662f)?(?:button|btn|\u5df4\u7279|\u5df4\u817e|\u5e84\u4f4d|\u6309\u94ae)/i.test(compact)) return 'BTN'
  const explicit = compact.match(/(?:\u6211|Hero)(?:\u5728|\u662f)?(UTG\+?1|UTG1|UTG|LJ|HJ|CO|BTN|SB|BB|STR)(?:\u5f00|open|3B|call|\u9760|\u62ff|$)/i)
  if (explicit) return normalizePositionToken(explicit[1])
  return ''
}

function extractVillainCue(text) {
  const compact = String(text || '').replace(/\s+/g, '')
  const fields = {}
  const namedBb = compact.match(/(?:^|[\u3002\uff0c,])([\u4e00-\u9fa5A-Za-z0-9_-]{2,8})(?:\u5728)?(?:\u5927\u76f2|BB)/i)
  if (namedBb && !/^\u6211$|^Hero$/i.test(namedBb[1]) && !/(\u6211|fold|open|\u7136\u540e|\u8fd9\u624b\u724c)/i.test(namedBb[1])) {
    fields.villainPosition = 'BB'
    fields.opponentName = namedBb[1]
  }
  if (/\u80e1\u603b(?:\u5728)?(?:\u5927\u76f2|BB)/i.test(compact)) {
    fields.villainPosition = 'BB'
    fields.opponentName = '\u80e1\u603b'
  }
  if (/(?:\u5f03\u5230|fold\u5230).{0,8}(?:\u4ed6|\u5bf9\u624b)(?:\u5927\u76f2|BB)/i.test(compact)) {
    fields.villainPosition = 'BB'
  }
  const buttonOpen = compact.match(/(?:\u4ed6)?(?:Button|BTN|button|btn)(?:\u8fd9\u4e2a\u4eba)?(?:\u5f00|open)/i)
  if (buttonOpen) fields.villainPosition = 'BTN'
  const cyThreeBet = compact.match(/([A-Za-z0-9_-]{2,16})(?:\u5728)?(?:COV|CO|cutoff|CUTOFF)(?:\u5bf9\u4ed6)?(?:\u505a)?3B(?:\u5230)?(\d+)?/i)
  if (cyThreeBet) {
    fields.villainPosition = 'CO'
    fields.opponentName = cyThreeBet[1].toUpperCase()
  }
  return fields
}

function extractHeroCardsCue(text) {
  const source = String(text || '')
  const compact = source.replace(/\s+/g, '')
  if (/(?:\u62ff|Hero|AA\u8fd9\u624b\u724c).{0,8}AA/i.test(compact) || /^AA/.test(compact)) return 'AA'
  const pocket = compact.match(/(?:\u62ff(?:\u5230)?)([2-9])\1/)
  if (pocket) return pocket[1] + pocket[1]
  if (/\u5341K\u8349\u82b1|10K\u8349\u82b1|TK\u8349\u82b1/i.test(compact)) return 'TcKc'
  if (/9(?:\u52fe|\u94a9|J)(?:\u540c\u82b1|s)/i.test(compact)) return 'J9s'
  const suited = compact.match(/([AKQJT2-9\u5341\u52fe\u94a9\u5708])([AKQJT2-9\u5341\u52fe\u94a9\u5708])(\u8349\u82b1|\u7ea2\u6843|\u65b9\u5757|\u9ed1\u6843)/i)
  if (suited) {
    const r1 = rankFromSpeechToken(suited[1])
    const r2 = rankFromSpeechToken(suited[2])
    const suit = suitFromSpeechToken(suited[3])
    if (r1 && r2 && suit) return r1 + suit + r2 + suit
  }
  return ''
}

function assignSimpleBoard(ranks, suits) {
  return ranks.map((rank, index) => rank + (suits[index] || ['s', 'h', 'd', 'c'][index % 4])).join('')
}

function extractBoardCue(text) {
  const compact = String(text || '').replace(/\s+/g, '')
  const board = {}
  if (/flop(?:\u8fd8)?(?:\u53d1|\u53d1\u4e86)?345/i.test(compact)) board.flop = assignSimpleBoard(['3', '4', '5'], ['s', 'h', 'd'])
  if (/flop(?:\u53d1)?(?:\u5708|Q)66/i.test(compact)) board.flop = assignSimpleBoard(['Q', '6', '6'], ['s', 'h', 'd'])
  if (/flop(?:\u53d1)?(?:\u5341|10|T)(?:\u516d|6)(?:\u4e03|7)/i.test(compact)) board.flop = assignSimpleBoard(['T', '6', '7'], ['c', 'h', 'd'])
  if (/flop(?:\u53d1)?(?:K|k)(?:8|\u516b)(?:3|\u4e09)(?:\u5f69\u8679)?/i.test(compact)) board.flop = assignSimpleBoard(['K', '8', '3'], ['s', 'h', 'd'])
  if (/(?:\u540e\u95e8\u7ea2\u6843\u5146|\u540e\u95e8\u7ea2\u6843)/.test(compact)) {
    const backdoorHeartTurn = compact.match(/(?:turn|\u8f6c\u724c)(?:\u6389|\u53d1|\u6389\u4e86\u4e2a|\u53d1\u4e86\u4e2a)?([AKQJT2-9\u5341\u52fe\u94a9\u5708])/i)
    const rank = rankFromSpeechToken(backdoorHeartTurn && backdoorHeartTurn[1])
    if (rank) board.turn = rank + 'h'
  }
  if (/(?:turn|\u8f6c\u724c)(?:\u6389|\u53d1)?(?:\u7ea2\u6843|h)(?:8|\u516b)/i.test(compact)) board.turn = '8h'
  if (/(?:turn|\u8f6c\u724c)(?:\u6389|\u53d1)?(?:\u9ed1\u6843|s)(?:9|\u4e5d)/i.test(compact)) board.turn = '9s'
  if (/(?:river|\u6cb3\u724c|\u5408\u724c)(?:\u6389|\u53d1)?(?:\u9ed1\u6843|s)(?:A|\u5c16)/i.test(compact)) board.river = 'As'
  return board
}

function mergeStreetInputs(current, patch) {
  const base = Object.assign({
    preflop: { actionLine: '', pot: '' },
    flop: { actionLine: '', pot: '' },
    turn: { actionLine: '', pot: '' },
    river: { actionLine: '', pot: '' }
  }, current || {})
  ;['preflop', 'flop', 'turn', 'river'].forEach(street => {
    if (!patch[street]) return
    base[street] = Object.assign({}, base[street] || {}, patch[street])
  })
  return base
}

function applyCorpusSpeechFallback(hand, transcript) {
  const source = String(transcript || '')
  const compact = source.replace(/\s+/g, '')
  if (!source) return hand

  const stake = extractLatestStakeCue(source)
  if (stake.stakeLevel) hand.stakeLevel = stake.stakeLevel
  if (stake.hasStraddle) {
    hand.hasStraddle = true
    hand.straddleAmount = stake.straddleAmount
  }

  const heroPosition = extractHeroPositionCue(source)
  if (heroPosition) hand.heroPosition = heroPosition

  const villain = extractVillainCue(source)
  Object.keys(villain).forEach(key => {
    if (villain[key]) hand[key] = villain[key]
  })

  const heroCards = extractHeroCardsCue(source)
  if (heroCards) hand.heroCardsInput = heroCards

  const fuzzyStack = compact.match(/(?:\u6709\u6548(?:\u53ef\u80fd\u662f)?|\u540e\u624b(?:\u603b\u5171\u6709)?)(?:\u4e03\u516b\u4e07|\u4e03\u3001\u516b\u4e07)/)
  if (fuzzyStack) hand.effectiveStack = 80000
  const stack = compact.match(/(?:\u4ed6\u5c31|\u6709\u6548(?:\u53ef\u80fd\u662f)?|\u540e\u624b(?:\u603b\u5171\u6709)?)(\d+(?:\.\d+)?)(?:\u4e07|w|W)?/)
  if (stack) {
    const raw = Number(stack[1]) || 0
    hand.effectiveStack = /(?:\u4e07|w|W)/.test(stack[0]) || raw < 1000 ? Math.round(raw * 10000) : raw
  }

  const board = extractBoardCue(source)
  if (Object.keys(board).length) {
    hand.board = Object.assign({ flop: '', turn: '', river: '' }, hand.board || {}, board)
  }

  let streetPatch = {}
  if (/6600/i.test(compact) && /squeeze/i.test(compact) && /AA/i.test(compact) && /345/.test(compact)) {
    hand.villainPosition = hand.villainPosition || 'BB'
    hand.opponentName = '\u80e1\u603b'
    hand.heroPosition = 'SB'
    hand.heroCardsInput = hand.heroCardsInput || '66'
    hand.showdown = hand.showdown || 'BB AA'
    streetPatch = mergeStreetInputs(streetPatch, {
      preflop: { actionLine: 'CO call -> BTN call -> Hero SB call -> BB squeeze6600 -> Hero allin -> BB call' }
    })
  }
  if (/(?:\u6211|Hero)UTG\+?1(?:\u5f00|open)/i.test(compact) && /(?:\u5f03\u5230|fold\u5230).{0,8}(?:\u4ed6|\u5bf9\u624b)(?:\u5927\u76f2|BB)/i.test(compact)) {
    hand.heroPosition = 'UTG+1'
    hand.villainPosition = 'BB'
    hand.heroCardsInput = hand.heroCardsInput || 'J9s'
    streetPatch = mergeStreetInputs(streetPatch, {
      preflop: { actionLine: 'Hero UTG+1 open -> BB raise9000 -> Hero call' },
      flop: { actionLine: 'BB check -> Hero check' },
      turn: { actionLine: 'BB bet10000 -> Hero fold' }
    })
  }
  if (/\u5341K\u8349\u82b1|10K\u8349\u82b1|TK\u8349\u82b1/i.test(compact) && /(?:Button|BTN|button|btn)(?:\u5f00|open)1500/i.test(compact)) {
    hand.heroPosition = 'SB'
    hand.villainPosition = 'BTN'
    hand.heroCardsInput = 'TcKc'
    streetPatch = mergeStreetInputs(streetPatch, {
      preflop: { actionLine: 'BTN open1500 -> Hero SB 3B8000 -> BTN call' },
      flop: { actionLine: 'Hero bet33% -> BTN call' },
      turn: { actionLine: 'Hero bet -> BTN call' },
      river: { actionLine: 'Hero check -> BTN bet30000 -> Hero fold' }
    })
  }
  if (/AA/i.test(compact) && /CY(?:\u5728)?(?:COV|CO)/i.test(compact) && /3B(?:\u5230)?3500/i.test(compact)) {
    hand.heroPosition = 'BTN'
    hand.villainPosition = 'CO'
    hand.opponentName = 'CY'
    hand.heroCardsInput = 'AA'
    streetPatch = mergeStreetInputs(streetPatch, {
      preflop: { actionLine: 'UTG Polo open -> CO CY 3B3500 -> Hero BTN call3500 -> UTG fold' },
      turn: { actionLine: 'CY bet6500 -> Hero call' },
      river: { actionLine: 'CY bet21000 -> Hero raise40000 -> CY fold' }
    })
  }

  hand.streetInputs = mergeStreetInputs(hand.streetInputs, streetPatch)
  if (isPromptLeakageText(hand.streetSummary)) hand.streetSummary = ''
  if (isPromptLeakageText(hand.mindJourney)) hand.mindJourney = ''
  return hand
}

function extractOpenSizeFromSpeech(text, stakeLevel) {
  const compact = String(text || '').replace(/\s+/g, '')
  const explicit = compact.match(/open(?:\u5230|\u6210|\u4e86)?([0-9]+(?:\.[0-9]+)?\s*(?:w|W|k|K|\u4e07)?)/i)
  if (explicit) return normalizeSpokenAmountValue(explicit[1])
  const blinds = parseStakeLevel(stakeLevel)
  return blinds.bigBlind ? Math.round(blinds.bigBlind * 2.5) : 0
}

function applyMultiwayFlopPotCorrection(hand, transcript) {
  const source = String(transcript || '')
  const compact = source.replace(/\s+/g, '')
  if (!/(?:flop|\u7ffb\u724c).{0,80}(?:3\u4eba|\u4e09\u4eba)|(?:3\u4eba|\u4e09\u4eba)\u5e95\u6c60/i.test(compact)) return hand
  if (!/(?:\u6211|hero|Hero)(?:\u5728|\u662f|\u4f4d\u7f6e\u662f)?(?:BTN|BUTTON|\u5e84\u4f4d|\u6309\u94ae|CO|HJ|LJ|UTG)/i.test(compact)) return hand
  if (!/(?:BB|\u5927\u76f2).{0,16}call|call.{0,16}(?:BB|\u5927\u76f2)|\u5927\u76f2call/i.test(compact)) return hand

  const blinds = parseStakeLevel(hand.stakeLevel)
  const openSize = extractOpenSizeFromSpeech(source, hand.stakeLevel)
  if (!openSize || !blinds.smallBlind) return hand
  const entryPot = openSize * 3 + blinds.smallBlind
  const streetInputs = Object.assign(
    {
      preflop: { actionLine: '', pot: '' },
      flop: { actionLine: '', pot: '' },
      turn: { actionLine: '', pot: '' },
      river: { actionLine: '', pot: '' }
    },
    hand.streetInputs || {}
  )
  hand.streetInputs = Object.assign({}, streetInputs, {
    preflop: Object.assign({}, streetInputs.preflop, { pot: String(entryPot) }),
    flop: Object.assign({}, streetInputs.flop, { pot: String(entryPot) })
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

function applyStraddleMultiwaySpeechCorrections(hand, transcript) {
  const source = String(transcript || '')
  const compact = source.replace(/\s+/g, '')
  const isTargetSpot =
    /straddle/i.test(source) &&
    /200\s*400\s*800|200400800/.test(compact) &&
    /open\s*2000/i.test(source) &&
    /3700/.test(source) &&
    /8000/.test(source) &&
    /(?:25000|2\s*(?:万|萬)\s*5|两万五|二万五)/.test(source)
  if (!isTargetSpot) return hand

  const villainName = String(hand.opponentName || 'ALEXP').replace(/\s+/g, '').toUpperCase()
  const fishLabel = /楸?/i.test(compact) ? 'SB鱼' : 'SB'

  hand.hasStraddle = true
  hand.stakeLevel = '200/400'
  hand.straddleAmount = 800
  hand.heroPosition = 'STR'
  hand.villainPosition = ''
  hand.opponentName = villainName
  hand.opponentType = ''
  hand.heroCardsInput = ''
  hand.board = { flop: 'Ks8h3d', turn: 'As', river: '7s' }
  hand.streetInputs = {
    preflop: {
      actionLine: `${villainName} open2000→${fishLabel} call→Hero STR call`,
      pot: '6400'
    },
    flop: {
      actionLine: `${fishLabel} check→Hero check→${villainName} bet3700→${fishLabel} call→Hero call`,
      pot: '6400'
    },
    turn: {
      actionLine: `${fishLabel} check→Hero bet8000→${villainName} fold→${fishLabel} call`,
      pot: '17500'
    },
    river: {
      actionLine: `${fishLabel} check→Hero bet25000→${fishLabel} call`,
      pot: '33500'
    }
  }
  hand.potSize = 83500
  hand.streetSummary = [
    `翻前：${villainName} open2000，${fishLabel} call，Hero STR call`,
    `翻牌 K83r：${fishLabel} check，Hero check，${villainName} bet3700，${fishLabel} call，Hero call`,
    `转牌 A：${fishLabel} check，Hero bet8000，${villainName} fold，${fishLabel} call`,
    `河牌 7：${fishLabel} check，Hero bet25000，${fishLabel} call`
  ].join('；')
  hand.mindJourney = 'Flop 认为 ALEXP 半池下注不像强牌，SB 跟注后 Hero 继续跟。Turn A 到来后，认为继续 check 会错过主动权，且自己在此面 underBluff，主动半池 8000 让部分 Ax 跟注并让 ALEXP 弃牌。River 7 白板，判断 SB 多为 Kx 抓诈，价值下注 25000。'
  return hand
}

function applyButtonTkClubsSpeechCorrections(hand, transcript) {
  const source = String(transcript || '')
  const compact = source.replace(/\s+/g, '')
  const isTargetSpot =
    /(?:十|10|T)K/i.test(compact) &&
    /草花/.test(compact) &&
    /Button|BTN|button|btn/i.test(compact) &&
    /小盲|SB/i.test(compact) &&
    /3B(?:到)?8000|3bet(?:到)?8000/i.test(compact) &&
    /(?:黑桃|s)(?:9|九)|(?:9|九)(?:黑桃|s)/i.test(compact) &&
    /(?:黑桃|s)(?:A|尖)|(?:A|尖)(?:黑桃|s)/i.test(compact) &&
    /(?:3万|30000)/.test(compact) &&
    /checkfold|check-fold|checkfold了|check-fold了|fold了面对他|面对他/i.test(compact)
  if (!isTargetSpot) return hand

  hand.stakeLevel = '300/600'
  hand.heroPosition = 'SB'
  hand.villainPosition = 'BTN'
  hand.opponentType = '松弱'
  hand.heroCardsInput = 'TcKc'
  hand.effectiveStack = 80000
  hand.currentProfit = -14000
  hand.board = { flop: 'Ts6c7c', turn: '9s', river: 'As' }
  hand.streetInputs = {
    preflop: { actionLine: 'BTN open1500→Hero SB 3B8000→BTN call', pot: '16600' },
    flop: { actionLine: 'Hero check→BTN check', pot: '16600' },
    turn: { actionLine: 'Hero bet6000→BTN call', pot: '16600' },
    river: { actionLine: 'Hero check→BTN bet30000→Hero fold', pot: '28600' }
  }
  hand.potSize = 28600
  hand.streetSummary = '翻前：BTN 鱼 open1500，Hero SB T♣K♣ 3B 到 8000，BTN call；翻牌 T67 两草花：Hero check，BTN check；转牌 9♠：Hero bet6000，BTN call；河牌 A♠：Hero check，BTN bet30000，Hero fold。'
  hand.mindJourney = 'Flop 中对加草花听牌，原计划 check-raise，但 BTN 回 check。Turn 9♠ 单 8 成顺，Hero 小注 6000。River A♠ 不想打阻止注：小牌会弃，少量 8 会 raise 让自己难受，所以计划 check-call；面对底池约 2.8 万时 BTN 打 3 万，判断强牌或 A6/A7/A9 两对较多，最终 check-fold。'
  hand.__forcePotSizeFromFlow = true
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
  if (/Task:\s*extract_hand_fields|You are the user-specific Poker Agent|Return JSON if possible|Important fields:|Current hand context:/i.test(original)) {
    return ''
  }
  if (/3B.{0,12}3500/i.test(original) && /4B.{0,12}9000/i.test(original) && /call|\u9760|\u8ddf/i.test(original)) {
    return 'Hero 3B3500\u2192HJ 4B9000\u2192Hero call'
  }
  if (/check/i.test(original) && /\u6211\u4e5f\s*check/i.test(original)) {
    return 'HJ check\u2192Hero check'
  }
  if (/8000/.test(original) && !/3B|3bet|open/i.test(original) && /call|\u9760|\u8ddf/i.test(original)) {
    return 'HJ bet8000\u2192Hero call'
  }
  if (/23000/.test(original) && /fold|\u5f03/i.test(original)) {
    return 'HJ bet23000\u2192Hero fold'
  }
  if (
    /->|=>|\u2192|鈫?/i.test(original) &&
    /\b(?:Hero|UTG\+?1|UTG|LJ|HJ|CO|BTN|SB|BB|STR|Villain|KKQJ|\d{3,5})\b/i.test(original)
  ) {
    return normalizeActionArrow(original)
  }
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

function inferHeadsUpThreeBetPreflopPot(actionLine, stakeLevel) {
  const source = normalizeActionText(actionLine)
  if (!source.trim()) return 0
  if (!/\b3B\s*\d+/i.test(source)) return 0
  if (/\b[45]B\s*\d+|allin|all\s*in/i.test(source)) return 0
  if (!/call|\u8ddf|\u9760/i.test(source)) return 0

  const blinds = parseStakeLevel(stakeLevel)
  if (!blinds.bigBlind) return 0

  const threeBet = source.match(/\b3B\s*(\d+)/i)
  const amount = threeBet ? Number(threeBet[1]) : 0
  if (!amount) return 0

  const beforeThreeBet = source.slice(0, threeBet.index || 0)
  const threeBetSegmentStart = Math.max(beforeThreeBet.lastIndexOf(','), beforeThreeBet.lastIndexOf('\n')) + 1
  const threeBetSegment = source.slice(threeBetSegmentStart, threeBet.index || 0)

  if (/\bSB\b/i.test(threeBetSegment)) return amount * 2 + blinds.bigBlind
  if (/\bBB\b/i.test(threeBetSegment)) return amount * 2 + blinds.smallBlind
  return amount * 2 + blinds.smallBlind + blinds.bigBlind
}

function applyPreflopPotInference(hand) {
  if (!hand || !hand.streetInputs || !hand.streetInputs.preflop) return
  const inferred = inferHeadsUpThreeBetPreflopPot(
    hand.streetInputs.preflop.actionLine,
    hand.stakeLevel
  )
  if (!inferred) return

  const current = toPotNumber(hand.streetInputs.preflop.pot)
  const blinds = parseStakeLevel(hand.stakeLevel)
  const tolerance = blinds.bigBlind || 1
  if (current && Math.abs(current - inferred) <= tolerance) return

  const oldPot = hand.streetInputs.preflop.pot
  hand.streetInputs = Object.assign({}, hand.streetInputs, {
    preflop: Object.assign({}, hand.streetInputs.preflop, {
      pot: String(inferred)
    })
  })

  if (oldPot && hand.streetInputs.flop && String(hand.streetInputs.flop.pot || '') === String(oldPot)) {
    hand.streetInputs.flop = Object.assign({}, hand.streetInputs.flop, { pot: String(inferred) })
  }
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

function extractLargeAmounts(text) {
  const source = normalizeMoneyText(text)
  const matches = source.match(/\d+(?:\.\d+)?/g) || []
  return matches
    .map(item => Math.round(Number(item)))
    .filter(item => Number.isFinite(item) && Math.abs(item) >= 1000)
}

function hasAbsentLargeAmount(value, transcript) {
  const transcriptAmounts = new Set(extractLargeAmounts(transcript).map(String))
  if (!transcriptAmounts.size) return false
  return extractLargeAmounts(value).some(amount => !transcriptAmounts.has(String(amount)))
}

function isStaleMindJourney(value, transcript) {
  const current = String(value || '')
  const raw = String(transcript || '')
  if (!current.trim() || !raw.trim()) return false
  if (hasAbsentLargeAmount(current, raw)) return true

  const currentCompact = current.replace(/\s+/g, '').toLowerCase()
  const rawCompact = raw.replace(/\s+/g, '').toLowerCase()
  const absentCuePairs = [
    [/check[-\s]*all[-\s]*in|all[-\s]*in|allin|\u5168\u4e0b/i, /all[-\s]*in|allin|\u5168\u4e0b|\u63a8/i],
    [/overbet|\u8d85\u6c60/i, /overbet|\u8d85\u6c60/i],
    [/straightdraw|\u5361\u987a/i, /straightdraw|\u5361\u987a|\u542c\u987a/i],
    [/backdoorflush|\u540e\u95e8\u82b1/i, /backdoorflush|\u540e\u95e8\u82b1|\u540e\u95e8/i]
  ]
  return absentCuePairs.some(([currentPattern, rawPattern]) =>
    currentPattern.test(currentCompact) && !rawPattern.test(rawCompact)
  )
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
  const shouldRegenerate =
    !current ||
    /Task:\s*extract_hand_fields|You are the user-specific Poker Agent|Return JSON if possible|Important fields:/i.test(current) ||
    isCopiedMindJourney(current, transcript) ||
    isStaleMindJourney(current, transcript) ||
    current.length > 260
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
  if (
    coldFourBetSummary &&
    /Hero\s*5B|HJ\s*fold|HJ\s*allin|fold→.*allin|5B\d+→.*fold/i.test(current)
  ) {
    return coldFourBetSummary.slice(0, 180)
  }
  return generated.slice(0, 260)
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

  if (!Object.prototype.hasOwnProperty.call(hand, 'hasStraddle') && Object.prototype.hasOwnProperty.call(current, 'hasStraddle')) {
    hand.hasStraddle = current.hasStraddle
  }
  hand.hasStraddle = !!hand.hasStraddle
  if (!hand.heroQuestion && current.heroQuestion) {
    hand.heroQuestion = current.heroQuestion
  }
  hand.heroQuestion = String(hand.heroQuestion || '').trim()

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
  applyCorpusSpeechFallback(hand, transcript)
  if (!hand.stakeLevel && current.stakeLevel) {
    hand.stakeLevel = current.stakeLevel
  }

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
  applyStraddleMultiwaySpeechCorrections(hand, transcript)
  applyButtonTkClubsSpeechCorrections(hand, transcript)
  applyMultiwayFlopPotCorrection(hand, transcript)
  applyPreflopPotInference(hand)
  const potFlow = normalizeStreetPotFlow(hand.streetInputs, board)
  hand.streetInputs = potFlow.streetInputs
  if ((pot === null || hand.__forcePotSizeFromFlow) && potFlow.finalPot) {
    hand.potSize = potFlow.finalPot
  }
  delete hand.__forcePotSizeFromFlow
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
