const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const pageScript = fs.readFileSync(path.join(root, 'pages/session-list/session-list.js'), 'utf8')
const pageTemplate = fs.readFileSync(path.join(root, 'pages/session-list/session-list.wxml'), 'utf8')

assert.match(
  pageScript,
  /agentChatReady:\s*false/,
  'session-list page should initialize agentChatReady as false so first paint can finish before mounting agent chat'
)

assert.match(
  pageScript,
  /onReady\s*\(\)\s*\{[\s\S]*agentChatReady:\s*true[\s\S]*\}/,
  'session-list page should enable agent chat in onReady instead of mounting it immediately during app launch'
)

assert.match(
  pageTemplate,
  /<agent-chat\s+wx:if="\{\{agentChatReady\}\}"\s*\/>/,
  'session-list WXML should lazy-mount agent-chat behind agentChatReady'
)

console.log('session-list launch performance guard passed')
