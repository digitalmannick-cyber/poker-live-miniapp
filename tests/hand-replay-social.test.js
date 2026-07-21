const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const handReplay = require('../utils/hand-replay')

test('social replay keeps Hero cards and renders anonymous seats with two-card data', () => {
  const replay = handReplay.buildSocialReplayView({
    version: 1,
    hero: { label: 'Hero', seat: 1, position: 'BTN', cards: ['As', 'Ks'], stackBb: 125 },
    players: [
      { label: '夜鸦', seat: 2, position: 'SB', stackBb: 112 },
      { label: '赤狐', seat: 3, position: 'BB', stackBb: 98 }
    ],
    board: { flop: ['Qs', 'Jd', '6c'], turn: ['Ts'], river: [] },
    actions: [
      { street: 'preflop', actor: '夜鸦', type: 'raise', amountBb: 8 },
      { street: 'preflop', actor: 'Hero', type: 'call', amountBb: 8 },
      { street: 'turn', actor: '夜鸦', type: 'bet', amountBb: 8 }
    ],
    potBb: 38.5,
    showdown: []
  }, 'share-1')

  assert.equal(replay.available, true)
  assert.equal(replay.heroCards.length, 2)
  assert.deepEqual(replay.players.map(player => player.name), ['Hero', '夜鸦', '赤狐'])
  assert.equal(replay.steps[2].boardCards.length, 4)
  assert.equal(replay.steps[2].actorPosition, 'SB')
  assert.equal(replay.steps[2].potText, '38.5 BB')
})

test('replay markup hard-codes a two-card pair for every opponent seat', () => {
  const root = path.resolve(__dirname, '..')
  const wxml = fs.readFileSync(path.join(root, 'components', 'hand-replay-player', 'hand-replay-player.wxml'), 'utf8')
  const js = fs.readFileSync(path.join(root, 'components', 'hand-replay-player', 'hand-replay-player.js'), 'utf8')
  assert.match(wxml, /wx:for="\{\{item\.holeCards\}\}"/)
  assert.match(js, /back-1/)
  assert.match(js, /back-2/)
  assert.doesNotMatch(js, /back-3/)
})

test('replay uses a 2.5D table image and DOM motion without full-table canvas rendering', () => {
  const root = path.resolve(__dirname, '..')
  const wxml = fs.readFileSync(path.join(root, 'components', 'hand-replay-player', 'hand-replay-player.wxml'), 'utf8')
  const js = fs.readFileSync(path.join(root, 'components', 'hand-replay-player', 'hand-replay-player.js'), 'utf8')
  const wxss = fs.readFileSync(path.join(root, 'components', 'hand-replay-player', 'hand-replay-player.wxss'), 'utf8')

  assert.match(wxml, /class="replay-table-art"/)
  assert.doesNotMatch(wxml, /<canvas/)
  assert.match(wxml, /replay-table-2_5d-v1\.jpg/)
  assert.match(wxml, /replay-chip-stack-v1\.png/)
  assert.match(js, /value: 1400/)
  assert.match(wxss, /\.replay-seat\.active \.replay-seat-panel/)
  assert.equal(fs.existsSync(path.join(root, 'assets', 'replay', 'replay-table-2_5d-v1.jpg')), true)
  assert.equal(fs.existsSync(path.join(root, 'assets', 'replay', 'replay-chip-stack-v1.png')), true)
})

test('publish and social detail reuse the same replay component', () => {
  const root = path.resolve(__dirname, '..')
  const publish = fs.readFileSync(path.join(root, 'pages', 'social-hand-publish', 'social-hand-publish.wxml'), 'utf8')
  const detail = fs.readFileSync(path.join(root, 'pages', 'social-hand-detail', 'social-hand-detail.wxml'), 'utf8')
  const feed = fs.readFileSync(path.join(root, 'components', 'friend-hub', 'friend-hub.wxml'), 'utf8')
  assert.match(publish, /hand-replay-player/)
  assert.match(detail, /hand-replay-player/)
  assert.match(feed, /assets\/social-icons\/play\.svg/)
  assert.match(feed, /<text>回放<\/text>/)
})
