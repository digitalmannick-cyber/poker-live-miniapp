const cloudUtils = require('../utils/cloud')

const ASR_FUNCTION_NAME = 'doubao_asr'
const REVIEW_FUNCTION_NAME = 'poker_review'

function buildCloudPath(tempFilePath) {
  const ext = String(tempFilePath || '').split('.').pop() || 'aac'
  return `voice-input/${Date.now()}-${Math.floor(Math.random() * 10000)}.${ext}`
}

function ensureCloudReady() {
  if (!cloudUtils.canUseCloud() || !wx.cloud) {
    const error = new Error('cloud unavailable')
    error.code = 'CLOUD_UNAVAILABLE'
    throw error
  }
}

async function uploadTempAudioFile(tempFilePath) {
  if (!tempFilePath) {
    const error = new Error('missing temp audio file')
    error.code = 'MISSING_AUDIO'
    throw error
  }

  ensureCloudReady()
  return wx.cloud.uploadFile({
    cloudPath: buildCloudPath(tempFilePath),
    filePath: tempFilePath
  })
}

async function callCloudFunction(name, data, options) {
  ensureCloudReady()
  const config = options || {}
  const retryCount = Number.isFinite(config.retries) ? config.retries : 0
  let lastError = null
  let result = null
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      result = await wx.cloud.callFunction({
        name,
        data: data || {}
      })
      lastError = null
      break
    } catch (error) {
      lastError = error
      if (attempt >= retryCount) break
    }
  }
  if (lastError) {
    lastError.attempts = retryCount + 1
    throw lastError
  }
  const payload = result && result.result ? result.result : {}
  if (!config.allowNonZero && payload.code && payload.code !== 0) {
    const error = new Error(payload.message || `${name} failed`)
    error.code = payload.code
    error.raw = payload
    throw error
  }
  return payload
}

async function transcribeAudioFile(tempFilePath, options) {
  const config = options || {}
  const upload = await uploadTempAudioFile(tempFilePath)
  const payload = await callCloudFunction(ASR_FUNCTION_NAME, {
    fileID: upload.fileID,
    format: config.format || 'aac',
    sampleRate: config.sampleRate || 16000
  })
  const text = payload.text || payload.transcript || ''

  if (!text) {
    const error = new Error(payload.message || 'empty transcript')
    error.code = payload.code || 'EMPTY_TRANSCRIPT'
    throw error
  }

  return {
    text,
    fileID: upload.fileID,
    provider: payload.provider || 'doubao'
  }
}

function firstDefined() {
  for (let index = 0; index < arguments.length; index += 1) {
    if (arguments[index] !== undefined && arguments[index] !== null) return arguments[index]
  }
  return undefined
}

function truncateText(value, limit) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  const max = Number(limit) || 240
  return text.length > max ? text.slice(0, max) + '...' : text
}

function summarizeConflict(conflict) {
  if (!conflict || typeof conflict !== 'object') return ''
  const name = String(conflict.conflict || conflict.type || '').trim()
  const fields = ['actual', 'claimed', 'villain_bet', 'hero_raise_to', 'blocked_rank']
    .map(key => {
      const value = conflict[key]
      if (value === undefined || value === null || value === '') return ''
      return key + '=' + String(value).trim()
    })
    .filter(Boolean)
  return [name, ...fields].filter(Boolean).join(' ')
}

function buildAgentDebugError(agent, envelope) {
  const source = agent && typeof agent === 'object' ? agent : {}
  const data = source.data && typeof source.data === 'object' ? source.data : {}
  const toolCalls = Array.isArray(source.tool_calls) ? source.tool_calls : []
  const failedTool = toolCalls.slice().reverse().find(item => {
    const status = String(item && item.status || '')
    return status && status !== 'ok'
  }) || toolCalls[toolCalls.length - 1] || null
  const toolInput = failedTool && failedTool.input && typeof failedTool.input === 'object'
    ? failedTool.input
    : {}
  const llmError = data.llm_error || data.llmError || {}
  const parts = ['EV脑出问题啦，请稍后再重新生成AI建议。']
  const status = String(
    (failedTool && failedTool.status) ||
    llmError.status ||
    llmError.type ||
    ''
  ).trim()
  if (failedTool && failedTool.name) parts.push('tool=' + failedTool.name)
  if (status) parts.push('status=' + status)
  const conflicts = Array.isArray(toolInput.conflicts)
    ? toolInput.conflicts
    : (Array.isArray(llmError.conflicts) ? llmError.conflicts : [])
  const conflictText = conflicts.map(summarizeConflict).filter(Boolean).join(',')
  if (conflictText) parts.push('conflict=' + conflictText)
  const excerpt = truncateText(toolInput.review_excerpt || toolInput.content_excerpt || llmError.content_excerpt || '', 220)
  if (excerpt) parts.push('excerpt=' + excerpt)
  const requestId = String(
    source.requestId ||
    (envelope && envelope.requestId) ||
    ''
  ).trim()
  if (requestId) parts.push('requestId=' + requestId)
  return parts.join('\n')
}

function unwrapPokerReviewGateway(payload, requestedMode) {
  const envelope = payload || {}
  if (envelope.ok === false) return envelope

  const agent = envelope.ok === true ? (envelope.data || {}) : envelope
  const data = agent.data || {}
  const mode = requestedMode || agent.mode || ''
  const debugError = agent.intent === 'voice_review_advice_failed'
    ? buildAgentDebugError(agent, envelope)
    : ''
  return Object.assign({}, agent, {
    code: 0,
    ok: true,
    requestId: envelope.requestId || agent.requestId || '',
    status: envelope.status || 200,
    provider: 'poker-agent',
    mode,
    extractedHand: firstDefined(data.extractedHand, data.extracted_hand, agent.extractedHand, agent.extracted_hand),
    missingFields: firstDefined(data.missingFields, data.missing_fields, agent.missingFields, agent.missing_fields, []),
    followUpQuestions: firstDefined(data.followUpQuestions, data.follow_up_questions, agent.followUpQuestions, agent.follow_up_questions, []),
    naturalLanguageSummary: firstDefined(data.naturalLanguageSummary, data.natural_language_summary, agent.naturalLanguageSummary, agent.answer, ''),
    analysis: firstDefined(data.review, data.analysis, agent.analysis, null),
    summary: firstDefined(data.sessionSummary, data.session_summary, data.summary, agent.summary),
    suggestions: firstDefined(data.suggestions, agent.suggestions, []),
    imageUrl: firstDefined(data.imageUrl, data.image_url, data.rangeImageUrl, data.range_image_url, agent.imageUrl, agent.image_url, ''),
    debugError,
    aiReviewError: debugError,
    raw: agent
  })
}

async function reviewHandVoice(payload) {
  const result = await callCloudFunction(REVIEW_FUNCTION_NAME, payload, {
    allowNonZero: true,
    retries: 0
  })
  return unwrapPokerReviewGateway(result, payload && payload.mode)
}

async function calculateAllInEv(hand, context) {
  const payload = {
    mode: 'all_in_ev',
    hand: hand || {},
    context: Object.assign({}, context || {}, { hand: hand || {} })
  }
  const result = await callCloudFunction(REVIEW_FUNCTION_NAME, payload, {
    allowNonZero: true,
    retries: 0
  })
  return unwrapPokerReviewGateway(result, 'all_in_ev')
}

module.exports = {
  ASR_FUNCTION_NAME,
  REVIEW_FUNCTION_NAME,
  calculateAllInEv,
  transcribeAudioFile,
  reviewHandVoice,
  unwrapPokerReviewGateway,
  buildAgentDebugError
}
