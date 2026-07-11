const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const wxml = fs.readFileSync(path.join(root, 'pages/hand-detail/hand-detail.wxml'), 'utf8')
const js = fs.readFileSync(path.join(root, 'pages/hand-detail/hand-detail.js'), 'utf8')
const wxss = fs.readFileSync(path.join(root, 'pages/hand-detail/hand-detail.wxss'), 'utf8')

assert.match(wxml, /bindtap="openExport"/)
assert.match(wxml, /exportVisible/)
assert.match(wxml, /copyExportText/)
assert.match(js, /hand-export/)
assert.match(js, /exportVisible/)
assert.match(js, /openExport\(\)/)
assert.match(js, /copyExportText\(\)/)
assert.match(js, /buildPokerStarsExport\(hand,\s*\{\s*session,\s*actions\s*\}\)/)
assert.match(wxss, /\.hand-export-sheet/)

const exportLayerMatch = wxss.match(/\.hand-export-layer\s*\{[\s\S]*?z-index:\s*(\d+)/)
assert.ok(exportLayerMatch, 'hand-detail export layer must define z-index')
assert.ok(Number(exportLayerMatch[1]) >= 46000, 'hand-detail export layer must render above page modals')

console.log('hand-detail export entry checks passed')
