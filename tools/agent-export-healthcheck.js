const client = require('./agent-export-client')

const REQUIRED_ENV = [
  'POKER_DATA_HTTP_URL',
  'AGENT_EXPORT_TOKEN',
  'POKER_AGENT_PLAYER_ID'
]

function validateConfig(env) {
  const source = env || {}
  const missing = REQUIRED_ENV.filter(key => !String(source[key] || '').trim())
  return {
    ok: missing.length === 0,
    missing
  }
}

function validateAgentExportData(data) {
  const source = data || {}
  const summary = source.summary || {}
  const extremes = source.extremes || {}
  const errors = []

  if (!Number.isFinite(Number(summary.totalProfit))) {
    errors.push('summary.totalProfit must be a number')
  }
  if (!Number.isFinite(Number(summary.handCount))) {
    errors.push('summary.handCount must be a number')
  }
  if (!Object.prototype.hasOwnProperty.call(extremes, 'biggestWinningHand')) {
    errors.push('extremes.biggestWinningHand missing')
  }
  if (!Object.prototype.hasOwnProperty.call(extremes, 'biggestLosingHand')) {
    errors.push('extremes.biggestLosingHand missing')
  }
  if (!Array.isArray(source.hands)) {
    errors.push('hands must be an array')
  }

  return {
    ok: errors.length === 0,
    errors
  }
}

async function runHealthcheck(options) {
  const config = Object.assign({}, process.env, options || {})
  const envCheck = validateConfig(config)
  if (!envCheck.ok) {
    return {
      ok: false,
      stage: 'config',
      missing: envCheck.missing
    }
  }

  const data = await client.fetchAgentExport({
    url: config.POKER_DATA_HTTP_URL,
    token: config.AGENT_EXPORT_TOKEN,
    playerId: config.POKER_AGENT_PLAYER_ID,
    rangeKey: config.POKER_AGENT_RANGE || 'last7',
    from: config.POKER_AGENT_RANGE_FROM || '',
    to: config.POKER_AGENT_RANGE_TO || ''
  })
  const dataCheck = validateAgentExportData(data)
  if (!dataCheck.ok) {
    return {
      ok: false,
      stage: 'response',
      errors: dataCheck.errors,
      data
    }
  }

  return {
    ok: true,
    stage: 'complete',
    summary: data.summary,
    biggestWinningHand: data.extremes.biggestWinningHand,
    biggestLosingHand: data.extremes.biggestLosingHand
  }
}

async function main() {
  const result = await runHealthcheck()
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  if (!result.ok) {
    process.exitCode = 1
  }
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write((error && error.message || String(error)) + '\n')
    process.exitCode = 1
  })
}

module.exports = {
  REQUIRED_ENV,
  validateConfig,
  validateAgentExportData,
  runHealthcheck
}
