const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const wxml = fs.readFileSync(path.join(root, 'pages/hand-detail/hand-detail.wxml'), 'utf8')
const js = fs.readFileSync(path.join(root, 'pages/hand-detail/hand-detail.js'), 'utf8')
const wxss = fs.readFileSync(path.join(root, 'pages/hand-detail/hand-detail.wxss'), 'utf8')

test('existing text export entry remains available above page modals', () => {
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
})

test('hand detail registers one publish route and exposes a dedicated publish entry', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  assert.equal(app.pages.filter(item => item === 'pages/social-hand-publish/social-hand-publish').length, 1)
  assert.match(wxml, /bindtap="openSocialHandPublish"/)
  assert.match(wxml, /发布|分享/)
  assert.match(js, /openSocialHandPublish\s*\(/)
})

test('hand detail navigation passes one encoded handId and no local snapshot or private metadata', () => {
  const method = extractMethod(js, 'openSocialHandPublish')
  assert.match(method, /encodeURIComponent\s*\(/)
  assert.match(method, /\/pages\/social-hand-publish\/social-hand-publish\?handId=/)
  assert.doesNotMatch(method, /[?&](snapshot|session|actions|playerId|ownerOpenId|privatePlayerId|bigBlind|amount)=/i)
  assert.doesNotMatch(method, /JSON\.stringify|buildHandSnapshot|resolveBigBlind|anonym/i)
  const queryFields = Array.from(method.matchAll(/[?&]([A-Za-z][A-Za-z0-9_]*)=/g), match => match[1])
  assert.deepEqual(Array.from(new Set(queryFields)), ['handId'], 'publish route must contain only handId')
})

function extractMethod(source, name) {
  const match = new RegExp(name + '\\s*\\([^)]*\\)\\s*\\{').exec(source)
  assert.ok(match, `${name} method is required`)
  let depth = 0
  for (let index = match.index; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(match.index, index + 1)
    }
  }
  assert.fail(`${name} method must have a complete body`)
}
