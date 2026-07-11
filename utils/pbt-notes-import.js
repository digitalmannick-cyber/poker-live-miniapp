const PBT_EXPORT_MARKER = '---PBT Notes Export---'

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
    return headers.indexOf('id') > -1 && headers.indexOf('name') > -1 && headers.indexOf('note') > -1
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

function normalizeName(value) {
  return normalizeText(value).replace(/\s+/g, ' ')
}

function normalizeNameKey(value) {
  return normalizeName(value).toLowerCase()
}

function normalizePbtId(value) {
  return normalizeText(value).replace(/\.0$/, '')
}

function makePbtNoteId(pbtId) {
  return 'pbt_note_' + normalizePbtId(pbtId).replace(/[^0-9A-Za-z_-]/g, '_')
}

function normalizePbtNoteText(value) {
  return normalizeText(value).replace(/\|/g, '\n')
}

function stripPreviousPbtBlock(note) {
  return normalizeText(note)
    .replace(/\n{0,2}--- PBT 导入 ---[\s\S]*$/m, '')
    .trim()
}

function buildImportedNote(row, existingNote) {
  const baseParts = [
    stripPreviousPbtBlock(existingNote),
    normalizePbtNoteText(row.note)
  ].filter(Boolean)
  const base = Array.from(new Set(baseParts)).join('\n\n')
  const pbtId = normalizePbtId(row.id)
  const meta = [
    pbtId ? 'PBT ID: ' + pbtId : ''
  ].filter(Boolean).join('\n')
  return [base, meta ? '--- PBT 导入 ---\n' + meta : ''].filter(Boolean).join('\n\n')
}

function findExistingNote(row, existingNotes) {
  const pbtId = normalizePbtId(row.id)
  const pbtNeedle = pbtId ? 'PBT ID: ' + pbtId : ''
  if (pbtNeedle) {
    const byPbtId = existingNotes.find(note => String(note.note || '').indexOf(pbtNeedle) > -1)
    if (byPbtId) return byPbtId
    const byGeneratedId = existingNotes.find(note => note._id === makePbtNoteId(pbtId))
    if (byGeneratedId) return byGeneratedId
  }
  const nameKey = normalizeNameKey(row.name)
  if (!nameKey) return null
  return existingNotes.find(note => normalizeNameKey(note.name) === nameKey) || null
}

function buildPlayerNotePatch(row, existingNote, nowMs) {
  const pbtId = normalizePbtId(row.id)
  const name = normalizeName(row.name)
  const note = buildImportedNote(row, existingNote && existingNote.note)
  return {
    _id: existingNote && existingNote._id || makePbtNoteId(pbtId || name),
    name,
    alias: existingNote && existingNote.alias || [],
    type: existingNote && existingNote.type || '未分类',
    typeColor: existingNote && existingNote.typeColor || '',
    leakTags: existingNote && existingNote.leakTags || [],
    note,
    battleHandIds: existingNote && existingNote.battleHandIds || [],
    archived: false,
    createdAt: existingNote && existingNote.createdAt || nowMs,
    updatedAt: nowMs
  }
}

function parsePbtCsv(text) {
  const rows = parseCsv(text)
  const headerIndex = findHeaderIndex(rows)
  if (headerIndex < 0) {
    return {
      ok: false,
      error: 'PBT_CSV_HEADER_NOT_FOUND',
      rows: [],
      markerFound: rows.some(row => normalizeText(row[0]) === PBT_EXPORT_MARKER)
    }
  }
  const headers = rows[headerIndex]
  const dataRows = rows.slice(headerIndex + 1)
    .map(row => rowToObject(headers, row))
    .filter(row => normalizeName(row.name))
  return {
    ok: true,
    error: '',
    rows: dataRows,
    headers: headers.map(normalizeHeader),
    markerFound: rows.some(row => normalizeText(row[0]) === PBT_EXPORT_MARKER)
  }
}

function buildImportPlan(csvText, existingNotes, options) {
  const parsed = parsePbtCsv(csvText)
  if (!parsed.ok) {
    return Object.assign({}, parsed, {
      create: [],
      update: [],
      skipped: []
    })
  }
  const nowMs = Number(options && options.nowMs) || Date.now()
  const existing = Array.isArray(existingNotes) ? existingNotes : []
  const seenRows = {}
  const create = []
  const update = []
  const skipped = []
  parsed.rows.forEach(row => {
    const pbtId = normalizePbtId(row.id)
    const key = pbtId || normalizeNameKey(row.name)
    if (!key || seenRows[key]) {
      skipped.push({ row, reason: 'DUPLICATE_SOURCE_ROW' })
      return
    }
    seenRows[key] = true
    const matched = findExistingNote(row, existing.concat(create).concat(update))
    const patch = buildPlayerNotePatch(row, matched, nowMs)
    if (matched) {
      update.push(Object.assign({}, patch, { _id: matched._id }))
    } else {
      create.push(patch)
    }
  })
  return Object.assign({}, parsed, {
    create,
    update,
    skipped,
    total: parsed.rows.length
  })
}

module.exports = {
  parseCsv,
  parsePbtCsv,
  buildImportPlan,
  __test: {
    buildImportedNote,
    normalizePbtId,
    makePbtNoteId
  }
}
