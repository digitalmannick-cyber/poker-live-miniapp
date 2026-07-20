const assert = require('assert')
const fs = require('fs')
const path = require('path')
const test = require('node:test')

const root = path.resolve(__dirname, '..')

test('social cloud function has an isolated reproducible deployment config', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'cloudbaserc.social.json'), 'utf8'))
  assert.strictEqual(config.envId, 'cloud1-d3ggy9aq3be912e34')
  assert.strictEqual(config.functionRoot, './cloudfunctions')
  assert.deepStrictEqual(config.functions, [{
    name: 'poker_social',
    type: 'Event',
    handler: 'index.main',
    timeout: 60,
    runtime: 'Nodejs20.19',
    memorySize: 256,
    installDependency: true
  }])
  assert(fs.existsSync(path.join(root, 'cloudfunctions', 'poker_social', 'package.json')))
  assert(fs.existsSync(path.join(root, 'cloudfunctions', 'poker_social', 'index.js')))
})

test('deployment config never persists social secrets', () => {
  const source = fs.readFileSync(path.join(root, 'cloudbaserc.social.json'), 'utf8')
  assert(!source.includes('SOCIAL_INVITE_TOKEN_SECRET'))
  assert(!source.includes('SOCIAL_ADMIN_OPENIDS'))
})

test('deployment checklist covers collections, indexes and both server-only secrets', () => {
  const source = fs.readFileSync(path.join(
    root,
    'docs',
    'superpowers',
    'specs',
    '2026-07-20-social-comment-admin-moderation-deployment-checklist.md'
  ), 'utf8')
  assert(source.includes('database-security-rules.json'))
  assert(source.includes('database-indexes.json'))
  assert(source.includes('cloudbaserc.social.json'))
  assert(source.includes('SOCIAL_INVITE_TOKEN_SECRET'))
  assert(source.includes('SOCIAL_ADMIN_OPENIDS'))
  assert(source.includes('不输出值'))
})
