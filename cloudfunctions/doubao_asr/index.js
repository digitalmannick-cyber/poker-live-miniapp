const cloud = require('wx-server-sdk')
const https = require('https')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value)
  } catch (error) {
    return fallback
  }
}

function getEnvConfig() {
  return {
    endpoint: process.env.VOICE_ASR_URL || process.env.KIMI_AUDIO_ASR_URL || process.env.DOUBAO_ASR_URL || '',
    bearerToken: process.env.VOICE_ASR_BEARER_TOKEN || process.env.KIMI_AUDIO_ASR_BEARER_TOKEN || process.env.DOUBAO_ASR_BEARER_TOKEN || '',
    extraHeaders: safeJsonParse(process.env.VOICE_ASR_HEADERS || process.env.KIMI_AUDIO_ASR_HEADERS || process.env.DOUBAO_ASR_HEADERS || '{}', {}),
    extraPayload: safeJsonParse(process.env.VOICE_ASR_PAYLOAD || process.env.KIMI_AUDIO_ASR_PAYLOAD || process.env.DOUBAO_ASR_PAYLOAD || '{}', {}),
    provider: process.env.VOICE_ASR_PROVIDER || process.env.KIMI_AUDIO_ASR_PROVIDER || process.env.DOUBAO_ASR_PROVIDER || 'doubao'
  }
}

function requestJson(url, payload, headers) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const req = https.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: Object.assign(
          {
            'Content-Type': 'application/json'
          },
          headers || {}
        )
      },
      res => {
        const chunks = []
        res.on('data', chunk => chunks.push(chunk))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          const json = safeJsonParse(raw, null)
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`doubao asr http ${res.statusCode}: ${raw}`))
            return
          }
          resolve(json || { raw })
        })
      }
    )
    req.on('error', reject)
    req.write(JSON.stringify(payload))
    req.end()
  })
}

function pickTranscript(response) {
  const candidates = [
    response?.text,
    response?.transcript,
    response?.result?.text,
    response?.result?.transcript,
    response?.data?.text,
    response?.data?.transcript
  ].filter(Boolean)

  if (candidates.length) return String(candidates[0]).trim()

  if (Array.isArray(response?.utterances) && response.utterances.length) {
    return response.utterances
      .map(item => item?.text || item?.transcript || '')
      .filter(Boolean)
      .join(' ')
      .trim()
  }

  if (Array.isArray(response?.segments) && response.segments.length) {
    return response.segments
      .map(item => item?.text || item?.transcript || '')
      .filter(Boolean)
      .join(' ')
      .trim()
  }

  return ''
}

exports.main = async event => {
  const { fileID, format = 'aac', sampleRate = 16000 } = event || {}
  if (!fileID) {
    return { code: 'MISSING_FILE_ID', message: '缺少 fileID' }
  }

  const config = getEnvConfig()
  if (!config.endpoint) {
    return {
      code: 'MISSING_DOUBAO_CONFIG',
      message: '请先在云函数环境变量中配置 VOICE_ASR_URL / KIMI_AUDIO_ASR_URL / DOUBAO_ASR_URL'
    }
  }

  const download = await cloud.downloadFile({ fileID })
  const fileBuffer = download.fileContent

  if (!fileBuffer || !fileBuffer.length) {
    return {
      code: 'EMPTY_FILE',
      message: '云存储中的录音文件为空'
    }
  }

  const payload = Object.assign({}, config.extraPayload, {
    audio: Buffer.from(fileBuffer).toString('base64'),
    format,
    sampleRate
  })

  const headers = Object.assign({}, config.extraHeaders)
  if (config.bearerToken) {
    headers.Authorization = `Bearer ${config.bearerToken}`
  }

  const response = await requestJson(config.endpoint, payload, headers)
  const text = pickTranscript(response)

  if (!text) {
    return {
      code: 'EMPTY_TRANSCRIPT',
      message: '豆包接口返回成功，但没有识别文本',
      raw: response
    }
  }

  return {
    code: 0,
    provider: config.provider,
    text,
    raw: response
  }
}
