function normalizeAmount(value) {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

function formatAmount(value, unit) {
  const amount = normalizeAmount(value)
  const sign = amount > 0 ? '+' : amount < 0 ? '-' : ''
  const abs = Math.abs(amount)

  if (unit === 'CNY') {
    return sign + '¥' + abs
  }
  if (unit === 'HKD') {
    return sign + 'HK$' + abs
  }
  if (unit === 'USD') {
    return sign + '$' + abs
  }
  return sign + abs + ' BB'
}

module.exports = {
  formatAmount
}
