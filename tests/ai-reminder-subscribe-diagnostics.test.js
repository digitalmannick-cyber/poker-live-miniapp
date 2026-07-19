const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')

test('subscribe permission failure keeps original WeChat diagnostics', () => {
  const source = fs.readFileSync(path.join(root, 'services', 'data-service.js'), 'utf8')
  assert.match(source, /errCode:\s*error && \(error\.errCode \|\| error\.errcode \|\| error\.code\)/)
  assert.match(source, /templateId:\s*tmplId/)
  assert.match(source, /raw:\s*error \|\| null/)
})

test('AI reminder subscribe permission is requested without a loading overlay first', () => {
  const profileSource = fs.readFileSync(path.join(root, 'pages', 'profile', 'profile.js'), 'utf8')
  const profileStart = profileSource.indexOf('async requestAiReminderSubscribeForDraft()')
  const profileEnd = profileSource.indexOf('async toggleAiReminderRuleSubscribeMessage', profileStart)
  const profileMethod = profileSource.slice(profileStart, profileEnd)
  assert.doesNotMatch(profileMethod, /showLoading/)
  assert.doesNotMatch(profileMethod, /hideLoading/)

  const sessionListSource = fs.readFileSync(path.join(root, 'pages', 'session-list', 'session-list.js'), 'utf8')
  const sessionStart = sessionListSource.indexOf('async requestAiReminderSubscribeForDraft()')
  const sessionEnd = sessionListSource.indexOf('async toggleAiReminderRuleSubscribeMessage', sessionStart)
  const sessionMethod = sessionListSource.slice(sessionStart, sessionEnd)
  assert.doesNotMatch(sessionMethod, /showLoading/)
  assert.doesNotMatch(sessionMethod, /hideLoading/)
})

test('cloud backup pagination supports player notes collection', () => {
  const source = fs.readFileSync(path.join(root, 'cloudfunctions', 'poker_data', 'index.js'), 'utf8')
  assert.match(source, /playerNotes:\s*COLLECTIONS\.playerNotes/)
})
