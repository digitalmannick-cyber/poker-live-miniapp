const test = require('node:test')
const assert = require('node:assert/strict')

const { unwrapPokerReviewGateway } = require('../services/voice-service')

test('unwrapPokerReviewGateway exposes agent failure diagnostics for screenshots', () => {
  const result = unwrapPokerReviewGateway({
    ok: true,
    requestId: 'req-gateway-1',
    status: 200,
    data: {
      intent: 'voice_review_advice_failed',
      answer: 'EV脑出问题啦，请稍后再重新生成AI建议。',
      data: {
        status: 'llm_unavailable',
        llm_error: {
          type: 'factual_conflict',
          conflicts: [{ conflict: 'review_claims_hero_overpair', actual: 'not_overpair' }]
        }
      },
      tool_calls: [
        { name: 'read_structured_hand', status: 'ok', input: {} },
        {
          name: 'llm_coach_review',
          status: 'rejected:factual_conflict',
          input: {
            conflicts: [{ conflict: 'review_claims_hero_overpair', actual: 'not_overpair' }],
            review_excerpt: 'HJ范围包含超对，Hero是弱对子。'
          }
        }
      ]
    }
  }, 'advice')

  assert.equal(result.intent, 'voice_review_advice_failed')
  assert.match(result.debugError, /llm_coach_review/)
  assert.match(result.debugError, /rejected:factual_conflict/)
  assert.match(result.debugError, /review_claims_hero_overpair/)
  assert.match(result.debugError, /req-gateway-1/)
  assert.equal(result.aiReviewError, result.debugError)
})

test('unwrapPokerReviewGateway includes factual conflict details for raise sizing screenshots', () => {
  const result = unwrapPokerReviewGateway({
    ok: true,
    requestId: 'req-raise-ratio',
    status: 200,
    data: {
      intent: 'voice_review_advice_failed',
      answer: 'EV脑出问题啦，请稍后再重新生成AI建议。',
      data: {
        status: 'llm_unavailable',
        llm_error: {
          type: 'factual_conflict',
          conflicts: [
            {
              conflict: 'review_claims_wrong_raise_ratio',
              actual: 5.14,
              claimed: 3.5,
              villain_bet: 7000,
              hero_raise_to: 36000
            }
          ]
        }
      },
      tool_calls: [
        {
          name: 'llm_coach_review',
          status: 'rejected:factual_conflict',
          input: {
            conflicts: [
              {
                conflict: 'review_claims_wrong_raise_ratio',
                actual: 5.14,
                claimed: 3.5,
                villain_bet: 7000,
                hero_raise_to: 36000
              }
            ],
            review_excerpt: 'Turn check-raise 3.5x applies pressure.'
          }
        }
      ]
    }
  }, 'advice')

  assert.match(result.debugError, /review_claims_wrong_raise_ratio/)
  assert.match(result.debugError, /actual=5\.14/)
  assert.match(result.debugError, /claimed=3\.5/)
  assert.match(result.debugError, /villain_bet=7000/)
  assert.match(result.debugError, /hero_raise_to=36000/)
})
