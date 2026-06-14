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

async function reviewHandVoice(payload) {
  return callCloudFunction(REVIEW_FUNCTION_NAME, payload, {
    allowNonZero: true,
    retries: 1
  })
}

module.exports = {
  ASR_FUNCTION_NAME,
  REVIEW_FUNCTION_NAME,
  transcribeAudioFile,
  reviewHandVoice
}
