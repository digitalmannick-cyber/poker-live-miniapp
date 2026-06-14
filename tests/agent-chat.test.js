const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const appJson = fs.readFileSync(path.join(root, 'app.json'), 'utf8')
const componentJs = fs.readFileSync(path.join(root, 'components/agent-chat/agent-chat.js'), 'utf8')
const componentWxml = fs.readFileSync(path.join(root, 'components/agent-chat/agent-chat.wxml'), 'utf8')
const componentWxss = fs.readFileSync(path.join(root, 'components/agent-chat/agent-chat.wxss'), 'utf8')
const aiService = fs.readFileSync(path.join(root, 'services/ai-service.js'), 'utf8')
const dataService = fs.readFileSync(path.join(root, 'services/data-service.js'), 'utf8')
const cloud = fs.readFileSync(path.join(root, 'cloudfunctions/poker_review/index.js'), 'utf8')
const fabIconPath = path.join(root, 'components/agent-chat/poker-agent-fab-96.png')

function loadPokerReview() {
  const filePath = path.join(root, 'cloudfunctions', 'poker_review', 'index.js')
  const code = fs.readFileSync(filePath, 'utf8')
  const module = { exports: {} }
  const sandbox = {
    module,
    exports: module.exports,
    require(name) {
      if (name === 'wx-server-sdk') return { DYNAMIC_CURRENT_ENV: 'test', init() {} }
      if (name === './ai-normalizer') return require(path.join(root, 'cloudfunctions', 'poker_review', 'ai-normalizer.js'))
      if (name === './review-tags') return require(path.join(root, 'cloudfunctions', 'poker_review', 'review-tags.js'))
      return require(name)
    },
    process: { env: {} },
    Buffer,
    URL,
    console,
    setTimeout,
    clearTimeout
  }
  require('node:vm').runInNewContext(code, sandbox, { filename: filePath })
  return module.exports
}

assert.ok(
  appJson.includes('"agent-chat": "/components/agent-chat/agent-chat"'),
  'agent chat component should be registered globally'
)

;[
  'pages/session-list/session-list.wxml',
  'pages/hand-record/hand-record.wxml',
  'pages/review-list/review-list.wxml',
  'pages/stats/stats.wxml',
  'pages/profile/profile.wxml'
].forEach(file => {
  const text = fs.readFileSync(path.join(root, file), 'utf8')
  assert.ok(text.includes('<agent-chat />'), `${file} should mount the floating agent chat`)
})

assert.ok(
  componentWxml.includes('Poker Agent') &&
  componentWxml.includes('quickActions') &&
  componentWxml.includes('data-intent="{{item.key}}"') &&
  componentWxml.includes('/components/agent-chat/poker-agent-fab-96.png') &&
  componentJs.includes('语音牌谱复盘') &&
  componentJs.includes('最近 50 手总结') &&
  componentJs.includes('现场马脚快闪题'),
  'agent chat should expose the requested quick actions'
)

assert.ok(
  componentJs.includes('dataService.getRecentHands(50)') &&
  componentJs.includes('aiService.chatWithPokerAgent') &&
  componentJs.includes("mode: 'chat'"),
  'agent chat should send recent-hand context to poker agent chat mode'
)

assert.ok(
  componentJs.includes('activeIntent') &&
  componentJs.includes('chatIntent: nextIntent'),
  'agent chat should send the selected quick-action intent to avoid wrong agent routing'
)

assert.ok(
  componentJs.includes('displayVisible') &&
  componentJs.includes('setTimeout') &&
  componentWxml.includes("{{visible ? 'open' : 'closing'}}"),
  'agent chat should keep the panel mounted long enough to play close animation'
)

assert.ok(
  componentJs.includes('语音牌谱复盘') &&
  componentJs.includes('最近 50 手总结') &&
  componentJs.includes('现场马脚快闪题') &&
  componentJs.includes('persistMessages') &&
  componentJs.includes('loadPersistedMessages') &&
  componentJs.includes('getCurrentMessages'),
  'agent chat should persist message history and reload the latest shared history whenever reopened from any tab'
)

assert.ok(
  componentJs.includes('getLocalAgentReply') &&
  componentJs.includes('inferChatIntent') &&
  componentJs.includes('findLastMessageIntent') &&
  componentJs.includes('小程序目前还没有全局止盈止损线自动写入功能') &&
  componentJs.includes('我是 Poker Agent'),
  'agent chat should answer local questions directly and preserve prior task intent for short follow-up questions'
)

assert.ok(
  componentJs.includes('lastIntent') &&
  componentJs.includes('intent: nextIntent') &&
  componentJs.includes('chatIntent: nextIntent'),
  'agent chat should send an explicit inferred intent so free-text follow-ups do not drift into the wrong agent task'
)

assert.ok(
  componentJs.includes('语音牌谱复盘') &&
  componentJs.includes('最近 50 手总结') &&
  componentJs.includes('现场马脚快闪题'),
  'agent chat should convert raw provider 503 html into a readable user message'
)

assert.ok(
  componentWxml.includes('agent-chat-collapse-icon') &&
  !componentWxml.includes('bindtap="closeChat">关闭</view>'),
  'agent chat close control should be a compact collapse icon instead of a text button'
)

assert.ok(
  componentWxss.includes('height: 75vh') &&
  componentWxss.includes('grid-template-rows: auto minmax(0, 1fr) auto') &&
  componentWxss.includes('.agent-chat-collapse-icon'),
  'agent chat panel should occupy about three quarters of the screen with a stable message area'
)

assert.ok(
  !componentJs.includes('POKER_AGENT_PUBLIC_BASE_URL') &&
  componentJs.includes('extractMessageImageUrl') &&
  componentJs.includes('stripMessageImageUrl') &&
  componentJs.includes('imageUrl'),
  'agent chat should detect range image links without hardcoding the poker Agent base url in the frontend'
)

{
  const review = loadPokerReview()
  const result = review.__test.normalizePokerAgentChat({
    answer: '范围图如下：/static/ranges/bb-vs-btn.png',
    data: {
      image_url: '/static/ranges/bb-vs-btn.png'
    }
  }, '查范围')
  assert.equal(
    result.imageUrl,
    'https://flask-v2u1-267284-4-1429181305.sh.run.tcloudbase.com/static/ranges/bb-vs-btn.png',
    'cloud function should normalize relative poker Agent image urls before returning to the miniapp'
  )
}

assert.ok(
  componentWxml.includes('agent-chat-message-image') &&
  componentWxml.includes('bindtap="previewMessageImage"') &&
  componentWxml.includes('src="{{item.imageUrl}}"'),
  'agent chat should render detected range image links directly as previewable images'
)

assert.ok(
  componentWxss.includes('overflow: hidden') &&
  componentWxss.includes('min-width: 0') &&
  componentWxss.includes('overflow-wrap: anywhere') &&
  componentWxss.includes('word-break: break-all') &&
  componentWxss.includes('grid-template-columns: minmax(0, 1fr) 104rpx'),
  'agent chat layout should prevent long urls from pushing the send button off screen'
)

assert.ok(
  componentWxss.includes('.agent-chat-fab') &&
  componentWxss.includes('position: fixed') &&
  componentWxss.includes('bottom: calc(170rpx + env(safe-area-inset-bottom))'),
  'agent chat floating button should stay above the custom tab bar'
)

assert.ok(fs.existsSync(fabIconPath), 'agent chat should include the local poker agent icon asset')
assert.ok(
  componentWxss.includes('width: 52rpx') &&
  componentWxss.includes('height: 52rpx') &&
  componentWxss.includes('.agent-chat-fab-icon'),
  'agent chat floating button should use the smaller image icon'
)

assert.ok(
  componentWxss.includes('@keyframes agent-panel-in') &&
  componentWxss.includes('@keyframes agent-panel-out') &&
  componentWxss.includes('transform-origin: right bottom') &&
  componentWxss.includes('@keyframes agent-dot-pulse') &&
  componentWxss.includes('@keyframes agent-fab-float') &&
  componentWxss.includes('@keyframes agent-fab-glow') &&
  componentWxss.includes('translateY(-13rpx) scale(1.06)') &&
  componentWxss.includes('0 0 0 14rpx rgba(0, 209, 255, 0)'),
  'agent chat should use visible native animations for opening, closing, thinking state, and the floating entry'
)

assert.ok(
  aiService.includes('chatWithPokerAgent') &&
  aiService.includes("mode: 'chat'") &&
  dataService.includes('async function getRecentHands'),
  'services should expose poker agent chat and recent hand context'
)

assert.ok(
  cloud.includes("mode === 'chat'") &&
  cloud.includes('buildPokerAgentChatQuestion') &&
  cloud.includes('getPokerAgentChatTask') &&
  cloud.includes('normalizeChatIntent') &&
  cloud.includes('recentHands'),
  'poker_review cloud function should support chat mode with recent hand context'
)

const review = loadPokerReview()
assert.equal(
  review.__test.normalizeChatIntent('recent', '请根据我最近 50 手牌，帮我总结主要问题，并制定针对性训练计划。'),
  'recent_summary'
)
const recentPrompt = review.__test.buildPokerAgentChatQuestion(
  '请根据我最近 50 手牌，帮我总结主要问题，并制定针对性训练计划。',
  { recentHands: [{ heroPosition: 'UTG', heroCardsInput: 'AhKh', currentProfit: 1000 }], stats: { totalHands: 1 } },
  { intent: 'recent' }
)
assert.equal(recentPrompt, '请根据我最近 50 手牌，帮我总结主要问题，并制定针对性训练计划。')
assert.ok(!recentPrompt.includes('现场马脚快闪题'))

const rangeContext = {
  recentHands: [{ heroPosition: 'UTG', heroCardsInput: 'AhKh', currentProfit: 1000 }],
  stats: { totalHands: 1 },
  profile: { name: 'debug' }
}
const rangePrompt = review.__test.buildPokerAgentChatQuestion(
  '8max BTN straddle，CO 面对 HJ open，AQs 怎么打？',
  rangeContext,
  { intent: 'range' }
)
assert.equal(rangePrompt, '8max BTN straddle，CO 面对 HJ open，AQs 怎么打？')
assert.ok(!rangePrompt.includes('Selected intent: range_query'))
assert.ok(!rangePrompt.includes('Task: range_query'))
assert.ok(!rangePrompt.includes('Task: agent_chat'))
assert.ok(!rangePrompt.includes('"recentHands"'))
assert.ok(!rangePrompt.includes('"totalHands"'))
assert.ok(!rangePrompt.includes('street-by-street coaching'))
assert.equal(
  JSON.stringify(review.__test.buildChatAgentContext(rangeContext, 'range_query')),
  JSON.stringify({ profile: { name: 'debug' } })
)
assert.equal(review.__test.getPokerAgentChatTask('range_query'), 'range_query')
assert.equal(review.__test.getPokerAgentChatTask('recent_summary'), 'recent_summary')
assert.equal(review.__test.getPokerAgentChatTask('live_tell_quiz'), 'live_tell_quiz')
assert.equal(review.__test.getPokerAgentChatTask('general_chat'), 'agent_chat')
assert.equal(review.__test.normalizeChatIntent('', '止损设置为10万'), 'general_chat')
assert.equal(review.__test.normalizeChatIntent('', '帮我设置一下止盈止损'), 'general_chat')
assert.equal(review.__test.normalizeChatIntent('', '你好啊，你是什么模型？'), 'general_chat')
assert.equal(review.__test.normalizeChatIntent('', '你好啊'), 'general_chat')
assert.equal(review.__test.normalizeChatIntent('', 'open是什么意思'), 'general_chat')
assert.equal(review.__test.normalizeChatIntent('', '我今天有点累'), 'general_chat')
assert.equal(review.__test.normalizeChatIntent('', 'BTN open，BB AQs 100bb 怎么打'), 'range_query')
assert.equal(review.__test.normalizeChatIntent('', '今天打完了，帮我看看是否适合继续'), 'stop_check')
assert.equal(review.__test.normalizeChatIntent('range', '300bb呢'), 'range_query')

console.log('agent chat tests passed')
