const cloud = require('wx-server-sdk')
const { createProductionGateway } = require('./gateway')
const PRIVACY_GATEWAY_VERSION = 'pseudonymousAgentUserId-v1'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const gateway = createProductionGateway(process.env)

exports.main = async event => {
  const identity = typeof cloud.getWXContext === 'function' ? cloud.getWXContext() : {}
  return gateway.handle(event || {}, identity || {})
}

module.exports.__test = {
  createProductionGateway,
  PRIVACY_GATEWAY_VERSION
}
