const cloud = require('wx-server-sdk')
const https = require('https')
const aiNormalizer = require('./ai-normalizer')
const reviewTags = require('./review-tags')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const TERM_REPLACEMENTS = {
  raise: 'Raise',
  check: 'Check',
  open: 'Open',
  call: 'Call',
  fold: 'Fold',
  allin: 'Allin'
}

const COMPACT_ACTION_LINE_INSTRUCTION = [
  'Compact action-line format is mandatory whenever you output streetInputs.*.actionLine, streetSummary, or quote an action line.',
  'Use one line per street: PF: HJ R2.5, Hero BTN C; F Qs8d4c: HJ B33%, Hero C; T Kh: HJ X, Hero B75%, HJ C; R 2c: HJ X, Hero X.',
  'Use abbreviations: X=check, B=bet, R=raise/open, C=call, F=fold, AI=all-in, 3B/4B/5B=reraises.',
  'If a postflop bet size is expressed as pot percentage, include the percent sign, e.g. B33%, B75%, B100%. Do not output B33 or B75 for pot-percent bets.'
].join('\n')

const SYSTEM_PROMPT = `
你是职业德州扑克玩家的 AI 复盘助手。当前任务只做语音复盘字段抽取，不做策略建议。
要求：
1. 自动纠正常见德州扑克术语、中文口语、方言和语音识别错误。
2. 优先提取：手牌、输赢、级别、人数、位置、对手类型、对手名字、逐街行动线、逐街底池、公牌、摊牌、心路历程。
3. heroCardsInput 必须输出成小程序可用格式，例如 AhKh、AsKd、JhJd。
4. board.flop / board.turn / board.river 必须输出成 shdc 格式，例如 Qd9s6c、Jd、3c；如果用户没有说明花色，可以自动补一个合理花色，但不能和已经出现的牌重复。
5. 公牌里的中文点数必须完整保留并转换：勾/钩=J，圈=Q，尖=A，八=8，四=4；例如“勾八四彩虹”应识别为 J84 再补花色。
6. 输赢字段 currentProfit 必须用正负数表达：赢为正数，输为负数。
7. 如果用户没有提到 river，因为手牌在 turn 或更早结束，river 必须留空，不要补牌。
8. 当前阶段不要生成 AI 点评，只返回结构化提取、缺失字段和需要确认的疑义。
9. 只能返回 JSON，不要 markdown，不要解释。
返回 JSON 示例：{
  "extractedHand": {
    "playedDate": "YYYY/MM/DD",
    "stakeLevel": "300/600",
    "hasStraddle": false,
    "straddleAmount": 0,
    "heroPosition": "MP",
    "heroCardsInput": "ThKh",
    "effectiveStack": 80000,
    "potSize": 14000,
    "currentProfit": 85000,
    "opponentType": "紧弱",
    "opponentName": "0305",
    "villainPosition": "BTN",
    "board": {
      "flop": "Qd9s6c",
      "turn": "Jd",
      "river": "3c"
    },
    "streetInputs": {
      "preflop": { "actionLine": "", "pot": "" },
      "flop": { "actionLine": "", "pot": "" },
      "turn": { "actionLine": "", "pot": "" },
      "river": { "actionLine": "", "pot": "" }
    },
    "streetSummary": "",
    "showdown": "",
    "mindJourney": "",
    "heroQuestion": "",
    "tags": []
  },
  "missingFields": [],
  "followUpQuestions": [],
  "naturalLanguageSummary": ""
}
`.trim()

const REVIEW_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['extractedHand', 'missingFields', 'followUpQuestions', 'naturalLanguageSummary'],
  properties: {
    extractedHand: {
      type: 'object',
      additionalProperties: false,
      required: [
        'playedDate',
        'stakeLevel',
        'hasStraddle',
        'straddleAmount',
        'heroPosition',
        'heroCardsInput',
        'effectiveStack',
        'potSize',
        'currentProfit',
        'opponentType',
        'opponentName',
        'villainPosition',
        'board',
        'streetInputs',
        'streetSummary',
        'showdown',
        'mindJourney',
        'heroQuestion',
        'tags'
      ],
      properties: {
        playedDate: { type: 'string' },
        stakeLevel: { type: 'string' },
        hasStraddle: { type: 'boolean' },
        straddleAmount: { type: 'number' },
        heroPosition: { type: 'string' },
        heroCardsInput: { type: 'string' },
        effectiveStack: { type: 'number' },
        potSize: { type: 'number' },
        currentProfit: { type: 'number' },
        opponentType: { type: 'string' },
        opponentName: { type: 'string' },
        villainPosition: { type: 'string' },
        board: {
          type: 'object',
          additionalProperties: false,
          required: ['flop', 'turn', 'river'],
          properties: {
            flop: { type: 'string' },
            turn: { type: 'string' },
            river: { type: 'string' }
          }
        },
        streetInputs: {
          type: 'object',
          additionalProperties: false,
          required: ['preflop', 'flop', 'turn', 'river'],
          properties: {
            preflop: {
              type: 'object',
              additionalProperties: false,
              required: ['actionLine', 'pot'],
              properties: {
                actionLine: { type: 'string' },
                pot: { type: 'string' }
              }
            },
            flop: {
              type: 'object',
              additionalProperties: false,
              required: ['actionLine', 'pot'],
              properties: {
                actionLine: { type: 'string' },
                pot: { type: 'string' }
              }
            },
            turn: {
              type: 'object',
              additionalProperties: false,
              required: ['actionLine', 'pot'],
              properties: {
                actionLine: { type: 'string' },
                pot: { type: 'string' }
              }
            },
            river: {
              type: 'object',
              additionalProperties: false,
              required: ['actionLine', 'pot'],
              properties: {
                actionLine: { type: 'string' },
                pot: { type: 'string' }
              }
            }
          }
        },
        streetSummary: { type: 'string' },
        showdown: { type: 'string' },
        mindJourney: { type: 'string' },
        heroQuestion: { type: 'string' },
        tags: {
          type: 'array',
          items: { type: 'string' }
        }
      }
    },
    missingFields: {
      type: 'array',
      items: { type: 'string' }
    },
    followUpQuestions: {
      type: 'array',
      items: { type: 'string' }
    },
    naturalLanguageSummary: { type: 'string' }
  }
}

const DEFAULT_POKER_AGENT_BASE_URL = 'https://flask-v2u1-267284-4-1429181305.sh.run.tcloudbase.com'
const IMAGE_URL_PATTERN = /((?:https?:\/\/|\/)[^\s"'<>]+?\.(?:svg|png|jpe?g|webp)(?:\?[^\s"'<>]*)?)/i

function normalizeAgentResourceUrl(url) {
  const clean = String(url || '')
    .trim()
    .replace(/[，。；、,.;)）\]]+$/g, '')
  if (!clean) return ''
  if (/^https?:\/\//i.test(clean)) return clean
  if (clean.startsWith('/')) {
    const baseUrl = process.env.POKER_AGENT_BASE_URL || DEFAULT_POKER_AGENT_BASE_URL
    return `${baseUrl.replace(/\/$/, '')}${clean}`
  }
  return ''
}

function extractImageUrlFromText(text) {
  const content = String(text || '')
  const labeled = content.match(/(?:图片地址|图片链接|image(?:\s*url)?|url)[:：]\s*((?:https?:\/\/|\/)[^\s"'<>]+)/i)
  return (labeled ? labeled[1] : (content.match(IMAGE_URL_PATTERN) || [])[1]) || ''
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value)
  } catch (error) {
    return fallback
  }
}

function getEnvConfig() {
  const provider = (
    process.env.POKER_AI_PROVIDER ||
    process.env.AI_PROVIDER ||
    (process.env.POKER_AGENT_BASE_URL ? 'poker-agent' : '') ||
    'poker-agent'
  ).toLowerCase()

  if (provider === 'poker-agent' || provider === 'poker_agent' || provider === 'agent') {
    return {
      provider: 'poker-agent',
      baseUrl: process.env.POKER_AGENT_BASE_URL || DEFAULT_POKER_AGENT_BASE_URL,
      path: process.env.POKER_AGENT_ASK_PATH || '/api/v1/agent/ask',
      userId: process.env.POKER_AGENT_USER_ID || 'miniapp',
      timeout: Number(process.env.POKER_AGENT_TIMEOUT_MS || process.env.AI_TIMEOUT_MS) || 45000
    }
  }

  if (provider === 'openai') {
    return {
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY || '',
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      timeout: Number(process.env.OPENAI_TIMEOUT_MS || process.env.AI_TIMEOUT_MS) || 30000
    }
  }

  if (provider === 'minimax') {
    return {
      provider: 'minimax',
      apiKey: process.env.MINIMAX_API_KEY || '',
      baseUrl: process.env.MINIMAX_BASE_URL || 'https://api.minimax.io/v1',
      model: process.env.MINIMAX_MODEL || 'MiniMax-M2.7',
      timeout: Number(process.env.MINIMAX_TIMEOUT_MS || process.env.AI_TIMEOUT_MS) || 30000
    }
  }

  return {
    provider: 'kimi',
    apiKey: process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY || '',
    baseUrl: process.env.MOONSHOT_BASE_URL || process.env.KIMI_BASE_URL || 'https://api.moonshot.ai/v1',
    model: process.env.MOONSHOT_MODEL || process.env.KIMI_MODEL || 'kimi-k2.6',
    timeout: Number(process.env.MOONSHOT_TIMEOUT_MS || process.env.KIMI_TIMEOUT_MS) || 30000
  }
}

function normalizeMode(value) {
  const mode = String(value || '').trim().toLowerCase()
  if (mode === 'chat' || mode === 'agent_chat' || mode === 'ask') return 'chat'
  if (mode === 'session_summary' || mode === 'session-summary' || mode === 'summary') return 'session_summary'
  if (mode === 'extract' || mode === 'parse' || mode === 'fields') return 'extract'
  if (mode === 'advice' || mode === 'review' || mode === 'analysis') return 'advice'
  return 'extract'
}

function isMetaOrAppChatQuestion(text) {
  const source = String(text || '').trim()
  return /(?:你是(?:什么|谁)|什么模型|用.*模型|你用[得的]?什么模型|who are you|model|你能(?:做什么|干嘛)|怎么用|帮助|help|设置|设定|改成|改为|保存|记录|配置|删除|清空|导出|登录|同步|页面|tab|按钮|功能)/i.test(source)
}

function isRecentSummaryQuestion(text) {
  return /(?:最近\s*\d*\s*手|近\s*\d*\s*手|最近手牌|总结.*(?:手牌|问题|leak|漏洞)|训练计划|主要问题|leak|漏洞)/i.test(String(text || ''))
}

function isRangeQuestion(text) {
  const source = String(text || '')
  if (/范围|range/i.test(source)) return true
  const hasPosition = /\b(?:BTN|CO|HJ|UTG|BB|SB|MP|LJ|EP|IP|OOP)\b/i.test(source)
  const hasAction = /open|3\s*bet|3bet|4\s*bet|4bet|squeeze|call|fold|raise|limp|iso|straddle|面对|怎么打/i.test(source)
  const hasHand = /\b(?:AA|KK|QQ|JJ|TT|AKs?|AQs?|AJs?|ATs?|KQs?|KJs?|QJs?|JTs?|[AKQJT2-9][shdc][AKQJT2-9][shdc])\b/i.test(source)
  return hasPosition && hasAction && (hasHand || /怎么打|频率|尺寸|size|深筹|浅筹|[0-9]+\s*bb/i.test(source))
}

function isStopCheckQuestion(text) {
  const source = String(text || '')
  if (/(设置|设定|改成|改为|保存|记录|配置).{0,12}(止盈|止损)|(止盈|止损).{0,12}(设置|设定|改成|改为|保存|记录|配置)/i.test(source)) return false
  return /状态检查|止损止盈检查|是否适合继续|适合继续|还能不能继续|要不要休息|继续打吗|该不该继续|上头|tilt|心态崩|疲劳|收工|降级/i.test(source)
}

function isLiveTellQuestion(text) {
  return /马脚|tell|快闪题|读牌训练|观察训练|现场观察/i.test(String(text || ''))
}

function isHandReviewQuestion(text) {
  const source = String(text || '')
  if (/复盘|牌谱|帮我看这手|这手.*(?:怎么|问题|错)|分析这手/i.test(source)) return true
  const streetCount = [
    /flop|翻牌/i,
    /turn|转牌/i,
    /river|河牌/i,
    /preflop|翻前/i
  ].filter(pattern => pattern.test(source)).length
  const hasActionLine = /all.?in|call|raise|bet|check|fold|下注|加注|跟注|弃牌|过牌/i.test(source)
  return streetCount >= 2 && hasActionLine
}

function normalizeChatIntent(value, text) {
  const raw = String(value || '').trim().toLowerCase()
  const source = String(text || '')
  const aliases = {
    review: 'hand_review_chat',
    hand_review: 'hand_review_chat',
    hand_review_chat: 'hand_review_chat',
    range: 'range_query',
    range_query: 'range_query',
    recent: 'recent_summary',
    recent50: 'recent_summary',
    recent_summary: 'recent_summary',
    stop: 'stop_check',
    stop_check: 'stop_check',
    state_check: 'stop_check',
    tell: 'live_tell_quiz',
    live_tell: 'live_tell_quiz',
    live_tell_quiz: 'live_tell_quiz'
  }
  if (aliases[raw]) return aliases[raw]
  if (isMetaOrAppChatQuestion(source)) return 'general_chat'
  if (isRecentSummaryQuestion(source)) return 'recent_summary'
  if (isRangeQuestion(source)) return 'range_query'
  if (isStopCheckQuestion(source)) return 'stop_check'
  if (isLiveTellQuestion(source)) return 'live_tell_quiz'
  if (isHandReviewQuestion(source)) return 'hand_review_chat'
  return 'general_chat'
}

function getChatIntentLabel(intent) {
  return {
    hand_review_chat: '牌谱复盘',
    range_query: '范围查询',
    recent_summary: '最近手牌总结与训练计划',
    stop_check: '止损止盈与状态检查',
    live_tell_quiz: '现场马脚快闪题',
    general_chat: '通用扑克问答'
  }[intent] || '通用扑克问答'
}

function getChatIntentInstruction(intent) {
  if (intent === 'recent_summary') {
    return '当前任务是最近手牌总结。必须优先读取 Miniapp context.recentHands 和 stats，输出：1. 最近样本概览；2. 最主要的 3 个问题；3. 位置/牌型/街道上的倾向；4. 可执行的针对性训练计划。不要切换到其他任务。'
  }
  if (intent === 'range_query') {
    return '当前任务是范围查询。根据用户描述的位置、桌型、straddle、open/3bet/4bet 情况和手牌，先给推荐动作，再说明默认范围、现场偏离和对不同玩家类型的调整。不要切换到其他任务。'
  }
  if (intent === 'stop_check') {
    return '当前任务是止损止盈与状态检查。结合 stats、最近手牌、输赢和用户描述，判断是否适合继续打，给出继续/休息/降级/设定止损线的明确建议。不要切换到其他任务。'
  }
  if (intent === 'live_tell_quiz') {
    return '当前任务是现场马脚快闪题。只在该 intent 下出题。题目要包含现场场景、问题、可观察点和答案解析，帮助用户训练现场观察。'
  }
  if (intent === 'hand_review_chat') {
    return '当前任务是自然语言牌谱复盘。先提取关键牌局事实，再按翻前、翻牌、转牌、河牌逐街给建议，指出做得好、问题、明显错误和下一次可执行动作。'
  }
  return '当前任务是通用扑克问答。只回答用户当前问题，不要主动切换成快闪题或最近手牌总结。'
}

function buildChatAgentContext(context, intent) {
  const source = context || {}
  const base = {
    profile: source.profile || {}
  }
  if (intent === 'recent_summary') {
    return Object.assign({}, base, {
      recentHands: source.recentHands || [],
      stats: source.stats || {}
    })
  }
  if (intent === 'stop_check') {
    return Object.assign({}, base, {
      recentHands: source.recentHands || [],
      stats: source.stats || {},
      session: source.session || {}
    })
  }
  if (intent === 'hand_review_chat') {
    return Object.assign({}, base, {
      hand: source.hand || {},
      session: source.session || {},
      actions: source.actions || []
    })
  }
  if (intent === 'general_chat') {
    return Object.assign({}, base, {
      hand: source.hand || {},
      session: source.session || {}
    })
  }
  return base
}

function getChatIntentExtraInstructions(intent) {
  if (intent === 'range_query') {
    return [
      'Use range tools or range knowledge if available.',
      'If the range library does not cover the spot, say it is not covered and reason from live cash fundamentals.',
      'Do not treat this as a hand history review unless the user provides a full played hand with street actions.'
    ]
  }
  if (intent === 'hand_review_chat') {
    return [
      'The user is giving or asking about a hand history.',
      'Extract the key facts and give street-by-street coaching.',
      'Do not just say the structured hand is readable.'
    ]
  }
  return []
}

function getPokerAgentChatTask(intent) {
  return {
    range_query: 'range_query',
    recent_summary: 'recent_summary',
    stop_check: 'stop_check',
    live_tell_quiz: 'live_tell_quiz',
    hand_review_chat: 'hand_review',
    general_chat: 'agent_chat'
  }[intent] || 'agent_chat'
}

function getAgentUserId(event, config) {
  const source = event || {}
  const hand = source.hand || {}
  const session = source.session || {}
  return String(
    source.userId ||
    source.playerId ||
    source.openid ||
    source.openId ||
    source._openid ||
    hand.playerId ||
    hand._openid ||
    session.playerId ||
    config.userId ||
    'miniapp'
  ).trim() || 'miniapp'
}

function requestJson(url, payload, headers, timeout) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const req = https.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: Object.assign(
          {
            'Content-Type': 'application/json'
          },
          headers || {}
        )
      },
      res => {
        const chunks = []
        res.on('data', chunk => chunks.push(chunk))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          const json = safeJsonParse(raw, null)
          if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`ai provider http ${res.statusCode}: ${raw}`))
            return
          }
          resolve(json || { raw })
        })
      }
    )
    req.setTimeout(timeout || 30000, () => {
      req.destroy(new Error('ai provider timeout'))
    })
    req.on('error', reject)
    req.write(JSON.stringify(payload))
    req.end()
  })
}

function replaceAllTerms(text) {
  let current = String(text || '')
  Object.keys(TERM_REPLACEMENTS)
    .sort((a, b) => b.length - a.length)
    .forEach(key => {
      const pattern = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      current = current.replace(pattern, TERM_REPLACEMENTS[key])
    })
  return current
}

function chineseDigit(value) {
  return {
    '\u96f6': 0,
    '\u4e00': 1,
    '\u4e8c': 2,
    '\u4e24': 2,
    '\u4e09': 3,
    '\u56db': 4,
    '\u4e94': 5,
    '\u516d': 6,
    '\u4e03': 7,
    '\u516b': 8,
    '\u4e5d': 9
  }[value]
}

function parseUnderTenThousand(value) {
  const source = String(value || '')
  if (/^\d+$/.test(source)) return Number(source)
  let total = 0
  let current = 0
  const units = { '\u5343': 1000, '\u767e': 100, '\u5341': 10 }
  for (let i = 0; i < source.length; i += 1) {
    const char = source.charAt(i)
    if (Object.prototype.hasOwnProperty.call(units, char)) {
      total += (current || 1) * units[char]
      current = 0
    } else {
      const digit = chineseDigit(char)
      if (digit != null) current = digit
    }
  }
  return total + current
}

function parseChineseMoney(value) {
  const source = String(value || '').trim().replace(/[\u7b79\u7801\u5757]/g, '')
  if (!source) return ''
  if (/^\d+(?:\.\d+)?$/.test(source)) return String(Number(source))
  const wanIndex = source.indexOf('\u4e07')
  if (wanIndex > -1) {
    const before = source.slice(0, wanIndex) || '\u4e00'
    const after = source.slice(wanIndex + 1)
    const base = parseUnderTenThousand(before) * 10000
    if (!after) return String(base)
    if (/^\d+$/.test(after)) return String(base + (after.length <= 2 ? Number(after) * 1000 : Number(after)))
    if (/^[\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343]+$/.test(after)) return String(base + parseUnderTenThousand(after) * 1000)
    return String(base + parseUnderTenThousand(after))
  }
  const qianIndex = source.indexOf('\u5343')
  if (qianIndex > -1) {
    const before = source.slice(0, qianIndex) || '\u4e00'
    const after = source.slice(qianIndex + 1)
    return String(parseUnderTenThousand(before) * 1000 + parseUnderTenThousand(after))
  }
  const parsed = parseUnderTenThousand(source)
  return parsed ? String(parsed) : ''
}

function normalizeMoneyUnits(text) {
  return String(text || '')
    .replace(/([+-]?\d+(?:\.\d+)?)\s*\u4e07([\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\d]*)/g, (_, num, tail) => {
      const base = Number(num) * 10000
      if (!tail) return String(base)
      const extra = /^\d+$/.test(tail)
        ? (tail.length <= 2 ? Number(tail) * 1000 : Number(tail))
        : Number(parseChineseMoney(tail)) || 0
      return String(base + extra)
    })
    .replace(/([+-]?\d+(?:\.\d+)?)\s*\u5343/g, (_, num) => String(Number(num) * 1000))
    .replace(/[\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u4e07]+/g, match => parseChineseMoney(match) || match)
}

function cleanTranscript(text) {
  return normalizeMoneyUnits(replaceAllTerms(text))
    .replace(/\s+/g, ' ')
    .trim()
}

function extractContentText(content) {
  if (Array.isArray(content)) {
    return content
      .map(item => {
        if (!item) return ''
        if (typeof item === 'string') return item
        if (item.type === 'text') return item.text || ''
        return ''
      })
      .join('\n')
      .trim()
  }
  return String(content || '').trim()
}

function extractJsonBlock(text) {
  const source = String(text || '').trim()
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) return fenced[1].trim()
  const first = source.indexOf('{')
  const last = source.lastIndexOf('}')
  if (first > -1 && last > first) {
    return source.slice(first, last + 1)
  }
  return source
}

function normalizeCardToken(value) {
  return String(value || '')
    .replace(/10/g, 'T')
    .replace(/[\u2660\u267e]/g, 's')
    .replace(/[\u2665]/g, 'h')
    .replace(/[\u2666]/g, 'd')
    .replace(/[\u2663]/g, 'c')
    .replace(/\u9ed1\u6843/g, 's')
    .replace(/\u7ea2\u6843/g, 'h')
    .replace(/\u65b9\u5757/g, 'd')
    .replace(/\u6885\u82b1/g, 'c')
    .replace(/\s+/g, '')
}

function extractCardPairs(value, limit) {
  const matches = normalizeCardToken(value).match(/([2-9TJQKA])([shdc])/ig) || []
  return matches
    .slice(0, typeof limit === 'number' ? limit : matches.length)
    .map(token => token.charAt(0).toUpperCase() + token.charAt(1).toLowerCase())
}

function toHeroCardsInput(value) {
  return extractCardPairs(value, 2).join('')
}

function toBoardCards(value, limit) {
  return extractCardPairs(value, limit).join('')
}

function toNumber(value, fallback) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : (fallback || 0)
  }
  const raw = String(value || '').trim()
  if (!raw) return fallback || 0
  const normalized = normalizeMoneyUnits(raw)
    .replace(/,/g, '')
    .replace(/\u8d62/g, '')
    .replace(/\u8f93/g, '-')
  const match = normalized.match(/-?\d+(\.\d+)?/)
  return match ? Number(match[0]) : (fallback || 0)
}

function sanitizeArray(list) {
  return (Array.isArray(list) ? list : [])
    .map(item => String(item || '').trim())
    .filter(Boolean)
}

function normalizeStakeLevel(value, fallback) {
  const source = String(value || '').replace(/\s+/g, '')
  if (/^\d+\/\d+$/.test(source)) return source
  const backup = String(fallback || '').replace(/\s+/g, '')
  return /^\d+\/\d+$/.test(backup) ? backup : ''
}

function getBigBlindFromLevel(levelText, session) {
  const text = String(levelText || '').trim()
  const match = text.match(/^(\d+)\s*\/\s*(\d+)$/)
  if (match) return Number(match[2]) || 0
  return Number(session && session.bigBlind) || 0
}

function getStraddleAmountFromHand(hand, session) {
  if (!hand || !hand.hasStraddle) return 0
  const explicit = toNumber(hand.straddleAmount, 0)
  if (explicit) return explicit
  return getBigBlindFromLevel(hand.stakeLevel, session) * 2
}

function parseChineseDigit(value) {
  const map = {
    '\u4e00': 1,
    '\u4e8c': 2,
    '\u4e24': 2,
    '\u4e09': 3,
    '\u56db': 4,
    '\u4e94': 5,
    '\u516d': 6,
    '\u4e03': 7,
    '\u516b': 8,
    '\u4e5d': 9,
    '\u5341': 10
  }
  return map[value] || 0
}

function extractPlayerCountFromText(text) {
  const source = String(text || '')
  const remaining = source.match(/(?:\u5269|\u8fd8\u5269|\u73b0\u5728|\u5f53\u65f6)\s*([2-9]|10)\s*(?:\u4e2a)?\s*\u4eba/)
  if (remaining) return Number(remaining[1]) || 0
  const direct = source.match(/(?:^|[^\d])([2-9]|10)\s*(?:\u4eba\u684c|max|handed|\u4eba\u5c40)/i)
  if (direct) return Number(direct[1]) || 0
  const generic = source.match(/(?:\u5269|\u8fd8\u5269|\u73b0\u5728|\u5f53\u65f6)\s*([\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341])\s*(?:\u4e2a)?\s*\u4eba/)
  if (generic) return parseChineseDigit(generic[1])
  const chinese = source.match(/([\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341])\s*(?:\u4eba\u684c|\u4eba\u5c40)/)
  if (chinese) return parseChineseDigit(chinese[1])
  return 0
}

function defaultPlayerCount() {
  return 8
}

function resolvePlayerCount() {
  for (let i = 0; i < arguments.length; i += 1) {
    const value = Number(arguments[i])
    if (value > 0) return value
  }
  return defaultPlayerCount()
}

function hasFilledValue(value) {
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === 'object') {
    return Object.keys(value).some(key => hasFilledValue(value[key]))
  }
  return String(value == null ? '' : value).trim() !== '' && String(value).trim() !== '0'
}

function isFieldFilled(hand, field) {
  const source = hand || {}
  const board = source.board || {}
  const aliases = {
    date: ['playedDate'],
    playedDate: ['playedDate'],
    stakeLevel: ['stakeLevel'],
    stakes: ['stakeLevel'],
    blind_structure: ['stakeLevel'],
    level: ['stakeLevel'],
    playerCount: ['playerCount'],
    player_count: ['playerCount'],
    tableSize: ['playerCount'],
    table_size: ['playerCount'],
    heroPosition: ['heroPosition'],
    hero_position: ['heroPosition'],
    position: ['heroPosition'],
    heroCardsInput: ['heroCardsInput'],
    heroCards: ['heroCardsInput'],
    heroHand: ['heroCardsInput'],
    hero_hand: ['heroCardsInput'],
    'hero.hand': ['heroCardsInput'],
    hand: ['heroCardsInput'],
    effectiveStack: ['effectiveStack'],
    effective_stack: ['effectiveStack'],
    potSize: ['potSize'],
    pot_size: ['potSize'],
    currentProfit: ['currentProfit'],
    current_profit: ['currentProfit'],
    opponentType: ['opponentType', 'villainType'],
    opponent_type: ['opponentType', 'villainType'],
    villainType: ['villainType', 'opponentType'],
    opponentName: ['opponentName'],
    opponent_name: ['opponentName'],
    villainPosition: ['villainPosition'],
    villain_position: ['villainPosition'],
    flop: ['board.flop'],
    turn: ['board.turn'],
    river: ['board.river'],
    board: ['board.flop'],
    showdown: ['showdown']
  }
  const keys = aliases[field] || [field]
  return keys.some(key => {
    if (key === 'board.flop') return hasFilledValue(board.flop)
    if (key === 'board.turn') return hasFilledValue(board.turn)
    if (key === 'board.river') return hasFilledValue(board.river)
    return hasFilledValue(source[key])
  })
}

function getFieldFromText(text) {
  const source = String(text || '')
  if (/table[_ ]?size|player[_ ]?count|tableSize|\u51e0\u4eba\u684c|\u684c\u578b|\u4eba\u6570|\u4eba\u684c|\u4eba\u5c40/i.test(source)) return 'playerCount'
  if (/heroCardsInput|hero.*(?:\u624b\u724c|\u5e95\u724c)|\u624b\u724c|\u5e95\u724c/i.test(source)) return 'heroCardsInput'
  if (/playedDate|\u65e5\u671f|\u65f6\u95f4/i.test(source)) return 'playedDate'
  if (/stakeLevel|\u7ea7\u522b|\u76f2\u6ce8/i.test(source)) return 'stakeLevel'
  if (/heroPosition|hero.*\u4f4d\u7f6e|Hero \u4f4d\u7f6e/i.test(source)) return 'heroPosition'
  if (/effectiveStack|effective[_ ]?stack|\u6709\u6548\u7b79\u7801|\u6709\u6548\u7801/i.test(source)) return 'effectiveStack'
  if (/potSize|pot[_ ]?size|\u5e95\u6c60|pot/i.test(source)) return 'potSize'
  if (/currentProfit|current[_ ]?profit|\u8f93\u8d62|\u7ed3\u679c|\u76c8\u5229|\u4e8f\u635f/i.test(source)) return 'currentProfit'
  if (/opponentName|opponent[_ ]?name|\u5bf9\u624b\u6635\u79f0|\u5bf9\u624b\u540d\u5b57|villain.*name/i.test(source)) return 'opponentName'
  if (/opponentType|opponent[_ ]?type|villainType|\u5bf9\u624b\u7c7b\u578b|\u73a9\u5bb6\u7c7b\u578b/i.test(source)) return 'opponentType'
  if (/villainPosition|villain[_ ]?position|\u5bf9\u624b\u4f4d\u7f6e/i.test(source)) return 'villainPosition'
  if (/flop|\u7ffb\u724c/i.test(source)) return 'flop'
  if (/turn|\u8f6c\u724c/i.test(source)) return 'turn'
  if (/river|\u6cb3\u724c/i.test(source)) return 'river'
  if (/board|\u516c\u724c|\u724c\u9762/i.test(source)) return 'board'
  return ''
}

function filterResolvedQuestions(list, extractedHand) {
  return sanitizeArray(list).filter(item => {
    const field = getFieldFromText(item) || item
    return !isFieldFilled(extractedHand, field)
  })
}

function buildContext(hand, session, actions, event) {
  const source = event || {}
  return {
    hand: {
      id: hand && (hand._id || hand.id) || '',
      playerCount: Number(hand && hand.playerCount) || 0,
      playedDate: hand && hand.playedDate || '',
      stakeLevel: hand && hand.stakeLevel || '',
      heroPosition: hand && hand.heroPosition || '',
      heroCardsInput: hand && hand.heroCardsInput || '',
      effectiveStack: hand && hand.effectiveStack || 0,
      potSize: hand && hand.potSize || 0,
      currentProfit: hand && hand.currentProfit || 0,
      hasStraddle: !!(hand && hand.hasStraddle),
      straddleAmount: Number(hand && hand.straddleAmount) || 0,
      opponentType: hand && hand.opponentType || '',
      opponentName: hand && hand.opponentName || '',
      villainPosition: hand && hand.villainPosition || '',
      villainType: hand && (hand.villainType || hand.opponentType) || '',
      board: hand && hand.board || { flop: '', turn: '', river: '' },
      streetInputs: hand && hand.streetInputs || {},
      streetSummary: hand && hand.streetSummary || '',
      showdown: hand && hand.showdown || '',
      heroQuestion: hand && hand.heroQuestion || '',
      tags: hand && hand.tags || [],
      notes: hand && hand.notes || ''
    },
    session: {
      title: session && session.title || '',
      playerCount: Number(session && session.playerCount) || 0,
      date: session && (session.date || String(session.startTime || '').split(' ')[0]) || '',
      stakeLevel: session && session.smallBlind && session.bigBlind ? `${session.smallBlind}/${session.bigBlind}` : '',
      venue: session && session.venue || ''
    },
    actions: Array.isArray(actions)
      ? actions.slice(0, 30).map(item => ({
        street: item.street,
        actorLabel: item.actorLabel,
        actionType: item.actionType,
        amount: item.amount,
        potAfter: item.potAfter
      }))
      : [],
    recentHands: Array.isArray(source.recentHands)
      ? source.recentHands.slice(0, 50).map(item => ({
        id: item.id || item._id || '',
        date: item.date || item.playedDate || '',
        stakeLevel: item.stakeLevel || '',
        heroPosition: item.heroPosition || '',
        heroCardsInput: item.heroCardsInput || '',
        villainPosition: item.villainPosition || '',
        opponentType: item.opponentType || item.villainType || '',
        effectiveStack: Number(item.effectiveStack) || 0,
        potSize: Number(item.potSize) || 0,
        currentProfit: Number(item.currentProfit) || 0,
        board: item.board || { flop: '', turn: '', river: '' },
        streets: item.streets || item.streetInputs || {},
        tags: item.tags || []
      }))
      : [],
    hands: Array.isArray(source.hands)
      ? source.hands.slice(0, 80).map(item => ({
        id: item.id || item._id || '',
        date: item.date || item.playedDate || '',
        stakeLevel: item.stakeLevel || '',
        heroPosition: item.heroPosition || '',
        heroCardsInput: item.heroCardsInput || '',
        villainPosition: item.villainPosition || '',
        opponentType: item.opponentType || item.villainType || '',
        effectiveStack: Number(item.effectiveStack) || 0,
        potSize: Number(item.potSize) || 0,
        currentProfit: Number(item.currentProfit) || 0,
        board: item.board || { flop: '', turn: '', river: '' },
        streetSummary: item.streetSummary || '',
        tags: item.tags || [],
        aiReview: item.aiReview || null
      }))
      : [],
    stats: source.stats || source.context && source.context.stats || {},
    profile: source.profile || source.context && source.context.profile || {}
  }
}

function buildUserPrompt(cleanedTranscript, context, userTerms) {
  return [
    'User personal glossary:',
    JSON.stringify(aiNormalizer.normalizeUserTerms(userTerms || []), null, 2),
    'Apply the glossary before extracting fields.',
    'Extract a strict JSON poker hand record for miniapp backfill.',
    'If current hand context already has a field, keep it unless the transcript clearly overrides it.',
    'Do not list missing fields that are already present in context.',
    '',
    'Current hand context:',
    JSON.stringify(context, null, 2),
    '',
    'Voice transcript:',
    cleanedTranscript
  ].join('\n')
}

function buildFallbackExtract(cleanedTranscript, context) {
  const currentHand = context.hand || {}
  const session = context.session || {}
  const posMatch = cleanedTranscript.match(/\b(UTG|HJ|CO|BTN|SB|BB|LJ|MP)\b/i)
  const levelMatch = cleanedTranscript.match(/(?:^|[^\d])((?:\d{2,4})\s*\/\s*(?:\d{2,4}))(?:[^\d]|$)/)
  const winMatch = cleanedTranscript.match(/\u8d62\s*(-?\d+)/)
  const loseMatch = cleanedTranscript.match(/\u8f93\s*(\d+)/)

  return {
    playerCount: resolvePlayerCount(extractPlayerCountFromText(cleanedTranscript), currentHand.playerCount, session.playerCount),
    playedDate: session.date || '',
    stakeLevel: levelMatch ? levelMatch[1].replace(/\s+/g, '') : (session.stakeLevel || ''),
    heroPosition: posMatch ? posMatch[1].toUpperCase() : (currentHand.heroPosition || ''),
    heroCardsInput: toHeroCardsInput(cleanedTranscript) || currentHand.heroCardsInput || '',
    effectiveStack: currentHand.effectiveStack || 0,
    potSize: currentHand.potSize || 0,
    currentProfit: winMatch
      ? toNumber(winMatch[1], currentHand.currentProfit || 0)
      : loseMatch
        ? -Math.abs(toNumber(loseMatch[1], currentHand.currentProfit || 0))
        : (currentHand.currentProfit || 0),
    opponentType: currentHand.opponentType || '',
    opponentName: '',
    villainPosition: currentHand.villainPosition || '',
    board: {
      flop: currentHand.board && currentHand.board.flop || '',
      turn: currentHand.board && currentHand.board.turn || '',
      river: currentHand.board && currentHand.board.river || ''
    },
    streetInputs: {
      preflop: { actionLine: '', pot: '' },
      flop: { actionLine: '', pot: '' },
      turn: { actionLine: '', pot: '' },
      river: { actionLine: '', pot: '' }
    },
    streetSummary: cleanedTranscript.slice(0, 120),
    showdown: '',
    mindJourney: cleanedTranscript,
    tags: []
  }
}

function normalizeStreetInputValue(value) {
  if (!value) return { actionLine: '', pot: '' }
  if (typeof value === 'string') return { actionLine: value, pot: '' }
  return {
    actionLine: String(value.actionLine || value.action_line || value.actions || value.line || ''),
    pot: String(value.pot || value.potSize || value.pot_size || '')
  }
}

function normalizeExtractedHand(record, context, cleanedTranscript) {
  const currentHand = context.hand || {}
  const session = context.session || {}
  const fallback = buildFallbackExtract(cleanedTranscript, context)
  const source = record || {}
  const board = source.board || {}
  const streetInputs = source.streetInputs || source.street_inputs || {}
  const normalizedStakeLevel = normalizeStakeLevel(source.stakeLevel, currentHand.stakeLevel || session.stakeLevel || fallback.stakeLevel || '')
  const hasSourceStraddle = Object.prototype.hasOwnProperty.call(source, 'hasStraddle')
  const hasStraddle = hasSourceStraddle ? !!source.hasStraddle : !!currentHand.hasStraddle

  return {
    playerCount: resolvePlayerCount(toNumber(source.playerCount || source.tableSize || source.table_size, 0), fallback.playerCount, currentHand.playerCount, session.playerCount),
    playedDate: String(source.playedDate || fallback.playedDate || '').replace(/-/g, '/'),
    stakeLevel: normalizedStakeLevel,
    hasStraddle,
    straddleAmount: getStraddleAmountFromHand({
      hasStraddle,
      straddleAmount: source.straddleAmount || currentHand.straddleAmount,
      stakeLevel: normalizedStakeLevel
    }, session),
    heroPosition: String(source.heroPosition || fallback.heroPosition || currentHand.heroPosition || '').toUpperCase(),
    heroCardsInput: toHeroCardsInput(source.heroCardsInput || fallback.heroCardsInput || currentHand.heroCardsInput || ''),
    effectiveStack: toNumber(source.effectiveStack, fallback.effectiveStack || 0),
    potSize: toNumber(source.potSize, fallback.potSize || 0),
    currentProfit: toNumber(source.currentProfit, fallback.currentProfit || 0),
    opponentType: String(source.opponentType || fallback.opponentType || currentHand.opponentType || ''),
    opponentName: String(source.opponentName || currentHand.opponentName || ''),
    villainPosition: String(source.villainPosition || fallback.villainPosition || currentHand.villainPosition || '').toUpperCase(),
    board: {
      flop: toBoardCards(board.flop || fallback.board.flop || currentHand.board && currentHand.board.flop || '', 3),
      turn: toBoardCards(board.turn || fallback.board.turn || currentHand.board && currentHand.board.turn || '', 1),
      river: toBoardCards(board.river || fallback.board.river || currentHand.board && currentHand.board.river || '', 1)
    },
    streetInputs: {
      preflop: normalizeStreetInputValue(streetInputs.preflop),
      flop: normalizeStreetInputValue(streetInputs.flop),
      turn: normalizeStreetInputValue(streetInputs.turn),
      river: normalizeStreetInputValue(streetInputs.river)
    },
    streetSummary: String(source.streetSummary || fallback.streetSummary || currentHand.streetSummary || ''),
    showdown: String(source.showdown || ''),
    mindJourney: String(source.mindJourney || fallback.mindJourney || currentHand.notes || ''),
    heroQuestion: String(source.heroQuestion || currentHand.heroQuestion || '').trim(),
    tags: reviewTags.normalizeReviewTags(source.tags),
    sessionTitle: session.title || ''
  }
}

function buildPokerAgentQuestion(cleanedTranscript, context) {
  const hand = context.hand || {}
  const session = context.session || {}
  const board = hand.board || {}
  const streetInputs = hand.streetInputs || {}
  const authoritativePayload = {
    structuredHand: hand,
    session,
    actions: context.actions || []
  }
  return [
    'Task: hand_review',
    'You are a professional Texas Holdem live cash Poker Agent and hand-review coach.',
    'Review the completed structured hand. The JSON block below is authoritative. Do not re-parse it as ordinary prompt text and do not report fields as missing when they are present in structuredHand.',
    'Perspective is mandatory: Hero is the miniapp user and the player being coached. Always evaluate Hero decisions only. Do not rewrite the hand from villain/opponent perspective.',
    'If showdown or transcript says the opponent/villain had a made hand such as set, two pair, straight, flush, or full house, treat that as villain hand information, not Hero hand information, unless structuredHand.heroCardsInput explicitly makes Hero hold that hand.',
    'When Hero has only a draw such as gutshot, backdoor flush draw, open-ended draw, or combo draw, evaluate Hero draw equity, fold equity, pot odds, stack-off decision, and exploit assumptions. Do not praise a value line for a made hand Hero does not hold.',
    'The miniapp user already sees the structured fields. Do not answer with field-readiness status such as "structured hand loaded", "can review by position/cards/actions", or "補齐缺失字段". That is not useful advice.',
    'Your job is to coach the actual poker decisions in this hand: identify the key decision points, explain why a line is good/bad, give a better line with sizing, label confidence, and provide targeted drills.',
    '如果 heroQuestion 不为空，优先回答 Hero 疑问点，并明确说明建议针对这个问题。',
    COMPACT_ACTION_LINE_INSTRUCTION,
    'If deterministic range data is missing, continue with professional poker reasoning and label the confidence. Do not expose internal debug strings such as spot_id, file names, range_gap, or tool paths to the user.',
    'Return practical Chinese advice with: verdict, street_breakdown, key_takeaway, good_points, issues, clear_mistakes, optimizations, exploit_adjustments, training_plan, leak_tags, missing_fields.',
    'Keep verdict and key_takeaway short. Do not duplicate the same conclusion in answer, summary, verdict, and key_takeaway. The miniapp renders structured sections, so answer/summary can be empty when structured fields are present.',
    'For extracted hand tags, choose only fixed miniapp hand categories: 精彩, 可优化, 明显错误, Hero Call, Overfold, Bad Fold, 价值下注, 诈唬, 多人池, 深筹码, 3Bet池, 4Bet池.',
    'Each issue/optimization must mention a concrete street or decision and the reason. Avoid generic sentences that could apply to any hand.',
    'street_breakdown is the most important section. It should be an array in order: preflop, flop, turn, river, showdown only if relevant. For each street, include street, status (标准/可优化/错误/无争议), and 1-3 concrete bullet points.',
    'key_takeaway should be one concise coach-style takeaway in Chinese. It must be specific to this hand type, not a generic poker slogan.',
    'Use the style of a concise live-cash coach: "翻前 ✅ 可行", "对鱼 all-in 可以，打 Reg 标准 4bet 更灵活", "Turn 湿润牌面要保护下注".',
    'When the hand is preflop all-in or ends before later streets, focus on preflop range, stack depth, player type, fold equity, blockers, pot odds, and exploit assumptions instead of asking for irrelevant later street cards.',
    '',
    'Authoritative structured payload:',
    JSON.stringify(authoritativePayload, null, 2),
    '',
    'Structured hand context:',
    `table_size: ${hand.playerCount || session.playerCount || 8}max`,
    `stakes: ${hand.stakeLevel || session.stakeLevel || '-'}`,
    `hasStraddle: ${!!hand.hasStraddle}`,
    `straddleAmount: ${hand.straddleAmount || 0}`,
    `hero_position: ${hand.heroPosition || '-'}`,
    `hero_hand: ${hand.heroCardsInput || '-'}`,
    `effective_stack: ${hand.effectiveStack || '-'}`,
    `pot_size: ${hand.potSize || '-'}`,
    `current_profit: ${hand.currentProfit || '-'}`,
    `villain_position: ${hand.villainPosition || '-'}`,
    `opponent_type: ${hand.opponentType || hand.villainType || '-'}`,
    `opponent_name: ${hand.opponentName || '-'}`,
    `showdown: ${hand.showdown || '-'}`,
    `flop: ${board.flop || '-'}`,
    `turn: ${board.turn || '-'}`,
    `river: ${board.river || '-'}`,
    `street_summary: ${hand.streetSummary || '-'}`,
    `preflop: ${streetInputs.preflop && streetInputs.preflop.actionLine || '-'}`,
    `flop_action: ${streetInputs.flop && streetInputs.flop.actionLine || '-'}`,
    `turn_action: ${streetInputs.turn && streetInputs.turn.actionLine || '-'}`,
    `river_action: ${streetInputs.river && streetInputs.river.actionLine || '-'}`,
    `heroQuestion: ${hand.heroQuestion || '-'}`,
    '',
    'User transcript / notes:',
    cleanedTranscript
  ].join('\n')
}

function buildPokerAgentChatQuestion(cleanedTranscript, context, event) {
  return String(cleanedTranscript || '').trim()
}

function buildPokerAgentSessionSummaryQuestion(cleanedTranscript, context) {
  const session = context.session || {}
  const hands = Array.isArray(context.hands) ? context.hands : []
  return [
    'Task: session_summary',
    'You are summarizing ONE live poker session for the miniapp user.',
    'ONLY use the session and hands provided below. Do not use long-term memory, chat history, or hands outside this payload.',
    'Every provided hand must be considered. If a hand has limited aiReview, still include it in the per-hand judgment.',
    '你是现场德州扑克 session 复盘教练。请汇总整个 session，而不是重新逐手复盘。',
    '必须基于 Miniapp session、hands、每手 aiReview 来总结。不要编造不存在的手牌。',
    '输出中文，结构包括：总览、逐手摘要、打得好的地方、明显错误、可以优化、session 倾向、一句话总结、训练计划。',
    '计数请按手牌归类：精彩手 good、错误手 mistakes、可优化手 optimizations。同一手可以同时可优化，但精彩/错误要谨慎。',
    '倾向性要判断是否有 overplay、on tilt、级别管理问题、疲劳、运气欠佳、运气爆炸、选择性进攻不足等。',
    'Return JSON when possible with fields: overview, counts{good,mistakes,optimizations}, hand_summaries, good_hands, mistake_hands, optimization_hands, tendency, recommendations, training_plan, one_liner.',
    'hand_summaries must contain one concise item per provided hand, labeled by hand index/cards/profit when available.',
    COMPACT_ACTION_LINE_INSTRUCTION,
    '',
    'User request:',
    cleanedTranscript,
    '',
    'Session:',
    JSON.stringify(session, null, 2),
    '',
    'Reviewed hands with AI advice:',
    JSON.stringify(hands.map((hand, index) => ({
      index: index + 1,
      id: hand.id || hand._id || '',
      date: hand.date || hand.playedDate || '',
      stakeLevel: hand.stakeLevel || '',
      heroPosition: hand.heroPosition || '',
      heroCardsInput: hand.heroCardsInput || '',
      villainPosition: hand.villainPosition || '',
      currentProfit: Number(hand.currentProfit) || 0,
      potSize: Number(hand.potSize) || 0,
      streetSummary: hand.streetSummary || '',
      tags: hand.tags || [],
      aiReview: hand.aiReview || null
    })), null, 2)
  ].join('\n')
}

function buildPokerAgentExtractQuestion(cleanedTranscript, context, corrections) {
  const hand = context.hand || {}
  const session = context.session || {}
  const correctionText = corrections
    ? JSON.stringify(corrections)
    : ''
  return [
    'Task: extract_hand_fields',
    'You are the user-specific Poker Agent for live Texas Holdem voice review.',
    'Use your poker rules, user memory, dialect habits, nickname mappings, and prior corrections first. If your built-in Agent knowledge is not enough, use your internal LLM fallback, but return the Agent-verified structured result.',
    'Do not provide strategy advice in this task. Only extract fields for miniapp backfill.',
    'Return JSON if possible. Important fields: playedDate, stakeLevel, hasStraddle, straddleAmount, heroPosition, heroCardsInput, effectiveStack, potSize, currentProfit, opponentType, opponentName, villainPosition, board.flop, board.turn, board.river, streetInputs, streetSummary, showdown, mindJourney, heroQuestion, tags, missingFields, followUpQuestions, naturalLanguageSummary.',
    COMPACT_ACTION_LINE_INSTRUCTION,
    'For tags, choose only from this fixed miniapp taxonomy: 精彩, 可优化, 明显错误, Hero Call, Overfold, Bad Fold, 价值下注, 诈唬, 多人池, 深筹码, 3Bet池, 4Bet池. Do not return internal snake_case leak tags for extractedHand.tags.',
    'If the user did not mention river because the hand ended on turn, keep river empty.',
    '',
    'Current hand context:',
    `date: ${hand.playedDate || session.date || '-'}`,
    `stakes: ${hand.stakeLevel || session.stakeLevel || '-'}`,
    `hasStraddle: ${!!hand.hasStraddle}`,
    `straddleAmount: ${hand.straddleAmount || 0}`,
    `hero_position: ${hand.heroPosition || '-'}`,
    `hero_hand: ${hand.heroCardsInput || '-'}`,
    `villain_position: ${hand.villainPosition || '-'}`,
    `opponent_type: ${hand.opponentType || hand.villainType || '-'}`,
    `effective_stack: ${hand.effectiveStack || '-'}`,
    `pot_size: ${hand.potSize || '-'}`,
    `current_profit: ${hand.currentProfit || '-'}`,
    `opponent_name: ${hand.opponentName || '-'}`,
    `showdown: ${hand.showdown || '-'}`,
    `heroQuestion: ${hand.heroQuestion || '-'}`,
    '',
    correctionText ? 'User correction / confirmed fields for learning:' : '',
    correctionText,
    '',
    'Voice transcript:',
    cleanedTranscript
  ].filter(line => line !== '').join('\n')
}

function mapPokerAgentParsedHand(parsedHand, context) {
  const parsed = parsedHand || {}
  const hero = parsed.hero || {}
  const boardList = Array.isArray(parsed.board) ? parsed.board : []
  const board = context.hand && context.hand.board || {}
  return {
    playerCount: resolvePlayerCount(parsed.table_size, parsed.player_count, context.hand && context.hand.playerCount, context.session && context.session.playerCount),
    playedDate: context.hand && context.hand.playedDate || context.session && context.session.date || '',
    stakeLevel: parsed.stakes || context.hand && context.hand.stakeLevel || context.session && context.session.stakeLevel || '',
    hasStraddle: !!(context.hand && context.hand.hasStraddle),
    straddleAmount: getStraddleAmountFromHand(context.hand || {}, context.session || {}),
    heroPosition: hero.position || context.hand && context.hand.heroPosition || '',
    heroCardsInput: hero.hand || context.hand && context.hand.heroCardsInput || '',
    effectiveStack: parsed.effective_stack || hero.stack || context.hand && context.hand.effectiveStack || 0,
    potSize: context.hand && context.hand.potSize || 0,
    currentProfit: context.hand && context.hand.currentProfit || 0,
    opponentType: context.hand && (context.hand.opponentType || context.hand.villainType) || '',
    opponentName: context.hand && context.hand.opponentName || '',
    villainPosition: context.hand && context.hand.villainPosition || '',
    board: {
      flop: board.flop || boardList.slice(0, 3).join(''),
      turn: board.turn || boardList.slice(3, 4).join(''),
      river: board.river || boardList.slice(4, 5).join('')
    },
    streetInputs: context.hand && context.hand.streetInputs || {},
    streetSummary: context.hand && context.hand.streetSummary || '',
    showdown: context.hand && context.hand.showdown || '',
    mindJourney: context.hand && (context.hand.mindJourney || context.hand.notes) || '',
    heroQuestion: context.hand && context.hand.heroQuestion || '',
    tags: []
  }
}

function normalizePokerAgentReview(agentResponse, cleanedTranscript, context) {
  const response = agentResponse || {}
  const review = response.data && response.data.review || {}
  const parsedHand = review.parsed_hand || {}
  const answer = cleanAgentAdviceText(String(response.answer || review.summary || cleanedTranscript || '').trim())
  const summary = cleanAgentAdviceText(String(review.summary || '').trim())
  const trainingPlan = Array.isArray(review.training_plan) ? review.training_plan : []
  const leakTags = Array.isArray(review.leak_tags) ? review.leak_tags : []
  const handTags = reviewTags.normalizeReviewTags([].concat(parsedHand.tags || []).concat(leakTags))
  const missingFields = filterResolvedQuestions(Array.isArray(response.missing_fields)
    ? response.missing_fields
    : Array.isArray(parsedHand.missing_fields)
      ? parsedHand.missing_fields
      : [], context.hand || {})

  return {
    extractedHand: Object.assign(
      mapPokerAgentParsedHand(parsedHand, context),
      {
        mindJourney: answer,
        tags: handTags
      }
    ),
    missingFields,
    followUpQuestions: missingFields.map(field => `${field} \u9700\u8981\u8865\u5145\uff0c\u4f1a\u5f71\u54cd Agent \u5efa\u8bae\u7f6e\u4fe1\u5ea6\u3002`),
    naturalLanguageSummary: answer,
    analysis: {
      provider: 'poker-agent',
      intent: response.intent || 'hand_review',
      answer,
      summary,
      spots: review.spots || [],
      leakTags: sanitizeAgentTags(leakTags),
      trainingPlan: sanitizeAgentList(trainingPlan),
      confidence: response.confidence || null,
      missingFields,
      verdict: cleanAgentAdviceText(review.verdict || response.verdict || ''),
      goodPoints: sanitizeAgentList(review.good_points || response.good_points || response.goodPoints),
      issues: sanitizeAgentList(review.issues || response.issues),
      clearMistakes: sanitizeAgentList(review.clear_mistakes || response.clear_mistakes || response.clearMistakes),
      optimizations: sanitizeAgentList(review.optimizations || response.optimizations),
      exploitAdjustments: sanitizeAgentList(review.exploit_adjustments || response.exploit_adjustments || response.exploitAdjustments),
      streetBreakdown: sanitizeAgentStreetBreakdown(review.street_breakdown || review.streetBreakdown || response.street_breakdown || response.streetBreakdown),
      keyTakeaway: cleanAgentAdviceText(review.key_takeaway || review.keyTakeaway || response.key_takeaway || response.keyTakeaway || review.human_rule || review.humanRule || response.human_rule || response.humanRule || ''),
      humanRule: cleanAgentAdviceText(review.human_rule || review.humanRule || response.human_rule || response.humanRule || ''),
      raw: response
    }
  }
}

function isInternalAgentLine(line) {
  return /(?:spot_id|file=|range_gap|Imported from|local user-provided|range_not_found|UTG vs None|incomplete_hand_info|deep_stack_preflop)/i.test(String(line || ''))
}

function isLowValueAgentAdviceLine(line) {
  const text = String(line || '').trim()
  return /(?:结构化(?:牌局|手牌)?信息已读取|可按位置、?手牌、?行动线|后续可以接结构化范围判断|关键(?:信息|字段)里包含|补齐缺失字段后|便于复盘每个决策点|默认范围建议和该玩家)/.test(text)
}

function cleanAgentAdviceText(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !isInternalAgentLine(line) && !isLowValueAgentAdviceLine(line))
    .join('\n')
    .trim()
}

function sanitizeAgentList(list) {
  return sanitizeArray(Array.isArray(list) ? list : [])
    .map(cleanAgentAdviceText)
    .filter(Boolean)
}

function sanitizeAgentStreetBreakdown(list) {
  return (Array.isArray(list) ? list : [])
    .map((item, index) => {
      if (typeof item === 'string') {
        const text = cleanAgentAdviceText(item)
        return text ? { key: String(index), street: '', status: '', points: [text] } : null
      }
      const source = item || {}
      const street = cleanAgentAdviceText(source.street || source.name || source.title || '')
      const status = cleanAgentAdviceText(source.status || source.verdict || '')
      const points = sanitizeAgentList(source.points || source.bullets || source.advice || source.items)
      const text = cleanAgentAdviceText(source.text || source.summary || '')
      const nextPoints = points.length ? points : (text ? [text] : [])
      if (!street && !status && !nextPoints.length) return null
      return {
        key: String(index),
        street,
        status,
        points: nextPoints
      }
    })
    .filter(Boolean)
}

function sanitizeAgentTags(list) {
  return sanitizeArray(Array.isArray(list) ? list : [])
    .filter(tag => !isInternalAgentLine(tag))
}

function parseAgentAnswerPayload(response) {
  const candidates = [
    response && response.answer,
    response && response.field_summary,
    response && response.naturalLanguageSummary
  ]
  for (let i = 0; i < candidates.length; i += 1) {
    const content = candidates[i]
    if (!content || typeof content !== 'string') continue
    const parsed = safeJsonParse(extractJsonBlock(content), null)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  }
  return {}
}

function mergeAgentExtractPayload(response, answerPayload) {
  const payload = answerPayload || {}
  const answerHand = payload.extractedHand || payload.extracted_hand || payload.parsedHand || payload.parsed_hand || payload
  const directHand = response.extractedHand || response.extracted_hand || {}
  return Object.assign({}, answerHand || {}, directHand || {})
}

function normalizePokerAgentExtract(agentResponse, cleanedTranscript, context) {
  const response = agentResponse || {}
  const review = response.data && response.data.review || {}
  const answerPayload = parseAgentAnswerPayload(response)
  const parsedHand = Object.assign(
    {},
    review.parsed_hand || response.parsed_hand || {},
    mergeAgentExtractPayload(response, answerPayload)
  )
  const missingFields = Array.isArray(response.missingFields)
    ? response.missingFields
    : Array.isArray(response.missing_fields)
      ? response.missing_fields
      : Array.isArray(answerPayload.missingFields)
        ? answerPayload.missingFields
        : Array.isArray(answerPayload.missing_fields)
          ? answerPayload.missing_fields
          : Array.isArray(parsedHand.missing_fields)
            ? parsedHand.missing_fields
            : []
  const followUpQuestions = Array.isArray(response.followUpQuestions)
    ? response.followUpQuestions
    : Array.isArray(response.follow_up_questions)
      ? response.follow_up_questions
      : Array.isArray(answerPayload.followUpQuestions)
        ? answerPayload.followUpQuestions
        : Array.isArray(answerPayload.follow_up_questions)
          ? answerPayload.follow_up_questions
          : []
  const answer = String(
    response.naturalLanguageSummary ||
    answerPayload.naturalLanguageSummary ||
    answerPayload.natural_language_summary ||
    response.field_summary ||
    response.answer ||
    cleanedTranscript ||
    ''
  ).trim()
  return {
    extractedHand: normalizeExtractedHand(parsedHand, context, cleanedTranscript),
    missingFields,
    followUpQuestions,
    naturalLanguageSummary: answer,
    analysis: null,
    rawAgentResponse: response
  }
}

function normalizePokerAgentChat(agentResponse, cleanedTranscript) {
  const response = agentResponse || {}
  const answerPayload = parseAgentAnswerPayload(response)
  const data = response.data || {}
  const answer = cleanAgentAdviceText(String(
    response.answer ||
    response.message ||
    response.text ||
    answerPayload.answer ||
    answerPayload.message ||
    data.answer ||
    data.message ||
    ''
  ).trim())
  const suggestions = sanitizeAgentList(
    response.suggestions ||
    answerPayload.suggestions ||
    data.suggestions ||
    []
  )
  const imageUrl = normalizeAgentResourceUrl(
    response.imageUrl ||
    response.image_url ||
    response.rangeImageUrl ||
    response.range_image_url ||
    answerPayload.imageUrl ||
    answerPayload.image_url ||
    answerPayload.rangeImageUrl ||
    answerPayload.range_image_url ||
    data.imageUrl ||
    data.image_url ||
    data.rangeImageUrl ||
    data.range_image_url ||
    extractImageUrlFromText(answer)
  )
  return {
    answer: answer || cleanedTranscript,
    suggestions,
    imageUrl,
    rawAgentResponse: response
  }
}

function normalizePokerAgentSessionSummary(agentResponse) {
  const response = agentResponse || {}
  const answerPayload = parseAgentAnswerPayload(response)
  const data = response.data || {}
  const source = Object.assign(
    {},
    answerPayload.sessionSummary || answerPayload.session_summary || answerPayload.summary || {},
    data.sessionSummary || data.session_summary || data.summary || data,
    response.summary || {}
  )
  const counts = source.counts || response.counts || data.counts || {}
  const answer = cleanAgentAdviceText(String(
    response.answer ||
    response.message ||
    answerPayload.answer ||
    answerPayload.message ||
    source.answer ||
    ''
  ).trim())
  return {
    answer,
    overview: cleanAgentAdviceText(source.overview || response.overview || ''),
    counts: {
      good: Number(counts.good || counts.excellent || counts.highlights) || 0,
      mistakes: Number(counts.mistakes || counts.errors || counts.bad) || 0,
      optimizations: Number(counts.optimizations || counts.improvements || counts.optimize) || 0
    },
    goodHands: sanitizeAgentList(source.goodHands || source.good_hands || response.goodHands || response.good_hands),
    mistakeHands: sanitizeAgentList(source.mistakeHands || source.mistake_hands || response.mistakeHands || response.mistake_hands),
    optimizationHands: sanitizeAgentList(source.optimizationHands || source.optimization_hands || response.optimizationHands || response.optimization_hands),
    handSummaries: sanitizeAgentList(source.handSummaries || source.hand_summaries || response.handSummaries || response.hand_summaries),
    tendency: cleanAgentAdviceText(source.tendency || source.session_tendency || response.tendency || ''),
    recommendations: sanitizeAgentList(source.recommendations || source.advice || response.recommendations),
    trainingPlan: sanitizeAgentList(source.trainingPlan || source.training_plan || response.trainingPlan || response.training_plan),
    oneLiner: cleanAgentAdviceText(source.oneLiner || source.one_liner || source.keyTakeaway || source.key_takeaway || response.oneLiner || ''),
    rawAgentResponse: response
  }
}

async function callPokerAgentTask(mode, cleanedTranscript, context, event) {
  const config = getEnvConfig()
  const agentUserId = getAgentUserId(event, config)
  const chatIntent = mode === 'chat'
    ? normalizeChatIntent(event && (event.chatIntent || event.intent || event.taskIntent), cleanedTranscript)
    : ''
  const chatContext = mode === 'chat'
    ? buildChatAgentContext(context, chatIntent)
    : {}
  const chatTask = mode === 'chat'
    ? getPokerAgentChatTask(chatIntent)
    : ''
  const question = mode === 'chat'
    ? buildPokerAgentChatQuestion(cleanedTranscript, context, event)
    : mode === 'session_summary'
      ? buildPokerAgentSessionSummaryQuestion(cleanedTranscript, context)
      : mode === 'advice'
        ? buildPokerAgentQuestion(cleanedTranscript, context)
        : buildPokerAgentExtractQuestion(cleanedTranscript, context, event && (event.corrections || event.correction))
  const response = await requestJson(
    `${config.baseUrl.replace(/\/$/, '')}${config.path}`,
    {
      user_id: agentUserId,
      mode,
      task: mode === 'chat' ? chatTask : mode === 'session_summary' ? 'session_summary' : mode === 'advice' ? 'hand_review' : 'extract_hand_fields',
      intent: chatIntent || undefined,
      chat_intent: chatIntent || undefined,
      subtask: chatIntent || undefined,
      question,
      context: {
        hand: mode === 'chat' ? (chatContext.hand || {}) : (context.hand || {}),
        session: mode === 'chat' ? (chatContext.session || {}) : (context.session || {}),
        actions: mode === 'chat' ? (chatContext.actions || []) : (context.actions || []),
        recentHands: mode === 'chat' ? (chatContext.recentHands || []) : (context.recentHands || []),
        hands: mode === 'session_summary' ? (context.hands || []) : undefined,
        stats: mode === 'chat' ? (chatContext.stats || {}) : (context.stats || {}),
        profile: mode === 'chat' ? (chatContext.profile || {}) : (context.profile || {}),
        chatIntent: chatIntent || undefined
      },
      structuredHand: mode === 'advice' ? (context.hand || {}) : undefined,
      extractedHand: mode === 'advice' ? (context.hand || {}) : undefined,
      corrections: event && (event.corrections || event.correction) || null
    },
    {},
    config.timeout
  )
  return mode === 'chat'
    ? normalizePokerAgentChat(response, cleanedTranscript)
    : mode === 'session_summary'
      ? normalizePokerAgentSessionSummary(response)
      : mode === 'advice'
        ? normalizePokerAgentReview(response, cleanedTranscript, context)
        : normalizePokerAgentExtract(response, cleanedTranscript, context)
}

async function callKimiReview(cleanedTranscript, context, userTerms) {
  const config = getEnvConfig()
  if (!config.apiKey) {
    const error = new Error('璇峰厛閰嶇疆 MOONSHOT_API_KEY 鎴?KIMI_API_KEY')
    error.code = 'MISSING_MOONSHOT_API_KEY'
    throw error
  }

  const response = await requestJson(
    `${config.baseUrl.replace(/\/$/, '')}/chat/completions`,
    {
      model: config.model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(cleanedTranscript, context, userTerms) }
      ]
    },
    {
      Authorization: `Bearer ${config.apiKey}`
    },
    config.timeout
  )

  const content = extractContentText(response && response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content)
  const jsonText = extractJsonBlock(content)
  const parsed = safeJsonParse(jsonText, null)
  if (!parsed) {
    const error = new Error('Kimi 杩斿洖鐨勪笉鏄湁鏁?JSON')
    error.code = 'INVALID_KIMI_JSON'
    error.raw = content
    throw error
  }
  return parsed
}

async function callMiniMaxReview(cleanedTranscript, context, userTerms) {
  const config = getEnvConfig()
  if (!config.apiKey) {
    const error = new Error('璇峰厛閰嶇疆 MINIMAX_API_KEY')
    error.code = 'MISSING_MINIMAX_API_KEY'
    throw error
  }

  const response = await requestJson(
    `${config.baseUrl.replace(/\/$/, '')}/chat/completions`,
    {
      model: config.model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(cleanedTranscript, context, userTerms) }
      ]
    },
    {
      Authorization: `Bearer ${config.apiKey}`
    },
    config.timeout
  )

  const content = extractContentText(response && response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content)
  const jsonText = extractJsonBlock(content)
  const parsed = safeJsonParse(jsonText, null)
  if (!parsed) {
    const error = new Error('MiniMax 杩斿洖鐨勪笉鏄湁鏁?JSON')
    error.code = 'INVALID_MINIMAX_JSON'
    error.raw = content
    throw error
  }
  return parsed
}

async function callOpenAIReview(cleanedTranscript, context, userTerms) {
  const config = getEnvConfig()
  if (!config.apiKey) {
    const error = new Error('璇峰厛閰嶇疆 OPENAI_API_KEY')
    error.code = 'MISSING_OPENAI_API_KEY'
    throw error
  }

  const response = await requestJson(
    `${config.baseUrl.replace(/\/$/, '')}/responses`,
    {
      model: config.model,
      input: [
        {
          role: 'system',
          content: SYSTEM_PROMPT
        },
        {
          role: 'user',
          content: buildUserPrompt(cleanedTranscript, context, userTerms)
        }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'poker_review_extract',
          strict: true,
          schema: REVIEW_RESPONSE_SCHEMA
        }
      }
    },
    {
      Authorization: `Bearer ${config.apiKey}`
    },
    config.timeout
  )

  const content = response.output_text ||
    (Array.isArray(response.output)
      ? response.output.map(item => {
        const contentItems = item && item.content
        return Array.isArray(contentItems)
          ? contentItems.map(part => part && (part.text || part.output_text || '')).join('')
          : ''
      }).join('\n')
      : '')
  const jsonText = extractJsonBlock(content)
  const parsed = safeJsonParse(jsonText, null)
  if (!parsed) {
    const error = new Error('OpenAI 杩斿洖鐨勪笉鏄湁鏁?JSON')
    error.code = 'INVALID_OPENAI_JSON'
    error.raw = content
    throw error
  }
  return parsed
}

async function callAiReview(cleanedTranscript, context, userTerms, mode, event) {
  const config = getEnvConfig()
  if (config.provider === 'poker-agent') {
    return {
      provider: 'poker-agent',
      result: await callPokerAgentTask(mode, cleanedTranscript, context, event)
    }
  }
  if (config.provider === 'openai') {
    return {
      provider: 'openai',
      result: await callOpenAIReview(cleanedTranscript, context, userTerms)
    }
  }
  if (config.provider === 'minimax') {
    return {
      provider: 'minimax',
      result: await callMiniMaxReview(cleanedTranscript, context, userTerms)
    }
  }
  return {
    provider: 'kimi',
    result: await callKimiReview(cleanedTranscript, context, userTerms)
  }
}

exports.main = async event => {
  const mode = normalizeMode(event && event.mode)
  const context = buildContext(event && event.hand, event && event.session, event && event.actions, event)
  const transcript = String(
    event && (event.transcript || event.text || event.message || event.question || event.voiceNote || '') ||
    (mode === 'advice' && context.hand && (context.hand.voiceNote || context.hand.streetSummary || context.hand.notes)) ||
    ''
  ).trim()
  if (!transcript) {
    return {
      code: 'MISSING_TRANSCRIPT',
      message: mode === 'chat' ? '缺少聊天内容' : '缺少复盘文本'
    }
  }

  const userTerms = aiNormalizer.normalizeUserTerms(event && (event.userTerms || event.termGlossary))
  const termApplied = aiNormalizer.applyUserTerms(transcript, userTerms)
  const cleanedTranscript = cleanTranscript(termApplied.text)

  try {
    const ai = await callAiReview(cleanedTranscript, context, userTerms, mode, event)
    const result = ai.result
    if (mode === 'chat') {
      return {
        code: 0,
        provider: ai.provider,
        mode,
        answer: String(result.answer || cleanedTranscript || ''),
        suggestions: result.suggestions || [],
        raw: result.rawAgentResponse || result
      }
    }
    if (mode === 'session_summary') {
      return {
        code: 0,
        provider: ai.provider,
        mode,
        summary: result,
        answer: String(result.answer || result.oneLiner || ''),
        raw: result.rawAgentResponse || result
      }
    }

    const processed = aiNormalizer.postProcessReviewResult(result, transcript, context.hand)
    const extractedHand = normalizeExtractedHand(processed.extractedHand, context, transcript)
    const missingFields = filterResolvedQuestions(processed.missingFields, extractedHand)
    const followUpQuestions = filterResolvedQuestions(processed.followUpQuestions, extractedHand)

    return {
      code: 0,
      provider: ai.provider,
      mode,
      cleanedTranscript,
      appliedTerms: termApplied.appliedTerms,
      extractedHand,
      missingFields,
      followUpQuestions,
      naturalLanguageSummary: String(processed.naturalLanguageSummary || cleanedTranscript || ''),
      analysis: result.analysis || null,
      raw: result
    }
  } catch (error) {
    if (error && (
      error.code === 'INVALID_KIMI_JSON' ||
      error.code === 'MISSING_MOONSHOT_API_KEY' ||
      error.code === 'INVALID_OPENAI_JSON' ||
      error.code === 'MISSING_OPENAI_API_KEY' ||
      error.code === 'INVALID_MINIMAX_JSON' ||
      error.code === 'MISSING_MINIMAX_API_KEY'
    )) {
      return {
        code: error.code,
        message: error.message,
        cleanedTranscript,
        extractedHand: normalizeExtractedHand(null, context, transcript),
        missingFields: [],
        followUpQuestions: [],
        naturalLanguageSummary: cleanedTranscript,
        raw: error.raw || null
      }
    }

    return {
      code: 'POKER_REVIEW_FAILED',
      message: error && error.message ? error.message : 'poker review failed'
    }
  }
}

module.exports.__test = {
  getEnvConfig,
  normalizeMode,
  normalizeChatIntent,
  buildChatAgentContext,
  getPokerAgentChatTask,
  getAgentUserId,
  normalizeExtractedHand,
  filterResolvedQuestions,
  normalizePokerAgentReview,
  normalizePokerAgentExtract,
  normalizePokerAgentChat,
  normalizePokerAgentSessionSummary,
  buildPokerAgentExtractQuestion,
  buildPokerAgentQuestion,
  buildPokerAgentChatQuestion,
  buildPokerAgentSessionSummaryQuestion
}

