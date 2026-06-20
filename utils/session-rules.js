const ACTIVE_SESSION_ERROR_CODE = 'ACTIVE_SESSION_EXISTS'
const ACTIVE_SESSION_MESSAGE = '创建新 Session 前需先结束当前 Session'

function findActiveSession(sessions) {
  return (sessions || []).find(item => item && item.status === 'active') || null
}

function assertCanCreateSession(sessions) {
  const activeSession = findActiveSession(sessions)
  if (!activeSession) return true
  const error = new Error(ACTIVE_SESSION_MESSAGE)
  error.code = ACTIVE_SESSION_ERROR_CODE
  error.activeSessionId = activeSession._id || ''
  throw error
}

module.exports = {
  ACTIVE_SESSION_ERROR_CODE,
  ACTIVE_SESSION_MESSAGE,
  findActiveSession,
  assertCanCreateSession
}
