const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const handReplay = require('../utils/hand-replay')

const replay = handReplay.buildReplayView({
  _id: 'hand_avatar_replay',
  heroPosition: 'CO',
  heroCardsInput: 'AhKh',
  villainPosition: 'HJ',
  opponentName: 'MGM WG',
  opponentPlayerNoteId: 'note-hj',
  opponentAvatarUrl: 'cloud://avatar-hj',
  opponentAvatarFileId: 'cloud://avatar-hj',
  stakeLevel: '300/600',
  streetInputs: {
    preflop: { actionLine: 'HJ bet 7000, CO call 7000', pot: '25900' }
  },
  playerSnapshots: [{
    slot: 'HJ',
    position: 'HJ',
    playerNoteId: 'note-hj',
    playerName: 'MGM WG',
    avatarUrl: 'cloud://avatar-hj',
    avatarFileId: 'cloud://avatar-hj',
    avatarDisplayUrl: 'wxfile://avatar-hj'
  }]
})

const hj = replay.players.find(player => player.position === 'HJ')
assert.ok(hj, 'HJ replay seat should exist')
assert.equal(hj.name, 'MGM WG')
assert.equal(hj.avatarDisplayUrl, 'wxfile://avatar-hj')
assert.equal(hj.avatarUrl, 'cloud://avatar-hj')
assert.equal(hj.hasAvatar, true)

const wxml = fs.readFileSync(path.join(__dirname, '..', 'components', 'hand-replay-player', 'hand-replay-player.wxml'), 'utf8')
const wxss = fs.readFileSync(path.join(__dirname, '..', 'components', 'hand-replay-player', 'hand-replay-player.wxss'), 'utf8')

assert.match(wxml, /replay-seat-avatar-img/, 'replay seat should render player avatar image when available')
assert.match(wxml, /replay-seat-position-badge/, 'replay seat should keep position visible over avatar seats')
assert.match(wxss, /\.replay-seat-avatar/, 'replay seat avatar should have dedicated styling')
assert.match(wxss, /\.replay-seat-position-badge/, 'replay seat position badge should have dedicated styling')

console.log('hand replay player avatar tests passed')
