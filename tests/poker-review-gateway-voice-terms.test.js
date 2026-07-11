const test = require('node:test')
const assert = require('node:assert/strict')

const { buildAgentPayload } = require('../cloudfunctions/poker_review/gateway')

test('gateway passes explicit corrections through Agent context', () => {
  const corrections = [{ from: '老板位', to: 'BTN' }]
  const payload = buildAgentPayload(
    {
      mode: 'extract',
      transcript: '我在老板位手牌AhQh',
      corrections
    },
    'alice',
    'req-1'
  )

  assert.deepEqual(payload.context.corrections, corrections)
})

test('gateway passes saved user voice terms through Agent context', () => {
  const userTerms = [{ from: '老板位', to: 'BTN' }]
  const payload = buildAgentPayload(
    {
      mode: 'extract',
      transcript: '我在老板位手牌AhQh',
      userTerms
    },
    'alice',
    'req-1'
  )

  assert.deepEqual(payload.context.voiceTerms, userTerms)
})
