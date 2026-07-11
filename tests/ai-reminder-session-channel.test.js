const test = require('node:test')
const assert = require('node:assert/strict')

const aiReminders = require('../utils/ai-reminders')

function evaluateWithSettings(aiReminderSettings) {
  return aiReminders.evaluateAiRemindersAfterHand({
    settings: aiReminderSettings,
    session: {
      _id: 'session_1',
      startTime: '2026-07-09 12:00',
      buyIn: 1000,
      cashOut: 1800
    },
    hand: {
      _id: 'hand_1',
      sessionId: 'session_1'
    },
    nowMs: new Date('2026-07-09T13:00:00').getTime()
  })
}

test('AI reminders default to session timeline instead of EV brain', () => {
  const reminders = evaluateWithSettings({
    enabled: true,
    rules: {
      profitTarget: { amount: 500 }
    }
  })

  assert.equal(reminders.length, 1)
  assert.equal(reminders[0].channels.sessionTimeline, true)
  assert.equal(reminders[0].channels.evBrain, false)
})

test('EV brain remains available when explicitly enabled', () => {
  const reminders = evaluateWithSettings({
    enabled: true,
    rules: {
      profitTarget: { amount: 500, evBrain: true }
    }
  })

  assert.equal(reminders.length, 1)
  assert.equal(reminders[0].channels.sessionTimeline, true)
  assert.equal(reminders[0].channels.evBrain, true)
})
