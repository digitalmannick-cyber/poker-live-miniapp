const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const wxml = fs.readFileSync(path.join(root, 'components/friend-hub/friend-hub.wxml'), 'utf8')
const wxss = fs.readFileSync(path.join(root, 'components/friend-hub/friend-hub.wxss'), 'utf8')

test('dynamic feed preserves visual cards while removing secondary metrics', () => {
  assert.match(wxml, /item\.heroCardsVisual/)
  assert.match(wxml, /item\.boardCardsVisual/)
  assert.doesNotMatch(wxml, />有效筹码</)
  assert.doesNotMatch(wxml, />行动</)
  assert.match(wxml, /class="feed-pot"[\s\S]*\{\{item\.potBbLabel\}\}/)
})

test('all feed cards share one baseline and one border treatment', () => {
  assert.doesNotMatch(wxss, /feed-hero-cards[^}]*translateY/)
  assert.doesNotMatch(wxss, /feed-board-card-(?:turn|river)\s*\{[^}]*box-shadow:/s)
})

test('replay and social actions use compact real-icon affordances', () => {
  assert.match(wxml, /class="feed-replay"[^>]+catchtap="openReplay"[\s\S]*回放/)
  assert.match(wxml, /assets\/social-icons\/play\.svg/)
  assert.match(wxml, /assets\/social-icons\/message-circle\.svg/)
  assert.match(wxml, /assets\/social-icons\/heart-outline\.svg/)
  assert.match(wxml, /assets\/social-icons\/heart-filled\.svg/)
  assert.doesNotMatch(wxml, /[♥♡]/)
  assert.match(wxss, /\.feed-replay\s*\{[^}]*min-height:\s*56rpx/s)
  assert.doesNotMatch(wxss, /\.feed-replay\s*\{[^}]*width:\s*100%/s)
  assert.match(wxss, /\.feed-card-footer\s*\{[^}]*border-top:/s)
})

test('social navigation uses one connected P5 rail', () => {
  assert.match(wxml, />动态<\/view>[\s\S]*>好友<\/view>[\s\S]*>排行榜<\/view>/)
  assert.match(wxss, /\.friend-subnav\s*\{[^}]*border-bottom:/s)
  assert.match(wxss, /\.friend-subnav-item\.active::after/)
  assert.doesNotMatch(wxss, /\.friend-subnav-item\s*\{[^}]*border-radius:/s)
})

test('ranking podium and self row have collision-safe dedicated regions', () => {
  assert.match(wxml, /podium-plinth podium-plinth-\{\{item\.podiumTone\}\}/)
  assert.match(wxml, /ranking-my-rank[\s\S]*ranking-my-profile[\s\S]*ranking-my-duration/)
  assert.match(wxss, /\.ranking-my-card\s*\{[^}]*grid-template-columns:\s*72rpx\s+84rpx\s+minmax\(0,\s*1fr\)\s+112rpx/s)
  assert.match(wxss, /\.podium-gold\s+\.podium-plinth[^}]*--plinth-height:/s)
  assert.match(wxss, /\.podium-silver\s+\.podium-plinth[^}]*--plinth-height:/s)
  assert.match(wxss, /\.podium-bronze\s+\.podium-plinth[^}]*--plinth-height:/s)
})
