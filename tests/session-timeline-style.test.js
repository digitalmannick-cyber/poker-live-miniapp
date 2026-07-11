const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const files = [
  'pages/session-list/session-list.wxss',
  'pages/session-detail/session-detail.wxss'
]

for (const file of files) {
  const css = fs.readFileSync(path.join(root, file), 'utf8')
  const match = css.match(/\.session-event-node::after\s*\{([\s\S]*?)\n\}/)
  assert.ok(match, `${file} should define the timeline connector`)

  const rule = match[1]
  assert.ok(/width:\s*5rpx;/.test(rule), `${file} timeline connector should be visibly wide`)
  assert.ok(/rgba\(230,\s*0,\s*18,\s*0\.[67]/.test(rule), `${file} timeline connector should use visible P5 red`)
  assert.ok(/box-shadow:\s*0 0 12rpx rgba\(230,\s*0,\s*18,\s*0\.4/.test(rule), `${file} timeline connector should have a subtle glow`)
}

const sessionListCss = fs.readFileSync(path.join(root, 'pages/session-list/session-list.wxss'), 'utf8')
const liveEventRule = sessionListCss.match(/\.session-live-event\s*\{([\s\S]*?)\n\}/)
assert.ok(liveEventRule, 'session-list should define active-session timeline rows')
assert.ok(/align-items:\s*center;/.test(liveEventRule[1]), 'active-session timeline rows should vertically align icon, time, title and amount')
assert.ok(/grid-template-columns:\s*56rpx 76rpx minmax\(0,\s*1fr\) auto;/.test(liveEventRule[1]), 'active-session timeline rows should use stable columns')
assert.ok(/\.session-event-title-row\s*\{[\s\S]*?display:\s*flex;[\s\S]*?align-items:\s*center;/.test(sessionListCss), 'plain event titles should align to the row center')
assert.ok(/\.session-live-event-time\s*\{[\s\S]*?display:\s*flex;[\s\S]*?align-items:\s*center;/.test(sessionListCss), 'timeline time labels should align to the row center')

console.log('session timeline style ok')
