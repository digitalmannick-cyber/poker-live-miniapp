const DISMISSED_KEY = 'pokerLiveOnboardingGuideDismissed'
const STEP_KEY = 'pokerLiveOnboardingGuideStep'
const MANUAL_KEY = 'pokerLiveOnboardingGuideManual'

const guideContext = {
  accountId: '',
  hasRealData: false
}

const RAW_STEPS = [
  {
    key: 'session',
    index: 0,
    route: 'pages/session-list/session-list',
    url: '/pages/session-list/session-list',
    navType: 'switchTab',
    title: '从澳门 300/600 开始',
    copy: '先从场次页新建一场牌局。新版本里，新建 Session 在场次页弹层完成。',
    example: '澳门 300/600 试用场 · 1 手牌 · QdQs',
    targetClass: 'onboarding-target-session'
  },
  {
    key: 'sessionBuyIn',
    index: 1,
    route: 'pages/session-list/session-list',
    url: '/pages/session-list/session-list',
    navType: 'switchTab',
    title: '买入填 300000',
    copy: '先填本场初始买入，收局时再补带出金额做结算。',
    example: '买入：300000',
    targetClass: 'onboarding-target-session-buyin'
  },
  {
    key: 'sessionBlind',
    index: 2,
    route: 'pages/session-list/session-list',
    url: '/pages/session-list/session-list',
    navType: 'switchTab',
    title: '级别选 300/600',
    copy: '级别会影响 BB 换算、盈亏统计和后面的手牌复盘。',
    example: '小盲 300 · 大盲 600',
    targetClass: 'onboarding-target-session-blind'
  },
  {
    key: 'sessionVenue',
    index: 3,
    route: 'pages/session-list/session-list',
    url: '/pages/session-list/session-list',
    navType: 'switchTab',
    title: '场地选澳门',
    copy: '场地用于后续按赌场、级别复盘自己的胜率和表现。',
    example: '场地：澳门',
    targetClass: 'onboarding-target-session-venue'
  },
  {
    key: 'sessionStart',
    index: 4,
    route: 'pages/session-list/session-list',
    url: '/pages/session-list/session-list',
    navType: 'switchTab',
    title: '点击开始',
    copy: '开始后会进入进行中 Session 首页，买入、备注、速记和完整录入都从这里进入。',
    example: '澳门 300/600 · 买入 300000 · 8 人桌',
    targetClass: 'onboarding-target-session-start'
  },
  {
    key: 'recordSession',
    index: 5,
    route: 'pages/session-list/session-list',
    url: '/pages/session-list/session-list',
    navType: 'switchTab',
    title: '进入速记手牌',
    copy: '新版本的快速记牌入口在进行中 Session 里。点击“速记”即可快速记录一手牌。',
    example: '当前 Session：澳门 300/600',
    targetClass: 'onboarding-target-record-session'
  },
  {
    key: 'recordFullEntry',
    route: 'pages/session-list/session-list',
    url: '/pages/session-list/session-list',
    navType: 'switchTab',
    title: '也可以完整录入',
    copy: '如果你想一边打牌一边精确记录行动线，点“完整”进入桌面 replay 录入。它会按座位、下注、底池和公共牌逐步生成可回放手牌。',
    example: '完整录入 · 按牌桌逐街记录 · 自动生成 replay',
    targetClass: 'onboarding-target-session-full'
  },
  {
    key: 'recordHand',
    index: 6,
    route: 'pages/session-list/session-list',
    url: '/pages/session-list/session-list',
    navType: 'switchTab',
    title: '选择 QdQs',
    copy: '点击手牌区域会弹出手牌选择器；这里用 QdQs 演示。',
    example: 'Hero 手牌：QdQs',
    targetClass: 'onboarding-target-record-hand'
  },
  {
    key: 'recordProfit',
    index: 7,
    route: 'pages/session-list/session-list',
    url: '/pages/session-list/session-list',
    navType: 'switchTab',
    title: '录入输赢 -42000',
    copy: '快速记牌只需要先填手牌和本手输赢，复杂行动线可以稍后在复盘里补。',
    example: 'QdQs · 本手亏损 -42000',
    targetClass: 'onboarding-target-record-profit'
  },
  {
    key: 'recordSave',
    index: 8,
    route: 'pages/session-list/session-list',
    url: '/pages/session-list/session-list',
    navType: 'switchTab',
    title: '保存速记',
    copy: '保存后，这手牌会进入 HANDS/手牌页，继续补充语音复盘和 AI 建议。',
    example: 'QdQs · 快速录入样例',
    targetClass: 'onboarding-target-record-save'
  },
  {
    key: 'reviewEntry',
    index: 9,
    route: 'pages/review-list/review-list',
    url: '/pages/review-list/review-list',
    navType: 'switchTab',
    title: '打开 QdQs 待复盘',
    copy: 'HANDS/手牌页承接速记后的手牌。点击 QdQs 进入详情补全行动线。',
    example: 'QdQs · 本手亏损 -42000',
    targetClass: 'onboarding-target-review-entry'
  },
  {
    key: 'reviewLedgerEntry',
    route: 'pages/review-list/review-list',
    url: '/pages/review-list/review-list',
    navType: 'switchTab',
    title: '详情里也能完整录入',
    copy: '打开手牌详情后，除了语音复盘，也可以选择“完整录入复盘”。适合补一手需要精确行动线、底池和 All-in EV 的牌。',
    example: 'QdQs · 完整录入复盘 · 桌面 replay',
    targetClass: 'onboarding-target-review-ledger'
  },
  {
    key: 'reviewVoice',
    index: 10,
    route: 'pages/review-list/review-list',
    url: '/pages/review-list/review-list',
    navType: 'switchTab',
    title: '语音输入复盘',
    copy: '用手机 AI 语音输入法口述行动线，再让系统解析字段。',
    example: 'CO QdQs · 翻牌 Qd7d3c · 河牌 call 输 -42000',
    targetClass: 'onboarding-target-review-voice'
  },
  {
    key: 'reviewParse',
    index: 11,
    route: 'pages/review-list/review-list',
    url: '/pages/review-list/review-list',
    navType: 'switchTab',
    title: '解析字段',
    copy: '解析后检查位置、牌面、底池、摊牌和输赢是否正确，不正确可手动改。',
    example: 'CO / QdQs / Qd7d3c-8d-2s / AdJd / -42000',
    targetClass: 'onboarding-target-review-parse'
  },
  {
    key: 'reviewApply',
    index: 12,
    route: 'pages/review-list/review-list',
    url: '/pages/review-list/review-list',
    navType: 'switchTab',
    title: '确认回填',
    copy: '字段确认后再回填，AI 建议会基于这些结构化信息生成。',
    example: '确认回填后：QdQs 进入 AI 建议生成/查看状态',
    targetClass: 'onboarding-target-review-apply'
  },
  {
    key: 'reviewAdvice',
    index: 13,
    route: 'pages/review-list/review-list',
    url: '/pages/review-list/review-list',
    navType: 'switchTab',
    title: '查看 AI 建议',
    copy: '点 QdQs 行上的 AI 建议，可以弹出这手牌的复盘建议。',
    example: 'QdQs · AI 建议',
    targetClass: 'onboarding-target-review-ai-advice'
  },
  {
    key: 'reviewAdviceSheet',
    index: 14,
    route: 'pages/review-list/review-list',
    url: '/pages/review-list/review-list',
    navType: 'switchTab',
    title: 'AI 建议弹层',
    copy: '这里能看到本手牌的结论、问题点和训练建议。',
    example: 'QdQs · 河牌大注跟注复盘',
    targetClass: 'onboarding-target-review-ai-sheet'
  },
  {
    key: 'reviewReplay',
    route: 'pages/review-list/review-list',
    url: '/pages/review-list/review-list',
    navType: 'switchTab',
    title: '播放 replay 回放',
    copy: '完整录入或有结构化行动线的手牌，会在列表显示 replay 按钮。点开后可以按步骤回放下注、底池和公共牌变化。',
    example: 'QdQs · HAND REPLAY · 逐步回放行动线',
    targetClass: 'onboarding-target-review-replay-sheet'
  },
  {
    key: 'sessionSummary',
    index: 15,
    route: 'pages/session-list/session-list',
    url: '/pages/session-list/session-list',
    navType: 'switchTab',
    title: '查看 AI 总结',
    copy: 'Session 内的手牌都复盘完成后，可以在 Session 列表查看 AI 总结。',
    example: '澳门 300/600 · AI 总结',
    targetClass: 'onboarding-target-session-summary'
  },
  {
    key: 'sessionSummaryOpen',
    index: 16,
    route: 'pages/session-list/session-list',
    url: '/pages/session-list/session-list',
    navType: 'switchTab',
    title: 'AI 总结弹层',
    copy: '这里会把本场已复盘手牌汇总成总览、问题点和训练计划。',
    example: '1 手牌 · QdQs · Session 总结',
    targetClass: 'onboarding-target-session-summary-sheet'
  },
  {
    key: 'playerNotes',
    index: 17,
    route: 'pages/player-notes/player-notes',
    url: '/pages/player-notes/player-notes',
    navType: 'switchTab',
    title: '玩家库记录对手',
    copy: 'PLAYER/玩家页用来沉淀常遇到的对手、打法标签和相关手牌，不需要第一次就填很多。',
    example: '对手类型 · leak 标签 · 关联手牌',
    targetClass: 'onboarding-target-player-notes'
  },
  {
    key: 'stats',
    index: 18,
    route: 'pages/stats/stats',
    url: '/pages/stats/stats',
    navType: 'switchTab',
    title: '统计页看长期表现',
    copy: 'STATS/统计页会按真实场次和手牌生成资金曲线、级别表现和复盘优先级。',
    example: '澳门 300/600 · 资金曲线 · 复盘优先级',
    targetClass: 'onboarding-target-stats'
  },
  {
    key: 'reviewDelete',
    index: 19,
    route: 'pages/review-list/review-list',
    url: '/pages/review-list/review-list',
    navType: 'switchTab',
    title: '删除示例手牌',
    copy: '最后回到手牌列表，左滑 QdQs 示例手牌，可以删除这条示例。',
    example: 'QdQs 行 · 左滑删除',
    targetClass: 'onboarding-target-review-delete'
  },
  {
    key: 'sessionDelete',
    index: 20,
    route: 'pages/session-list/session-list',
    url: '/pages/session-list/session-list',
    navType: 'switchTab',
    title: '删除示例 Session',
    copy: '示例手牌清理后，再左滑澳门 300/600 试用场，删除示例 Session，完成闭环。',
    example: '澳门 300/600 Session 行 · 左滑删除',
    targetClass: 'onboarding-target-session-delete'
  }
]

const STEPS = RAW_STEPS.map(function (step, index) {
  return Object.assign({}, step, { index })
})

function hasWxStorage() {
  return typeof wx !== 'undefined' && wx && typeof wx.getStorageSync === 'function'
}

function getStorage(key) {
  if (!hasWxStorage()) return undefined
  try {
    return wx.getStorageSync(key)
  } catch (error) {
    return undefined
  }
}

function setStorage(key, value) {
  if (!hasWxStorage()) return
  try {
    wx.setStorageSync(key, value)
  } catch (error) {}
}

function removeStorage(key) {
  if (!hasWxStorage()) return
  try {
    wx.removeStorageSync(key)
  } catch (error) {}
}

function normalizeRoute(route) {
  return String(route || '').replace(/^\//, '')
}

function normalizeAccountId(accountId) {
  const text = String(accountId || '').trim().toUpperCase()
  return text || 'ANONYMOUS'
}

function getScopedKey(key) {
  return key + ':' + normalizeAccountId(guideContext.accountId)
}

function setGuideContext(context) {
  const source = context || {}
  if (Object.prototype.hasOwnProperty.call(source, 'accountId')) {
    guideContext.accountId = normalizeAccountId(source.accountId)
  }
  if (Object.prototype.hasOwnProperty.call(source, 'hasRealData')) {
    guideContext.hasRealData = !!source.hasRealData
  }
}

function getStepIndex() {
  const raw = Number(getStorage(getScopedKey(STEP_KEY)))
  if (!Number.isFinite(raw)) return 0
  return Math.max(0, Math.min(STEPS.length - 1, raw))
}

function shouldAutoShowGuide() {
  if (getStorage(getScopedKey(DISMISSED_KEY))) return false
  if (getStorage(getScopedKey(MANUAL_KEY))) return true
  if (getStorage(getScopedKey(STEP_KEY)) !== undefined) return true
  return !guideContext.hasRealData
}

function getActiveStep() {
  return STEPS[getStepIndex()]
}

function getStepForRoute(route) {
  if (!shouldAutoShowGuide()) return null
  const normalized = normalizeRoute(route)
  const step = getActiveStep()
  if (!step || step.route !== normalized) return null
  return Object.assign({}, step, {
    total: STEPS.length,
    current: step.index + 1,
    isLast: step.index === STEPS.length - 1
  })
}

function startGuide() {
  removeStorage(getScopedKey(DISMISSED_KEY))
  setStorage(getScopedKey(MANUAL_KEY), true)
  setStorage(getScopedKey(STEP_KEY), 0)
  return getActiveStep()
}

function resetGuide() {
  return startGuide()
}

function dismissGuide() {
  setStorage(getScopedKey(DISMISSED_KEY), true)
  removeStorage(getScopedKey(MANUAL_KEY))
}

function advanceGuide() {
  const current = getStepIndex()
  if (current >= STEPS.length - 1) {
    dismissGuide()
    return {
      done: true,
      step: null
    }
  }
  setStorage(getScopedKey(STEP_KEY), current + 1)
  return {
    done: false,
    step: getActiveStep()
  }
}

function navigateToStep(step) {
  if (!step || typeof wx === 'undefined' || !wx) return false
  const url = step.url
  if (!url) return false
  const targetRoute = normalizeRoute(url.split('?')[0])
  if (typeof getCurrentPages === 'function') {
    const pages = getCurrentPages()
    const current = pages && pages[pages.length - 1]
    if (current && normalizeRoute(current.route) === targetRoute) return false
  }
  if (step.navType === 'navigateTo' && typeof wx.navigateTo === 'function') {
    wx.navigateTo({
      url,
      fail() {
        if (typeof wx.redirectTo === 'function') wx.redirectTo({ url })
      }
    })
    return true
  }
  if (typeof wx.switchTab === 'function') {
    wx.switchTab({
      url,
      fail() {
        if (typeof wx.reLaunch === 'function') wx.reLaunch({ url })
      }
    })
    return true
  }
  return false
}

module.exports = {
  DISMISSED_KEY,
  STEP_KEY,
  MANUAL_KEY,
  STEPS,
  setGuideContext,
  shouldAutoShowGuide,
  getActiveStep,
  getStepForRoute,
  startGuide,
  resetGuide,
  dismissGuide,
  advanceGuide,
  navigateToStep
}
