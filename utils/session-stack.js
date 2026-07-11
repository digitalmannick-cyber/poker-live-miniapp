function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseTimeMs(value) {
  if (value === undefined || value === null || value === '') return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const text = String(value || '').trim()
  if (!text) return 0
  const numeric = Number(text)
  if (Number.isFinite(numeric) && numeric > 1000000000) return numeric
  const parsed = new Date(text.indexOf('T') > -1 ? text : text.replace(' ', 'T'))
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime()
}

function eventTimeMs(event) {
  return parseTimeMs(event && (event.createdAtMs || event.createdAt || event.time || event.updatedAt))
}

function handTimeMs(hand) {
  return parseTimeMs(hand && (hand.createdAtMs || hand.createdAt || hand.playedDate || hand.updatedAt))
}

function eventSequence(event) {
  return number(event && (event.sequence || event.createdAtMs || event.createdAt || event.id))
}

function isBeforeOrAt(itemMs, cutoffMs) {
  if (!cutoffMs) return true
  if (!itemMs) return true
  return itemMs <= cutoffMs
}

function latestStackEvent(events, cutoffMs) {
  return (events || [])
    .filter(item => item && item.type === 'stack')
    .filter(item => isBeforeOrAt(eventTimeMs(item), cutoffMs))
    .sort((left, right) => {
      const timeDiff = eventTimeMs(right) - eventTimeMs(left)
      if (timeDiff) return timeDiff
      return eventSequence(right) - eventSequence(left)
    })[0] || null
}

function buyInAddTotal(events, cutoffMs, afterMs) {
  return (events || [])
    .filter(item => item && item.type === 'buyin_add')
    .filter(item => isBeforeOrAt(eventTimeMs(item), cutoffMs))
    .filter(item => !afterMs || eventTimeMs(item) > afterMs)
    .reduce((sum, item) => sum + number(item.amount), 0)
}

function handProfitTotal(hands, cutoffMs, afterMs, excludeHandId) {
  return (hands || [])
    .filter(hand => hand && String(hand._id || hand.id || '') !== String(excludeHandId || ''))
    .filter(hand => isBeforeOrAt(handTimeMs(hand), cutoffMs))
    .filter(hand => !afterMs || handTimeMs(hand) > afterMs)
    .reduce((sum, hand) => sum + number(hand.currentProfit), 0)
}

function calculateSessionStackAt(session, hands, options) {
  const source = session || {}
  const opts = options || {}
  const cutoffMs = number(opts.cutoffMs) || parseTimeMs(opts.cutoffTime) || Date.now()
  const events = Array.isArray(source.timelineEvents) ? source.timelineEvents : []
  const totalRecordedBuyIns = buyInAddTotal(events, 0, 0)
  const currentBuyIn = number(source.buyIn)
  const baseBuyIn = Math.max(0, currentBuyIn - totalRecordedBuyIns) || currentBuyIn
  const latestStack = latestStackEvent(events, cutoffMs)
  if (latestStack) {
    const stackTime = eventTimeMs(latestStack)
    return Math.max(0,
      number(latestStack.amount) +
      buyInAddTotal(events, cutoffMs, stackTime) +
      handProfitTotal(hands, cutoffMs, stackTime, opts.excludeHandId)
    )
  }

  const hasTimelineOrHands = events.length || (Array.isArray(hands) && hands.length)
  const stack = baseBuyIn +
    buyInAddTotal(events, cutoffMs, 0) +
    handProfitTotal(hands, cutoffMs, 0, opts.excludeHandId)
  if (hasTimelineOrHands || stack > 0) return Math.max(0, stack)
  return Math.max(0, currentBuyIn + number(source.currentProfit))
}

module.exports = {
  calculateSessionStackAt,
  __test: {
    parseTimeMs,
    eventTimeMs,
    handTimeMs
  }
}
