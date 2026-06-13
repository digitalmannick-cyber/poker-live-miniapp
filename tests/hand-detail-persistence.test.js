const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const root = path.resolve(__dirname, '..')

test('local store createHand persists new canonical fields', () => {
  const source = fs.readFileSync(path.join(root, 'utils/store.js'), 'utf8')

  assert.match(source, /hasStraddle:\s*!!payload\.hasStraddle/)
  assert.match(source, /heroQuestion:\s*payload\.heroQuestion\s*\|\|\s*''/)
  assert.match(source, /opponentName:\s*payload\.opponentName\s*\|\|\s*''/)
  assert.match(source, /detailBackfilled:\s*!!payload\.detailBackfilled/)
})

test('cloud repo normalization preserves new canonical fields', () => {
  const source = fs.readFileSync(path.join(root, 'services/cloud-repo.js'), 'utf8')

  assert.match(source, /hasStraddle:\s*!!merged\.hasStraddle/)
  assert.match(source, /heroQuestion:\s*merged\.heroQuestion\s*\|\|\s*''/)
  assert.match(source, /opponentName:\s*merged\.opponentName\s*\|\|\s*''/)
  assert.match(source, /detailBackfilled:\s*!!merged\.detailBackfilled/)
})
