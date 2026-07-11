function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function roundMoney(value) {
  return Math.round(number(value) * 100) / 100
}

function normalizeEquityPct(value) {
  if (value === undefined || value === null || value === '') return null
  const equity = number(value)
  if (equity < 0 || equity > 100) return null
  return equity
}

function normalizeAllInStreet(value) {
  const text = String(value || '').trim().toLowerCase()
  if (!text) return ''
  if (/^(preflop|pre-flop|pf|翻前|翻牌前)$/.test(text)) return 'preflop'
  if (/^(flop|翻牌)$/.test(text)) return 'flop'
  if (/^(turn|转牌|轉牌)$/.test(text)) return 'turn'
  if (/^(river|河牌)$/.test(text)) return 'river'
  return text
}

function calculateAllInEv(input) {
  const source = input || {}
  const actualProfit = roundMoney(source.currentProfit)
  if (!source.isAllIn) {
    return {
      status: 'not_all_in',
      adjustedProfit: actualProfit,
      equityValue: null,
      actualProfit,
      luckDelta: 0
    }
  }

  if (normalizeAllInStreet(source.allInStreet || source.street) === 'river') {
    return {
      status: 'river_all_in',
      adjustedProfit: actualProfit,
      equityValue: null,
      actualProfit,
      luckDelta: 0
    }
  }

  const equityPct = normalizeEquityPct(source.heroEquityPct)
  const potSize = number(source.potSize)
  const heroInvested = number(source.heroInvested)
  if (equityPct == null || potSize <= 0 || heroInvested <= 0) {
    return {
      status: 'missing_equity',
      adjustedProfit: actualProfit,
      equityValue: null,
      actualProfit,
      luckDelta: 0
    }
  }

  const equityValue = roundMoney(potSize * equityPct / 100)
  const adjustedProfit = roundMoney(equityValue - heroInvested)
  return {
    status: 'calculated',
    adjustedProfit,
    equityValue,
    actualProfit,
    luckDelta: roundMoney(actualProfit - adjustedProfit)
  }
}

module.exports = {
  calculateAllInEv,
  __test: {
    normalizeAllInStreet,
    normalizeEquityPct,
    roundMoney
  }
}
