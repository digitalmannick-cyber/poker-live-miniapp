const PBT_BANKROLL_MARKER = '---PBT Bankroll Export---'

function normalizeText(value) {
  return String(value == null ? '' : value).trim()
}

function parseCsv(text) {
  const source = String(text || '').replace(/^\uFEFF/, '')
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < source.length; index += 1) {
    const char = source.charAt(index)
    const next = source.charAt(index + 1)
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        cell += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
      continue
    }
    if (char === ',') {
      row.push(cell)
      cell = ''
      continue
    }
    if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      continue
    }
    if (char !== '\r') cell += char
  }
  row.push(cell)
  if (row.length > 1 || normalizeText(row[0])) rows.push(row)
  return rows
}

function normalizeHeader(value) {
  return normalizeText(value).toLowerCase()
}

function findHeaderIndex(rows) {
  return (rows || []).findIndex(row => {
    const headers = (row || []).map(normalizeHeader)
    return headers.indexOf('id') > -1 &&
      headers.indexOf('starttime') > -1 &&
      headers.indexOf('endtime') > -1 &&
      headers.indexOf('netprofit') > -1
  })
}

function rowToObject(headers, row) {
  const result = {}
  headers.forEach((header, index) => {
    const key = normalizeHeader(header)
    if (!key) return
    result[key] = row[index] == null ? '' : row[index]
  })
  return result
}

function parseNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function normalizePbtId(value) {
  return normalizeText(value).replace(/\.0$/, '')
}

function makeSessionId(pbtId) {
  return 'pbt_session_' + normalizePbtId(pbtId).replace(/[^0-9A-Za-z_-]/g, '_')
}

function makeBankrollLogId(sessionId) {
  return 'pbt_bankroll_' + sessionId.replace(/[^0-9A-Za-z_-]/g, '_')
}

function formatDate(value) {
  return normalizeText(value).split(/\s+/)[0] || ''
}

function mapTableSize(value) {
  const text = normalizeText(value).toLowerCase()
  if (text === 'full-ring' || text === 'full ring') return 9
  const match = text.match(/\d+/)
  return match ? Number(match[0]) || 0 : 0
}

function buildNotes(row) {
  const parts = []
  const sessionNote = normalizeText(row.sessionnote)
  const notes = normalizeText(row.notes)
  const tags = normalizeText(row.tags)
  if (sessionNote) parts.push(sessionNote)
  if (notes && notes !== sessionNote) parts.push(notes)
  if (tags) parts.push('PBT Tags: ' + tags)
  parts.push('--- PBT Bankroll 导入 ---')
  parts.push('PBT ID: ' + normalizePbtId(row.id))
  if (normalizeText(row.currency)) parts.push('Currency: ' + normalizeText(row.currency))
  if (parseNumber(row.breakminutes)) parts.push('Break minutes: ' + parseNumber(row.breakminutes))
  if (normalizeText(row.variant) || normalizeText(row.game) || normalizeText(row.limit)) {
    parts.push('Game: ' + [row.variant, row.game, row.limit].map(normalizeText).filter(Boolean).join(' / '))
  }
  return parts.filter(Boolean).join('\n')
}

function validateRow(row) {
  const errors = []
  const id = normalizePbtId(row.id)
  const buyIn = parseNumber(row.buyin)
  const cashOut = parseNumber(row.cashout)
  const netProfit = parseNumber(row.netprofit)
  if (!id) errors.push('MISSING_ID')
  if (!normalizeText(row.starttime)) errors.push('MISSING_STARTTIME')
  if (!normalizeText(row.endtime)) errors.push('MISSING_ENDTIME')
  if (Math.round((cashOut - buyIn) * 100) !== Math.round(netProfit * 100)) {
    errors.push('NET_PROFIT_MISMATCH')
  }
  return errors
}

function buildSession(row, nowMs) {
  const pbtId = normalizePbtId(row.id)
  const sessionId = makeSessionId(pbtId)
  const smallBlind = parseNumber(row.smallblind)
  const bigBlind = parseNumber(row.bigblind)
  const buyIn = parseNumber(row.buyin)
  const cashOut = parseNumber(row.cashout)
  const netProfit = parseNumber(row.netprofit)
  const startTime = normalizeText(row.starttime)
  const endTime = normalizeText(row.endtime)
  const venue = normalizeText(row.location)
  return {
    _id: sessionId,
    title: (venue + ' ' + smallBlind + '/' + bigBlind).trim(),
    date: formatDate(startTime),
    startTime,
    endTime,
    venue,
    smallBlind,
    bigBlind,
    hasStraddle: parseNumber(row['3rdblind']) > 0,
    tableSize: mapTableSize(row.tablesize) || 9,
    buyIn,
    cashOut,
    endingChips: cashOut,
    totalProfit: netProfit,
    durationMinutes: parseNumber(row.playingminutes),
    timerPausedAt: '',
    handCount: 0,
    status: 'finished',
    notes: buildNotes(row),
    source: {
      type: 'pbt_bankroll_import',
      pbtId,
      currency: normalizeText(row.currency),
      exchangeRate: parseNumber(row.exchangerate),
      breakMinutes: parseNumber(row.breakminutes),
      grossProfit: parseNumber(row.grossprofit),
      rebuys: parseNumber(row.rebuys),
      rebuyCosts: parseNumber(row.rebuycosts),
      expenses: parseNumber(row.expenses)
    },
    createdAt: nowMs,
    updatedAt: nowMs
  }
}

function buildBankrollLog(session, nowMs) {
  return {
    _id: makeBankrollLogId(session._id),
    sessionId: session._id,
    type: 'session_settlement',
    amount: Number(session.totalProfit) || 0,
    balanceAfter: 0,
    note: (session.title || 'PBT Session') + ' 结算',
    createdAt: nowMs,
    updatedAt: nowMs,
    source: {
      type: 'pbt_bankroll_import',
      pbtId: session.source && session.source.pbtId
    }
  }
}

function parsePbtBankrollCsv(text) {
  const rows = parseCsv(text)
  const headerIndex = findHeaderIndex(rows)
  if (headerIndex < 0) {
    return {
      ok: false,
      error: 'PBT_BANKROLL_CSV_HEADER_NOT_FOUND',
      rows: [],
      markerFound: rows.some(row => normalizeText(row[0]) === PBT_BANKROLL_MARKER)
    }
  }
  const headers = rows[headerIndex]
  const dataRows = rows.slice(headerIndex + 1)
    .map(row => rowToObject(headers, row))
    .filter(row => normalizePbtId(row.id))
  return {
    ok: true,
    error: '',
    rows: dataRows,
    headers: headers.map(normalizeHeader),
    markerFound: rows.some(row => normalizeText(row[0]) === PBT_BANKROLL_MARKER)
  }
}

function buildImportPlan(csvText, existingSessions, existingBankrollLogs, options) {
  const parsed = parsePbtBankrollCsv(csvText)
  if (!parsed.ok) {
    return Object.assign({}, parsed, {
      createSessions: [],
      updateSessions: [],
      bankrollLogs: [],
      skipped: []
    })
  }
  const nowMs = Number(options && options.nowMs) || Date.now()
  const existingById = {}
  ;(Array.isArray(existingSessions) ? existingSessions : []).forEach(session => {
    if (session && session._id) existingById[session._id] = session
  })
  const seen = {}
  const createSessions = []
  const updateSessions = []
  const bankrollLogs = []
  const skipped = []
  parsed.rows.forEach(row => {
    const pbtId = normalizePbtId(row.id)
    const sessionId = makeSessionId(pbtId)
    if (seen[sessionId]) {
      skipped.push({ row, reason: 'DUPLICATE_SOURCE_ROW' })
      return
    }
    seen[sessionId] = true
    const errors = validateRow(row)
    if (errors.length) {
      skipped.push({ row, reason: errors.join(',') })
      return
    }
    const session = buildSession(row, nowMs)
    if (existingById[sessionId]) {
      updateSessions.push(Object.assign({}, session, {
        createdAt: existingById[sessionId].createdAt || session.createdAt
      }))
    } else {
      createSessions.push(session)
    }
    bankrollLogs.push(buildBankrollLog(session, nowMs))
  })
  return Object.assign({}, parsed, {
    createSessions,
    updateSessions,
    bankrollLogs,
    skipped,
    total: parsed.rows.length
  })
}

module.exports = {
  parsePbtBankrollCsv,
  buildImportPlan,
  __test: {
    makeSessionId,
    mapTableSize,
    validateRow,
    buildSession
  }
}
