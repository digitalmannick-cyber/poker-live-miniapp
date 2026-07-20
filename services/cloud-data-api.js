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

function backfillSessionDurations(options) {
  const config = options || {}
  return callDataFunction('backfill_session_durations', {
    playerId: normalizePlayerId(config.playerId),
    dryRun: config.dryRun !== false
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

function clearAllData(options) {
  const config = options || {}
  return callDataFunction('clear_all_data', {
    playerId: normalizePlayerId(config.playerId),
    clientMutationId: String(config.clientMutationId || '').trim()
  })
}

function buildPlayerNotePayload(input) {
  const source = input || {}
  const payload = {}
  const has = key => Object.prototype.hasOwnProperty.call(source, key)
  const stringKeys = ['_id', 'linkedFriendUserId', 'name', 'avatarUrl', 'avatarFileId', 'avatarText', 'type', 'note', 'lastVenue', 'lastStake']
  stringKeys.forEach(key => {
    if (has(key)) payload[key] = String(source[key] || '').trim()
  })
  if (has('sourceKind')) payload.sourceKind = source.sourceKind === 'friend' ? 'friend' : 'library'
  ;['alias', 'leakTags', 'battleHandIds'].forEach(key => {
    if (has(key)) payload[key] = Array.isArray(source[key]) ? source[key] : []
  })
  ;['lastSeenAt', 'createdAt', 'updatedAt'].forEach(key => {
    if (has(key)) payload[key] = Number(source[key]) || 0
  })
  if (has('archived')) payload.archived = source.archived === true
  return payload
}

function createPlayerNote(options) {
  const config = options || {}
  return callDataFunction('create_player_note', {
    playerId: normalizePlayerId(config.playerId),
    clientMutationId: config.clientMutationId || '',
    payload: buildPlayerNotePayload(config.payload)
  })
}

function updatePlayerNote(options) {
  const config = options || {}
  return callDataFunction('update_player_note', {
    playerId: normalizePlayerId(config.playerId),
    clientMutationId: config.clientMutationId || '',
    noteId: config.noteId || '',
    patch: buildPlayerNotePayload(config.patch)
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

function getPlayerCardImportReceipt(options) {
  const config = options || {}
  return callDataFunction('get_player_card_import_receipt', {
    playerId: normalizePlayerId(config.playerId),
    shareId: String(config.shareId || '').trim()
  })
}

function beginPlayerCardImportReceipt(options) {
  const config = options || {}
  return callDataFunction('begin_player_card_import_receipt', {
    playerId: normalizePlayerId(config.playerId),
    clientMutationId: String(config.clientMutationId || '').trim(),
    shareId: String(config.shareId || '').trim(),
    mode: config.mode === 'overwrite' ? 'overwrite' : 'new',
    targetPlayerNoteId: String(config.targetPlayerNoteId || '').trim()
  })
}

function completePlayerCardImportReceipt(options) {
  const config = options || {}
  return callDataFunction('complete_player_card_import_receipt', {
    playerId: normalizePlayerId(config.playerId),
    clientMutationId: String(config.clientMutationId || '').trim(),
    shareId: String(config.shareId || '').trim()
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
  clearAllData,
  listPlayerNotes,
  createPlayerNote,
  updatePlayerNote,
  deletePlayerNote,
  listPlayerNoteHands,
  getPlayerNoteHandReplay,
  getPlayerCardImportReceipt,
  beginPlayerCardImportReceipt,
  completePlayerCardImportReceipt,
  recoverBestBackup,
  loginAccount,
  exportBackupPage,
  exportAgentData,
  backfillSessionDurations,
  sendAiReminderSubscribeMessage,
  __test: {
    normalizePlayerId,
    buildPlayerNotePayload
  }
}
