const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const monitorScript = fs.readFileSync(
  path.join(__dirname, '..', 'tools', 'devtools-console-monitor.js'),
  'utf8'
)

assert.match(
  monitorScript,
  /'\/pages\/player-notes\/player-notes'/,
  'the DevTools console monitor should cover the player page'
)
assert.match(
  monitorScript,
  /miniProgram\.reLaunch\(route\)/,
  'the monitor should open both tabBar and non-tabBar routes safely'
)
assert.doesNotMatch(
  monitorScript,
  /miniProgram\.switchTab\(route\)/,
  'the monitor should not fail when a monitored route is not in tabBar'
)

console.log('devtools console monitor tests passed')
