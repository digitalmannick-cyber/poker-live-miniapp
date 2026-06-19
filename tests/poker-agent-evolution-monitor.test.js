const assert = require('node:assert/strict')
const monitor = require('../tools/poker-agent-evolution-monitor')

const report = monitor.renderReport()

assert.ok(
  report.includes('待你确认是否写入 EV脑'),
  'report should include the Agent confirmation section'
)

assert.ok(
  report.includes('应保留在小程序侧'),
  'report should separate miniapp-owned responsibilities'
)

assert.ok(
  monitor.CANDIDATES.some(item => item.target === 'EV脑' && item.priority === 'P0'),
  'monitor should surface high-priority Agent evolution candidates'
)

assert.ok(
  monitor.CANDIDATES.some(item => item.target === 'Miniapp' && item.title.includes('pot')),
  'pot calculation should be tracked as miniapp source-of-truth work'
)

console.log('EV脑 evolution monitor tests passed')
