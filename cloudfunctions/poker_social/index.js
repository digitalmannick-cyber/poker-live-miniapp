const cloud = require('wx-server-sdk')
const { createSocialApp } = require('./app')
const identity = require('./lib/identity')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const app = createSocialApp({
  identity,
  handlers: {},
  requestId: () => 'social_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10)
})

exports.main = async function main(event, context) {
  const wxContext = typeof cloud.getWXContext === 'function' ? cloud.getWXContext() : {}
  return app.handle(event || {}, Object.assign({}, context || {}, { openId: wxContext.OPENID }))
}
