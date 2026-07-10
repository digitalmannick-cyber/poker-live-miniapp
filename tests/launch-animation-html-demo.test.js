const assert = require('assert')
const fs = require('fs')
const path = require('path')

const html = fs.readFileSync(
  path.join(__dirname, '..', 'web-preview', 'launch-animation-demo.html'),
  'utf8'
)

assert.match(html, /智牌屋/)
assert.match(html, /launch-phantom-five-cards-v1\.jpg/)
assert.match(html, /href="launch-animation-demo\.html"/)
assert.doesNotMatch(html, /onclick=/)
assert.match(html, /prefers-reduced-motion/)
assert.match(html, /--launch-duration:\s*2950ms/)
assert.match(html, /@keyframes heroFloat/)
assert.match(html, /--hero-x:\s*2\.5%/)
assert.match(html, /40%\s*\{\s*transform:\s*translate3d\(var\(--hero-x\), -5px, 0\)/)
assert.match(html, /75%\s*\{\s*transform:\s*translate3d\(var\(--hero-x\), 4px, 0\)/)
assert.doesNotMatch(html, /52%\s*\{/)
assert.doesNotMatch(html, /cape-layer/)
