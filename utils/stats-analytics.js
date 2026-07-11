const RANGE_DAYS = { last30: 30, last7: 7 }
const { calculateAllInEv } = require('./all-in-ev')

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function hasFiniteNumber(value) {
  return value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value))
}

function formatNumber(value, maximumFractionDigits) {
  const digits = maximumFractionDigits == null ? 0 : maximumFractionDigits
  const source = number(value)
  const normalized = digits === 0 ? Math.round(source) : source
  return normalized.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  })
}

function unitPrefix(unit) {
  if (unit === 'CNY') return 'CNY '
  if (unit === 'USD') return 'USD '
  if (unit === 'BB') return ''
  return 'HKD '
}

function formatMoney(value, unit, options) {
  const amount = number(value)
  const config = options || {}
  const decimals = config.decimals == null ? 0 : config.decimals
  const sign = config.signed && amount > 0 ? '+' : amount < 0 ? '-' : ''
  const suffix = unit === 'BB' ? ' BB' : ''
  return sign + unitPrefix(unit) + formatNumber(Math.abs(amount), decimals) + suffix
}

function dateMs(value) {
  if (typeof value === 'number') return value
  const text = String(value || '').trim()
  if (!text) return 0
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text) ? text + 'T12:00:00' : text.replace(' ', 'T')
  const parsed = new Date(normalized).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function sessionDateMs(session) {
  return dateMs(session && (session.date || session.startTime || session.createdAt || session.updatedAt))
}

function handDateMs(hand) {
  return dateMs(hand && (hand.playedDate || hand.createdAt || hand.updatedAt))
}

function filterRange(items, rangeKey, nowMs, getDate) {
  const days = RANGE_DAYS[rangeKey]
  if (!days) return items.slice()
  const end = new Date(nowMs || Date.now())
  end.setHours(23, 59, 59, 999)
  const start = end.getTime() - days * 24 * 60 * 60 * 1000
  return items.filter(item => {
    const value = getDate(item)
    return value >= start && value <= end.getTime()
  })
}

function sessionProfit(session) {
  if (!session || session.status !== 'finished') return 0
  if (Number.isFinite(Number(session.totalProfit))) return Number(session.totalProfit)
  return number(session.cashOut) - number(session.buyIn)
}

function handProfit(hand) {
  return number(hand && hand.currentProfit)
}

function isHistoryImportHand(hand) {
  const source = hand && hand.source || hand && hand.voiceExtract && hand.voiceExtract.source
  return source === 'feishu_base_history_import'
}

function isHistoryImportSession(session) {
  const source = session && session.source
  return source && source.type === 'feishu_base_history_import'
}

function historyImportMinutes(filteredHands, allHands, filteredSessions) {
  const allHistoryHands = (Array.isArray(allHands) ? allHands : []).filter(isHistoryImportHand)
  if (!allHistoryHands.length) return 0
  const filteredHistoryHands = (Array.isArray(filteredHands) ? filteredHands : []).filter(isHistoryImportHand)
  if (!filteredHistoryHands.length) return 0
  const historySessions = (Array.isArray(filteredSessions) ? filteredSessions : []).filter(isHistoryImportSession)
  const existingMinutes = historySessions.reduce((sum, item) => sum + number(item.durationMinutes), 0)
  if (existingMinutes > 0) return 0
  return 360 * 60 * filteredHistoryHands.length / allHistoryHands.length
}

function roundMoney(value) {
  return Math.round(number(value) * 100) / 100
}

function formatHourLabel(value) {
  const hours = number(value)
  const rounded = Math.round(hours * 10) / 10
  return formatNumber(rounded, rounded % 1 === 0 ? 0 : 1) + 'h'
}

function handCumulativeHours(hand, fallbackIndex) {
  if (!hand) return fallbackIndex
  const candidates = [hand.cumulativeHours, hand.elapsedHours, hand.sessionElapsedHours, hand.totalHours]
  for (let index = 0; index < candidates.length; index += 1) {
    if (Number.isFinite(Number(candidates[index]))) return Number(candidates[index])
  }
  return fallbackIndex
}

function appendText(parts, value) {
  if (value == null) return
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value).trim()
    if (text) parts.push(text)
  }
}

function collectHandText(hand) {
  const parts = []
  if (!hand) return ''
  ;[
    hand.showdown,
    hand.showdownText,
    hand.opponentCards,
    hand.opponentCardsSource,
    hand.actionLine,
    hand.streetSummary,
    hand.notes,
    hand.mindJourney,
    hand.reviewText,
    hand.voiceText
  ].forEach(value => appendText(parts, value))

  const streetInputs = hand.streetInputs || {}
  Object.keys(streetInputs).forEach(key => {
    const value = streetInputs[key]
    if (value && typeof value === 'object') {
      ;['actionLine', 'summary', 'text', 'note', 'showdown'].forEach(field => appendText(parts, value[field]))
    } else {
      appendText(parts, value)
    }
  })

  const voiceExtract = hand.voiceExtract || hand.agentResult || {}
  if (voiceExtract && typeof voiceExtract === 'object') {
    ;['actionLine', 'streetSummary', 'summary', 'showdown', 'opponentCards'].forEach(field => appendText(parts, voiceExtract[field]))
  }
  return parts.join(' ').toLowerCase()
}

function hasShowText(text) {
  return /(showdown|show\s|shows|showed|show牌|亮牌|秀牌|摊牌|攤牌|开牌|開牌)/i.test(text)
}

function hasCallOrCheckdownText(text) {
  return /(call|called|跟注|跟了|接了|平跟|check\s*check|check-check|过牌\s*过牌|过过|check到|一路check|check\s*back)/i.test(text)
}

function hasRiverCallText(text) {
  return /(river|河牌|河底)[^/。；;]*(call|called|跟注|跟了|接了|平跟|\bc\b)/i.test(text)
}

function hasAllInCallText(text) {
  return /(all\s*-?\s*in|allin|\bai\b|全下|推全|打光|梭哈)[^/。；;]*(call|called|跟注|跟了|接了|平跟|\bc\b)/i.test(text)
}

function hasMuckText(text) {
  return /(muck|盖牌|埋牌)/i.test(text)
}

function hasFoldText(text) {
  return /(fold|folded|弃牌|棄牌|弃了|棄了|弃掉|棄掉|扔牌)/i.test(text)
}

function isExplicitCardText(value) {
  const text = String(value || '').trim()
  if (!text) return false
  const lowered = text.toLowerCase()
  if (/^(none|null|undefined|no|false)$/i.test(text)) return false
  if (lowered.indexOf('未') > -1 && /(亮|摊|攤|show)/i.test(lowered)) return false
  if (/^(没有|无|無)$/.test(text)) return false
  return true
}

function isVerifiedCardText(value) {
  const text = String(value || '').trim()
  if (!isExplicitCardText(text)) return false
  if (/(muck|fold|弃牌|棄牌|未亮|未show|没亮|沒有亮|没有亮|推断|推測|推测|大概率|可能|疑似)/i.test(text)) return false
  if (/(?:[akqjt2-9][shdc♠♥♦♣]\s*){2}/i.test(text)) return true
  if (/\b(?:aa|kk|qq|jj|tt|99|88|77|66|55|44|33|22|ak|aq|aj|at|kq|kj|kt|qj|qt|jt)[os]?\b/i.test(text)) {
    return /(show|亮|秀|摊牌|攤牌|开牌|開牌)/i.test(text)
  }
  return false
}

function hasVerifiedOpponentCards(hand) {
  if (!hand) return false
  if (hand.opponentCardsVerified === true || hand.villainCardsVerified === true || hand.showdownVerified === true) return true
  const source = String(hand.villainCardsSource || hand.opponentCardsSource || '').trim().toLowerCase()
  if (/^(shown|showdown|showed|verified)$/.test(source)) return true
  return [
    hand.villainCardsInput,
    hand.opponentCards,
    hand.showdown,
    hand.voiceExtract && hand.voiceExtract.opponentCards,
    hand.agentResult && hand.agentResult.opponentCards
  ].some(isVerifiedCardText)
}

function showdownClassification(hand) {
  if (!hand) return 'unknown'
  if (hand.showdownType === 'showdown') return 'showdown'
  if (hand.showdownType === 'non_showdown') return 'non_showdown'
  const reason = String(hand.showdownReason || '').trim()
  if (/^(both_show_cards|called_and_mucked|hero_showed_villain_mucked|showdown_muck|showdown)$/i.test(reason)) return 'showdown'
  if (/^(river_fold|pre_river_fold|folded_to_bet|no_showdown|river_single_show|opponent_not_shown|single_show)$/i.test(reason)) return 'non_showdown'
  if (hand.wentToShowdown === true) return 'showdown'
  if (hand.wentToShowdown === false) return 'non_showdown'
  if (hand.showdown === true) return 'showdown'
  if (hand.showdown === false) return 'non_showdown'

  const text = collectHandText(hand)
  const hasShow = hasShowText(text)
  const hasMuck = hasMuckText(text)
  const hasCallOrCheckdown = hasCallOrCheckdownText(text)
  const hasFold = hasFoldText(text)

  if (isExplicitCardText(hand.opponentCards) || isExplicitCardText(hand.showdown)) return 'showdown'
  if (/showdown|摊牌|攤牌/i.test(text)) return 'showdown'
  if (hasRiverCallText(text)) return 'showdown'
  if (hasAllInCallText(text) && !hasFold) return 'showdown'
  if (hasShow && (hasCallOrCheckdown || hasMuck)) return 'showdown'
  if (hasMuck && hasCallOrCheckdown) return 'showdown'
  if (hasFold || hasMuck) return 'non_showdown'
  return 'unknown'
}

function isShowdownHand(hand) {
  return showdownClassification(hand) === 'showdown'
}

function hasExplicitAllInEv(hand) {
  if (!hand || !hasFiniteNumber(hand.allInEv)) return false
  if (!isAllInEvAdjustableHand(hand)) return false
  if (String(hand.allInEvSource || '').trim()) return true
  if (String(hand.allInEvStatus || '').trim() === 'calculated') return true
  return Number(hand.allInEv) !== 0
}

function hasExplicitLegacyAllInEv(hand, key) {
  if (!hand || !hasFiniteNumber(hand[key])) return false
  if (!isAllInEvAdjustableHand(hand)) return false
  if (String(hand.allInEvStatus || '').trim() === 'calculated') return true
  if (String(hand.allInEvSource || '').trim()) return true
  return Number(hand[key]) !== 0
}

function normalizeAllInStreet(value) {
  const text = String(value || '').trim().toLowerCase()
  if (/^(river|河牌)$/.test(text)) return 'river'
  if (/^(turn|转牌|轉牌)$/.test(text)) return 'turn'
  if (/^(flop|翻牌)$/.test(text)) return 'flop'
  if (/^(preflop|pre-flop|pf|翻前|翻牌前)$/.test(text)) return 'preflop'
  return text
}

function handAllInStreet(hand) {
  return normalizeAllInStreet(hand && (hand.allInStreet || hand.allInRound || hand.allInStage || hand.allInEvStreet))
}

function isAllInEvAdjustableHand(hand) {
  if (!hand) return false
  if (hand.isAllIn !== true && hand.allInEvEligible !== true) return false
  return handAllInStreet(hand) !== 'river'
}

function allInEvProfit(hand) {
  if (!hand) return 0
  if (!isAllInEvAdjustableHand(hand)) return handProfit(hand)
  if (!hasVerifiedOpponentCards(hand)) return handProfit(hand)
  if (hasExplicitAllInEv(hand)) return roundMoney(hand.allInEv)
  if (hasExplicitLegacyAllInEv(hand, 'allInEvProfit')) return roundMoney(hand.allInEvProfit)
  if (hasExplicitLegacyAllInEv(hand, 'allInEvAdjustedProfit')) return roundMoney(hand.allInEvAdjustedProfit)
  const result = calculateAllInEv({
    isAllIn: hand.isAllIn,
    allInStreet: handAllInStreet(hand),
    potSize: hand.allInPot || hand.potSize,
    heroInvested: hand.heroInvested,
    heroEquityPct: hand.heroEquityPct,
    currentProfit: hand.currentProfit
  })
  return result.status === 'calculated' ? result.adjustedProfit : handProfit(hand)
}

function inferredCumulativeHours(sortedHands, index) {
  const hand = sortedHands[index]
  if (!hand) return index + 1
  const direct = handCumulativeHours(hand, undefined)
  if (direct !== undefined && Number.isFinite(Number(direct))) return Number(direct)
  const historyHands = sortedHands.filter(item => {
    return isHistoryImportHand(item)
  })
  if (historyHands.length) {
    const historyIndex = historyHands.findIndex(item => item === hand)
    if (historyIndex >= 0) return Math.round(360 * (historyIndex + 1) / historyHands.length * 10) / 10
  }
  return index + 1
}

function buildLine(key, label, english, values, unit, options) {
  const finalValue = values[values.length - 1] || 0
  return {
    key,
    label,
    english,
    values,
    finalValue,
    finalDisplay: formatMoney(finalValue, unit, { signed: true }),
    tone: tone(finalValue),
    showInLegend: !(options && options.showInLegend === false),
    showInChart: !(options && options.showInChart === false)
  }
}

function buildBankrollGraph(hands, unit) {
  const sortedHands = hands.slice().sort((a, b) => handDateMs(a) - handDateMs(b))
  const labels = ['0h']
  const totalValues = [0]
  const showdownValues = [0]
  const nonShowdownValues = [0]
  const allInEvValues = [0]
  let total = 0
  let showdown = 0
  let allInEv = 0

  sortedHands.forEach((hand, index) => {
    const profit = handProfit(hand)
    total = roundMoney(total + profit)
    if (isShowdownHand(hand)) {
      showdown = roundMoney(showdown + profit)
    }
    allInEv = roundMoney(allInEv + allInEvProfit(hand))
    labels.push(formatHourLabel(inferredCumulativeHours(sortedHands, index)))
    totalValues.push(total)
    showdownValues.push(showdown)
    nonShowdownValues.push(roundMoney(total - showdown))
    allInEvValues.push(allInEv)
  })

  let peak = 0
  let maxDrawdown = 0
  totalValues.forEach(value => {
    peak = Math.max(peak, value)
    maxDrawdown = Math.max(maxDrawdown, peak - value)
  })

  return {
    handCount: sortedHands.length,
    xAxisLabel: '累计小时',
    yAxisLabel: '盈利金额',
    labels,
    series: [
      buildLine('total', '总盈利', 'Total Winnings', totalValues, unit),
      buildLine('showdown', '摊牌盈利', 'Showdown Winnings', showdownValues, unit),
      buildLine('nonShowdown', '非摊牌盈利', 'Non-showdown Winnings', nonShowdownValues, unit),
      buildLine('allInEv', 'All-in EV', 'Expected Winnings', allInEvValues, unit)
    ],
    summary: {
      total,
      allInEv,
      peak,
      maxDrawdown,
      totalDisplay: formatMoney(total, unit, { signed: true }),
      allInEvDisplay: formatMoney(allInEv, unit, { signed: true }),
      peakDisplay: formatMoney(peak, unit, { signed: true }),
      maxDrawdownDisplay: formatMoney(-maxDrawdown, unit, { signed: true })
    }
  }
}

function tone(value) {
  return value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral'
}

function withBars(rows) {
  const max = Math.max.apply(null, rows.map(item => Math.abs(item.profit)).concat([0]))
  return rows.map(item => Object.assign({}, item, {
    tone: tone(item.profit),
    barWidth: max ? Math.max(8, Math.round(Math.abs(item.profit) / max * 100)) : 0
  }))
}

function aggregate(items, labelFor, profitFor, metaFor, unit) {
  const groups = {}
  items.forEach(item => {
    const label = String(labelFor(item) || '').trim()
    if (!label) return
    if (!groups[label]) groups[label] = { label, count: 0, profit: 0, minutes: 0 }
    groups[label].count += 1
    groups[label].profit += profitFor(item)
    groups[label].minutes += number(item.durationMinutes)
  })
  const rows = Object.keys(groups).map(label => {
    const row = groups[label]
    return Object.assign(row, {
      averageProfit: row.count ? row.profit / row.count : 0,
      value: formatMoney(row.profit, unit, { signed: true }),
      meta: metaFor(row)
    })
  }).sort((a, b) => b.profit - a.profit)
  return withBars(rows)
}

function aggregateTags(hands, unit) {
  const expanded = []
  hands.forEach(hand => (Array.isArray(hand.tags) ? hand.tags : []).forEach(tag => {
    if (String(tag || '').trim()) expanded.push({ tag: String(tag).trim(), profit: handProfit(hand) })
  }))
  return aggregate(expanded, item => item.tag, item => item.profit, row => '复盘标签 · ' + row.count + ' 手牌', unit)
}

function buildReviewPriority(hands, unit) {
  const lossHands = hands.filter(item => handProfit(item) < 0 && !item.aiReview && item.reviewStatus !== 'reviewed')
  const missingDetail = hands.filter(item => !item.detailBackfilled)
  const tagTotals = {}
  hands.forEach(item => (Array.isArray(item.tags) ? item.tags : []).forEach(tag => {
    const label = String(tag || '').trim()
    if (!label) return
    if (!tagTotals[label]) tagTotals[label] = { label, count: 0, profit: 0 }
    tagTotals[label].count += 1
    tagTotals[label].profit += handProfit(item)
  }))
  const costlyTag = Object.keys(tagTotals).map(key => tagTotals[key]).sort((a, b) => a.profit - b.profit)[0]
  const result = []
  if (lossHands.length) {
    const loss = lossHands.reduce((sum, item) => sum + handProfit(item), 0)
    result.push({ title: '优先复盘大额亏损', meta: lossHands.length + ' 手牌 · 合计 ' + formatMoney(loss, unit, { signed: true }), count: lossHands.length, tone: 'negative' })
  }
  if (costlyTag && costlyTag.profit < 0) {
    result.push({ title: costlyTag.label + ' 标签偏亏', meta: costlyTag.count + ' 次 · 合计 ' + formatMoney(costlyTag.profit, unit, { signed: true }), count: costlyTag.count, tone: 'negative' })
  }
  if (missingDetail.length) {
    result.push({ title: '补全细节后再跑 AI 建议', meta: missingDetail.length + ' 手牌缺少行动线', count: missingDetail.length, tone: 'neutral' })
  }
  if (!result.length && hands.length) {
    result.push({ title: '当前没有高优先级复盘', meta: '已记录手牌暂未发现待处理项', count: 0, tone: 'positive' })
  }
  return result.slice(0, 3)
}

function buildStatsAnalytics(input) {
  const source = input || {}
  const unit = source.settings && source.settings.chipUnit || 'HKD'
  const rangeKey = RANGE_DAYS[source.rangeKey] ? source.rangeKey : 'all'
  const sourceSessions = Array.isArray(source.sessions) ? source.sessions : []
  const sourceHands = Array.isArray(source.hands) ? source.hands : []
  const sessions = filterRange(sourceSessions, rangeKey, source.nowMs, sessionDateMs)
  const hands = filterRange(sourceHands, rangeKey, source.nowMs, handDateMs)
  const finished = sessions.filter(item => item.status === 'finished')
  const totalProfit = finished.reduce((sum, item) => sum + sessionProfit(item), 0)
  const totalMinutes = finished.reduce((sum, item) => sum + number(item.durationMinutes), 0) + historyImportMinutes(hands, sourceHands, finished)
  const sessionWins = finished.filter(item => sessionProfit(item) > 0).length
  const handProfits = hands.map(handProfit)
  const bankrollCurrent = number(source.bankrollCurrent)

  const byVenue = aggregate(finished, item => item.venue || '未命名场馆', sessionProfit, row => {
    const hours = row.minutes / 60
    return row.count + ' 场' + (hours ? ' · ' + (hours / row.count).toFixed(1) + 'h/场' : '')
  }, unit)
  const byStake = aggregate(hands, item => item.stakeLevel, handProfit, row => row.count + ' 手牌', unit)
  const byPosition = aggregate(hands, item => item.heroPosition, handProfit, row => '位置 · ' + row.count + ' 手牌', unit)
  const byOpponentType = aggregate(hands, item => item.opponentType || item.villainType, handProfit, row => '对手类型 · ' + row.count + ' 手牌', unit)
  const byStraddle = aggregate(hands, item => item.hasStraddle ? 'Straddle' : '非 Straddle', handProfit, row => '底注结构 · ' + row.count + ' 手牌', unit)
  const byTag = aggregateTags(hands, unit)
  const diagnosisRows = withBars(byPosition.concat(byOpponentType, byStraddle, byTag).sort((a, b) => Math.abs(b.profit) - Math.abs(a.profit)).slice(0, 6))
  const bestPosition = byPosition[0]
  const worstPosition = byPosition.slice().sort((a, b) => a.profit - b.profit)[0]
  const bestOpponent = byOpponentType[0]

  const positiveHands = handProfits.filter(value => value > 0)
  const negativeHands = handProfits.filter(value => value < 0)
  const flatHands = handProfits.filter(value => value === 0)
  const totalWins = positiveHands.reduce((sum, value) => sum + value, 0)
  const totalLosses = Math.abs(negativeHands.reduce((sum, value) => sum + value, 0))
  const averagePot = hands.length ? hands.reduce((sum, item) => sum + number(item.potSize), 0) / hands.length : 0
  const bigPotCount = hands.filter(item => number(item.potSize) >= averagePot * 2 && averagePot > 0).length
  const maxDistribution = Math.max(positiveHands.length, negativeHands.length, flatHands.length, 1)

  const overview = {
    completedSessions: finished.length,
    handCount: hands.length,
    totalProfit,
    totalProfitDisplay: formatMoney(totalProfit, unit, { signed: true }),
    hourlyRate: totalMinutes ? totalProfit / (totalMinutes / 60) : 0,
    hourlyRateDisplay: totalMinutes ? formatMoney(totalProfit / (totalMinutes / 60), unit, { signed: true }) + '/h' : '样本不足',
    winRateDisplay: finished.length ? Math.round(sessionWins / finished.length * 100) + '%' : '样本不足',
    bankrollDisplay: formatMoney(bankrollCurrent, unit),
    statusText: !finished.length ? '等待样本' : totalProfit > 0 ? '盈利中' : totalProfit < 0 ? '需要复盘' : '持平',
    statusTone: tone(totalProfit)
  }

  const performance = {
    averageSessionDisplay: finished.length ? formatMoney(totalProfit / finished.length, unit, { signed: true }) : '样本不足',
    averageDurationDisplay: finished.length && totalMinutes ? (totalMinutes / finished.length / 60).toFixed(1) + 'h' : '样本不足',
    bestSessionDisplay: finished.length ? formatMoney(Math.max.apply(null, finished.map(sessionProfit)), unit, { signed: true }) : '样本不足',
    worstSessionDisplay: finished.length ? formatMoney(Math.min.apply(null, finished.map(sessionProfit)), unit, { signed: true }) : '样本不足'
  }

  return {
    rangeKey,
    rangeLabel: rangeKey === 'last7' ? '近7天' : rangeKey === 'last30' ? '近30天' : '全部样本',
    hasSamples: sessions.length > 0 || hands.length > 0,
    overview,
    performance,
    byVenue,
    byStake,
    byPosition,
    byOpponentType,
    byStraddle,
    byTag,
    bankrollGraph: buildBankrollGraph(hands, unit),
    diagnosisRows,
    insights: [
      bestPosition ? { label: '最赚钱位置', value: bestPosition.label, sub: bestPosition.value + ' · ' + bestPosition.count + ' 手牌', tone: bestPosition.tone } : { label: '最赚钱位置', value: '样本不足', sub: '记录位置后生成', tone: 'neutral' },
      worstPosition && worstPosition.profit < 0 ? { label: '最需关注位置', value: worstPosition.label, sub: worstPosition.value + ' · ' + worstPosition.count + ' 手牌', tone: 'negative' } : { label: '最需关注位置', value: '样本不足', sub: '继续积累手牌', tone: 'neutral' },
      bestOpponent ? { label: '优势对手', value: bestOpponent.label, sub: bestOpponent.value + ' · ' + bestOpponent.count + ' 手牌', tone: bestOpponent.tone } : { label: '优势对手', value: '样本不足', sub: '记录对手类型后生成', tone: 'neutral' }
    ],
    volatility: {
      biggestWin: positiveHands.length ? Math.max.apply(null, positiveHands) : 0,
      biggestLoss: negativeHands.length ? Math.min.apply(null, negativeHands) : 0,
      biggestWinDisplay: positiveHands.length ? formatMoney(Math.max.apply(null, positiveHands), unit, { signed: true }) : '样本不足',
      biggestLossDisplay: negativeHands.length ? formatMoney(Math.min.apply(null, negativeHands), unit, { signed: true }) : '样本不足',
      averagePotDisplay: hands.length ? formatMoney(averagePot, unit) : '样本不足',
      bigPotCount,
      profitFactorDisplay: totalLosses ? (totalWins / totalLosses).toFixed(1) : '样本不足',
      distribution: [
        { label: '盈利手', value: String(positiveHands.length), tone: 'positive', barWidth: Math.round(positiveHands.length / maxDistribution * 100) },
        { label: '亏损手', value: String(negativeHands.length), tone: 'negative', barWidth: Math.round(negativeHands.length / maxDistribution * 100) },
        { label: '打平手', value: String(flatHands.length), tone: 'neutral', barWidth: Math.round(flatHands.length / maxDistribution * 100) }
      ]
    },
    reviewPriority: buildReviewPriority(hands, unit)
  }
}

module.exports = {
  buildStatsAnalytics,
  __test: { dateMs, filterRange, sessionProfit, formatMoney, isShowdownHand, showdownClassification, allInEvProfit, buildBankrollGraph }
}
