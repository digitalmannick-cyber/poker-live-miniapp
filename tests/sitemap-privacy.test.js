const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')

function json(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'))
}

test('private mini-program pages are excluded from WeChat page indexing', () => {
  const app = json('app.json')
  const sitemap = json(app.sitemapLocation)

  assert.ok(app.pages.length > 0, 'the application should still declare runtime pages')
  assert.deepEqual(sitemap.rules, [{ action: 'disallow', page: '*' }])
  assert.equal(sitemap.rules.some(rule => rule.action === 'allow' && rule.page === '*'), false)
})
