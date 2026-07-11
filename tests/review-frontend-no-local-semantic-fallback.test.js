const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('review frontend does not ship local semantic parser or normalizer modules', () => {
  assert.equal(fs.existsSync(path.join(root, 'utils', 'voice-parser.js')), false)
  assert.equal(fs.existsSync(path.join(root, 'utils', 'ai-normalizer.js')), false)
})

test('review page does not import or call local semantic fallback code', () => {
  const source = read('pages/review-list/review-list.js')

  assert.equal(source.includes("require('../../utils/ai-normalizer')"), false)
  assert.equal(source.includes("require('../../utils/voice-parser')"), false)
  assert.equal(/\bparseVoiceText\b/.test(source), false)
  assert.equal(/\bpostProcessReviewResult\b/.test(source), false)
  assert.equal(/\bapplyCorpusSpeechFallback\b/.test(source), false)
})
