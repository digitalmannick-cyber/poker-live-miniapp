const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

const root = path.join(__dirname, '..')
const wxml = fs.readFileSync(path.join(root, 'pages/profile/profile.wxml'), 'utf8')
const wxss = fs.readFileSync(path.join(root, 'pages/profile/profile.wxss'), 'utf8')

function cssBlock(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = wxss.match(new RegExp(escaped + '\\s*\\{([\\s\\S]*?)\\}', 'm'))
  return match ? match[1] : ''
}

assert.match(
  wxml,
  /class="settings-editor-actions ai-reminder-sheet-actions"[\s\S]*bindtap="saveAiReminderSettings"[\s\S]*>保存</,
  'AI reminder editor should render a visible save action'
)

const actions = cssBlock('.ai-reminder-sheet-actions')
assert.ok(actions, 'AI reminder actions CSS block should exist')
assert.doesNotMatch(
  actions,
  /position:\s*absolute/,
  'AI reminder save actions should stay in the sheet flex layout instead of being absolutely positioned'
)
assert.match(actions, /flex-shrink:\s*0/, 'AI reminder save actions should not collapse below the viewport')

const scroll = cssBlock('.ai-reminder-sheet-scroll')
assert.match(scroll, /min-height:\s*0/, 'AI reminder scroll area should be allowed to shrink inside the flex sheet')

console.log('AI reminder sheet layout checks passed')
