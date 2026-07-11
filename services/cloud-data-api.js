const cloudUtils = require('../utils/cloud')

const DATA_FUNCTION_NAME = 'poker_data'

function normalizePlayerId(value) {
  return String(value || '').trim().toUpperCase()
}

function ensureCloudFunctionReady() {
  if (!cloudUtils.canUseCloud() || !wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    throw new Error('cloud data function unavailable')
  }
}

async function callDataFunction(action, payload) {
  ensureCloudFunctionReady()
  const result = await wx.cloud.callFunction({
    name: DATA_FUNCTION_NAME,
    data: Object.assign({}, payload || {}, { action })
  })
  const body = result && result.result ? result.result : {}
  if (body.code && body.code !== 0) {
    const error = new Error(body.message || DATA_FUNCTION_NAME + ' failed')
    error.code = body.code
    error.raw = body
    throw error
  }
  return body.data || {}
}

function syncAndGetStats(options) {
  const config = options || {}
  return callDataFunction('sync_stats', {
    playerId: normalizePlayerId(config.playerId),
    backup: config.backup || {},
    rangeKey: config.rangeKey || 'all'
  })
}

function recoverBestBackup(options) {
  const config = options || {}
  return callDataFunction('recover_best_backup', {
    currentPlayerId: normalizePlayerId(config.currentPlayerId)
  })
}

function loginAccount(options) {
  const config = options || {}
  const backup = config.backup || {}
  return callDataFunction('login_account', {
    currentPlayerId: normalizePlayerId(config.currentPlayerId),
    profile: config.profile || backup.profile || {},
    includeBackup: config.includeBackup === true
  })
}

function exportBackupPage(options) {
  const config = options || {}
  return callDataFunction('export_backup_page', {
    playerId: normalizePlayerId(config.playerId),
    collection: config.collection,
    offset: Number(config.offset) || 0,
    limit: Number(config.limit) || 100
  })
}

function exportAgentData(options) {
  const config = options || {}
  return callDataFunction('agent_export', {
    playerId: normalizePlayerId(config.playerId),
    rangeKey: config.rangeKey || 'last7',
    range: config.range || null,
    nowMs: config.nowMs || 0
  })
}

function sendAiReminderSubscribeMessage(options) {
  const config = options || {}
  return callDataFunction('send_ai_reminder_subscribe', {
    templateId: String(config.templateId || '').trim(),
    reminder: config.reminder || {}
  })
}

function saveSettings(options) {
  const config = options || {}
  return callDataFunction('save_settings', {
    playerId: normalizePlayerId(config.playerId),
    settings: config.settings || {}
  })
}

function createSession(options) {
  const config = options || {}
  return callDataFunction('create_session', {
    playerId: normalizePlayerId(config.playerId),
    clientMutationId: config.clientMutationId || '',
    payload: config.payload || {}
  })
}

function updateSession(options) {
  const config = options || {}
  return callDataFunction('update_session', {
    playerId: normalizePlayerId(config.playerId),
    clientMutationId: config.clientMutationId || '',
    sessionId: config.sessionId || '',
    patch: config.patch || {}
  })
}

function finishSession(options) {
  const config = options || {}
  return callDataFunction('finish_session', {
    playerId: normalizePlayerId(config.playerId),
    clientMutationId: config.clientMutationId || '',
    sessionId: config.sessionId || '',
    payload: config.payload || {}
  })
}

function createHand(options) {
  const config = options || {}
  return callDataFunction('create_hand', {
    playerId: normalizePlayerId(config.playerId),
    clientMutationId: config.clientMutationId || '',
    payload: config.payload || {}
  })
}

function updateHand(options) {
  const config = options || {}
  return callDataFunction('update_hand', {
    playerId: normalizePlayerId(config.playerId),
    clientMutationId: config.clientMutationId || '',
    handId: config.handId || '',
    patch: config.patch || {}
  })
}

function upsertHand(options) {
  const config = options || {}
  const payload = config.payload || {}
  return callDataFunction('upsert_hand', {
    playerId: normalizePlayerId(config.playerId),
    clientMutationId: config.clientMutationId || '',
    handId: config.handId || payload._id || '',
    payload
  })
}

function deleteHand(options) {
  const config = options || {}
  return callDataFunction('delete_hand', {
    playerId: normalizePlayerId(config.playerId),
    clientMutationId: config.clientMutationId || '',
    handId: config.handId || ''
  })
}

function deleteSession(options) {
  const config = options || {}
  return callDataFunction('delete_session', {
    playerId: normalizePlayerId(config.playerId),
    clientMutationId: config.clientMutationId || '',
    sessionId: config.sessionId || ''
  })
}

function listPlayerNotes(options) {
  const config = options || {}
  return callDataFunction('list_player_notes', {
    playerId: normalizePlayerId(config.playerId),
    includeArchived: config.includeArchived === true
  })
}

function createPlayerNote(options) {
  const config = options || {}
  return callDataFunction('create_player_note', {
    playerId: normalizePlayerId(config.playerId),
    clientMutationId: config.clientMutationId || '',
    payload: config.payload || {}
  })
}

function updatePlayerNote(options) {
  const config = options || {}
  return callDataFunction('update_player_note', {
    playerId: normalizePlayerId(config.playerId),
    clientMutationId: config.clientMutationId || '',
    noteId: config.noteId || '',
    patch: config.patch || {}
  })
}

function deletePlayerNote(options) {
  const config = options || {}
  return callDataFunction('delete_player_note', {
    playerId: normalizePlayerId(config.playerId),
    clientMutationId: config.clientMutationId || '',
    noteId: config.noteId || ''
  })
}

function listPlayerNoteHands(options) {
  const config = options || {}
  return callDataFunction('list_player_note_hands', {
    playerId: normalizePlayerId(config.playerId),
    noteId: config.noteId || ''
  })
}

function getPlayerNoteHandReplay(options) {
  const config = options || {}
  return callDataFunction('get_player_note_hand_replay', {
    playerId: normalizePlayerId(config.playerId),
    noteId: config.noteId || '',
    handId: config.handId || ''
  })
}

module.exports = {
  DATA_FUNCTION_NAME,
  syncAndGetStats,
  saveSettings,
  createSession,
  updateSession,
  finishSession,
  createHand,
  updateHand,
  upsertHand,
  deleteHand,
  deleteSession,
  listPlayerNotes,
  createPlayerNote,
  updatePlayerNote,
  deletePlayerNote,
  listPlayerNoteHands,
  getPlayerNoteHandReplay,
  recoverBestBackup,
  loginAccount,
  exportBackupPage,
  exportAgentData,
  sendAiReminderSubscribeMessage,
  __test: {
    normalizePlayerId
  }
}
