const dataService = require('../../services/data-service')
const tabBar = require('../../utils/tab-bar')
const onboardingGuide = require('../../utils/onboarding-guide')
const statsAnalytics = require('../../utils/stats-analytics')

const RANGE_OPTIONS = [
  { key: 'all', label: '全部' },
  { key: 'last30', label: '近30天' },
  { key: 'last7', label: '近7天' }
]

const CURVE_COLORS = {
  total: '#19d66b',
  showdown: '#4b8dff',
  nonShowdown: '#ff3b45',
  allInEv: '#ffd400'
}

const CURVE_PLOT = {
  left: 9,
  right: 18,
  top: 8,
  bottom: 16
}

const MAX_CURVE_POINTS = 200

function downsampleLabels(labels, maxPoints) {
  const source = Array.isArray(labels) ? labels : []
  if (source.length <= maxPoints) return source
  return Array.from({ length: maxPoints }, (_, index) => {
    const start = Math.floor(index * source.length / maxPoints)
    const end = Math.max(start + 1, Math.floor((index + 1) * source.length / maxPoints))
    return source[Math.min(source.length - 1, end - 1)]
  })
}

function runFrameBatches(canvas, items, drawItem, batchSize) {
  const source = Array.isArray(items) ? items : []
  const size = Math.max(1, Number(batchSize) || 1)
  const schedule = canvas && typeof canvas.requestAnimationFrame === 'function'
    ? canvas.requestAnimationFrame.bind(canvas)
    : typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : callback => setTimeout(callback, 0)
  return new Promise(resolve => {
    let index = 0
    function drawBatch() {
      const end = Math.min(source.length, index + size)
      while (index < end) {
        drawItem(source[index], index)
        index += 1
      }
      if (index < source.length) schedule(drawBatch)
      else resolve()
    }
    if (source.length) schedule(drawBatch)
    else resolve()
  })
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function formatCurvePointValue(value, line) {
  const display = String(line && line.finalDisplay || '')
  const unitMatch = display.match(/(HKD|CNY|USD)/)
  const unit = unitMatch ? unitMatch[1] + ' ' : ''
  const amount = Math.round(Math.abs(number(value))).toLocaleString('en-US')
  const sign = number(value) > 0 ? '+' : number(value) < 0 ? '-' : ''
  if (display.indexOf('BB') > -1) return sign + amount + ' BB'
  return sign + unit + amount
}

function formatAxisMoney(value, unitHint) {
  const unitMatch = String(unitHint || '').match(/(HKD|CNY|USD|BB)/)
  const unit = unitMatch ? unitMatch[1] : ''
  const absolute = Math.abs(number(value))
  const compact = absolute >= 1000 ? Math.round(absolute).toLocaleString('en-US') : String(Math.round(absolute))
  const sign = number(value) > 0 ? '+' : number(value) < 0 ? '-' : ''
  return unit ? sign + unit + ' ' + compact : sign + compact
}

function formatHourTick(value) {
  const rounded = Math.round(number(value) * 10) / 10
  return String(Math.abs(rounded % 1) < 0.01 ? Math.round(rounded) : rounded) + 'h'
}

function buildAxisTicks(min, max, count) {
  const size = Math.max(2, count || 6)
  const span = Math.max(1, number(max) - number(min))
  return Array.from({ length: size }, (_, index) => number(max) - span * index / (size - 1))
}

function buildHourTicks(labels, count) {
  const size = Math.max(2, count || 5)
  const parsed = (Array.isArray(labels) ? labels : []).map(label => number(String(label).replace(/[^\d.-]/g, '')))
  const maxHour = Math.max.apply(null, parsed.concat([0]))
  if (maxHour <= 0) return [{ value: 0, label: '0h', left: CURVE_PLOT.left }]
  return Array.from({ length: size }, (_, index) => {
    const value = maxHour * index / (size - 1)
    const left = CURVE_PLOT.left + value / maxHour * (100 - CURVE_PLOT.left - CURVE_PLOT.right)
    return { value, label: formatHourTick(value), left }
  })
}

function toPlotX(x) {
  return CURVE_PLOT.left + number(x) / 100 * (100 - CURVE_PLOT.left - CURVE_PLOT.right)
}

function toPlotY(y) {
  return CURVE_PLOT.top + number(y) / 100 * (100 - CURVE_PLOT.top - CURVE_PLOT.bottom)
}

function buildCurveViewModel(graph) {
  const source = graph || {}
  const rawSeries = Array.isArray(source.series) ? source.series : []
  const rawLabels = Array.isArray(source.labels) ? source.labels : ['0h']
  const shouldDownsample = rawLabels.length > MAX_CURVE_POINTS
  const labels = shouldDownsample ? downsampleLabels(rawLabels, MAX_CURVE_POINTS) : rawLabels
  const series = shouldDownsample
    ? rawSeries.map(line => Object.assign({}, line, {
      values: statsAnalytics.downsample(line.values, MAX_CURVE_POINTS)
    }))
    : rawSeries
  const visibleCurveSeries = series.filter(line => line.showInChart !== false)
  const values = visibleCurveSeries.reduce((result, line) => result.concat(Array.isArray(line.values) ? line.values : []), [0])
  const rawMin = Math.min.apply(null, values)
  const rawMax = Math.max.apply(null, values)
  const span = Math.max(1, rawMax - rawMin)
  const minValue = rawMin - span * 0.12
  const maxValue = rawMax + span * 0.12
  const pointCount = Math.max(1, labels.length - 1)
  const lines = series.map(line => {
    const lineValues = Array.isArray(line.values) ? line.values : []
    const points = lineValues.map((value, index) => {
      const x = labels.length <= 1 ? 0 : index / pointCount * 100
      const y = 100 - (number(value) - minValue) / Math.max(1, maxValue - minValue) * 100
      const clampedY = clamp(y, 4, 96)
      return {
        x,
        y: clampedY,
        left: toPlotX(x),
        top: toPlotY(clampedY),
        value,
        display: formatCurvePointValue(value, line)
      }
    })
    return Object.assign({}, line, {
      color: CURVE_COLORS[line.key] || '#ffffff',
      points
    })
  })
  const axisHint = source.summary && source.summary.totalDisplay || lines[0] && lines[0].finalDisplay || ''
  const yTicks = buildAxisTicks(minValue, maxValue, 6).map(value => ({
    value,
    label: formatAxisMoney(value, axisHint),
    top: toPlotY(100 - (number(value) - minValue) / Math.max(1, maxValue - minValue) * 100)
  }))
  const xTicks = buildHourTicks(labels, 5)
  return {
    handCount: source.handCount || 0,
    xAxisLabel: source.xAxisLabel || '累计小时',
    yAxisLabel: source.yAxisLabel || '盈利金额',
    labels,
    series: lines,
    minValue,
    maxValue,
    topLabel: String(Math.round(maxValue)),
    bottomLabel: String(Math.round(minValue)),
    yTicks,
    xTicks,
    summary: source.summary || {},
    totalDisplay: source.summary && source.summary.totalDisplay || '+HKD 0'
  }
}

function buildMetricCards(performance) {
  const source = performance || {}
  return [
    { label: '平均每场', value: source.averageSessionDisplay || '样本不足', tone: 'positive' },
    { label: '平均时长', value: source.averageDurationDisplay || '样本不足', tone: 'neutral' },
    { label: '最佳场次', value: source.bestSessionDisplay || '样本不足', tone: 'positive' },
    { label: '最差场次', value: source.worstSessionDisplay || '样本不足', tone: 'negative' }
  ]
}

function buildPageModel(analytics) {
  const source = analytics || {}
  const overview = source.overview || {}
  const volatility = source.volatility || {}
  return Object.assign({}, source, {
    metrics: buildMetricCards(source.performance),
    hero: {
      totalProfit: overview.totalProfitDisplay || 'HKD 0',
      hourlyRate: overview.hourlyRateDisplay || '样本不足',
      sessions: String(overview.completedSessions || 0),
      hands: String(overview.handCount || 0),
      winRate: overview.winRateDisplay || '样本不足',
      bankroll: overview.bankrollDisplay || 'HKD 0'
    },
    statusText: overview.statusText || '等待样本',
    statusTone: overview.statusTone || 'neutral',
    venueRows: source.byVenue || [],
    stakeRows: source.byStake || [],
    intelCards: source.insights || [],
    volatility: Object.assign({}, volatility, {
      biggestWin: volatility.biggestWinDisplay || '样本不足',
      biggestLoss: volatility.biggestLossDisplay || '样本不足',
      averagePot: volatility.averagePotDisplay || '样本不足',
      profitFactor: volatility.profitFactorDisplay || '样本不足'
    }),
    bankrollGraph: buildCurveViewModel(source.bankrollGraph),
    reviewItems: source.reviewPriority || []
  })
}

Page({
  data: {
    agentChatReady: false,
    loading: true,
    hasLoaded: false,
    errorMessage: '',
    selectedRangeKey: 'all',
    rangeOptions: RANGE_OPTIONS,
    analytics: buildPageModel(null),
    curveReloading: false,
    curveTooltip: { visible: false, left: 0, top: 0, label: '', rows: [] },
    curveFocus: { visible: false, x: 0, totalY: 0, markers: [], valueTag: { left: 0, top: 0, value: '', color: CURVE_COLORS.total } },
    onboardingGuideVisible: false,
    onboardingGuideStep: null
  },
  onUnload() {
    clearTimeout(this.curveReloadTimer)
    clearTimeout(this.curveTooltipTimer)
    clearTimeout(this.curveDrawTimer)
  },
  onShow() {
    tabBar.syncCustomTabBar('/pages/stats/stats')
    const renderedFromCache = this.renderCachedStatsRange(this.data.selectedRangeKey)
    const silent = renderedFromCache || this.data.hasLoaded
    this.loadStats(this.data.selectedRangeKey, { silent })
    this.syncOnboardingGuide()
  },
  onReady() {
    setTimeout(() => {
      if (!this.data.agentChatReady) {
        this.setData({ agentChatReady: true })
      }
    }, 240)
  },
  syncOnboardingGuide() {
    if (dataService.refreshOnboardingGuideContext) dataService.refreshOnboardingGuideContext()
    const step = onboardingGuide.getStepForRoute('pages/stats/stats')
    this.setData({
      onboardingGuideVisible: !!step,
      onboardingGuideStep: step
    })
  },
  onOnboardingNext() {
    const result = onboardingGuide.advanceGuide()
    if (result.done) {
      this.syncOnboardingGuide()
      return
    }
    if (!onboardingGuide.navigateToStep(result.step)) this.syncOnboardingGuide()
  },
  onOnboardingSkip() {
    onboardingGuide.dismissGuide()
    this.syncOnboardingGuide()
  },
  renderCachedStatsRange(rangeKey) {
    if (!dataService.getCachedStatsData) return false
    const cached = dataService.getCachedStatsData(rangeKey)
    if (!cached || !cached.analytics) return false
    this.setData({
      analytics: buildPageModel(cached.analytics),
      curveTooltip: { visible: false, left: 0, top: 0, label: '', rows: [] },
      curveFocus: { visible: false, x: 0, totalY: 0, markers: [], valueTag: { left: 0, top: 0, value: '', color: CURVE_COLORS.total } },
      loading: false,
      hasLoaded: true
    }, () => {
      this.scheduleBankrollGraphDraw()
    })
    return true
  },
  prefetchStatsRanges(activeRangeKey) {
    if (!dataService.prefetchStatsData) return
    RANGE_OPTIONS
      .map(item => item.key)
      .filter(key => key !== activeRangeKey)
      .forEach(key => dataService.prefetchStatsData(key))
  },
  async loadStats(rangeKey, options) {
    const silent = !!(options && options.silent)
    this.setData({ loading: !silent, errorMessage: '' })
    try {
      const result = await dataService.getStatsData(rangeKey)
      this.setData({
        analytics: buildPageModel(result && result.analytics),
        curveReloading: true,
        curveTooltip: { visible: false, left: 0, top: 0, label: '', rows: [] },
        curveFocus: { visible: false, x: 0, totalY: 0, markers: [], valueTag: { left: 0, top: 0, value: '', color: CURVE_COLORS.total } },
        loading: false,
        hasLoaded: true
      }, () => {
        this.scheduleBankrollGraphDraw()
        this.prefetchStatsRanges(rangeKey)
        clearTimeout(this.curveReloadTimer)
        this.curveReloadTimer = setTimeout(() => this.setData({ curveReloading: false }), 720)
      })
    } catch (error) {
      console.warn('load stats failed', error)
      this.setData({
        loading: false,
        errorMessage: silent ? '' : '微信云统计服务暂时不可用，请检查网络或云开发配置后重试'
      })
    }
  },
  scheduleBankrollGraphDraw() {
    clearTimeout(this.curveDrawTimer)
    const draw = () => this.drawBankrollGraph(0)
    if (typeof wx !== 'undefined' && wx.nextTick) {
      wx.nextTick(() => {
        this.curveDrawTimer = setTimeout(draw, 80)
      })
    } else {
      this.curveDrawTimer = setTimeout(draw, 80)
    }
  },
  drawBankrollGraph(attempt) {
    attempt = attempt || 0
    const graph = this.data.analytics && this.data.analytics.bankrollGraph
    if (!graph || !graph.series || !graph.series.length) return
    const query = this.createSelectorQuery()
    query.select('#bankrollCurve').fields({ node: true, size: true }).exec(result => {
      const canvasInfo = result && result[0]
      const canvas = canvasInfo && canvasInfo.node
      const width = canvasInfo && canvasInfo.width || 320
      const height = canvasInfo && canvasInfo.height || 220
      if (!canvas || !canvas.getContext || !canvasInfo.width || !canvasInfo.height) {
        if (attempt < 3) {
          this.curveDrawTimer = setTimeout(() => this.drawBankrollGraph(attempt + 1), 120)
        }
        return
      }
      const dpr = wx.getSystemInfoSync && wx.getSystemInfoSync().pixelRatio || 1
      canvas.width = width * dpr
      canvas.height = height * dpr
      const ctx = canvas.getContext('2d')
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, width, height)

      const left = width * CURVE_PLOT.left / 100
      const right = width * CURVE_PLOT.right / 100
      const top = height * CURVE_PLOT.top / 100
      const bottom = height * CURVE_PLOT.bottom / 100
      const plotWidth = width - left - right
      const plotHeight = height - top - bottom
      const zeroY = top + (graph.maxValue / Math.max(1, graph.maxValue - graph.minValue)) * plotHeight

      ctx.strokeStyle = 'rgba(255,255,255,0.08)'
      ctx.lineWidth = 1
      const yTicks = graph.yTicks && graph.yTicks.length ? graph.yTicks : buildAxisTicks(graph.minValue, graph.maxValue, 6).map(value => ({ value }))
      yTicks.forEach(tick => {
        const y = top + (100 - (number(tick.value) - graph.minValue) / Math.max(1, graph.maxValue - graph.minValue) * 100) / 100 * plotHeight
        ctx.beginPath()
        ctx.moveTo(left, y)
        ctx.lineTo(width - right, y)
        ctx.stroke()
      })

      ctx.strokeStyle = 'rgba(255,255,255,0.045)'
      const xTicks = graph.xTicks && graph.xTicks.length ? graph.xTicks : []
      xTicks.forEach(tick => {
        const x = width * number(tick.left) / 100
        ctx.beginPath()
        ctx.moveTo(x, top)
        ctx.lineTo(x, top + plotHeight)
        ctx.stroke()
      })

      ctx.strokeStyle = 'rgba(255,255,255,0.24)'
      ctx.setLineDash([5, 7])
      ctx.beginPath()
      ctx.moveTo(left, clamp(zeroY, top, top + plotHeight))
      ctx.lineTo(width - right, clamp(zeroY, top, top + plotHeight))
      ctx.stroke()
      ctx.setLineDash([])

      const visibleCurveSeries = graph.series.filter(line => line.showInChart !== false)
      const drawLines = visibleCurveSeries.slice().sort((leftLine, rightLine) => {
        if (leftLine.key === 'total') return 1
        if (rightLine.key === 'total') return -1
        return 0
      })
      runFrameBatches(canvas, drawLines, line => {
        if (!line.points || !line.points.length) return
        ctx.strokeStyle = line.color
        ctx.lineWidth = line.key === 'total' ? 3 : 2
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.beginPath()
        line.points.forEach((point, index) => {
          const x = left + point.x / 100 * plotWidth
          const y = top + point.y / 100 * plotHeight
          if (index === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.stroke()
      }, 1)
    })
  },
  onCurveTouch(event) {
    clearTimeout(this.curveTooltipTimer)
    const graph = this.data.analytics && this.data.analytics.bankrollGraph
    if (!graph || !graph.labels || graph.labels.length <= 1) return
    const touch = event.touches && event.touches[0] || event.changedTouches && event.changedTouches[0] || {}
    const touchX = number(touch.clientX || touch.x || event.detail && event.detail.x)
    const query = this.createSelectorQuery()
    query.select('.stats-curve-chart').boundingClientRect(rect => {
      if (!rect || !rect.width) return
      const ratio = clamp((touchX - rect.left) / rect.width, 0, 1)
      const plotRatio = clamp((ratio * 100 - CURVE_PLOT.left) / Math.max(1, 100 - CURVE_PLOT.left - CURVE_PLOT.right), 0, 1)
      const index = Math.round(plotRatio * (graph.labels.length - 1))
      this.showCurveTooltip(index, ratio)
    }).exec()
  },
  showCurveTooltip(index, ratio) {
    const graph = this.data.analytics && this.data.analytics.bankrollGraph
    if (!graph || !graph.series) return
    const visibleCurveSeries = graph.series.filter(line => line.showInChart !== false)
    const clampedIndex = clamp(index, 0, graph.labels.length - 1)
    const totalLine = visibleCurveSeries.find(line => line.key === 'total') || visibleCurveSeries[0] || {}
    const totalPoint = totalLine.points && totalLine.points[clampedIndex] || {}
    const rows = visibleCurveSeries.map(line => {
      const point = line.points && line.points[clampedIndex] || {}
      return {
        key: line.key,
        label: line.label,
        value: point.display || '0',
        color: line.color
      }
    })
    const markers = visibleCurveSeries.map(line => {
      const point = line.points && line.points[clampedIndex] || {}
      return {
        key: line.key,
        left: number(point.left),
        top: number(point.top),
        color: line.color,
        total: line.key === 'total'
      }
    })
    const pointLeft = number(totalPoint.left || ratio * 100)
    const pointTop = number(totalPoint.top || 50)
    const left = clamp(pointLeft + 2, 4, 56)
    this.setData({
      curveFocus: {
        visible: true,
        x: pointLeft,
        totalY: pointTop,
        markers,
        valueTag: {
          left: clamp(pointLeft + 2, 10, 66),
          top: clamp(pointTop - 8, 8, 78),
          value: totalPoint.display || '0',
          color: totalLine.color || CURVE_COLORS.total
        }
      },
      curveTooltip: {
        visible: true,
        left,
        top: clamp(pointTop + 6, 10, 58),
        label: graph.labels[clampedIndex] || '',
        rows
      }
    })
  },
  onCurveTouchEnd() {
    clearTimeout(this.curveTooltipTimer)
    this.curveTooltipTimer = setTimeout(() => {
      this.setData({ 'curveTooltip.visible': false, 'curveFocus.visible': false })
    }, 20000)
  },
  onRangeTap(event) {
    const rangeKey = event.currentTarget.dataset.key || 'all'
    if (rangeKey === this.data.selectedRangeKey && !this.data.errorMessage) return
    this.setData({ selectedRangeKey: rangeKey })
    this.renderCachedStatsRange(rangeKey)
    this.loadStats(rangeKey, { silent: this.data.hasLoaded })
  }
})

module.exports = {
  buildMetricCards,
  buildPageModel,
  buildCurveViewModel,
  runFrameBatches
}
