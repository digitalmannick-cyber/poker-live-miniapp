const cloud = require('wx-server-sdk')
const { createSocialApp } = require('./app')
const identity = require('./lib/identity')
const { createCloudSocialRepository } = require('./lib/repository')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const repository = typeof cloud.database === 'function'
  ? createCloudSocialRepository(cloud.database())
  : null

async function avatarUrl(fileId) {
  if (!fileId || typeof cloud.getTempFileURL !== 'function') return ''
  const response = await cloud.getTempFileURL({ fileList: [fileId] })
  return String(response && response.fileList && response.fileList[0] && response.fileList[0].tempFileURL || '')
}

const app = createSocialApp({
  identity,
  repository,
  avatarUrl,
  requestId: () => 'social_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10)
})

exports.main = async function main(event, context) {
  const wxContext = typeof cloud.getWXContext === 'function' ? cloud.getWXContext() : {}
  return app.handle(event || {}, Object.assign({}, context || {}, { openId: wxContext.OPENID }))
}
