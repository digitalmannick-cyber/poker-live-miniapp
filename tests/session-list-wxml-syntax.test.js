const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const wxml = fs.readFileSync(path.join(root, 'pages/session-list/session-list.wxml'), 'utf8')

assert.equal(
  /\ufffd\/(?:view|button|text|scroll-view|picker|textarea|input)>/.test(wxml) ||
  /\?\/(?:view|button|text|scroll-view|picker|textarea|input)>/.test(wxml),
  false,
  'session-list.wxml should not contain corrupted closing tags'
)

console.log('session-list WXML syntax smoke test passed')
