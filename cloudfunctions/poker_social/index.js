const cloud = require('wx-server-sdk')
const { createSocialApp } = require('./app')
const identity = require('./lib/identity')
const { createCloudSocialRepository } = require('./lib/repository')
const { createAdminPolicy } = require('./lib/admin-policy')
const { toUploadSource } = require('./lib/upload-source')
const { createCommentTextSafety } = require('./lib/comment-safety')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const repository = typeof cloud.database === 'function'
  ? createCloudSocialRepository(cloud.database())
  : null
const adminPolicy = createAdminPolicy(process.env.SOCIAL_ADMIN_OPENIDS)

function reportError(details) {
  const source = details || {}
  const message = String(source.message || '')
    .replace(/cloud:\/\/\S+/gi, '[cloud-file]')
    .replace(/[A-Za-z0-9_-]{28,}/g, '[redacted]')
    .slice(0, 500)
  console.error('[poker_social_error]', JSON.stringify({
    action: String(source.action || ''),
    requestId: String(source.requestId || ''),
    code: String(source.code || ''),
    errCode: String(source.errCode || ''),
    name: String(source.name || ''),
    message
  }))
}

async function avatarUrl(fileId) {
  if (!fileId || typeof cloud.getTempFileURL !== 'function') return ''
  const response = await cloud.getTempFileURL({ fileList: [fileId] })
  return String(response && response.fileList && response.fileList[0] && response.fileList[0].tempFileURL || '')
}

async function uploadTempFile(payload) {
  if (!payload || typeof cloud.uploadFile !== 'function' || typeof cloud.getTempFileURL !== 'function') return { url: '' }
  const uploaded = await cloud.uploadFile({ cloudPath: payload.cloudPath, fileContent: toUploadSource(payload.fileContent) })
  const fileId = uploaded && (uploaded.fileID || uploaded.fileId)
  if (!fileId) return { url: '' }
  return { url: await avatarUrl(fileId) }
}

const app = createSocialApp({
  identity,
  repository,
  isAdminActor: adminPolicy.isAdminActor,
  reportError,
  avatarUrl,
  interaction: {
    checkCommentText: createCommentTextSafety(cloud.openapi)
  },
  friendship: {
    qrCode: cloud.openapi && cloud.openapi.wxacode,
    uploadTempFile,
    tokenSecret: process.env.SOCIAL_INVITE_TOKEN_SECRET,
    qrEnvVersion: process.env.SOCIAL_INVITE_QR_ENV_VERSION || 'trial'
  },
  requestId: () => 'social_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10)
})

exports.main = async function main(event, context) {
  const wxContext = typeof cloud.getWXContext === 'function' ? cloud.getWXContext() : {}
  return app.handle(event || {}, Object.assign({}, context || {}, { openId: wxContext.OPENID }))
}
