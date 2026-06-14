const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const wxml = fs.readFileSync(path.join(root, 'pages/review-list/review-list.wxml'), 'utf8')
const lines = wxml.split(/\r?\n/)

assert.equal(/\?\/(?:view|button|text)>/.test(wxml), false, 'WXML should not contain corrupted closing tags like ?/view>')
assert.equal(/placeholder="[^"\n]*$/.test(wxml), false, 'WXML placeholder attributes should close on the same line')
assert.equal(/{{[^}\n]*\?[^}\n]*'[^'\n]*\? :/.test(wxml), false, 'WXML ternary text should not contain a broken quoted branch')

lines.forEach((line, index) => {
  const quoteCount = (line.match(/"/g) || []).length
  assert.equal(quoteCount % 2, 0, `WXML line ${index + 1} should have balanced double quotes`)
})

console.log('review WXML syntax smoke tests passed')
