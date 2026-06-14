const aiService = require('../../services/ai-service')
const dataService = require('../../services/data-service')

const CHAT_STORAGE_KEY = 'poker-agent-chat-history-v1'
const MAX_STORED_MESSAGES = 80
const MAX_RENDERED_MESSAGES = 30
const MAX_MESSAGE_TEXT_LENGTH = 1800
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

function createMessage(role, text, extra = {}) {
  const id = `${role}-${Date.now()}-${Math.floor(Math.random() * 10000)}`
  const cleanText = String(text || '').trim()
  const imageUrl = normalizeImageUrl(extra.imageUrl) || extractMessageImageUrl(cleanText)
  const displayText = imageUrl ? stripMessageImageUrl(cleanText) : cleanText
  return {
    id,
    role,
    text: displayText || (imageUrl ? '范围图如下：' : cleanText),
    imageUrl,
    intent: String(extra.intent || '').trim()
  }
}

function createInitialMessages() {
  return [
    createMessage(
      'assistant',
      '我是 Poker Agent。你可以直接用自然语言问牌谱、查范围、复盘最近手牌，或者让我帮你做状态检查。'
    )
  ]
}

function normalizeStoredMessages(messages) {
  if (!Array.isArray(messages)) return []
  return messages
    .slice(-MAX_STORED_MESSAGES)
    .map(item => {
      const role = item && item.role === 'user' ? 'user' : 'assistant'
      const rawText = String(item && item.text || '').trim()
      const text = rawText.length > MAX_MESSAGE_TEXT_LENGTH
        ? rawText.slice(0, MAX_MESSAGE_TEXT_LENGTH) + '...'
        : rawText
      return {
        id: String(item && item.id || createMessage(role, text).id),
        role,
        text,
        imageUrl: normalizeImageUrl(item && item.imageUrl) || extractMessageImageUrl(text),
        intent: String(item && item.intent || '').trim()
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

function getLocalAgentReply(text) {
  const source = String(text || '').trim()
  if (!source) return ''
  if (/(你是(什么|谁)|什么模型|用.*模型|你用[得的]?什么模型|who are you|model)/i.test(source)) {
    return '我是 Poker Agent，小程序里的扑克助手，主要帮你查范围、复盘手牌、总结训练问题和做状态检查。底层请求会交给后端 Poker Agent 服务处理。'
  }
  if (/(设置|设定|改成|改为|保存|记录|配置).{0,12}(止盈|止损)|(止盈|止损).{0,12}(设置|设定|改成|改为|保存|记录|配置)/.test(source)) {
    return '小程序目前还没有全局止盈止损线自动写入功能，所以我不能直接替你保存这个设置。你可以把本场买入、当前筹码、止盈线和止损线告诉我，我可以按这条线帮你判断继续、降级还是收工。'
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
  if (!raw) return 'Poker Agent 暂时连接失败，请稍后再试。'
  if (raw.includes('503') || raw.includes('Service Temporarily Unavailable')) {
    return 'Poker Agent 暂时不可用（503），请稍后再试。'
  }
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160) || 'Poker Agent 暂时连接失败，请稍后再试。'
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
  return String(
    source.answer ||
    source.message ||
    source.naturalLanguageSummary ||
    source.text ||
    ''
  ).trim()
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
      }, () => this.scrollToBottom())
    },

    closeChat() {
      this.setData({ visible: false })
      if (this._closeTimer) clearTimeout(this._closeTimer)
      this._closeTimer = setTimeout(() => {
        this._closeTimer = null
        if (!this.data.visible) {
          this.setData({ displayVisible: false })
        }
      }, 220)
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

    scrollToBottom() {
      const messages = this.data.messages
      const last = messages[messages.length - 1]
      if (!last) return
      this.setData({ scrollAnchor: last.id })
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

    async sendMessage() {
      const text = String(this.data.inputText || '').trim()
      if (!text || this.data.busy) return

      const userMessage = createMessage('user', text)
      const nextMessages = this.data.messages.concat(userMessage)
      const nextIntent = inferChatIntent(text, this.data.activeIntent, this.data.messages)
      const localReply = getLocalAgentReply(text)
      this.setData({
        messages: nextMessages,
        inputText: '',
        activeIntent: '',
        lastIntent: nextIntent || this.data.lastIntent || '',
        busy: !localReply
      }, () => {
        persistMessages(this.data.messages)
        this.scrollToBottom()
      })

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
        const context = await this.buildChatContext()
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
          messages: this.data.messages.concat(createMessage('assistant', `连接 Poker Agent 失败：${message}`, { intent: 'general_chat' })),
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
    },

    detached() {
      if (this._closeTimer) {
        clearTimeout(this._closeTimer)
        this._closeTimer = null
      }
    }
  }
})
