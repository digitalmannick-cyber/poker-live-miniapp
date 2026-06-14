const { CLOUD_ENV_ID, PREFER_CLOUD } = require('../config/cloud')

let hasInitialized = false

function formatError(error) {
  if (!error) return 'unknown error'
  return error.errMsg || error.message || String(error)
}

function initCloud() {
  if (hasInitialized) return true
  if (!wx.cloud) return false

  const options = {
    traceUser: true
  }

  if (CLOUD_ENV_ID) {
    options.env = CLOUD_ENV_ID
  }

  try {
    wx.cloud.init(options)
    hasInitialized = true
    return true
  } catch (error) {
    console.warn('cloud init failed: ' + formatError(error))
    return false
  }
}

function canUseCloud() {
  return !!(PREFER_CLOUD && wx.cloud && initCloud())
}

function getDb() {
  if (!canUseCloud()) return null
  try {
    return wx.cloud.database()
  } catch (error) {
    console.warn('get cloud db failed: ' + formatError(error))
    return null
  }
}

module.exports = {
  initCloud,
  canUseCloud,
  getDb
}
