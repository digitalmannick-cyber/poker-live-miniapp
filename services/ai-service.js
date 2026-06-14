const voiceService = require('./voice-service')

const TASKS = {
  REVIEW_HAND_VOICE: 'review_hand_voice',
  HAND_COACHING: 'hand_coaching'
}

async function reviewHandVoice(payload) {
  return voiceService.reviewHandVoice(Object.assign({}, payload, {
    aiTask: TASKS.REVIEW_HAND_VOICE
  }))
}

async function requestHandCoaching(payload) {
  return voiceService.reviewHandVoice(Object.assign({}, payload, {
    aiTask: TASKS.HAND_COACHING
  }))
}

async function chatWithPokerAgent(payload) {
  return voiceService.reviewHandVoice(Object.assign({}, payload, {
    mode: 'chat',
    aiTask: 'agent_chat'
  }))
}

async function summarizeSession(payload) {
  return voiceService.reviewHandVoice(Object.assign({}, payload, {
    mode: 'session_summary',
    aiTask: 'session_summary'
  }))
}

module.exports = {
  TASKS,
  reviewHandVoice,
  requestHandCoaching,
  chatWithPokerAgent,
  summarizeSession
}
