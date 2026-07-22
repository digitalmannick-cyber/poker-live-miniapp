const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const source = file => fs.readFileSync(path.join(root, file), 'utf8')

test('voice review saves the canonical hand before optional AI advice starts', () => {
  const review = source('pages/review-list/review-list.js')
  const flowStart = review.indexOf('async applyVoicePatch')
  const save = review.indexOf('dataService.updateHandWithCloudSync', flowStart)
  const advice = review.indexOf('this.generateVoiceAdvice(', flowStart)

  assert.ok(flowStart >= 0 && save > flowStart && advice > save)
  assert.match(review.slice(save, advice), /return\s*\n\s*}/)
})

test('AI failures are rendered as retryable errors without hiding the saved hand', () => {
  const reviewJs = source('pages/review-list/review-list.js')
  const reviewWxml = source('pages/review-list/review-list.wxml')
  const chat = source('components/agent-chat/agent-chat.js')

  assert.match(reviewJs, /aiReviewStatus:\s*'failed'/)
  assert.match(reviewWxml, /AI 建议生成失败/)
  assert.match(chat, /大模型服务暂时不可用（HTTP 503），请稍后重试/)
})

test('core data and social services do not import the AI gateway', () => {
  const core = [source('services/data-service.js'), source('services/social-service.js')].join('\n')
  assert.doesNotMatch(core, /voice-service|poker_review|agent\/ask/)
})
