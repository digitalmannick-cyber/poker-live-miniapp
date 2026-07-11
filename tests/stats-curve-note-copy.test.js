const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const wxml = fs.readFileSync(path.resolve(__dirname, '..', 'pages', 'stats', 'stats.wxml'), 'utf8')

test('bankroll graph notes include session and All-in EV explanations', () => {
  assert.match(wxml, /注：此图曲线按已记录手牌实际数据统计；不是session总盈利统计。/)
  assert.match(wxml, /注：allin ev只计算了双方allin并且对手亮牌的情况，未亮牌按照实际输赢计算/)
})
