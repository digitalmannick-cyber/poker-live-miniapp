const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const REPORT_PATH = path.join(ROOT, 'docs', 'poker-agent-evolution-monitor.md')

const SOURCES = [
  'cloudfunctions/poker_review/index.js',
  'cloudfunctions/poker_review/gateway.js',
  'pages/review-list/review-list.js',
  'services/voice-service.js',
  'tests/review-frontend-no-local-semantic-fallback.test.js',
  'tests/poker-review-stake-normalize.test.js',
  'tests/poker-agent-two-stage.test.js',
  'tests/review-agent-advice.test.js',
  'tests/review-missing-field-ux.test.js'
]

const FORBIDDEN_FRONTEND_PATTERNS = [
  'utils/voice-parser',
  'utils/ai-normalizer',
  'parseVoiceText',
  'postProcessReviewResult',
  'applyCorpusSpeechFallback',
  'applySpeechFieldCorrections',
  'applySpeechStreetCorrections',
  'applyMultiwayFlopPotCorrection',
  'applyPreflopPotInference',
  'normalizeStreetPotFlow'
]

const BACKEND_SIGNALS = [
  { key: 'agent_gateway', label: 'Agent gateway', patterns: ['poker-agent', 'extract_hand_fields', 'mode'] },
  { key: 'structured_fields', label: 'Structured fields', patterns: ['extractedHand', 'streetInputs', 'missingFields', 'followUpQuestions'] },
  { key: 'pot_ledger', label: 'Backend pot ledger', patterns: ['potBefore', 'potAfter', 'contribution', 'uncalledReturn', 'settledPot'] }
]

function readSource(relativePath) {
  const absolute = path.join(ROOT, relativePath)
  if (!fs.existsSync(absolute)) return ''
  return fs.readFileSync(absolute, 'utf8')
}

function countPattern(source, pattern) {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return (source.match(new RegExp(escaped, 'g')) || []).length
}

function collectForbiddenFrontendHits() {
  const files = SOURCES
    .filter(file => file.startsWith('pages/') || file.startsWith('services/') || file.startsWith('utils/'))
    .map(file => ({ file, source: readSource(file) }))

  return files.flatMap(item => {
    return FORBIDDEN_FRONTEND_PATTERNS
      .filter(pattern => countPattern(item.source, pattern) > 0)
      .map(pattern => ({ file: item.file, pattern }))
  })
}

function collectBackendSignals() {
  const files = SOURCES.map(file => ({ file, source: readSource(file) }))
  return BACKEND_SIGNALS.map(signal => {
    const hits = files
      .map(item => {
        const count = signal.patterns.reduce((sum, pattern) => sum + countPattern(item.source, pattern), 0)
        return count ? { file: item.file, count } : null
      })
      .filter(Boolean)
      .sort((a, b) => b.count - a.count)
    return Object.assign({}, signal, { hits })
  })
}

function renderReport() {
  const date = new Date().toISOString().slice(0, 10)
  const forbiddenHits = collectForbiddenFrontendHits()
  const signals = collectBackendSignals()
  const lines = [
    '# Poker Agent Evolution Monitor',
    '',
    `Generated: ${date}`,
    '',
    'This report tracks the intended boundary: the miniapp displays, edits, confirms, and saves structured Agent output. Semantic extraction, action meaning, and pot math belong in Agent/backend code.',
    '',
    '## Frontend Boundary',
    ''
  ]

  if (!forbiddenHits.length) {
    lines.push('- No local semantic parser/normalizer references were found in miniapp runtime sources.')
  } else {
    forbiddenHits.forEach(hit => {
      lines.push(`- ${hit.file}: forbidden reference \`${hit.pattern}\``)
    })
  }

  lines.push('')
  lines.push('## Backend Signals')
  lines.push('')
  signals.forEach(signal => {
    lines.push(`### ${signal.label}`)
    if (!signal.hits.length) {
      lines.push('- No signal found.')
    } else {
      signal.hits.slice(0, 8).forEach(hit => {
        lines.push(`- ${hit.file}: ${hit.count}`)
      })
    }
    lines.push('')
  })

  lines.push('## Rule')
  lines.push('')
  lines.push('- Do not reintroduce miniapp-side transcript parsing, semantic correction, or pot inference.')
  lines.push('- If a durable extraction rule is needed, implement it in poker-agent/backend and return it as structured Agent output.')
  lines.push('- Miniapp code may format display values, validate required fields, and persist user-confirmed structured fields.')
  lines.push('')
  return lines.join('\n')
}

function main() {
  const report = renderReport()
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  fs.writeFileSync(REPORT_PATH, report, 'utf8')
  console.log(`wrote ${path.relative(ROOT, REPORT_PATH)}`)
}

if (require.main === module) {
  main()
}

module.exports = {
  collectForbiddenFrontendHits,
  collectBackendSignals,
  renderReport,
  FORBIDDEN_FRONTEND_PATTERNS
}
