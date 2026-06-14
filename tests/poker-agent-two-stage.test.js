const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const cloud = fs.readFileSync(path.join(root, 'cloudfunctions', 'poker_review', 'index.js'), 'utf8')
const reviewList = fs.readFileSync(path.join(root, 'pages', 'review-list', 'review-list.js'), 'utf8')

assert.ok(
  cloud.includes("mode === 'extract'") || cloud.includes('mode: extract'),
  'cloud function should support an Agent extract mode'
)

assert.ok(
  cloud.includes("mode === 'advice'") || cloud.includes('mode: advice'),
  'cloud function should support an Agent advice mode'
)

assert.ok(
  cloud.includes('buildPokerAgentExtractQuestion'),
  'extract mode should use a dedicated Agent prompt for field extraction and user memory'
)

assert.ok(
  cloud.includes('getAgentUserId'),
  'cloud function should derive Agent user_id from the miniapp user/player id'
)

assert.ok(
  reviewList.includes("mode: 'extract'"),
  'voice parsing should call poker_review in extract mode'
)

assert.ok(
  reviewList.includes("mode: 'advice'"),
  'confirming voice backfill should trigger poker_review advice mode'
)

assert.ok(
  reviewList.includes('correction') || reviewList.includes('corrections'),
  'front-end should send user corrections/editing context back to Agent for learning'
)

assert.ok(
  cloud.includes('Authoritative structured payload') &&
  cloud.includes('structuredHand') &&
  cloud.includes('extractedHand'),
  'advice mode should send authoritative structured hand data to the Agent'
)

assert.ok(
  cloud.includes('cleanAgentAdviceText') &&
  cloud.includes('spot_id') &&
  cloud.includes('range_gap'),
  'cloud normalizer should strip Agent internal debug artifacts from user-facing advice'
)

assert.ok(
  cloud.includes('The miniapp user already sees the structured fields') &&
  cloud.includes('actual poker decisions') &&
  cloud.includes('Each issue/optimization must mention a concrete street or decision'),
  'advice mode should ask Agent for concrete coaching instead of field-readiness status'
)

assert.ok(
  cloud.includes('street_breakdown') &&
  cloud.includes('key_takeaway') &&
  cloud.includes('street_breakdown is the most important section') &&
  cloud.includes('key_takeaway should be one concise coach-style takeaway'),
  'advice mode should request street-by-street coaching and one concise coach takeaway'
)

assert.ok(
  cloud.includes('Perspective is mandatory: Hero is the miniapp user') &&
  cloud.includes('treat that as villain hand information') &&
  cloud.includes('Do not praise a value line for a made hand Hero does not hold'),
  'advice mode should force Hero-perspective coaching and avoid assigning villain showdown hands to Hero'
)

assert.ok(
  cloud.includes('isLowValueAgentAdviceLine') &&
  cloud.includes('结构化') &&
  cloud.includes('补齐缺失字段后'),
  'cloud normalizer should remove generic readiness text from Agent advice'
)

assert.ok(
  cloud.includes('你是职业德州扑克玩家的 AI 复盘助手') &&
  cloud.includes('缺少复盘文本') &&
  !/(?:浣犳|缂哄|寤鸿|鐟曚|娴ｇ)/.test(cloud),
  'cloud prompt and user-facing errors should not contain mojibake'
)

console.log('poker Agent two-stage tests passed')
