const test = require('node:test')
const assert = require('node:assert/strict')

const cards = require('../utils/agent-reminder-cards')

test('text reminders use the yellow warning card variant', () => {
  const message = cards.buildReminderChatPayload({
    type: 'text_reminder',
    title: '不要 overcall',
    message: '连输后检查是否无计划跟注'
  })

  assert.equal(message.reminder, true)
  assert.equal(message.reminderCard.variant, 'warning')
  assert.equal(message.reminderCard.tone, 'yellow')
  assert.equal(message.reminderCard.acknowledgeRequired, true)
  assert.equal(message.reminderCard.acknowledged, false)
  assert.equal(message.reminderCard.actionLabel, '我已知晓')
})

test('non text reminders use the red strong card variant', () => {
  const message = cards.buildReminderChatPayload({
    type: 'trailing_profit',
    title: '移动止盈触发',
    message: '当前回撤已超过你设置的 20%'
  })

  assert.equal(message.reminderCard.variant, 'strong')
  assert.equal(message.reminderCard.tone, 'red')
})

test('unacknowledged reminder cards block closing the EV brain window', () => {
  const message = cards.buildReminderChatPayload({
    type: 'session_max_hours',
    title: 'Session 时长',
    message: '已达到你设置的时长上限'
  })

  assert.equal(cards.hasBlockingReminder([message]), true)

  const acknowledged = Object.assign({}, message, {
    reminderCard: Object.assign({}, message.reminderCard, { acknowledged: true })
  })

  assert.equal(cards.hasBlockingReminder([acknowledged]), false)
})
