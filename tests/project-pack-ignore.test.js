const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'))
const ignored = config.packOptions && Array.isArray(config.packOptions.ignore)
  ? config.packOptions.ignore
  : []

assert.equal(
  ignored.some(item => item && item.type === 'prefix' && String(item.value || '').trim() === '.'),
  false,
  'project pack ignore must not exclude "." because it hides all miniapp pages from DevTools packaging'
)

console.log('project pack ignore tests passed')
