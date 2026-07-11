const RANGE_DAYS = { last7: 7, last30: 30 }

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function text(value) {
  return value == null ? '' : String(value)
}

function dateMs(value) {
  if (typeof value === 'number') return value
  const source = text(value).trim()
  if (!source) return 0
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(source) ? source + 'T12:00:00+08:00' : source.replace(' ', 'T')
  const parsed = new Date(normalized).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function itemDateMs(item) {
  return dateMs(item && (item.playedDate || item.date || item.startTime || item.createdAt || item.updatedAt))
}

function buildRange(config) {
  const source = config || {}
  const nowMs = Number(source.nowMs) || Date.now()
  const custom = source.range || {}
  const fromMs = dateMs(custom.from)
  const toMs = dateMs(custom.to)
  if (fromMs || toMs) {
    const start = fromMs || 0
    const end = toMs ? endOfDay(toMs) : Number.MAX_SAFE_INTEGER
    return {
      key: 'custom',
      from: custom.from || '',
      to: custom.to || '',
      startMs: start,
      endMs: end
    }
  }
  const key = RANGE_DAYS[source.rangeKey] ? source.rangeKey : 'all'
  if (key === 'all') {
    return { key, from: '', to: '', startMs: 0, endMs: Number.MAX_SAFE_INTEGER }
  }
  const end = new Date(nowMs)
  end.setHours(23, 59, 59, 999)
  const startMs = end.getTime() - RANGE_DAYS[key] * 24 * 60 * 60 * 1000
  return {
    key,
    from: formatDate(startMs),
    to: formatDate(end.getTime()),
    startMs,
    endMs: end.getTime()
  }
}

function endOfDay(ms) {
  const date = new Date(ms)
  date.setHours(23, 59, 59, 999)
  return date.getTime()
}

function formatDate(ms) {
  if (!ms) return ''
  const date = new Date(ms)
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return yyyy + '-' + mm + '-' + dd
}

function inRange(item, range) {
  const value = itemDateMs(item)
  return value >= range.startMs && value <= range.endMs
}

function sessionProfit(session) {
  if (!session || session.status !== 'finished') return 0
  if (session.totalProfit !== undefined && session.totalProfit !== null && session.totalProfit !== '') {
    return number(session.totalProfit)
  }
  return number(session.cashOut) - number(session.buyIn)
}

function handProfit(hand) {
  return number(hand && hand.currentProfit)
}

function actionSequence(action, fallback) {
  const direct = Number(action && action.sequence)
  return Number.isFinite(direct) && direct > 0 ? direct : fallback + 1
}

function groupActions(actions) {
  const groups = {}
  ;(Array.isArray(actions) ? actions : []).forEach((action, index) => {
    if (!action || !action.handId) return
    const key = text(action.handId)
    if (!groups[key]) groups[key] = []
    groups[key].push(formatAction(action, index))
  })
  Object.keys(groups).forEach(handId => {
    groups[handId].sort((a, b) => a.sequence - b.sequence)
  })
  return groups
}

function formatAction(action, index) {
  return {
    id: text(action._id || action.id),
    street: text(action.street),
    actorSeat: number(action.actorSeat),
    actorLabel: text(action.actorLabel),
    actionType: text(action.actionType),
    amount: number(action.amount),
    potAfter: number(action.potAfter),
    sequence: actionSequence(action, index)
  }
}

function formatSession(session) {
  return {
    id: text(session._id || session.id),
    title: text(session.title),
    date: text(session.date),
    startTime: text(session.startTime),
    endTime: text(session.endTime),
    venue: text(session.venue),
    stake: [session.smallBlind, session.bigBlind].filter(value => value !== undefined && value !== '').join('/'),
    smallBlind: number(session.smallBlind),
    bigBlind: number(session.bigBlind),
    buyIn: number(session.buyIn),
    cashOut: number(session.cashOut),
    profit: sessionProfit(session),
    durationMinutes: number(session.durationMinutes),
    handCount: number(session.handCount),
    status: text(session.status),
    notes: text(session.notes)
  }
}

function formatHand(hand, session, actions) {
  const board = hand && hand.board || {}
  return {
    id: text(hand && (hand._id || hand.id)),
    sessionId: text(hand && hand.sessionId),
    sessionTitle: text(session && session.title),
    playedDate: text(hand && hand.playedDate),
    stakeLevel: text(hand && hand.stakeLevel),
    heroCards: text(hand && hand.heroCardsInput),
    heroPosition: text(hand && hand.heroPosition),
    villainPosition: text(hand && hand.villainPosition),
    opponentType: text(hand && (hand.opponentType || hand.villainType)),
    opponentName: text(hand && hand.opponentName),
    opponentCards: text(hand && hand.opponentCards),
    board: {
      flop: text(board.flop),
      turn: text(board.turn),
      river: text(board.river)
    },
    potSize: number(hand && hand.potSize),
    profit: handProfit(hand),
    resultBB: text(hand && hand.resultBB),
    allIn: {
      isAllIn: !!(hand && hand.isAllIn),
      street: text(hand && (hand.allInStreet || hand.allInRound || hand.allInStage || hand.allInEvStreet)),
      ev: hand && hand.allInEv === '' ? '' : number(hand && hand.allInEv),
      evStatus: text(hand && hand.allInEvStatus),
      evSource: text(hand && hand.allInEvSource),
      heroEquityPct: hand && hand.heroEquityPct === '' ? '' : number(hand && hand.heroEquityPct)
    },
    showdown: {
      text: text(hand && hand.showdown),
      type: text(hand && hand.showdownType),
      reason: text(hand && hand.showdownReason),
      opponentCardsSource: text(hand && hand.opponentCardsSource)
    },
    tags: Array.isArray(hand && hand.tags) ? hand.tags.slice() : [],
    notes: text(hand && hand.notes),
    mindJourney: text(hand && hand.mindJourney),
    streetSummary: text(hand && hand.streetSummary),
    heroQuestion: text(hand && hand.heroQuestion),
    detailBackfilled: !!(hand && hand.detailBackfilled),
    reviewStatus: text(hand && hand.reviewStatus),
    aiReview: hand && hand.aiReview || null,
    voiceExtract: hand && hand.voiceExtract || null,
    actions: actions || [],
    createdAt: number(hand && hand.createdAt),
    updatedAt: number(hand && hand.updatedAt)
  }
}

function pickExtreme(hands, direction) {
  const sorted = hands.slice().sort((a, b) => {
    return direction === 'win' ? b.profit - a.profit : a.profit - b.profit
  })
  const candidate = sorted.find(item => direction === 'win' ? item.profit > 0 : item.profit < 0)
  return candidate || null
}

function summarizeSessions(sessions) {
  const finished = sessions.filter(item => item.status === 'finished')
  const totalProfit = finished.reduce((sum, item) => sum + item.profit, 0)
  const totalMinutes = finished.reduce((sum, item) => sum + item.durationMinutes, 0)
  return { finished, totalProfit, totalMinutes }
}

function buildAgentExport(input) {
  const source = input || {}
  const range = buildRange(source)
  const sessions = (Array.isArray(source.sessions) ? source.sessions : []).filter(item => inRange(item, range)).map(formatSession)
  const sessionById = {}
  sessions.forEach(session => {
    sessionById[session.id] = session
  })
  const actionGroups = groupActions(source.handActions || [])
  const hands = (Array.isArray(source.hands) ? source.hands : [])
    .filter(item => inRange(item, range))
    .map(hand => formatHand(hand, sessionById[text(hand && hand.sessionId)], actionGroups[text(hand && hand._id)] || []))
    .sort((a, b) => itemDateMs(b) - itemDateMs(a))
  const sessionSummary = summarizeSessions(sessions)
  const handProfitTotal = hands.reduce((sum, item) => sum + item.profit, 0)
  const winningHands = hands.filter(item => item.profit > 0)
  const losingHands = hands.filter(item => item.profit < 0)
  const unit = text(source.settings && source.settings.chipUnit) || 'HKD'

  return {
    version: 1,
    generatedAt: new Date(Number(source.nowMs) || Date.now()).toISOString(),
    profile: {
      playerId: text(source.profile && source.profile.playerId),
      name: text(source.profile && source.profile.name)
    },
    range: {
      key: range.key,
      from: range.from,
      to: range.to,
      timezone: 'Asia/Shanghai'
    },
    summary: {
      currency: unit,
      sessionCount: sessions.length,
      finishedSessionCount: sessionSummary.finished.length,
      handCount: hands.length,
      totalProfit: sessionSummary.totalProfit,
      handProfit: handProfitTotal,
      totalHours: Math.round(sessionSummary.totalMinutes / 60 * 10) / 10,
      hourlyRate: sessionSummary.totalMinutes ? Math.round(sessionSummary.totalProfit / (sessionSummary.totalMinutes / 60) * 100) / 100 : 0,
      winningHandCount: winningHands.length,
      losingHandCount: losingHands.length,
      averageHandProfit: hands.length ? Math.round(handProfitTotal / hands.length * 100) / 100 : 0
    },
    extremes: {
      biggestWinningHand: pickExtreme(hands, 'win'),
      biggestLosingHand: pickExtreme(hands, 'loss')
    },
    sessions,
    hands,
    bankrollLogs: Array.isArray(source.bankrollLogs) ? source.bankrollLogs.filter(item => inRange(item, range)) : [],
    fieldNotes: {
      totalProfit: 'Finished-session settlement profit for the selected range.',
      handProfit: 'Sum of currentProfit on hands in the selected range.',
      allInEv: 'Uses stored hand fields only; consumers must respect evStatus and evSource before treating it as verified EV.',
      biggestWinningHand: 'Highest positive hand profit in the selected range.',
      biggestLosingHand: 'Lowest negative hand profit in the selected range.'
    }
  }
}

module.exports = {
  buildAgentExport,
  __test: {
    buildRange,
    dateMs,
    sessionProfit,
    handProfit
  }
}
