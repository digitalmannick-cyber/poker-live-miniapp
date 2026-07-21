const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const wxml = fs.readFileSync(path.join(root, 'pages/review-list/review-list.wxml'), 'utf8')
const js = fs.readFileSync(path.join(root, 'pages/review-list/review-list.js'), 'utf8')
const wxss = fs.readFileSync(path.join(root, 'pages/review-list/review-list.wxss'), 'utf8')

assert.match(wxml, /bindtap="openDetailExport"/)
assert.match(wxml, /detailExportVisible/)
assert.match(wxml, /copyDetailExportText/)
assert.match(js, /detailExportVisible/)
assert.match(js, /openDetailExport\(\)/)
assert.match(js, /copyDetailExportText\(\)/)
assert.match(wxss, /\.review-export-sheet/)

assert.match(wxml, /bindtap="openDetailSocialHandPublish"/)
assert.match(wxml, />发布<\/view>/)
assert.match(js, /openDetailSocialHandPublish\(\)/)
assert.match(js, /\/pages\/social-hand-publish\/social-hand-publish\?handId=/)
assert.match(js, /encodeURIComponent\(handId\)/)
assert.doesNotMatch(
  js.match(/openDetailSocialHandPublish\(\)\s*\{[\s\S]*?\n  \},/)[0],
  /[?&](snapshot|session|actions|playerId|ownerOpenId|privatePlayerId|bigBlind|amount)=/i
)

function readZIndex(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = wxss.match(new RegExp(escaped + '\\s*\\{[\\s\\S]*?z-index:\\s*(\\d+)'))
  return match ? Number(match[1]) : 0
}

const modalZIndex = Math.max(readZIndex('.review-modal'), readZIndex('.review-modal-panel'))
const exportZIndex = readZIndex('.review-export-layer')
assert.ok(
  exportZIndex > modalZIndex,
  `export sheet must render above hand detail modal, got export ${exportZIndex} <= modal ${modalZIndex}`
)

console.log('review-list export entry checks passed')
