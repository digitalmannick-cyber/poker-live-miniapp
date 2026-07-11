const https = require('https')
const { randomUUID } = require('crypto')

const SUPPORTED_MODES = new Set(['extract', 'advice', 'chat', 'session_summary', 'all_in_ev'])
const RETRYABLE_STATUS = new Set([502, 503])
const RETRYABLE_ERROR_CODES = new Set(['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNRESET'])

function normalizeMode(value) {
  const mode = String(value || 'extract').trim().toLowerCase()
  if (mode === 'agent_chat') return 'chat'
  if (mode === 'review' || mode === 'analysis') return 'advice'
  if (mode === 'summary' || mode === 'session-summary') return 'session_summary'
  if (mode === 'all-in-ev' || mode === 'allin_ev' || mode === 'allin-ev') return 'all_in_ev'
  return SUPPORTED_MODES.has(mode) ? mode : 'extract'
}

function taskForMode(mode, event) {
  if (event && event.task) return event.task
  return {
    extract: 'extract_hand_fields',
    advice: 'hand_review',
    chat: 'agent_chat',
    session_summary: 'session_summary',
    all_in_ev: 'all_in_ev'
  }[mode]
}

function buildAgentPayload(event, userId, requestId) {
  const source = event || {}
  const sourceContext = source.context && typeof source.context === 'object' ? source.context : {}
  const mode = normalizeMode(source.mode)
  const question = String(
    source.question || source.message || source.transcript || source.text || source.voiceNote || ''
  ).trim()
  const corrections = source.corrections || source.correction || sourceContext.corrections || sourceContext.correction || null
  const voiceTerms = source.voiceTerms || source.userTerms || sourceContext.voiceTerms || sourceContext.userTerms || null
  const context = Object.assign({}, sourceContext, {
    hand: source.hand || source.structuredHand || source.extractedHand || sourceContext.hand || sourceContext.structuredHand || sourceContext.extractedHand || {},
    session: source.session || sourceContext.session || {},
    actions: Array.isArray(source.actions) ? source.actions : (Array.isArray(sourceContext.actions) ? sourceContext.actions : []),
    recentHands: Array.isArray(source.recentHands) ? source.recentHands : (Array.isArray(sourceContext.recentHands) ? sourceContext.recentHands : []),
    hands: Array.isArray(source.hands) ? source.hands : (Array.isArray(sourceContext.hands) ? sourceContext.hands : undefined),
    stats: source.stats || sourceContext.stats || {},
    profile: source.profile || sourceContext.profile || {},
    requestId
  })
  if (corrections) context.corrections = corrections
  if (voiceTerms) context.voiceTerms = voiceTerms
  return {
    user_id: userId,
    mode,
    task: taskForMode(mode, source),
    intent: source.intent || source.chatIntent || source.taskIntent || undefined,
    chat_intent: source.chatIntent || source.intent || source.taskIntent || undefined,
    question,
    transcript: mode === 'extract' ? question : undefined,
    context,
    structuredHand: mode === 'advice'
      ? (source.structuredHand || source.hand || source.extractedHand || {})
      : undefined,
    extractedHand: mode === 'advice'
      ? (source.extractedHand || source.hand || source.structuredHand || {})
      : undefined,
    corrections: corrections || voiceTerms
  }
}

function wait(delay) {
  return new Promise(resolve => setTimeout(resolve, delay))
}

function requestJson(url, payload, headers, timeout) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const body = JSON.stringify(payload)
    const request = https.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      headers: Object.assign({
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }, headers || {}),
      timeout
    }, response => {
      let raw = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { raw += chunk })
      response.on('end', () => {
        let parsed = raw
        try {
          parsed = raw ? JSON.parse(raw) : {}
        } catch (error) {
          // Non-JSON provider pages are never exposed to the miniapp.
        }
        resolve({ status: Number(response.statusCode) || 500, body: parsed })
      })
    })
    request.on('timeout', () => {
      const error = new Error('agent request timeout')
      error.code = 'ETIMEDOUT'
      request.destroy(error)
    })
    request.on('error', reject)
    request.write(body)
    request.end()
  })
}

function safeError(status, requestId) {
  if (status === 429) {
    return {
      ok: false,
      requestId,
      status,
      code: 'AGENT_HTTP_429',
      message: 'EV脑请求过多，请稍后重试',
      retryable: true
    }
  }
  if (status === 502 || status === 503) {
    return {
      ok: false,
      requestId,
      status,
      code: `AGENT_HTTP_${status}`,
      message: 'EV脑服务暂时不可用，请稍后重试',
      retryable: true
    }
  }
  return {
    ok: false,
    requestId,
    status,
    code: `AGENT_HTTP_${status}`,
    message: status >= 500 ? 'EV脑服务异常，请稍后重试' : 'EV脑请求未成功',
    retryable: status >= 500
  }
}

function timeoutError(requestId) {
  return {
    ok: false,
    requestId,
    status: 504,
    code: 'AGENT_TIMEOUT',
    message: 'EV脑服务请求超时，请稍后重试',
    retryable: true
  }
}

function agentReportedStatus(body) {
  const data = body && body.data || {}
  const error = data.llm_error || data.llmError || null
  const status = Number(error && (error.http_status || error.httpStatus))
  return Number.isFinite(status) && status >= 400 ? status : 0
}

function firstDefined() {
  for (let index = 0; index < arguments.length; index += 1) {
    if (arguments[index] !== undefined && arguments[index] !== null && arguments[index] !== '') return arguments[index]
  }
  return ''
}

function normalizeImageUrl(url, baseUrl) {
  const clean = String(url || '').trim().replace(/[，。；、?.;)\]}]+$/g, '')
  if (!clean) return ''
  if (/^https?:\/\//i.test(clean)) return clean
  if (clean[0] === '/' && baseUrl) return String(baseUrl).replace(/\/$/, '') + clean
  return clean
}

function extractResponseImageUrl(body, baseUrl) {
  const source = body || {}
  const data = source.data || {}
  const image = data.image || source.image || {}
  return normalizeImageUrl(firstDefined(
    source.imageUrl,
    source.image_url,
    source.rangeImageUrl,
    source.range_image_url,
    data.imageUrl,
    data.image_url,
    data.rangeImageUrl,
    data.range_image_url,
    image.url,
    image.src
  ), baseUrl)
}

function normalizeAgentResponseBody(body, imageBaseUrl) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body
  const imageUrl = extractResponseImageUrl(body, imageBaseUrl)
  if (!imageUrl) return body
  const next = Object.assign({}, body, { imageUrl })
  const data = next.data && typeof next.data === 'object' && !Array.isArray(next.data)
    ? Object.assign({}, next.data, { imageUrl })
    : next.data
  if (data) next.data = data
  return next
}

function createGateway(options) {
  const config = options || {}
  const requestAgent = config.requestAgent
  const sleep = config.sleep || wait
  const requestIdFactory = config.requestIdFactory || randomUUID
  const imageBaseUrl = String(config.imageBaseUrl || '').replace(/\/$/, '')
  if (typeof requestAgent !== 'function') throw new TypeError('requestAgent is required')

  return {
    async handle(event, identity) {
      const requestId = requestIdFactory()
      const source = event || {}
      const userId = String(
        identity && (identity.openid || identity.OPENID) ||
        source.userId || source.playerId || 'miniapp'
      ).trim() || 'miniapp'
      const payload = buildAgentPayload(source, userId, requestId)
      let lastStatus = 0

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await requestAgent(payload, { requestId })
          const transportStatus = Number(response && response.status) || 500
          const reportedStatus = transportStatus >= 200 && transportStatus < 300
            ? agentReportedStatus(response && response.body)
            : 0
          const status = reportedStatus || transportStatus
          if (status >= 200 && status < 300) {
            return { ok: true, requestId, status, data: normalizeAgentResponseBody(response.body, imageBaseUrl) }
          }
          lastStatus = status
          if (!RETRYABLE_STATUS.has(status) || attempt === 2) return safeError(status, requestId)
        } catch (error) {
          if (!RETRYABLE_ERROR_CODES.has(String(error && error.code || '')) || attempt === 2) {
            return RETRYABLE_ERROR_CODES.has(String(error && error.code || ''))
              ? timeoutError(requestId)
              : safeError(500, requestId)
          }
        }
        await sleep(150 * (attempt + 1))
      }
      return safeError(lastStatus || 500, requestId)
    }
  }
}

function createProductionGateway(env) {
  const source = env || process.env
  const baseUrl = String(source.POKER_AGENT_BASE_URL || 'https://flask-v2u1-267284-4-1429181305.sh.run.tcloudbase.com').replace(/\/$/, '')
  const path = source.POKER_AGENT_ASK_PATH || '/api/v1/agent/ask'
  const timeout = Number(source.POKER_AGENT_TIMEOUT_MS || source.AI_TIMEOUT_MS) || 55000
  const token = source.POKER_AGENT_SERVICE_TOKEN || ''
  return createGateway({
    imageBaseUrl: baseUrl,
    requestAgent(payload, meta) {
      const headers = {
        'X-Request-ID': meta.requestId
      }
      if (token) headers.Authorization = `Bearer ${token}`
      return requestJson(`${baseUrl}${path}`, payload, headers, timeout)
    }
  })
}

module.exports = {
  buildAgentPayload,
  agentReportedStatus,
  createGateway,
  createProductionGateway,
  normalizeAgentResponseBody,
  normalizeMode,
  requestJson,
  safeError
}
