const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

const root = path.join(__dirname, '..')
const js = fs.readFileSync(path.join(root, 'components/agent-chat/agent-chat.js'), 'utf8')

assert.match(
  js,
  /lifetimes\s*:\s*\{[\s\S]*attached\s*\(\)\s*\{[\s\S]*consumePendingAiReminders\s*\(/,
  'agent chat should automatically consume pending AI reminders when the component attaches'
)

assert.match(
  js,
  /pageLifetimes\s*:\s*\{[\s\S]*show\s*\(\)\s*\{[\s\S]*consumePendingAiReminders\s*\(/,
  'agent chat should re-check pending AI reminders when its page becomes visible again'
)

assert.match(
  js,
  /filter\s*\(\s*item\s*=>\s*!\(item\s*&&\s*item\.reminder\)\s*\)/,
  'agent chat should not restore old AI reminder cards from persisted chat history'
)

console.log('agent chat AI reminder auto-consume checks passed')
