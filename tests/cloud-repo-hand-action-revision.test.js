const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repository = require('../services/cloud-repo')

test('client cloud repo has no Node crypto or transaction-based hand writer', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'services', 'cloud-repo.js'), 'utf8')
  assert.doesNotMatch(source, /require\(\s*['"](?:node:)?crypto['"]\s*\)/)
  assert.doesNotMatch(source, /\.runTransaction\s*\(/)
  assert.doesNotMatch(source, /function\s+(?:createHandActionRevision|replaceActions|writeHandAndActionsRevisioned)\s*\(/)
  assert.match(source, /async function deleteHand\(handId\) \{\s*void handId\s*throw new Error\('server-authoritative poker_data write required'\)\s*\}/)
  assert.match(source, /async function deleteSession\(sessionId\) \{\s*void sessionId\s*throw new Error\('server-authoritative poker_data write required'\)\s*\}/)
})

test('client revisioned business writers are sealed and empty seed is a no-op', async () => {
  assert.equal(await repository.seedBusinessData({}), false)
  await assert.rejects(repository.seedBusinessData({ hands: [{ _id: 'hand-1' }] }), /server-authoritative poker_data write required/)
  await assert.rejects(repository.mergeBusinessData({ hands: [{ _id: 'hand-1' }] }), /server-authoritative poker_data write required/)
  await assert.rejects(repository.replaceBusinessData({ hands: [{ _id: 'hand-1' }] }), /server-authoritative poker_data write required/)
  await assert.rejects(repository.createHand({ _id: 'hand-1' }), /server-authoritative poker_data write required/)
  await assert.rejects(repository.updateHand('hand-1', {}), /server-authoritative poker_data write required/)
  await assert.rejects(repository.deleteHand('hand-1'), /server-authoritative poker_data write required/)
  await assert.rejects(repository.deleteSession('session-1'), /server-authoritative poker_data write required/)
})
