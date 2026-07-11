function normalizePlayerId(value) {
  return String(value || '').trim().toUpperCase()
}

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv : []
  const result = {}
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index]
    if (!/^--/.test(item)) continue
    const key = item.slice(2)
    const next = args[index + 1]
    if (!next || /^--/.test(next)) {
      result[key] = true
    } else {
      result[key] = next
      index += 1
    }
  }
  return result
}

function buildPayload(options) {
  const config = options || {}
  const payload = {
    action: 'agent_export',
    playerId: normalizePlayerId(config.playerId),
    rangeKey: config.rangeKey || 'last7'
  }
  if (config.from || config.to) {
    payload.range = {
      from: config.from || '',
      to: config.to || ''
    }
    delete payload.rangeKey
  }
  return payload
}

function buildRequest(options) {
  const config = options || {}
  const url = String(config.url || '').trim()
  const token = String(config.token || '').trim()
  if (!url) throw new Error('missing POKER_DATA_HTTP_URL or --url')
  if (!token) throw new Error('missing AGENT_EXPORT_TOKEN or --token')
  const payload = buildPayload(config)
  if (!payload.playerId) throw new Error('missing POKER_AGENT_PLAYER_ID or --player-id')
  return {
    url,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token
      },
      body: JSON.stringify(payload)
    }
  }
}

async function fetchAgentExport(options, fetchImpl) {
  const request = buildRequest(options)
  const fetchFn = fetchImpl || global.fetch
  if (typeof fetchFn !== 'function') {
    throw new Error('global fetch unavailable; use Node.js 18+')
  }
  const response = await fetchFn(request.url, request.init)
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch (error) {
    throw new Error('agent export returned non-JSON response: ' + text.slice(0, 200))
  }
  if (!response.ok) {
    throw new Error('agent export HTTP ' + response.status + ': ' + (body.message || text))
  }
  if (body.code && body.code !== 0) {
    throw new Error('agent export failed: ' + (body.message || body.code))
  }
  return body.data || body
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const data = await fetchAgentExport({
    url: args.url || process.env.POKER_DATA_HTTP_URL,
    token: args.token || process.env.AGENT_EXPORT_TOKEN,
    playerId: args['player-id'] || process.env.POKER_AGENT_PLAYER_ID,
    rangeKey: args.range || process.env.POKER_AGENT_RANGE || 'last7',
    from: args.from || '',
    to: args.to || ''
  })
  process.stdout.write(JSON.stringify(data, null, 2) + '\n')
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write((error && error.message || String(error)) + '\n')
    process.exitCode = 1
  })
}

module.exports = {
  normalizePlayerId,
  parseArgs,
  buildPayload,
  buildRequest,
  fetchAgentExport
}
