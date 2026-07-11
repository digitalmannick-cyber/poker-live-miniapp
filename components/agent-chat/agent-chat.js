const aiService = require('../../services/ai-service')
const dataService = require('../../services/data-service')
const aiReminders = require('../../utils/ai-reminders')
const reminderCards = require('../../utils/agent-reminder-cards')

const CHAT_STORAGE_KEY = 'poker-agent-chat-history-v1'
const MAX_STORED_MESSAGES = 80
const MAX_RENDERED_MESSAGES = 30
const MAX_MESSAGE_TEXT_LENGTH = 1800
const MAX_CHAT_HISTORY_MESSAGES = 8
const IMAGE_URL_PATTERN = /((?:https?:\/\/|\/)[^\s"'<>]+?\.(?:svg|png|jpe?g|webp)(?:\?[^\s"'<>]*)?)/i

const QUICK_ACTIONS = [
  {
    key: 'review',
    title: '语音牌谱复盘',
    prompt: '我想用自然语言说一手牌，请你帮我提取牌谱并逐街复盘。'
  },
  {
    key: 'range',
    title: '查范围',
    prompt: '8max BTN straddle，CO 面对 HJ open，AQs 怎么打？'
  },
  {
    key: 'recent',
    title: '最近 50 手总结',
    prompt: '请根据我最近 50 手牌，帮我总结主要问题，并制定针对性训练计划。'
  },
  {
    key: 'stop',
    title: '止损止盈检查',
    prompt: '帮我做一次止损止盈和状态检查，判断我现在是否适合继续打。'
  },
  {
    key: 'tell',
    title: '现场马脚快闪题',
    prompt: '给我出一道现场马脚快问题，训练我的现场观察和读牌能力。'
  }
]

function normalizeImageUrl(url) {
  const clean = String(url || '')
    .trim()
    .replace(/[，。；、,.;)）\]]+$/g, '')
  if (!clean) return ''
  return clean
}

function extractMessageImageUrl(text) {
  const content = String(text || '')
  const labeled = content.match(/(?:图片地址|图片链接|image(?:\s*url)?|url)[:：]\s*((?:https?:\/\/|\/)[^\s"'<>]+)/i)
  const candidate = labeled ? labeled[1] : (content.match(IMAGE_URL_PATTERN) || [])[1]
  const clean = normalizeImageUrl(candidate)
  return /\.(svg|png|jpe?g|webp)(?:\?|$)/i.test(clean) ? clean : ''
}

function stripMessageImageUrl(text) {
  return String(text || '')
    .replace(/(^|\n)\s*(?:图片地址|图片链接|image(?:\s*url)?|url)[:：]\s*(?:https?:\/\/|\/)[^\n\r\s"'<>]+/ig, '$1')
    .replace(/(^|\n)\s*(?:https?:\/\/|\/)[^\n\r\s"'<>]+?\.(?:svg|png|jpe?g|webp)(?:\?[^\n\r\s"'<>]*)?/ig, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function getProviderErrorStatus(text) {
  const source = String(text || '')
  const match = source.match(/(?:ai provider http|HTTP|http)\s*(\d{3})/i) ||
    source.match(/\b(408|429|500|502|503|504)\b/)
  return match ? Number(match[1]) : 0
}

function getProviderErrorDisplayMessage(status) {
  if (status === 429) return '大模型请求过于频繁或额度受限（HTTP 429），请稍后重试。'
  if (status === 502) return '大模型网关暂时异常（HTTP 502），请稍后重试。'
  if (status === 503) return '大模型服务暂时不可用（HTTP 503），请稍后重试。'
  if (status === 504) return '大模型响应超时（HTTP 504），请稍后重试。'
  if (status >= 500) return `大模型服务异常（HTTP ${status}），请稍后重试。`
  if (status >= 400) return `大模型调用失败（HTTP ${status}），请检查模型配置或稍后重试。`
  return ''
}

function stripDisplayMarkdown(text) {
  return String(text || '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^\s*---+\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function sanitizeAgentDisplayText(text) {
  const raw = String(text || '').trim()
  if (!raw) return ''
  const status = getProviderErrorStatus(raw)
  if (/<\s*html|<\s*body|<\s*head|nginx|Service Temporarily Unavailable/i.test(raw) || /ai provider http/i.test(raw)) {
    return getProviderErrorDisplayMessage(status) || raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)
  }
  return stripDisplayMarkdown(raw)
}

function extractPayloadImageUrl(payload) {
  const source = payload || {}
  return normalizeImageUrl(
    source.imageUrl ||
    source.image_url ||
    source.rangeImageUrl ||
    source.range_image_url ||
    (source.data && (source.data.imageUrl || source.data.image_url)) ||
    (source.raw && (source.raw.imageUrl || source.raw.image_url)) ||
    ''
  )
}

function buildChatHistory(messages) {
  if (!Array.isArray(messages)) return []
  return messages
    .filter(item => item && (item.role === 'user' || item.role === 'assistant') && (item.text || item.imageUrl))
    .slice(-MAX_CHAT_HISTORY_MESSAGES)
    .map(item => ({
      role: item.role,
      text: String(item.text || '').slice(0, 800),
      intent: String(item.intent || '').trim(),
      imageUrl: normalizeImageUrl(item.imageUrl)
    }))
}

function parseRangeMatrixUrl(url) {
  const source = String(url || '').trim()
  if (!source || source.indexOf('/api/v1/ranges/matrix.png') < 0) return null
  try {
    const parsed = new URL(source, 'https://agent.local')
    const params = parsed.searchParams
    const stack = Number(params.get('stack') || '')
    return {
      table_size: params.get('table') || '',
      blind_structure: params.get('structure') || '',
      stack_depth_bb: Number.isFinite(stack) && stack > 0 ? stack : 0,
      position: params.get('position') || '',
      spot_type: params.get('spot') || ''
    }
  } catch (error) {
    return null
  }
}

function parseRangeMatrixText(text) {
  const source = String(text || '')
  const match = source.match(/\b(6max|8max|9max)\s+(\d{2,4})\s*BB\s+([A-Z]{2,3})\s+([A-Z0-9_]+)\b/i)
  if (!match) return null
  return {
    table_size: match[1].toLowerCase(),
    blind_structure: 'SB_BB',
    stack_depth_bb: Number(match[2]) || 0,
    position: match[3].toUpperCase(),
    spot_type: match[4].toUpperCase()
  }
}

function buildRangeFollowUpContext(messages) {
  if (!Array.isArray(messages)) return {}
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index] || {}
    const parsed = parseRangeMatrixUrl(item.imageUrl) || parseRangeMatrixText(item.text)
    if (parsed && parsed.position && parsed.spot_type) return parsed
  }
  return {}
}

function createMessage(role, text, extra = {}) {
  const id = `${role}-${Date.now()}-${Math.floor(Math.random() * 10000)}`
  const cleanText = sanitizeAgentDisplayText(text)
  const imageUrl = normalizeImageUrl(extra.imageUrl) || extractMessageImageUrl(cleanText)
  const displayText = imageUrl ? stripMessageImageUrl(cleanText) : cleanText
  return {
    id,
    role,
    text: displayText || (imageUrl ? '范围图如下：' : cleanText),
    imageUrl,
    imageError: false,
    intent: String(extra.intent || '').trim(),
    reminder: !!extra.reminder,
    reminderType: String(extra.reminderType || '').trim(),
    severity: String(extra.severity || '').trim(),
    reminderCard: reminderCards.normalizeReminderCard(extra.reminderCard, extra.reminderType)
  }
}

function createReminderMessage(reminder) {
  const payload = reminderCards.buildReminderChatPayload(reminder)
  return createMessage('assistant', payload.text, payload)
}

function createInitialMessages() {
  return [
    createMessage(
      'assistant',
      '我是 EV脑。你可以直接用自然语言问牌谱、查范围、复盘最近手牌，或者让我帮你做状态检查。'
    )
  ]
}

function normalizeStoredMessages(messages) {
  if (!Array.isArray(messages)) return []
  return messages
    .slice(-MAX_STORED_MESSAGES)
    .filter(item => !(item && item.reminder))
    .map(item => {
      const role = item && item.role === 'user' ? 'user' : 'assistant'
      const rawText = sanitizeAgentDisplayText(item && item.text)
      const text = rawText.length > MAX_MESSAGE_TEXT_LENGTH
        ? rawText.slice(0, MAX_MESSAGE_TEXT_LENGTH) + '...'
        : rawText
      return {
        id: String(item && item.id || createMessage(role, text).id),
        role,
        text,
        imageUrl: normalizeImageUrl(item && item.imageUrl) || extractMessageImageUrl(text),
        imageError: false,
        intent: String(item && item.intent || '').trim(),
        reminder: !!(item && item.reminder),
        reminderType: String(item && item.reminderType || '').trim(),
        severity: String(item && item.severity || '').trim(),
        reminderCard: reminderCards.normalizeReminderCard(item && item.reminderCard, item && item.reminderType)
      }
    })
    .filter(item => item.text || item.imageUrl)
    .slice(-MAX_RENDERED_MESSAGES)
}

function loadPersistedMessages() {
  if (typeof wx === 'undefined' || !wx.getStorageSync) return []
  try {
    return normalizeStoredMessages(wx.getStorageSync(CHAT_STORAGE_KEY))
  } catch (error) {
    console.warn('agent chat load history failed: ' + (error && (error.message || error.errMsg) || error))
    return []
  }
}

function persistMessages(messages) {
  if (typeof wx === 'undefined' || !wx.setStorageSync) return
  try {
    wx.setStorageSync(CHAT_STORAGE_KEY, normalizeStoredMessages(messages))
  } catch (error) {
    console.warn('agent chat save history failed: ' + (error && (error.message || error.errMsg) || error))
  }
}

function getCurrentMessages(localMessages) {
  const persistedMessages = loadPersistedMessages()
  if (persistedMessages.length) return persistedMessages
  const normalizedLocalMessages = normalizeStoredMessages(localMessages)
  return normalizedLocalMessages.length ? normalizedLocalMessages : createInitialMessages()
}

function shouldOpenAgentOnAiReminder() {
  return true
}

function parseLooseNumberToken(value) {
  const raw = String(value || '').trim().replace(/,/g, '')
  if (!raw) return 0
  const match = raw.match(/(\d+(?:\.\d+)?)(\s*万)?/)
  if (!match) return 0
  const number = Number(match[1])
  if (!Number.isFinite(number) || number < 0) return 0
  return Math.round(number * (match[2] ? 10000 : 1))
}

function pickNumberNearKeyword(text, keywordPattern) {
  const source = String(text || '')
  const numberPattern = '(\\d+(?:\\.\\d+)?\\s*万?)'
  const after = source.match(new RegExp('(?:' + keywordPattern + ')[^0-9]{0,12}' + numberPattern, 'i'))
  if (after) return parseLooseNumberToken(after[1])
  const before = source.match(new RegExp(numberPattern + '[^0-9]{0,12}(?:' + keywordPattern + ')', 'i'))
  if (before) return parseLooseNumberToken(before[1])
  return 0
}

function createTextReminderFromCommand(text) {
  const source = String(text || '').trim()
  if (!/(提醒我|添加|新增|设置|设定).{0,8}(纯文本|纪律|提醒)|^(提醒我)/.test(source)) return null
  let content = source
    .replace(/^(请|帮我)?\s*(添加|新增|设置|设定)?\s*(一个|一条)?\s*(纯文本|纪律)?\s*提醒[:：]?\s*/i, '')
    .replace(/^提醒我\s*/i, '')
    .trim()
  if (!content || /(止盈|止损|移动止盈|session|Session|时长|预提醒|提前)/.test(content)) return null
  if (content.length > 60) content = content.slice(0, 60)
  return {
    title: content.length > 12 ? content.slice(0, 12) : content,
    content
  }
}

function parseAiReminderSettingsCommand(text) {
  const source = String(text || '').trim()
  if (!source) return null
  const command = {}
  const profitTarget = pickNumberNearKeyword(source, '止盈|盈利目标|赢到')
  const lossLimit = pickNumberNearKeyword(source, '止损|亏损上限|输到')
  const trailingProfit = pickNumberNearKeyword(source, '移动止盈|盈利回撤|止盈回撤')
  const postLossExtraRisk = pickNumberNearKeyword(source, '止损后|追加风险|再亏')
  const sessionMaxHours = pickNumberNearKeyword(source, 'Session时长|session时长|时长上限|最长时长|不超过')
  const sessionPreReminder = pickNumberNearKeyword(source, '提前|预提醒')
  const textReminder = createTextReminderFromCommand(source)

  if (profitTarget > 0) command.profitTarget = profitTarget
  if (lossLimit > 0) command.lossLimit = lossLimit
  if (trailingProfit > 0) command.trailingProfit = trailingProfit
  if (postLossExtraRisk > 0) command.postLossExtraRisk = postLossExtraRisk
  if (sessionMaxHours > 0) command.sessionMaxHours = sessionMaxHours
  if (sessionPreReminder >= 0 && /(提前|预提醒)/.test(source)) command.sessionPreReminder = sessionPreReminder
  if (textReminder) command.textReminder = textReminder

  return Object.keys(command).length ? command : null
}

function applyAiReminderSettingsCommand(currentSettings, command) {
  const base = aiReminders.normalizeAiReminderSettings(currentSettings && currentSettings.aiReminders)
  const next = JSON.parse(JSON.stringify(base))
  const patch = command || {}

  if (Object.prototype.hasOwnProperty.call(patch, 'profitTarget')) {
    next.rules.profitTarget.amount = patch.profitTarget
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'lossLimit')) {
    next.rules.lossLimit.amount = patch.lossLimit
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'trailingProfit')) {
    next.rules.trailingProfit.percent = patch.trailingProfit
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'postLossExtraRisk')) {
    next.rules.postLossExtraRisk.percent = patch.postLossExtraRisk
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'sessionMaxHours')) {
    next.rules.sessionMaxHours.hours = patch.sessionMaxHours
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'sessionPreReminder')) {
    next.rules.sessionPreReminder.hoursBefore = patch.sessionPreReminder
  }
  if (patch.textReminder) {
    next.textReminders = next.textReminders.concat({
      id: 'text_agent_' + Date.now(),
      title: patch.textReminder.title,
      content: patch.textReminder.content,
      enabled: true,
      subscribeMessage: false
    })
  }

  return aiReminders.normalizeAiReminderSettings(next)
}

function formatAiReminderSettingsReply(command) {
  const parts = []
  const patch = command || {}
  if (Object.prototype.hasOwnProperty.call(patch, 'profitTarget')) parts.push('止盈 HK$' + patch.profitTarget)
  if (Object.prototype.hasOwnProperty.call(patch, 'lossLimit')) parts.push('止损 HK$' + patch.lossLimit)
  if (Object.prototype.hasOwnProperty.call(patch, 'trailingProfit')) parts.push('移动止盈 ' + patch.trailingProfit + '%')
  if (Object.prototype.hasOwnProperty.call(patch, 'postLossExtraRisk')) parts.push('止损后追加风险 ' + patch.postLossExtraRisk + '%')
  if (Object.prototype.hasOwnProperty.call(patch, 'sessionMaxHours')) parts.push('Session 时长 ' + patch.sessionMaxHours + ' 小时')
  if (Object.prototype.hasOwnProperty.call(patch, 'sessionPreReminder')) parts.push('提前 ' + patch.sessionPreReminder + ' 小时预提醒')
  if (patch.textReminder) parts.push('纯文本提醒「' + patch.textReminder.title + '」')
  return '已保存 AI 自动提醒设置：' + parts.join('；') + '。默认会在 Session 进行中时间轴提醒；EV脑提醒需要在设置里额外开启，订阅消息仍按每条规则单独开启。'
}

function getLocalAgentReply(text) {
  const source = String(text || '').trim()
  if (!source) return ''
  if (/(你是(什么|谁)|什么模型|用.*模型|你用[得的]?什么模型|who are you|model)/i.test(source)) {
    return '我是 EV脑，小程序里的扑克助手，主要帮你查范围、复盘手牌、总结训练问题和做状态检查。底层请求会交给后端 EV脑 服务处理。'
  }
  if (/(设置|设定|改成|改为|保存|记录|配置).{0,12}(止盈|止损)|(止盈|止损).{0,12}(设置|设定|改成|改为|保存|记录|配置)/.test(source)) {
    return '你可以这样说：设置止盈10万、止损10万、移动止盈20%、Session时长8小时、提前2小时提醒。'
  }
  return ''
}

function findLastMessageIntent(messages) {
  const list = Array.isArray(messages) ? messages : []
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const intent = String(list[index] && list[index].intent || '').trim()
    if (intent && intent !== 'general_chat') return intent
  }
  return ''
}

function looksLikeShortFollowUp(text) {
  const source = String(text || '').trim()
  if (!source || source.length > 18) return false
  return /^(再|那|如果|换成|深筹|浅筹|有效|多少|几bb|几百bb|[0-9]+bb|[0-9]+BB|[0-9]+筹码|[0-9]+万|[0-9]+k|[0-9]+K|这个|那这个|呢|.*呢)[，。！？\s\w\u4e00-\u9fa5]*$/.test(source)
}

function inferChatIntent(text, activeIntent, messages) {
  const selectedIntent = String(activeIntent || '').trim()
  if (selectedIntent) return selectedIntent
  const source = String(text || '').trim()
  if (/最近\s*\d*\s*手|近\s*\d*\s*手|总结|训练计划|主要问题|leak|漏洞/.test(source)) return 'recent'
  if (/范围|range|(?:BTN|CO|HJ|UTG|BB|SB|MP|LJ).*(?:open|3bet|4bet|call|fold|raise|怎么打)|(?:open|3bet|4bet).*(?:BTN|CO|HJ|UTG|BB|SB|MP|LJ)|[AKQJT2-9][shdc]?[AKQJT2-9][shdc]?.*怎么打/i.test(source)) return 'range'
  if (/状态检查|止损止盈检查|是否适合继续|适合继续|还能不能继续|要不要休息|上头|tilt|心态/.test(source)) return 'stop'
  if (/马脚|tell|快闪题|读牌训练|观察训练/.test(source)) return 'tell'
  if (/复盘|牌谱|flop|turn|river|翻牌|转牌|河牌|底池|all.?in|下注|加注/.test(source)) return 'review'
  const lastIntent = findLastMessageIntent(messages)
  if (lastIntent && looksLikeShortFollowUp(source)) return lastIntent
  return ''
}

function sanitizeAgentErrorMessage(error) {
  const raw = String(error && (error.message || error.errMsg) || error || '').trim()
  if (!raw) return 'EV脑 暂时连接失败，请稍后再试。'
  return sanitizeAgentDisplayText(raw) || 'EV脑 暂时连接失败，请稍后再试。'
}

function summarizeHand(hand) {
  const board = hand && hand.board || {}
  const streetInputs = hand && hand.streetInputs || {}
  return {
    id: hand && (hand._id || hand.id) || '',
    date: hand && hand.playedDate || '',
    stakeLevel: hand && hand.stakeLevel || '',
    heroPosition: hand && hand.heroPosition || '',
    heroCardsInput: hand && hand.heroCardsInput || '',
    villainPosition: hand && hand.villainPosition || '',
    opponentType: hand && (hand.opponentType || hand.villainType) || '',
    effectiveStack: Number(hand && hand.effectiveStack) || 0,
    potSize: Number(hand && hand.potSize) || 0,
    currentProfit: Number(hand && hand.currentProfit) || 0,
    board: {
      flop: board.flop || '',
      turn: board.turn || '',
      river: board.river || ''
    },
    streets: {
      preflop: streetInputs.preflop && streetInputs.preflop.actionLine || '',
      flop: streetInputs.flop && streetInputs.flop.actionLine || '',
      turn: streetInputs.turn && streetInputs.turn.actionLine || '',
      river: streetInputs.river && streetInputs.river.actionLine || ''
    },
    tags: hand && hand.tags || []
  }
}

function extractAnswer(payload) {
  const source = payload || {}
  return sanitizeAgentDisplayText(
    source.answer ||
    source.message ||
    source.naturalLanguageSummary ||
    source.text ||
    ''
  )
}

Component({
  data: {
    visible: false,
    displayVisible: false,
    busy: false,
    inputText: '',
    activeIntent: '',
    lastIntent: '',
    messages: [],
    quickActions: QUICK_ACTIONS,
    scrollAnchor: ''
  },

  methods: {
    noop() {},

    openChat() {
      if (this._closeTimer) {
        clearTimeout(this._closeTimer)
        this._closeTimer = null
      }
      const messages = getCurrentMessages(this.data.messages)
      this.setData({
        displayVisible: true,
        visible: true,
        messages
      }, () => {
        this.scrollToBottom()
        this.consumePendingAiReminders({ forceVisible: true })
      })
    },

    closeChat() {
      if (reminderCards.hasBlockingReminder(this.data.messages)) {
        if (typeof wx !== 'undefined' && wx.showToast) {
          wx.showToast({
            title: '请先点击我已知晓',
            icon: 'none',
            duration: 1400
          })
        }
        return
      }
      this.setData({ visible: false })
      if (this._closeTimer) clearTimeout(this._closeTimer)
      this._closeTimer = setTimeout(() => {
        this._closeTimer = null
        if (!this.data.visible) {
          this.setData({ displayVisible: false })
        }
      }, 220)
    },

    acknowledgeReminderCard(e) {
      const id = String(e.currentTarget.dataset.id || '').trim()
      if (!id) return
      const messages = (this.data.messages || []).map(item => {
        if (!item || item.id !== id || !item.reminderCard) return item
        return Object.assign({}, item, {
          reminderCard: Object.assign({}, item.reminderCard, { acknowledged: true })
        })
      })
      this.setData({ messages }, () => {
        persistMessages(this.data.messages)
      })
    },

    onInput(e) {
      this.setData({ inputText: e.detail.value || '' })
    },

    useQuickAction(e) {
      const prompt = String(e.currentTarget.dataset.prompt || '').trim()
      const intent = String(e.currentTarget.dataset.intent || '').trim()
      if (!prompt || this.data.busy) return
      this.setData({ inputText: prompt, activeIntent: intent }, () => {
        this.sendMessage()
      })
    },

    previewMessageImage(e) {
      const url = String(e.currentTarget.dataset.url || '').trim()
      if (!url || typeof wx === 'undefined' || !wx.previewImage) return
      wx.previewImage({ current: url, urls: [url] })
    },

    onMessageImageError(e) {
      const id = String(e.currentTarget.dataset.id || '').trim()
      if (!id) return
      this.setData({
        messages: this.data.messages.map(item => item.id === id
          ? Object.assign({}, item, { imageError: true })
          : item)
      })
    },

    copyMessageText(e) {
      const text = String(e.currentTarget.dataset.text || '').trim()
      if (!text || typeof wx === 'undefined' || !wx.setClipboardData) return
      wx.setClipboardData({
        data: text,
        success() {
          if (wx.showToast) {
            wx.showToast({
              title: '已复制',
              icon: 'success',
              duration: 1200
            })
          }
        }
      })
    },

    scrollToBottom() {
      const messages = this.data.messages
      const last = messages[messages.length - 1]
      if (!last) return
      this.setData({ scrollAnchor: last.id })
    },

    async consumePendingAiReminders(options) {
      if (this._consumingAiReminders) return
      this._consumingAiReminders = true
      try {
        const reminders = await dataService.getPendingAiReminders()
        const pending = (Array.isArray(reminders) ? reminders : []).filter(reminder => reminder && reminder.channels && reminder.channels.evBrain)
        if (!pending.length) return
        const forceVisible = !!(options && options.forceVisible)
        if (!forceVisible && !this.data.visible && !shouldOpenAgentOnAiReminder()) return
        const reminderMessages = pending.map(reminder => createReminderMessage(reminder))
        const messages = getCurrentMessages(this.data.messages).concat(reminderMessages).slice(-MAX_RENDERED_MESSAGES)
        this.setData({
          displayVisible: true,
          visible: true,
          messages
        }, () => {
          persistMessages(this.data.messages)
          this.scrollToBottom()
        })
        pending.forEach(reminder => {
          dataService.markAiReminderShown(reminder._id).catch(error => {
            console.warn('mark ai reminder shown failed: ' + (error && (error.message || error.errMsg) || error))
          })
        })
      } catch (error) {
        console.warn('consume ai reminders failed: ' + (error && (error.message || error.errMsg) || error))
      } finally {
        this._consumingAiReminders = false
      }
    },

    async buildChatContext() {
      let recentHands = []
      let stats = {}
      let profile = {}
      let settings = {}
      try {
        recentHands = await dataService.getRecentHands(50)
      } catch (error) {
        console.warn('agent chat recent hands failed: ' + (error && (error.message || error.errMsg) || error))
      }
      try {
        const statsData = await dataService.getStatsData()
        stats = statsData.stats || {}
      } catch (error) {
        console.warn('agent chat stats failed: ' + (error && (error.message || error.errMsg) || error))
      }
      try {
        profile = dataService.getCurrentProfile ? dataService.getCurrentProfile() : {}
        settings = dataService.getAppSettings ? dataService.getAppSettings() : {}
      } catch (error) {
        console.warn('agent chat profile failed: ' + (error && (error.message || error.errMsg) || error))
      }

      return {
        profile: {
          playerId: profile.playerId || '',
          name: profile.name || ''
        },
        stats,
        settings: {
          chipUnit: settings.chipUnit || '',
          blindPresets: settings.blindPresets || [],
          positions: settings.positions || [],
          opponentTypes: settings.opponentTypes || []
        },
        recentHands: (recentHands || []).slice(0, 50).map(summarizeHand)
      }
    },

    async applyAiReminderSettingsCommand(command) {
      const currentSettings = dataService.getAppSettings ? dataService.getAppSettings() : {}
      const nextAiReminders = applyAiReminderSettingsCommand(currentSettings, command)
      await dataService.updateSettings({ aiReminders: nextAiReminders })
      return formatAiReminderSettingsReply(command)
    },

    async sendMessage() {
      const text = String(this.data.inputText || '').trim()
      if (!text || this.data.busy) return

      const previousMessages = this.data.messages
      const userMessage = createMessage('user', text)
      const nextMessages = previousMessages.concat(userMessage)
      const nextIntent = inferChatIntent(text, this.data.activeIntent, previousMessages)
      const aiReminderSettingsCommand = parseAiReminderSettingsCommand(text)
      const localReply = aiReminderSettingsCommand ? '' : getLocalAgentReply(text)
      this.setData({
        messages: nextMessages,
        inputText: '',
        activeIntent: '',
        lastIntent: aiReminderSettingsCommand ? 'ai_reminder_settings' : (nextIntent || this.data.lastIntent || ''),
        busy: !!aiReminderSettingsCommand || !localReply
      }, () => {
        persistMessages(this.data.messages)
        this.scrollToBottom()
      })

      if (aiReminderSettingsCommand) {
        try {
          const reply = await this.applyAiReminderSettingsCommand(aiReminderSettingsCommand)
          this.setData({
            messages: this.data.messages.concat(createMessage('assistant', reply, { intent: 'ai_reminder_settings' })),
            lastIntent: 'ai_reminder_settings',
            busy: false
          }, () => {
            persistMessages(this.data.messages)
            this.scrollToBottom()
          })
        } catch (error) {
          const message = sanitizeAgentErrorMessage(error)
          this.setData({
            messages: this.data.messages.concat(createMessage('assistant', 'AI 自动提醒设置保存失败：' + message, { intent: 'ai_reminder_settings' })),
            lastIntent: 'ai_reminder_settings',
            busy: false
          }, () => {
            persistMessages(this.data.messages)
            this.scrollToBottom()
          })
        }
        return
      }

      if (localReply) {
        this.setData({
          messages: this.data.messages.concat(createMessage('assistant', localReply, { intent: 'general_chat' })),
          lastIntent: 'general_chat',
          busy: false
        }, () => {
          persistMessages(this.data.messages)
          this.scrollToBottom()
        })
        return
      }

      try {
        const context = Object.assign(await this.buildChatContext(), {
          chatHistory: buildChatHistory(previousMessages),
          rangeMatrix: buildRangeFollowUpContext(previousMessages)
        })
        const result = await aiService.chatWithPokerAgent({
          mode: 'chat',
          intent: nextIntent,
          chatIntent: nextIntent,
          message: text,
          text,
          userId: context.profile.playerId || '',
          playerId: context.profile.playerId || '',
          context,
          recentHands: context.recentHands,
          stats: context.stats,
          profile: context.profile
        })
        const answer = extractAnswer(result) || '我收到了，但这次没有生成有效回复。你可以换一种说法再问一次。'
        const imageUrl = extractPayloadImageUrl(result)
        this.setData({
          messages: this.data.messages.concat(createMessage('assistant', answer, { imageUrl, intent: nextIntent })),
          lastIntent: nextIntent || 'general_chat',
          busy: false
        }, () => {
          persistMessages(this.data.messages)
          this.scrollToBottom()
        })
      } catch (error) {
        const message = sanitizeAgentErrorMessage(error)
        this.setData({
          messages: this.data.messages.concat(createMessage('assistant', `连接 EV脑 失败：${message}`, { intent: 'general_chat' })),
          lastIntent: 'general_chat',
          busy: false
        }, () => {
          persistMessages(this.data.messages)
          this.scrollToBottom()
        })
      }
    }
  },

  lifetimes: {
    attached() {
      this.setData({ messages: [] })
      this.consumePendingAiReminders()
    },

    detached() {
      if (this._closeTimer) {
        clearTimeout(this._closeTimer)
        this._closeTimer = null
      }
    }
  },

  pageLifetimes: {
    show() {
      this.consumePendingAiReminders()
    }
  }
})
