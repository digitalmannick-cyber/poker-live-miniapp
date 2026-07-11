const DEFAULT_CONSECUTIVE_LOSS_HANDS = 3

function clampNumber(value, fallback, min, max) {
  const number = Number(value)
  const safe = Number.isFinite(number) ? number : fallback
  return Math.max(min, Math.min(max, safe))
}

function createReminderId(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.floor(Math.random() * 10000)
}

const DEFAULT_AI_REMINDER_SETTINGS = {
  enabled: true,
  openAgentOnTrigger: false,
  extraChannels: {
    subscribeMessage: false
  },
  rules: {
    profitTarget: { amount: 0, subscribeMessage: false },
    lossLimit: { amount: 0, subscribeMessage: false },
    trailingProfit: { percent: 0, subscribeMessage: false },
    postLossExtraRisk: { percent: 0, subscribeMessage: false },
    sessionPreReminder: { hoursBefore: 0, subscribeMessage: false },
      sessionMaxHours: { hours: 0, subscribeMessage: false }
    },
  textReminders: []
}

function normalizeTextReminder(item, index) {
  const title = String(item && item.title || '').trim()
  const content = String(item && item.content || '').trim()
  if (!title && !content) return null
  if (!title) return null
  return {
    id: String(item && item.id || ('text_' + index + '_' + Date.now())).trim(),
    title,
    content,
    enabled: item && Object.prototype.hasOwnProperty.call(item, 'enabled') ? !!item.enabled : true,
    evBrain: !!(item && item.evBrain),
    subscribeMessage: !!(item && item.subscribeMessage)
  }
}

function normalizeRuleChannels(rule) {
  return {
    evBrain: !!(rule && rule.evBrain),
    subscribeMessage: !!(rule && rule.subscribeMessage)
  }
}

function normalizeAiReminderSettings(input) {
  const source = input || {}
  const rules = source.rules || {}
  const defaults = DEFAULT_AI_REMINDER_SETTINGS
  const rawSessionMaxHours = Number(rules.sessionMaxHours && rules.sessionMaxHours.hours)
  const sessionMaxHours = Number.isFinite(rawSessionMaxHours) && rawSessionMaxHours > 0
    ? clampNumber(rawSessionMaxHours, defaults.rules.sessionMaxHours.hours, 1, 24)
    : 0
  const textReminders = Array.isArray(source.textReminders)
    ? source.textReminders.map(normalizeTextReminder).filter(Boolean)
    : defaults.textReminders.slice()

  return {
    enabled: Object.prototype.hasOwnProperty.call(source, 'enabled') ? !!source.enabled : defaults.enabled,
    openAgentOnTrigger: Object.prototype.hasOwnProperty.call(source, 'openAgentOnTrigger') ? !!source.openAgentOnTrigger : defaults.openAgentOnTrigger,
    extraChannels: {
      subscribeMessage: !!(source.extraChannels && source.extraChannels.subscribeMessage)
    },
    rules: {
      profitTarget: {
        amount: clampNumber(rules.profitTarget && rules.profitTarget.amount, defaults.rules.profitTarget.amount, 0, Number.MAX_SAFE_INTEGER),
        evBrain: normalizeRuleChannels(rules.profitTarget).evBrain,
        subscribeMessage: normalizeRuleChannels(rules.profitTarget).subscribeMessage
      },
      lossLimit: {
        amount: clampNumber(rules.lossLimit && rules.lossLimit.amount, defaults.rules.lossLimit.amount, 0, Number.MAX_SAFE_INTEGER),
        evBrain: normalizeRuleChannels(rules.lossLimit).evBrain,
        subscribeMessage: normalizeRuleChannels(rules.lossLimit).subscribeMessage
      },
      trailingProfit: {
        percent: clampNumber(rules.trailingProfit && rules.trailingProfit.percent, defaults.rules.trailingProfit.percent, 0, 100),
        evBrain: normalizeRuleChannels(rules.trailingProfit).evBrain,
        subscribeMessage: normalizeRuleChannels(rules.trailingProfit).subscribeMessage
      },
      postLossExtraRisk: {
        percent: clampNumber(rules.postLossExtraRisk && rules.postLossExtraRisk.percent, defaults.rules.postLossExtraRisk.percent, 0, 100),
        evBrain: normalizeRuleChannels(rules.postLossExtraRisk).evBrain,
        subscribeMessage: normalizeRuleChannels(rules.postLossExtraRisk).subscribeMessage
      },
      sessionPreReminder: {
        hoursBefore: clampNumber(rules.sessionPreReminder && rules.sessionPreReminder.hoursBefore, defaults.rules.sessionPreReminder.hoursBefore, 0, sessionMaxHours),
        evBrain: normalizeRuleChannels(rules.sessionPreReminder).evBrain,
        subscribeMessage: normalizeRuleChannels(rules.sessionPreReminder).subscribeMessage
      },
      sessionMaxHours: {
        hours: sessionMaxHours,
        evBrain: normalizeRuleChannels(rules.sessionMaxHours).evBrain,
        subscribeMessage: normalizeRuleChannels(rules.sessionMaxHours).subscribeMessage
      }
    },
    textReminders
  }
}

function parseDateTimeMs(value) {
  const text = String(value || '').trim()
  if (!text) return 0
  const date = new Date(text.replace(' ', 'T'))
  const time = date.getTime()
  return Number.isNaN(time) ? 0 : time
}

function getSessionProfit(session) {
  if (!session) return 0
  return (Number(session.cashOut) || 0) - (Number(session.buyIn) || 0)
}

function getSessionDurationHours(session, nowMs) {
  const start = parseDateTimeMs(session && session.startTime)
  if (!start) return 0
  const now = Number(nowMs) || Date.now()
  return Math.max(0, (now - start) / 3600000)
}

function buildChannels(settings, rule) {
  return {
    sessionTimeline: true,
    evBrain: !!((rule && rule.evBrain) || (settings && settings.openAgentOnTrigger)),
    subscribeMessage: !!(rule && rule.subscribeMessage)
  }
}

function createReminder(type, payload) {
  const source = payload || {}
  return {
    _id: createReminderId('air'),
    type,
    severity: source.severity || 'normal',
    title: source.title || '',
    message: source.message || '',
    sessionId: source.sessionId || '',
    handId: source.handId || '',
    channels: source.channels || { sessionTimeline: true, evBrain: false, subscribeMessage: false },
    status: 'pending',
    createdAt: Number(source.nowMs) || Date.now()
  }
}

function hasLastConsecutiveLosses(recentHands, count) {
  const list = (Array.isArray(recentHands) ? recentHands : []).filter(Boolean)
  if (list.length < count) return false
  const lastHands = list.slice(-count)
  if (!lastHands.every(item => (Number(item.currentProfit) || 0) < 0)) return false
  const beforeStreak = list[list.length - count - 1]
  return !beforeStreak || (Number(beforeStreak.currentProfit) || 0) >= 0
}

function evaluateAiRemindersAfterHand(options) {
  const source = options || {}
  const settings = normalizeAiReminderSettings(source.settings)
  if (!settings.enabled) return []
  const session = source.session || {}
  const hand = source.hand || {}
  const nowMs = Number(source.nowMs) || Date.now()
  const rules = settings.rules
  const sessionProfit = getSessionProfit(session)
  const peakProfit = Math.max(Number(session.peakProfit) || 0, sessionProfit)
  const durationHours = getSessionDurationHours(session, nowMs)
  const reminders = []
  const base = {
    sessionId: session._id || hand.sessionId || '',
    handId: hand._id || '',
    nowMs
  }

  if (rules.profitTarget.amount > 0 && sessionProfit >= rules.profitTarget.amount) {
    reminders.push(createReminder('profit_target', Object.assign({}, base, {
      severity: 'strong',
      channels: buildChannels(settings, rules.profitTarget),
      title: '止盈提醒',
      message: '当前盈利 ' + sessionProfit + '，已达到你设置的止盈线 ' + rules.profitTarget.amount + '。'
    })))
  }

  if (rules.lossLimit.amount > 0 && sessionProfit <= -rules.lossLimit.amount) {
    reminders.push(createReminder('loss_limit', Object.assign({}, base, {
      severity: 'strong',
      channels: buildChannels(settings, rules.lossLimit),
      title: '止损提醒',
      message: '当前亏损 ' + Math.abs(sessionProfit) + '，已达到你设置的止损线 ' + rules.lossLimit.amount + '。'
    })))
  }

  if (rules.trailingProfit.percent > 0 && peakProfit > 0) {
    const drawdown = peakProfit - sessionProfit
    if (drawdown > 0 && (drawdown / peakProfit) * 100 >= rules.trailingProfit.percent) {
      reminders.push(createReminder('trailing_profit', Object.assign({}, base, {
        severity: 'strong',
        channels: buildChannels(settings, rules.trailingProfit),
        title: '移动止盈提醒',
        message: '当前回撤已超过你设置的 ' + rules.trailingProfit.percent + '%。'
      })))
    }
  }

  if (rules.lossLimit.amount > 0 && rules.postLossExtraRisk.percent > 0) {
    const extraLossLine = -rules.lossLimit.amount * (1 + rules.postLossExtraRisk.percent / 100)
    if (sessionProfit <= extraLossLine) {
      reminders.push(createReminder('post_loss_extra_risk', Object.assign({}, base, {
        severity: 'strong',
        channels: buildChannels(settings, rules.postLossExtraRisk),
        title: '止损后追加风险',
        message: '到达止损后又继续亏损超过 ' + rules.postLossExtraRisk.percent + '%。'
      })))
    }
  }

  if (rules.sessionMaxHours.hours > 0) {
    if (durationHours >= rules.sessionMaxHours.hours) {
      reminders.push(createReminder('session_max_hours', Object.assign({}, base, {
        severity: 'warning',
        channels: buildChannels(settings, rules.sessionMaxHours),
        title: 'Session 时长提醒',
        message: '已达到你设置的 ' + rules.sessionMaxHours.hours + ' 小时时长上限。'
      })))
    } else if (rules.sessionPreReminder.hoursBefore > 0 && durationHours >= rules.sessionMaxHours.hours - rules.sessionPreReminder.hoursBefore) {
      reminders.push(createReminder('session_pre_reminder', Object.assign({}, base, {
        severity: 'warning',
        channels: buildChannels(settings, rules.sessionPreReminder),
        title: 'Session 时长预提醒',
        message: '距离 ' + rules.sessionMaxHours.hours + ' 小时时长上限还有约 ' + rules.sessionPreReminder.hoursBefore + ' 小时。'
      })))
    }
  }

  if (hasLastConsecutiveLosses(source.recentHands, DEFAULT_CONSECUTIVE_LOSS_HANDS)) {
    reminders.push(createReminder('consecutive_loss', Object.assign({}, base, {
      severity: 'warning',
      channels: buildChannels(settings),
      title: '连续亏损提醒',
      message: '你已经连续亏损 ' + DEFAULT_CONSECUTIVE_LOSS_HANDS + ' 手，建议检查是否上头或需要暂停。'
    })))
  }

  settings.textReminders.forEach(item => {
    if (!item.enabled) return
    reminders.push(createReminder('text_reminder', Object.assign({}, base, {
      severity: 'normal',
      channels: buildChannels(settings, item),
      title: item.title,
      message: item.content || item.title
    })))
  })

  return reminders
}

module.exports = {
  DEFAULT_AI_REMINDER_SETTINGS,
  DEFAULT_CONSECUTIVE_LOSS_HANDS,
  normalizeAiReminderSettings,
  evaluateAiRemindersAfterHand,
  __test: {
    getSessionProfit,
    getSessionDurationHours,
    hasLastConsecutiveLosses
  }
}
