const dataService = require('../../services/data-service')
const aiService = require('../../services/ai-service')
const display = require('../../utils/display')
const tabBar = require('../../utils/tab-bar')

const SWIPE_OPEN_DISTANCE = 72
const SWIPE_CLOSE_DISTANCE = 48

function getDisplaySessionProfit(session) {
  if (!session || session.status !== 'finished') return 0
  return Number(session.totalProfit) || 0
}

function asList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(item => String(item).trim()).filter(Boolean)
  if (!value) return []
  return [String(value).trim()].filter(Boolean)
}

function getReviewSource(hand) {
  const review = hand && hand.aiReview || {}
  return review.analysis || review.review || review
}

function buildSessionSummaryRequest(session, hands, settings) {
  const reviewedHands = (hands || []).filter(hand => hand && hand.aiReview)
  return {
    mode: 'session_summary',
    message: `${session.title || session.date || 'Session'} 总结`,
    text: `${session.title || session.date || 'Session'} 总结`,
    session,
    hands: reviewedHands.map((hand, index) => ({
      id: hand._id || hand.id || '',
      index: index + 1,
      playedDate: hand.playedDate || '',
      stakeLevel: hand.stakeLevel || '',
      heroPosition: hand.heroPosition || '',
      heroCardsInput: hand.heroCardsInput || '',
      villainPosition: hand.villainPosition || '',
      opponentType: hand.opponentType || hand.villainType || '',
      effectiveStack: Number(hand.effectiveStack) || 0,
      potSize: Number(hand.potSize) || 0,
      currentProfit: Number(hand.currentProfit) || 0,
      board: hand.board || {},
      streetSummary: hand.streetSummary || '',
      tags: hand.tags || [],
      aiReview: hand.aiReview
    })),
    settings: settings || {}
  }
}

function reviewText(hand) {
  const review = getReviewSource(hand)
  return [
    review.answer,
    review.summary,
    review.verdict,
    review.keyTakeaway,
    review.key_takeaway,
    review.humanRule,
    review.human_rule,
    asList(review.goodPoints || review.good_points).join(' '),
    asList(review.issues).join(' '),
    asList(review.clearMistakes || review.clear_mistakes).join(' '),
    asList(review.optimizations).join(' '),
    asList(review.exploitAdjustments || review.exploit_adjustments).join(' '),
    asList(review.trainingPlan || review.training_plan).join(' '),
    asList(review.leakTags || review.leak_tags).join(' ')
  ].filter(Boolean).join(' ')
}

function handLabel(hand, index, settings) {
  const profit = display.formatAmount(Number(hand && hand.currentProfit) || 0, settings && settings.chipUnit || '')
  const cards = hand && hand.heroCardsInput || `Hand ${index + 1}`
  const position = hand && hand.heroPosition ? `${hand.heroPosition} ` : ''
  return `${position}${cards}（${profit}）`
}

function firstUsefulText() {
  const values = Array.prototype.slice.call(arguments)
  for (let index = 0; index < values.length; index += 1) {
    const list = asList(values[index])
    if (list.length) return list[0]
  }
  return ''
}

function formatHandSummaryLine(hand, index, settings, fallback) {
  const review = getReviewSource(hand)
  const text = firstUsefulText(
    review.keyTakeaway,
    review.key_takeaway,
    review.humanRule,
    review.human_rule,
    review.verdict,
    review.summary,
    review.answer
  )
  return `${handLabel(hand, index, settings)}：${text || fallback || '已有 AI 建议，可作为 session 总结样本'}`
}

function buildLocalSessionSummary(session, hands, settings) {
  const reviewedHands = (hands || []).filter(hand => hand && hand.aiReview)
  const goodHands = []
  const mistakeHands = []
  const optimizationHands = []
  const handSummaries = []
  const trainingPlan = []
  const tendencySignals = []

  reviewedHands.forEach((hand, index) => {
    const review = getReviewSource(hand)
    const text = reviewText(hand)
    const good = asList(review.goodPoints || review.good_points)
    const clearMistakes = asList(review.clearMistakes || review.clear_mistakes)
    const issues = asList(review.issues)
    const optimizations = asList(review.optimizations || review.exploitAdjustments || review.exploit_adjustments)
    const training = asList(review.trainingPlan || review.training_plan)
    const tags = asList(hand.tags || review.leakTags || review.leak_tags)
    handSummaries.push(formatHandSummaryLine(hand, index, settings, '复查本手的关键决策点和 AI 建议'))

    if (good.length || /精彩|正确|标准|价值|good|nice|read|读对/i.test(text) || tags.indexOf('精彩') > -1) {
      goodHands.push(`${handLabel(hand, index, settings)}：${good[0] || firstUsefulText(review.keyTakeaway, review.verdict, review.summary) || '决策质量较好'}`)
    }
    if (clearMistakes.length || /明显错误|错误|mistake|overplay|上头|tilt|bad fold/i.test(text) || tags.indexOf('明显错误') > -1) {
      mistakeHands.push(`${handLabel(hand, index, settings)}：${clearMistakes[0] || issues[0] || firstUsefulText(review.verdict, review.keyTakeaway) || '存在明显问题'}`)
    }
    if (optimizations.length || issues.length || /优化|调整|size|尺度|check|控池|thin|可优化/i.test(text) || tags.indexOf('可优化') > -1) {
      optimizationHands.push(`${handLabel(hand, index, settings)}：${optimizations[0] || issues[0] || '有进一步优化空间'}`)
    }
    training.forEach(item => trainingPlan.push(item))

    if (/overplay|打太大|过度|薄价值|满pot|满 pot/i.test(text)) tendencySignals.push('存在 overplay 或下注尺度偏大的倾向')
    if (/tilt|上头|情绪|疲劳|深夜|时长/i.test(text)) tendencySignals.push('需要警惕 on tilt、疲劳和 session 时长')
    if (/级别|straddle|盲注|升降级/i.test(text)) tendencySignals.push('级别管理和 straddle 局策略需要单独收紧')
  })

  if (!goodHands.length && reviewedHands.length) {
    goodHands.push(formatHandSummaryLine(reviewedHands[0], 0, settings, '本手已有 AI 建议，可作为正向或基准样本复查'))
  }
  if (!optimizationHands.length && reviewedHands.length) {
    reviewedHands.slice(0, 3).forEach((hand, index) => {
      optimizationHands.push(formatHandSummaryLine(hand, index, settings, '复查本手的关键街道、下注尺度和对手范围'))
    })
  }

  const totalProfit = Number(session && session.totalProfit) || 0
  if (totalProfit > 0 && goodHands.length >= mistakeHands.length) tendencySignals.push('结果为正，先确认盈利来自好决策而不是单纯跑赢')
  if (totalProfit < 0 && mistakeHands.length <= goodHands.length) tendencySignals.push('结果偏差不完全等于决策差，需区分运气和执行质量')

  const uniqueTrainingPlan = Array.from(new Set(trainingPlan)).slice(0, 6)
  const defaultTraining = [
    '复盘所有 turn 继续下注的中等牌力，标记哪些是 value、哪些只是惯性下注。',
    '记录每个 session 的级别和 straddle 状态，避免不同盲注混在同一个心理锚点里。',
    '河牌下注前先写下目标跟注范围，再决定 1/2、2/3 或满 pot 尺度。'
  ]

  return {
    title: `${session && (session.title || session.date) || 'Session'} 总结`,
    overview: `总览：${reviewedHands.length}手已完成 AI 建议，${display.formatAmount(totalProfit, settings && settings.chipUnit || '')}`,
    answer: '',
    counts: {
      good: goodHands.length,
      mistakes: mistakeHands.length,
      optimizations: optimizationHands.length
    },
    goodHands,
    mistakeHands,
    optimizationHands,
    handSummaries,
    tendency: Array.from(new Set(tendencySignals)).join('；') || '本场倾向需要结合更多手牌继续观察。',
    recommendations: [
      '优先复盘最大盈利手和最大亏损手，确认结果是否来自正确决策。',
      '把每手 AI 建议里的重复问题合并成一个 session 级别规则。'
    ],
    trainingPlan: uniqueTrainingPlan.length ? uniqueTrainingPlan : defaultTraining,
    oneLiner: goodHands.length >= mistakeHands.length
      ? '一句话总结：本场有可取的决策质量，但仍需要把重复漏洞收紧。'
      : '一句话总结：本场主要价值在于暴露问题，下一场先执行训练计划再放大级别。'
  }
}

function hasSessionSummaryContent(view) {
  if (!view) return false
  return !!(
    view.tendency ||
    view.oneLiner ||
    asList(view.goodHands).length ||
    asList(view.mistakeHands).length ||
    asList(view.optimizationHands).length ||
    asList(view.handSummaries).length ||
    asList(view.recommendations).length ||
    asList(view.trainingPlan).length
  )
}

function isEmptyRemoteSummaryAnswer(text) {
  const source = String(text || '').trim()
  if (!source) return true
  return /没有历史复盘|还没有历史复盘|先保存几手牌|暂无历史|没有足够|信息不足|无法生成|no history|not enough/i.test(source)
}

function isRemoteSessionSummaryUseful(view) {
  if (!view) return false
  const counts = view.counts || {}
  const countTotal = (Number(counts.good) || 0) + (Number(counts.mistakes) || 0) + (Number(counts.optimizations) || 0)
  if (countTotal > 0) return true
  if (asList(view.goodHands).length || asList(view.mistakeHands).length || asList(view.optimizationHands).length) return true
  if (asList(view.handSummaries).length) return true
  if (asList(view.trainingPlan).length || asList(view.recommendations).length) return true
  if (view.tendency || view.oneLiner) return true
  return !!(view.answer && !isEmptyRemoteSummaryAnswer(view.answer))
}

function formatSessionSummaryView(result, session, hands, settings, localFallback) {
  const summary = result && (result.summary || result.analysis || result) || {}
  const counts = summary.counts || {}
  const totalProfit = Number(session && session.totalProfit) || 0
  const chipUnit = settings && settings.chipUnit || ''
  const view = {
    title: `${session && (session.title || session.date) || 'Session'} 总结`,
    overview: summary.overview || `总览：${(hands || []).length}手，${display.formatAmount(totalProfit, chipUnit)}`,
    answer: summary.answer || result && result.answer || '',
    counts: {
      good: Number(counts.good) || asList(summary.goodHands || summary.good_hands).length,
      mistakes: Number(counts.mistakes) || asList(summary.mistakeHands || summary.mistake_hands).length,
      optimizations: Number(counts.optimizations) || asList(summary.optimizationHands || summary.optimization_hands).length
    },
    goodHands: asList(summary.goodHands || summary.good_hands),
    mistakeHands: asList(summary.mistakeHands || summary.mistake_hands),
    optimizationHands: asList(summary.optimizationHands || summary.optimization_hands),
    handSummaries: asList(summary.handSummaries || summary.hand_summaries),
    tendency: summary.tendency || '',
    recommendations: asList(summary.recommendations),
    trainingPlan: asList(summary.trainingPlan || summary.training_plan),
    oneLiner: summary.oneLiner || summary.one_liner || ''
  }

  if (isRemoteSessionSummaryUseful(view)) return view
  return localFallback || buildLocalSessionSummary(session, hands, settings)
}

Page({
  data: {
    sessions: [],
    loading: false,
    agentChatReady: false,
    sessionSummaryVisible: false,
    sessionSummaryLoading: false,
    sessionSummaryError: '',
    sessionSummaryView: null,
    swipedSessionId: '',
    touchStartX: 0,
    touchStartY: 0,
    touchActiveSessionId: '',
    touchMoved: false
  },

  async onShow() {
    tabBar.syncCustomTabBar('/pages/session-list/session-list')
    await this.refreshSessions()
  },

  async refreshSessions() {
    this.setData({ loading: true })
    try {
      const data = await dataService.getSessionListData()
      const settings = dataService.getAppSettings()
      const sessions = (data.sessions || [])
        .map((item, index) => Object.assign({}, item, {
          totalProfitDisplay: display.formatAmount(getDisplaySessionProfit(item), settings.chipUnit),
          swiped: item._id === this.data.swipedSessionId,
          __sortIndex: index
        }))
        .sort((a, b) => {
          const aActive = a.status === 'active' ? 1 : 0
          const bActive = b.status === 'active' ? 1 : 0
          if (aActive !== bActive) return bActive - aActive
          return a.__sortIndex - b.__sortIndex
        })
        .map(item => {
          const next = Object.assign({}, item)
          delete next.__sortIndex
          return next
        })
      this.setData({ sessions, loading: false })
    } catch (error) {
      console.warn('load session list failed: ' + (error && (error.stack || error.message || error.errMsg) || error))
      this.setData({ sessions: [], loading: false })
      wx.showToast({ title: '本地数据加载失败，已进入空列表', icon: 'none' })
    }
  },

  onReady() {
    setTimeout(() => {
      if (!this.data.agentChatReady) {
        this.setData({ agentChatReady: true })
      }
    }, 240)
  },

  goNewSession() {
    wx.navigateTo({ url: '/pages/session-detail/session-detail?mode=create' })
  },

  goSessionDetail(e) {
    const sessionId = e.currentTarget.dataset.id
    if (!sessionId) return
    if (this.data.touchMoved) {
      this.setData({ touchMoved: false })
      return
    }
    if (this.data.swipedSessionId && this.data.swipedSessionId !== sessionId) {
      this.closeSwipedSessionItem()
      return
    }
    wx.navigateTo({ url: '/pages/session-detail/session-detail?id=' + sessionId })
  },

  updateSessionSwipeState(sessionId) {
    const sessions = (this.data.sessions || []).map(item => Object.assign({}, item, {
      swiped: item._id === sessionId
    }))
    this.setData({
      sessions,
      swipedSessionId: sessionId || ''
    })
  },

  closeSwipedSessionItem() {
    this.updateSessionSwipeState('')
  },

  onSessionItemTouchStart(e) {
    const touch = e.touches && e.touches[0]
    if (!touch) return
    this.setData({
      touchStartX: touch.clientX,
      touchStartY: touch.clientY,
      touchActiveSessionId: e.currentTarget.dataset.id || '',
      touchMoved: false
    })
  },

  onSessionItemTouchMove(e) {
    const touch = e.touches && e.touches[0]
    if (!touch) return
    const deltaX = touch.clientX - this.data.touchStartX
    const deltaY = touch.clientY - this.data.touchStartY
    if (Math.abs(deltaX) < Math.abs(deltaY) || Math.abs(deltaX) < 12) return
    this.setData({ touchMoved: true })
  },

  onSessionItemTouchEnd(e) {
    const touch = e.changedTouches && e.changedTouches[0]
    const sessionId = e.currentTarget.dataset.id || this.data.touchActiveSessionId
    if (!touch || !sessionId) return
    const deltaX = touch.clientX - this.data.touchStartX
    const deltaY = touch.clientY - this.data.touchStartY
    if (Math.abs(deltaX) > Math.abs(deltaY) && deltaX < -SWIPE_OPEN_DISTANCE) {
      this.updateSessionSwipeState(sessionId)
      this.setData({ touchMoved: true })
      return
    }
    if (Math.abs(deltaX) > Math.abs(deltaY) && deltaX > SWIPE_CLOSE_DISTANCE) {
      this.closeSwipedSessionItem()
      this.setData({ touchMoved: true })
      return
    }
    if (this.data.touchMoved) {
      setTimeout(() => this.setData({ touchMoved: false }), 80)
    }
  },

  editSessionFromList(e) {
    const sessionId = e.currentTarget.dataset.id
    if (!sessionId) return
    this.closeSwipedSessionItem()
    wx.navigateTo({ url: '/pages/session-detail/session-detail?id=' + sessionId })
  },

  deleteSessionFromList(e) {
    const sessionId = e.currentTarget.dataset.id
    if (!sessionId) return
    wx.showModal({
      title: '删除 Session',
      content: '删除后，该 Session、该场全部手牌、行动记录及结算记录都会永久删除且无法恢复。是否继续？',
      confirmText: '删除',
      confirmColor: '#dc2626',
      success: async res => {
        if (!res.confirm) return
        try {
          await dataService.deleteSession(sessionId)
          this.closeSwipedSessionItem()
          await this.refreshSessions()
          wx.showToast({ title: '已删除', icon: 'success' })
        } catch (error) {
          console.warn('delete session failed: ' + (error && (error.stack || error.message || error.errMsg) || error))
          wx.showToast({ title: '删除失败，请稍后重试', icon: 'none' })
        }
      }
    })
  },

  closeSessionSummary() {
    this.setData({
      sessionSummaryVisible: false,
      sessionSummaryLoading: false,
      sessionSummaryError: '',
      sessionSummaryView: null
    })
  },

  async openSessionSummary(e) {
    const sessionId = e.currentTarget.dataset.id
    const session = this.data.sessions.find(item => item._id === sessionId)
    if (!session || !session.summaryEligible) return
    const settings = dataService.getAppSettings()
    this.setData({
      sessionSummaryVisible: true,
      sessionSummaryLoading: true,
      sessionSummaryError: '',
      sessionSummaryView: {
        title: `${session.title || session.date || 'Session'} 总结`,
        overview: 'EV脑 正在汇总本场所有已复盘手牌...',
        counts: { good: 0, mistakes: 0, optimizations: 0 },
        goodHands: [],
        mistakeHands: [],
        optimizationHands: [],
        handSummaries: [],
        tendency: '',
        recommendations: [],
        trainingPlan: [],
        oneLiner: ''
      }
    })

    try {
      const detail = await dataService.getSessionDetailData(sessionId)
      const hands = detail.hands || []
      const baseSession = detail.session || session
      const localSummary = buildLocalSessionSummary(baseSession, hands, settings)
      this.setData({ sessionSummaryView: localSummary })

      const result = await Promise.race([
        aiService.summarizeSession(buildSessionSummaryRequest(baseSession, hands, settings)),
        new Promise(resolve => setTimeout(() => resolve({ code: 'SESSION_SUMMARY_TIMEOUT', summary: localSummary }), 12000))
      ])
      if (result.code === 'SESSION_SUMMARY_TIMEOUT') {
        this.setData({ sessionSummaryLoading: false })
        return
      }
      if (result.code && result.code !== 0) {
        throw new Error(result.message || 'Session summary failed')
      }
      this.setData({
        sessionSummaryLoading: false,
        sessionSummaryView: formatSessionSummaryView(result, baseSession, hands, settings, localSummary)
      })
    } catch (error) {
      this.setData({
        sessionSummaryLoading: false,
        sessionSummaryError: error && (error.message || error.errMsg) || 'EV脑 暂时无法生成 Session 总结'
      })
    }
  }
})
