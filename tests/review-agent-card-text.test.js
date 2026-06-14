const assert = require('node:assert/strict')

function formatCardCodesInAdvice(value) {
  const suitMap = {
    s: '♠',
    h: '♥',
    d: '♦',
    c: '♣'
  }
  return String(value || '').replace(/\b(?:[2-9TJQKA][shdc]){1,5}\b/ig, function (match) {
    return match.replace(/([2-9TJQKA])([shdc])/ig, function (_, rank, suit) {
      return String(rank || '').toUpperCase() + suitMap[String(suit || '').toLowerCase()]
    })
  })
}

assert.equal(
  formatCardCodesInAdvice('Flop 7d3d3h, Turn 5s, River Qc, Hero AhKd'),
  'Flop 7♦3♦3♥, Turn 5♠, River Q♣, Hero A♥K♦'
)

assert.equal(
  formatCardCodesInAdvice('AK/AQ 和 fold/call 不应被误改'),
  'AK/AQ 和 fold/call 不应被误改'
)

function buildAgentStreetStatusClass(status) {
  const text = String(status || '').trim().toLowerCase()
  if (!text) return ''
  if (/明显错误|重大错误|错误|mistake|error|bad/.test(text)) return 'danger'
  if (/可优化|建议优化|优化|偏大|偏小|需调整|adjust|optimi[sz]e|improve/.test(text)) return 'warn'
  if (/标准|正确|合理|好|无争议|没问题|standard|correct|good|ok/.test(text)) return 'good'
  return 'neutral'
}

assert.equal(buildAgentStreetStatusClass('明显错误'), 'danger')
assert.equal(buildAgentStreetStatusClass('建议优化'), 'warn')
assert.equal(buildAgentStreetStatusClass('标准'), 'good')

console.log('review Agent card text tests passed')
