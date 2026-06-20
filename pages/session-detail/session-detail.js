const dataService = require('../../services/data-service')
const display = require('../../utils/display')
const cardUi = require('../../utils/card-ui')
const sessionDuration = require('../../utils/session-duration')
const sessionRules = require('../../utils/session-rules')

function padNumber(value) {
  return String(value).padStart(2, '0')
}

function formatDatePart(date) {
  return [
    date.getFullYear(),
    padNumber(date.getMonth() + 1),
    padNumber(date.getDate())
  ].join('-')
}

function formatTimePart(date) {
  return padNumber(date.getHours()) + ':' + padNumber(date.getMinutes())
}

function getNowParts() {
  const now = new Date()
  return {
    date: formatDatePart(now),
    time: formatTimePart(now)
  }
}

function splitDateTime(value) {
  const text = String(value || '').trim()
  const parts = text.split(/\s+/)
  return {
    date: parts[0] || '',
    time: parts[1] || ''
  }
}

function combineDateTime(datePart, timePart) {
  const date = String(datePart || '').trim()
  const time = String(timePart || '').trim()
  if (!date) return ''
  if (!time) return date
  return date + ' ' + time
}

function parseDateTimeValue(value) {
  const text = String(value || '').trim()
  if (!text) return null
  const normalized = text.replace(' ', 'T')
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

function shiftDateTime(value, minutes) {
  const date = parseDateTimeValue(value)
  if (!date) return value
  const next = new Date(date.getTime() + (Number(minutes) || 0) * 60000)
  return combineDateTime(formatDatePart(next), formatTimePart(next))
}

function diffMinutes(startValue, endValue) {
  const start = parseDateTimeValue(startValue)
  const end = parseDateTimeValue(endValue)
  if (!start || !end) return 0
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000))
}

function calculateSessionProfit(buyIn, cashOut) {
  if (String(cashOut || '').trim() === '') return null
  const buy = Number(buyIn)
  const cash = Number(cashOut)
  if (!Number.isFinite(buy) || !Number.isFinite(cash)) return null
  return cash - buy
}

function formatSessionProfit(value) {
  const amount = Number(value) || 0
  const sign = amount > 0 ? '+' : amount < 0 ? '-' : ''
  const abs = Math.abs(amount)
  return sign + abs
}

function getDisplaySessionProfit(session) {
  if (!session || session.status !== 'finished') return null
  return Number(session.totalProfit) || 0
}

function buildSessionProfitView(session) {
  const profit = getDisplaySessionProfit(session)
  if (profit == null) {
    return {
      totalProfitDisplay: '未结算',
      totalProfitTone: 'empty'
    }
  }
  return {
    totalProfitDisplay: formatSessionProfit(profit),
    totalProfitTone: profit >= 0 ? 'positive' : 'negative'
  }
}

function buildProfitDisplay(buyIn, cashOut) {
  const profit = calculateSessionProfit(buyIn, cashOut)
  return profit == null ? '' : formatSessionProfit(profit)
}

function getProfitTone(buyIn, cashOut) {
  const profit = calculateSessionProfit(buyIn, cashOut)
  if (profit == null) return 'empty'
  return profit >= 0 ? 'positive' : 'negative'
}

function buildSelectorOptions(list, currentValue) {
  return (list || []).map(function (item) {
    const value = String(item || '')
    return {
      label: value,
      value: value,
      selected: value === String(currentValue || '')
    }
  })
}

function buildForm(session, settings) {
  const venues = settings && settings.venues ? settings.venues : []
  const blindPresets = settings && settings.blindPresets ? settings.blindPresets : []
  const firstVenue = venues[0] || ''
  const defaultBlindPreset = (settings && settings.lastBlindPreset) || blindPresets[0] || '5/10'
  const blindParts = String(defaultBlindPreset).split('/')
  const now = getNowParts()
  if (!session) {
    return {
      startDate: now.date,
      startTime: now.time,
      endDate: '',
      endTime: '',
      venue: firstVenue,
      blindPreset: defaultBlindPreset,
      smallBlind: blindParts[0] || '5',
      bigBlind: blindParts[1] || '10',
      tableSize: '8',
      buyIn: '',
      cashOut: '',
      notes: ''
    }
  }
  const start = splitDateTime(session.startTime || session.date || '')
  const end = splitDateTime(session.endTime || '')
  return {
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    venue: session.venue,
    blindPreset: String(session.smallBlind || '') + '/' + String(session.bigBlind || ''),
    smallBlind: String(session.smallBlind || ''),
    bigBlind: String(session.bigBlind || ''),
    tableSize: String(session.tableSize || 8),
    buyIn: String(session.buyIn || ''),
    cashOut: String(session.cashOut || session.endingChips || ''),
    notes: session.notes || ''
  }
}

Page({
  data: {
    mode: 'detail',
    sessionId: '',
    session: null,
    hands: [],
    form: buildForm(),
    settings: {
      venues: [],
      blindPresets: []
    },
    venueOptions: [],
    blindPresetOptions: [],
    selectorVisible: false,
    selectorTitle: '',
    selectorKey: '',
    selectorOptions: [],
    loading: false,
    profitPreviewDisplay: '0',
    profitPreviewTone: 'positive',
    durationDisplay: '--:--',
    durationLabel: 'SESSION TIME'
  },
  onLoad(options) {
    const mode = options.mode || 'detail'
    const sessionId = options.id || ''
    this.setData({ mode, sessionId })
    this.refresh()
  },
  onShow() {
    this.refresh()
  },
  guardCreateMode() {
    if (this.createGuardPromise) return this.createGuardPromise
    this.createGuardPromise = dataService.getSessionListData().then(data => {
      const activeSession = sessionRules.findActiveSession(data.sessions)
      if (!activeSession) return true
      wx.showToast({ title: sessionRules.ACTIVE_SESSION_MESSAGE, icon: 'none' })
      setTimeout(() => {
        wx.navigateBack({
          delta: 1,
          fail() {
            wx.switchTab({ url: '/pages/session-list/session-list' })
          }
        })
      }, 80)
      return false
    })
    return this.createGuardPromise
  },
  onHide() {
    this.stopDurationClock()
  },
  onUnload() {
    this.stopDurationClock()
  },
  async refresh() {
    const settings = dataService.getAppSettings()
    const chipUnit = settings.chipUnit
    const venueOptions = settings.venues.slice()
    const blindPresetOptions = settings.blindPresets.slice()
    if (this.data.mode === 'create') {
      const createAllowed = await this.guardCreateMode()
      if (!createAllowed) {
        this.setData({ loading: false })
        return
      }
      this.stopDurationClock()
      const form = buildForm(null, settings)
      this.setData({
        session: null,
        hands: [],
        settings,
        venueOptions,
        blindPresetOptions,
        form: form,
        profitPreviewDisplay: buildProfitDisplay(form.buyIn, form.cashOut),
        profitPreviewTone: getProfitTone(form.buyIn, form.cashOut)
      })
      return
    }
    this.setData({ loading: true })
    const detail = await dataService.getSessionDetailData(this.data.sessionId)
    if (detail.session && detail.session.venue && venueOptions.indexOf(detail.session.venue) === -1) {
      venueOptions.unshift(detail.session.venue)
    }
    const currentBlindPreset = detail.session
      ? String(detail.session.smallBlind || '') + '/' + String(detail.session.bigBlind || '')
      : ''
    if (currentBlindPreset && blindPresetOptions.indexOf(currentBlindPreset) === -1) {
      blindPresetOptions.unshift(currentBlindPreset)
    }
    const form = buildForm(detail.session, settings)
    this.setData({
      session: detail.session
        ? Object.assign({}, detail.session, buildSessionProfitView(detail.session))
        : null,
      hands: (detail.hands || []).map(item => Object.assign({}, item, {
        currentProfitDisplay: display.formatAmount(item.currentProfit, chipUnit),
        heroCardsVisual: cardUi.parseHeroCardsInput(item.heroCardsInput),
        boardStreetVisual: cardUi.parseBoardStreets(item.board)
      })),
      settings,
      venueOptions,
      blindPresetOptions,
      form: form,
      profitPreviewDisplay: buildProfitDisplay(form.buyIn, form.cashOut),
      profitPreviewTone: getProfitTone(form.buyIn, form.cashOut),
      loading: false
    })
    this.startDurationClock()
  },
  refreshDurationDisplay() {
    const view = sessionDuration.buildDurationView(this.data.session)
    this.setData({
      durationDisplay: view.display,
      durationLabel: view.label
    })
  },
  startDurationClock() {
    this.stopDurationClock()
    this.refreshDurationDisplay()
    if (!this.data.session || this.data.session.status !== 'active' || this.data.session.timerPausedAt) return
    const delay = 60000 - (Date.now() % 60000) + 50
    this.durationClockTimeout = setTimeout(() => {
      this.refreshDurationDisplay()
      this.durationClockInterval = setInterval(() => this.refreshDurationDisplay(), 60000)
      this.durationClockTimeout = null
    }, delay)
  },
  stopDurationClock() {
    if (this.durationClockTimeout) clearTimeout(this.durationClockTimeout)
    if (this.durationClockInterval) clearInterval(this.durationClockInterval)
    this.durationClockTimeout = null
    this.durationClockInterval = null
  },
  onInput(e) {
    const key = e.currentTarget.dataset.key
    const value = e.detail.value
    const patch = { ['form.' + key]: value }
    if (key === 'buyIn' || key === 'cashOut') {
      const nextForm = Object.assign({}, this.data.form, { [key]: value })
      patch.profitPreviewDisplay = buildProfitDisplay(nextForm.buyIn, nextForm.cashOut)
      patch.profitPreviewTone = getProfitTone(nextForm.buyIn, nextForm.cashOut)
    }
    this.setData(patch)
  },
  pickStartDate(e) {
    const value = e.detail.value || ''
    this.setData({ 'form.startDate': value })
  },
  pickStartTime(e) {
    const value = e.detail.value || ''
    this.setData({ 'form.startTime': value })
  },
  pickEndDate(e) {
    const value = e.detail.value || ''
    this.setData({ 'form.endDate': value })
  },
  pickEndTime(e) {
    const value = e.detail.value || ''
    this.setData({ 'form.endTime': value })
  },
  pickVenue(e) {
    const venue = this.data.venueOptions[e.detail.value] || ''
    this.setData({ 'form.venue': venue })
  },
  pickBlindPreset(e) {
    const blindPreset = this.data.blindPresetOptions[e.detail.value] || ''
    const parts = String(blindPreset).split('/')
    dataService.updateSettings({ lastBlindPreset: blindPreset })
    this.setData({
      'form.blindPreset': blindPreset,
      'form.smallBlind': parts[0] || '',
      'form.bigBlind': parts[1] || ''
    })
  },
  openVenueSelector() {
    this.setData({
      selectorVisible: true,
      selectorTitle: '选择场地',
      selectorKey: 'venue',
      selectorOptions: buildSelectorOptions(this.data.venueOptions, this.data.form.venue)
    })
  },
  openBlindPresetSelector() {
    this.setData({
      selectorVisible: true,
      selectorTitle: '选择级别',
      selectorKey: 'blindPreset',
      selectorOptions: buildSelectorOptions(this.data.blindPresetOptions, this.data.form.blindPreset)
    })
  },
  closeSelector() {
    this.setData({ selectorVisible: false })
  },
  selectPresetOption(e) {
    const key = this.data.selectorKey
    const value = String(e.currentTarget.dataset.value || '')
    if (!key || !value) return
    if (key === 'blindPreset') {
      const parts = value.split('/')
      dataService.updateSettings({ lastBlindPreset: value })
      this.setData({
        'form.blindPreset': value,
        'form.smallBlind': parts[0] || '',
        'form.bigBlind': parts[1] || '',
        selectorVisible: false
      })
      return
    }
    this.setData({
      ['form.' + key]: value,
      selectorVisible: false
    })
  },
  async saveSession() {
    const form = this.data.form
    if (!form.venue || !form.buyIn) {
      wx.showToast({ title: '请先填写场地和买入', icon: 'none' })
      return
    }
    if (!form.startDate || !form.startTime) {
      wx.showToast({ title: '请先填写开始时间', icon: 'none' })
      return
    }
    const payload = Object.assign({}, form, {
      date: form.startDate,
      startTime: combineDateTime(form.startDate, form.startTime),
      endTime: combineDateTime(form.endDate, form.endTime),
      totalProfit: calculateSessionProfit(form.buyIn, form.cashOut) || 0
    })
    dataService.updateSettings({ lastBlindPreset: payload.blindPreset })
    if (this.data.mode === 'create') {
      try {
        const session = await dataService.createSession(payload)
        wx.showToast({ title: '已创建牌局', icon: 'success' })
        wx.redirectTo({ url: '/pages/session-detail/session-detail?id=' + session._id })
      } catch (error) {
        const duplicate = error && error.code === sessionRules.ACTIVE_SESSION_ERROR_CODE
        wx.showToast({
          title: duplicate ? sessionRules.ACTIVE_SESSION_MESSAGE : '创建失败，请稍后重试',
          icon: 'none'
        })
      }
      return
    }
    await dataService.updateSession(this.data.sessionId, payload)
    wx.showToast({ title: '已更新牌局', icon: 'success' })
    this.refresh()
  },
  async toggleTimerPause() {
    if (!this.data.sessionId || !this.data.session || this.data.session.status !== 'active') return
    const now = getNowParts()
    const nowText = combineDateTime(now.date, now.time)
    const session = this.data.session
    if (session.timerPausedAt) {
      const pauseMinutes = diffMinutes(session.timerPausedAt, nowText)
      const currentStartTime = combineDateTime(this.data.form.startDate, this.data.form.startTime) || session.startTime
      const nextStartTime = shiftDateTime(currentStartTime, pauseMinutes)
      const startParts = splitDateTime(nextStartTime)
      await dataService.updateSession(this.data.sessionId, {
        startTime: nextStartTime,
        date: startParts.date,
        timerPausedAt: ''
      })
      this.setData({
        'form.startDate': startParts.date,
        'form.startTime': startParts.time,
        'session.startTime': nextStartTime,
        'session.date': startParts.date,
        'session.timerPausedAt': ''
      })
      wx.showToast({ title: '已继续计时', icon: 'success' })
      this.refresh()
      return
    }
    await dataService.updateSession(this.data.sessionId, {
      timerPausedAt: nowText
    })
    this.setData({
      'session.timerPausedAt': nowText
    })
    wx.showToast({ title: '已暂停计时', icon: 'success' })
    this.refresh()
  },
  goAddHand() {
    if (!this.data.sessionId) return
    wx.switchTab({ url: '/pages/hand-record/hand-record' })
  },
  goHandDetail(e) {
    wx.navigateTo({ url: '/pages/hand-detail/hand-detail?id=' + e.currentTarget.dataset.id })
  },
  finishSession() {
    if (!this.data.sessionId) return
    if (!this.data.session || this.data.session.status !== 'active') return
    const form = this.data.form
    if (!form.venue || !form.buyIn) {
      wx.showToast({ title: '请先填写场地和买入', icon: 'none' })
      return
    }
    if (!form.startDate || !form.startTime) {
      wx.showToast({ title: '请先填写开始时间', icon: 'none' })
      return
    }
    if (form.cashOut === '') {
      wx.showToast({ title: '请先填写提现', icon: 'none' })
      return
    }
    const now = getNowParts()
    const endTime = this.data.session && this.data.session.timerPausedAt
      ? this.data.session.timerPausedAt
      : combineDateTime(now.date, now.time)
    const payload = Object.assign({}, form, {
      date: form.startDate,
      startTime: combineDateTime(form.startDate, form.startTime),
      endTime: endTime,
      timerPausedAt: '',
      totalProfit: calculateSessionProfit(form.buyIn, form.cashOut) || 0
    })
    dataService.updateSettings({ lastBlindPreset: payload.blindPreset })
    dataService.updateSession(this.data.sessionId, payload).then(() => {
      return dataService.finishSession(this.data.sessionId, {
        cashOut: form.cashOut,
        endTime: endTime
      })
    }).then(() => {
      wx.showToast({ title: '本场已结束', icon: 'success' })
      this.refresh()
    })
  }
})
