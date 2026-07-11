const fs = require('fs')
const path = require('path')

const { calculateAllInEv } = require('../utils/all-in-ev')

const ALL_IN_WORD_RE = /(all\s*-?\s*in|allin|\u5168\u4e0b|\u63a8\u5168|\u6253\u5149|\u68ad\u54c8)/i
const AI_TOKEN_RE = /(^|[^A-Za-z0-9])AI([^A-Za-z0-9]|$)/
const STREET_RES = [
  ['river', /(river|\u6cb3\u724c|\u6cb3\u5e95)/i],
  ['turn', /(turn|\u8f6c\u724c|\u8f49\u724c)/i],
  ['flop', /(flop|\u7ffb\u724c)/i],
  ['preflop', /(preflop|pre-flop|\u7ffb\u524d|\u7ffb\u724c\u524d)/i]
]

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function roundMoney(value) {
  return Math.round(number(value) * 100) / 100
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== ''
}

function getText(hand) {
  return [
    hand.streetSummary,
    hand.notes,
    hand.mindJourney,
    hand.heroQuestion,
    hand.reviewText,
    hand.naturalLanguageSummary,
    hand.showdown,
    hand.streetInputs
  ]
    .filter(Boolean)
    .map(value => (typeof value === 'string' ? value : JSON.stringify(value)))
    .join(' ')
}

function firstAllInIndex(text) {
  const wordIndex = text.search(ALL_IN_WORD_RE)
  const aiIndex = text.search(AI_TOKEN_RE)
  return [wordIndex, aiIndex].filter(index => index >= 0).sort((a, b) => a - b)[0] ?? -1
}

function containsAllIn(text) {
  return ALL_IN_WORD_RE.test(text) || AI_TOKEN_RE.test(text)
}

function detectAllInStreet(text) {
  const allInIndex = firstAllInIndex(text)
  if (allInIndex < 0) return ''
  const before = text.slice(0, allInIndex + 100)
  const hits = []
  STREET_RES.forEach(([street, re]) => {
    const matcher = new RegExp(re.source, 'ig')
    let match
    while ((match = matcher.exec(before))) {
      hits.push({ street, index: match.index })
    }
  })
  if (!hits.length) return 'unknown'
  return hits.sort((a, b) => b.index - a.index)[0].street
}

function hasBoardAtStreet(board, street) {
  if (street === 'preflop') return true
  if (!board || typeof board !== 'object') return false
  if (street === 'flop') return hasValue(board.flop)
  if (street === 'turn') return hasValue(board.flop) && hasValue(board.turn)
  return false
}

function opponentCardsOf(hand) {
  return hand.villainCardsInput || hand.opponentCards || hand.showdown || ''
}

function allInPotOf(hand) {
  return number(hand.allInPot || hand.potSize)
}

function isTrustedCalculatedEv(hand) {
  if (!hasValue(hand.allInEv)) return false
  return Boolean(
    hand.allInEvStatus === 'calculated' ||
    hand.allInEvSource ||
    hand.allInEvFormula ||
    hand.allInEvUpdatedAt
  )
}

function collectMissingFields(hand, street) {
  const missing = []
  if (!street || street === 'unknown') missing.push('allInStreet')
  if (!hasValue(hand.heroCardsInput || hand.heroCards)) missing.push('heroCards')
  if (!hasValue(opponentCardsOf(hand))) missing.push('opponentCards')
  if (street !== 'unknown' && !hasBoardAtStreet(hand.board, street)) missing.push('boardAtAllIn')
  if (allInPotOf(hand) <= 0) missing.push('allInPot')
  if (number(hand.heroInvested) <= 0) missing.push('heroInvested')
  if (number(hand.heroEquityPct) <= 0) missing.push('heroEquityPct')
  return missing
}

function classifyHand(hand) {
  const text = getText(hand)
  if (!containsAllIn(text)) {
    return {
      id: hand._id,
      status: 'not_all_in'
    }
  }

  const street = detectAllInStreet(text)
  const actualProfit = roundMoney(hand.currentProfit)
  const unverifiedAllInEv = hasValue(hand.allInEv) && !isTrustedCalculatedEv(hand)

  if (street === 'river') {
    return {
      id: hand._id,
      status: 'river_actual_profit',
      detectedStreet: street,
      suggestedAllInEv: actualProfit,
      actualProfit,
      missingFields: [],
      hasUnverifiedAllInEvField: unverifiedAllInEv,
      actionExcerpt: text.replace(/\s+/g, ' ').slice(0, 220)
    }
  }

  if (isTrustedCalculatedEv(hand)) {
    return {
      id: hand._id,
      status: 'already_calculated',
      detectedStreet: street,
      suggestedAllInEv: roundMoney(hand.allInEv),
      actualProfit,
      missingFields: [],
      hasUnverifiedAllInEvField: false,
      actionExcerpt: text.replace(/\s+/g, ' ').slice(0, 220)
    }
  }

  const missingFields = collectMissingFields(hand, street)
  if (missingFields.length) {
    return {
      id: hand._id,
      status: 'needs_manual_fields',
      detectedStreet: street,
      suggestedAllInEv: null,
      actualProfit,
      missingFields,
      hasUnverifiedAllInEvField: unverifiedAllInEv,
      actionExcerpt: text.replace(/\s+/g, ' ').slice(0, 220)
    }
  }

  const ev = calculateAllInEv({
    isAllIn: true,
    allInStreet: street,
    potSize: allInPotOf(hand),
    heroInvested: hand.heroInvested,
    heroEquityPct: hand.heroEquityPct,
    currentProfit: hand.currentProfit
  })

  return {
    id: hand._id,
    status: ev.status === 'calculated' ? 'calculated_preview' : ev.status,
    detectedStreet: street,
    suggestedAllInEv: ev.adjustedProfit,
    actualProfit,
    luckDelta: ev.luckDelta,
    missingFields: [],
    hasUnverifiedAllInEvField: unverifiedAllInEv,
    actionExcerpt: text.replace(/\s+/g, ' ').slice(0, 220)
  }
}

function summarize(results) {
  return results.reduce((summary, item) => {
    summary.total += 1
    summary.status[item.status] = (summary.status[item.status] || 0) + 1
    if (item.detectedStreet) {
      summary.street[item.detectedStreet] = (summary.street[item.detectedStreet] || 0) + 1
    }
    if (item.status !== 'river_actual_profit') summary.nonRiverCandidates += 1
    if (item.hasUnverifiedAllInEvField) summary.unverifiedAllInEvFields += 1
    return summary
  }, {
    total: 0,
    nonRiverCandidates: 0,
    unverifiedAllInEvFields: 0,
    status: {},
    street: {}
  })
}

function buildPreview(backup) {
  const hands = Array.isArray(backup.hands) ? backup.hands : []
  const results = hands
    .map(hand => {
      const item = classifyHand(hand)
      if (item.status === 'not_all_in') return null
      return {
        id: hand._id,
        date: hand.playedDate || hand.date || '',
        sessionId: hand.sessionId || '',
        profit: roundMoney(hand.currentProfit),
        heroCards: hand.heroCardsInput || hand.heroCards || '',
        opponentCards: opponentCardsOf(hand),
        board: hand.board || null,
        allInPot: allInPotOf(hand) || '',
        heroInvested: hand.heroInvested || '',
        heroEquityPct: hand.heroEquityPct || '',
        currentAllInEv: hasValue(hand.allInEv) ? hand.allInEv : '',
        currentAllInEvStatus: hand.allInEvStatus || '',
        currentAllInEvSource: hand.allInEvSource || '',
        ...item
      }
    })
    .filter(Boolean)

  return {
    generatedAt: new Date().toISOString(),
    source: 'feishu-history-merged-backup',
    summary: summarize(results),
    results
  }
}

function buildMarkdown(preview) {
  const { summary } = preview
  const lines = [
    '# All-in EV \u56de\u586b\u9884\u89c8',
    '',
    `\u751f\u6210\u65f6\u95f4: ${preview.generatedAt}`,
    '',
    '## \u6c47\u603b',
    '',
    `- All-in \u6587\u672c\u5019\u9009: ${summary.total}`,
    `- \u975e\u6cb3\u724c\u5019\u9009: ${summary.nonRiverCandidates}`,
    `- \u5df2\u6709\u53ef\u4fe1\u8ba1\u7b97: ${summary.status.already_calculated || 0}`,
    `- \u672c\u6b21\u53ef\u81ea\u52a8\u8ba1\u7b97\u9884\u89c8: ${summary.status.calculated_preview || 0}`,
    `- \u6cb3\u724c All-in \u6309\u5b9e\u9645\u76c8\u4e8f: ${summary.status.river_actual_profit || 0}`,
    `- \u9700\u8981\u9010\u624b\u8865\u5b57\u6bb5: ${summary.status.needs_manual_fields || 0}`,
    `- \u5b58\u5728\u672a\u9a8c\u8bc1 allInEv \u5b57\u6bb5: ${summary.unverifiedAllInEvFields}`,
    '',
    '## \u9700\u8981\u9010\u624b\u8865\u5b57\u6bb5\u7684\u5019\u9009',
    '',
    '| ID | \u65e5\u671f | \u8857\u9053 | \u76c8\u4e8f | \u7f3a\u5c11\u5b57\u6bb5 | \u6458\u8981 |',
    '| --- | --- | --- | ---: | --- | --- |'
  ]

  preview.results
    .filter(item => item.status === 'needs_manual_fields')
    .forEach(item => {
      const excerpt = String(item.actionExcerpt || '').replace(/\|/g, '/')
      lines.push(`| ${item.id} | ${item.date} | ${item.detectedStreet} | ${item.profit} | ${item.missingFields.join(', ')} | ${excerpt} |`)
    })

  return `${lines.join('\n')}\n`
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join(';') : String(value ?? '')
  return `"${text.replace(/"/g, '""')}"`
}

function buildManualFillCsv(preview) {
  const header = [
    'id',
    'date',
    'detectedStreet',
    'profit',
    'heroCards',
    'opponentCards',
    'board',
    'allInPot',
    'heroInvested',
    'heroEquityPct',
    'missingFields',
    'actionExcerpt'
  ]
  const rows = preview.results
    .filter(item => item.status === 'needs_manual_fields')
    .map(item => [
      item.id,
      item.date,
      item.detectedStreet,
      item.profit,
      item.heroCards,
      item.opponentCards,
      item.board ? JSON.stringify(item.board) : '',
      item.allInPot,
      item.heroInvested,
      item.heroEquityPct,
      item.missingFields,
      item.actionExcerpt
    ])

  return [header, ...rows].map(row => row.map(csvCell).join(',')).join('\n') + '\n'
}

function parseArgs(argv) {
  const args = {}
  for (let index = 2; index < argv.length; index += 1) {
    const item = argv[index]
    if (!item.startsWith('--')) continue
    const key = item.slice(2)
    const value = argv[index + 1] && !argv[index + 1].startsWith('--')
      ? argv[++index]
      : true
    args[key] = value
  }
  return args
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf8')
}

function main() {
  const args = parseArgs(process.argv)
  const inputPath = args.input || path.resolve(__dirname, '..', 'docs', 'import', 'feishu-history-merged-backup.json')
  const outJsonPath = args.outJson || path.resolve(__dirname, '..', 'docs', 'import', 'all-in-ev-backfill-preview.json')
  const outMdPath = args.outMd || path.resolve(__dirname, '..', 'docs', 'import', 'all-in-ev-backfill-preview.md')
  const outCsvPath = args.outCsv || path.resolve(__dirname, '..', 'docs', 'import', 'all-in-ev-manual-fill.csv')
  const backup = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
  const preview = buildPreview(backup)

  writeFile(outJsonPath, JSON.stringify(preview, null, 2))
  writeFile(outMdPath, buildMarkdown(preview))
  writeFile(outCsvPath, buildManualFillCsv(preview))
  console.log(JSON.stringify({
    input: inputPath,
    outJson: outJsonPath,
    outMd: outMdPath,
    outCsv: outCsvPath,
    summary: preview.summary
  }, null, 2))
}

if (require.main === module) {
  main()
}

module.exports = {
  buildPreview,
  buildManualFillCsv,
  classifyHand,
  containsAllIn,
  detectAllInStreet,
  summarize
}
