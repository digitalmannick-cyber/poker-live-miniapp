const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

function loadPokerData(state) {
  const previousState = process.env.AI_REMINDER_MINIPROGRAM_STATE
  if (state === undefined) delete process.env.AI_REMINDER_MINIPROGRAM_STATE
  else process.env.AI_REMINDER_MINIPROGRAM_STATE = state
  const sends = []
  const originalLoad = Module._load
  Module._load = function load(request, parent, isMain) {
    if (request === 'wx-server-sdk') {
      return {
        DYNAMIC_CURRENT_ENV: 'test',
        init() {},
        database() { return {} },
        openapi: { subscribeMessage: { async send(input) { sends.push(input); return { errCode: 0 } } } }
      }
    }
    return originalLoad.call(this, request, parent, isMain)
  }
  const modulePath = require.resolve('../cloudfunctions/poker_data/index')
  delete require.cache[modulePath]
  try {
    return { pokerData: require('../cloudfunctions/poker_data/index'), sends }
  } finally {
    Module._load = originalLoad
    if (previousState === undefined) delete process.env.AI_REMINDER_MINIPROGRAM_STATE
    else process.env.AI_REMINDER_MINIPROGRAM_STATE = previousState
  }
}

for (const [configured, expected] of [[undefined, 'trial'], ['trial', 'trial'], ['formal', 'formal']]) {
  test(`AI reminder uses ${expected} mini-program state`, async () => {
    const loaded = loadPokerData(configured)
    const result = await loaded.pokerData.__test.sendAiReminderSubscribeMessage({
      templateId: 'template-1',
      reminder: { title: '提醒', message: '内容', createdAt: 1 }
    }, 'openid-private')
    assert.equal(result.code, 0)
    assert.equal(loaded.sends.length, 1)
    assert.equal(loaded.sends[0].miniprogramState, expected)
  })
}

test('invalid AI reminder environment fails closed before sending', async () => {
  const loaded = loadPokerData('release')
  const result = await loaded.pokerData.__test.sendAiReminderSubscribeMessage({
    templateId: 'template-1', reminder: {}
  }, 'openid-private')
  assert.deepEqual(result, {
    code: 'INVALID_MINIPROGRAM_STATE',
    message: 'invalid AI_REMINDER_MINIPROGRAM_STATE'
  })
  assert.equal(loaded.sends.length, 0)
})
