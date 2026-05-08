const cloudUtils = require('../utils/cloud')

const ASR_FUNCTION_NAME = 'doubao_asr'

function buildCloudPath(tempFilePath) {
  const ext = String(tempFilePath || '').split('.').pop() || 'aac'
  return `voice-input/${Date.now()}-${Math.floor(Math.random() * 10000)}.${ext}`
}

async function transcribeAudioFile(tempFilePath, options) {
  if (!tempFilePath) {
    const error = new Error('missing temp audio file')
    error.code = 'MISSING_AUDIO'
    throw error
  }
  const config = options || {}

  if (!cloudUtils.canUseCloud() || !wx.cloud) {
    const error = new Error('cloud unavailable')
    error.code = 'CLOUD_UNAVAILABLE'
    throw error
  }

  const upload = await wx.cloud.uploadFile({
    cloudPath: buildCloudPath(tempFilePath),
    filePath: tempFilePath
  })

  const result = await wx.cloud.callFunction({
    name: ASR_FUNCTION_NAME,
    data: {
      fileID: upload.fileID,
      format: config.format || 'aac',
      sampleRate: config.sampleRate || 16000
    }
  })

  const text =
    result?.result?.text ||
    result?.result?.transcript ||
    ''

  if (!text) {
    const error = new Error(result?.result?.message || 'empty transcript')
    error.code = result?.result?.code || 'EMPTY_TRANSCRIPT'
    throw error
  }

  return {
    text,
    fileID: upload.fileID,
    provider: result?.result?.provider || 'doubao'
  }
}

module.exports = {
  ASR_FUNCTION_NAME,
  transcribeAudioFile
}
