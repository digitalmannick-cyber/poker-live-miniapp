const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

test('hand ledger numeric amount sheet uses a resolvable relative component path', () => {
  const root = path.resolve(__dirname, '..')
  const pageJson = JSON.parse(fs.readFileSync(path.join(root, 'pages', 'hand-ledger-input', 'hand-ledger-input.json'), 'utf8'))
  assert.equal(pageJson.usingComponents['numeric-amount-sheet'], '../../components/numeric-amount-sheet/index')
  assert.ok(fs.existsSync(path.join(root, 'components', 'numeric-amount-sheet', 'index.json')))
})
